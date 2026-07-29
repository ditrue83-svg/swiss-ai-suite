// ============================================================================
// Il CONTRATTO del modulo Contract Manager: le costanti che il server APPLICA e
// che l'interfaccia DICHIARA.
//
// ⚠️ IL NOME DI QUESTO FILE È UN OMONIMO, E VA LETTO CON ATTENZIONE.
// «Contract» qui significa CONTRATTO DI INTERFACCIA fra i pezzi del modulo — è
// la convenzione già in uso in `_shared/automation/contract.ts`,
// `_shared/calendar/contract.ts`, `_shared/email/contract.ts` e
// `_shared/finance/contract.ts` — e NON il contratto di cui il modulo si occupa.
// Rinominarlo avrebbe rotto una convenzione che vale per cinque moduli; tenerlo
// costringe a questa nota, che costa meno.
//
// ⚠️ NESSUN LIMITE VA SCRITTO IN UN POSTO SOLO. Quando il database applica un
// tetto e l'interfaccia ne promette un altro, la schermata dice una cosa e il
// sistema ne fa un'altra: è già successo con `INITIAL_SYNC_DAYS` dell'Inbox.
//
// Modulo PORTABILE: solo costanti e tipi, nessun import, nessuna dipendenza.
// Lo leggono il worker (Deno), i test (Node) e il browser (Vite).
// ============================================================================

/**
 * Il tetto di tempo di una esecuzione del worker.
 *
 * ⚠️ Misurato, non stimato. Supabase chiude una richiesta che non risponde entro
 * 150 secondi e UCCIDE l'isolate: il `finally` non gira e restano stati appesi.
 * Come per Inbox, Calendario, Automazioni e Finance, il valore è dichiarato nel
 * contratto del PROPRIO modulo — un modulo non deve importare il contratto di un
 * altro per sapere quanto tempo ha.
 */
export const EDGE_TIME_BUDGET_MS = 100_000;

/**
 * Lo spazio che deve restare libero PRIMA di cominciare una lettura.
 *
 * ⚠️ PIÙ ALTO DI QUELLO DI FINANCE (40 s), e non per prudenza generica: un
 * contratto è un documento LUNGO. Una fattura sta in una pagina, un contratto di
 * locazione ne ha dieci più le condizioni generali, e il modello deve leggerle
 * tutte per trovare una clausola di preavviso che sta in fondo. Cominciare una
 * lettura con quaranta secondi davanti significherebbe perderla a metà e
 * lasciare il documento in lavorazione fino al recupero degli interrotti.
 */
export const CONTRACT_SLOT_MS = 55_000;

/** Quanti documenti al massimo un'esecuzione prende in carico. */
export const CONTRACT_BATCH = 3;

/**
 * Da quanti minuti un documento «in lavorazione» è da considerarsi INTERROTTO.
 * Un isolate ucciso dai 150 secondi non ha potuto scrivere niente: senza questo
 * recupero il documento resterebbe in lavorazione per sempre, e uno stato appeso
 * è indistinguibile da un lavoro in corso.
 */
export const CONTRACT_STALE_MINUTES = 30;

/**
 * Quanti tentativi prima di arrendersi.
 * ⚠️ Il tentativo si conta alla PRESA, non al fallimento: è la lezione della
 * 0020. Un worker ucciso dai 150 secondi non arriverebbe mai a incrementare un
 * contatore incrementato solo in caso di errore, e il documento verrebbe ripreso
 * all'infinito senza raggiungere il tetto.
 */
export const CONTRACT_MAX_ATTEMPTS = 3;

/**
 * Quanto testo si manda al modello.
 *
 * ⚠️ §113 — IL TAGLIO NON È MAI SILENZIOSO. Oltre questo limite il documento
 * viene troncato, l'estrazione lo dichiara (`truncated`), la bandiera
 * `partially_analysed` si accende e il contratto resta da verificare. Un
 * contratto letto a metà e presentato come letto per intero farebbe sparire
 * esattamente le clausole che stanno in fondo — dove, nei contratti veri,
 * stanno quasi sempre la disdetta e il foro competente.
 */
export const CONTRACT_MAX_CHARS = 120_000;

/** La versione del prompt: cambia quando cambia ciò che si chiede al modello. */
export const CONTRACT_PROMPT_VERSION = '2026-07-28.1';

/** La versione dello schema di `contract_extractions`. */
export const CONTRACT_SCHEMA_VERSION = 1;

