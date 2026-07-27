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
  filtersFromParams, findExistingTag, hasActiveFilters, needsAttention, normalizeTagName,
  paramsFromFilters, sameTagName, splitSnippet, stateOf, toListArgs,
} from '../src/features/documents/documentModel';
import { it } from '../src/i18n/locales/it';
import { de } from '../src/i18n/locales/de';
import { fr } from '../src/i18n/locales/fr';
import type { DocumentHubFilters, DocumentHubItem } from '../src/types/models';

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
console.log(`\n${B}Riepilogo${X}  ${G}${pass} superati${X}${fail ? `  ${R}${fail} falliti${X}` : ''}\n`);
process.exit(fail ? 1 : 0);
