// ============================================================================
// INCENTIVI — le costanti del motore, in un posto solo.
//
// Stanno qui — e non sparse fra worker, database e componenti — perché sono
// numeri che l'interfaccia DICHIARA e il sistema APPLICA. Quando le copie
// divergono, la schermata promette una cosa e il motore ne fa un'altra: è già
// successo con `INITIAL_SYNC_DAYS` dell'Inbox e con i limiti delle automazioni,
// e da allora un test le confronta con il database vero.
//
// Modulo PORTABILE: nessuna API Deno, nessun import. Lo leggono il worker
// (Deno), i test (Node) e il browser (Vite) attraverso il re-export in
// `src/features/subsidy-ai/registry.ts`.
// ============================================================================

/** Versione del motore di valutazione. Entra nel fingerprint (§56, §60). */
export const SUBSIDY_ENGINE_VERSION = 'subsidy-engine-2026-07-30';

/** Versione dello schema di normalizzazione delle fonti. */
export const SUBSIDY_PARSER_VERSION = 'subsidy-parser-2026-07-30';

// ---------------------------------------------------------------------------
// Rilevanza
// ---------------------------------------------------------------------------

/**
 * Soglie delle tre fasce (§45).
 *
 * ⚠️ Il punteggio è INTERNO e serve solo a ordinare. L'interfaccia mostra la
 * fascia — «Molto rilevante», «Rilevante», «Poco rilevante» — perché «82/100»
 * letto da un imprenditore diventa «82% di possibilità di ottenerlo», che è una
 * cosa che questo prodotto non sa e non deve lasciar credere.
 */
export const RELEVANCE_HIGH_MIN = 70;
export const RELEVANCE_MEDIUM_MIN = 45;

/**
 * Pavimento sotto cui un'opportunità NON viene creata (§63).
 *
 * ⚠️ Non è una preferenza estetica: senza pavimento, un programma «aperto a
 * tutte le PMI svizzere» diventerebbe rilevante per ogni impresa e per ogni
 * progetto, e l'elenco delle opportunità smetterebbe di essere una risposta.
 * Serve almeno un segnale concreto — vedi `RELEVANCE_REQUIRES_SIGNAL`.
 */
export const RELEVANCE_FLOOR = 35;

/**
 * ⚠️ IL FILTRO CHE IMPEDISCE I FALSI POSITIVI DI MASSA (§63).
 *
 * Non basta che la geografia torni: serve almeno un segnale concreto che leghi
 * QUESTO progetto a QUEL programma. Senza, «disponibile alle PMI» significa
 * «rilevante per tutti», e il modulo torna a essere l'elenco che il 1.0 era.
 */
export const RELEVANCE_REQUIRES_SIGNAL = true;

// ---------------------------------------------------------------------------
// Freschezza delle fonti (§24, §26)
// ---------------------------------------------------------------------------

/**
 * ⚠️ NON UNA SOGLIA UNICA. Una scadenza di call si guarda spesso, una base
 * legale no: usare lo stesso numero per entrambe significherebbe o allarmare
 * su una legge stabile da anni, o presentare come fresca una scadenza vecchia
 * di tre mesi.
 */
export const FRESHNESS_DAYS: Record<'call' | 'availability' | 'requirements' | 'law', { fresh: number; aging: number }> = {
  // Le call cambiano nel giro di settimane.
  call: { fresh: 14, aging: 45 },
  // La disponibilità dipende da statistiche annuali (il caso L-Rilocc).
  availability: { fresh: 90, aging: 180 },
  // I requisiti di un programma restano validi per stagioni intere.
  requirements: { fresh: 180, aging: 365 },
  // Una base legale può restare in vigore per anni.
  law: { fresh: 365, aging: 730 },
};

/** Frequenze di controllo predefinite, in giorni, per tipo di fonte. */
export const SOURCE_CHECK_DAYS: Record<string, number> = {
  official_call_page: 7,
  official_program_page: 30,
  official_database: 14,
  official_guideline: 90,
  official_regulation: 180,
  official_law: 365,
  official_pdf: 90,
  manual_official_source: 180,
};

// ---------------------------------------------------------------------------
// Tempistica (§72, §73)
// ---------------------------------------------------------------------------