/**
 * Sotto questa fiducia un valore NON si salva (§16).
 *
 * ⚠️ PIÙ ALTA DI QUELLA DI FINANCE (0.55), e la ragione è nelle conseguenze. Un
 * importo di fattura sbagliato si scopre pagando; un preavviso sbagliato si
 * scopre quando il contratto si è già rinnovato per dodici mesi, e non si torna
 * indietro. Su un termine contrattuale un campo vuoto costa una lettura in più,
 * un campo sbagliato costa un anno di canone.
 */
export const CONTRACT_MIN_CONFIDENCE = 0.65;

/** La quota AI: il tipo di richiesta registrato nel log tecnico (§111). */
export const CONTRACT_AI_KIND = 'contract_extraction';

/**
 * Gli ancoraggi da cui il prodotto SA derivare una data.
 *
 * ⚠️⚠️ QUESTO ELENCO È UNA PROMESSA, e ha un solo altro posto in cui vive: la
 * funzione SQL `contract_notice_deadline` della 0024. Le due devono dire la
 * stessa cosa, e `npm run test:contracts` le confronta ancoraggio per
 * ancoraggio contro il database vero — perché un elenco che diverge dal calcolo
 * produrrebbe un'interfaccia che promette una data che nessuno calcolerà, o
 * peggio che tace su una data che esiste.
 *
 * Perché gli altri non ci sono: «per fine mese», «per fine trimestre» e «per
 * fine anno» richiedono di sapere a quale scadenza il preavviso si riferisce e
 * come le due regole si compongono. Due letture legittime della stessa clausola
 * danno due date diverse: sceglierne una significherebbe che il prodotto ha
 * deciso una questione di interpretazione del contratto.
 */
export const DERIVABLE_ANCHORS = ['before_fixed_end', 'before_renewal_date'] as const;
export type DerivableAnchor = (typeof DERIVABLE_ANCHORS)[number];

export const NOTICE_ANCHORS = [
  'before_fixed_end', 'before_renewal_date', 'to_month_end', 'to_quarter_end',
  'to_year_end', 'anytime', 'other', 'unclear',
] as const;
export type ContractNoticeAnchor = (typeof NOTICE_ANCHORS)[number];

export const PERIOD_UNITS = ['days', 'weeks', 'months', 'years'] as const;
export type ContractPeriodUnit = (typeof PERIOD_UNITS)[number];

export const CONTRACT_TYPES = [
  'insurance', 'leasing', 'rent', 'telecom', 'software_subscription',
  'supplier', 'maintenance', 'service', 'licensing', 'nda', 'other',
] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

export const CONTRACT_DOCUMENT_RELATIONS = [
  'main_agreement', 'amendment', 'annex', 'renewal', 'termination_notice', 'other',
] as const;
export type ContractDocumentRelation = (typeof CONTRACT_DOCUMENT_RELATIONS)[number];

export const AUTO_RENEWAL_VALUES = ['yes', 'no', 'unclear'] as const;
export type ContractAutoRenewal = (typeof AUTO_RENEWAL_VALUES)[number];

export const END_DATE_KINDS = ['explicit', 'none', 'unknown'] as const;
export type ContractEndKind = (typeof END_DATE_KINDS)[number];

export const TERMINATION_METHODS = [
  'written_notice', 'email', 'registered_mail', 'portal', 'other',
] as const;
export type ContractTerminationMethod = (typeof TERMINATION_METHODS)[number];

export const COST_FREQUENCIES = [
  'one_time', 'monthly', 'quarterly', 'yearly', 'other', 'unknown',
] as const;
export type ContractCostFrequency = (typeof COST_FREQUENCIES)[number];

/**
 * Le clausole che si RILEVANO, senza giudicarle (§59/§60).
 *
 * ⚠️ Ognuna è un FATTO osservabile nel testo, non un rischio. «È presente una
 * clausola di esclusiva» è una rilevazione; «clausola rischiosa» sarebbe una
 * valutazione, e valutare se una clausola sia svantaggiosa è esattamente ciò che
 * questo modulo non fa.
 */
export const ATTENTION_CLAUSE_KINDS = [
  'automatic_renewal', 'minimum_duration', 'termination_fee', 'exclusivity',
  'price_adjustment', 'notice_requirement', 'confidentiality', 'data_processing',
  'minimum_purchase_commitment', 'liability_limitation', 'other',
] as const;
export type AttentionClauseKind = (typeof ATTENTION_CLAUSE_KINDS)[number];

