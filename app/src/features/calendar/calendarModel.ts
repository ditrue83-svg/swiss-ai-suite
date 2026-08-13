// ============================================================================
// La griglia del mese e i raggruppamenti dell'agenda: funzioni PURE.
//
// Stanno qui e non dentro i componenti perché sono aritmetica di calendario, ed
// è il genere di codice che sbaglia in silenzio: un mese che comincia di
// domenica, il cambio dell'ora, un anno bisestile, dicembre che deve diventare
// gennaio dell'anno dopo. Un errore qui non fa cadere niente — disegna una
// casella nel posto sbagliato, e nessuno se ne accorge finché una scadenza non
// compare nel giorno sbagliato.
//
// ⚠️ TUTTA L'ARITMETICA È IN UTC, E LE DATE SONO STRINGHE `YYYY-MM-DD`.
// Una data di calendario non è un istante: `new Date('2026-03-29')` e poi
// `setDate(+1)` sul fuso locale, la notte del cambio d'ora, restituisce lo
// stesso giorno o ne salta uno. In UTC i giorni durano tutti 86 400 secondi.
// L'unica cosa che si legge dal fuso locale è QUAL È OGGI, che è appunto una
// domanda locale.
// ============================================================================
import { isOverdue } from '@/features/tasks/taskFormat';
import type { CalendarTaskItem } from '@/types/models';

