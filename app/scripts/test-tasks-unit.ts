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
  calendarDaysUntil, compareTasks, dueLabel, eventLabelKey, isOverdue, taskDateKind,
  sortTasks, sourceLabelKey, statusLabelKey, stepsFromActions,
} from '../src/features/tasks/taskFormat';
import {
  EMPTY_TASK_FORM, canSubmitTaskForm, createSubmitLatch, effectivePriority, proposedPriority,
  safeDatePrefill, taskFormSubmission, type TaskFormValues,
} from '../src/features/tasks/taskCreateModel';
import type { ChecklistAction, Task, TaskEventKind, TaskSource, TaskStatus } from '../src/types/models';

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
  dueDate: null, appointmentDate: null, priority: 'medium', status: 'open', source: 'manual',
  assigneeUserId: null, completedAt: null, completedBy: null,
  archivedAt: null, archivedBy: null,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
  workflowRunId: null,
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

  // ⚠️⚠️ UN APPUNTAMENTO PASSATO NON È UN RITARDO. Il sopralluogo del Comune di
  // Lugano si è tenuto o no: in nessuno dei due casi l'azienda ha «mancato un
  // termine», perché quel termine non è mai stato scritto da nessuno. Se questa
  // cadesse, la data dell'evento sarebbe tornata a comportarsi come una
  // scadenza — con un nome nuovo e lo stesso difetto.
  ok(!isOverdue(task({ dueDate: null, appointmentDate: '2026-03-01' }), today),
    'un APPUNTAMENTO passato non mette in ritardo: non era un termine');
  ok(dueLabel(task({ dueDate: null, appointmentDate: '2026-03-01' }).dueDate).key === 'tasks.dueNone',
    'e la frase del termine continua a dire «nessuna scadenza», perché è vero');
}

