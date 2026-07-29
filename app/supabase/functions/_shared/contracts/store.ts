// ============================================================================
// Persistenza di Contract Manager. TUTTO ciò che tocca il database sta qui.
//
// Gira SEMPRE con il service role, perché scrive tabelle che il client non può
// scrivere. Il bypass della RLS è legittimo solo se l'autorizzazione è avvenuta
// a monte — qui a monte c'è una riga di `contract_documents` creata da un membro
// dell'azienda — e per non dipendere dalla memoria del prossimo chiamante, OGNI
// interrogazione filtra ESPLICITAMENTE per `company_id`.
//
// ⚠️ NEI LOG NON ENTRA NULLA DI CIÒ CHE STA IN QUESTE RIGHE (§110). Niente testo
// di clausole, niente indirizzi, niente importi, niente nomi di controparte:
// solo identificativi, conteggi e codici. Questo file non stampa nulla — a
// stampare è chi lo chiama, e con le stesse regole.
// ============================================================================
import {
  CONTRACT_MAX_ATTEMPTS, CONTRACT_SCHEMA_VERSION, CONTRACT_STALE_MINUTES,
  type ContractErrorCode, type ContractQualityFlag,
} from './contract.ts';

/** Forma minima del client Supabase usata qui. Identica in Deno e in Node. */
export interface ServerClient {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  storage?: { from: (bucket: string) => any };
}

export class ContractStoreError extends Error {
  constructor(public readonly code: string, message?: string) {
    super(message ?? code);
    this.name = 'ContractStoreError';
  }
}

function fail(code: string, error: unknown): never {
  // ⚠️ Il messaggio del database NON viaggia: contiene nomi di tabelle e, in un
  // vincolo violato, può contenere il valore che l'ha violato.
  const detail = (error as { code?: string } | null)?.code;
  throw new ContractStoreError(code, detail ? `${code}:${detail}` : code);
}

// ---------------------------------------------------------------------------
// La coda
// ---------------------------------------------------------------------------

export interface ContractDocumentRow {
  id: string;
  company_id: string;
  contract_id: string;
  document_id: string;
  relation: string;
  processing_status: string;
  extraction_attempts: number;
  added_at: string;
}

const QUEUE_COLUMNS =
  'id, company_id, contract_id, document_id, relation, processing_status, extraction_attempts, added_at';

/**
 * Prende in carico UN documento e lo mette in lavorazione.
 *
 * ⚠️ UNO ALLA VOLTA, come in Finance e per la stessa ragione: il guardiano della
 * 0024 rifiuta la transizione `processing → pending`, quindi un documento preso
 * in carico e non lavorato resta fermo fino al recupero degli interrotti. Si
 * prende in carico solo quando c'è davvero il tempo per leggere.
 *
 * ⚠️ IL TENTATIVO SI CONTA ALLA PRESA, non al fallimento (lezione della 0020):
 * un worker ucciso dai 150 secondi non arriverebbe mai a incrementare un
 * contatore incrementato in caso di errore, e il documento verrebbe ripreso
 * all'infinito senza raggiungere mai il tetto.
 */
export async function claimNextDocument(
  sb: ServerClient,
): Promise<ContractDocumentRow | null> {
  const { data, error } = await sb
    .from('contract_documents')
    .select(QUEUE_COLUMNS)
    .eq('processing_status', 'pending')
    .lt('extraction_attempts', CONTRACT_MAX_ATTEMPTS)
    .order('added_at', { ascending: true })
    .limit(1);
  if (error) fail('QUEUE_READ_FAILED', error);

  const row = (data as ContractDocumentRow[] | null)?.[0];
  if (!row) return null;

  const { data: claimed, error: claimError } = await sb
    .from('contract_documents')
    .update({
      processing_status: 'processing',
      extraction_attempts: row.extraction_attempts + 1,
    })
    // ⚠️ La condizione sullo stato è ciò che rende la presa ATOMICA: due
    // esecuzioni sovrapposte non possono prendere lo stesso documento, perché la
    // seconda non trova più `pending`. Senza, due worker leggerebbero lo stesso
    // contratto e pagherebbero due volte la stessa lettura.
    .eq('id', row.id)
    .eq('processing_status', 'pending')
    .select(QUEUE_COLUMNS);
  if (claimError) fail('CLAIM_FAILED', claimError);

  const taken = (claimed as ContractDocumentRow[] | null)?.[0];
  return taken ?? null;
}

/**
 * Rimette in coda i documenti INTERROTTI.
 * Un isolate ucciso dai 150 secondi non ha potuto scrivere niente: senza questo
 * recupero resterebbero «in lavorazione» per sempre, indistinguibili da un
 * lavoro in corso.
 */
