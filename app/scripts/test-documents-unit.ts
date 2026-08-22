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
  buildDocumentStats, filtersFromParams, findExistingTag, hasActiveFilters, needsAttention,
  normalizeTagName, paramsFromFilters, passoSegnali, rowMarks, sameTagName, splitSnippet,
  stateOf, toListArgs,
} from '../src/features/documents/documentModel';
// La logica pura del termine vive col componente che la rende: si prova qui
// perché è il Document Hub il primo posto dove una data sbagliata costa.
import { deadlineState } from '../src/components/ui/DeadlineMark';
import { it } from '../src/i18n/locales/it';
import { de } from '../src/i18n/locales/de';
import { fr } from '../src/i18n/locales/fr';
import { nextStepFor } from '../src/features/documents/nextStep';
import {
  OWNERSHIP_CONFIRMED, OWNERSHIP_FIELD, OWNERSHIP_REVOKED,
  analysisTrust, cognomiDaRubrica, ownershipConfirmation, segnoCampo, trustInputFromAnalysis,
  type TrustInput, type TrustVerdict,
} from '../src/features/documents/analysisTrust';
import { readFileSync, readdirSync } from 'node:fs';
import { aBlocchi, BLOCCO_IN } from '../src/lib/blocchi';
import {
  etichettaComposta, etichettaDaRigaDocumento, etichettaDocumento,
  nomeFileInformativo, titoloDocumento, titoloMostrabile,
} from '../src/lib/documentTitle';
import {
  documentTaskDraft, runCreateFromDocument, appartenenzaDa, AppartenenzaInDubbio,
} from '../src/features/tasks/documentToTask';
import { motivoAppartenenza } from '../src/features/documents/ownershipReason';
import type {
  AnalysisUncertainty, ChecklistAction, DocumentAnalysis, DocumentDetail, DocumentHubFilters, DocumentHubItem,
  DocumentLinkedTask, DocumentStatsRow, Task,
} from '../src/types/models';

