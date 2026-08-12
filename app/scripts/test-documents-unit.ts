// ============================================================================
// AI-Swisse — Documenti (Smart Document Hub): test DETERMINISTICI, offline.
//   npm run test:documents-unit
//
// Coprono le decisioni che si possono sbagliare in silenzio:
//   1. lo STATO che una persona legge — la differenza fra «non riuscita»,
//      «non ancora analizzato» e «in elaborazione», che sono tre cose diverse
//      e vengono spesso confuse in una sola;
//   2. gli argomenti della ricerca — una ricerca vuota NON è un filtro;
//   3. l'estratto di ricerca, che deve produrre TESTO e mai markup;
//   4. i filtri nell'indirizzo e ritorno, perché il tasto indietro funzioni;
//   5. le etichette, dove «IVA» e «iva» devono essere la stessa cosa;
//   6. quali documenti finiscono in Panoramica: solo quelli che richiedono
//      attenzione.
//
// Nessuna rete, nessuna credenziale. Ciò che dipende dal database — ricerca
// full-text, isolamento fra aziende, conteggi, classificazione automatica — si
// prova contro il database vero con `npm run test:documents`: provarlo con un
// finto vorrebbe dire provare il finto.
// ============================================================================
import {
  CATEGORIES, DOCUMENTS_PAGE_SIZE, MAX_QUERY_LENGTH, SORTS, SOURCES, STATES,
  filtersFromParams, findExistingTag, hasActiveFilters, isStrongTone, needsAttention,
  normalizeTagName, paramsFromFilters, rowBadgeTones, sameTagName, splitSnippet, stateOf,
  toListArgs,
} from '../src/features/documents/documentModel';
import { it } from '../src/i18n/locales/it';
import { de } from '../src/i18n/locales/de';
import { fr } from '../src/i18n/locales/fr';
import { nextStepFor } from '../src/features/documents/nextStep';
import { titoloDocumento, nomeFileInformativo } from '../src/lib/documentTitle';
import { documentTaskDraft, runCreateFromDocument } from '../src/features/tasks/documentToTask';
import type {
  ChecklistAction, DocumentAnalysis, DocumentDetail, DocumentHubFilters, DocumentHubItem,
  DocumentLinkedTask, Task,
} from '../src/types/models';

