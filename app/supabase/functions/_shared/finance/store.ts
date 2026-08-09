// ============================================================================
// Persistenza di Finance. TUTTO ciò che tocca il database sta qui, e solo qui.
//
// Gira SEMPRE con il service role, perché scrive tabelle che il client non può
// scrivere. Il bypass della RLS è legittimo soltanto se l'autorizzazione è già
// avvenuta a monte — qui a monte c'è un trigger del database che ha creato
// l'elemento finanziario — e per non dipendere dalla memoria di chi scriverà il
// prossimo chiamante, OGNI interrogazione filtra ESPLICITAMENTE per
// `company_id`. La RLS non è un secondo controllo disponibile: qui non c'è.
// È la disciplina di `_shared/email/store.ts` e di `_shared/automation/store.ts`.
//
// ⚠️ NEI LOG NON ENTRA NULLA DI CIÒ CHE STA IN QUESTE RIGHE. Niente IBAN, niente
// riferimenti, niente nomi di fornitore, niente testo del documento: solo
// identificativi, conteggi e codici (§168). Questo file non stampa nulla — a
// stampare è chi lo chiama, e con le stesse regole.
// ============================================================================
import {
  FINANCE_AI_KIND, FINANCE_MAX_ATTEMPTS, FINANCE_RATE_LIMIT_PER_MINUTE,
  FINANCE_SCHEMA_VERSION, FINANCE_STALE_MINUTES, type FinanceErrorCode, type FinanceQualityFlag,
} from './contract.ts';

/** Forma minima del client Supabase usata qui. Identica in Deno e in Node. */
export interface ServerClient {
  from: (table: string) => any;
  // ⚠️ `PromiseLike`, NON `Promise`: `sb.rpc(…)` torna un `PostgrestFilterBuilder`,
  // che ha `then` e NON ha `catch` né `finally`. Dichiararlo `Promise` rendeva il
  // client vero non assegnabile a questa interfaccia, e ha coperto un `.catch()`
  // che a runtime sollevava. Vedi `persist.ts` → `SupabaseWithRpc`.
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }>;
}

/** Errore del modulo: porta un CODICE, mai un messaggio del database (§110). */
export class FinanceStoreError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'FinanceStoreError';
  }
}

function fail(code: string, error: unknown): never {
  // ⚠️ Il messaggio del database NON viaggia: contiene nomi di tabelle e, in un
  // vincolo violato, può contenere il valore che l'ha violato — cioè un IBAN.
  const detail = (error as { code?: string } | null)?.code;
  throw new FinanceStoreError(code, detail ? `${code}:${detail}` : code);
}

// ---------------------------------------------------------------------------
// La coda
// ---------------------------------------------------------------------------

export interface FinanceItemRow {
  id: string;
  company_id: string;
  document_id: string;
  type: 'supplier_invoice' | 'receipt' | 'credit_note';
  processing_status: 'pending' | 'processing' | 'completed' | 'failed';
  extraction_attempts: number;
  updated_at: string;
}

const ITEM_COLUMNS =
  'id, company_id, document_id, type, processing_status, extraction_attempts, updated_at';

/**
 * Prende in carico UN elemento e lo mette in lavorazione.
 *
 * ⚠️ UNO ALLA VOLTA, E NON PER PRUDENZA GENERICA.
 * Il guardiano della 0021 rifiuta la transizione `processing → pending`: una
 * volta preso in carico, un elemento NON può essere rimesso in coda dal worker.
 * L'unico modo per riprenderlo è il recupero degli interrotti, che aspetta
 * `FINANCE_STALE_MINUTES`. Prendere in carico un lotto e poi restare senza
 * tempo lascerebbe quindi gli elementi non lavorati fermi per mezz'ora, senza
 * che nessuno sappia perché. Si prende un elemento solo quando c'è davvero il
 * tempo per leggerlo.
 *
 * ⚠️ LA PRESA IN CARICO È ATOMICA senza bisogno di una funzione SQL: l'UPDATE
 * ripete nella clausola sia lo stato sia il numero di tentativi letti un istante
 * prima. Due worker che vedono la stessa riga si serializzano sul lock di riga
 * di Postgres, e il secondo rivaluta la condizione DOPO il lock: trova
 * `extraction_attempts` già incrementato e aggiorna zero righe. È lo stesso
 * confronto-e-scambio del lease della Inbox, ottenuto con una colonna che il
 * modello dati aveva già.
 */