/** Entro quanti giorni una scadenza entra nella vista «deadline vicine». */
export const DEADLINE_SOON_DAYS = 60;

/** Entro quanti giorni il worker emette `subsidy_deadline_approaching`. */
export const DEADLINE_EMIT_DAYS = 30;

/**
 * ⚠️ L'URGENZA NON SI DEDUCE DAL TESTO (§73). «Presentare presto» scritto in una
 * pagina non produce alcuna urgenza: servono una call realmente aperta e una
 * scadenza verificata. Questa costante esiste per essere citata dal codice che
 * potrebbe essere tentato di fare altrimenti.
 */
export const URGENCY_REQUIRES_VERIFIED_DEADLINE = true;

// ---------------------------------------------------------------------------
// Il worker
// ---------------------------------------------------------------------------

/** Quante opportunità si rivalutano per esecuzione. */
export const REASSESS_BATCH = 60;
/** Quante fonti si controllano per esecuzione. */
export const SOURCE_CHECK_BATCH = 8;
/**
 * Budget di tempo. Supabase chiude la richiesta a 150 secondi e uccide
 * l'isolate: il `finally` NON gira. Ogni passo controlla il proprio tempo
 * prima di cominciarne un altro — la lezione più cara del progetto.
 */
export const EDGE_TIME_BUDGET_MS = 100_000;
/** Tempo da riservare a un singolo controllo di fonte prima di cominciarlo. */
export const SOURCE_CHECK_SLOT_MS = 15_000;

// ---------------------------------------------------------------------------
// La lettura delle fonti (§147, §148)
// ---------------------------------------------------------------------------

/** Timeout di una richiesta a una fonte ufficiale. */
export const SOURCE_FETCH_TIMEOUT_MS = 12_000;
/** Tetto di byte letti da una fonte. Oltre, si tronca e lo si dichiara. */
export const SOURCE_MAX_BYTES = 3_000_000;
/** Quanti redirect si seguono, validando l'host a ogni salto. */
export const SOURCE_MAX_REDIRECTS = 3;
/** Content-type ammessi. Tutto il resto viene rifiutato senza essere letto. */
export const SOURCE_ALLOWED_CONTENT_TYPES = [
  'text/html', 'application/xhtml+xml', 'text/plain',
  'application/json', 'application/pdf',
] as const;

// ---------------------------------------------------------------------------
// L'interpretazione AI (§152)
// ---------------------------------------------------------------------------

/**
 * ⚠️ Sotto questa soglia un tipo di progetto riconosciuto dall'AI NON viene
 * applicato d'ufficio: viene PROPOSTO. È la stessa soglia del modulo 1.0, e la
 * ragione non è cambiata — sono i tipi a decidere quali programmi compaiono, e
 * un tipo entrato di nascosto cambia l'elenco senza che nessuno lo abbia deciso.
 */
export const MIN_TYPE_CONFIDENCE = 0.5;

/** Lunghezza minima di una descrizione perché valga la pena interpretarla. */
export const MIN_DESCRIPTION_LENGTH = 15;

// ---------------------------------------------------------------------------
// Codici di errore del modulo
// ---------------------------------------------------------------------------

/**
 * ⚠️ Un codice fuori da questo elenco NON viene mostrato grezzo: diventa il
 * messaggio generico, che è la verità. È la stessa regola delle automazioni.
 */
export const SUBSIDY_ERROR_CODES = [
  'source_blocked',            // la guardia ha rifiutato l'indirizzo (SSRF)
  'source_unreachable',        // la fonte non risponde
  'source_too_large',          // oltre il tetto di byte
  'source_content_type',       // tipo di contenuto non ammesso
  'source_redirect_off_host',  // un redirect esce dall'host dichiarato
  'adapter_unknown',           // nessun adapter per questa chiave
  'adapter_unsupported',       // struttura che l'adapter non sa leggere
  'version_not_published',     // nessuna versione pubblicata per il programma
  'no_project',                // la valutazione richiede un progetto
  'fingerprint_unchanged',     // niente da rivalutare (non è un errore)
  'unknown',
] as const;
export type SubsidyErrorCode = (typeof SUBSIDY_ERROR_CODES)[number];