export async function requeueStale(sb: ServerClient): Promise<number> {
  const threshold = new Date(Date.now() - CONTRACT_STALE_MINUTES * 60_000).toISOString();
  const { data, error } = await sb
    .from('contract_documents')
    .select('id, extraction_attempts')
    .eq('processing_status', 'processing')
    .lt('added_at', threshold);
  if (error) fail('STALE_READ_FAILED', error);

  const rows = (data as { id: string; extraction_attempts: number }[] | null) ?? [];
  let requeued = 0;
  for (const row of rows) {
    // Oltre il tetto dei tentativi non si riprova: diventa un guasto DICHIARATO
    // e visibile nella schermata, non un fantasma che gira per sempre.
    const patch = row.extraction_attempts >= CONTRACT_MAX_ATTEMPTS
      ? { processing_status: 'failed', error_code: 'INTERRUPTED' as ContractErrorCode }
      : { processing_status: 'pending', error_code: 'INTERRUPTED' as ContractErrorCode };
    const { error: updateError } = await sb
      .from('contract_documents').update(patch)
      .eq('id', row.id).eq('processing_status', 'processing');
    if (!updateError) requeued += 1;
  }
  return requeued;
}

// ---------------------------------------------------------------------------
// Il testo del documento
// ---------------------------------------------------------------------------

export interface DocumentText {
  fullText: string;
  pages: { pageNumber: number; text: string }[];
  language: string | null;
}

/**
 * Il testo già estratto dal documento.
 *
 * ⚠️ NON SI CREA UNA SECONDA PIPELINE DI OCR. Il testo lo produce già
 * `document_extractions` (0006), lo stesso che leggono Admin AI, l'Inbox e
 * Finance. Se non c'è, il documento non è pronto: si dichiara `NO_TEXT` e si
 * ritenta più tardi, invece di rileggere il PDF una seconda volta con un secondo
 * estrattore che direbbe cose leggermente diverse.
 */
export async function loadDocumentText(
  sb: ServerClient,
  documentId: string,
  companyId: string,
): Promise<DocumentText | null> {
  const { data, error } = await sb
    .from('document_extractions')
    .select('full_text, pages, created_at')
    .eq('document_id', documentId)
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) fail('TEXT_READ_FAILED', error);

  const row = (data as { full_text: string | null; pages: unknown }[] | null)?.[0];
  if (!row) return null;

  // Le pagine sono un jsonb `[{ pageNumber, text, ocrConfidence }]` (0006). Si
  // usano per dire A CHE PAGINA sta una citazione: senza, «Mostra clausola»
  // aprirebbe il PDF senza sapere dove.
  const pages = Array.isArray(row.pages)
    ? (row.pages as { pageNumber?: unknown; text?: unknown }[])
        .filter((p) => typeof p?.text === 'string' && (p.text as string).length > 0)
        .map((p, i) => ({
          pageNumber: typeof p.pageNumber === 'number' ? p.pageNumber : i + 1,
          text: p.text as string,
        }))
    : [];

  const fullText = row.full_text ?? pages.map((p) => p.text).join('\n\n');
  if (!fullText || !fullText.trim()) return null;

  return { fullText, pages, language: null };
}

/** Il nome dell'azienda: aiuta il modello a distinguere le due parti. */
export async function loadCompanyName(
  sb: ServerClient, companyId: string,
): Promise<string | null> {
  const { data, error } = await sb
    .from('companies').select('name').eq('id', companyId).maybeSingle();
  if (error) return null;
  return (data as { name?: string } | null)?.name ?? null;
}

/** L'ultima estrazione riuscita di questo documento, per l'impronta (§112). */
export async function lastSuccessfulHash(
  sb: ServerClient, contractId: string, documentId: string,
): Promise<{ hash: string | null; version: number } | null> {
  const { data, error } = await sb
    .from('contract_extractions')
    .select('content_hash, extraction_version')
    .eq('contract_id', contractId)
    .eq('document_id', documentId)
    .eq('status', 'completed')
    .order('extraction_version', { ascending: false })
    .limit(1);
  if (error) return null;
  const row = (data as { content_hash: string | null; extraction_version: number }[] | null)?.[0];
  return row ? { hash: row.content_hash, version: row.extraction_version } : null;
}

/** Il numero della prossima versione per questo documento. */
export async function nextExtractionVersion(
  sb: ServerClient, contractId: string, documentId: string,
): Promise<number> {
  const { data, error } = await sb
    .from('contract_extractions')
    .select('extraction_version')
    .eq('contract_id', contractId)
    .eq('document_id', documentId)
    .order('extraction_version', { ascending: false })
    .limit(1);
  if (error) fail('VERSION_READ_FAILED', error);
  const row = (data as { extraction_version: number }[] | null)?.[0];
  return (row?.extraction_version ?? 0) + 1;
}