export async function claimNextFinanceItem(
  sb: ServerClient,
  options: { staleMinutes?: number; maxAttempts?: number } = {},
): Promise<FinanceItemRow | null> {
  const staleMinutes = options.staleMinutes ?? FINANCE_STALE_MINUTES;
  const maxAttempts = options.maxAttempts ?? FINANCE_MAX_ATTEMPTS;
  const staleBefore = new Date(Date.now() - staleMinutes * 60_000).toISOString();

  // (1) Prima ciò che aspetta da più tempo. (2) Poi ciò che un'esecuzione
  //     precedente ha lasciato a metà: un isolate ucciso dai 150 secondi non ha
  //     potuto scrivere niente, e senza questo recupero l'elemento resterebbe
  //     «in lavorazione» per sempre — uno stato appeso è indistinguibile da un
  //     lavoro in corso.
  //     Due interrogazioni invece di una `or(...)`: la seconda confronta una
  //     data, e infilare un timestamp dentro la sintassi dei filtri combinati di
  //     PostgREST significa doverlo sfuggire a mano. Una riga in più qui vale
  //     più di un filtro che si rompe il giorno del cambio d'ora.
  const candidates: FinanceItemRow[] = [];

  const pending = await sb.from('finance_items')
    .select(ITEM_COLUMNS)
    .eq('processing_status', 'pending')
    .lt('extraction_attempts', maxAttempts)
    .order('created_at', { ascending: true })
    .limit(10);
  if (pending.error) fail('QUEUE_READ_FAILED', pending.error);
  candidates.push(...((pending.data ?? []) as FinanceItemRow[]));

  const stale = await sb.from('finance_items')
    .select(ITEM_COLUMNS)
    .eq('processing_status', 'processing')
    .lt('extraction_attempts', maxAttempts)
    .lt('updated_at', staleBefore)
    .order('updated_at', { ascending: true })
    .limit(10);
  if (stale.error) fail('QUEUE_READ_FAILED', stale.error);
  candidates.push(...((stale.data ?? []) as FinanceItemRow[]));

  for (const row of candidates) {
    const claimed = await sb.from('finance_items')
      .update({
        processing_status: 'processing',
        extraction_attempts: row.extraction_attempts + 1,
        // Il codice dell'ultimo fallimento si azzera adesso: da questo istante
        // l'elemento è di nuovo in lavorazione, e mostrare l'errore precedente
        // accanto a un lavoro in corso direbbe una cosa non più vera.
        error_code: null,
      })
      .eq('id', row.id)
      .eq('company_id', row.company_id)
      .eq('processing_status', row.processing_status)
      .eq('extraction_attempts', row.extraction_attempts)
      .select(ITEM_COLUMNS)
      .maybeSingle();
    if (claimed.error) fail('CLAIM_FAILED', claimed.error);
    if (claimed.data) return claimed.data as FinanceItemRow;
    // Zero righe: un'altra esecuzione l'ha presa nel frattempo. Non è un errore,
    // è la corsa che si risolve come deve. Si passa al candidato successivo.
  }

  return null;
}

/** Quanti elementi restano in attesa. Serve al rapporto, non a decidere. */
export async function countPendingFinanceItems(sb: ServerClient): Promise<number> {
  const { count, error } = await sb.from('finance_items')
    .select('id', { count: 'exact', head: true })
    .eq('processing_status', 'pending');
  if (error) fail('QUEUE_READ_FAILED', error);
  return typeof count === 'number' ? count : 0;
}

