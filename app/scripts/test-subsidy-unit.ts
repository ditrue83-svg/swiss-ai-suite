// ============================================================================
// AI-Swisse — Incentivi (Subsidy AI 2.0): test OFFLINE.
//   npm run test:subsidy-unit
//
// Non richiede database, non richiede rete, non spende crediti. Prova le
// funzioni PURE del motore, cioè quelle in cui un errore NON SI VEDE: un
// operatore che risponde `false` invece di `null` non rompe niente — dichiara
// non idonea un'impresa che lo è, e nessuno va a cercare quell'errore perché il
// risultato sembra una risposta.
//
// LE SEZIONI
//   1. Coerenza TS ↔ SQL — gli elenchi scritti due volte dicono lo stesso.
//   2. Gli operatori — e soprattutto quando NON rispondono.
//   3. La valutazione di un criterio — cinque stati, non due.
//   4. Dall'insieme dei criteri all'idoneità — nessun `eligible`.
//   5. La rilevanza — due filtri duri, tutto il resto pesa.
//   6. Il progetto già avviato — si segnala, non si nasconde.
//   7. Tempistica e scadenze — nessuna urgenza da testo libero.
//   8. Freschezza — soglie per tipo di dato, non una sola.
//   9. Impronta e idempotenza — stessi ingressi, nessuna valutazione nuova.
//  10. La guardia delle fonti — SSRF, redirect, protocolli.
//  11. Il rilevamento del cambiamento — niente entra da solo.
//  12. Provenienza dei fatti — chi vince e quando è conflitto.
//  13. Denaro — nessuna conversione, nessun CHF d'ufficio.
// ============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  RULE_OPERATORS, RULE_HARDNESS, CRITERION_STATES, ELIGIBILITY_STATUSES,
  RELEVANCE_LEVELS, COMPLETENESS_LEVELS, TIMING_STATES, FRESHNESS_LEVELS,
  READINESS_LEVELS, CALL_STATUSES, FACT_SOURCES, PROJECT_STAGES,
  RELEVANCE_HIGH_MIN, RELEVANCE_MEDIUM_MIN, RELEVANCE_FLOOR,
} from '../supabase/functions/_shared/subsidy/contract.ts';
import {
  ALL_FACTS, isKnownFactKey, isKnown, resolveFact, mergeFacts, deriveNotStarted,
  type Fact, type FactMap,
} from '../supabase/functions/_shared/subsidy/facts.ts';
import {
  applyOperator, evaluateRule, summarizeEligibility, summarizeCompleteness,
  type SubsidyRule,
} from '../supabase/functions/_shared/subsidy/rules.ts';
import {
  computeRelevance, levelFromScore,
  type RelevanceInput, type RelevanceProgram,
} from '../supabase/functions/_shared/subsidy/relevance.ts';
import {
  computeTiming, computeDeadline, computeFreshness, worstFreshness, daysBetween, nextCheckAt,
  type CallLike,
} from '../supabase/functions/_shared/subsidy/timing.ts';
import {
  assess, assessmentFingerprint, canonicalize, fnv1a64, factImpact,
} from '../supabase/functions/_shared/subsidy/assess.ts';
import {
  guardUrl, isPrivateAddress, hostMatches, isAllowedHost, ALLOWED_SOURCE_HOSTS,
} from '../supabase/functions/_shared/subsidy/fetchGuard.ts';
import {
  detectChanges, diffFields, isAutoUpdatable, NEVER_AUTO_UPDATE, RISK_BY_CHANGE,
  compareCaseSnapshot,
} from '../supabase/functions/_shared/subsidy/diff.ts';
import {
  htmlToText, extractTitle, toIsoDate, findDeadlineCandidates, findAdapter,
  HTML_ADAPTER, ADAPTERS,
} from '../supabase/functions/_shared/subsidy/adapters.ts';
import { normalizeForHash } from '../supabase/functions/_shared/subsidy/hash.ts';

const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION = readFileSync(
  join(HERE, '..', 'supabase', 'migrations', '0032_subsidy_ai_2.sql'), 'utf8');

