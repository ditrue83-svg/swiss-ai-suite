// ============================================================================
// Lo STATO DESIDERATO di un evento, e il contenuto che lo rappresenta.
//
// È la funzione più importante di tutto il modulo, e per questo è PURA: nessuna
// rete, nessun database, nessun orologio. Riceve un'attività e una connessione e
// dice se l'evento deve esistere — e quando non deve, dice PERCHÉ.
//
// Il «perché» non è un lusso da registro. Se `getCalendarDesiredState`
// restituisse un booleano, un test potrebbe dire soltanto «l'evento non c'è» e
// non saprebbe distinguere «l'attività è stata completata» da «la connessione è
// da ricollegare»: due situazioni che portano allo stesso esito e a due
// comportamenti opposti del worker — la prima cancella l'evento, la seconda non
// deve toccare niente perché non ha un token valido.
//
// TUTTA la logica «l'evento c'è oppure no» vive qui. Il worker non ha nessun
// `if`: chiama questa funzione e obbedisce. È l'unico modo perché §109 sia
// verificabile davvero — un caso limite si prova qui, offline, in un
// millisecondo, invece che contro due API esterne.
//
// Modulo PORTABILE: nessuna API Deno.
// ============================================================================
import { sha256Hex } from '../email/crypto.ts';
import { st, type ServerLocale } from './i18n.ts';
import { TASK_METADATA_KEY } from './contract.ts';

// ---- Ingressi minimi --------------------------------------------------------
// Deliberatamente più poveri delle righe del database: questa funzione non deve
// poter guardare la descrizione, la checklist o l'analisi collegata. Ciò che non
// le viene passato non può finire nel calendario di nessuno.

export interface DesiredStateTask {
  id: string;
  companyId: string;
  title: string;
  /** `YYYY-MM-DD` oppure null. Una DATA, mai un istante (§8). */
  dueDate: string | null;
  status: 'open' | 'in_progress' | 'waiting' | 'completed';
  priority: 'low' | 'medium' | 'high';
  assigneeUserId: string | null;
  archivedAt: string | null;
}

export interface DesiredStateConnection {
  id: string;
  companyId: string;
  userId: string;
  status: 'active' | 'reauth_required' | 'error' | 'disconnected';
  syncEnabled: boolean;
}

/**
 * `present`  — l'evento deve esistere ed essere allineato al contenuto.
 * `absent`   — l'evento non deve esistere: se c'è, si cancella.
 * `untouchable` — non si sa e non si può agire: la connessione non è in grado
 *                 di parlare con il provider. NON è `absent`, ed è la
 *                 distinzione che salva gli eventi di chi deve solo
 *                 riautorizzare: trattare «non posso scrivere» come «non deve
 *                 esserci» svuoterebbe il calendario di una persona per un token
 *                 scaduto.
 */
export type DesiredState =
  | { kind: 'present' }
  | {
      kind: 'absent';
      reason: 'no_due_date' | 'completed' | 'archived' | 'not_assignee' | 'wrong_company' | 'sync_disabled';
    }
  | { kind: 'untouchable'; reason: 'connection_reauth' | 'connection_error' | 'connection_disconnected' };

/**
 * L'evento deve esistere quando TUTTE queste cose sono vere insieme:
 * l'attività è di questa azienda, ha una scadenza, non è conclusa, non è
 * archiviata, ed è assegnata proprio alla persona di questa connessione.
 * Qualunque altro caso: non deve esistere.
 *
 * L'ordine dei controlli non è casuale. Prima l'appartenenza (un'attività di
 * un'altra azienda non deve nemmeno essere valutata, §87), poi lo stato della
 * connessione (se non si può scrivere, non si conclude nulla sull'evento),
 * poi le proprietà dell'attività.
 */
export function getCalendarDesiredState(
  task: DesiredStateTask,
  connection: DesiredStateConnection,
): DesiredState {
  // §87 — un'attività che non appartiene all'azienda della connessione non può
  // comparire su quel calendario, qualunque cosa dica il resto.
  if (task.companyId !== connection.companyId) {
    return { kind: 'absent', reason: 'wrong_company' };
  }

  if (connection.status === 'reauth_required') return { kind: 'untouchable', reason: 'connection_reauth' };
  if (connection.status === 'error')           return { kind: 'untouchable', reason: 'connection_error' };
  if (connection.status === 'disconnected')    return { kind: 'untouchable', reason: 'connection_disconnected' };

  // La sincronizzazione spenta è una scelta della persona, non un guasto: gli
  // eventi già scritti si RIMUOVONO, perché altrimenti resterebbero fermi su un
  // calendario a raccontare una scadenza che nessuno aggiorna più.
  if (!connection.syncEnabled) return { kind: 'absent', reason: 'sync_disabled' };

  if (task.assigneeUserId !== connection.userId) return { kind: 'absent', reason: 'not_assignee' };
  if (task.archivedAt) return { kind: 'absent', reason: 'archived' };
  if (task.status === 'completed') return { kind: 'absent', reason: 'completed' };
  if (!task.dueDate) return { kind: 'absent', reason: 'no_due_date' };

  return { kind: 'present' };
}

