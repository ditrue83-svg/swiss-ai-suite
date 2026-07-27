// ============================================================================
// AI-Swisse — Attività (Work Hub): test DETERMINISTICI, offline.
//   npm run test:tasks-unit
//
// Coprono le decisioni di prodotto che si possono sbagliare in silenzio:
//   1. quando una scadenza si chiama «Oggi», «Domani», «Scaduta da N giorni»;
//   2. cosa è in ritardo e cosa no;
//   3. l'ordine con cui la lista risponde a «cosa richiede attenzione»;
//   4. che ogni stato, origine ed evento abbia la sua etichetta — un valore
//      senza etichetta comparirebbe grezzo in pagina.
//
// Nessuna rete, nessuna credenziale: sono regole, e le regole si provano.
// ============================================================================
import {
  calendarDaysUntil, compareTasks, dueLabel, eventLabelKey, isOverdue,
  sortTasks, sourceLabelKey, statusLabelKey,
} from '../src/features/tasks/taskFormat';
import type { Task, TaskEventKind, TaskSource, TaskStatus } from '../src/types/models';

let pass = 0, fail = 0;
const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';
const ok = (cond: boolean, label: string, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${label}`); }
  else { fail++; console.log(`  ${R}✗ ${label}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

const task = (over: Partial<Task> = {}): Task => ({
  id: over.id ?? 'x', companyId: 'c', createdBy: null, documentId: null, subsidyCaseId: null,
  title: over.title ?? 'Attività', description: null, authority: null,
  dueDate: null, priority: 'medium', status: 'open', source: 'manual',
  assigneeUserId: null, completedAt: null, completedBy: null,
  archivedAt: null, archivedBy: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  ...over,
});

// ===========================================================================
section('1 · Giorni di calendario, non millisecondi');
// ===========================================================================
// Il caso che rompe le implementazioni ingenue: sono le 23:30 e la scadenza è
// domani. Dividendo i millisecondi si ottiene «0 giorni» e l'interfaccia dice
// «Oggi» a chi ha tempo fino a domani.
{
  const lateEvening = new Date('2026-03-10T23:30:00');
  ok(calendarDaysUntil('2026-03-11', lateEvening) === 1,
    'alle 23:30, una scadenza di domani dista UN giorno (non zero)',
    `ottenuto: ${calendarDaysUntil('2026-03-11', lateEvening)}`);
  ok(calendarDaysUntil('2026-03-10', lateEvening) === 0, 'la scadenza di oggi dista zero giorni');
  ok(calendarDaysUntil('2026-03-09', lateEvening) === -1, 'ieri è meno uno');
  const earlyMorning = new Date('2026-03-10T00:10:00');
  ok(calendarDaysUntil('2026-03-10', earlyMorning) === 0, 'alle 00:10 la scadenza di oggi è ancora oggi');
  ok(calendarDaysUntil(null) === null, 'senza scadenza non si inventa un numero');
  ok(calendarDaysUntil('non-una-data') === null, 'una data illeggibile non diventa zero');
}

// ===========================================================================
section('2 · Come si legge una scadenza');
// ===========================================================================
{
  const today = new Date('2026-03-10T09:00:00');
  ok(dueLabel(null).key === 'tasks.dueNone', 'nessuna scadenza lo dice, invece di mostrare una data vuota');
  ok(dueLabel('2026-03-10', today).key === 'tasks.dueTodayShort', 'oggi');
  ok(dueLabel('2026-03-11', today).key === 'tasks.dueTomorrow', 'domani');
  ok(dueLabel('2026-03-15', today).key === 'tasks.dueInDays' && dueLabel('2026-03-15', today).params?.n === 5,
    'fra cinque giorni');
  ok(dueLabel('2026-03-09', today).key === 'tasks.overdueOneDay',
    'scaduta da un giorno ha una frase propria: «da 1 giorni» è sbagliato in italiano');
  const late = dueLabel('2026-03-08', today);
  ok(late.key === 'tasks.overdueDays' && late.params?.n === 2, 'scaduta da due giorni');
}

// ===========================================================================
section('3 · In ritardo');
// ===========================================================================
{
  const today = new Date('2026-03-10T09:00:00');
  ok(isOverdue(task({ dueDate: '2026-03-09' }), today), 'aperta e scaduta ieri: in ritardo');
  ok(!isOverdue(task({ dueDate: '2026-03-11' }), today), 'aperta e in scadenza domani: non in ritardo');
  ok(!isOverdue(task({ dueDate: '2026-03-09', status: 'completed' }), today),
    'COMPLETATA e scaduta: NON è in ritardo — il lavoro è fatto, e segnalarlo in rosso sarebbe un falso allarme');
  ok(!isOverdue(task({ dueDate: null }), today), 'senza scadenza non si è in ritardo');
  ok(isOverdue(task({ dueDate: '2026-03-09', status: 'waiting' }), today),
    'in attesa di terzi ma scaduta: resta in ritardo, perché il termine è passato comunque');
}

// ===========================================================================
section('4 · L’ordine risponde a «cosa richiede attenzione»');
// ===========================================================================
{
  const today = new Date('2026-03-10T09:00:00');
  const scaduta      = task({ id: 'scaduta', dueDate: '2026-03-01', priority: 'low' });
  const altaLontana  = task({ id: 'alta',    dueDate: '2026-04-20', priority: 'high' });
  const mediaVicina  = task({ id: 'media',   dueDate: '2026-03-12', priority: 'medium' });
  const senzaData    = task({ id: 'nodate',  dueDate: null,         priority: 'high' });

  const order = sortTasks([senzaData, mediaVicina, altaLontana, scaduta], today).map((t) => t.id);
  ok(order[0] === 'scaduta',
    'una scaduta viene prima di tutto, anche se è a priorità bassa: il termine è già passato',
    `ordine: ${order.join(' → ')}`);
  ok(order.indexOf('alta') < order.indexOf('media'),
    'a parità di ritardo la priorità alta precede la media, anche se scade più tardi');
  // ⚠️ Qui il primo tentativo di questo test asseriva che «senza scadenza»
  // finisse ULTIMA in assoluto. È falso, e per fortuna il test l'ha detto: la
  // priorità è il secondo criterio, la data il terzo, quindi un'attività ad
  // alta priorità senza scadenza precede una media che scade domani. «In
  // fondo» vale DENTRO il proprio gruppo di priorità — che è anche ciò che fa
  // la funzione SQL `list_tasks` con `due_date asc nulls last`.
  ok(order.indexOf('nodate') < order.indexOf('media'),
    'alta priorità senza scadenza precede comunque una media con scadenza vicina',
    `ordine: ${order.join(' → ')}`);

  const altaConData = task({ id: 'alta-data', dueDate: '2026-03-20', priority: 'high' });
  const duePriorita = sortTasks([senzaData, altaConData], today).map((t) => t.id);
  ok(duePriorita[0] === 'alta-data' && duePriorita[1] === 'nodate',
    'fra due attività ad alta priorità, quella CON scadenza viene prima di quella senza',
    `ordine: ${duePriorita.join(' → ')}`);

  // Deterministico: lo stesso insieme, in qualunque ordine di partenza, dà lo
  // stesso risultato. Senza questa proprietà la lista «si muove» fra un
  // caricamento e l'altro e nessuno si fida più di ciò che vede.
  const a = sortTasks([scaduta, altaLontana, mediaVicina, senzaData], today).map((t) => t.id).join();
  const b = sortTasks([senzaData, scaduta, mediaVicina, altaLontana], today).map((t) => t.id).join();
  ok(a === b, 'l’ordine non dipende da come le righe arrivano dal database', `${a} ≠ ${b}`);

  ok(compareTasks(scaduta, scaduta, today) === 0, 'un’attività confrontata con sé stessa non si sposta');
}

// ===========================================================================
section('5 · Ogni valore ha la sua etichetta');
// ===========================================================================
// Un enum esteso senza aggiornare le etichette mostrerebbe il valore tecnico
// («in_progress») in pagina. Qui si controlla che la mappatura sia completa.
{
  const statuses: TaskStatus[] = ['open', 'in_progress', 'waiting', 'completed'];
  ok(statuses.every((s) => statusLabelKey(s).startsWith('tasks.')),
    'ogni stato ha un’etichetta tradotta, compresi i due nuovi');
  ok(new Set(statuses.map(statusLabelKey)).size === statuses.length,
    'due stati diversi non condividono la stessa etichetta');

  const sources: TaskSource[] = ['manual', 'admin_ai', 'subsidy_ai'];
  ok(sources.every((s) => sourceLabelKey(s).startsWith('tasks.source')), 'ogni origine ha la sua etichetta');

  const kinds: TaskEventKind[] = [
    'created', 'status_changed', 'assignee_changed', 'priority_changed', 'due_date_changed',
    'completed', 'reopened', 'archived', 'restored', 'checklist_item_completed', 'comment_added',
  ];
  ok(kinds.every((k) => eventLabelKey(k).startsWith('tasks.event')), 'ogni evento dello storico è raccontabile');
  ok(new Set(kinds.map(eventLabelKey)).size === kinds.length, 'due eventi diversi non si raccontano allo stesso modo');
}

// ===========================================================================
console.log(`\n${B}Riepilogo${X}  ${G}${pass} superati${X}${fail ? `  ${R}${fail} falliti${X}` : ''}\n`);
process.exit(fail ? 1 : 0);
