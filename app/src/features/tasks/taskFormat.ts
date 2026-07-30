// ============================================================================
// Formattazione delle attività: funzioni PURE, senza React e senza rete.
//
// Stanno qui e non dentro i componenti perché sono decisioni di prodotto —
// quando una scadenza si chiama «Oggi», quando un'attività è in ritardo — e le
// decisioni di prodotto vanno provate. `npm run test:tasks` le esegue su casi
// noti, compresi quelli attorno alla mezzanotte, dove un conto sbagliato
// direbbe «Domani» a chi ha la scadenza oggi.
// ============================================================================
import type { TKey } from '@/i18n';
import type { ChecklistAction, Task, TaskEventKind, TaskStatus } from '@/types/models';

/**
 * Chiave di traduzione + parametri: il testo lo compone la schermata.
 * `TKey` e non `string`: una chiave inventata non compila, invece di comparire
 * grezza in pagina davanti a un cliente.
 */
export interface Phrase {
  key: TKey;
  params?: Record<string, string | number>;
}

/**
 * Giorni di calendario fra oggi e la scadenza, indipendenti dall'ora.
 *
 * `daysUntil` in `lib/format` divide i millisecondi, quindi alle 23:00 una
 * scadenza di domani mattina dista «0 giorni». Qui contano i giorni del
 * calendario, che è ciò che una persona intende quando legge «Domani».
 */
export function calendarDaysUntil(dueDate: string | null | undefined, today: Date = new Date()): number | null {
  if (!dueDate) return null;
  const due = new Date(dueDate);
  if (Number.isNaN(due.getTime())) return null;
  const a = Date.UTC(due.getUTCFullYear(), due.getUTCMonth(), due.getUTCDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86400000);
}

/** Come si legge una scadenza. Nessuna data inventata: senza scadenza si dice. */
export function dueLabel(dueDate: string | null | undefined, today: Date = new Date()): Phrase {
  const d = calendarDaysUntil(dueDate, today);
  if (d == null) return { key: 'tasks.dueNone' };
  if (d === 0) return { key: 'tasks.dueTodayShort' };
  if (d === 1) return { key: 'tasks.dueTomorrow' };
  if (d === -1) return { key: 'tasks.overdueOneDay' };
  if (d < 0) return { key: 'tasks.overdueDays', params: { n: Math.abs(d) } };
  return { key: 'tasks.dueInDays', params: { n: d } };
}

/** In ritardo: scaduta e non conclusa. Una conclusa non è più «in ritardo». */
export function isOverdue(task: Pick<Task, 'dueDate' | 'status'>, today: Date = new Date()): boolean {
  if (task.status === 'completed') return false;
  const d = calendarDaysUntil(task.dueDate, today);
  return d != null && d < 0;
}

export function statusLabelKey(status: TaskStatus): TKey {
  switch (status) {
    case 'open': return 'tasks.statusOpen';
    case 'in_progress': return 'tasks.statusInProgress';
    case 'waiting': return 'tasks.statusWaiting';
    case 'completed': return 'tasks.statusCompleted';
  }
}

export function sourceLabelKey(source: Task['source']): TKey {
  switch (source) {
    case 'admin_ai': return 'tasks.sourceAdminAi';
    case 'subsidy_ai': return 'tasks.sourceSubsidyAi';
    case 'manual': return 'tasks.sourceManual';
    // 0020 — creata da una regola aziendale. Non è «a mano» e non viene da un
    // modulo: chi la riceve ha diritto di sapere che non l'ha scritta nessuno.
    case 'workflow': return 'tasks.sourceWorkflow';
    // 0026 — nata da una controparte o da una trattativa: il «prossimo passo»
    // di un'opportunità che è diventato lavoro assegnabile (§50).
    case 'crm': return 'tasks.sourceCrm';
  }
}

export function eventLabelKey(kind: TaskEventKind): TKey {
  switch (kind) {
    case 'created': return 'tasks.eventCreated';
    case 'status_changed': return 'tasks.eventStatusChanged';
    case 'assignee_changed': return 'tasks.eventAssigneeChanged';
    case 'priority_changed': return 'tasks.eventPriorityChanged';
    case 'due_date_changed': return 'tasks.eventDueDateChanged';
    case 'completed': return 'tasks.eventCompleted';
    case 'reopened': return 'tasks.eventReopened';
    case 'archived': return 'tasks.eventArchived';
    case 'restored': return 'tasks.eventRestored';
    case 'checklist_item_completed': return 'tasks.eventChecklistItemCompleted';
    case 'comment_added': return 'tasks.eventCommentAdded';
  }
}

/**
 * L'ordine con cui la lista risponde a «cosa richiede attenzione».
 *
 * Lo stesso criterio della funzione SQL `list_tasks`: prima le scadute, poi la
 * priorità alta, poi la scadenza più vicina, in fondo quelle senza scadenza. Qui
 * serve per gli elenchi già in memoria — la Home, che lavora su poche righe — e
 * il fatto che sia scritto due volte è deliberato: il database ordina la
 * paginazione, questa funzione ordina ciò che è già stato caricato. Se i due
 * criteri divergessero, il test se ne accorgerebbe.
 */
const PRIORITY_RANK: Record<Task['priority'], number> = { high: 0, medium: 1, low: 2 };

export function compareTasks(a: Task, b: Task, today: Date = new Date()): number {
  const ao = isOverdue(a, today) ? 0 : 1;
  const bo = isOverdue(b, today) ? 0 : 1;
  if (ao !== bo) return ao - bo;

  const ap = PRIORITY_RANK[a.priority];
  const bp = PRIORITY_RANK[b.priority];
  if (ap !== bp) return ap - bp;

  const ad = calendarDaysUntil(a.dueDate, today);
  const bd = calendarDaysUntil(b.dueDate, today);
  if (ad == null && bd != null) return 1;
  if (ad != null && bd == null) return -1;
  if (ad != null && bd != null && ad !== bd) return ad - bd;

  return b.createdAt.localeCompare(a.createdAt);
}

export function sortTasks<T extends Task>(tasks: T[], today: Date = new Date()): T[] {
  return [...tasks].sort((a, b) => compareTasks(a, b, today));
}

/**
 * I passaggi di un'attività nata da un'analisi Admin AI.
 *
 * Regola, e le ragioni di ognuna:
 *   · si copiano solo le azioni ancora APERTE — ricopiare come «da fare» una
 *     cosa già fatta è falso;
 *   · quelle già completate restano dove sono, nell'analisi, con la loro data e
 *     il loro autore veri: copiarle «già spuntate» farebbe riscrivere al trigger
 *     chi e quando con l'utente e l'ora di adesso;
 *   · si salta l'azione che coincide con il titolo, perché il titolo la dice
 *     già e un primo passaggio identico all'intestazione è rumore;
 *   · si scartano i testi vuoti, che il database rifiuterebbe comunque.
 *
 * È una DERIVAZIONE UNA TANTUM: dopo la creazione le due liste non si inseguono.
 */
export function stepsFromActions(actions: ChecklistAction[], title: string): string[] {
  const normalizedTitle = title.trim().toLowerCase();
  return actions
    .filter((a) => !a.done)
    .map((a) => a.text.trim())
    .filter((text) => text.length > 0 && text.toLowerCase() !== normalizedTitle);
}