// ---------------------------------------------------------------------------
// Il testo del documento
// ---------------------------------------------------------------------------

export interface DocumentTextRow {
  fullText: string;
  pages: { pageNumber: number; text: string }[];
  extractionMethod: string | null;
  ocrConfidence: number | null;
  truncated: boolean;
  /**
   * ⚠️ LA FORMA DEL FILE DA CUI IL TESTO DICE DI VENIRE (§4). Serve a una cosa
   * sola: chiedere a `looksLikeScan` se quel testo è compatibile con quel file.
   * `pageCount` viene dall'estrazione, `fileSize` da `documents` — sono due
   * tabelle, ed è la ragione per cui questa funzione fa due letture.
   */
  pageCount: number;
  fileSize: number | null;
}

/**
 * Rilegge il testo GIÀ ESTRATTO del documento.
 *
 * ⚠️ NON SI RIESEGUE L'OCR E NON SI RISCARICA IL FILE, e non è un'ottimizzazione:
 * il documento è già stato analizzato da Admin AI, quel testo è quello su cui
 * l'utente vede le citazioni evidenziate, e rileggerlo da capo produrrebbe un
 * secondo testo — quindi citazioni che non si ritrovano nel documento mostrato
 * a schermo, e una seconda spesa di OCR per ottenerlo. Se il testo non c'è,
 * l'estrazione finanziaria non parte: `NO_TEXT` è un errore esplicito.
 */