let pass = 0, fail = 0;
const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';
const ok = (cond: boolean, label: string, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${label}`); }
  else { fail++; console.log(`  ${R}✗ ${label}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

const item = (over: Partial<DocumentHubItem> = {}): DocumentHubItem => ({
  id: 'd1', title: 'Documento', label: { origine: 'titolo', titolo: 'Documento' },
  originalFilename: null, mimeType: null, fileSize: null,
  storagePath: null, sourceType: 'upload', status: 'completed', pageCount: null,
  createdAt: '2026-01-01T00:00:00Z', archivedAt: null, category: null, categorySource: null,
  state: 'analyzed', analysisId: 'a1', lastAttemptFailed: false, errorCode: null,
  documentType: null, documentTypeCorrected: false, sender: null, senderCorrected: false,
  senderAuthorityType: null, documentDate: null, deadline: null, deadlineCorrected: false,
  deadlineRequiresVerification: false, deadlineKind: null, appointmentDate: null,
  amount: null, amountCurrency: null, amountCorrected: false,
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

  // Il modo «appartenenza da confermare» (`?appartenenza=1`), destinazione del
  // blocco decisioni della Panoramica: sopravvive al giro, non sporca un
  // indirizzo pulito, e conta come filtro attivo (c'è da poterlo togliere).
  const own = filtersFromParams(paramsFromFilters({ ownership: true }));
  ok(own.ownership === true, 'il filtro per appartenenza sopravvive al giro indirizzo→filtri');
  ok(filtersFromParams(new URLSearchParams()).ownership === false,
    'senza parametro il modo è spento, non indefinito');
  ok(!paramsFromFilters({ ownership: false }).has('appartenenza'),
    'spento non scrive nell\'indirizzo');
  ok(hasActiveFilters({ ownership: true }), 'ed è un filtro attivo: si può rimuovere');
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
    id: 'an-1', documentId: 'doc-1', companyId: 'co-1', analysisVersion: 1, schemaVersion: 2,
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
    deadlineType: null, deadlineRequiresVerification: false, deadlineKind: null, deadlineSourceText: null,
    appointmentDate: null, appointmentEvidence: null, appointmentSourceText: null,
    overallConfidence: null, analysisStatus: 'completed', errorCode: null, errorMessageSafe: null,
    createdAt: '2026-07-31T08:00:00Z', updatedAt: '2026-07-31T08:00:00Z',
    ...over,
  };
}

function voce(over: Partial<DocumentHubItem> = {}): DocumentHubItem {
  return {
    id: 'doc-1', title: 'Rendiconto IVA 2026',
    label: { origine: 'titolo', titolo: 'Rendiconto IVA 2026' },
    originalFilename: 'iva.pdf', mimeType: 'application/pdf',
    fileSize: 1024, storagePath: 'co-1/doc-1.pdf', sourceType: 'email', status: 'completed',
    pageCount: 2, createdAt: '2026-07-30T08:00:00Z', archivedAt: null,
    category: 'taxes', categorySource: 'rule', state: 'analyzed', analysisId: 'an-1',
    lastAttemptFailed: false, errorCode: null,
    documentType: 'vat_statement', documentTypeCorrected: false,
    sender: 'Amministrazione federale delle contribuzioni', senderCorrected: false,
    senderAuthorityType: 'federal', documentDate: '2026-07-15',
    deadline: '2026-08-20', deadlineCorrected: false, deadlineRequiresVerification: false,
    deadlineKind: 'term', appointmentDate: null,
    amount: null, amountCurrency: null, amountCorrected: false, confidence: 'alta',
    tags: [], openTaskCount: 0, taskCount: 0, emailCount: 1, snippet: null,
    ...over,
  };
}

function attivita(over: Partial<DocumentLinkedTask> = {}): DocumentLinkedTask {
  return {
    id: 't-1', title: 'Trasmettere il rendiconto IVA', status: 'open', priority: 'high',
    dueDate: '2026-08-20', appointmentDate: null, assigneeUserId: null, archivedAt: null, ...over,
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
    // Le prove di questo blocco parlano di ALTRO: qui l'appartenenza è
    // verificata, così l'unico cancello che possono incontrare è quello che
    // stanno misurando. Il cancello ha il suo blocco, più sotto.
    appartenenza: { stato: 'senza-dubbio' } as const,
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

  // -- L'APPUNTAMENTO NON DIVENTA UN TERMINE, e viceversa --------------------
  // ⚠️⚠️ QUESTA È LA RIGA DA CUI IL DIFETTO È ENTRATO NEL MONDO. Il 2026-07-26
  // un'analisi che aveva messo un sopralluogo nel campo Scadenza ha prodotto
  // TRE attività datate 10.09.2026 — la data in cui il Comune si presenta, non
  // il giorno entro cui l'azienda deve aver preparato i giustificativi. Da
  // qui in poi le due date viaggiano separate, e nessuna delle due si travasa
  // nell'altra per comodità.
  {
    const sopralluogo = analisi({
      deadline: null, deadlineType: 'none', deadlineKind: 'event',
      appointmentDate: '2026-09-10', urgency: 'media',
    });
    const d = documentTaskDraft({ ...base, analysis: sopralluogo });
    ok(d.payload.dueDate === null,
      'un sopralluogo NON diventa la scadenza dell’attività', String(d.payload.dueDate));
    ok(d.payload.appointmentDate === '2026-09-10',
      'ma non sparisce: l’attività dice prima di quando va fatta', String(d.payload.appointmentDate));

    // ⚠️ LA COPPIA. Una scadenza vera resta una scadenza, e non genera un
    // appuntamento: se cadesse, staremmo spostando i termini invece di
    // distinguerli.
    const termine = documentTaskDraft({ ...base, analysis: analisi({ deadlineKind: 'term' }) });
    ok(termine.payload.dueDate === '2026-08-20' && termine.payload.appointmentDate === null,
      'CONTROPROVA: un termine resta un termine, e non produce alcun appuntamento',
      `${termine.payload.dueDate} / ${termine.payload.appointmentDate}`);

    // ⚠️ E NON SI RIPIEGA. Senza appuntamento il campo resta vuoto: un'attività
    // senza termine e senza appuntamento è legittima, non un buco da riempire
    // con la prima data a portata di mano.
    const nuda = documentTaskDraft({ ...base, analysis: analisi({ deadline: null, appointmentDate: null }) });
    ok(nuda.payload.dueDate === null && nuda.payload.appointmentDate === null,
      'senza né l’una né l’altra, nessuna data viene inventata');
  }

  // -- senza analisi ---------------------------------------------------------
  const senzaAnalisi = documentTaskDraft({ ...base, analysis: null, authority: null, dueDate: null });
  ok(senzaAnalisi.payload.source === 'manual', 'senza analisi l’attività è «a mano», non «Admin AI»');
  ok(senzaAnalisi.steps.length === 0, 'e non nasce nessun passaggio');

  // -- la scrittura: i tre esiti --------------------------------------------
  const taskFinta = (id: string): Task => ({
    id, companyId: 'co-1', createdBy: 'u-1', documentId: 'doc-1', subsidyCaseId: null,
    title: base.title, description: null, authority: null, dueDate: null, appointmentDate: null, priority: 'high',
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

  // -- IL CANCELLO DELL'APPARTENENZA ----------------------------------------
  // ⚠️⚠️ IL CASO REALE del 2026-08-21. Una fattura Sunrise di 15 pagine,
  // intestata a «Massimo Cavalieri, Rovello 32D, 6942 Savosa» e caricata da
  // Rossi SA: `valutaAppartenenza` risponde `{doubt: true, via: 'nome'}`. Il
  // dettaglio del documento disabilitava il pulsante e il commento accanto
  // dichiarava che quel cancello valeva per «tutti i punti di creazione» — ma
  // la schermata di Admin AI non lo aveva, e da lì è nata l'attività «Pagare
  // la fattura» (`source: 'admin_ai'`, 19:37:37). Una regola scritta in una
  // schermata non la eredita la schermata dopo: adesso sta qui.
  {
    let creata = false;
    let errore: unknown = null;
    try {
      await runCreateFromDocument(
        { ...base, appartenenza: { stato: 'in-dubbio' }, analysis: analisi() },
        { createTask: async () => { creata = true; return taskFinta('t-12'); },
          addSteps: async () => undefined },
      );
    } catch (e) { errore = e; }
    ok(errore instanceof AppartenenzaInDubbio,
      '⚠️ APPARTENENZA IN DUBBIO: la creazione viene RIFIUTATA, e con un errore riconoscibile');
    ok(!creata,
      '⚠️⚠️ e il servizio non viene nemmeno chiamato: un’attività creata e poi «annullata» avrebbe già fatto scattare i trigger e lasciato una riga nello storico');
  }

  {
    // CONTROPROVA: il cancello non deve chiudersi su tutto, o la funzione
    // «non crea mai niente» passerebbe la prova qui sopra a pieni voti.
    let creata = false;
    const esito = await runCreateFromDocument(
      { ...base, appartenenza: { stato: 'senza-dubbio' }, analysis: analisi() },
      { createTask: async () => { creata = true; return taskFinta('t-13'); },
        addSteps: async () => undefined },
    );
    ok(creata && esito.task.id === 't-13',
      'CONTROPROVA: con l’appartenenza verificata l’attività nasce come prima');
  }

  {
    // `non-valutata` NON blocca, ed è una decisione dichiarata: il dettaglio
    // del documento si comporta già così quando il verdetto non è arrivato.
    // Se un giorno si volesse bloccare anche qui, è QUESTA riga che deve
    // diventare rossa — non un comportamento che cambia di nascosto.
    let creata = false;
    await runCreateFromDocument(
      { ...base, appartenenza: { stato: 'non-valutata', perche: 'prova' }, analysis: analisi() },
      { createTask: async () => { creata = true; return taskFinta('t-14'); },
        addSteps: async () => undefined },
    );
    ok(creata,
      '«non valutata» non è «in dubbio»: non blocca — e il `perche` obbligatorio lascia il buco scritto invece che invisibile');
  }

  {
    // La traduzione dal verdetto: è il punto in cui una schermata può mentire.
    ok(appartenenzaDa({ unavailable: 'ownership' }, 'x').stato === 'in-dubbio',
      'il verdetto che sospende per appartenenza diventa «in dubbio»');
    ok(appartenenzaDa({ unavailable: null }, 'x').stato === 'senza-dubbio',
      'un verdetto che non sospende diventa «senza dubbio»');
    const senzaVerdetto = appartenenzaDa(null, 'lettura non riuscita');
    ok(senzaVerdetto.stato === 'non-valutata',
      '⚠️ VERDETTO ASSENTE NON È «NESSUN DUBBIO»: è «non lo so ancora», e chiamarlo diversamente sarebbe la dichiarazione falsa che questo cancello esiste per evitare');
    ok(senzaVerdetto.stato === 'non-valutata' && senzaVerdetto.perche === 'lettura non riuscita',
      '…e il motivo viaggia con esso: un buco senza ragione scritta non si ritrova più');
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
section('11 · I marcatori della riga');
// ===========================================================================
// L'erede della regola 8. La versione precedente («un solo colore forte per
// riga», rowBadgeTones) demoteva a neutro la pastiglia perdente: era il
// rimedio a un vocabolario in cui termine e stato di fiducia erano la stessa
// pastiglia ambra. Dal 2026-08-12 le famiglie si distinguono per FORMA
// (cifre per il termine, filetto puntinato per «da verificare») e la regola
// diventa: la sola pastiglia PIENA è il guasto; su un guasto la scadenza non
// si mostra affatto; il marcatore epistemico non convive mai con una
// pastiglia di stato (direbbero due cose sulla stessa lettura).
{
  const marks = (over: Partial<DocumentHubItem>) => rowMarks(item(over));

  // ---- l'invariante, provato su TUTTE le combinazioni ---------------------
  // Non casi scelti a mano: il prodotto cartesiano di stato × scadenza ×
  // «scadenza da verificare». Un'invariante provata sugli esempi a cui si
  // pensa è provata proprio dove non serve.
  const violazioni: string[] = [];
  let provate = 0;
  for (const state of STATES) {
    for (const deadline of [null, '2026-09-28']) {
      for (const requires of [false, true]) {
        const m = marks({ state, deadline, deadlineRequiresVerification: requires });
        const combo = `${state}/${deadline ? 'scadenza' : 'senza'}/${requires ? 'daVerificare' : 'certa'}`;
        provate++;
        if (state === 'failed' && m.deadline) violazioni.push(`${combo}: scadenza mostrata su un guasto`);
        if (deadline === null && m.deadline) violazioni.push(`${combo}: scadenza mostrata senza una scadenza`);
        if (m.toVerify && m.state !== null) violazioni.push(`${combo}: marcatore epistemico E pastiglia di stato insieme`);
      }
    }
  }
  ok(provate === STATES.length * 4, `provate tutte le ${STATES.length * 4} combinazioni stato × scadenza`);
  ok(violazioni.length === 0, 'nessuna combinazione viola le tre regole della riga', violazioni.join(' · '));

  // ---- e la decisione è QUELLA dichiarata, non una qualsiasi --------------
  // L'invariante da sola sarebbe soddisfatta anche non mostrando mai niente:
  // questi casi dicono che cosa DEVE esserci, che è la metà che manca.
  const guasto = marks({ state: 'failed', deadline: '2026-09-28' });
  ok(guasto.state === 'failed' && !guasto.deadline && !guasto.toVerify,
    'il guasto batte tutto: pastiglia rossa e NIENTE scadenza — se l’analisi non è riuscita, nemmeno la data è affidabile');

  const daVerificare = marks({ state: 'to_verify', deadline: '2026-09-28' });
  ok(daVerificare.toVerify && daVerificare.deadline && daVerificare.state === null,
    'da verificare + scadenza: convivono, perché non si somigliano più — filetto epistemico e cifre del termine');

  const analizzato = marks({ state: 'analyzed', deadline: '2026-09-28' });
  ok(analizzato.state === null && !analizzato.toVerify && analizzato.deadline,
    '«analizzato» non è una notizia: resta solo il termine');

  const inCorso = marks({ state: 'processing' });
  ok(inCorso.state === 'processing' && !inCorso.toVerify,
    'gli stati funzionali (in elaborazione) restano pastiglie neutre');

  ok(!marks({ state: 'analyzed' }).deadline, 'senza scadenza, nessun marcatore di termine');
}

// ===========================================================================
section('12 · Lo stato del termine (deadlineState)');
// ===========================================================================
// La funzione pura dietro DeadlineMark: decide che cosa dice la marcatura del
// termine in TUTTA l'app (documenti, attività, contratti, fatture, incentivi).
// Il caso che l'ha resa necessaria: i contratti CONTAVANO i giorni anche su
// date «candidate» mai verificate da una persona — `toVerify` deve vincere
// sul conteggio, sempre.
{
  const giorno = (n: number): string => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  ok(deadlineState(null).state === 'none', 'senza data: «nessuna scadenza», non un vuoto');
  ok(deadlineState(null, true).state === 'none', 'senza data non c’è niente da verificare: vince l’assenza');

  // ⚠️ IL CASO DEI CONTRATTI: la data c'è ma non è verificata — si dichiara,
  // NON si conta. Un conto alla rovescia su una data incerta è un'invenzione.
  const daVerificare = deadlineState(giorno(5), true);
  ok(daVerificare.state === 'toVerify' && daVerificare.days === null,
    'data da verificare: niente conteggio — «fra 5 giorni» su una data incerta sarebbe un’invenzione');

  ok(deadlineState(giorno(0)).state === 'today', 'oggi è «oggi», non «fra 0 giorni»');
  const domani = deadlineState(giorno(1));
  ok(domani.state === 'soon' && domani.days === 1, 'domani: vicino, 1 giorno');
  ok(deadlineState(giorno(7)).state === 'soon', 'il settimo giorno è ancora «vicino» (soglia inclusa)');
  ok(deadlineState(giorno(8)).state === 'days', 'l’ottavo no: la soglia predefinita è 7');
  ok(deadlineState(giorno(30), false, 30).state === 'soon',
    'la soglia si può allargare (il preavviso dei contratti guarda 30 giorni)');
  ok(deadlineState(giorno(31), false, 30).state === 'days', 'e il trentunesimo resta fuori');

  const ieri = deadlineState(giorno(-1));
  ok(ieri.state === 'over' && ieri.days === 1, 'ieri: scaduto da 1 — i giorni di ritardo sono positivi');
  const treGiorniFa = deadlineState(giorno(-3));
  ok(treGiorniFa.state === 'over' && treGiorniFa.days === 3, 'tre giorni fa: scaduto da 3');
}

// ===========================================================================
section('9. Statistiche documenti — l’insieme, e chi non ha analisi');
// ===========================================================================
// ⚠️ IL DIFETTO CHE QUESTI CONTROLLI SORVEGLIANO (misurato il 2026-08-15). La
// Panoramica contava `document_analyses` filtrando la sola azienda: quella
// tabella non conosce `archived_at`, quindi diceva «19 documenti» mentre
// l'archivio ne mostrava 2. Qui si prova che i conteggi partono dalle RIGHE che
// il chiamante ha scelto — attivi o archiviati, mai «tutte le analisi» — e che
// un documento senza analisi resta visibile invece di sparire.
{
  const riga = (over: Partial<DocumentStatsRow> = {}): DocumentStatsRow => ({
    id: 'd1', documentType: 'request_for_documents', language: 'it', deadline: null,
    analysisId: 'a1', hasAnalysis: true, ...over,
  });
  // Giorni fissi: le soglie si provano senza dipendere dal giorno in cui gira.
  const mai = () => null;
  const fra = (n: number) => () => n;

  const vuoto = buildDocumentStats([]);
  ok(vuoto.counted === 0 && vuoto.types.length === 0 && vuoto.urgency.media === 0,
    'nessuna riga: tutti i conteggi a zero, nessuna categoria inventata');

  // I 19 documenti di Rossi SA erano 14 media + 5 bassa: la stessa forma.
  const misti = buildDocumentStats([
    riga({ id: 'a', documentType: 'request_for_documents' }),
    riga({ id: 'b', documentType: 'payment_request' }),
    riga({ id: 'c', documentType: 'information' }),
    riga({ id: 'd', documentType: 'other', language: 'de' }),
  ], mai);
  ok(misti.urgency.media === 2 && misti.urgency.bassa === 2 && misti.urgency.alta === 0,
    'l’urgenza segue `urgencyFromType`: due tipi «medi», due che non lo sono');
  ok(misti.counted === 4, 'si contano le righe ricevute, non una tabella intera');
  ok(misti.languages.length === 2 && misti.languages[0].key === 'it' && misti.languages[0].n === 3,
    'le lingue si ordinano dalla più frequente');

  // ⚠️ IL CASO CHE HA MOTIVATO «si parte da documents»: un documento caricato e
  // mai letto. Partendo dalle analisi non esisteva; qui deve occupare una riga
  // in TUTTI e tre i grafici, così i tre totali restano lo stesso numero.
  const conOrfano = buildDocumentStats([
    riga({ id: 'a' }),
    riga({ id: 'b', hasAnalysis: false, analysisId: null, documentType: null, language: null }),
  ], mai);
  ok(conOrfano.withoutAnalysis === 1, 'un documento senza analisi si conta, non sparisce');
  ok(conOrfano.urgency.none === 1 && conOrfano.urgency.bassa === 0,
    'senza analisi NON è «bassa urgenza»: è l’assenza di una fascia, non la fascia più tranquilla');
  const sommaU = conOrfano.urgency.alta + conOrfano.urgency.media
    + conOrfano.urgency.bassa + conOrfano.urgency.none;
  const sommaT = conOrfano.types.reduce((n, b) => n + b.n, 0);
  const sommaL = conOrfano.languages.reduce((n, b) => n + b.n, 0);
  ok(sommaU === 2 && sommaT === 2 && sommaL === 2,
    'i tre grafici sommano allo STESSO numero: un solo denominatore per la sezione');

  // ⚠️ Un'assenza in cima a un grafico si legge come la categoria dominante.
  const orfaniInMaggioranza = buildDocumentStats([
    riga({ id: 'a', hasAnalysis: false, documentType: null, language: null }),
    riga({ id: 'b', hasAnalysis: false, documentType: null, language: null }),
    riga({ id: 'c', hasAnalysis: false, documentType: null, language: null }),
    riga({ id: 'd', documentType: 'invoice', language: 'fr' }),
  ], mai);
  ok(orfaniInMaggioranza.types[0].key === 'invoice'
    && orfaniInMaggioranza.types[orfaniInMaggioranza.types.length - 1].key === null,
    '«senza analisi» va in fondo anche quando è il gruppo più numeroso');

  // Le soglie non sono riscritte qui: si prova che vengono da `urgencyFromType`.
  ok(buildDocumentStats([riga({ deadline: '2026-01-01' })], fra(3)).urgency.alta === 1,
    'una scadenza vicina alza l’urgenza anche su un tipo tranquillo');
  ok(buildDocumentStats([riga({ documentType: 'information', deadline: '2026-01-01' })], fra(20)).urgency.media === 1,
    'fra dieci e trenta giorni: media');

  // ---- LA CONTROPROVA (§ «un test che non può fallire non è un test») -------
  // Si rifà il difetto vero: contare le righe come faceva la Panoramica, cioè
  // saltando i documenti senza analisi. Se i controlli qui sopra non vedessero
  // quel caso, questa riga passerebbe — e passare qui significa fallire.
  const comeFacevaLaPanoramica = (righe: DocumentStatsRow[]) =>
    buildDocumentStats(righe.filter((r) => r.hasAnalysis), mai);
  const difetto = comeFacevaLaPanoramica([
    riga({ id: 'a' }),
    riga({ id: 'b', hasAnalysis: false, documentType: null, language: null }),
  ]);
  ok(difetto.counted === 1 && difetto.withoutAnalysis === 0,
    'controprova: partendo dalle analisi il documento mai letto sparisce — è il difetto del 2026-08-15');
  ok(difetto.counted !== conOrfano.counted,
    'controprova: i due conteggi DEVONO divergere, altrimenti questi controlli non guardano niente');
}

// ===========================================================================
section('10. Il nome mostrato — la regola in LETTURA (§6)');
// ===========================================================================
// ⚠️⚠️ IL SEGUITO DEL CASO «2.5», quattro giorni dopo. La regola qui sopra era
// scritta, provata e usata in UN posto: la pagina di caricamento, cioè dove un
// titolo NASCE. Il documento «2.5» era già nel database, e il 2026-08-15 era la
// PRIMA RIGA della Panoramica. Una regola applicata solo in scrittura non
// protegge i dati già scritti — questi controlli guardano la LETTURA.
{
  ok(!titoloMostrabile('2.5', '2.5.pdf'), '«2.5» col file «2.5.pdf»: non è un titolo, è il file travestito');
  ok(!titoloMostrabile('', null), 'un titolo vuoto non si mostra');
  ok(!titoloMostrabile('  ', null), 'né uno fatto di spazi');
  ok(!titoloMostrabile('AB', null), 'due caratteri non sono un titolo');
  ok(!titoloMostrabile('2026', null), 'un anno non è un titolo: non c’è una lettera');
  ok(!titoloMostrabile('—', null), 'né un trattino');
  ok(!titoloMostrabile('###', null), 'né tre cancelletti');
  ok(titoloMostrabile('IVA', null), '«IVA» sì: tre caratteri e sono lettere');
  ok(titoloMostrabile('Fattura Swisscom', null), 'un titolo vero si mostra, ovviamente');

  // ⚠️ LA QUARTA CONDIZIONE VALE SOLO QUANDO IL NOME DEL FILE È MUTO. Un
  // titolo uguale a un nome di file che DICE qualcosa resta mostrabile:
  // rifiutarlo perché somiglia al file sarebbe zelo, e toglierebbe un titolo
  // buono a metà archivio.
  ok(titoloMostrabile('Disdetta locazione', 'Disdetta locazione.pdf'),
    'titolo uguale a un nome di file PARLANTE: si mostra');
  ok(!titoloMostrabile('2.5', '2.5.PDF'), 'il confronto col nome del file ignora le maiuscole');
  ok(titoloMostrabile('Fattura marzo', '2.5.pdf'),
    'un titolo buono su un file muto resta buono: le due cose sono indipendenti');

  // ⚠️ NESSUNA EURISTICA IN PIÙ. Un titolo dubbio che non ricade nelle quattro
  // condizioni SI MOSTRA: nascondere un titolo vero è peggio che mostrarne uno
  // brutto, ed è il modo in cui una regola come questa comincia a mentire.
  ok(titoloMostrabile('Doc', null), '«Doc» non è bello e non è vietato: si mostra');
  ok(titoloMostrabile('a1b', null), 'nemmeno «a1b» rientra nelle quattro condizioni');
}
{
  // ⚠️⚠️ IL RAMO CHE NON RIFIUTAVA NIENTE (2026-08-19). La quarta condizione —
  // «il titolo è il nome del file travestito» — chiudeva con
  // `base.length >= 3 && /\p{L}/u.test(base)`. Ma dentro quel ramo `base` È
  // `t`, e `t` ha già superato le stesse due prove dieci righe sopra: la
  // condizione era quindi SEMPRE VERA, e il ramo non rifiutava niente.
  //
  // Il difetto non si vedeva perché il caso che gli ha dato il nome cadeva
  // altrove: «2.5» viene rifiutato dal controllo sulle lettere, non da qui. A
  // passare erano i nomi che di lettere ne hanno — quelli di fotocamere,
  // scanner e sistemi operativi, cioè i nomi di file più diffusi al mondo.
  //
  // La domanda giusta era già scritta, già provata e a dieci righe di distanza:
  // `nomeFileInformativo`. ⚠️ I quattro casi qui sotto sono ROSSI sul codice
  // del 18 agosto — tutti e quattro tornavano `true`.
  ok(!titoloMostrabile('IMG_4821', 'IMG_4821.pdf'),
    'il nome di una fotocamera non diventa un titolo perché è finito in `title`');
  ok(!titoloMostrabile('Scan_2026-08-11', 'Scan_2026-08-11.pdf'),
    'né quello di uno scanner, con la data attaccata che dice QUANDO e mai CHE COSA');
  ok(!titoloMostrabile('documento (3)', 'documento (3).pdf'),
    'né «documento (3)»: ha lettere vere e non dice niente lo stesso');
  ok(!titoloMostrabile('Nuovo documento', 'Nuovo documento.pdf'),
    'né il nome che mette il sistema a un file appena creato');

  // ⚠️ LE CONTROPROVE PESANO QUANTO I ROSSI: una regola che rifiuta tutto è
  // inservibile quanto una che non rifiuta niente, e la differenza fra le due
  // non la mostra nessun caso negativo. Se un giorno il ramo diventasse un
  // `return false` secco, sono queste tre righe a diventare rosse.
  ok(titoloMostrabile('Disdetta locazione', 'Disdetta locazione.pdf'),
    'CONTROPROVA: un nome di file che DICE qualcosa resta un titolo');
  ok(titoloMostrabile('Fattura Swisscom', 'Fattura Swisscom.pdf'),
    'CONTROPROVA: e lo resta anche quando titolo e file coincidono in tutto');
  ok(titoloMostrabile('Fattura marzo', 'IMG_4821.pdf'),
    'CONTROPROVA: il ramo guarda solo la COINCIDENZA — un file muto non contagia un titolo vero');
}
{
  // I TRE LIVELLI DI COMPOSIZIONE, nell'ordine del §6.
  const conTutto = etichettaDocumento({
    titolo: '2.5', nomeFile: '2.5.pdf',
    mittente: 'Comune di Lugano', confidenza: 'alta', tipoDocumento: 'inspection_notice',
  });
  ok(conTutto.origine === 'mittente_e_tipo', 'mittente certo + tipo: si compone con tutti e due');

  const soloTipo = etichettaDocumento({ titolo: '2.5', nomeFile: '2.5.pdf', tipoDocumento: 'other' });
  ok(soloTipo.origine === 'tipo', 'senza mittente resta il tipo');

  const niente = etichettaDocumento({ titolo: '2.5', nomeFile: '2.5.pdf' });
  ok(niente.origine === 'nessuno', 'senza mittente e senza tipo: lo si DICE');

  // ⚠️ IL MITTENTE DA SOLO NON È UN'ETICHETTA: «Comune di Lugano» come nome di
  // un documento fa credere che il documento SIA il Comune.
  const soloMittente = etichettaDocumento({
    titolo: '2.5', nomeFile: '2.5.pdf', mittente: 'Comune di Lugano', confidenza: 'alta',
  });
  ok(soloMittente.origine === 'nessuno', 'il mittente da solo non compone: i livelli sono tre');

  const buono = etichettaDocumento({ titolo: 'Rendiconto IVA', tipoDocumento: 'vat_statement' });
  ok(buono.origine === 'titolo' && buono.titolo === 'Rendiconto IVA',
    'quando il titolo è mostrabile non si compone niente: vince lui');
  ok(!etichettaComposta(buono) && etichettaComposta(soloTipo),
    '«composta» distingue i due casi: è ciò che il dettaglio dichiara a chi legge');
}
{
  // ⚠️ MAI COMPORRE DA DATI INCERTI. Un ente sbagliato incollato davanti al
  // tipo produce un'etichetta che SEMBRA precisa: è il difetto di «2.5» con una
  // casella in più.
  const bassa = etichettaDocumento({
    titolo: '2.5', nomeFile: '2.5.pdf',
    mittente: 'Comune di Lugano', confidenza: 'bassa', tipoDocumento: 'other',
  });
  ok(bassa.origine === 'tipo', 'mittente a bassa confidenza: si scende di livello, non si usa');

  const senzaConfidenza = etichettaDocumento({
    titolo: '2.5', nomeFile: '2.5.pdf', mittente: 'Comune di Lugano', tipoDocumento: 'other',
  });
  ok(senzaConfidenza.origine === 'tipo',
    'confidenza ASSENTE non vale «alta»: non aver guardato non è aver visto');

  // …ma una CORREZIONE UMANA batte la confidenza dell'analisi: quel mittente
  // l'ha verificato una persona.
  const corretto = etichettaDocumento({
    titolo: '2.5', nomeFile: '2.5.pdf', mittente: 'Comune di Lugano',
    mittenteCorretto: true, confidenza: 'bassa', tipoDocumento: 'other',
  });
  ok(corretto.origine === 'mittente_e_tipo', 'un mittente corretto a mano si usa, qualunque cosa dica l’analisi');
}
{
  // ⚠️ IL TITOLO SCRITTO A MANO VINCE SEMPRE, senza un ramo dedicato: se una
  // persona scrive qualcosa di leggibile nel campo «Titolo», quel valore è il
  // titolo e `titoloMostrabile` lo lascia passare. La regola smette di
  // intervenire da sola — che è il punto 5 del §6.
  const scritto = etichettaDocumento({
    titolo: 'Contestazione tassa rifiuti', nomeFile: '2.5.pdf',
    mittente: 'Comune di Lugano', confidenza: 'alta', tipoDocumento: 'inspection_notice',
  });
  ok(scritto.origine === 'titolo' && scritto.titolo === 'Contestazione tassa rifiuti',
    'titolo scritto a mano: nessuna composizione, vince lui');
}
{
  // L'adattatore delle letture che incorporano l'analisi (contratti, CRM,
  // Inbox, selettore): la scelta dell'ultima analisi VALIDA sta in un posto solo.
  const riga = {
    title: '2.5', original_filename: '2.5.pdf',
    document_analyses: [
      { sender: 'Vecchio', document_type: 'invoice', confidence: 'alta', analysis_status: 'completed', created_at: '2026-01-01T00:00:00Z' },
      { sender: 'Nuovo', document_type: 'other', confidence: 'alta', analysis_status: 'completed', created_at: '2026-06-01T00:00:00Z' },
    ],
  };
  const e = etichettaDaRigaDocumento(riga);
  ok(e.origine === 'mittente_e_tipo' && e.mittente === 'Nuovo',
    'fra due analisi vince la più recente, come in `list_documents`');

  const conFallita = etichettaDaRigaDocumento({
    ...riga,
    document_analyses: [
      { sender: 'Buono', document_type: 'invoice', confidence: 'alta', analysis_status: 'completed', created_at: '2026-01-01T00:00:00Z' },
      { sender: null, document_type: null, confidence: null, analysis_status: 'failed', created_at: '2026-09-01T00:00:00Z' },
    ],
  });
  ok(conFallita.origine === 'mittente_e_tipo' && conFallita.mittente === 'Buono',
    'un ultimo tentativo FALLITO non cancella il risultato buono precedente');

  ok(etichettaDaRigaDocumento({ title: '2.5', original_filename: '2.5.pdf', document_analyses: [] }).origine === 'nessuno',
    'nessuna analisi: non c’è di che comporre, e lo si dice');
  ok(etichettaDaRigaDocumento(null).origine === 'nessuno', 'riga assente: nessuna eccezione, l’ultimo livello');
}
{
  // ---- LA CONTROPROVA -----------------------------------------------------
  // Si rifà il difetto vero: mostrare `documents.title` così com'è, che è
  // quello che facevano Panoramica, elenco e dettaglio fino al 2026-08-15.
  const comeFacevanoLeSchermate = (titolo: string) => titolo;
  const grezzo = comeFacevanoLeSchermate('2.5');
  const e = etichettaDocumento({ titolo: '2.5', nomeFile: '2.5.pdf', tipoDocumento: 'other' });
  ok(grezzo === '2.5' && e.origine !== 'titolo',
    'controprova: il titolo grezzo è ancora «2.5» — non è stato cancellato, cambia solo cosa si mostra');
  ok(e.origine === 'tipo' && (e as { tipo: string }).tipo === 'other',
    'controprova: la regola DEVE dare un esito diverso dal grezzo, altrimenti non guarda niente');
}

// ===========================================================================
section('11. Il guardiano: nessuna schermata legge il titolo grezzo');
// ===========================================================================
// ⚠️ PERCHÉ UN CONTROLLO SUL CODICE E NON SOLO SULLA REGOLA. La regola del
// titolo esisteva dall'11 agosto, era provata, ed era usata in UN posto: fra il
// dato e lo schermo nessuno la chiamava. Un controllo che guarda le REGOLE non
// avrebbe visto niente — erano tutte verdi — perché il difetto non era nella
// regola: era che le schermate non la usavano. Questo controllo guarda le
// schermate.
//
// ⚠️ Un'eccezione dichiarata resta possibile e deve stare QUI, con il motivo:
// il campo «Titolo» dell'organizzazione DEVE mostrare il valore grezzo, perché
// è quello che si sta modificando.
{
  const ECCEZIONI: { file: string; frammento: string; perche: string }[] = [
    {
      file: 'src/features/documents/DocumentDetailPage.tsx',
      frammento: 'value={title ?? doc.title}',
      perche: 'il campo «Titolo» modifica il dato vero: deve mostrare il grezzo',
    },
    {
      file: 'src/features/crm/ClientDetailPage.tsx',
      frammento: '{d.title}',
      perche: 'è il titolo di un’OPPORTUNITÀ, non di un documento: lo scrive una persona',
    },
  ];

  const SCHERMATE = [
    // La Panoramica: l'esempio del blocco decisioni è un titolo di documento,
    // e la prima riga di quella pagina è già stata «2.5» una volta.
    'src/features/dashboard/HomePage.tsx',
    'src/features/documents/DocumentsPage.tsx',
    'src/features/documents/DocumentDetailPage.tsx',
    'src/features/admin-ai/ResultView.tsx',
    'src/features/inbox/MessageDetail.tsx',
    'src/features/crm/ClientDetailPage.tsx',
    'src/features/contracts/ContractDetailPage.tsx',
    'src/features/finance/FinancePage.tsx',
    'src/features/finance/FinanceDetailPage.tsx',
  ];
  // Le forme con cui un titolo grezzo finisce a schermo: dentro le graffe di
  // JSX, oppure passato a una proprietà.
  const SOSPETTI = [
    // Dentro una qualunque espressione JSX, non solo da sola: `{title ?? doc.title}`
    // finisce a schermo esattamente come `{doc.title}`.
    /\{[^}]*\b(?:doc|document|item|d)\.title\b[^}]*\}/,
    /\{[^}]*\bitem\.documentTitle\b[^}]*\}/,
    /\btitle:\s*(?:doc|document|item|d)\.title\b/,
    /\btitle:\s*item\.documentTitle\b/,
  ];

  let usateEccezioni = 0;
  for (const file of SCHERMATE) {
    const testo = readFileSync(file, 'utf8');
    const righe = testo.split('\n');
    const colpevoli: string[] = [];
    righe.forEach((riga, i) => {
      if (!SOSPETTI.some((re) => re.test(riga))) return;
      const scusa = ECCEZIONI.find((e) => e.file === file && riga.includes(e.frammento));
      if (scusa) { usateEccezioni++; return; }
      colpevoli.push(`${i + 1}: ${riga.trim()}`);
    });
    ok(colpevoli.length === 0, `${file} non mostra il titolo grezzo`, colpevoli.join('\n     '));
  }
  // ⚠️ Un'eccezione MORTA fa fallire il controllo: una riga che non corrisponde
  // più a niente nel codice è una scusa che nessuno ha ritirato.
  ok(usateEccezioni === ECCEZIONI.length,
    'ogni eccezione dichiarata corrisponde a una riga vera',
    `dichiarate ${ECCEZIONI.length}, trovate ${usateEccezioni}`);

  // E la regola deve essere DAVVERO importata dove serve: un file che non la
  // nomina non può applicarla, per quanto non mostri `doc.title`.
  for (const file of SCHERMATE) {
    const testo = readFileSync(file, 'utf8');
    ok(/useDocumentLabel|documentLabelText|titoloMostrabile|etichettaDocumento/.test(testo),
      `${file} passa dalla regola del nome`);
  }
}

// ===========================================================================
section('12. Il guardiano: la correzione umana arriva fino alla regola');
// ===========================================================================
// ⚠️ LA GUARDIA SCOLLEGATA, la stessa forma già usata per `safeWebsite` nel
// CRM. `test:validate` prova che `deadlineRequiresVerification` sa spegnersi
// quando una persona ha corretto la scadenza — ma resterebbe verde anche se
// nessuno le passasse mai quell'ingresso, e una regola giusta che non chiama
// nessuno non protegge niente. È esattamente il difetto del titolo «2.5»: la
// regola c'era, il chiamante no.
//
// ⚠️⚠️ SI LEGGE IL CODICE SENZA COMMENTI. Una guardia a espressione regolare
// sui sorgenti legge anche ciò che è scritto dentro un commento: il 18 agosto
// una guardia di questo repository è nata rossa da sola per questo motivo, e
// qui sotto `analysisService.ts` PARLA di `corrected` in un commento senza
// passarlo. Senza questa riga, il controllo direbbe il contrario del vero.
{
  const senzaCommenti = (t: string) => t
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const chiamata = (file: string): string | null => {
    const src = senzaCommenti(readFileSync(file, 'utf8'));
    const i = src.indexOf('deadlineRequiresVerification({');
    if (i < 0) return null;
    const fine = src.indexOf('})', i);
    return fine < 0 ? src.slice(i) : src.slice(i, fine + 2);
  };

  const hub = chiamata('src/services/documentHubService.ts');
  ok(hub !== null, 'documentHubService chiama ancora la regola in lettura');
  ok(!!hub && /corrected:\s*row\.deadline_corrected === true/.test(hub),
    'e le passa la correzione umana, dalla stessa colonna che accende la pastiglia «corretto»',
    hub ?? '(nessuna chiamata)');

  // ⚠️ LA SCHERMATA CHE MOSTRAVA LA CONTRADDIZIONE. Le due righe stanno nello
  // stesso `<Field>`: il segno che dice «da verificare» e la pastiglia che dice
  // «l'ha corretta una persona». Se un giorno il segno tornasse a leggere una
  // fonte diversa da quella che accende la pastiglia, le due si scollegherebbero
  // di nuovo — e nessuna prova sulle funzioni pure se ne accorgerebbe.
  const scheda = senzaCommenti(
    readFileSync('src/features/documents/DocumentDetailPage.tsx', 'utf8'));
  ok(/toVerify=\{item\.deadlineRequiresVerification\}/.test(scheda)
    && /corrected=\{item\.deadlineCorrected\}/.test(scheda),
    'la scheda legge il segno e la pastiglia dallo STESSO oggetto: non possono più divergere');

  // ⚠️ E `analysisService` NON deve fingere di saperlo. `document_analyses` non
  // ha una colonna di correzione — le correzioni stanno in
  // `analysis_corrections`, perché l'analisi è un verbale immutabile (0010) —
  // quindi da quella riga il vero valore è «non si può sapere». Scrivere
  // `corrected: false` sarebbe affermare «nessuno l'ha corretta», che è un'altra
  // cosa e non è provata: è il fallback silenzioso che questo progetto rifiuta.
  const analisi = chiamata('src/services/analysisService.ts');
  ok(analisi !== null, 'analysisService chiama ancora la regola in lettura');
  ok(!!analisi && !/corrected:/.test(analisi),
    'analysisService NON passa `corrected`: da document_analyses quel fatto non si legge',
    analisi ?? '(nessuna chiamata)');
}

// ===========================================================================
section('13. Duecento identificativi non entrano in un URL');
// ===========================================================================
// ⚠️⚠️ IL LIMITE È DEL TRASPORTO, NON DELLA QUERY. PostgREST riceve i filtri
// nella query string, e un URL oltre gli 8 kB viene rifiutato dal server prima
// di diventare un'interrogazione: non un risultato sbagliato, un guasto secco.
// `trustSignals` legge fino a `STATS_MAX_DOCUMENTS` documenti e senza blocchi
// li passerebbe tutti a una `.in(...)` sola — quindi il tetto non è teorico, è
// il caso NORMALE di un'azienda con molti documenti, e toccherebbe per primo
// chi ne ha di più. (Qui viveva la stessa prova su `avanzamento`, morto con la
// Panoramica vecchia: la classe di guasto resta, il chiamante è cambiato.)
//
// ⚠️ IL COSTO SI MISURA, non si stima: le due righe qui sotto costruiscono il
// filtro come lo scrive PostgREST e lo PESANO. È la parte che rende questa
// sezione una prova e non un'opinione sul numero 80.
{
  const UUID = '00000000-0000-4000-8000-000000000000';
  const pesoFiltro = (ids: readonly string[]): number =>
    `in.(${ids.map((i) => `"${i}"`).join(',')})`.length;

  // ⚠️ Il tetto si LEGGE dal servizio invece di riscriverlo qui: se un giorno
  // salisse, questa sezione deve misurare il numero nuovo, non quello di oggi.
  const servizio = readFileSync('src/services/documentHubService.ts', 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
  const tetto = Number(/STATS_MAX_DOCUMENTS = (\d+)/.exec(servizio)?.[1] ?? 0);
  ok(tetto >= 100, 'il tetto delle analisi lette si trova nel servizio', String(tetto));

  const tutti = Array.from({ length: tetto }, () => UUID);
  ok(pesoFiltro(tutti) > 7000,
    `CONTROPROVA: ${tetto} identificativi sfiorano davvero gli 8 kB`,
    `${pesoFiltro(tutti)} byte di solo filtro, senza il resto dell'indirizzo`);

  const blocchi = aBlocchi(tutti, BLOCCO_IN);
  const piuPesante = Math.max(...blocchi.map(pesoFiltro));
  ok(piuPesante < 4000,
    'a blocchi il filtro più pesante sta LARGAMENTE sotto il limite',
    `${piuPesante} byte`);

  // La somma dei conteggi è il conteggio solo se i blocchi sono disgiunti e
  // non perdono niente: è l'unica proprietà che la correzione deve garantire.
  ok(blocchi.flat().length === tutti.length,
    'i blocchi rimettono insieme esattamente l\'elenco di partenza');
  ok(blocchi.every((b) => b.length <= BLOCCO_IN) && blocchi.length === Math.ceil(tetto / BLOCCO_IN),
    `${tetto} in blocchi da ${BLOCCO_IN} fanno ${Math.ceil(tetto / BLOCCO_IN)} richieste, nessuna oltre il tetto`,
    blocchi.map((b) => b.length).join('+'));

  // I casi limite, che è il motivo per cui la funzione è pura e sta fuori dal
  // servizio: nel servizio si scoprirebbero in produzione.
  ok(aBlocchi([], BLOCCO_IN).length === 0,
    'un elenco vuoto non produce una richiesta a vuoto');
  ok(JSON.stringify(aBlocchi([1, 2, 3], 80)) === '[[1,2,3]]',
    'un elenco più corto del blocco resta una richiesta sola');
  ok(JSON.stringify(aBlocchi([1, 2, 3, 4], 2)) === '[[1,2],[3,4]]',
    'una divisione esatta non lascia un blocco vuoto in coda');

  // ⚠️ LA GUARDIA SCOLLEGATA. Le prove qui sopra restano verdi anche se il
  // servizio continuasse a passare l'elenco intero: la funzione giusta che non
  // chiama nessuno non protegge niente. Senza commenti, perché il blocco che
  // stai leggendo nomina `.in(` e `documentIds`.
  ok(/\.in\('document_id', blocco\)/.test(servizio)
    && /aBlocchi\(documentIds, BLOCCO_IN\)/.test(servizio),
    'e il servizio interroga UN BLOCCO per volta, non l\'elenco intero');
  ok(!/\.in\('document_id', documentIds\)/.test(servizio),
    'l\'elenco intero non finisce più in una `.in(...)` sola');
}

// ===========================================================================
section('14 · L\'attendibilità dell\'analisi — i tetti, e ciò che NON è un tetto');
{
  const trust = (over: Partial<TrustInput> = {}): TrustVerdict => analysisTrust({
    modelLevel: 'alta', recipient: null, uncertainties: [],
    deadline: null, deadlineKind: null, deadlineType: null,
    deadlineRequiresVerificationRaw: false, analysedAt: '2026-08-18T00:00:00Z',
    campi: {}, company: { legalName: 'Rossi SA', memberSurnames: ['Cavalieri'] },
    ...over,
  });
  const punto = (field: string, severity: AnalysisUncertainty['severity']): AnalysisUncertainty =>
    ({ field, severity, description: `dubbio su ${field}` });
  const campo = (hasValue: boolean, hasChannel: boolean, hasEvidence: boolean) =>
    ({ hasValue, hasChannel, hasEvidence });

  // --- niente da eccepire: passa il livello del modello ---------------------
  ok(trust().level === 'alta', 'senza tetti passa il livello del modello');
  ok(trust().caps.length === 0, 'e non dichiara tetti che non ci sono');
  ok(trust({ modelLevel: 'bassa' }).level === 'bassa', 'il tetto non ALZA mai il livello del modello');

  // --- il conteggio dei punti NON è un tetto (la regola ritirata) -----------
  const seiPuntiInnocui = trust({
    uncertainties: [
      punto('language', 'low'), punto('language', 'low'), punto('content', 'low'),
      punto('security', 'low'), punto('amounts.currency', 'low'), punto('language', 'low'),
    ],
  });
  ok(seiPuntiInnocui.level === 'alta',
    'SEI punti da verificare, tutti low o su campi non portanti, NON abbassano niente');
  ok(seiPuntiInnocui.pointCount === 6,
    'ma il conteggio resta un fatto suo, da mostrare accanto al livello');
  // ⚠️ CONTROPROVA: è il caso che faceva fallire la regola vecchia. Se un
  // giorno tornasse un tetto sul NUMERO, questa riga diventa rossa.
  ok(seiPuntiInnocui.caps.length === 0,
    'CONTROPROVA: il numero dei punti non compare fra i tetti');

  // --- i punti pesano per GRAVITÀ e per campo -------------------------------
  ok(trust({ uncertainties: [punto('deadline', 'high')] }).level === 'bassa',
    'un punto high su campo portante porta a bassa');
  ok(trust({ uncertainties: [punto('deadline', 'medium')] }).level === 'media',
    'un punto medium su campo portante porta a media');
  ok(trust({ uncertainties: [punto('deadline', 'low')] }).level === 'alta',
    'un punto low non porta alcun tetto');
  ok(trust({ uncertainties: [punto('language', 'high')] }).level === 'alta',
    'un punto high su campo NON portante non porta alcun tetto');
  ok(trust({ uncertainties: [punto('sender.authorityType', 'high')] }).level === 'bassa',
    'il sotto-attributo conta come il campo: sender.authorityType è mittente');
  ok(trust({ uncertainties: [punto('authenticity', 'high')] }).level === 'bassa',
    'eccezione dichiarata: authenticity high vale come campo portante');
  ok(trust({ uncertainties: [punto('authenticity', 'medium')] }).level === 'alta',
    'ma authenticity MEDIUM no: l\'eccezione è solo per la gravità alta');
  ok(trust({ uncertainties: [punto('deadline', 'high'), punto('sender', 'medium')] }).binding?.reason === 'point_high',
    'con high e medium insieme decide il high');

  // --- l'evidenza, solo dove il canale esiste -------------------------------
  ok(trust({ campi: { sender: campo(true, true, false) } }).level === 'media',
    'un campo portante CON canale e senza citazione porta a media');
  ok(trust({ campi: { sender: campo(true, true, false), deadline: campo(true, true, false) } }).level === 'bassa',
    'due campi idem portano a bassa');
  // ⚠️ CONTROPROVA: è il difetto che la sonda ha trovato. Un campo SENZA
  // canale non deve abbassare niente — sarebbe una lacuna nostra addebitata
  // al documento, e portava ogni analisi a «bassa» per costruzione.
  ok(trust({
    campi: { recipient: campo(true, false, false), documentDate: campo(true, false, false) },
  }).level === 'alta',
    'CONTROPROVA: due campi SENZA canale non abbassano nulla');
  ok(trust({ campi: { recipient: campo(true, false, false) } }).campiSenzaCanale.includes('recipient'),
    'e la lacuna viene dichiarata, per dirla una volta sola nei dettagli tecnici');
  ok(trust({ campi: { deadline: campo(false, true, false) } }).level === 'alta',
    'un campo senza VALORE non è un campo senza citazione');

  // --- la scadenza ----------------------------------------------------------
  ok(trust({ deadline: null, deadlineType: 'inferred' }).level === 'alta',
    'CONTROPROVA: «scadenza dedotta» senza una data non abbassa niente (6 righe nel database)');
  ok(trust({ deadline: '2027-01-22', deadlineKind: 'term', deadlineType: 'inferred' }).level === 'bassa',
    'con la data, la scadenza dedotta porta a bassa');
  ok(trust({ deadline: '2027-01-22', deadlineKind: 'term', deadlineRequiresVerificationRaw: true }).level === 'media',
    'la scadenza marcata «da verificare» dal validatore porta a media');
  // ⚠️ La precedenza dichiarata: la LETTURA vince sul flag grezzo.
  const naturaMai = trust({
    deadline: '2027-01-22', deadlineKind: null, deadlineRequiresVerificationRaw: false,
    analysedAt: '2026-07-30T21:45:35Z',
  });
  ok(naturaMai.level === 'media',
    'natura mai dichiarata: «da verificare» anche se il flag grezzo dice false');
  ok(naturaMai.binding?.reason === 'deadline_nature_unrecorded' && naturaMai.binding.fromOurGap,
    'e il motivo dice che il tetto nasce da una LACUNA NOSTRA, non dal documento');
  const naturaNonRisposta = trust({
    deadline: '2027-01-22', deadlineKind: null, analysedAt: '2026-08-18T00:00:00Z',
  });
  ok(naturaNonRisposta.binding?.reason === 'deadline_to_verify' && !naturaNonRisposta.binding.fromOurGap,
    'dopo la 0040 la stessa assenza è del DOCUMENTO: il campo c\'era e nessuno ha risposto');

  // --- l'appartenenza: una condizione a sé ----------------------------------
  const altrui = trust({ recipient: 'Hype My Media' });
  ok(altrui.level === null && altrui.unavailable === 'ownership',
    'destinatario che nomina un\'altra organizzazione: l\'indicatore SPARISCE');
  ok(altrui.level !== 'bassa', 'e non scende a «bassa»: non è un quarto livello');
  ok(trust({ recipient: 'Rossi SA' }).level === 'alta', 'la stessa azienda non fa scattare niente');
  ok(trust({ recipient: 'Rossi' }).level === 'alta', 'e la forma giuridica non conta: «Rossi» è «Rossi SA»');
  // ⚠️ I DUE FALSI POSITIVI trovati sul database vero.
  ok(trust({ recipient: 'Spettabile Ditta' }).level === 'alta',
    'CONTROPROVA: una formula di cortesia non è un\'altra azienda');
  ok(trust({ recipient: 'signor Cavalieri' }).level === 'alta',
    'CONTROPROVA: una persona il cui cognome è fra i membri non è un\'altra azienda');
  ok(trust({ recipient: 'signor Bianchi' }).level === null,
    'una persona che NON risulta fra i membri è invece un soggetto diverso');
  ok(trust({ recipient: 'signor Bianchi', company: { legalName: 'Rossi SA' } }).level === 'alta',
    'ma senza l\'elenco dei membri il cognome non è confrontabile, e non scatta nulla');
  ok(trust({ recipient: null }).level === 'alta',
    'CONTROPROVA: destinatario assente NON è appartenenza in dubbio');
  const soloPunto = trust({ recipient: null, uncertainties: [punto('recipient', 'high')] });
  ok(soloPunto.level === null && soloPunto.ownership.doubt && soloPunto.ownership.via === 'punto',
    'ma un punto high su «recipient» sì, anche col destinatario vuoto (2 righe nel database)');
  ok(trust({ recipient: null, uncertainties: [punto('recipient', 'medium')] }).level === 'media',
    'un punto MEDIUM su recipient è un tetto, non un dubbio di appartenenza');
  const concordi = trust({ recipient: 'Hype My Media', uncertainties: [punto('recipient', 'high')] }).ownership;
  ok(concordi.doubt && concordi.via === 'entrambi',
    'quando concordano, il verdetto lo dice: nome e punto insieme');

  // --- il segno di campo -----------------------------------------------------
  ok(segnoCampo('sender', campo(true, true, true), []) === 'evidenza', 'canale + citazione → «mostra nel documento»');
  ok(segnoCampo('sender', campo(true, true, false), []) === 'senza-evidenza', 'canale senza citazione → «senza evidenza verificata»');
  ok(segnoCampo('recipient', campo(true, false, false), [punto('recipient', 'medium')]) === 'da-verificare',
    'nessun canale ma un punto del modello sul campo → «da verificare»');
  ok(segnoCampo('recipient', campo(true, false, false), []) === null,
    'nessun canale e nessun punto → nessun segno (la lacuna si dice una volta sola)');
  ok(segnoCampo('deadline', campo(false, true, false), []) === null, 'un campo senza valore non porta segni');

  // --- i due casi VERI, presi dal database ----------------------------------
  // Stripe Radar, analisi e1996764 del 30.07.2026.
  const stripe = trust({
    modelLevel: 'alta', recipient: 'Hype My Media', analysedAt: '2026-07-30T21:45:35Z',
    deadline: '2027-01-22', deadlineKind: null, deadlineType: 'explicit',
    deadlineRequiresVerificationRaw: false,
    uncertainties: [punto('recipient', 'high'), punto('documentDate', 'medium'), punto('deadline', 'low')],
    campi: {
      sender: campo(true, true, true), deadline: campo(true, true, true),
      amounts: campo(true, true, true), recipient: campo(true, false, false),
      documentType: campo(true, false, false), documentDate: campo(false, false, false),
    },
  });
  ok(stripe.level === null && stripe.unavailable === 'ownership',
    'Stripe Radar: non valutabile, appartenenza da confermare');
  ok(stripe.pointCount === 3, 'Stripe Radar: 3 elementi da verificare, mostrati accanto');
  // e dopo la conferma dell'appartenenza il livello dev'essere «bassa»
  // ⚠️ LA CONFERMA È UN INGRESSO, NON UN VALORE RISCRITTO: il destinatario
  // resta «Hype My Media» nello snapshot, e il punto high su `recipient` resta
  // dov'è. Confermare risponde a «di chi è», non a «quanto è affidabile».
  const stripeConfermato = trust({
    modelLevel: 'alta', recipient: 'Hype My Media', analysedAt: '2026-07-30T21:45:35Z',
    deadline: '2027-01-22', deadlineKind: null, deadlineType: 'explicit',
    uncertainties: [punto('recipient', 'high'), punto('documentDate', 'medium'), punto('deadline', 'low')],
    ownershipConfirmed: true,
  });
  ok(stripeConfermato.level === 'bassa',
    'Stripe Radar, dopo la conferma: il livello diventa «bassa»');
  ok(stripeConfermato.binding?.reason === 'point_high',
    'e il tetto che decide è il punto high su «recipient», che la conferma non cancella');
  // ⚠️ CONTROPROVA: senza l'ingresso della conferma l'avviso tornerebbe per
  // sempre, perché lo snapshot è immutabile e il punto non se ne va.
  ok(trust({
    modelLevel: 'alta', recipient: 'Hype My Media',
    uncertainties: [punto('recipient', 'high')],
  }).level === null,
    'CONTROPROVA: senza conferma lo stesso snapshot resta non valutabile');

  // Comune di Lugano — l'unico «media» interessante dell'archivio.
  const lugano = trust({
    modelLevel: 'alta', recipient: 'Spettabile Ditta', analysedAt: '2026-07-30T00:00:00Z',
    deadline: '2026-09-10', deadlineKind: null, deadlineType: 'explicit',
    deadlineRequiresVerificationRaw: false,
    uncertainties: [punto('documentDate', 'low')],
    campi: { sender: campo(true, true, true), deadline: campo(true, true, true) },
  });
  ok(lugano.level === 'media', 'Comune di Lugano: modello «alta», mostrato «media»');
  ok(lugano.binding?.reason === 'deadline_nature_unrecorded',
    'e il motivo è la natura della data mai registrata');
  ok(lugano.binding?.fromOurGap === true,
    'che è una lacuna NOSTRA: la riga non deve offrire «Correggi»');
}

// ===========================================================================
section('15 · L\'adattatore dal dominio, la conferma di appartenenza, la rubrica');
{
  // --- trustInputFromAnalysis: i canali sono scritti UNA volta, qui ---------
  const a = analisi({
    recipient: 'Hype My Media',
    deadline: '2027-01-22', deadlineKind: null, deadlineType: 'explicit',
    deadlineRequiresVerification: true,
    senderEvidence: { quote: 'Il team di Stripe', start: 0, end: 17 },
    deadlineEvidence: { quote: 'il 22 gennaio 2027', start: 0, end: 18 },
    amount: 0.05, amountEvidence: null,
    uncertaintyItems: [{ field: 'recipient', description: 'dubbio', severity: 'high' }],
  });
  const inp = trustInputFromAnalysis(a, { legalName: 'Rossi SA', memberSurnames: ['Cavalieri'] });
  ok(inp.campi.sender?.hasChannel === true && inp.campi.sender.hasEvidence === true,
    'mittente: canale e citazione presenti arrivano al verdetto');
  ok(inp.campi.amounts?.hasChannel === true && inp.campi.amounts.hasEvidence === false,
    'importi: canale presente, citazione assente — è il caso che il tetto sull\'evidenza pesa');
  ok(inp.campi.recipient?.hasChannel === false && inp.campi.documentType?.hasChannel === false
    && inp.campi.documentDate?.hasChannel === false,
    'destinatario, tipo e data: SENZA canale — la lacuna è nostra, dichiarata nell\'adattatore');
  ok(inp.ownershipConfirmed === undefined || inp.ownershipConfirmed === false,
    'senza terzo argomento la conferma non si presume');
  // Il flag EFFETTIVO al posto del grezzo è un'equivalenza, non un ripiego:
  // quando la natura non è dichiarata il flag non viene consultato.
  const v = analysisTrust(inp);
  ok(v.level === null && v.unavailable === 'ownership',
    'e il verdetto sul caso Stripe ricostruito dal dominio resta «non valutabile»');
  ok(analysisTrust(trustInputFromAnalysis(a, { legalName: 'Rossi SA' }, true)).level === 'bassa',
    'con la conferma passata dall\'adattatore il livello diventa «bassa»');

  // --- ownershipConfirmation: vince la riga più RECENTE ---------------------
  const riga = (value: string, at: string) =>
    ({ field: OWNERSHIP_FIELD, correctedValue: value, correctedBy: 'u1', correctedAt: at });
  ok(ownershipConfirmation([]) === null, 'nessuna riga: nessuna conferma');
  ok(ownershipConfirmation([riga(OWNERSHIP_CONFIRMED, '2026-08-19T10:00:00Z')]) !== null,
    'una conferma vale');
  ok(ownershipConfirmation([
    riga(OWNERSHIP_CONFIRMED, '2026-08-19T10:00:00Z'),
    riga(OWNERSHIP_REVOKED, '2026-08-19T11:00:00Z'),
  ]) === null, 'la revoca SUPERA la conferma: vince la riga più recente');
  ok(ownershipConfirmation([
    riga(OWNERSHIP_REVOKED, '2026-08-19T10:00:00Z'),
    riga(OWNERSHIP_CONFIRMED, '2026-08-19T11:00:00Z'),
  ]) !== null, 'e una conferma dopo la revoca vale di nuovo');
  ok(ownershipConfirmation([
    riga(OWNERSHIP_REVOKED, '2026-08-19T11:00:00Z'),
    riga(OWNERSHIP_CONFIRMED, '2026-08-19T10:00:00Z'),
  ]) === null, 'CONTROPROVA: l\'ordine delle righe non conta, conta il tempo');
  ok(ownershipConfirmation([
    { field: 'sender', correctedValue: OWNERSHIP_CONFIRMED, correctedBy: 'u1', correctedAt: '2026-08-19T12:00:00Z' },
  ]) === null, 'una correzione di un ALTRO campo non è una conferma');

  // --- cognomiDaRubrica ------------------------------------------------------
  ok(JSON.stringify(cognomiDaRubrica(['Andrea Cavalieri', 'Maria Pilota'])) === '["Cavalieri","Pilota"]',
    'la rubrica dà nomi completi: il cognome è l\'ultima parola');
  ok(cognomiDaRubrica(['', '  ']).length === 0,
    'un nome vuoto non produce un cognome inventato');
}

// ===========================================================================
section('16. Il guardiano: nessuna schermata mostra il livello grezzo');
// ⚠️⚠️ PERCHÉ ESISTE. Il livello mostrato è min(modello, tetti) e lo decide
// `analysisTrust` in un posto solo: una schermata che stampasse di nuovo
// `analysis.confidence` come livello riaprirebbe il difetto — «alta» sopra un
// documento che potrebbe non essere nostro. Qui si leggono i SORGENTI delle
// schermate che il 2026-08-19 lo facevano, e si pretende che non lo facciano
// più e che passino dalla funzione.
// ⚠️ I COMMENTI SI TOLGONO PRIMA DI LEGGERE (l'idioma di test-shell-unit): un
// lettore a regex non distingue una riga che fa una cosa da una che la
// racconta — la guardia di scope.ts è nata rossa così.
{
  const senzaCommenti = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const leggi = (f: string) => senzaCommenti(readFileSync(f, 'utf8'));

  const dettaglio = leggi('src/features/documents/DocumentDetailPage.tsx');
  ok(!/ConfidenceBadge\s+level=\{item\.confidence/.test(dettaglio),
    'il dettaglio non stampa più il campo grezzo come voce dell\'elenco');
  ok(/analysisTrust\(trustInput\)/.test(dettaglio) && /trustInputFromAnalysis\(analysis/.test(dettaglio),
    'il dettaglio passa dalla funzione di lettura');
  ok(/segnoCampo\(/.test(dettaglio),
    'e i campi senza canale prendono il segno da segnoCampo, non da «senza evidenza»');
  ok(/TrustIndicator/.test(dettaglio), 'e l\'indicatore sta nell\'intestazione della scheda');
  ok(/if \(!step\.canCreateTask\) return;/.test(dettaglio),
    'il gate dell\'appartenenza protegge l\'unico ingresso del modulo attività');
  ok(/ownershipDoubt \? \{ \.\.\.stepRaw, canCreateTask: false \}/.test(dettaglio),
    'e con l\'appartenenza in dubbio la creazione di attività è spenta');
  ok(/documents\.trust\.readingLabel/.test(dettaglio),
    'il valore grezzo resta leggibile nei dettagli tecnici, col suo nome');

  const resultView = leggi('src/features/admin-ai/ResultView.tsx');
  ok(!/ConfidenceBadge\s+level=\{r\.confidence/.test(resultView),
    'Admin AI non stampa più il campo grezzo in testata');
  ok(/useAnalysisTrust\(/.test(resultView), 'Admin AI passa dal verdetto');

  const messaggio = leggi('src/features/inbox/MessageDetail.tsx');
  ok(!/ConfidenceBadge\s+level=\{analysis\.confidence/.test(messaggio),
    'la Posta in arrivo non stampa più il campo grezzo');
  ok(/useAnalysisTrust\(/.test(messaggio), 'la Posta in arrivo passa dal verdetto');

  // L'archivio NON mostra il livello per scelta: solo lo stato azionabile.
  const archivio = leggi('src/features/documents/DocumentsPage.tsx');
  ok(!/ConfidenceBadge/.test(archivio),
    'l\'archivio non mostra nessun livello: una colonna di «bassa» non si legge più');
  ok(/trustSignals/.test(archivio) && /ownershipToConfirm/.test(archivio),
    'l\'archivio mostra il solo stato azionabile, dalla seconda interrogazione');

  // La CONTROPROVA del lettore: il componente che il livello lo mostra DAVVERO
  // deve risultare positivo, o questo guardiano sta leggendo a vuoto.
  const indicatore = leggi('src/features/documents/TrustIndicator.tsx');
  ok(/ConfidenceBadge\s+level=\{verdict\.level/.test(indicatore),
    'CONTROPROVA: TrustIndicator mostra il livello del VERDETTO — il lettore legge davvero');
}

// ===========================================================================
section('17. Il guardiano: l\'appartenenza della Panoramica è la STESSA lettura della pagina');
// ===========================================================================
// ⚠️⚠️ DUE LETTURE PER LO STESSO NUMERO ERANO DUE NUMERI. `ownershipOverview`
// si leggeva `document_analyses` per conto proprio, con un tetto sulle RIGHE di
// analisi — e un documento rianalizzato ha più righe, perché nessun unique lo
// vieta e `persist.ts` accumula. Il tetto poi non viaggiava col risultato:
// nessun `parziale` nel tipo di ritorno, mentre `stats`, `deadlineKinds` e
// `listOwnership` lo dichiarano tutti. E la popolazione era un'altra rispetto
// alla destinazione: si cliccava «12» e se ne trovavano 9.
//
// Il servizio importa il client Supabase e non si carica da Node: si leggono i
// SORGENTI, con la controprova che il lettore legge davvero.
{
  const senzaCommenti = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const hub = senzaCommenti(readFileSync('src/services/documentHubService.ts', 'utf8'));
  // Il corpo del solo metodo: dalla firma alla chiusura del membro.
  const corpo = (nome: string) => {
    const i = hub.indexOf(`async ${nome}(`);
    if (i < 0) return '';
    const j = hub.indexOf('\n  },', i);
    return j < 0 ? hub.slice(i) : hub.slice(i, j);
  };

  const overview = corpo('ownershipOverview');
  ok(overview !== '', 'il metodo ownershipOverview esiste ancora e si è potuto isolare',
    'un lettore che non trova il metodo NON deve uscire verde');
  ok(/listOwnership\(/.test(overview),
    'la Panoramica conta l\'appartenenza dalla STESSA listOwnership della pagina d\'arrivo');
  ok(!/document_analyses/.test(overview),
    'e non si rilegge document_analyses per conto suo: il tetto era sulle righe di analisi, non sui documenti');
  ok(/parziale/.test(overview),
    'il troncamento viaggia col numero: il tipo di ritorno porta `parziale`');
  ok(!/documentHubService\.get\(/.test(overview),
    'l\'esempio non costa più un get() intero — nove interrogazioni per un\'etichetta');

  // ⚠️ E NESSUNA TERZA COPIA DELLA REGOLA. `ownershipToConfirm` — il metodo,
  // non il campo della mappa né la prop della riga — non era chiamato da
  // nessuna parte e dentro faceva una select su `analysis_corrections`, senza
  // tetto, il cui risultato non veniva mai usato: `trustSignals` se le rilegge
  // per conto proprio. `noUnusedLocals` è false, quindi il typecheck non lo
  // vedeva. Il chiamante vero è `ownershipOverview`.
  ok(!/async ownershipToConfirm\(/.test(hub),
    'il metodo morto ownershipToConfirm non è tornato: una query eseguita e buttata');
  ok(/ownershipToConfirm/.test(hub),
    'CONTROPROVA: il CAMPO ownershipToConfirm della mappa dei segnali esiste ancora — è un\'altra cosa');

  // CONTROPROVA: la lettura vera sta in listOwnership, e quella sì che legge.
  const elenco = corpo('listOwnership');
  ok(/documentHubService\.list\(/.test(elenco) && /OWNERSHIP_LIST_MAX/.test(elenco),
    'CONTROPROVA: listOwnership legge davvero le due popolazioni da list_documents');
  ok(/parziale: att\.items\.length < att\.total \|\| arch\.items\.length < arch\.total/.test(elenco),
    'e dichiara il proprio tetto guardando ENTRAMBE le popolazioni');

  // La Panoramica non può presentare come un fatto ciò che la pagina d'arrivo
  // dichiara incompleto: la riga esiste, ed esiste nelle tre lingue.
  const home = senzaCommenti(readFileSync('src/features/dashboard/HomePage.tsx', 'utf8'));
  ok(/ownership\.parziale/.test(home) && /home\.ownershipPartial/.test(home),
    'la Panoramica dichiara il tetto accanto al conteggio dell\'appartenenza');
  for (const [lang, d] of [['it', it.home], ['de', de.home], ['fr', fr.home]] as const) {
    ok(typeof d.ownershipPartial === 'string' && d.ownershipPartial.trim().length > 0,
      `${lang}: home.ownershipPartial esiste`);
  }
}

// ===========================================================================
section('18 · «Mostra altri» non porta via i marcatori già a schermo');
// ===========================================================================
// ⚠️⚠️ «PIÙ RIGHE» NON È «ALTRE RIGHE». L'effetto dei segnali azzerava la mappa
// a ogni cambio dell'insieme degli id, e «Mostra altri» ACCODA: le pastiglie
// «appartenenza da confermare» delle righe già a schermo sparivano e tornavano
// un istante dopo, senza che su quelle righe fosse cambiato niente.
// ⚠️ Ma un verdetto è di un documento SOTTO UNA REGOLA — azienda, ragione
// sociale, cognomi della rubrica entrano nel calcolo (`analysisTrust`): se la
// regola cambia, ciò che è in mappa è di qualcun altro e va buttato.
{
  const R1 = 'azienda-1\u0000Rossi SA\u0000Rossi';
  const R2 = 'azienda-2\u0000Bianchi SA\u0000Bianchi';

  const primo = passoSegnali(null, R1, ['a', 'b'], new Set());
  ok(primo.azzera && primo.daInterrogare.join(',') === 'a,b',
    'la prima volta non c\'è niente in mano: si azzera e si chiede tutto');

  // IL CASO DELL'AUDIT: la stessa interrogazione, una pagina in più.
  const altri = passoSegnali(R1, R1, ['a', 'b', 'c', 'd'], new Set(['a', 'b']));
  ok(!altri.azzera,
    '«Mostra altri» NON azzera: le righe già a schermo tengono la loro pastiglia');
  ok(altri.daInterrogare.join(',') === 'c,d',
    'e si chiedono solo gli id nuovi, non di nuovo tutti', altri.daInterrogare.join(','));

  const nulla = passoSegnali(R1, R1, ['a', 'b'], new Set(['a', 'b']));
  ok(!nulla.azzera && nulla.daInterrogare.length === 0,
    'stesso insieme, stessa regola: non si chiede niente e non si tocca niente');

  // ⚠️ LE TRE INVALIDAZIONI CHE DEVONO RESTARE AZZERAMENTI TOTALI.
  const altraRegola = passoSegnali(R1, R2, ['a', 'b'], new Set(['a', 'b']));
  ok(altraRegola.azzera && altraRegola.daInterrogare.join(',') === 'a,b',
    'cambiata la regola, la mappa si butta e si richiede TUTTO — anche gli id già visti');
  for (const [cosa, regola] of [
    ['l\'azienda', 'azienda-2\u0000Rossi SA\u0000Rossi'],
    ['la ragione sociale', 'azienda-1\u0000Rossi SAGL\u0000Rossi'],
    ['un cognome della rubrica', 'azienda-1\u0000Rossi SA\u0000Rossi\u0000Verdi'],
  ] as const) {
    ok(passoSegnali(R1, regola, ['a'], new Set(['a'])).azzera,
      `cambiando ${cosa} il verdetto in mappa non sopravvive`);
  }

  // Il ramo che l'effetto usa davvero: la pagina passa gli id da interrogare,
  // non l'insieme intero, e le dipendenze sono CONTENUTI e non identità —
  // `surnames` è un array nuovo a ogni render finché la rubrica non risponde.
  const senzaCommenti = (x: string) => x.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const pagina = senzaCommenti(readFileSync('src/features/documents/DocumentsPage.tsx', 'utf8'));
  const effetto = (() => {
    const i = pagina.indexOf('function useTrustSignals(');
    const j = pagina.indexOf('\n}', i);
    return i < 0 ? '' : pagina.slice(i, j);
  })();
  ok(effetto !== '', 'useTrustSignals esiste ancora e si è potuto isolare',
    'un lettore che non trova la funzione NON deve uscire verde');
  ok(/passoSegnali\(/.test(effetto), 'l\'effetto passa dalla decisione pura');
  ok(!/^\s*setSignals\(null\);\s*$/m.test(effetto),
    'e non azzera più a ogni giro: l\'azzeramento è dentro il ramo della regola cambiata');
  ok(/trustSignals\(companyId, passo\.daInterrogare,/.test(effetto),
    'si chiedono gli id mancanti, non tutto l\'insieme ogni volta');
  ok(/\}, \[regola, idsKey\]\)/.test(effetto),
    'le dipendenze sono due CONTENUTI: `surnames` come array rilanciava l\'effetto a ogni render');
}

// ===========================================================================
section('18. Il guardiano: nessuna schermata si dichiara «senza dubbio» da sé');
// ===========================================================================
// ⚠️⚠️ IL LIMITE DEL TIPO, MISURATO. Rendere `appartenenza` obbligatoria
// costringe ogni punto di creazione a DICHIARARE, ma non a dire il vero: una
// schermata che scrive `{ stato: 'senza-dubbio' }` a mano compila senza un
// avviso — provato il 2026-08-22 rimettendo quella riga in ResultView, e il
// compilatore è rimasto muto. È esattamente la forma del difetto originale: una
// schermata che decide da sé di non chiedere.
//
// Perciò `senza-dubbio` può nascere in UN posto solo, `appartenenzaDa`, che il
// verdetto lo guarda davvero. Altrove è un letterale vietato.
//
// ⚠️ I COMMENTI VANNO TOLTI PRIMA. Una guardia a regex sui sorgenti legge anche
// ciò che è scritto in un commento: è già successo in questo progetto — una
// guardia nata rossa per colpa della frase che la spiegava. Qui il commento che
// spiega il divieto nomina il valore vietato, quindi lo scarto è obbligatorio,
// non prudenza.
{
  const SORGENTI = [
    'src/features/admin-ai/ResultView.tsx',
    'src/features/documents/DocumentDetailPage.tsx',
    'src/features/finance/FinanceDetailPage.tsx',
  ];
  /** Via i commenti di blocco e di riga: restano solo le istruzioni. */
  const senzaCommenti = (t: string): string =>
    t.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');

  for (const file of SORGENTI) {
    const codice = senzaCommenti(readFileSync(file, 'utf8'));
    ok(!codice.includes("'senza-dubbio'"),
      `${file} non si dichiara «senza dubbio» da sé: quel valore lo produce solo appartenenzaDa`);
  }

  // …e la guardia deve poter fallire: se `senzaCommenti` smettesse di
  // funzionare, o la ricerca guardasse la stringa sbagliata, tutto resterebbe
  // verde per sempre. Questa è la prova che sa dire di no.
  const finto = "const a = { stato: 'senza-dubbio' };";
  ok(senzaCommenti(finto).includes("'senza-dubbio'"),
    'CONTROPROVA: la guardia riconosce il letterale quando c’è davvero');
  ok(!senzaCommenti("// qui si parla di 'senza-dubbio' a parole").includes("'senza-dubbio'"),
    'CONTROPROVA: e NON lo riconosce dentro un commento — il difetto delle guardie a regex di questo progetto');

  // La scala delle ragioni: ogni silenzio porta il suo motivo, e sono motivi
  // DIVERSI. ⚠️ L'ordine è la parte che si sbaglia: senza documento non si sta
  // «leggendo», e un guasto di rete non è «il documento non ha un'analisi».
  {
    const base = { documentId: 'doc-1', loading: false, error: null, analisi: {} };
    ok(motivoAppartenenza({ ...base, documentId: null, loading: true }).includes('nessun documento'),
      '⚠️ senza documento si dice QUELLO, anche mentre una lettura risulta in corso: non si legge ciò che non c’è');
    ok(motivoAppartenenza({ ...base, loading: true }).includes('in lettura'),
      'con la lettura in corso lo si dice');
    // ⚠️⚠️ `analisi: null` INSIEME all'errore, e non è un dettaglio: è la forma
    // VERA dello stato: `useAsync` sul guasto scrive `data: null`. Con
    // un'analisi finta accanto all'errore questa riga resta verde anche se le
    // due condizioni si invertono — provato il 2026-08-22, ed era un verde
    // falso nato in dieci minuti. Un caso di prova che non riproduce lo stato
    // reale misura la funzione su un mondo che non esiste.
    ok(motivoAppartenenza({ ...base, error: 'rete', analisi: null }).includes('non leggibile'),
      '⚠️ un guasto è un guasto: NON si traveste da «non c’è un’analisi», nemmeno quando la lettura fallita ha lasciato l’analisi vuota');
    ok(motivoAppartenenza({ ...base, analisi: null }).includes('non ha un’analisi'),
      'un documento mai analizzato è un fatto suo');
    ok(motivoAppartenenza(base).includes('verdetto'),
      'e con l’analisi in mano manca solo il verdetto');
    const tutti = new Set([
      motivoAppartenenza({ ...base, documentId: null }),
      motivoAppartenenza({ ...base, loading: true }),
      motivoAppartenenza({ ...base, error: 'rete', analisi: null }),
      motivoAppartenenza({ ...base, analisi: null }),
      motivoAppartenenza(base),
    ]);
    ok(tutti.size === 5,
      'CONTROPROVA: cinque situazioni, cinque frasi diverse — una scala che dicesse sempre la stessa cosa passerebbe tutte le righe qui sopra');
  }

  // ⚠️⚠️ L'INVARIANTE FORTE, ed è quella che avrebbe fermato il difetto:
  // chi crea un'attività da un documento deve PROCURARSI il verdetto, non
  // limitarsi a passare un valore. Le due strade legittime sono `appartenenzaDa`
  // (per chi il verdetto ce l'ha già) e `useDocumentOwnership` (per chi ha solo
  // l'identificativo del documento e deve andarselo a prendere, come Finanze).
  // Una schermata quarta che importi la creazione e nessuna delle due non ha
  // modo di sapere quello che dichiara.
  const CREANO = [
    'src/features/admin-ai/ResultView.tsx',
    'src/features/documents/DocumentDetailPage.tsx',
    'src/features/finance/FinanceDetailPage.tsx',
  ];
  for (const file of CREANO) {
    const codice = senzaCommenti(readFileSync(file, 'utf8'));
    if (!codice.includes('createTaskFromDocument')) continue;
    ok(/appartenenzaDa|useDocumentOwnership/.test(codice),
      `${file} il verdetto se lo procura, non lo inventa`);
  }
  // …e l'elenco non deve invecchiare: se nasce un quarto punto di creazione,
  // questa riga diventa rossa invece di lasciarlo passare in silenzio.
  // ⚠️ Un CHIAMANTE è chi la IMPORTA: cercare `createTaskFromDocument(` da solo
  // pesca anche il file che la dichiara, e la guardia nasce rossa su se stessa.
  // (È nata rossa così, il 2026-08-22, prima di questa riga.)
  const TUTTI = readdirSync('src/features', { recursive: true, encoding: 'utf8' })
    .filter((f) => typeof f === 'string' && /\.tsx?$/.test(f))
    .map((f) => `src/features/${f}`)
    .filter((f) => {
      const c = senzaCommenti(readFileSync(f, 'utf8'));
      return c.includes('createTaskFromDocument') && /from '@\/features\/tasks\/taskFromDocument'/.test(c);
    });
  ok(TUTTI.length === CREANO.length,
    'i punti di creazione sono ancora quelli censiti: uno nuovo va aggiunto a questo elenco e messo sotto la stessa regola',
    `attesi ${CREANO.length}, trovati ${TUTTI.length}: ${TUTTI.join(', ')}`);
}

// ===========================================================================
console.log(`\n${B}Riepilogo${X}  ${G}${pass} superati${X}${fail ? `  ${R}${fail} falliti${X}` : ''}\n`);
process.exit(fail ? 1 : 0);
