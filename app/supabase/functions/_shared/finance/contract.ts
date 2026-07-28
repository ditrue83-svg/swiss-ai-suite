// ============================================================================
// Il CONTRATTO del modulo Finance: le costanti che il server APPLICA e che
// l'interfaccia DICHIARA.
//
// ⚠️ NESSUN LIMITE VA SCRITTO IN UN POSTO SOLO. Quando il database applica un
// tetto e l'interfaccia ne promette un altro, la schermata dice una cosa e il
// sistema ne fa un'altra: è già successo con `INITIAL_SYNC_DAYS` dell'Inbox.
// Quello che si può, si dichiara qui e si confronta nel test.
//
// Modulo PORTABILE: solo costanti e tipi, nessun import, nessuna dipendenza.
// Lo leggono il worker (Deno), i test (Node) e il browser (Vite).
// ============================================================================

/**
 * Il tetto di tempo di una esecuzione del worker.
 *
 * ⚠️ Misurato, non stimato. Supabase chiude una richiesta che non risponde
 * entro 150 secondi e UCCIDE l'isolate: il `finally` non gira e restano stati
 * appesi. Il valore è lo stesso già in vigore per Inbox, Calendario e
 * Automazioni — e come là è definito nel contratto del PROPRIO modulo, perché
 * un modulo non deve importare il contratto di un altro per sapere quanto tempo
 * ha.
 */
export const EDGE_TIME_BUDGET_MS = 100_000;

/**
 * Lo spazio che deve restare libero PRIMA di cominciare una nuova estrazione.
 * Controllare solo che il budget non sia finito non basterebbe: si comincerebbe
 * una lettura con dieci secondi davanti e la si perderebbe a metà, lasciando
 * l'elemento in `processing` per sempre.
 */
export const FINANCE_SLOT_MS = 40_000;

/** Quanti elementi al massimo un'esecuzione prende in carico. */
export const FINANCE_BATCH = 5;

/**
 * Da quanti minuti un elemento «in lavorazione» è da considerarsi INTERROTTO.
 * Un isolate ucciso dai 150 secondi non ha potuto scrivere niente: senza questo
 * recupero l'elemento resterebbe in lavorazione per sempre, e uno stato appeso
 * è indistinguibile da un lavoro in corso.
 */
export const FINANCE_STALE_MINUTES = 30;

/** Quante volte si ritenta prima di dichiarare fallita la lettura. */
export const FINANCE_MAX_ATTEMPTS = 3;

/**
 * Il tetto di spesa AI per azienda, al minuto.
 * ⚠️ È LO STESSO di `analyze-document` e dell'Inbox, e di proposito: è il tetto
 * di spesa dell'AZIENDA, non un dettaglio di questo modulo. A cambiare è il
 * modo di consumarlo, non quanto se ne consuma.
 */
export const FINANCE_RATE_LIMIT_PER_MINUTE = 12;

/** Il tipo di richiesta scritto in `ai_request_log`. */
export const FINANCE_AI_KIND = 'finance_extraction';

/** Quanto testo del documento si passa al modello. */
export const FINANCE_MAX_CHARS = 40_000;

/** Versione dello schema di estrazione: cambia quando cambiano i campi. */
export const FINANCE_SCHEMA_VERSION = 1;
export const FINANCE_PROMPT_VERSION = 'finance-1';

/**
 * Le valute che il prodotto tratta senza sorprese. NON è un elenco chiuso:
 * una fattura estera con una valuta fuori elenco viene comunque letta e
 * mostrata — semplicemente non compare fra i filtri predefiniti. Restringere
 * qui significherebbe rifiutare documenti veri.
 */
export const FINANCE_COMMON_CURRENCIES = ['CHF', 'EUR', 'USD', 'GBP'] as const;

/**
 * I codici di errore del modulo. Sono CHIAVI: la frase la scrive l'interfaccia
 * nella lingua di chi legge (§110). Nessun messaggio grezzo del database esce
 * verso il client — contiene nomi di tabelle, che a chi legge non dicono niente
 * e a chi guarda dicono troppo.
 */
export const FINANCE_ERROR_CODES = [
  'NO_TEXT',              // il documento non ha testo estratto da cui leggere
  'NOT_FINANCIAL',        // letto, ma non è un documento finanziario
  'AI_INVALID_OUTPUT',
  'AI_NOT_CONFIGURED',
  'RATE_LIMITED',
  'PROVIDER_ERROR',
  'TIME_BUDGET',          // il tempo è finito: non è un guasto
  'INTERRUPTED',          // l'esecuzione precedente è stata uccisa a metà
  'SCHEMA_INVALID',
  'UNKNOWN_ERROR',
] as const;
export type FinanceErrorCode = (typeof FINANCE_ERROR_CODES)[number];

/**
 * I campi che una persona può correggere (§152). Deve coincidere ESATTAMENTE
 * con il vincolo `finance_correction_field_known` della 0021: il test lo
 * verifica, perché due elenchi «quasi uguali» divergono al primo campo
 * aggiunto da una parte sola.
 */
export const FINANCE_CORRECTABLE_FIELDS = [
  'supplier_name', 'supplier_vat_id', 'supplier_address',
  'invoice_number', 'invoice_date', 'due_date',
  'currency', 'gross_amount', 'net_amount', 'vat_amount',
  'creditor_iban', 'payment_reference', 'reference_type',
  'merchant', 'expense_date',
] as const;
export type FinanceCorrectableField = (typeof FINANCE_CORRECTABLE_FIELDS)[number];

/**
 * I campi ad ALTO RISCHIO (§153): toccano il DENARO, non la descrizione.
 * Una modifica qui va mostrata come modifica manuale, sempre e in evidenza.
 */
export const FINANCE_HIGH_RISK_FIELDS: readonly FinanceCorrectableField[] = [
  'creditor_iban', 'payment_reference', 'reference_type',
];

/** Le bandiere di qualità, come le dichiara l'enum della 0021. */
export const FINANCE_QUALITY_FLAGS = [
  'amount_mismatch', 'vat_mismatch', 'qr_text_mismatch',
  'missing_currency', 'missing_total', 'missing_supplier',
  'duplicate_suspected', 'low_ocr_confidence',
  'invalid_iban', 'invalid_reference', 'reference_type_mismatch',
  'inconsistent_due_date', 'ambiguous_date', 'qr_not_read', 'negative_amount',
] as const;
export type FinanceQualityFlag = (typeof FINANCE_QUALITY_FLAGS)[number];

/**
 * Che cosa serve, come minimo, perché una fattura possa essere dichiarata
 * verificata (§84).
 *
 * ⚠️ IL NUMERO DI FATTURA NON C'È, ed è una scelta. Molti documenti legittimi
 * non ne hanno uno — ricevute, note spese, fatture di piccoli fornitori — e
 * pretenderlo bloccherebbe la verifica di documenti perfettamente in ordine,
 * insegnando a chi lavora che il prodotto va aggirato.
 */
export const FINANCE_READY_REQUIREMENTS = [
  'supplier',   // un nome di fornitore o di esercente
  'gross',      // un importo totale
  'currency',   // la sua valuta
] as const;

/**
 * La soglia oltre la quale una fiducia dichiarata dal modello NON basta per
 * trattare un valore come un fatto. Stessa soglia del motore delle automazioni:
 * un valore incerto è incerto allo stesso modo per tutti i moduli.
 */
export const FINANCE_MIN_CONFIDENCE = 0.6;