export async function loadDocumentText(
  sb: ServerClient, companyId: string, documentId: string,
): Promise<DocumentTextRow | null> {
  const { data, error } = await sb.from('document_extractions')
    .select('full_text, pages, extraction_method, ocr_confidence, truncated, page_count')
    .eq('document_id', documentId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (error) fail('TEXT_READ_FAILED', error);
  if (!data) return null;

  const row = data as {
    full_text: string | null;
    pages: unknown;
    extraction_method: string | null;
    ocr_confidence: number | null;
    truncated: boolean | null;
    page_count: number | null;
  };
  const fullText = typeof row.full_text === 'string' ? row.full_text : '';
  if (!fullText.trim()) return null;

  // ⚠️ SECONDA LETTURA, e non un embed PostgREST. `file_size` vive su `documents`
  // e non sull'estrazione; scriverlo come relazione annidata renderebbe questa
  // funzione dipendente da come PostgREST risolve la chiave esterna — che è
  // esattamente il PGRST200 già pagato dal Document Hub. Una `select` su una
  // colonna non può fallire per quella ragione, e costa una richiesta a fronte
  // di una chiamata al modello.
  //
  // ⚠️ Se la lettura non riesce, `fileSize` resta `null` e `looksLikeScan`
  // risponde `false`: si perde la guardia, non si inventa un verdetto. La
  // funzione è conservativa per costruzione e qui la si lascia esserlo.
  const doc = await sb.from('documents')
    .select('file_size').eq('id', documentId).eq('company_id', companyId).maybeSingle();
  const fileSize = typeof (doc.data as { file_size?: unknown } | null)?.file_size === 'number'
    ? (doc.data as { file_size: number }).file_size
    : null;

  const pages = Array.isArray(row.pages)
    ? (row.pages as unknown[])
      .map((p) => {
        const page = (typeof p === 'object' && p !== null) ? p as Record<string, unknown> : {};
        const number = typeof page.pageNumber === 'number' ? page.pageNumber : null;
        const text = typeof page.text === 'string' ? page.text : '';
        return number === null ? null : { pageNumber: number, text };
      })
      .filter((p): p is { pageNumber: number; text: string } => p !== null)
    : [];

  return {
    fullText,
    pages,
    extractionMethod: row.extraction_method,
    ocrConfidence: typeof row.ocr_confidence === 'number' ? row.ocr_confidence : null,
    truncated: row.truncated === true,
    // ⚠️ `page_count` è la fonte, `pages.length` il ripiego, e l'ordine conta:
    // di una scansione le pagine possono arrivare senza testo e venire scartate
    // dal filtro qui sopra, lasciando un elenco vuoto su un documento di dieci
    // pagine. Contarle da lì gonfierebbe la densità e assolverebbe proprio il
    // caso che questa colonna serve a riconoscere. Il minimo è 1: dividere per
    // zero pagine non è una domanda che abbia risposta.
    pageCount: Math.max(1, row.page_count ?? pages.length),
    fileSize,
  };
}

// ---------------------------------------------------------------------------
// Il verbale
// ---------------------------------------------------------------------------

export interface FinanceExtractionRow {
  companyId: string;
  financeItemId: string;
  documentId: string;
  status: 'completed' | 'failed';
  /** Come è stato ottenuto il verbale NEL SUO INSIEME: il dettaglio sta in `fieldSources`. */
  method: string;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;

  invoiceNumber?: string | null;
  supplierName?: string | null;
  supplierAddress?: string | null;
  supplierVatId?: string | null;
  supplierCountry?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  currency?: string | null;
  /** ⚠️ STRINGHE decimali verso una colonna `numeric`: mai un `number` (§48). */
  grossAmount?: string | null;
  netAmount?: string | null;
  vatAmount?: string | null;
  vatBreakdown?: unknown[];

  creditorIban?: string | null;
  ibanIsQr?: boolean | null;
  referenceType?: 'qrr' | 'scor' | 'non' | null;
  paymentReference?: string | null;

  qrPresent?: boolean;
  qrValid?: boolean | null;
  qrSpecVersion?: string | null;
  qrErrors?: string[];

  merchant?: string | null;
  expenseDate?: string | null;
  paymentMethodDetected?: 'card' | 'cash' | 'other' | null;

  fieldSources?: Record<string, string>;
  fieldConfidence?: Record<string, number>;
  evidence?: Record<string, unknown>;
  uncertainties?: unknown[];
  qualityFlags?: FinanceQualityFlag[];
  documentLanguage?: string | null;

  errorCode?: FinanceErrorCode | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
}

/**
 * La versione successiva del verbale. Un tentativo non sostituisce il
 * precedente: lo affianca (§9), ed è ciò che permette di rispondere a «prima
 * diceva un altro importo?» con un fatto invece che con un'impressione.
 */
async function nextExtractionVersion(
  sb: ServerClient, companyId: string, financeItemId: string,
): Promise<number> {
  const { data, error } = await sb.from('finance_extractions')
    .select('extraction_version')
    .eq('finance_item_id', financeItemId)
    .eq('company_id', companyId)
    .order('extraction_version', { ascending: false })
    .limit(1);
  if (error) fail('VERSION_READ_FAILED', error);
  const rows = (data ?? []) as { extraction_version: number }[];
  return rows.length ? rows[0].extraction_version + 1 : 1;
}

/**
 * Scrive il verbale.
 *
 * ⚠️ QUI FINISCE IL LAVORO DEL WORKER, E DI PROPOSITO. Su questo `insert`
 * scatta `finance_after_extraction`: è il database a promuovere il verbale a
 * «corrente», a mettere l'elemento in `completed`, a ricalcolare la proiezione
 * `eff_*` e a scrivere l'evento. Rifarlo da qui produrrebbe due verità sullo
 * stesso stato, e la seconda sarebbe quella che invecchia.
 */
export async function saveFinanceExtraction(
  sb: ServerClient, row: FinanceExtractionRow,
): Promise<{ id: string; version: number }> {
  const version = await nextExtractionVersion(sb, row.companyId, row.financeItemId);

  const { data, error } = await sb.from('finance_extractions').insert({
    company_id: row.companyId,
    finance_item_id: row.financeItemId,
    document_id: row.documentId,
    extraction_version: version,
    status: row.status,
    method: row.method,
    provider: row.provider,
    model: row.model,
    prompt_version: row.promptVersion,
    schema_version: FINANCE_SCHEMA_VERSION,

    invoice_number: row.invoiceNumber ?? null,
    supplier_name: row.supplierName ?? null,
    supplier_address: row.supplierAddress ?? null,
    supplier_vat_id: row.supplierVatId ?? null,
    supplier_country: row.supplierCountry ?? null,
    invoice_date: row.invoiceDate ?? null,
    due_date: row.dueDate ?? null,
    currency: row.currency ?? null,
    gross_amount: row.grossAmount ?? null,
    net_amount: row.netAmount ?? null,
    vat_amount: row.vatAmount ?? null,
    vat_breakdown: row.vatBreakdown ?? [],

    creditor_iban: row.creditorIban ?? null,
    iban_is_qr: row.ibanIsQr ?? null,
    reference_type: row.referenceType ?? null,
    payment_reference: row.paymentReference ?? null,

    qr_present: row.qrPresent ?? false,
    qr_valid: row.qrValid ?? null,
    qr_spec_version: row.qrSpecVersion ?? null,
    qr_errors: row.qrErrors ?? [],

    merchant: row.merchant ?? null,
    expense_date: row.expenseDate ?? null,
    payment_method_detected: row.paymentMethodDetected ?? null,

    field_sources: row.fieldSources ?? {},
    field_confidence: row.fieldConfidence ?? {},
    evidence: row.evidence ?? {},
    uncertainties: row.uncertainties ?? [],
    quality_flags: row.qualityFlags ?? [],
    document_language: row.documentLanguage ?? null,

    error_code: row.errorCode ?? null,
    input_tokens: row.inputTokens ?? null,
    output_tokens: row.outputTokens ?? null,
    duration_ms: row.durationMs ?? null,
  }).select('id, extraction_version').single();

  if (error) fail('EXTRACTION_WRITE_FAILED', error);
  const saved = data as { id: string; extraction_version: number };
  return { id: saved.id, version: saved.extraction_version };
}

// ---------------------------------------------------------------------------
// Gli esiti negativi
// ---------------------------------------------------------------------------

/**
 * Guasto DEFINITIVO: riprovare darebbe lo stesso esito, oppure i tentativi sono
 * finiti. L'elemento passa a `failed` con il suo codice, e da lì una persona può
 * chiedere «Riprova estrazione» — che il database ammette, perché la transizione
 * `failed → pending` non è quella vietata.
 */
export async function markFinanceFailed(
  sb: ServerClient, item: FinanceItemRow, code: FinanceErrorCode,
): Promise<void> {
  const { error } = await sb.from('finance_items')
    .update({ processing_status: 'failed', error_code: code })
    .eq('id', item.id)
    .eq('company_id', item.company_id);
  if (error) fail('STATUS_WRITE_FAILED', error);
}

/**
 * Guasto TRANSITORIO: il modello non ha risposto, la quota è finita, il tempo è
 * scaduto. Si riproverà da solo.
 *
 * ⚠️ L'ELEMENTO RESTA IN `processing`, E NON È UNA DIMENTICANZA.
 * Il guardiano della 0021 vieta `processing → pending`: rimetterlo in coda è
 * impossibile per costruzione. L'unico percorso di ripresa automatica è quindi
 * il recupero degli interrotti, che riprende proprio le righe in `processing`
 * più vecchie di `FINANCE_STALE_MINUTES`. Lo stato dice il vero — l'elemento è
 * in lavorazione, con un nuovo tentativo già previsto — e `error_code` dichiara
 * perché l'ultimo tentativo non è riuscito, così l'interfaccia non deve
 * inventarsi una spiegazione.
 *
 * ⚠️ ALTERNATIVA SCARTATA: dichiararlo subito `failed`. Sarebbe stato più
 * visibile, ma avrebbe reso un'indisponibilità di trenta secondi del fornitore
 * AI indistinguibile da un documento illeggibile, e avrebbe scaricato su una
 * persona il compito di ripremere un pulsante che il sistema sa premere da solo.
 * Al tetto dei tentativi il fallimento diventa comunque definitivo ed esplicito.
 */
export async function markFinanceRetryLater(
  sb: ServerClient, item: FinanceItemRow, code: FinanceErrorCode,
): Promise<void> {
  // ⚠️ `extraction_attempts` COMPRENDE GIÀ IL TENTATIVO IN CORSO: lo incrementa
  // `claimNextFinanceItem` al momento della presa in carico, e la riga qui arriva
  // da quell'UPDATE. Confrontare `attempts + 1` toglierebbe un tentativo a ogni
  // documento senza che nessuno se ne accorga — il tetto dichiarato dal
  // contratto sarebbe tre e quelli davvero eseguiti due.
  if (item.extraction_attempts >= FINANCE_MAX_ATTEMPTS) {
    await markFinanceFailed(sb, item, code);
    return;
  }
  const { error } = await sb.from('finance_items')
    .update({ error_code: code })
    .eq('id', item.id)
    .eq('company_id', item.company_id)
    .eq('processing_status', 'processing');
  if (error) fail('STATUS_WRITE_FAILED', error);
}

// ---------------------------------------------------------------------------
// Quota AI (§50/§58)
// ---------------------------------------------------------------------------

/**
 * Prenota uno slot di spesa AI per l'azienda.
 *
 * ⚠️ SI USA LA VARIANTE «system» perché qui NON C'È UN UTENTE: il worker gira
 * con il service role e `auth.uid()` è NULL. `try_consume_ai_quota` (0009)
 * pretende un utente e fallirebbe; `try_consume_ai_quota_system` (0013) riusa lo
 * stesso lock consultivo per azienda e lascia cadere solo il controllo che senza
 * utente non ha senso.
 *
 * ⚠️ SE LA FUNZIONE NON C'È, NON SI PROSEGUE. Un limite di spesa che si
 * disattiva da solo quando una migrazione non è stata applicata è peggio di
 * nessun limite: nessuno se ne accorge finché non arriva il conto. È la stessa
 * scelta di `reserveSystemAiSlot` nell'Inbox.
 */
export async function reserveFinanceAiSlot(
  sb: ServerClient,
  input: { companyId: string; documentId: string; model: string },
): Promise<string | null> {
  const { data, error } = await sb.rpc('try_consume_ai_quota_system', {
    p_company_id: input.companyId,
    p_kind: FINANCE_AI_KIND,
    p_limit: FINANCE_RATE_LIMIT_PER_MINUTE,
    p_document_id: input.documentId,
    p_provider: 'anthropic',
    p_model: input.model,
  });
  if (error) throw new FinanceStoreError('CONFIG_MISSING', 'quota AI di sistema non disponibile');
  return (data as string | null) ?? null;
}

/** Completa la riga prenotata. Un log a metà falserebbe il conteggio del limite. */
export async function finalizeFinanceAiSlot(
  sb: ServerClient,
  logId: string | null,
  outcome: {
    status: 'ok' | 'error';
    durationMs?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    errorCode?: string | null;
    model?: string | null;
  },
): Promise<void> {
  if (!logId) return;
  // Un errore qui non deve far fallire l'estrazione: il verbale è già scritto, e
  // perderlo per una riga di registro sarebbe il baratto sbagliato.
  await sb.rpc('finalize_ai_request_system', {
    p_id: logId,
    p_status: outcome.status,
    p_duration_ms: outcome.durationMs ?? null,
    p_input_tokens: outcome.inputTokens ?? null,
    p_output_tokens: outcome.outputTokens ?? null,
    p_error_code: outcome.errorCode ?? null,
    p_model: outcome.model ?? null,
  });
}
