// ============================================================================
// Persistenza dell'Inbox. Tutto ciò che tocca il database o lo Storage.
//
// Gira SEMPRE con service role, perché scrive tabelle che il client non può
// scrivere. Il bypass della RLS è legittimo solo se l'autorizzazione è già
// avvenuta a monte — è la stessa disciplina di `analyze-document` (0010) — e
// per non dipendere dalla memoria di chi scriverà il prossimo chiamante, ogni
// query qui filtra ESPLICITAMENTE per `company_id`. La RLS non è un secondo
// controllo disponibile: qui non c'è.
// ============================================================================
import { sha256Hex, open as openSealed, seal, type Sealed } from './crypto.ts';
import {
  extensionForMime, planAttachments, safeAttachmentName, sniffMatches, type AttachmentDecision,
} from './attachments.ts';
import { makePreview, stripQuotedAndSignature } from './normalize.ts';
import { attentionForRelevance, type EmailAttentionValue, type EmailRelevanceValue } from './contract.ts';
import { EmailProviderError } from './types.ts';
import type { NormalizedEmailMessage } from './types.ts';

/** Forma minima del client Supabase usata qui. Identica in Deno e Node. */
export interface ServerClient {
  from: (table: string) => any;
  rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  storage: { from: (bucket: string) => any };
}

export const DOCUMENTS_BUCKET = 'company-documents';

// ---- Connessione e segreti --------------------------------------------------

export interface ConnectionRow {
  id: string;
  company_id: string;
  provider: 'google' | 'microsoft';
  provider_account_id: string;
  email_address: string;
  status: string;
  sync_enabled: boolean;
  sync_cursor: string | null;
  history_floor_at: string | null;
  watch_resource_id: string | null;
  watch_expires_at: string | null;
  watch_last_renewed_at: string | null;
  initial_sync_completed_at: string | null;
  sync_lease_id: string | null;
  sync_lease_until: string | null;
}

const CONNECTION_COLUMNS =
  'id, company_id, provider, provider_account_id, email_address, status, sync_enabled, sync_cursor, ' +
  'history_floor_at, watch_resource_id, watch_expires_at, watch_last_renewed_at, ' +
  'initial_sync_completed_at, sync_lease_id, sync_lease_until';

export async function getConnection(sb: ServerClient, connectionId: string): Promise<ConnectionRow | null> {
  const { data } = await sb.from('email_connections').select(CONNECTION_COLUMNS).eq('id', connectionId).maybeSingle();
  return (data as ConnectionRow) ?? null;
}

export async function findConnectionByAccount(
  sb: ServerClient, companyId: string, provider: string, providerAccountId: string,
): Promise<ConnectionRow | null> {
  const { data } = await sb.from('email_connections').select(CONNECTION_COLUMNS)
    .eq('company_id', companyId).eq('provider', provider).eq('provider_account_id', providerAccountId).maybeSingle();
  return (data as ConnectionRow) ?? null;
}

