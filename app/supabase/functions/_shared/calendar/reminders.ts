// ============================================================================
// Quando un promemoria è dovuto. Funzioni PURE, con l'orologio per parametro.
//
// IL PROBLEMA VERO NON È «MANDARE UN'EMAIL A UNA CERTA ORA»
// È che un promemoria non deve arrivare due volte, non deve arrivare di notte,
// e soprattutto non deve SPARIRE se il job che doveva generarlo non è partito.
// Le tre cose insieme escludono la forma ovvia — «se sono le 8, manda» — che
// perde il promemoria di tutti al primo job fallito (§37).
//
// LA FORMA SCELTA
//   · il job gira spesso (ogni quarto d'ora) e non decide da solo se è «l'ora»;
//   · non produce nulla prima delle 8 LOCALI di chi riceve;
//   · ogni promemoria ha una chiave di deduplicazione, e l'unicità la impone il
//     database. Un job eseguito tre volte nella stessa mattina inserisce una
//     riga la prima volta e viene respinto le altre due;
//   · le condizioni sono INTERVALLI, non uguaglianze, dove è possibile: il
//     promemoria dei sette giorni scatta per `2 ≤ giorni ≤ 7`, quindi una
//     giornata di fermo lo fa arrivare a sei giorni invece che a sette —
//     tardi, ma non perso.
//
// L'ECCEZIONE DICHIARATA: il promemoria «un giorno prima» ha una condizione
// esatta (`giorni == 1`), perché un intervallo lo sovrapporrebbe a quello del
// giorno stesso. Se il job resta fermo per l'intera giornata precedente, quel
// promemoria non arriva — ma il giorno dopo arriva quello «in scadenza oggi»,
// che dice la stessa cosa con più urgenza. È una perdita accettata e scritta,
// non una svista.
//
// IL FUSO NON SI CALCOLA A MANO. Nessuna somma di offset, nessuna tabella
// dell'ora legale: si chiede a `Intl.DateTimeFormat` che ore sono in quella
// zona. È l'unico modo per cui l'ultima domenica di marzo non sia un caso
// speciale da ricordarsi — ed è disponibile sia in Deno sia in Node.
//
// Modulo PORTABILE: nessuna API Deno.
// ============================================================================
import { REMINDER_LOCAL_HOUR, UNASSIGNED_ALERT_DAYS, type ReminderKind } from './contract.ts';
import type { NotificationType } from './contract.ts';

/** Che ore e che giorno sono, in una certa zona. */
export interface ZonedNow {
  /** Data locale in `YYYY-MM-DD`. */
  date: string;
  /** Ora locale 0–23. */
  hour: number;
}

/**
 * Ora e data locali di una zona IANA.
 *
 * Solleva se la zona non esiste. NON ripiega su UTC né su Europe/Zurich: un
 * promemoria generato nel fuso sbagliato arriverebbe all'ora sbagliata senza
 * che nessuno se ne accorga, e un fuso non valido è comunque impossibile da
 * salvare (la 0018 lo verifica in un trigger). Se accade, è un guasto e va
 * dichiarato.
 */
export function zonedNow(now: Date, timeZone: string): ZonedNow {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);

  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  const year = get('year'), month = get('month'), day = get('day'), hour = get('hour');
  if (!year || !month || !day || !hour) {
    throw new Error(`fuso orario non utilizzabile: ${timeZone}`);
  }
  return { date: `${year}-${month}-${day}`, hour: Number(hour) };
}

/**
 * Giorni di CALENDARIO fra due date `YYYY-MM-DD`. Positivo se `to` viene dopo.
 *
 * Le due date sono giorni, non istanti: l'aritmetica è in UTC e non può
 * scivolare. È la stessa scelta di `calendarDaysUntil` in `taskFormat`, dove
 * dividere i millisecondi faceva dire «Oggi» alle 23:30 a chi aveva tempo fino
 * a domani.
 */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return Number.NaN;
  return Math.round((b - a) / 86_400_000);
}

export interface ReminderPreferences {
  remind7Days: boolean;
  remind1Day: boolean;
  remindDueDay: boolean;
  remindOverdue: boolean;
  timezone: string;
}

export const DEFAULT_PREFERENCES: Omit<ReminderPreferences, 'timezone'> = {
  remind7Days: true, remind1Day: true, remindDueDay: true, remindOverdue: true,
};

export interface DueReminder {
  kind: ReminderKind;
  type: NotificationType;
  /** Suffisso della chiave di deduplicazione. L'utente è l'altra metà della chiave. */
  dedupeKey: string;
}