/** Il giorno di OGGI secondo l'orologio di chi guarda, in `YYYY-MM-DD`. */
export function todayISO(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isoDay(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function addDays(day: string, delta: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Mese precedente o successivo, con l'anno che segue. `month` è 1–12. */
export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zero = year * 12 + (month - 1) + delta;
  return { year: Math.floor(zero / 12), month: (zero % 12) + 1 };
}

export interface GridDay {
  date: string;
  /** Falso per i giorni di riempimento presi dal mese precedente o successivo. */
  inMonth: boolean;
}

/**
 * La griglia del mese: settimane complete, dal lunedì alla domenica.
 *
 * Il lunedì e non la domenica: è la convenzione svizzera, ed è anche quella che
 * ISO 8601 chiama primo giorno della settimana. Non è configurabile perché non
 * ha ancora nessuno che voglia configurarla — quando servirà, sarà un parametro
 * di questa funzione e nient'altro.
 *
 * Le settimane sono sempre intere: una griglia con la prima riga tagliata
 * costringe l'occhio a ricontare, e le colonne non si allineano più.
 */
export function buildMonthGrid(year: number, month: number): GridDay[][] {
  const first = new Date(Date.UTC(year, month - 1, 1));
  // `getUTCDay()` dà 0 per domenica: qui il lunedì vale 0, quindi si ruota.
  const offset = (first.getUTCDay() + 6) % 7;
  const start = new Date(first.getTime() - offset * 86_400_000);

  const weeks: GridDay[][] = [];
  const cursor = new Date(start.getTime());
  // Sei settimane coprono qualunque mese, compreso un marzo che comincia di
  // domenica. Le righe interamente fuori mese si tolgono dopo: disegnarne
  // sempre sei farebbe saltellare l'altezza della pagina da un mese all'altro.
  for (let w = 0; w < 6; w++) {
    const week: GridDay[] = [];
    for (let d = 0; d < 7; d++) {
      const date = cursor.toISOString().slice(0, 10);
      week.push({ date, inMonth: cursor.getUTCMonth() === month - 1 && cursor.getUTCFullYear() === year });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks.filter((week) => week.some((day) => day.inMonth));
}

/** Il primo e l'ultimo giorno mostrati dalla griglia: è l'intervallo da chiedere al database. */
export function gridRange(year: number, month: number): { from: string; to: string } {
  const weeks = buildMonthGrid(year, month);
  return { from: weeks[0][0].date, to: weeks[weeks.length - 1][6].date };
}

/** Le attività raggruppate per giorno di scadenza. */
export function groupByDay(items: CalendarTaskItem[]): Map<string, CalendarTaskItem[]> {
  const map = new Map<string, CalendarTaskItem[]>();
  for (const item of items) {
    const list = map.get(item.dueDate) ?? [];
    list.push(item);
    map.set(item.dueDate, list);
  }
  for (const list of map.values()) list.sort(compareInDay);
  return map;
}

/**
 * L'ordine dentro una giornata: prima ciò che richiede più attenzione.
 *
 * Le concluse in fondo: restano visibili — vedere che una cosa è stata fatta ha
 * valore — ma non davanti a ciò che c'è ancora da fare.
 */
export function compareInDay(a: CalendarTaskItem, b: CalendarTaskItem): number {
  const done = (t: CalendarTaskItem) => (t.status === 'completed' ? 1 : 0);
  if (done(a) !== done(b)) return done(a) - done(b);
  const rank = { high: 0, medium: 1, low: 2 } as const;
  if (rank[a.priority] !== rank[b.priority]) return rank[a.priority] - rank[b.priority];
  return a.title.localeCompare(b.title);
}

export interface AgendaGroup {
  date: string;
  items: CalendarTaskItem[];
}

/**
 * L'agenda: i giorni che hanno qualcosa, in ordine cronologico.
 *
 * I giorni vuoti non compaiono. Una lista che elenca «3 marzo — niente» per
 * ventotto righe di fila non è un'agenda: è rumore in cui si perde ciò che
 * c'è davvero.
 */
export function agendaGroups(items: CalendarTaskItem[]): AgendaGroup[] {
  const byDay = groupByDay(items);
  return [...byDay.entries()]
    .map(([date, list]) => ({ date, items: list }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Le scadute, secondo la STESSA definizione usata da Attività e Panoramica.
 *
 * ⚠️ Passa da `isOverdue` di `taskFormat` e non da un confronto scritto qui.
 * Una seconda definizione di «in ritardo» significherebbe che il pannello delle
 * scadute e la lista delle attività possono contraddirsi — e prima o poi lo
 * farebbero, la notte del cambio d'ora o a cavallo della mezzanotte.
 */
export function overdueItems(items: CalendarTaskItem[], today: Date = new Date()): CalendarTaskItem[] {
  return items
    .filter((t) => isOverdue({ dueDate: t.dueDate, status: t.status }, today))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/** Le attività che NON sono in ritardo: quelle che la griglia disegna nelle caselle. */
export function currentItems(items: CalendarTaskItem[], today: Date = new Date()): CalendarTaskItem[] {
  return items.filter((t) => !isOverdue({ dueDate: t.dueDate, status: t.status }, today));
}

/* ⚠️ `overdueByDays` NON VIVE PIÙ QUI, ed è stato tolto invece che lasciato.
   Contava i giorni di ritardo per una pastiglia rossa dello scadenziario, che
   ora porta il segno del TERMINE (`DeadlineMark`): quel componente il conto lo
   fa già, sulla stessa data e con gli stessi giorni di calendario. Tenerne due
   avrebbe voluto dire due aritmetiche delle scadenze — e con esse il giorno in
   cui una dice «da 1 giorno» e l'altra «scaduto ieri» per la stessa attività. */

/**
 * Quante attività mostrare in una casella del mese prima di riassumere il resto.
 *
 * Tre. Non è un numero scelto a caso: una casella di una griglia mensile su un
 * portatile è alta poco più di cento pixel, e la quarta riga o esce dal bordo o
 * costringe a rimpicciolire il testo sotto la soglia leggibile. Le altre si
 * dichiarano con «+N», che è un'informazione vera e cliccabile.
 */
export const MAX_PER_DAY = 3;

/** Il titolo abbreviato per una casella del mese, senza tagliare a metà una parola. */
export function shortTitle(title: string, max = 28): string {
  const clean = title.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