/** Estrae i valori di un enum dichiarato con `create type … as enum (…)`. */
function sqlEnumValues(name: string): string[] {
  const re = new RegExp(`create type public\\.${name} as enum \\(([\\s\\S]*?)\\)`, 'i');
  const m = MIGRATION.match(re);
  if (!m) return [];
  // ⚠️ I COMMENTI VANNO TOLTI PRIMA. Dentro `create type` ci sono note in
  //    italiano con apostrofi («l'impresa»), e un'estrazione ingenua di tutto
  //    ciò che sta fra apici li scambia per valori dell'enum. Il primo giro di
  //    questo test è fallito esattamente così: il difetto era del controllo,
  //    non dello schema.
  const body = m[1].replace(/--[^\n]*/g, '');
  return [...body.matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

const TODAY = '2026-07-30';

// ===========================================================================
section('1. Coerenza TS ↔ SQL — gli elenchi scritti due volte');
// ⚠️ IL CONTROLLO PIÙ IMPORTANTE DEL FILE, e la ragione è la stessa di
// `crm_is_public_domain`: il typecheck non guarda l'SQL. Due copie della stessa
// enumerazione divergono al primo valore aggiunto da una parte sola, e il
// sintomo è un criterio che smette di essere valutato senza che nulla fallisca.

const enumPairs: [string, readonly string[]][] = [
  ['subsidy_rule_operator', RULE_OPERATORS],
  ['subsidy_rule_hardness', RULE_HARDNESS],
  ['subsidy_criterion_state', CRITERION_STATES],
  ['subsidy_eligibility_status', ELIGIBILITY_STATUSES],
  ['subsidy_relevance_level', RELEVANCE_LEVELS],
  ['subsidy_completeness', COMPLETENESS_LEVELS],
  ['subsidy_timing', TIMING_STATES],
  ['subsidy_freshness', FRESHNESS_LEVELS],
  ['subsidy_readiness', READINESS_LEVELS],
  ['subsidy_call_status', CALL_STATUSES],
  ['subsidy_fact_source', FACT_SOURCES],
  ['subsidy_project_stage', PROJECT_STAGES],
];
for (const [sqlName, tsValues] of enumPairs) {
  const sql = sqlEnumValues(sqlName);
  check(
    `${sqlName}: TS e SQL hanno gli stessi valori`,
    sql.length > 0 && sql.length === tsValues.length && sql.every((v) => (tsValues as string[]).includes(v)),
    `SQL=[${sql.join(',')}] TS=[${tsValues.join(',')}]`,
  );
}

// ⚠️ NON esiste `eligible` (§47). Se un giorno qualcuno lo aggiungesse,
//    l'intero impianto di governance del modulo cambierebbe di significato.
check('non esiste lo stato `eligible`: il massimo è `potentially_eligible`',
  !(ELIGIBILITY_STATUSES as readonly string[]).includes('eligible')
  && (ELIGIBILITY_STATUSES as readonly string[]).includes('potentially_eligible'));

check('la migrazione dichiara le tabelle attese',
  ['subsidy_sources', 'subsidy_source_fetches', 'subsidy_source_snapshots',
   'subsidy_program_versions', 'subsidy_program_rules', 'subsidy_calls',
   'subsidy_catalog_reviews', 'subsidy_projects', 'subsidy_opportunities',
   'subsidy_assessments', 'subsidy_criterion_results', 'subsidy_answers',
   'subsidy_case_documents', 'subsidy_case_events']
    .every((t) => MIGRATION.includes(`create table if not exists public.${t}`)));

// ⚠️ La promessa della sezione 43 della migrazione: il blocco di autoverifica
//    NON deve nominare le etichette aggiunte agli enum esistenti, altrimenti
//    ogni installazione da zero fallirebbe con 55P04.
const selfCheckBlock = MIGRATION.slice(MIGRATION.lastIndexOf('\ndo $$'));
const addedLabels = ['assessing', 'under_review', 'approved', 'rejected', 'withdrawn',
  'subsidy_opportunity_created', 'subsidy_opportunity_high_relevance', 'subsidy_call_opened',
  'subsidy_deadline_approaching', 'subsidy_assessment_became_stale',
  'subsidy_case_status_changed', 'subsidy_source_critical_change',
  'subsidy_new_opportunity', 'subsidy_program_changed'];
check('il blocco di autoverifica non nomina etichette enum aggiunte (55P04)',
  addedLabels.every((l) => !selfCheckBlock.includes(`'${l}'`)),
  addedLabels.filter((l) => selfCheckBlock.includes(`'${l}'`)).join(', '));

// ⚠️ Il difetto della 0026: `coalesce(new, old)` o `tg_op = 'INSERT' or old.…`
//    vengono preparati per intero e su un INSERT `old` non è assegnata.
check('nessuna espressione nomina `old` in un ramo che gira anche su INSERT',
  !/tg_op = 'INSERT' or old\./.test(MIGRATION)
  && !/coalesce\(new, old\)/.test(MIGRATION.replace(/--[^\n]*/g, '')));

// ===========================================================================
section('2. Gli operatori — e soprattutto quando NON rispondono');

check('equals su stringhe', applyOperator('equals', 'Ticino', 'Ticino') === true);
check('equals distingue i booleani dai testi', applyOperator('equals', true, 'true') === null);
check('equals su booleani veri', applyOperator('equals', false, false) === true);
check('not_equals nega equals', applyOperator('not_equals', 'Zurigo', 'Ticino') === true);

// ⚠️ Su una LISTA `contains` significa «l'elemento c'è». È la lezione dei ruoli
//    del CRM: col confronto per sottostringa, «contiene customer» rispondeva sì
//    anche a `former_customer`.
check('contains su lista è appartenenza, non sottostringa',
  applyOperator('contains', ['former_customer'], 'customer') === false);
check('contains su lista trova l\'elemento esatto',
  applyOperator('contains', ['customer', 'supplier'], 'customer') === true);
check('contains su stringa è sottostringa', applyOperator('contains', 'Innosuisse', 'suisse') === true);

check('in accetta una lista attesa', applyOperator('in', 'TI', ['TI', 'ZH']) === true);
check('in su una lista osservata verifica l\'intersezione',
  applyOperator('in', ['energia', 'edilizia'], ['energia']) === true);

check('greater_or_equal su numeri', applyOperator('greater_or_equal', 5, 3) === true);
// ⚠️ `parseInt('12 dipendenti')` farebbe 12: un numero indovinato dentro una
//    frase è precisamente la deduzione che questo modulo non fa.
check('un numero dentro una frase NON viene estratto',
  applyOperator('greater_than', '12 dipendenti', 3) === null);
check('una stringa interamente numerica è accettata',
  applyOperator('greater_than', '12', 3) === true);

check('before/after su ISO', applyOperator('before', '2026-01-01', '2026-06-01') === true);
// ⚠️ `12.08.2026` è ambigua fra due convenzioni: non si indovina.
check('una data non ISO non si confronta', applyOperator('before', '12.08.2026', '2026-06-01') === null);

check('exists su valore presente', applyOperator('exists', 'x', null) === true);
check('exists su stringa vuota è falso', applyOperator('exists', '   ', null) === false);
check('exists su lista vuota è falso', applyOperator('exists', [], null) === false);
check('not_exists nega exists', applyOperator('not_exists', null, null) === true);

// ⚠️ IL CONTROLLO CHE CONTA: un confronto impossibile risponde `null`, non
//    `false`. `false` su un criterio obbligatorio dichiara NON IDONEA
//    un'impresa per un tipo di dato che non combaciava.
check('un confronto impossibile risponde null, mai false',
  applyOperator('greater_than', 'non un numero', 'nemmeno questo') === null);

check('tutti gli operatori dichiarati sono implementati',
  RULE_OPERATORS.every((op) => applyOperator(op, 'x', 'x') !== undefined));

// ===========================================================================
section('3. La valutazione di un criterio — cinque stati, non due');

const rule = (over: Partial<SubsidyRule> = {}): SubsidyRule => ({
  ruleKey: 'r1', label: 'Criterio', factKey: 'company.employee_count',
  operator: 'greater_or_equal', expectedValue: 3, hardness: 'hard',
  evaluability: 'auto', question: null, sourceEvidence: null, sortOrder: 0, ...over,
});
const fact = (value: unknown, source: Fact['source'] = 'company_profile'): Fact =>
  ({ value: value as Fact['value'], source, confidence: 1 });

check('criterio soddisfatto dai fatti',
  evaluateRule(rule(), { 'company.employee_count': fact(5) }, null).state === 'satisfied');
check('criterio non soddisfatto dai fatti',
  evaluateRule(rule(), { 'company.employee_count': fact(1) }, null).state === 'not_satisfied');

// ⚠️ §51 — un dato che manca NON è un no.
const missing = evaluateRule(rule(), {}, null);
check('un fatto mancante produce `unknown`, non `not_satisfied`', missing.state === 'unknown');
check('e ne dichiara la ragione', missing.reasonCode === 'missing_fact');

// ⚠️ Un criterio che nomina un fatto sconosciuto NON è un criterio superato.
const badKey = evaluateRule(rule({ factKey: 'company.inventato' }), {}, null);
check('un fact_key sconosciuto produce `not_evaluable`', badKey.state === 'not_evaluable');
check('e lo dichiara con `unknown_fact_key`', badKey.reasonCode === 'unknown_fact_key');

check('un criterio da verificare a mano è `not_evaluable`',
  evaluateRule(rule({ evaluability: 'manual' }), { 'company.employee_count': fact(5) }, null).state === 'not_evaluable');

// ⚠️ §36 — la risposta di una persona viene prima di qualunque deduzione.
const answered = evaluateRule(rule(), { 'company.employee_count': fact(1) }, 'yes');
check('una risposta esplicita batte i fatti', answered.state === 'satisfied');
check('e la provenienza lo dice', answered.valueSource === 'user_answer');
check('«non lo so» è una risposta, e vale `unknown`',
  evaluateRule(rule(), {}, 'unknown').state === 'unknown');

check('un fatto in conflitto produce `conflicting`',
  evaluateRule(rule(), { 'company.employee_count': fact(5) }, null, ['company.employee_count']).state === 'conflicting');

check('una regola senza operatore è `not_evaluable`',
  evaluateRule(rule({ operator: null }), {}, null).state === 'not_evaluable');

// ===========================================================================
section('4. Dall\'insieme dei criteri all\'idoneità — nessun `eligible`');

const outcome = (over: Partial<ReturnType<typeof evaluateRule>>) =>
  ({ ruleKey: 'x', hardness: 'hard', state: 'satisfied', observedValue: null,
     valueSource: null, reasonCode: 'auto', sortOrder: 0, ...over } as ReturnType<typeof evaluateRule>);

check('nessun criterio → not_assessed', summarizeEligibility([]).status === 'not_assessed');
check('tutti soddisfatti → potentially_eligible, mai «idoneo»',
  summarizeEligibility([outcome({}), outcome({ hardness: 'soft' })]).status === 'potentially_eligible');

// §183 — i quattro casi del capitolato.
check('hard non soddisfatto → ineligible',
  summarizeEligibility([outcome({ state: 'not_satisfied' })]).status === 'ineligible');
check('hard sconosciuto → insufficient_information',
  summarizeEligibility([outcome({ state: 'unknown' })]).status === 'insufficient_information');
// ⚠️ §49 — un criterio non bloccante non soddisfatto NON esclude.
check('soft non soddisfatto NON produce ineligible',
  summarizeEligibility([outcome({ hardness: 'soft', state: 'not_satisfied' }), outcome({})]).status !== 'ineligible');
// ⚠️ Un'esclusione è attivata quando la condizione che esclude risulta VERA.
check('esclusione attivata → ineligible',
  summarizeEligibility([outcome({ hardness: 'exclusion', state: 'satisfied' })]).status === 'ineligible');
check('esclusione NON attivata non esclude',
  summarizeEligibility([outcome({ hardness: 'exclusion', state: 'not_satisfied' })]).status === 'potentially_eligible');
check('l\'esclusione indica il criterio che decide',
  summarizeEligibility([outcome({ ruleKey: 'excl-1', hardness: 'exclusion', state: 'satisfied' })]).decidingRuleKey === 'excl-1');

check('solo soft falliti e nessuno soddisfatto → likely_ineligible',
  summarizeEligibility([outcome({ hardness: 'soft', state: 'not_satisfied' })]).status === 'likely_ineligible');

check('completezza: nessun criterio aperto → complete',
  summarizeCompleteness([outcome({}), outcome({})]) === 'complete');
check('completezza: un obbligatorio aperto → major_gaps',
  summarizeCompleteness([outcome({ state: 'unknown' }), outcome({}), outcome({}), outcome({})]) === 'major_gaps');
check('completezza: un facoltativo aperto su tanti → minor_gaps',
  summarizeCompleteness([
    outcome({ hardness: 'soft', state: 'unknown' }),
    outcome({}), outcome({}), outcome({}), outcome({}), outcome({}),
  ]) === 'minor_gaps');

// ===========================================================================
section('5. La rilevanza — due filtri duri, tutto il resto pesa');

const prog = (over: Partial<RelevanceProgram> = {}): RelevanceProgram => ({
  programId: 'p', geography: ['Ticino'], targetSectors: ['ict'],
  companySizeMin: 3, companySizeMax: 100000, projectTypes: ['innovazione'],
  mustApplyBeforeStart: true, availability: 'available', lifecycle: 'active', ...over,
});
const inp = (over: Partial<RelevanceInput> = {}): RelevanceInput => ({
  canton: 'Ticino', country: 'CH', sector: 'ict', employeeCount: 5,
  projectTypes: ['innovazione'], budgetAmount: null, budgetCurrency: null,
  hasResearchPartner: null, stage: 'planned', ...over,
});

check('geografia incompatibile → nessun match',
  computeRelevance(inp({ canton: 'Zurigo' }), prog()) === null);
check('tipo di progetto incompatibile → nessun match',
  computeRelevance(inp({ projectTypes: ['edilizia'] }), prog()) === null);
check('progetto realizzato fuori dalla Svizzera → nessun match',
  computeRelevance(inp({ country: 'IT' }), prog()) === null);
check('programma ritirato → nessun match',
  computeRelevance(inp(), prog({ lifecycle: 'retired' })) === null);

const full = computeRelevance(inp(), prog());
check('match pieno produce un risultato', full !== null);
check('e la fascia è alta', full!.level === 'high', `score=${full?.score}`);
check('con ragioni deterministiche', full!.reasons.some((r) => r.key === 'projectType'));

// ⚠️ §182 — un settore mancante è una LACUNA, non un'esclusione.
const noSector = computeRelevance(inp({ sector: null }), prog());
check('settore mancante: il programma resta', noSector !== null);
check('e compare fra le lacune', noSector!.gaps.some((g) => g.key === 'sectorMissing'));

const noCount = computeRelevance(inp({ employeeCount: null }), prog());
check('dipendenti non indicati: il programma resta', noCount !== null);
check('e compare fra le lacune', noCount!.gaps.some((g) => g.key === 'employeeCountMissing'));

// ⚠️ §63 — un programma nazionale «per tutte le PMI» senza alcun segnale
//    concreto non deve generare un'opportunità per chiunque.
const nationwideNoSignal = computeRelevance(
  inp({ sector: null, employeeCount: null, projectTypes: ['innovazione'] }),
  prog({ geography: ['ALL'], targetSectors: ['ALL'], projectTypes: ['innovazione'] }),
);
check('un programma nazionale con un tipo pertinente resta un match (segnale: tipo)',
  nationwideNoSignal !== null);

check('le soglie delle fasce sono coerenti', RELEVANCE_HIGH_MIN > RELEVANCE_MEDIUM_MIN
  && RELEVANCE_MEDIUM_MIN > RELEVANCE_FLOOR);
check('levelFromScore rispetta le soglie',
  levelFromScore(RELEVANCE_HIGH_MIN) === 'high'
  && levelFromScore(RELEVANCE_MEDIUM_MIN) === 'medium'
  && levelFromScore(RELEVANCE_MEDIUM_MIN - 1) === 'low');

// ===========================================================================
section('6. Il progetto già avviato — si segnala, non si nasconde');

// §184 — il caso più costoso del modulo.
const started = computeRelevance(inp({ stage: 'started' }), prog({ mustApplyBeforeStart: true }));
check('un progetto avviato NON fa sparire il programma', started !== null);
check('e la cosa è dichiarata fra le lacune',
  started!.gaps.some((g) => g.key === 'timingAlreadyStarted'));
check('un progetto pianificato guadagna la ragione «prima dell\'avvio»',
  computeRelevance(inp({ stage: 'planned' }), prog())!.reasons.some((r) => r.key === 'timingBeforeStart'));

check('deriveNotStarted: idea e planned → true',
  deriveNotStarted('idea') === true && deriveNotStarted('planned') === true);
check('deriveNotStarted: started e completed → false',
  deriveNotStarted('started') === false && deriveNotStarted('completed') === false);
// ⚠️ Di un progetto annullato la domanda non ha senso: rispondere sarebbe
//    rispondere a una domanda che nessuno ha fatto.
check('deriveNotStarted: cancelled → null (non false)', deriveNotStarted('cancelled') === null);

// ===========================================================================
section('7. Tempistica e scadenze — nessuna urgenza da testo libero');

const call = (over: Partial<CallLike> = {}): CallLike => ({
  status: 'open', opensOn: null, deadlineOn: '2026-09-15',
  deadlineAt: null, continuous: false, checkedAt: TODAY, ...over,
});

check('nessuna call → tempistica sconosciuta, mai «aperta»',
  computeTiming(null, TODAY) === 'unknown');
check('call aperta con scadenza futura → open', computeTiming(call(), TODAY) === 'open');
// ⚠️ Una pagina può restare ferma dopo che il termine è passato.
check('call «aperta» con scadenza passata → closed',
  computeTiming(call({ deadlineOn: '2026-01-01' }), TODAY) === 'closed');
check('call che apre in futuro → upcoming',
  computeTiming(call({ opensOn: '2026-10-01' }), TODAY) === 'upcoming');
check('finestra continua → continuous', computeTiming(call({ continuous: true }), TODAY) === 'continuous');
check('call sospesa → unknown, non «aperta»', computeTiming(call({ status: 'suspended' }), TODAY) === 'unknown');

const d = computeDeadline(call(), TODAY, 'fresh');
check('scadenza a 47 giorni: urgente con fonte fresca', d.urgent === true && d.daysLeft === 47);
// ⚠️ §26 — con una fonte scaduta non si crea urgenza certa.
check('fonte stale → nessuna urgenza', computeDeadline(call(), TODAY, 'stale').urgent === false);
check('fonte mai verificata → nessuna urgenza', computeDeadline(call(), TODAY, 'unverified').urgent === false);
check('opportunità messa da parte → nessuna urgenza',
  computeDeadline(call(), TODAY, 'fresh', { dismissed: true }).urgent === false);
check('pratica già inviata → nessuna urgenza',
  computeDeadline(call(), TODAY, 'fresh', { submitted: true }).urgent === false);
check('senza scadenza strutturata non esiste urgenza',
  computeDeadline(call({ deadlineOn: null }), TODAY, 'fresh').urgent === false);
// §7 — l'ora esatta è un dato, non un default.
check('l\'ora esatta è nota solo se la fonte la dichiara',
  computeDeadline(call(), TODAY, 'fresh').hasExactTime === false
  && computeDeadline(call({ deadlineAt: '2026-09-15T12:00:00Z' }), TODAY, 'fresh').hasExactTime === true);

check('daysBetween conta giorni di calendario',
  daysBetween('2026-07-30', '2026-08-01') === 2 && daysBetween('2026-07-30', '2026-07-29') === -1);

// ===========================================================================
section('8. Freschezza — soglie per tipo di dato, non una sola');

check('mai verificato → unverified, che non è «vecchio»',
  computeFreshness(null, 'call', TODAY) === 'unverified');
check('una call verificata 10 giorni fa è fresca',
  computeFreshness('2026-07-20', 'call', TODAY) === 'fresh');
// ⚠️ Con una soglia unica, questi due casi darebbero lo stesso esito e uno dei
//    due sarebbe sbagliato.
check('gli stessi 200 giorni: stale per una call, freschi per una base legale',
  computeFreshness('2026-01-11', 'call', TODAY) === 'stale'
  && computeFreshness('2026-01-11', 'law', TODAY) === 'fresh');
check('worstFreshness prende la peggiore, non la media',
  worstFreshness(['fresh', 'stale', 'fresh']) === 'stale');
check('worstFreshness su elenco vuoto è unverified', worstFreshness([]) === 'unverified');
check('nextCheckAt sposta di frequencyDays',
  nextCheckAt('2026-07-01T00:00:00.000Z', 30, '2026-07-30T00:00:00.000Z').slice(0, 10) === '2026-07-31');

// ===========================================================================
section('9. Impronta e idempotenza — stessi ingressi, nessuna valutazione nuova');

// ⚠️ `JSON.stringify` da solo non basta: l'ordine delle chiavi dipende da come
//    l'oggetto è stato costruito, e due mappe identiche darebbero due impronte.
check('canonicalize ordina le chiavi',
  canonicalize({ b: 1, a: 2 }) === canonicalize({ a: 2, b: 1 }));
check('canonicalize distingue valori diversi',
  canonicalize({ a: 1 }) !== canonicalize({ a: 2 }));
check('canonicalize è stabile sugli oggetti annidati',
  canonicalize({ x: { b: 1, a: 2 } }) === canonicalize({ x: { a: 2, b: 1 } }));
check('fnv1a64 è deterministica e non banale',
  fnv1a64('abc') === fnv1a64('abc') && fnv1a64('abc') !== fnv1a64('abd') && fnv1a64('abc').length === 16);

const fpBase = {
  programVersionId: 'v1', callId: 'c1',
  facts: { 'company.employee_count': fact(5) } as FactMap,
  answers: { r1: 'yes' as const }, callState: 'open',
};
check('stessi ingressi → stessa impronta',
  assessmentFingerprint(fpBase) === assessmentFingerprint({ ...fpBase }));
check('un fatto diverso → impronta diversa',
  assessmentFingerprint(fpBase)
    !== assessmentFingerprint({ ...fpBase, facts: { 'company.employee_count': fact(6) } }));
// ⚠️ Lo stesso valore da una fonte diversa È un fatto diverso: cambia la
//    fiducia con cui la schermata lo mostra.
check('lo stesso valore da una fonte diversa cambia l\'impronta',
  assessmentFingerprint(fpBase)
    !== assessmentFingerprint({ ...fpBase, facts: { 'company.employee_count': fact(5, 'interpretation') } }));
check('una call diversa → impronta diversa',
  assessmentFingerprint(fpBase) !== assessmentFingerprint({ ...fpBase, callId: 'c2' }));
check('una versione del motore diversa → impronta diversa',
  assessmentFingerprint(fpBase) !== assessmentFingerprint({ ...fpBase, engineVersion: 'altro' }));

// La valutazione completa
const rules: SubsidyRule[] = [
  rule({ ruleKey: 'size', factKey: 'company.employee_count', operator: 'greater_or_equal', expectedValue: 3 }),
  rule({ ruleKey: 'before', factKey: 'project.not_started', operator: 'equals', expectedValue: true, sortOrder: 1 }),
  rule({ ruleKey: 'sector', factKey: 'company.sector', operator: 'equals', expectedValue: 'ict',
         hardness: 'soft', sortOrder: 2 }),
];
const facts: FactMap = {
  'company.employee_count': fact(5),
  'project.not_started': fact(true, 'project'),
};
const a1 = assess({
  programVersionId: 'v1', rules, facts, conflicts: [], answers: {},
  relevance: full!, call: call(), checkedAt: { requirements: TODAY, availability: TODAY, call: TODAY },
  today: TODAY,
});
check('la valutazione produce un esito per ogni criterio', a1.criteria.length === 3);
check('e dichiara il fatto mancante', a1.missingFacts.includes('company.sector'));
check('idoneità: obbligatori soddisfatti, un facoltativo aperto',
  a1.eligibilityStatus === 'insufficient_information', a1.eligibilityStatus);
check('la valutazione è idempotente sugli stessi ingressi',
  a1.fingerprint === assess({
    programVersionId: 'v1', rules, facts, conflicts: [], answers: {},
    relevance: full!, call: call(), checkedAt: { requirements: TODAY, availability: TODAY, call: TODAY },
    today: TODAY,
  }).fingerprint);

const impact = factImpact(rules, a1.criteria);
check('factImpact dice quanti criteri chiuderebbe un dato', impact['company.sector'] === 1);
check('e non elenca fatti che il registro non conosce',
  Object.keys(impact).every((k) => isKnownFactKey(k)));

// ===========================================================================
section('10. La guardia delle fonti — SSRF, redirect, protocolli');

// §196 — i casi del capitolato, uno per uno.
const blocked = [
  'https://localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x',
  'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://172.16.0.1/x',
  'https://169.254.169.254/latest/meta-data/', 'https://2130706433/x',
  'https://0x7f.0.0.1/x', 'https://metadata.internal/x',
];
for (const u of blocked) {
  check(`bloccato: ${u}`, guardUrl(u, 'admin.ch').ok === false);
}
check('bloccato: http non cifrato', guardUrl('http://www.admin.ch/x', 'admin.ch').ok === false);
check('bloccato: file://', guardUrl('file:///etc/passwd', 'admin.ch').ok === false);
check('bloccato: credenziali nell\'URL',
  guardUrl('https://u:p@www.admin.ch/x', 'admin.ch').ok === false);
check('bloccato: porta non standard', guardUrl('https://www.admin.ch:8080/x', 'admin.ch').ok === false);
check('bloccato: host fuori dall\'allowlist', guardUrl('https://example.com/x', 'example.com').ok === false);
// ⚠️ La differenza fra `endsWith` e il confronto per etichetta è un dominio
//    intero sotto il controllo di chiunque.
check('bloccato: admin.ch.evil.com non è admin.ch',
  guardUrl('https://admin.ch.evil.com/x', 'admin.ch').ok === false);
check('ammesso: un sottodominio ufficiale',
  guardUrl('https://www.innosuisse.admin.ch/it/x', 'admin.ch').ok === true);
check('ammesso: l\'host esatto dichiarato', guardUrl('https://prokw.ch/it/', 'prokw.ch').ok === true);
// ⚠️ L'host dichiarato nella riga della fonte deve corrispondere: una fonte
//    ammessa non autorizza a leggerne un'altra.
check('bloccato: host ammesso ma diverso da quello dichiarato',
  guardUrl('https://pronovo.ch/x', 'prokw.ch').ok === false);

check('isPrivateAddress riconosce le forme mascherate',
  isPrivateAddress('0x7f.0.0.1') && isPrivateAddress('2130706433')
  && isPrivateAddress('::ffff:127.0.0.1') && isPrivateAddress('100.64.0.1'));
check('isPrivateAddress non blocca un host pubblico',
  !isPrivateAddress('www.admin.ch') && !isPrivateAddress('8.8.8.8'));
check('hostMatches è per etichetta',
  hostMatches('www.admin.ch', 'admin.ch') && !hostMatches('admin.ch.evil.com', 'admin.ch'));
check('l\'allowlist contiene le autorità dei programmi a catalogo',
  ['admin.ch', 'prokw.ch', 'pronovo.ch', 'ti.ch', 'ilprogrammaedifici.ch']
    .every((h) => (ALLOWED_SOURCE_HOSTS as string[]).includes(h)));
check('nessun host dell\'allowlist è un dominio privato',
  ALLOWED_SOURCE_HOSTS.every((h) => !isPrivateAddress(h) && isAllowedHost(h)));

// ===========================================================================
section('11. Il rilevamento del cambiamento — niente entra da solo');

const okResult = {
  ok: true, title: 'Pagina', language: 'it' as const, contentHash: 'hash-b',
  normalized: { textLength: 1000 }, evidence: [], unsupported: [],
  sourcePublishedAt: null, sourceUpdatedAt: null, parserVersion: 'p',
};

check('impronta identica → nessuna revisione',
  detectChanges({ sourceId: 's', programId: 'p', previousHash: 'hash-b',
                  result: okResult, previousNormalized: {} }).length === 0);
const changed = detectChanges({ sourceId: 's', programId: 'p', previousHash: 'hash-a',
                                result: okResult, previousNormalized: { textLength: 900 } });
check('impronta diversa → una revisione', changed.length === 1);
// ⚠️ Una proposta è SOLO dati: non porta con sé alcuno stato di applicazione,
//    perché non c'è nulla da applicare finché una persona non decide (§22).
check('e la versione pubblicata non viene toccata (la proposta è solo dati)',
  changed[0].proposedValues.contentHash === 'hash-b'
  && !('status' in (changed[0] as unknown as Record<string, unknown>)));

// ⚠️ §22 — una candidata di scadenza diventa una revisione `critical`, mai un
//    dato del catalogo.
const withDeadline = detectChanges({
  sourceId: 's', programId: 'p', previousHash: 'hash-a', previousNormalized: {},
  result: { ...okResult, evidence: [{ field: 'deadline_candidate', quote: 'Termine: 30.09.2026', section: null, page: null }] },
});
check('una candidata di scadenza produce una revisione critica',
  withDeadline.some((c) => c.changeType === 'deadline' && c.risk === 'critical'));

const unreachable = detectChanges({
  sourceId: 's', programId: 'p', previousHash: 'hash-a', previousNormalized: {},
  result: { ...okResult, ok: false, errorCode: 'source_unreachable' },
});
check('una fonte irraggiungibile produce una revisione, non una cancellazione',
  unreachable.length === 1 && unreachable[0].changeType === 'source_unreachable');

check('i campi critici non sono mai aggiornabili da soli',
  NEVER_AUTO_UPDATE.every((f) => !isAutoUpdatable(f))
  && isAutoUpdatable('title'));
check('la scadenza è il rischio più alto',
  RISK_BY_CHANGE.deadline === 'critical' && RISK_BY_CHANGE.program_requirements === 'critical');
check('la chiave di deduplicazione impedisce la stessa revisione due volte',
  changed[0].dedupeKey === detectChanges({ sourceId: 's', programId: 'p', previousHash: 'hash-a',
    result: okResult, previousNormalized: { textLength: 900 } })[0].dedupeKey);

check('diffFields trova solo ciò che è cambiato',
  diffFields({ a: 1, b: 2 }, { a: 1, b: 3 }).length === 1);
// §110 — il confronto con l'istantanea non riscrive niente.
check('compareCaseSnapshot confronta solo i campi che contano',
  compareCaseSnapshot({ deadlineOn: '2026-09-15', altro: 'x' }, { deadlineOn: '2026-10-01', altro: 'y' })
    .every((c) => c.field === 'deadlineOn'));
check('senza istantanea non c\'è confronto', compareCaseSnapshot(null, { deadlineOn: 'x' }).length === 0);

// Gli adapter
check('findAdapter non ricade su un adapter generico', findAdapter('inesistente') === null);
check('ogni adapter dichiara i propri limiti',
  ADAPTERS.every((a) => a.limitations.length > 0 && a.describe.length > 20));
check('htmlToText toglie script e style con il loro contenuto',
  !htmlToText('<p>x</p><script>var a=1</script>').includes('var a'));
check('htmlToText decodifica le entità', htmlToText('<p>a&nbsp;&amp;&nbsp;b</p>').includes('a & b'));
check('extractTitle legge il titolo', extractTitle('<title> Pagina </title>') === 'Pagina');
check('toIsoDate accetta ISO', toIsoDate('2026-09-15') === '2026-09-15');
check('toIsoDate accetta la forma svizzera non ambigua', toIsoDate('30.09.2026') === '2026-09-30');
// ⚠️ `05.09.2026` è ambigua fra due convenzioni: non si indovina.
check('toIsoDate rifiuta una data ambigua', toIsoDate('05.09.2026') === null);
check('findDeadlineCandidates trova le date accanto a una parola di scadenza',
  findDeadlineCandidates('Il termine di inoltro è il 30.09.2026 per tutti.').length === 1);
check('e non raccoglie una data qualunque',
  findDeadlineCandidates('La legge del 01.01.2020 disciplina la materia.').length === 0);
check('normalizeForHash rende stabili gli spazi',
  normalizeForHash('a  \r\n\r\n\r\n b ') === normalizeForHash('a\n\nb'));

// ===========================================================================
section('12. Provenienza dei fatti — chi vince e quando è conflitto');

check('ogni fatto dichiarato ha una chiave unica',
  new Set(ALL_FACTS.map((f) => f.key)).size === ALL_FACTS.length);
// ⚠️ §39 — le deduzioni vietate non hanno una chiave con cui scriverle.
check('non esistono chiavi per le deduzioni vietate',
  !ALL_FACTS.some((f) => /revenue|headcount_from|export_from|is_startup|is_innovative/.test(f.key)));
check('ogni fatto dichiara dove si compila',
  ALL_FACTS.every((f) => ['company_profile', 'company_settings', 'project', 'answer'].includes(f.fillIn)));

check('isKnown: false è un valore noto',
  isKnown(fact(false)) === true && isKnown(fact(null)) === false && isKnown(fact('  ')) === false);
check('isKnown: una lista vuota non è nota', isKnown(fact([])) === false);

// §36 — la scala di autorità.
const r1 = resolveFact(fact(5, 'interpretation'), fact(8, 'user_answer'));
check('una risposta esplicita batte l\'interpretazione AI', r1.fact?.value === 8 && !r1.conflicting);
const r2 = resolveFact(fact(5, 'company_profile'), fact(8, 'company_profile'));
check('due fonti di pari autorità che divergono sono un conflitto', r2.conflicting === true);
const r3 = resolveFact(fact(5, 'company_profile'), fact(5, 'company_profile'));
check('due fonti concordi non sono un conflitto', r3.conflicting === false);
check('un valore assente non produce conflitto',
  resolveFact(null, fact(5)).conflicting === false);

const merged = mergeFacts(
  { 'company.sector': fact('ict', 'interpretation') },
  { 'company.sector': fact('servizi', 'company_profile') },
);
check('mergeFacts risolve con la fonte più autorevole',
  merged.facts['company.sector'].value === 'servizi' && merged.conflicts.length === 0);

// ===========================================================================
section('13. Denaro — nessuna conversione, nessun CHF d\'ufficio');

// §186 — la precisione e la valuta.
check('un budget senza valuta non è un segnale di rilevanza',
  computeRelevance(inp({ budgetAmount: 180000, budgetCurrency: null }), prog())!.signals.includes('investment') === false);
check('un budget con valuta lo è',
  computeRelevance(inp({ budgetAmount: 180000, budgetCurrency: 'CHF' }), prog())!.signals.includes('investment') === true);
// ⚠️ Nessun operatore converte valute: un confronto fra importi in valute
//    diverse è un confronto fra numeri, e il motore non lo fa da solo — il
//    criterio guarda `budget_amount`, e la valuta è un fatto separato.
check('la valuta è un fatto separato dall\'importo',
  ALL_FACTS.some((f) => f.key === 'project.budget_amount')
  && ALL_FACTS.some((f) => f.key === 'project.budget_currency'));
check('la migrazione impone la valuta accanto all\'importo',
  MIGRATION.includes('subsidy_project_currency_required')
  && MIGRATION.includes('subsidy_case_currency_required'));
// §70 — nessun calcolatore di contributo.
check('nessuna funzione calcola un importo ottenibile',
  !MIGRATION.includes('estimated_award') && !MIGRATION.includes('expected_amount'));

// ===========================================================================
console.log(`\n${B}Risultato:${X} ${G}${pass} passati${X}${fail ? `, ${R}${fail} falliti${X}` : ''}\n`);
process.exit(fail ? 1 : 0);