// ---- Identificativo deterministico dell'evento ------------------------------

/**
 * La chiave dell'evento, derivata da (attività, connessione).
 *
 * Su Google diventa l'identificativo dell'evento, e l'API impone un alfabeto
 * preciso: «i caratteri usati nella codifica base32hex, cioè le lettere
 * minuscole da a a v e le cifre da 0 a 9», fra 5 e 1024 caratteri. Uno SHA-256
 * in esadecimale usa solo `0-9a-f`, che è un sottoinsieme: va bene così com'è,
 * senza ricodifiche da sbagliare. Il prefisso `ais` è dentro l'alfabeto —
 * «aiswisse» non lo sarebbe, perché la `w` viene dopo la `v`.
 *
 * Perché comprende la CONNESSIONE e non solo l'attività: la stessa attività può
 * finire sul calendario di Google di Andrea e su quello di Microsoft di Andrea,
 * e due eventi diversi devono avere due chiavi diverse.
 */
export async function eventKeyFor(taskId: string, connectionId: string): Promise<string> {
  const digest = await sha256Hex(`${taskId}:${connectionId}`);
  return `ais${digest}`;
}

/** Vero se la chiave rispetta l'alfabeto che Google impone agli identificativi. */
export function isValidGoogleEventId(id: string): boolean {
  return /^[a-v0-9]{5,1024}$/.test(id);
}

// ---- Contenuto dell'evento --------------------------------------------------

export interface EventContentInput {
  task: Pick<DesiredStateTask, 'id' | 'title' | 'dueDate' | 'priority'>;
  companyName: string;
  /** URL canonico dell'applicazione, deciso dal SERVER (§88). */
  appOrigin: string;
  locale: ServerLocale;
  /** §96 — quando è falso, il titolo vero non lascia AI-Swisse. */
  showTitle: boolean;
}

/**
 * Titolo e descrizione dell'evento esterno.
 *
 * QUELLO CHE NON C'È DENTRO, ed è la parte importante (§95):
 * niente importi, niente IBAN, niente mittente, niente testo del documento,
 * niente corpo dell'email da cui l'attività è nata, niente citazioni
 * dell'analisi, nessun URL firmato verso un file. Un calendario si condivide
 * con un assistente, si sincronizza su un telefono aziendale e finisce nelle
 * notifiche della schermata di blocco: è il posto meno protetto in cui questi
 * dati potrebbero arrivare.
 *
 * Resta il titolo dell'attività — che è ciò che rende l'evento utile — e chi
 * non lo vuole lo spegne, ottenendo un evento generico invece di nessun evento.
 */
export function buildEventContent(input: EventContentInput): { title: string; description: string } {
  const { task, companyName, appOrigin, locale, showTitle } = input;

  const title = showTitle && task.title.trim()
    ? task.title.trim().slice(0, 250)
    : st(locale, 'eventGenericTitle');

  const priorityLabel = st(
    locale,
    task.priority === 'high' ? 'priorityHigh' : task.priority === 'medium' ? 'priorityMedium' : 'priorityLow',
  );

  const description = [
    st(locale, 'eventIntro'),
    st(locale, 'eventCompany', { company: companyName }),
    st(locale, 'eventPriority', { priority: priorityLabel }),
    st(locale, 'eventOpen', { url: `${appOrigin.replace(/\/$/, '')}/attivita/${task.id}` }),
  ].join('\n');

  return { title, description };
}

/**
 * Impronta di ciò che è stato scritto presso il provider.
 *
 * Serve a non riscrivere un evento identico a ogni riconciliazione: senza,
 * un controllo periodico su cinquanta attività sarebbe cinquanta chiamate
 * all'API ogni volta, per confermare che niente è cambiato.
 *
 * Comprende il calendario: se l'utente cancella il calendario dedicato e ne
 * creiamo un altro, l'impronta cambia e tutti gli eventi vengono riscritti là —
 * che è esattamente quello che serve.
 */
export async function eventContentHash(input: {
  calendarId: string; title: string; description: string; date: string;
}): Promise<string> {
  return await sha256Hex(
    JSON.stringify([input.calendarId, input.title, input.description, input.date]),
  );
}

/** I metadati applicativi scritti sull'evento: solo l'id dell'attività (§60). */
export function eventMetadata(taskId: string): Record<string, string> {
  return { [TASK_METADATA_KEY]: taskId };
}

/**
 * Il giorno successivo, in `YYYY-MM-DD`.
 *
 * Serve a entrambi i provider e per la stessa ragione: la fine di un evento di
 * giornata intera è ESCLUSIVA. Google lo dice esplicitamente («the (exclusive)
 * end time of the event») e Microsoft lo ottiene chiedendo due mezzanotti nello
 * stesso fuso. Un evento che finisce lo stesso giorno in cui comincia è un
 * evento di durata zero, e i due provider lo mostrano in modi diversi e
 * ugualmente sbagliati.
 *
 * L'aritmetica è in UTC perché `YYYY-MM-DD` è una data di calendario e non un
 * istante: usare il fuso locale del server farebbe scivolare il giorno.
 */
export function nextDay(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) throw new Error(`data non valida: ${day}`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