/**
 * Quali promemoria sono dovuti ADESSO per un'attività con questa scadenza.
 *
 * Restituisce un elenco perché in un caso limite ne può valere più di uno —
 * un'attività creata il giorno stesso della scadenza non ha mai avuto un
 * «sette giorni prima», ma se ne avesse avuto uno andrebbe comunque saltato:
 * la deduplicazione lo impedisce da sola.
 *
 * ⚠️ La chiave di deduplicazione NON contiene l'identificativo dell'utente.
 * Non è una dimenticanza: l'unicità nel database è su `(user_id, dedupe_key)`,
 * quindi l'utente È già metà della chiave. Ripeterlo dentro la stringa
 * significherebbe scrivere due volte la stessa cosa e poter sbagliare a
 * scriverla una delle due.
 */
export function dueReminders(input: {
  dueDate: string;
  prefs: ReminderPreferences;
  now: Date;
  taskId: string;
}): DueReminder[] {
  const { dueDate, prefs, now, taskId } = input;
  const local = zonedNow(now, prefs.timezone);

  // Prima delle 8 locali non si sveglia nessuno (§36).
  if (local.hour < REMINDER_LOCAL_HOUR) return [];

  const d = daysBetween(local.date, dueDate);
  if (Number.isNaN(d)) return [];

  const out: DueReminder[] = [];

  // Sette giorni: intervallo, così una giornata di fermo lo fa arrivare tardi
  // invece che mai. Il limite inferiore è 2 per non sovrapporsi al promemoria
  // del giorno prima.
  if (prefs.remind7Days && d >= 2 && d <= 7) {
    out.push({ kind: 'd7', type: 'task_due_soon', dedupeKey: `task:${taskId}:d7` });
  }
  // Un giorno prima: condizione esatta, per la ragione scritta in cima.
  if (prefs.remind1Day && d === 1) {
    out.push({ kind: 'd1', type: 'task_due_soon', dedupeKey: `task:${taskId}:d1` });
  }
  if (prefs.remindDueDay && d === 0) {
    out.push({ kind: 'd0', type: 'task_due_today', dedupeKey: `task:${taskId}:d0` });
  }
  // Scaduta: UNA volta sola, per sempre. Un promemoria che torna ogni mattina
  // per un'attività ferma da tre settimane non informa, addestra a ignorare.
  if (prefs.remindOverdue && d < 0) {
    out.push({ kind: 'overdue', type: 'task_overdue', dedupeKey: `task:${taskId}:overdue` });
  }

  return out;
}

/**
 * Un'attività urgente e SENZA responsabile merita un avviso a chi guida
 * l'azienda (§32): non deve sparire nel vuoto solo perché nessuno se l'è presa.
 *
 * Una volta sola, e solo per la priorità alta. La chiave non ha il giorno:
 * finché resta non assegnata non se ne riparla, e se qualcuno la prende in
 * carico l'avviso ha fatto il suo lavoro.
 */
export function unassignedAlert(input: {
  dueDate: string;
  priority: 'low' | 'medium' | 'high';
  now: Date;
  timezone: string;
  taskId: string;
}): DueReminder | null {
  if (input.priority !== 'high') return null;
  const local = zonedNow(input.now, input.timezone);
  if (local.hour < REMINDER_LOCAL_HOUR) return null;

  const d = daysBetween(local.date, input.dueDate);
  if (Number.isNaN(d) || d > UNASSIGNED_ALERT_DAYS) return null;

  return {
    kind: d < 0 ? 'overdue' : 'd7',
    type: 'unassigned_task_due_soon',
    dedupeKey: `task:${input.taskId}:unassigned`,
  };
}

/**
 * La finestra di scadenze che il worker deve leggere dal database.
 *
 * Si calcola dall'istante e non dal fuso di un singolo utente, perché la query
 * è una sola per tutti: si prende l'intervallo più largo che possa contenere
 * qualcosa di interessante per QUALUNQUE fuso, e poi la decisione per persona
 * la prende `dueReminders`, che il fuso ce l'ha. Un giorno di margine per lato
 * copre le zone da UTC-12 a UTC+14.
 *
 * Il limite inferiore esiste perché le scadute vanno notificate una volta sola:
 * risalire all'infinito significherebbe rileggere ogni mattina tutto l'arretrato
 * dell'azienda per scoprire che è già stato notificato.
 */
export function reminderWindow(now: Date, overdueLookbackDays = 30): { from: string; to: string } {
  const day = (offset: number): string => {
    const d = new Date(now.getTime() + offset * 86_400_000);
    return d.toISOString().slice(0, 10);
  };
  return { from: day(-Math.abs(overdueLookbackDays)), to: day(8) };
}