export const CONTRACT_QUALITY_FLAGS = [
  'missing_counterparty', 'ambiguous_start_date', 'ambiguous_end_date',
  'renewal_unclear', 'notice_anchor_unclear', 'notice_not_derivable',
  'conflicting_terms', 'missing_referenced_annex', 'low_extraction_confidence',
  'amendment_requires_review', 'partially_analysed', 'out_of_scope_contract_kind',
  'cost_unclear', 'multiple_currencies',
] as const;
export type ContractQualityFlag = (typeof CONTRACT_QUALITY_FLAGS)[number];

/**
 * I campi correggibili a mano.
 *
 * ⚠️ DEVE COINCIDERE con il vincolo `contract_correction_field_known` della
 * 0024: è un elenco chiuso in due posti, e `npm run test:contracts` verifica che
 * siano lo stesso elenco. Un campo presente qui e assente là verrebbe rifiutato
 * dal database dopo che l'interfaccia lo ha offerto.
 */
export const CONTRACT_CORRECTABLE_FIELDS = [
  'counterparty_name', 'company_party',
  'start_date', 'end_date', 'end_date_kind',
  'minimum_term_value', 'minimum_term_unit',
  'auto_renewal', 'renewal_period_value', 'renewal_period_unit',
  'notice_period_value', 'notice_period_unit', 'notice_anchor', 'notice_anchor_text',
  'termination_method', 'termination_address',
  'cost_amount', 'cost_currency', 'cost_frequency', 'cost_vat_included',
  'price_adjustment', 'effective_from',
] as const;
export type ContractCorrectableField = (typeof CONTRACT_CORRECTABLE_FIELDS)[number];

/**
 * I campi il cui CAMBIAMENTO va mostrato nel confronto di un amendment (§27).
 * Non tutti i campi meritano un confronto: cambiare l'indirizzo per la disdetta
 * non è una notizia, cambiare il preavviso o il costo sì.
 */
export const COMPARED_TERM_FIELDS = [
  'counterparty_name', 'start_date', 'end_date', 'end_date_kind',
  'auto_renewal', 'renewal_period_value', 'renewal_period_unit',
  'notice_period_value', 'notice_period_unit', 'notice_anchor',
  'minimum_term_value', 'minimum_term_unit',
  'cost_amount', 'cost_currency', 'cost_frequency', 'price_adjustment',
  'termination_method',
] as const;
export type ComparedTermField = (typeof COMPARED_TERM_FIELDS)[number];

/** I codici di errore del modulo. CHIAVI: la frase la scrive l'interfaccia. */
export type ContractErrorCode =
  | 'NO_TEXT'                  // il documento non ha testo estratto
  // ⚠️ DIVERSO da `NO_TEXT`, che è transitorio perché il testo può ancora
  // arrivare. Qui il testo È arrivato ed è incompatibile con il file: qualche
  // decina di caratteri residui di una scansione. Leggerli e concluderne
  // «non è un contratto» sarebbe un'affermazione sul documento ricavata da
  // qualcosa che nessuno ha letto — e manderebbe a cercare l'errore nel
  // contratto invece che nel file.
  | 'SCANNED_NO_TEXT'          // il testo estratto non è compatibile con il file
  | 'AI_UNAVAILABLE'           // nessuna chiave configurata
  | 'AI_REFUSED'               // il modello non ha restituito JSON leggibile
  | 'AI_OUTPUT_TRUNCATED'      // tagliato dal tetto di token: è un limite NOSTRO
  | 'PROVIDER_RATE_LIMITED'    // quota esaurita: si ritenta, non è un fallimento
  | 'QUOTA_EXCEEDED'
  | 'NOT_A_CONTRACT'           // il documento non sembra un contratto
  | 'INTERRUPTED'              // ucciso dai 150 secondi, recuperabile
  | 'STORAGE_MISSING'
  | 'UNKNOWN';

/**
 * ⚠️ I codici che NON sono un fallimento del documento, ma dell'ambiente.
 * Su questi NON si scrive un'estrazione `failed`: il documento resta in coda e
 * si ritenta. È la lezione della 0021: una riga di estrazione fallita significa
 * «si è provato e quel documento non si riesce a leggere», e usarla per dire
 * «la quota era finita» renderebbe indistinguibili due situazioni che si
 * risolvono in modi opposti.
 */
export const TRANSIENT_CODES: readonly ContractErrorCode[] = [
  'PROVIDER_RATE_LIMITED', 'QUOTA_EXCEEDED', 'AI_UNAVAILABLE', 'INTERRUPTED',
];

export function isTransient(code: ContractErrorCode): boolean {
  return TRANSIENT_CODES.includes(code);
}