let pass = 0, fail = 0;
const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';
const ok = (cond: boolean, label: string, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${label}`); }
  else { fail++; console.log(`  ${R}✗ ${label}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

const item = (over: Partial<DocumentHubItem> = {}): DocumentHubItem => ({
  id: 'd1', title: 'Documento', originalFilename: null, mimeType: null, fileSize: null,
  storagePath: null, sourceType: 'upload', status: 'completed', pageCount: null,
  createdAt: '2026-01-01T00:00:00Z', archivedAt: null, category: null, categorySource: null,
  state: 'analyzed', analysisId: 'a1', lastAttemptFailed: false, errorCode: null,
  documentType: null, documentTypeCorrected: false, sender: null, senderCorrected: false,
  senderAuthorityType: null, documentDate: null, deadline: null, deadlineCorrected: false,
  deadlineRequiresVerification: false, amount: null, amountCurrency: null, amountCorrected: false,
  confidence: null, tags: [], openTaskCount: 0, taskCount: 0, emailCount: 0, snippet: null,
  ...over,
});

console.log(`${B}AI-Swisse — Documenti: regole verificabili offline${X}`);

// ===========================================================================
section('1 · Lo stato che una persona legge');
// ===========================================================================
// Un'analisi FALLITA non è un documento analizzato: non ha mittente, non ha
// tipo, non ha scadenza. Descriverla come le altre significherebbe spacciare
// l'assenza di dati per un risultato — il difetto che questo progetto ha già
// pagato con la coda dell'Inbox.
ok(stateOf('failed', 'failed') === 'failed', 'un\'analisi fallita resta «non riuscita»');
ok(stateOf('failed', 'completed') === 'failed',
  'lo stato lo decide l\'ULTIMO tentativo, anche se il documento risulta completato');
ok(stateOf('needs_review', 'needs_review') === 'to_verify', 'needs_review diventa «da verificare»');
ok(stateOf('completed', 'completed') === 'analyzed', 'completed diventa «analizzato»');

// «Non ancora analizzato» e «in elaborazione» sono cose diverse: nel primo caso
// c'è qualcosa da fare, nel secondo bisogna solo aspettare. Confonderle
// produrrebbe un pulsante «Analizza» su un documento che si sta già analizzando.
ok(stateOf(null, 'uploaded') === 'none', 'caricato e mai analizzato: «non ancora analizzato»');
ok(stateOf(null, 'analyzing') === 'processing', 'mentre il server lavora: «in elaborazione»');
ok(stateOf(null, 'extracting') === 'processing', 'anche durante l\'estrazione del testo');
ok(stateOf('pending', 'uploaded') === 'processing', 'un\'analisi in attesa è lavoro in corso, non assenza di lavoro');

// ===========================================================================
section('2 · Cosa arriva in Panoramica');
// ===========================================================================
// La Panoramica risponde a «cosa richiede attenzione». Un documento analizzato
// e archiviato correttamente NON è una priorità: se lo fosse, la schermata
// diventerebbe l'elenco dei documenti e smetterebbe di rispondere.
ok(needsAttention(item({ state: 'failed' })), 'un\'analisi non riuscita richiede attenzione');
ok(needsAttention(item({ state: 'to_verify' })), 'un\'analisi da verificare richiede attenzione');
ok(!needsAttention(item({ state: 'analyzed' })), 'un documento analizzato non occupa la Panoramica');
ok(!needsAttention(item({ state: 'processing' })), 'un documento in elaborazione non è un problema: è un\'attesa');
ok(!needsAttention(item({ state: 'none' })), 'un documento mai analizzato non è un guasto');

// ===========================================================================
section('3 · Gli argomenti della ricerca');
// ===========================================================================
{
  const args = toListArgs('c1', {});
  ok(args.p_query === null, 'una ricerca vuota è l\'ASSENZA di filtro, non la ricerca di una stringa vuota');
  ok(args.p_limit === DOCUMENTS_PAGE_SIZE && args.p_offset === 0, 'prima pagina della dimensione prevista');
  ok(args.p_archived === false, 'per difetto si guardano i documenti attivi, non gli archiviati');
  ok(args.p_tag_ids === null, 'nessuna etichetta scelta: nessun filtro sulle etichette');

  const spaces = toListArgs('c1', { query: '   ' });
  ok(spaces.p_query === null, 'una ricerca fatta di soli spazi non filtra niente');

  const long = toListArgs('c1', { query: 'a'.repeat(500) });
  ok((long.p_query ?? '').length === MAX_QUERY_LENGTH,
    'una ricerca lunghissima viene tagliata invece di essere rifiutata');

  const capped = toListArgs('c1', { limit: 5000, offset: -3 });
  ok(capped.p_limit === 100 && capped.p_offset === 0,
    'la dimensione della pagina resta nei limiti anche se la si chiede assurda');

  const tags = toListArgs('c1', { tagIds: ['t1', ''] });
  ok(tags.p_tag_ids?.length === 1, 'le etichette vuote non entrano nel filtro');
}

// ===========================================================================
section('4 · L\'estratto di ricerca produce TESTO, mai markup');
// ===========================================================================
{
  const parts = splitSnippet('Il termine [[IVA]] compare qui');
  ok(parts.length === 3, 'l\'estratto si spezza in segmenti');
  ok(parts[1].hit && parts[1].text === 'IVA', 'il segmento trovato è marcato e contiene solo la parola');
  ok(!parts[0].hit && !parts[2].hit, 'il resto non è marcato');

  const html = splitSnippet('prima <script>alert(1)</script> [[dopo]]');
  ok(html.some((p) => p.text.includes('<script>')),
    'il markup eventualmente presente nel documento resta TESTO: React lo scrive, non lo interpreta');
  ok(html.filter((p) => p.hit).length === 1, 'e non confonde il rilevamento dei segmenti trovati');

  ok(splitSnippet(null).length === 0, 'nessun estratto, nessun segmento');
  ok(splitSnippet('senza marcatori')[0].text === 'senza marcatori', 'un estratto senza marcatori resta intero');
  // Un delimitatore aperto e mai chiuso non deve mangiarsi il resto del testo.
  const broken = splitSnippet('testo [[ non chiuso');
  ok(broken.length === 1 && broken[0].text === 'testo [[ non chiuso' && !broken[0].hit,
    'un delimitatore non chiuso non fa sparire il testo');
}

// ===========================================================================
section('5 · I filtri nell\'indirizzo, e ritorno');
// ===========================================================================
{
  const filters: DocumentHubFilters = {
    query: 'iva', category: 'taxes', source: 'email', state: 'to_verify',
    tagIds: ['t1'], dateFrom: '2026-01-01', dateTo: '2026-06-30',
    hasDeadline: true, archived: true, sort: 'deadline',
  };
  const back = filtersFromParams(paramsFromFilters(filters));
  ok(back.query === 'iva' && back.category === 'taxes' && back.source === 'email', 'ricerca, categoria e origine tornano indietro identiche');
  ok(back.state === 'to_verify' && back.sort === 'deadline', 'stato e ordinamento sopravvivono al giro');
  ok(back.tagIds?.length === 1 && back.hasDeadline === true && back.archived === true, 'etichette e interruttori pure');
  ok(back.dateFrom === '2026-01-01' && back.dateTo === '2026-06-30', 'e gli estremi di data');

  const empty = paramsFromFilters({});
  ok([...empty.keys()].length === 0, 'senza filtri l\'indirizzo resta pulito, senza parametri vuoti');

  // Un valore inventato nell'indirizzo non deve arrivare al database: chiunque
  // può scrivere `?categoria=qualsiasi-cosa` nella barra del browser.
  const forged = filtersFromParams(new URLSearchParams('categoria=inventata&stato=falso&ordine=strano&origine=xx'));
  ok(forged.category === null, 'una categoria inventata nell\'indirizzo viene ignorata');
  ok(forged.state === null && forged.source === null, 'e così stato e origine');
  ok(forged.sort === 'recent', 'un ordinamento sconosciuto ricade su quello predefinito');

  const none = filtersFromParams(new URLSearchParams('categoria=nessuna'));
  ok(none.uncategorized === true && none.category === null,
    '«nessuna» è i documenti da classificare, che è diverso dalla categoria «altro»');

  ok(!hasActiveFilters({}), 'senza filtri non si propone di rimuoverli');
  ok(hasActiveFilters({ query: 'x' }) && hasActiveFilters({ archived: true }), 'con un filtro attivo sì');
  ok(!hasActiveFilters({ query: '   ' }), 'una ricerca di soli spazi non conta come filtro attivo');
}

// ===========================================================================
section('6 · Etichette: «IVA» e «iva» sono la stessa etichetta');
// ===========================================================================
{
  ok(normalizeTagName('  IVA  ') === 'IVA', 'gli spazi ai lati spariscono');
  ok(normalizeTagName('Sede   Lugano') === 'Sede Lugano', 'gli spazi ripetuti diventano uno');
  ok(normalizeTagName('x'.repeat(80)).length === 40, 'un nome lunghissimo viene tagliato');
  ok(sameTagName('IVA', ' iva '), 'il confronto ignora maiuscole e spazi');
  ok(!sameTagName('IVA', 'IVA 2026'), 'ma non confonde due etichette diverse');

  const tags = [{ id: 't1', name: 'IVA' }, { id: 't2', name: 'Veicoli' }];
  ok(findExistingTag(tags, 'iva')?.id === 't1', 'scrivendo «iva» si riusa l\'etichetta «IVA» invece di crearne una gemella');
  ok(findExistingTag(tags, 'Nuova') === undefined, 'un\'etichetta che non c\'è non viene inventata');
}

// ===========================================================================
section('7 · Ogni valore ha la sua etichetta, in tutte e tre le lingue');
// ===========================================================================
// Un valore senza etichetta comparirebbe grezzo in pagina: «social_insurance»
// invece di «Assicurazioni sociali». Il typecheck garantisce che i dizionari
// abbiano le stesse CHIAVI, non che coprano tutti i VALORI degli enum.
{
  const dicts = { it, de, fr } as const;
  for (const [lang, dict] of Object.entries(dicts)) {
    const cats = dict.labels.categories as Record<string, string>;
    const missing = CATEGORIES.filter((c) => !cats[c]);
    ok(missing.length === 0, `${lang}: ogni categoria ha la sua etichetta`, `mancanti: ${missing.join(', ')}`);

    const states = dict.documents.states as Record<string, string>;
    ok(STATES.every((s) => states[s]), `${lang}: ogni stato ha la sua etichetta`);

    const sources = dict.documents.sources as Record<string, string>;
    ok(SOURCES.every((s) => sources[s]), `${lang}: ogni origine ha la sua etichetta`);

    const sorts = dict.documents.sorts as Record<string, string>;
    ok(SORTS.every((s) => sorts[s]), `${lang}: ogni ordinamento ha la sua etichetta`);
  }
}

// ===========================================================================
// FABBRICHE per le sezioni 8 e 9. Tipizzate per intero e non `as unknown as`:
// se un campo del modello cambia, questi test devono ROMPERSI — è l'unico modo
// perché continuino a provare il prodotto vero e non una sua imitazione.
// ===========================================================================
// ⚠️ Il testo predefinito COINCIDE con `primaryAction`, ed è voluto: è il caso
// in cui la prima azione diventa il titolo dell'attività e non deve tornare
// anche come primo passaggio. Con un testo diverso quella regola non sarebbe
// esercitata da nessuna asserzione — ed è così che si scrive un test inerte.
const azione = (over: Partial<ChecklistAction> = {}): ChecklistAction => ({
  id: over.id ?? 1, text: over.text ?? 'Trasmettere il rendiconto IVA',
  done: over.done ?? false, sourceType: 'extracted', evidence: null,
});

function analisi(over: Partial<DocumentAnalysis> = {}): DocumentAnalysis {
  return {
    id: 'an-1', documentId: 'doc-1', companyId: 'co-1', analysisVersion: 1,
    engine: 'ai', language: 'it', languageLabel: 'Italiano',
    sender: 'Amministrazione federale delle contribuzioni', senderUncertain: false, senderEvidence: null,
    documentType: 'vat_statement', documentTypeLabel: 'Rendiconto IVA',
    urgency: 'alta', deadline: '2026-08-20', deadlineLevel: 'urgente', daysToDeadline: 19,
    deadlineEvidence: null, amount: null, amountCurrency: null, amountDisplay: null,
    amountType: null, amountEvidence: null, summary: null,
    actions: [azione(), azione({ id: 2, text: 'Allegare i giustificativi' })],
    primaryAction: 'Trasmettere il rendiconto IVA', primaryActionSource: 'extracted',
    requestedDocuments: [], risk: { text: '', level: 'unknown', evidence: null }, risks: [],
    uncertainties: [], uncertaintyItems: [], confidence: 'alta',
    recipient: null, subject: null, documentDate: null, senderAuthorityType: null,
    amounts: [], referenceNumbers: [], legalReferences: [],
    deadlineType: null, deadlineRequiresVerification: false, deadlineSourceText: null,
    overallConfidence: null, analysisStatus: 'completed', errorCode: null, errorMessageSafe: null,
    createdAt: '2026-07-31T08:00:00Z', updatedAt: '2026-07-31T08:00:00Z',
    ...over,
  };
}

function voce(over: Partial<DocumentHubItem> = {}): DocumentHubItem {
  return {
    id: 'doc-1', title: 'Rendiconto IVA 2026', originalFilename: 'iva.pdf', mimeType: 'application/pdf',
    fileSize: 1024, storagePath: 'co-1/doc-1.pdf', sourceType: 'email', status: 'completed',
    pageCount: 2, createdAt: '2026-07-30T08:00:00Z', archivedAt: null,
    category: 'taxes', categorySource: 'rule', state: 'analyzed', analysisId: 'an-1',
    lastAttemptFailed: false, errorCode: null,
    documentType: 'vat_statement', documentTypeCorrected: false,
    sender: 'Amministrazione federale delle contribuzioni', senderCorrected: false,
    senderAuthorityType: 'federal', documentDate: '2026-07-15',
    deadline: '2026-08-20', deadlineCorrected: false, deadlineRequiresVerification: false,
    amount: null, amountCurrency: null, amountCorrected: false, confidence: 'alta',
    tags: [], openTaskCount: 0, taskCount: 0, emailCount: 1, snippet: null,
    ...over,
  };
}

function attivita(over: Partial<DocumentLinkedTask> = {}): DocumentLinkedTask {
  return {
    id: 't-1', title: 'Trasmettere il rendiconto IVA', status: 'open', priority: 'high',
    dueDate: '2026-08-20', assigneeUserId: null, archivedAt: null, ...over,
  };
}

function dettaglio(over: {
  item?: Partial<DocumentHubItem>;
  analysis?: DocumentAnalysis | null;
  tasks?: DocumentLinkedTask[];
  archivedAt?: string | null;
  title?: string;
} = {}): DocumentDetail {
  const item = voce(over.item);
  return {
    document: {
      id: 'doc-1', companyId: 'co-1', uploadedBy: null, title: over.title ?? item.title,
      originalFilename: item.originalFilename, mimeType: item.mimeType, fileSize: item.fileSize,
      storagePath: item.storagePath, sourceType: item.sourceType, status: item.status,
      createdAt: item.createdAt, updatedAt: item.createdAt,
      archivedAt: over.archivedAt ?? null, category: item.category, categorySource: item.categorySource,
      pageCount: item.pageCount,
    },
    item,
    analysis: over.analysis === undefined ? analisi() : over.analysis,
    corrections: [], tags: [], emails: [], tasks: over.tasks ?? [],
    technical: null, sameContentIds: [],
  };
}

const chiavi = (s: ReturnType<typeof nextStepFor>) => s.notices.map((n) => n.key);

// ===========================================================================
section('8 · «Prossimo passo»: che cosa la pagina propone di fare, e quando');
// ⚠️ PERCHÉ ESISTE. Il dettaglio mostrava tutto ciò che si sa e non diceva mai
// che cosa restava da fare; «Crea attività» era premibile ANCHE mentre
// l'analisi stava ancora lavorando, e produceva un'attività senza scadenza e
// senza passaggi — un dato incompleto nato da un'attesa. Una guardia di questo
// tipo si sbaglia in silenzio: propone la cosa sbagliata e non lo dice nessuno,
// quindi è una funzione pura e si prova. Stessa forma di `routeGate`.
{
  // -- nessuna analisi -------------------------------------------------------
  const nessuna = nextStepFor(dettaglio({ item: { state: 'none', analysisId: null }, analysis: null }));
  ok(nessuna.kind === 'none' && nessuna.primary.action === 'analyze',
    'senza analisi la cosa da fare è analizzare');
  ok(chiavi(nessuna).includes('documents.nextStep.noticeNoAnalysis'),
    'e si DICHIARA che un’attività creata adesso nascerebbe senza scadenza e senza passaggi');
  ok(nessuna.canCreateTask, 'crearla resta comunque possibile: era possibile prima e non si toglie niente');

  // -- analisi in elaborazione ----------------------------------------------
  const inCorso = nextStepFor(dettaglio({ item: { state: 'processing' }, analysis: null }));
  ok(inCorso.kind === 'processing' && inCorso.primary.action === 'wait',
    'mentre l’analisi lavora non c’è niente da premere');
  ok(!inCorso.canCreateTask,
    '⚠️ ed è l’UNICO caso in cui creare è impedito: un’attività aperta in quell’istante nascerebbe senza la scadenza che sta per arrivare');
  ok(inCorso.secondary.length === 0, 'nessuna azione secondaria che produca dati incompleti');

  // -- analisi fallita -------------------------------------------------------
  const fallita = nextStepFor(dettaglio({
    item: { state: 'failed', sender: null, deadline: null },
    analysis: analisi({ analysisStatus: 'failed', errorMessageSafe: 'Il servizio ha risposto con un errore.' }),
  }));
  ok(fallita.kind === 'failed' && fallita.primary.action === 'retry_analysis',
    'un’analisi fallita si riprova');
  ok(chiavi(fallita).includes('documents.nextStep.noticeFailed'),
    'e si dice che non è stato estratto NIENTE: non si mostrano valori di ripiego');

  // -- analisi da verificare -------------------------------------------------
  const daVerificare = nextStepFor(dettaglio({
    item: { state: 'to_verify' },
    analysis: analisi({ analysisStatus: 'needs_review' }),
  }));
  ok(daVerificare.kind === 'to_verify' && daVerificare.primary.action === 'verify_analysis',
    'con un’analisi da verificare la cosa da fare è verificarla');
  ok(daVerificare.secondary.some((s) => s.action === 'create_task'),
    'creare l’attività resta possibile — il comportamento attuale lo consente — ma in secondo piano');
  ok(chiavi(daVerificare).includes('documents.nextStep.noticeToVerify'),
    '⚠️ e l’avvertenza è ESPLICITA: l’attività porterebbe dati non ancora verificati');

  // -- analisi pronta e nessuna attività ------------------------------------
  const pronta = nextStepFor(dettaglio());
  ok(pronta.kind === 'ready' && pronta.primary.action === 'create_task',
    'con un’analisi utilizzabile e nessuna attività, la cosa da fare è aprire il lavoro');
  ok(pronta.facts.deadline === '2026-08-20' && pronta.facts.sender !== null,
    'e il riquadro porta la scadenza e il mittente su cui si sta per decidere');
  ok(pronta.facts.stepsToCreate === 1,
    'i passaggi annunciati sono quelli che verranno creati DAVVERO: l’azione uguale al titolo non si conta');

  // -- la scadenza da verificare, l’assenza di scadenza, l’assenza di azioni -
  const senzaTermine = nextStepFor(dettaglio({
    item: { deadline: null }, analysis: analisi({ deadline: null }),
  }));
  ok(chiavi(senzaTermine).includes('documents.nextStep.noticeNoDeadline'),
    'senza scadenza lo si dice invece di inventarne una');
  const daControllare = nextStepFor(dettaglio({
    item: { deadlineRequiresVerification: true },
  }));
  ok(chiavi(daControllare).includes('documents.nextStep.noticeDeadlineToVerify'),
    '§36 — una scadenza che l’analisi non dà per certa si dichiara PRIMA di creare l’attività');
  const senzaAzioni = nextStepFor(dettaglio({
    analysis: analisi({ actions: [], primaryAction: null }),
  }));
  ok(chiavi(senzaAzioni).includes('documents.nextStep.noticeNoActions'),
    'senza azioni si dice che la checklist resterà vuota');
  ok(senzaAzioni.facts.proposedTitle === 'Rendiconto IVA 2026',
    'e il titolo proposto ripiega su quello del documento');
  const incerta = nextStepFor(dettaglio({
    analysis: analisi({
      uncertaintyItems: [{ field: 'deadline', description: 'La data è ambigua', severity: 'medium' }],
    }),
  }));
  ok(chiavi(incerta).includes('documents.nextStep.noticeUncertaintyOne'),
    'un punto incerto si conta al singolare: «1 punti» è un errore anche in italiano');

  // -- attività già esistenti ------------------------------------------------
  const unaAttivita = nextStepFor(dettaglio({ tasks: [attivita()] }));
  ok(unaAttivita.kind === 'has_tasks' && unaAttivita.primary.action === 'open_task'
    && unaAttivita.primary.taskId === 't-1',
    'con UNA attività la cosa da fare è aprirla, e si sa quale');
  ok(unaAttivita.secondary.some((s) => s.action === 'create_another_task'),
    '⚠️ crearne un’altra NON sparisce: più attività su un documento sono legittime (§40)');
  ok(unaAttivita.primary.action !== 'create_task',
    'ma non è più l’azione primaria: è così che si riducono i doppioni per distrazione');
  const dueAttivita = nextStepFor(dettaglio({ tasks: [attivita(), attivita({ id: 't-2' })] }));
  ok(dueAttivita.primary.action === 'see_tasks' && dueAttivita.primary.taskId === undefined,
    'con più di una non si sceglie per la persona: si portano a vederle');
  ok(chiavi(dueAttivita).includes('documents.nextStep.noticeExistingMany'),
    'e si dice quante ne sono già nate');

  // ⚠️ Un’attività esistente vince anche su «da verificare», ma la verifica
  //    resta offerta: sono due cose da fare, e la prima è il lavoro.
  const attivitaEdaVerificare = nextStepFor(dettaglio({
    item: { state: 'to_verify' }, tasks: [attivita()],
  }));
  ok(attivitaEdaVerificare.primary.action === 'open_task',
    'con un’attività aperta il lavoro viene prima della verifica');
  ok(attivitaEdaVerificare.secondary.some((s) => s.action === 'verify_analysis'),
    'ma verificare l’analisi resta a portata di mano');

  // -- documento archiviato --------------------------------------------------
  const archiviato = nextStepFor(dettaglio({ archivedAt: '2026-07-31T09:00:00Z' }));
  ok(chiavi(archiviato).includes('documents.nextStep.noticeArchived'),
    'su un documento archiviato lo si rende evidente prima di creare qualcosa');
  ok(archiviato.canCreateTask,
    'senza però impedirlo: archiviare non è cancellare, e la decisione resta di chi guarda');
  ok(chiavi(archiviato)[0] === 'documents.nextStep.noticeArchived',
    'e l’avviso viene per PRIMO, non in fondo a un elenco di note');
}

// ===========================================================================
section('9 · Da documento ad attività: quello che viene scritto, e che cosa succede se la checklist fallisce');
// ⚠️ Fino a oggi questa catena aveva una prova sola, su database reale, e tre
// dei suoi esiti là non si sanno provocare — a cominciare da «l'attività è
// nata, i passaggi no», che è precisamente la garanzia dichiarata nel codice.
{
  const base = {
    companyId: 'co-1', userId: 'u-1', documentId: 'doc-1',
    title: 'Trasmettere il rendiconto IVA',
  };

  // -- i valori EFFETTIVI battono quelli dell'analisi ------------------------
  const conCorrezione = documentTaskDraft({
    ...base, analysis: analisi(),
    authority: 'Divisione delle contribuzioni del Cantone Ticino',   // corretto a mano
    dueDate: '2026-09-01',                                            // corretta a mano
  });
  ok(conCorrezione.payload.authority === 'Divisione delle contribuzioni del Cantone Ticino',
    '⚠️ un mittente corretto da una persona non viene rimpiazzato da quello che l’AI aveva letto');
  ok(conCorrezione.payload.dueDate === '2026-09-01',
    'e nemmeno la scadenza corretta');
  ok(conCorrezione.payload.source === 'admin_ai',
    'l’attività dichiara di venire da un’analisi: chi la riceve ha diritto di saperlo');
  ok(conCorrezione.payload.documentId === 'doc-1', 'e resta collegata al documento');

  // -- priorità dall'urgenza, responsabile dal modulo ------------------------
  ok(documentTaskDraft({ ...base, analysis: analisi({ urgency: 'bassa' }) }).payload.priority === 'low',
    'la priorità deriva dall’urgenza dell’analisi');
  ok(documentTaskDraft({ ...base, analysis: analisi(), priority: 'medium' }).payload.priority === 'medium',
    'ma la scelta fatta nel modulo di revisione vince');
  ok(documentTaskDraft({ ...base, analysis: analisi(), assigneeUserId: 'u-7' }).payload.assigneeUserId === 'u-7',
    'il responsabile scelto nel modulo arriva al servizio');
  ok(documentTaskDraft({ ...base, analysis: analisi() }).payload.assigneeUserId === null,
    'e senza scelta resta «non assegnata», non un valore inventato');

  // -- senza analisi ---------------------------------------------------------
  const senzaAnalisi = documentTaskDraft({ ...base, analysis: null, authority: null, dueDate: null });
  ok(senzaAnalisi.payload.source === 'manual', 'senza analisi l’attività è «a mano», non «Admin AI»');
  ok(senzaAnalisi.steps.length === 0, 'e non nasce nessun passaggio');

  // -- la scrittura: i tre esiti --------------------------------------------
  const taskFinta = (id: string): Task => ({
    id, companyId: 'co-1', createdBy: 'u-1', documentId: 'doc-1', subsidyCaseId: null,
    title: base.title, description: null, authority: null, dueDate: null, priority: 'high',
    status: 'open', source: 'admin_ai', assigneeUserId: null,
    completedAt: null, completedBy: null, archivedAt: null, archivedBy: null, workflowRunId: null,
    createdAt: '2026-07-31T10:00:00Z', updatedAt: '2026-07-31T10:00:00Z',
  });

  {
    let passaggi: string[] | null = null;
    const esito = await runCreateFromDocument({ ...base, analysis: analisi() }, {
      createTask: async () => taskFinta('t-9'),
      addSteps: async (_c, _t, texts) => { passaggi = texts; },
    });
    ok(esito.task.id === 't-9' && !esito.stepsFailed && esito.steps === 1,
      'creazione riuscita: l’attività c’è e i passaggi pure');
    ok(passaggi !== null && (passaggi as string[])[0] === 'Allegare i giustificativi',
      'e i passaggi sono quelli derivati dall’analisi, senza l’azione uguale al titolo');
  }

  {
    // ⚠️ Il `try` non è prudenza: è l'asserzione. Se un giorno questo percorso
    // tornasse a RILANCIARE, senza questo blocco il test morirebbe invece di
    // fallire — e un test che esplode dice molto meno di uno che diventa rosso
    // sulla riga giusta.
    let rilanciato = false;
    let esito: Awaited<ReturnType<typeof runCreateFromDocument>> | null = null;
    try {
      esito = await runCreateFromDocument({ ...base, analysis: analisi() }, {
        createTask: async () => taskFinta('t-10'),
        addSteps: async () => { throw new Error('permission denied'); },
      });
    } catch { rilanciato = true; }
    ok(!rilanciato,
      '⚠️ CHECKLIST FALLITA: l’errore NON viene rilanciato — l’attività esiste, e un’eccezione la renderebbe irraggiungibile');
    ok(esito?.task.id === 't-10',
      'l’identificativo dell’attività resta: chi ha premuto deve poterla aprire');
    ok(esito?.stepsFailed === true && esito?.steps === 0,
      'e non si dichiara un successo pieno: i passaggi mancanti sono un fatto, non un dettaglio da tacere');
  }

  {
    let chiamata = false;
    const esito = await runCreateFromDocument(
      { ...base, analysis: analisi({ actions: [], primaryAction: null }) },
      { createTask: async () => taskFinta('t-11'), addSteps: async () => { chiamata = true; } },
    );
    ok(!chiamata, 'senza passaggi non si chiama il servizio della checklist a vuoto');
    ok(!esito.stepsFailed && esito.steps === 0, 'e zero passaggi non è un fallimento');
  }

  {
    // Un guasto sulla creazione RISALE: senza attività non c'è niente da
    // raccontare, e inghiottirlo sarebbe il fallback silenzioso che questo
    // progetto non ammette.
    let sollevato = false;
    try {
      await runCreateFromDocument({ ...base, analysis: analisi() }, {
        createTask: async () => { throw new Error('assignee_not_member'); },
        addSteps: async () => undefined,
      });
    } catch { sollevato = true; }
    ok(sollevato, 'se l’attività non si crea, l’errore arriva a chi ha premuto');
  }
}

// ===========================================================================
console.log(`\n${B}Il titolo che non si sa non si inventa${X}`);
// ===========================================================================
// ⚠️⚠️ IL CASO REALE del 2026-08-11: nel Document Hub c'era un documento
// intitolato «2.5». Il file era `2.5.pdf`, il titolo veniva dal nome del file
// meno l'estensione, e l'analisi aveva risposto onestamente `subject: null`.
// Un fallimento presentato come un risultato: chi leggeva l'elenco non aveva
// modo di sapere che nessuno era riuscito a dire di che documento si trattasse.
{
  const r = titoloDocumento({ nomeFile: '2.5.pdf' });
  ok(r.origine === 'non_determinato',
    '«2.5.pdf»: l’oggetto NON è determinato, e l’esito lo dice invece di far finta');
  ok(r.nomeFile === '2.5.pdf',
    '…e il nome del file resta, perché è l’unica cosa che permette di riconoscere la riga');
}
{
  // LE CONTROPROVE: se un nome dice qualcosa, non lo si butta via.
  const veri = ['Fattura Swisscom marzo.pdf', 'Lohnausweis 2025.pdf', 'decisione-AFC.pdf', 'contratto affitto.docx'];
  for (const n of veri) {
    ok(titoloDocumento({ nomeFile: n }).origine === 'nome_file',
      `«${n}» dice qualcosa: resta il titolo`);
  }
}
{
  // ⚠️ Non basta chiedersi «è un numero?»: questi hanno lettere e non dicono
  // niente lo stesso. Sono i nomi che mettono scanner, fotocamere e sistemi.
  const muti = ['2.5.pdf', 'IMG_4821.jpg', 'Scan_2026-08-11.pdf', 'documento (3).pdf', 'Nuovo documento.pdf', 'untitled.pdf', '20260811.pdf', '2.5'];
  for (const n of muti) {
    ok(!nomeFileInformativo(n), `«${n}» non dice niente sul contenuto`);
  }
}
{
  // La precedenza, provata nell’ordine che conta.
  ok(titoloDocumento({ titoloScritto: 'Disdetta locazione', oggettoAnalisi: 'Altro', nomeFile: 'x.pdf' }).origine === 'persona',
    'chi scrive il titolo vince su tutto: nessuno sa meglio di lei');
  ok(titoloDocumento({ oggettoAnalisi: 'Lohndeklaration 2025', nomeFile: '2.5.pdf' }).titolo === 'Lohndeklaration 2025',
    'l’oggetto letto DAL DOCUMENTO batte il nome del file, che l’ha scelto un apparecchio');
  ok(titoloDocumento({ oggettoAnalisi: '   ', nomeFile: '2.5.pdf' }).origine === 'non_determinato',
    'un oggetto fatto di spazi non è un oggetto');
}
{
  // ⚠️ La frase esiste nelle tre lingue e porta il segnaposto del file: senza,
  // la riga direbbe che qualcosa non si sa senza dire DI CHE COSA.
  for (const [lang, dict] of [['it', it], ['de', de], ['fr', fr]] as const) {
    const frase = (dict as Record<string, any>).adminAi?.titleUndetermined as string | undefined;
    ok(typeof frase === 'string' && frase.includes('{file}'),
      `${lang}: la frase dell’oggetto non determinato esiste e nomina il file`);
  }
}

// ===========================================================================
section('11 · Un solo colore forte per riga');
// ===========================================================================
// Regola 8 del sistema di design. Il difetto che questa sezione inchioda: un
// documento «da verificare» con una scadenza dichiarata mostrava DUE pastiglie
// ambra affiancate. Nessuna delle due era sbagliata presa da sola — la
// scadenza è ambra perché dice quanto manca, lo stato è ambra perché la
// lettura è incerta — ed è per questo che nessuna rilettura del markup lo
// avrebbe trovato: la regola parla della RIGA, e le due pastiglie sceglievano
// ognuna per conto proprio.
{
  const tones = (over: Partial<DocumentHubItem>) => rowBadgeTones(item(over));

  // ---- l'invariante, provato su TUTTE le combinazioni ---------------------
  // Non tre casi scelti a mano: il prodotto cartesiano di stato × scadenza ×
  // «scadenza da verificare». Un'invariante provata sugli esempi a cui si
  // pensa è provata proprio dove non serve.
  const strongPerRow: { combo: string; n: number }[] = [];
  for (const state of STATES) {
    for (const deadline of [null, '2026-09-28']) {
      for (const requires of [false, true]) {
        const t2 = tones({ state, deadline, deadlineRequiresVerification: requires });
        const n = [t2.deadline, t2.state].filter(isStrongTone).length;
        strongPerRow.push({ combo: `${state}/${deadline ? 'scadenza' : 'senza'}/${requires ? 'daVerificare' : 'certa'}`, n });
      }
    }
  }
  const troppi = strongPerRow.filter((r) => r.n > 1);
  ok(strongPerRow.length === STATES.length * 4, `provate tutte le ${STATES.length * 4} combinazioni stato × scadenza`);
  ok(troppi.length === 0, 'nessuna combinazione produce due colori forti nella stessa riga',
    troppi.map((r) => `${r.combo}: ${r.n} forti`).join(' · '));

  // ---- e la precedenza è QUELLA dichiarata, non una qualsiasi -------------
  // L'invariante da sola sarebbe soddisfatta anche spegnendo tutti i colori:
  // «zero forti per riga» non viola «al massimo uno». Questi casi dicono CHI
  // vince, che è la metà della regola che l'invariante non copre.
  const conScadenza = tones({ state: 'to_verify', deadline: '2026-09-28' });
  ok(conScadenza.deadline === 'media' && conScadenza.state === 'neutral',
    'da verificare + scadenza certa: l’ambra va alla SCADENZA, lo stato scende a neutro');

  const scadenzaIncerta = tones({ state: 'to_verify', deadline: '2026-09-28', deadlineRequiresVerification: true });
  ok(scadenzaIncerta.deadline === 'neutral' && scadenzaIncerta.state === 'media',
    'quando è la scadenza a essere incerta la precedenza si rovescia da sé: l’ambra torna allo stato');

  const guasto = tones({ state: 'failed', deadline: '2026-09-28' });
  ok(guasto.state === 'alta' && guasto.deadline === 'neutral',
    'il guasto batte tutto: se l’analisi non è riuscita, nemmeno la data è affidabile');

  const soloScadenza = tones({ state: 'analyzed', deadline: '2026-09-28' });
  ok(soloScadenza.deadline === 'media' && soloScadenza.state === null,
    'senza niente con cui competere la scadenza tiene la sua ambra');

  const soloStato = tones({ state: 'to_verify' });
  ok(soloStato.state === 'media' && soloStato.deadline === null,
    'e lo stato la tiene quando è l’unica cosa da dire');

  // ⚠️ Chi perde NON sparisce: scende di tono e tiene il suo posto. Una
  // pastiglia nascosta sarebbe un'informazione tolta, non un colore tolto.
  ok(conScadenza.state !== null && guasto.deadline !== null,
    'la pastiglia che perde il colore resta a schermo: si toglie il tono, non il testo');
}

// ===========================================================================
console.log(`\n${B}Riepilogo${X}  ${G}${pass} superati${X}${fail ? `  ${R}${fail} falliti${X}` : ''}\n`);
process.exit(fail ? 1 : 0);