/** I byte cifrati viaggiano come `\x…` da PostgREST: qui si tornano byte veri. */
function hexToBytes(value: unknown): Uint8Array | null {
  if (value == null) return null;
  if (value instanceof Uint8Array) return value;
  const s = String(value);
  const hex = s.startsWith('\\x') ? s.slice(2) : s;
  if (!/^[0-9a-fA-F]*$/.test(hex) || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '\\x';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

export interface ConnectionSecrets {
  accessToken: string | null;
  accessTokenExpiresAt: string | null;
  refreshToken: string | null;
  webhookState: string | null;
}

/**
 * Legge e decifra i segreti. L'AAD è l'id della connessione: un ciphertext
 * copiato su un'altra riga non si decifra, quindi chi potesse scrivere nel
 * database non potrebbe assegnarsi i token di un'altra azienda.
 */
export async function readSecrets(sb: ServerClient, key: CryptoKey, connectionId: string): Promise<ConnectionSecrets> {
  const { data } = await sb.from('email_connection_secrets')
    .select('access_token_ct, access_token_iv, access_token_expires_at, refresh_token_ct, refresh_token_iv, webhook_state_ct, webhook_state_iv')
    .eq('connection_id', connectionId).maybeSingle();
  if (!data) return { accessToken: null, accessTokenExpiresAt: null, refreshToken: null, webhookState: null };

  const decrypt = async (ct: unknown, iv: unknown): Promise<string | null> => {
    const c = hexToBytes(ct);
    const i = hexToBytes(iv);
    if (!c || !i || !c.length || !i.length) return null;
    try {
      return await openSealed(key, { ciphertext: c, iv: i }, connectionId);
    } catch {
      // Decifratura fallita = chiave ruotata o dato manomesso. Non è un caso in
      // cui «ripiegare»: si dichiara assente, e il chiamante chiederà di
      // ricollegare l'account. Un token che non si decifra non è un token.
      return null;
    }
  };

  return {
    accessToken: await decrypt(data.access_token_ct, data.access_token_iv),
    accessTokenExpiresAt: (data.access_token_expires_at as string | null) ?? null,
    refreshToken: await decrypt(data.refresh_token_ct, data.refresh_token_iv),
    webhookState: await decrypt(data.webhook_state_ct, data.webhook_state_iv),
  };
}

export async function writeSecrets(
  sb: ServerClient,
  key: CryptoKey,
  input: {
    connectionId: string; companyId: string;
    accessToken?: string | null; accessTokenExpiresAt?: string | null;
    refreshToken?: string | null; webhookState?: string | null;
  },
): Promise<void> {
  const row: Record<string, unknown> = {
    connection_id: input.connectionId,
    company_id: input.companyId,
    key_version: 1,
  };
  const put = async (field: string, value: string | null | undefined) => {
    if (value === undefined) return;                      // non toccare
    if (value === null) { row[`${field}_ct`] = null; row[`${field}_iv`] = null; return; }
    const sealed: Sealed = await seal(key, value, input.connectionId);
    row[`${field}_ct`] = bytesToHex(sealed.ciphertext);
    row[`${field}_iv`] = bytesToHex(sealed.iv);
  };
  await put('access_token', input.accessToken);
  await put('refresh_token', input.refreshToken);
  await put('webhook_state', input.webhookState);
  if (input.accessTokenExpiresAt !== undefined) row.access_token_expires_at = input.accessTokenExpiresAt;

  const { error } = await sb.from('email_connection_secrets').upsert(row, { onConflict: 'connection_id' });
  if (error) throw new Error('salvataggio dei segreti fallito');
}

export async function deleteSecrets(sb: ServerClient, connectionId: string): Promise<void> {
  await sb.from('email_connection_secrets').delete().eq('connection_id', connectionId);
}

// ---- Lease di sincronizzazione (§125) ---------------------------------------

/**
 * Prende il lock con un UNICO update condizionale: è il database a decidere chi
 * vince, non una lettura seguita da una scrittura. Un lease scaduto viene
 * sovrascritto, quindi un processo morto non blocca la casella per sempre.
 */
export async function acquireLease(
  sb: ServerClient, connectionId: string, leaseSeconds: number,
): Promise<string | null> {
  const leaseId = crypto.randomUUID();
  const now = new Date().toISOString();
  const until = new Date(Date.now() + leaseSeconds * 1000).toISOString();
  const { data } = await sb.from('email_connections')
    .update({ sync_lease_id: leaseId, sync_lease_until: until, last_sync_at: now })
    .eq('id', connectionId)
    .or(`sync_lease_until.is.null,sync_lease_until.lt.${now}`)
    .select('id');
  return Array.isArray(data) && data.length ? leaseId : null;
}

export async function releaseLease(sb: ServerClient, connectionId: string, leaseId: string): Promise<void> {
  await sb.from('email_connections')
    .update({ sync_lease_id: null, sync_lease_until: null })
    .eq('id', connectionId).eq('sync_lease_id', leaseId);
}

// ---- Registro delle sincronizzazioni ----------------------------------------

export interface SyncCounters {
  messagesSeen: number;
  messagesNew: number;
  messagesUpdated: number;
  attachmentsImported: number;
  documentsCreated: number;
  analysesStarted: number;
}

export function newCounters(): SyncCounters {
  return { messagesSeen: 0, messagesNew: 0, messagesUpdated: 0, attachmentsImported: 0, documentsCreated: 0, analysesStarted: 0 };
}

export async function startSyncRun(
  sb: ServerClient,
  input: { companyId: string; connectionId: string; syncType: string; triggeredBy: string; cursorBefore: string | null },
): Promise<string | null> {
  const { data } = await sb.from('email_sync_runs').insert({
    company_id: input.companyId, connection_id: input.connectionId,
    sync_type: input.syncType, status: 'running', triggered_by: input.triggeredBy,
    cursor_before: input.cursorBefore,
  }).select('id').maybeSingle();
  return (data?.id as string) ?? null;
}

export async function finishSyncRun(
  sb: ServerClient,
  runId: string | null,
  input: {
    status: 'ok' | 'partial' | 'failed'; counters: SyncCounters; cursorAfter: string | null;
    errorCode?: string | null; errorDetail?: string | null; startedAtMs: number;
  },
): Promise<void> {
  if (!runId) return;
  await sb.from('email_sync_runs').update({
    status: input.status,
    completed_at: new Date().toISOString(),
    duration_ms: Date.now() - input.startedAtMs,
    messages_seen: input.counters.messagesSeen,
    messages_new: input.counters.messagesNew,
    messages_updated: input.counters.messagesUpdated,
    attachments_imported: input.counters.attachmentsImported,
    documents_created: input.counters.documentsCreated,
    analyses_started: input.counters.analysesStarted,
    cursor_after: input.cursorAfter,
    error_code: input.errorCode ?? null,
    // Mai il messaggio grezzo del provider: potrebbe contenere identificativi.
    error_detail_safe: input.errorDetail ? String(input.errorDetail).slice(0, 300) : null,
  }).eq('id', runId);
}

export async function recordAudit(
  sb: ServerClient,
  input: { companyId: string; connectionId: string | null; actorUserId: string | null; action: string; detail?: Record<string, unknown> },
): Promise<void> {
  try {
    await sb.from('email_audit_log').insert({
      company_id: input.companyId, connection_id: input.connectionId,
      actor_user_id: input.actorUserId, action: input.action, detail: input.detail ?? {},
    });
  } catch { /* l'audit non deve far fallire l'operazione che sta registrando */ }
}

// ---- Messaggi ---------------------------------------------------------------

export interface UpsertResult {
  id: string;
  isNew: boolean;
  /** true quando la fonte è cambiata rispetto a quella già acquisita (§117). */
  sourceChanged: boolean;
}

/**
 * Inserisce il messaggio, o lo riconosce come già presente.
 *
 * L'idempotenza non è affidata a un `if (!exists)`: si tenta l'inserimento e si
 * lascia decidere al vincolo unico `(connection_id, provider_message_id)`. Due
 * webhook simultanei che portano lo stesso messaggio non possono creare due
 * righe nemmeno se arrivano nello stesso millisecondo, perché la corsa la
 * arbitra il database (§124).
 *
 * Una risincronizzazione NON riscrive il contenuto già acquisito: si confronta
 * l'impronta e, se differisce, lo si annota. Sovrascrivere significherebbe
 * cambiare sotto i piedi la fonte di un'analisi già prodotta.
 */
export async function upsertMessage(
  sb: ServerClient,
  input: {
    companyId: string; connectionId: string; message: NormalizedEmailMessage;
  },
): Promise<UpsertResult> {
  const { companyId, connectionId, message } = input;
  const cleaned = stripQuotedAndSignature(message.textBody);
  const fingerprint = await sha256Hex(
    [message.externalId, message.subject ?? '', message.from?.email ?? '', message.receivedAt, message.textBody].join('\0'),
  );

  const row = {
    company_id: companyId,
    connection_id: connectionId,
    provider_message_id: message.externalId,
    provider_thread_id: message.threadId,
    internet_message_id: message.internetMessageId,
    subject: message.subject,
    sender_name: message.from?.name ?? null,
    sender_email: message.from?.email ?? null,
    to_recipients: message.to,
    cc_recipients: message.cc,
    received_at: message.receivedAt,
    sent_at: message.sentAt,
    body_text: message.textBody,
    body_preview: message.preview || makePreview(message.textBody),
    body_links: message.links,
    body_char_count: message.textBody.length,
    body_clean: cleaned.text,
    quoted_removed: cleaned.quotedRemoved,
    has_attachments: message.attachments.length > 0,
    attachment_count: message.attachments.length,
    importance: message.importance,
    is_bulk: message.isBulk,
    processing_status: 'pending',
    attention_status: 'to_verify',
    source_fingerprint: fingerprint,
  };

  const { data: inserted, error } = await sb.from('email_messages').insert(row).select('id').maybeSingle();
  if (!error && inserted?.id) return { id: inserted.id as string, isNew: true, sourceChanged: false };

  // 23505 = violazione del vincolo unico: il messaggio c'era già. È il percorso
  // NORMALE di un webhook duplicato, non un guasto.
  const code = (error as { code?: string } | null)?.code;
  if (code && code !== '23505') {
    throw new Error(`upsertMessage: ${(error as { message?: string }).message ?? code}`);
  }

  const { data: existing } = await sb.from('email_messages')
    .select('id, source_fingerprint')
    .eq('connection_id', connectionId).eq('provider_message_id', message.externalId).maybeSingle();
  if (!existing?.id) throw new Error('upsertMessage: riga non trovata dopo conflitto');

  return {
    id: existing.id as string,
    isNew: false,
    sourceChanged: !!existing.source_fingerprint && existing.source_fingerprint !== fingerprint,
  };
}

export async function setMessageProcessing(
  sb: ServerClient,
  messageId: string,
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await sb.from('email_messages').update({ processing_status: status, ...extra }).eq('id', messageId);
}

export async function setMessageClassification(
  sb: ServerClient,
  messageId: string,
  input: {
    relevance: EmailRelevanceValue; confidence: number | null; reason: string | null;
    classifierVersion: string; provider: string | null; model: string | null; promptVersion: string | null;
    attention?: EmailAttentionValue;
  },
): Promise<void> {
  await sb.from('email_messages').update({
    relevance: input.relevance,
    relevance_confidence: input.confidence,
    relevance_reason: input.reason,
    classifier_version: input.classifierVersion,
    classifier_provider: input.provider,
    classifier_model: input.model,
    classifier_prompt_version: input.promptVersion,
    classified_at: new Date().toISOString(),
    attention_status: input.attention ?? attentionForRelevance(input.relevance),
  }).eq('id', messageId);
}

/** Il mittente ha già prodotto posta amministrativa per questa azienda (§30). */
export async function isKnownAdministrativeSender(
  sb: ServerClient, companyId: string, senderEmail: string | null,
): Promise<boolean> {
  if (!senderEmail) return false;
  const { data } = await sb.from('email_messages')
    .select('id')
    .eq('company_id', companyId)
    .eq('sender_email', senderEmail)
    .in('relevance', ['likely_actionable'])
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

// ---- Allegati ---------------------------------------------------------------

export interface StoredAttachment {
  id: string;
  providerAttachmentId: string;
  mimeType: string | null;
  sizeBytes: number | null;
  storagePath: string | null;
  fileHash: string | null;
  filename: string | null;
  imported: boolean;
}

/**
 * Registra i metadati di TUTTI gli allegati, importati o no. Anche uno scartato
 * lascia la sua riga con il motivo: l'utente deve poter vedere che c'era un file
 * e perché non è stato letto, invece di dedurre dall'assenza (§41).
 */
export async function recordAttachmentPlan(
  sb: ServerClient,
  input: { companyId: string; messageId: string; decisions: AttachmentDecision[] },
): Promise<Map<string, string>> {
  const idByExternal = new Map<string, string>();
  for (const decision of input.decisions) {
    const a = decision.attachment;
    const status = decision.accepted
      ? 'pending'
      : decision.reason === 'inline' ? 'skipped_inline'
        : decision.reason === 'too_large' ? 'skipped_too_large'
          : 'skipped_unsupported';
    const row = {
      company_id: input.companyId,
      email_message_id: input.messageId,
      provider_attachment_id: a.externalId,
      filename: a.filename,
      safe_filename: safeAttachmentName(a.filename, extensionForMime(decision.mimeType ?? '')),
      declared_mime_type: a.declaredMimeType,
      mime_type: decision.mimeType,
      size_bytes: a.sizeBytes,
      content_id: a.contentId,
      is_inline: a.isInline,
      import_status: status,
      skip_reason: decision.reason,
    };
    const { data } = await sb.from('email_attachments')
      .upsert(row, { onConflict: 'email_message_id,provider_attachment_id' })
      .select('id').maybeSingle();
    if (data?.id) idByExternal.set(a.externalId, data.id as string);
  }
  return idByExternal;
}

export async function markAttachment(
  sb: ServerClient, attachmentId: string, patch: Record<string, unknown>,
): Promise<void> {
  await sb.from('email_attachments').update(patch).eq('id', attachmentId);
}

// ---- Documenti --------------------------------------------------------------

/**
 * Crea (o riusa) il documento AI-Swisse corrispondente a un contenuto.
 *
 * Deduplicazione per hash dentro l'azienda, riusando l'indice della 0006: lo
 * stesso PDF arrivato due volte non genera due documenti. Ma il riuso NON
 * cancella la relazione con il messaggio: quella la scrive `linkDocument`, e
 * per questo la deduplicazione non fa perdere la provenienza (§59).
 *
 * `uploaded_by` resta NULL: nessuna persona ha caricato questo file, e
 * attribuirlo a chi ha collegato la casella sarebbe falso (§80). La colonna è
 * nullable dalla 0002, quindi non serve inventare un attore di sistema.
 */
export async function createOrReuseDocument(
  sb: ServerClient,
  input: {
    companyId: string; title: string; filename: string; mimeType: string;
    bytes: Uint8Array; folder: string;
  },
): Promise<{ documentId: string; storagePath: string | null; reused: boolean; fileHash: string }> {
  const fileHash = await sha256Hex(input.bytes);

  const { data: existing } = await sb.from('documents')
    .select('id, storage_path')
    .eq('company_id', input.companyId).eq('file_hash', fileHash)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (existing?.id) {
    return { documentId: existing.id as string, storagePath: (existing.storage_path as string) ?? null, reused: true, fileHash };
  }

  const { data: inserted, error } = await sb.from('documents').insert({
    company_id: input.companyId,
    uploaded_by: null,
    title: input.title.slice(0, 300),
    original_filename: input.filename,
    mime_type: input.mimeType,
    source_type: 'email',
    status: 'uploaded',
    file_hash: fileHash,
    file_size: input.bytes.byteLength,
  }).select('id').maybeSingle();
  if (error || !inserted?.id) throw new Error('creazione documento fallita');

  const documentId = inserted.id as string;
  const storagePath = `${input.companyId}/${input.folder}/${documentId}/${input.filename}`;
  const { error: upErr } = await sb.storage.from(DOCUMENTS_BUCKET).upload(
    storagePath,
    // `Blob` è disponibile sia in Deno sia in Node 20: nessuna conversione
    // dipendente dal runtime.
    new Blob([input.bytes as unknown as BlobPart], { type: input.mimeType }),
    { contentType: input.mimeType, upsert: true },
  );
  if (upErr) {
    // Documento senza file = documento che non si può analizzare né aprire:
    // si rimuove la riga invece di lasciarla come promessa non mantenuta.
    await sb.from('documents').delete().eq('id', documentId);
    throw new Error('caricamento allegato fallito');
  }
  await sb.from('documents').update({ storage_path: storagePath }).eq('id', documentId);
  return { documentId, storagePath, reused: false, fileHash };
}

export async function linkDocument(
  sb: ServerClient,
  input: {
    companyId: string; messageId: string; documentId: string;
    relation: 'body' | 'attachment'; attachmentId?: string | null;
  },
): Promise<void> {
  const { error } = await sb.from('email_message_documents').insert({
    company_id: input.companyId,
    email_message_id: input.messageId,
    document_id: input.documentId,
    relation: input.relation,
    attachment_id: input.attachmentId ?? null,
  });
  // 23505 = collegamento già presente: è il risultato voluto di un evento
  // duplicato, non un errore da propagare.
  const code = (error as { code?: string } | null)?.code;
  if (error && code !== '23505') throw new Error('collegamento email/documento fallito');
}

export interface LinkedDocument {
  documentId: string;
  relation: 'body' | 'attachment';
  storagePath: string | null;
  mimeType: string;
  sizeBytes: number | null;
  /** Esiste già un'analisi non fallita su questo documento? */
  analysed: boolean;
}

/**
 * I documenti già creati per questo messaggio da un tentativo precedente.
 *
 * Esiste perché un'analisi può interrompersi DOPO che il documento è stato
 * creato — la quota si esaurisce fra la creazione e la chiamata al modello — e
 * al ritentativo quel documento va ANALIZZATO, non scambiato per lavoro già
 * fatto. Il codice precedente si limitava a chiedere «esiste?» e usava la
 * risposta per non fare nulla: quattordici messaggi reali sono rimasti così,
 * con il documento in archivio e nessuna analisi.
 */
export async function listLinkedDocuments(
  sb: ServerClient, companyId: string, messageId: string,
): Promise<LinkedDocument[]> {
  const { data } = await sb.from('email_message_documents')
    .select('document_id, relation, documents (id, storage_path, mime_type, file_size)')
    .eq('company_id', companyId)
    .eq('email_message_id', messageId);

  const rows = (data ?? []) as {
    document_id: string;
    relation: 'body' | 'attachment';
    documents: { storage_path: string | null; mime_type: string | null; file_size: number | null } | null;
  }[];
  if (!rows.length) return [];

  // Una sola interrogazione per tutti i documenti: quali hanno già un'analisi
  // che vale. `failed` non conta — un'analisi fallita è lavoro da rifare.
  const ids = rows.map((r) => r.document_id);
  const { data: analyses } = await sb.from('document_analyses')
    .select('document_id, analysis_status').in('document_id', ids);
  const analysed = new Set(
    ((analyses ?? []) as { document_id: string; analysis_status: string }[])
      .filter((a) => a.analysis_status !== 'failed')
      .map((a) => a.document_id),
  );

  return rows.map((r) => ({
    documentId: r.document_id,
    relation: r.relation,
    storagePath: r.documents?.storage_path ?? null,
    mimeType: r.documents?.mime_type ?? 'application/octet-stream',
    sizeBytes: r.documents?.file_size ?? null,
    analysed: analysed.has(r.document_id),
  }));
}

/**
 * Rilegge dallo Storage i byte di un documento già archiviato.
 *
 * Si analizza il file COME È STATO SALVATO, non una ricostruzione dal
 * messaggio: il corpo di una email può essere cambiato presso il provider
 * (§117), e analizzare un testo diverso da quello archiviato produrrebbe
 * citazioni che non si ritrovano nel documento mostrato all'utente.
 */
export async function downloadDocument(sb: ServerClient, storagePath: string): Promise<Uint8Array | null> {
  const { data, error } = await sb.storage.from(DOCUMENTS_BUCKET).download(storagePath);
  if (error || !data) return null;
  return new Uint8Array(await (data as Blob).arrayBuffer());
}

// ---- Quota AI (§58) ---------------------------------------------------------

export async function reserveSystemAiSlot(
  sb: ServerClient,
  input: { companyId: string; kind: string; limitPerMinute: number; documentId?: string | null; provider?: string | null; model?: string | null },
): Promise<string | null> {
  const { data, error } = await sb.rpc('try_consume_ai_quota_system', {
    p_company_id: input.companyId,
    p_kind: input.kind,
    p_limit: input.limitPerMinute,
    p_document_id: input.documentId ?? null,
    p_provider: input.provider ?? null,
    p_model: input.model ?? null,
  });
  if (error) {
    // La funzione manca (0013 non applicata): NON si prosegue senza quota. Un
    // limite che si disattiva da solo quando la migrazione non c'è è peggio di
    // nessun limite, perché nessuno se ne accorge finché non arriva il conto.
    throw new EmailProviderError('CONFIG_MISSING', 'quota AI di sistema non disponibile');
  }
  return (data as string | null) ?? null;
}

export async function finalizeSystemAiSlot(
  sb: ServerClient,
  logId: string | null,
  outcome: { status: 'ok' | 'error'; durationMs?: number | null; inputTokens?: number | null; outputTokens?: number | null; errorCode?: string | null; model?: string | null },
): Promise<void> {
  if (!logId) return;
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

// ---- Eventi webhook ---------------------------------------------------------

/**
 * Registra l'evento e dice se è NUOVO. Il vincolo unico sull'impronta fa da
 * arbitro: se due consegne dello stesso evento arrivano insieme, una sola
 * ottiene `true` e l'altra non fa nulla (§26).
 */
export async function claimWebhookEvent(
  sb: ServerClient,
  input: { provider: string; connectionId: string | null; fingerprint: string },
): Promise<boolean> {
  const { error } = await sb.from('email_webhook_events').insert({
    provider: input.provider,
    connection_id: input.connectionId,
    event_fingerprint: input.fingerprint,
  });
  if (!error) return true;
  const code = (error as { code?: string }).code;
  if (code === '23505') return false;
  throw new Error('registrazione evento webhook fallita');
}

export async function closeWebhookEvent(
  sb: ServerClient, fingerprint: string, status: string, errorCode?: string | null,
): Promise<void> {
  await sb.from('email_webhook_events')
    .update({ processed_at: new Date().toISOString(), status, error_code: errorCode ?? null })
    .eq('event_fingerprint', fingerprint);
}

export { planAttachments, sniffMatches, safeAttachmentName, extensionForMime };