// ===========================================================================
section('3-bis · Quale data occupa lo slot della riga');
// ===========================================================================
{
  ok(taskDateKind(task({ dueDate: '2026-03-11', appointmentDate: null })) === 'deadline',
    'con un termine si mostra il termine');
  ok(taskDateKind(task({ dueDate: null, appointmentDate: '2026-09-10' })) === 'appointment',
    'senza termine ma con un appuntamento si mostra l’appuntamento — «Nessuna scadenza» sarebbe monco');
  // ⚠️ LA COPPIA che tiene l'ordine: quando ci sono ENTRAMBE vince il termine,
  // perché è la data che obbliga. L'appuntamento resta nel dettaglio.
  ok(taskDateKind(task({ dueDate: '2026-03-11', appointmentDate: '2026-09-10' })) === 'deadline',
    'con tutte e due vince il TERMINE: è l’unica che obbliga');
  ok(taskDateKind(task({ dueDate: null, appointmentDate: null })) === 'deadline',
    'senza nessuna delle due resta lo slot del termine, che dirà «nessuna scadenza»');
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
  // «tasks» e «.» separati: il letterale unito finisce in punto, e per
  // `i18n:orphans` un token così copre l'INTERA sezione tasks.* — cieca.
  ok(statuses.every((s) => statusLabelKey(s).startsWith('tasks' + '.')),
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
section('6 · Dall’analisi Admin AI ai passaggi dell’attività');
// ===========================================================================
// La conversione copia le azioni UNA VOLTA. Le regole qui sotto esistono per
// non scrivere cose false nell'attività: un'azione già fatta ricopiata come «da
// fare» direbbe che c'è del lavoro che invece è concluso.
{
  const action = (over: Partial<ChecklistAction>): ChecklistAction => ({
    id: over.id ?? 1, text: over.text ?? 'Fare qualcosa', done: over.done ?? false,
    sourceType: 'extracted', evidence: null,
  });

  const actions = [
    action({ id: 1, text: 'Trasmettere il rendiconto', done: false }),
    action({ id: 2, text: 'Allegare i giustificativi', done: false }),
    action({ id: 3, text: 'Verificare i totali', done: true }),
    action({ id: 4, text: '   ', done: false }),
  ];

  const steps = stepsFromActions(actions, 'Trasmettere rendiconto IVA');
  ok(steps.length === 2, 'si copiano solo le azioni aperte e non vuote', `ottenuto: ${JSON.stringify(steps)}`);
  ok(!steps.includes('Verificare i totali'),
    'un’azione GIÀ COMPLETATA non torna come passaggio da fare: sarebbe una falsità, e la sua data e il suo autore veri restano nell’analisi');
  ok(!steps.some((s) => s.trim() === ''), 'i testi vuoti non diventano passaggi');

  const withTitle = stepsFromActions(
    [action({ text: 'Trasmettere rendiconto IVA' }), action({ id: 2, text: 'Altro passaggio' })],
    'Trasmettere rendiconto IVA',
  );
  ok(withTitle.length === 1 && withTitle[0] === 'Altro passaggio',
    'l’azione che coincide con il titolo non si ripete come primo passaggio');

  const caseInsensitive = stepsFromActions([action({ text: 'trasmettere RENDICONTO iva' })], 'Trasmettere rendiconto IVA');
  ok(caseInsensitive.length === 0, 'il confronto col titolo non si fa ingannare dalle maiuscole');

  ok(stepsFromActions([], 'Titolo').length === 0, 'nessuna azione, nessun passaggio: non se ne inventano');
  ok(stepsFromActions([action({ done: true })], 'Titolo').length === 0,
    'se tutte le azioni sono già fatte, l’attività nasce senza passaggi invece che con passaggi finti');
}

// ===========================================================================
section('7 · Il modulo di creazione è UNO SOLO — le regole che l’estrazione non deve cambiare');
// ⚠️ PERCHÉ QUESTA SEZIONE ESISTE. Il modulo di creazione viveva dentro
// `TasksPage`; portarlo anche nel dettaglio di un documento significava o
// duplicarlo o estrarlo. È stato estratto, e queste asserzioni sono la prova
// che l'estrazione non ha cambiato le quattro cose che l'elenco Attività
// faceva già: data precompilata dal Calendario, priorità proposta dalla
// scadenza, scelta del responsabile, e un titolo vuoto che non salva niente.
// Nessun test poteva vederle prima: stavano dentro un componente, e le suite
// di questo repository sono script Node senza DOM.
{
  // Un istante fisso: `priorityFromDueDate` leggeva l'orologio da sé e non si
  // sarebbe potuta provare su una distanza scelta — è il difetto già pagato
  // dalla sezione 9 di `test:workflows-unit`.
  const adesso = new Date('2026-08-01T12:00:00Z');

  // -- la data che arriva dal Calendario ------------------------------------
  ok(safeDatePrefill('2026-08-12') === '2026-08-12',
    'una data ben formata dall’URL precompila la scadenza: è il percorso del Calendario (§17)');
  ok(safeDatePrefill('oggi') === '', 'un valore arbitrario dall’URL NON entra in un campo che poi viene salvato');
  ok(safeDatePrefill('2026-8-12') === '', 'nemmeno una data quasi giusta: la forma è una sola');
  ok(safeDatePrefill(null) === '' && safeDatePrefill(undefined) === '',
    'senza parametro il campo resta vuoto, non «oggi»');
  ok(safeDatePrefill("2026-08-12'); drop table tasks;--") === '',
    'un valore ostile dall’URL non passa');

  // -- la priorità proposta segue la scadenza -------------------------------
  ok(proposedPriority('2026-08-05', adesso) === 'high', 'entro dieci giorni la priorità proposta è alta');
  ok(proposedPriority('2026-08-25', adesso) === 'medium', 'entro trenta giorni è media');
  ok(proposedPriority('2026-12-01', adesso) === 'low', 'più in là è bassa');
  ok(proposedPriority('', adesso) === 'low', 'senza scadenza è bassa, e non si inventa una data');

  // -- ma la scelta della persona vince, e non viene più sovrascritta --------
  const scelta: TaskFormValues = { ...EMPTY_TASK_FORM, title: 'X', dueDate: '2026-08-05', priority: 'low' };
  ok(effectivePriority(scelta, adesso) === 'low',
    '⚠️ scelta la priorità, la proposta NON la sovrascrive più: da quel momento la decisione è della persona');
  ok(effectivePriority({ ...scelta, priority: '' }, adesso) === 'high',
    'finché non sceglie, vale la proposta');
  ok(taskFormSubmission({ ...scelta, priority: '' }, adesso).priority === 'high',
    '⚠️ il valore MOSTRATO è il valore SALVATO: la proposta arriva al database, non resta a schermo');

  // -- il confine fra «vuoto» e `null` --------------------------------------
  const vuoto = taskFormSubmission({ ...EMPTY_TASK_FORM, title: 'Solo titolo' }, adesso);
  ok(vuoto.dueDate === null, 'una scadenza non compilata diventa `null`, non la stringa vuota');
  ok(vuoto.assigneeUserId === null, 'nessun responsabile diventa `null`: «non assegnata» è un dato, non un vuoto');
  const conResponsabile = taskFormSubmission(
    { ...EMPTY_TASK_FORM, title: 'X', assigneeUserId: 'u-1' }, adesso,
  );
  ok(conResponsabile.assigneeUserId === 'u-1', 'il responsabile scelto arriva al servizio');

  // -- titolo vuoto e doppio invio ------------------------------------------
  ok(!canSubmitTaskForm(EMPTY_TASK_FORM, false), 'senza titolo non si salva');
  ok(!canSubmitTaskForm({ ...EMPTY_TASK_FORM, title: '   ' }, false),
    'un titolo di soli spazi non è un titolo');
  ok(canSubmitTaskForm({ ...EMPTY_TASK_FORM, title: 'Pagare l’IVA' }, false), 'con un titolo si salva');
  ok(!canSubmitTaskForm({ ...EMPTY_TASK_FORM, title: 'Pagare l’IVA' }, true),
    'mentre salva il pulsante non è premibile');

  // -- il doppio invio, e perché il pulsante disabilitato NON basta ----------
  // ⚠️⚠️ QUESTO CONTROLLO NASCE DA UN DIFETTO VERO, trovato premendo due volte
  //     nel browser il 2026-07-31: sono state create DUE attività identiche a
  //     14 millisecondi di distanza sul database di produzione. `saving` è uno
  //     stato React, e due clic nello stesso tick lo leggono ENTRAMBI a
  //     `false` — la resa nuova arriva dopo. Il fermo deve cambiare
  //     nell'istante del primo clic, e per questo è una variabile e non uno stato.
  {
    const latch = createSubmitLatch();
    ok(latch.tryAcquire(), 'il primo invio passa');
    ok(!latch.tryAcquire(),
      '⚠️ il SECONDO invio nello stesso istante NON passa: è qui che si ferma il doppio clic');
    ok(!latch.tryAcquire(), 'e nemmeno il terzo');
    latch.release();
    ok(latch.tryAcquire(), 'finito il salvataggio si può inviare di nuovo — anche dopo un errore');
  }
  {
    // Due moduli aperti (elenco Attività e dettaglio Documento) hanno fermi
    // DIVERSI: uno non deve bloccare l'altro.
    const a = createSubmitLatch();
    const b = createSubmitLatch();
    a.tryAcquire();
    ok(b.tryAcquire(), 'due moduli diversi non si bloccano a vicenda');
  }
}

// ===========================================================================
console.log(`\n${B}Riepilogo${X}  ${G}${pass} superati${X}${fail ? `  ${R}${fail} falliti${X}` : ''}\n`);
process.exit(fail ? 1 : 0);