// ---------------------------------------------------------------------------
// La scrittura del verbale
// ---------------------------------------------------------------------------

export interface ContractExtractionInput {
  companyId: string;
  contractId: string;
  documentId: string;
  version: number;
  status: 'completed' | 'failed';
  method?: string;
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  fields?: Record<string, unknown>;
  qualityFlags?: ContractQualityFlag[];
  errorCode?: ContractErrorCode | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  durationMs?: number | null;
  contentHash?: string | null;
}

/**
 * Scrive il verbale.
 *
 * ⚠️ NON AGGIORNA `contract_documents` NÉ LA BOZZA: lo fa il trigger
 * `contract_after_extraction` della 0024. Farlo anche qui significherebbe avere
 * due posti in cui ricordarsene, e il giorno in cui uno dei due dimentica, il
 * documento resta «in lavorazione» per sempre. È la lezione della 0021.
 */
export async function saveContractExtraction(
  sb: ServerClient, input: ContractExtractionInput,
): Promise<string> {
  const row = {
    company_id: input.companyId,
    contract_id: input.contractId,
    document_id: input.documentId,
    extraction_version: input.version,
    status: input.status,
    method: input.method ?? 'ai',
    provider: input.provider ?? null,
    model: input.model ?? null,
    prompt_version: input.promptVersion ?? null,
    schema_version: CONTRACT_SCHEMA_VERSION,
    quality_flags: input.qualityFlags ?? [],
    error_code: input.errorCode ?? null,
    input_tokens: input.inputTokens ?? null,
    output_tokens: input.outputTokens ?? null,
    duration_ms: input.durationMs ?? null,
    content_hash: input.contentHash ?? null,
    ...(input.fields ?? {}),
  };

  const { data, error } = await sb
    .from('contract_extractions').insert(row).select('id');
  if (error) fail('EXTRACTION_WRITE_FAILED', error);
  const inserted = (data as { id: string }[] | null)?.[0];
  if (!inserted) fail('EXTRACTION_WRITE_FAILED', null);
  return inserted.id;
}

/** Un guasto TRANSITORIO: il documento torna in coda, nessun verbale si scrive. */
export async function releaseDocument(
  sb: ServerClient, documentId: string, code: ContractErrorCode,
): Promise<void> {
  const { error } = await sb
    .from('contract_documents')
    .update({ processing_status: 'pending', error_code: code })
    .eq('id', documentId)
    .eq('processing_status', 'processing');
  if (error) fail('RELEASE_FAILED', error);
}

// ---------------------------------------------------------------------------
// La quota AI
// ---------------------------------------------------------------------------

/**
 * Prenota uno slot di spesa AI per l'azienda.
 *
 * ⚠️ SI USA LA VARIANTE «system» perché qui NON C'È UN UTENTE: il worker gira con
 * il service role e `auth.uid()` è NULL. `try_consume_ai_quota` (0009) pretende
 * un utente e fallirebbe. È la stessa scelta di Finance e dell'Inbox.
 *
 * ⚠️ SE LA FUNZIONE NON C'È, NON SI PROSEGUE. Un limite di spesa che si
 * disattiva da solo quando una migrazione non è stata applicata è peggio di
 * nessun limite: nessuno se ne accorge finché non arriva il conto.
 *
 * ⚠️ Il tetto è più basso di quello di Finance (12/min): un contratto è un
 * documento lungo e costa più di una fattura, e leggerne sei al minuto
 * significherebbe spendere in un'ora la quota di una giornata.
 */
export const CONTRACT_RATE_LIMIT_PER_MINUTE = 6;

export async function reserveContractAiSlot(
  sb: ServerClient,
  input: { companyId: string; documentId: string; model: string; kind: string },
): Promise<string | null> {
  const { data, error } = await sb.rpc('try_consume_ai_quota_system', {
    p_company_id: input.companyId,
    p_kind: input.kind,
    p_limit: CONTRACT_RATE_LIMIT_PER_MINUTE,
    p_document_id: input.documentId,
    p_provider: 'anthropic',
    p_model: input.model,
  });
  if (error) throw new ContractStoreError('CONFIG_MISSING', 'quota AI di sistema non disponibile');
  return (data as string | null) ?? null;
}

/** Chiude la riga prenotata. §111 — METADATI, mai il prompt né il documento. */
export async function finalizeContractAiSlot(
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