// ---------------------------------------------------------------------------
// I tipi condivisi del dominio
// ---------------------------------------------------------------------------

export const SUBSIDY_PROJECT_TYPES = [
  'innovazione', 'energia', 'digitalizzazione', 'formazione',
  'mobilita', 'assunzioni', 'export', 'edilizia',
] as const;
export type SubsidyProjectType = (typeof SUBSIDY_PROJECT_TYPES)[number];

export const SUBSIDY_SECTORS = [
  'industria', 'costruzioni', 'commercio', 'servizi',
  'ict', 'turismo', 'sanita', 'trasporti',
] as const;
export type SubsidySector = (typeof SUBSIDY_SECTORS)[number];

export const PROJECT_STAGES = ['idea', 'planned', 'started', 'completed', 'cancelled'] as const;
export type ProjectStage = (typeof PROJECT_STAGES)[number];

export const RULE_OPERATORS = [
  'equals', 'not_equals', 'contains', 'in',
  'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal',
  'exists', 'not_exists', 'before', 'after',
] as const;
export type RuleOperator = (typeof RULE_OPERATORS)[number];

/** Operatori che non hanno un valore di confronto. */
export const UNARY_OPERATORS: readonly RuleOperator[] = ['exists', 'not_exists'];

export const RULE_HARDNESS = ['hard', 'soft', 'exclusion', 'informative'] as const;
export type RuleHardness = (typeof RULE_HARDNESS)[number];

export const RULE_EVALUABILITY = ['auto', 'question', 'manual'] as const;
export type RuleEvaluability = (typeof RULE_EVALUABILITY)[number];

export const CRITERION_STATES = [
  'satisfied', 'not_satisfied', 'unknown', 'conflicting', 'not_evaluable',
] as const;
export type CriterionState = (typeof CRITERION_STATES)[number];

export const ELIGIBILITY_STATUSES = [
  'not_assessed', 'insufficient_information', 'potentially_eligible',
  'likely_ineligible', 'ineligible',
] as const;
export type SubsidyEligibilityStatus = (typeof ELIGIBILITY_STATUSES)[number];

export const RELEVANCE_LEVELS = ['high', 'medium', 'low'] as const;
export type RelevanceLevel = (typeof RELEVANCE_LEVELS)[number];

export const COMPLETENESS_LEVELS = ['complete', 'minor_gaps', 'major_gaps'] as const;
export type CompletenessLevel = (typeof COMPLETENESS_LEVELS)[number];

export const TIMING_STATES = ['open', 'upcoming', 'closed', 'continuous', 'unknown'] as const;
export type TimingState = (typeof TIMING_STATES)[number];

export const FRESHNESS_LEVELS = ['fresh', 'aging', 'stale', 'unverified'] as const;
export type FreshnessLevel = (typeof FRESHNESS_LEVELS)[number];

export const READINESS_LEVELS = ['not_started', 'in_preparation', 'ready', 'submitted'] as const;
export type ReadinessLevel = (typeof READINESS_LEVELS)[number];

export const CALL_STATUSES = [
  'upcoming', 'open', 'closed', 'continuous', 'suspended', 'unknown',
] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const FACT_SOURCES = [
  'company_profile', 'company_registry', 'project',
  'user_answer', 'document', 'interpretation', 'unknown',
] as const;
export type FactSource = (typeof FACT_SOURCES)[number];

/**
 * ⚠️ LA SCALA DI AUTORITÀ DELLE FONTI DI UN FATTO (§36).
 *
 * Quando due fonti dicono cose diverse sullo stesso fatto, vince quella più in
 * alto — e se la distanza è minima il fatto diventa `conflicting` invece di
 * essere risolto in silenzio. Una risposta esplicita di una persona batte
 * qualunque deduzione: è la stessa regola per cui in Finanze una correzione
 * umana batte l'estrazione AI.
 */
export const FACT_SOURCE_AUTHORITY: Record<FactSource, number> = {
  user_answer: 100,
  company_registry: 80,
  project: 70,
  company_profile: 60,
  document: 50,
  interpretation: 30,
  unknown: 0,
};
