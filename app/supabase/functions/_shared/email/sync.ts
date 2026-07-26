// ============================================================================
// Orchestrazione della sincronizzazione. È il punto in cui le regole di
// prodotto diventano una sequenza di operazioni.
//
// TRE PRINCIPI CHE GOVERNANO QUESTO FILE
//
// 1. LA POSTA ARRIVA ANCHE SE L'AI NON FUNZIONA (§103). Acquisizione e
//    interpretazione sono due livelli distinti: prima il messaggio viene
//    salvato, poi si tenta di capirlo. Se il modello è irraggiungibile o la
//    quota è finita, il messaggio resta nella Inbox con lo stato che dice
//    perché — non sparisce, e non si ritenta all'infinito.
//
// 2. OGNI PASSO È IDEMPOTENTE (§26). Un evento consegnato tre volte produce lo
//    stesso risultato di uno consegnato una volta. Non perché il codice
//    controlli prima di agire — controllare-poi-agire perde le corse — ma
//    perché i vincoli del database arbitrano, e qui si gestisce il conflitto
//    come esito normale.
//
// 3. NON SI SPENDE SU CIÒ CHE NON SERVE (§32/§58). Il filtro deterministico
//    ferma quello che si può fermare senza costi; il modello vede solo il resto;
//    l'analisi documentale completa parte solo su ciò che il modello ha
//    giudicato probabilmente azionabile. Ogni salto è dichiarato nel record.
// ============================================================================
import { runAnalysisPipeline, type CreateMessage, type ModelMessage } from '../pipeline.ts';
import { ocrExtract, textExtraction } from '../extract.ts';
import type { CompanyContext } from '../prompt.ts';
import type { ExtractionResult } from '../validate.ts';
import {
  INCREMENTAL_MAX_MESSAGES, INITIAL_SYNC_DAYS, INITIAL_SYNC_MAX_MESSAGES,
  RECONCILE_MAX_MESSAGES, RECONCILE_WINDOW_HOURS, SYNC_LEASE_SECONDS, attentionForRelevance,
} from './contract.ts';
import { buildClassifierInput, prescreen, CLASSIFIER_VERSION } from './classify.ts';
import { buildClassifyRequest, validateClassifierOutput, CLASSIFIER_MODEL, CLASSIFIER_PROMPT_VERSION } from './classifyPrompt.ts';
import { pickPrimaryAttachment, planAttachments, sniffMatches, safeAttachmentName, extensionForMime } from './attachments.ts';
import { EmailProviderError } from './types.ts';
import type { EmailProviderAdapter, NormalizedEmailMessage, OAuthTokens } from './types.ts';
import {
  acquireLease, createOrReuseDocument, finalizeSystemAiSlot, finishSyncRun, getConnection,
  hasLinkedDocument, isKnownAdministrativeSender, linkDocument, markAttachment, newCounters,
  readSecrets, recordAttachmentPlan, releaseLease, reserveSystemAiSlot, setMessageClassification,
  setMessageProcessing, startSyncRun, upsertMessage, writeSecrets,
  type ConnectionRow, type ServerClient, type SyncCounters,
} from './store.ts';

/** Limiti di spesa AI per azienda al minuto, distinti per tipo di lavoro (§58). */
const CLASSIFY_LIMIT_PER_MINUTE = 30;
const ANALYSIS_LIMIT_PER_MINUTE = 12;

export type SyncType = 'initial' | 'incremental' | 'manual' | 'reconciliation';

export interface SyncDeps {
  sb: ServerClient;
  encryptionKey: CryptoKey;
  adapterFor: (connection: ConnectionRow) => EmailProviderAdapter;
  /** Client AI. Assente = si sincronizza senza classificare né analizzare. */
  createMessage?: CreateMessage | null;
  /** Lingua in cui vengono generati i testi (motivazione, analisi). */
  outputLanguage: 'it' | 'de' | 'fr';
  /** URL a cui il provider manda le notifiche; serve al rinnovo del watch. */
  notificationUrl?: string | null;
}

export interface SyncOutcome {
  status: 'ok' | 'partial' | 'failed' | 'busy';
  counters: SyncCounters;
  errorCode: string | null;
}

// ---- Token ------------------------------------------------------------------

/**
 * Access token valido, rinnovandolo se serve.
 *
 * Un refresh che fallisce con `AUTH_EXPIRED` NON è un errore transitorio: è il
 * consenso revocato, o la password cambiata. La connessione passa a
 * `reauth_required` e la sincronizzazione si ferma — insistere consumerebbe
 * chiamate senza alcuna possibilità di riuscire (§42).
 */
export async function getValidAccessToken(
  deps: SyncDeps, connection: ConnectionRow, adapter: EmailProviderAdapter,
): Promise<string> {
  const secrets = await readSecrets(deps.sb, deps.encryptionKey, connection.id);

  const stillValid = secrets.accessToken
    && secrets.accessTokenExpiresAt
    && new Date(secrets.accessTokenExpiresAt).getTime() > Date.now() + 60_000;
  if (stillValid) return secrets.accessToken as string;

  if (!secrets.refreshToken) {
    await markConnectionReauth(deps.sb, connection.id, 'AUTH_EXPIRED');
    throw new EmailProviderError('AUTH_EXPIRED', 'nessun refresh token disponibile');
  }

  let tokens: OAuthTokens;
  try {
    tokens = await adapter.refresh(secrets.refreshToken);
  } catch (error) {
    const code = error instanceof EmailProviderError ? error.code : 'UNKNOWN';
    if (code === 'AUTH_EXPIRED' || code === 'AUTH_INSUFFICIENT_SCOPE') {
      await markConnectionReauth(deps.sb, connection.id, code);
    }
    throw error;
  }

  await writeSecrets(deps.sb, deps.encryptionKey, {
    connectionId: connection.id,
    companyId: connection.company_id,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiresAt,
    // Google riemette il refresh token solo alla prima autorizzazione: se non
    // ne arriva uno nuovo si CONSERVA il precedente. Sovrascriverlo con null
    // spegnerebbe la casella al successivo rinnovo.
    refreshToken: tokens.refreshToken ?? undefined,
  });
  await deps.sb.from('email_connections')
    .update({ status: 'active', last_error_code: null, last_error_at: null })
    .eq('id', connection.id).eq('status', 'reauth_required');

  return tokens.accessToken;
}

async function markConnectionReauth(sb: ServerClient, connectionId: string, code: string): Promise<void> {
  await sb.from('email_connections').update({
    status: 'reauth_required',
    last_error_code: code,
    last_error_at: new Date().toISOString(),
  }).eq('id', connectionId);
}

async function markConnectionError(sb: ServerClient, connectionId: string, code: string): Promise<void> {
  await sb.from('email_connections').update({
    last_error_code: code,
    last_error_at: new Date().toISOString(),
  }).eq('id', connectionId);
}

// ---- Sincronizzazione -------------------------------------------------------

export async function runSync(
  deps: SyncDeps,
  input: { connectionId: string; syncType: SyncType; triggeredBy: string },
): Promise<SyncOutcome> {
  const counters = newCounters();
  const startedAtMs = Date.now();

  const connection = await getConnection(deps.sb, input.connectionId);
  if (!connection) return { status: 'failed', counters, errorCode: 'NOT_FOUND' };
  if (connection.status === 'disconnected' || !connection.sync_enabled) {
    return { status: 'failed', counters, errorCode: 'DISCONNECTED' };
  }

  // §125 — una sola sincronizzazione per volta su questa casella. Chi non
  // ottiene il lease non aspetta e non fallisce: se ne va dicendo che è occupata.
  const leaseId = await acquireLease(deps.sb, connection.id, SYNC_LEASE_SECONDS);
  if (!leaseId) return { status: 'busy', counters, errorCode: 'SYNC_BUSY' };

  const runId = await startSyncRun(deps.sb, {
    companyId: connection.company_id,
    connectionId: connection.id,
    syncType: input.syncType,
    triggeredBy: input.triggeredBy,
    cursorBefore: connection.sync_cursor,
  });

  let errorCode: string | null = null;
  let status: 'ok' | 'partial' | 'failed' = 'ok';
  let cursorAfter: string | null = connection.sync_cursor;

  try {
    const adapter = deps.adapterFor(connection);
    const accessToken = await getValidAccessToken(deps, connection, adapter);

    const listing = await listForSync(adapter, accessToken, connection, input.syncType);
    cursorAfter = listing.cursor ?? connection.sync_cursor;
    counters.messagesSeen = listing.messageIds.length;

    // Cursore scaduto: non si può sapere cosa è passato nel frattempo. Si
    // DICHIARA e si rilegge la finestra recente, invece di ripartire dal nulla
    // fingendo che non sia successo niente (§45).
    if (listing.cursorExpired) {
      errorCode = 'CURSOR_EXPIRED';
      status = 'partial';
      const since = new Date(Date.now() - RECONCILE_WINDOW_HOURS * 3600_000).toISOString();
      const recovery = await adapter.listWindow({ accessToken, since, max: RECONCILE_MAX_MESSAGES });
      listing.messageIds = recovery.messageIds;
      counters.messagesSeen = recovery.messageIds.length;
      cursorAfter = await adapter.getCurrentCursor(accessToken);
    }

    for (const messageId of listing.messageIds) {
      try {
        await processMessage(deps, { connection, adapter, accessToken, providerMessageId: messageId, counters });
      } catch (error) {
        // Il fallimento di UN messaggio non interrompe la sincronizzazione: gli
        // altri messaggi sono indipendenti, e fermarsi al primo intoppo
        // significherebbe non consegnare nulla per colpa di un allegato rotto.
        status = 'partial';
        errorCode = error instanceof EmailProviderError ? error.code : 'UNKNOWN';
        if (error instanceof EmailProviderError && (error.code === 'AUTH_EXPIRED' || error.code === 'PROVIDER_RATE_LIMITED')) {
          break;                                  // insistere non porterebbe da nessuna parte
        }
      }
    }

    // Dopo un import iniziale il cursore non viene dalla lista (fatta per data)
    // ma dal provider: è il segnalibro «da adesso in poi».
    if (input.syncType === 'initial' && !cursorAfter) {
      cursorAfter = await adapter.getCurrentCursor(accessToken);
    }

    const patch: Record<string, unknown> = {
      sync_cursor: cursorAfter,
      last_sync_at: new Date().toISOString(),
    };
    if (status === 'ok') {
      patch.last_successful_sync_at = new Date().toISOString();
      patch.last_error_code = null;
      patch.last_error_at = null;
    }
    if (input.syncType === 'initial') {
      patch.initial_sync_completed_at = new Date().toISOString();
      patch.history_floor_at = new Date(Date.now() - INITIAL_SYNC_DAYS * 86_400_000).toISOString();
    }
    await deps.sb.from('email_connections').update(patch).eq('id', connection.id);
  } catch (error) {
    status = 'failed';
    errorCode = error instanceof EmailProviderError ? error.code : 'UNKNOWN';
    await markConnectionError(deps.sb, connection.id, errorCode);
  } finally {
    await finishSyncRun(deps.sb, runId, {
      status, counters, cursorAfter, errorCode,
      errorDetail: null, startedAtMs,
    });
    await releaseLease(deps.sb, connection.id, leaseId);
  }

  return { status, counters, errorCode };
}

async function listForSync(
  adapter: EmailProviderAdapter, accessToken: string, connection: ConnectionRow, syncType: SyncType,
) {
  switch (syncType) {
    case 'initial': {
      const since = new Date(Date.now() - INITIAL_SYNC_DAYS * 86_400_000).toISOString();
      return await adapter.listInitial({ accessToken, since, max: INITIAL_SYNC_MAX_MESSAGES });
    }
    case 'reconciliation': {
      const since = new Date(Date.now() - RECONCILE_WINDOW_HOURS * 3600_000).toISOString();
      return await adapter.listWindow({ accessToken, since, max: RECONCILE_MAX_MESSAGES });
    }
    default:
      return await adapter.listIncremental({
        accessToken, cursor: connection.sync_cursor, max: INCREMENTAL_MAX_MESSAGES,
      });
  }
}

// ---- Un singolo messaggio ---------------------------------------------------

async function processMessage(
  deps: SyncDeps,
  input: {
    connection: ConnectionRow; adapter: EmailProviderAdapter; accessToken: string;
    providerMessageId: string; counters: SyncCounters;
  },
): Promise<void> {
  const { connection, adapter, accessToken, counters } = input;

  const message = await adapter.getMessage({ accessToken, messageId: input.providerMessageId });
  const upserted = await upsertMessage(deps.sb, {
    companyId: connection.company_id, connectionId: connection.id, message,
  });

  if (!upserted.isNew) {
    counters.messagesUpdated++;
    // §117 — la fonte non si riscrive. Se il provider ora restituisce un
    // contenuto diverso da quello acquisito, lo si annota come incertezza
    // invece di sostituire sotto i piedi ciò che è già stato analizzato.
    if (upserted.sourceChanged) {
      await deps.sb.from('email_messages')
        .update({ error_code: 'SOURCE_CHANGED' })
        .eq('id', upserted.id);
    }
    return;                                        // già acquisito: niente da rifare
  }
  counters.messagesNew++;

  await recordAttachmentPlan(deps.sb, {
    companyId: connection.company_id,
    messageId: upserted.id,
    decisions: planAttachments(message.attachments),
  });

  // ---- Livello 1: filtro deterministico, costo zero ----
  const senderKnown = await isKnownAdministrativeSender(deps.sb, connection.company_id, message.from?.email ?? null);
  const screening = prescreen({ message, cleanBody: null, senderKnown });

  if (screening.skipAi) {
    await setMessageClassification(deps.sb, upserted.id, {
      relevance: 'clearly_irrelevant',
      confidence: null,
      // La motivazione resta una CHIAVE, non una frase: va letta nella lingua
      // dell'utente, e questa riga la scrive un processo che non ha una lingua.
      reason: 'prescreen:bulk_no_administrative_signal',
      classifierVersion: CLASSIFIER_VERSION,
      provider: null, model: null, promptVersion: null,
    });
    await setMessageProcessing(deps.sb, upserted.id, 'done');
    return;
  }

  // ---- Livello 2: classificazione AI ----
  if (!deps.createMessage) {
    // Senza client AI la posta si acquisisce lo stesso: resta «da verificare»,
    // che è la verità — nessuno l'ha ancora esaminata.
    await setMessageProcessing(deps.sb, upserted.id, 'done', { attention_status: 'to_verify' });
    return;
  }

  let relevance: 'likely_actionable' | 'possibly_actionable' | 'informational' | 'clearly_irrelevant';
  try {
    const classified = await classifyMessage(deps, {
      companyId: connection.company_id, messageId: upserted.id, message, screening,
    });
    relevance = classified.relevance;
  } catch (error) {
    // §102 — l'AI ha fallito, la mail resta. Stato coerente, ritentabile,
    // e visibile in Inbox come «da verificare»: non si perde nulla.
    const code = error instanceof EmailProviderError ? error.code : 'CLASSIFY_FAILED';
    await setMessageProcessing(deps.sb, upserted.id, 'failed', {
      error_code: code,
      attention_status: 'to_verify',
    });
    return;
  }

  // ---- Livello 3: analisi documentale, solo su ciò che la merita ----
  if (relevance !== 'likely_actionable') {
    await setMessageProcessing(deps.sb, upserted.id, 'done');
    return;
  }

  try {
    await setMessageProcessing(deps.sb, upserted.id, 'importing');
    const started = await importAndAnalyze(deps, {
      connection, adapter, accessToken, messageId: upserted.id, message, counters,
    });
    await setMessageProcessing(deps.sb, upserted.id, 'done', started ? {} : { error_code: 'ANALYSIS_SKIPPED' });
  } catch (error) {
    const code = error instanceof EmailProviderError ? error.code : 'ANALYSIS_FAILED';
    await setMessageProcessing(deps.sb, upserted.id, 'failed', { error_code: code });
  }
}

async function classifyMessage(
  deps: SyncDeps,
  input: {
    companyId: string; messageId: string; message: NormalizedEmailMessage;
    screening: ReturnType<typeof prescreen>;
  },
) {
  await setMessageProcessing(deps.sb, input.messageId, 'classifying');

  const slot = await reserveSystemAiSlot(deps.sb, {
    companyId: input.companyId,
    kind: 'inbox_classification',
    limitPerMinute: CLASSIFY_LIMIT_PER_MINUTE,
    provider: 'anthropic',
    model: CLASSIFIER_MODEL,
  });
  if (!slot) throw new EmailProviderError('PROVIDER_RATE_LIMITED', 'quota di classificazione esaurita');

  const startedMs = Date.now();
  try {
    const payload = buildClassifierInput(input.message, null);
    const request = buildClassifyRequest({
      ...payload,
      outputLanguage: deps.outputLanguage,
      deterministicSignals: input.screening.reasons,
    });
    const response = await deps.createMessage!(request as never) as ModelMessage;
    const block = response.content.find((b) => b.type === 'text' && typeof b.text === 'string');
    const parsed = validateClassifierOutput(JSON.parse((block?.text ?? '{}').slice((block?.text ?? '{}').indexOf('{'))));

    // §86 — un tentativo di manipolazione non rende il messaggio «sicuro»: lo
    // rende sospetto. Non si accetta mai un declassamento chiesto dal contenuto.
    const relevance = parsed.manipulationAttempt && parsed.relevance === 'clearly_irrelevant'
      ? 'possibly_actionable'
      : parsed.relevance;

    await setMessageClassification(deps.sb, input.messageId, {
      relevance,
      confidence: parsed.confidence,
      reason: parsed.reason || null,
      classifierVersion: CLASSIFIER_VERSION,
      provider: 'anthropic',
      model: CLASSIFIER_MODEL,
      promptVersion: CLASSIFIER_PROMPT_VERSION,
      attention: attentionForRelevance(relevance),
    });
    await finalizeSystemAiSlot(deps.sb, slot, {
      status: 'ok',
      durationMs: Date.now() - startedMs,
      inputTokens: response.usage?.input_tokens ?? null,
      outputTokens: response.usage?.output_tokens ?? null,
      model: CLASSIFIER_MODEL,
    });
    return { relevance };
  } catch (error) {
    await finalizeSystemAiSlot(deps.sb, slot, {
      status: 'error',
      durationMs: Date.now() - startedMs,
      errorCode: error instanceof EmailProviderError ? error.code : 'CLASSIFY_FAILED',
    });
    throw error;
  }
}

// ---- Importazione e analisi -------------------------------------------------

/**
 * Porta il messaggio nella pipeline documentale.
 *
 * §33 — se c'è un PDF principale si analizza QUELLO: le citazioni devono essere
 * verificabili contro il documento da cui provengono, e mescolare il corpo
 * dell'email con il testo del PDF produrrebbe uno snapshot in cui non si sa più
 * da dove viene un'affermazione. Se non c'è un allegato principale, la richiesta
 * è nel corpo, e allora è il corpo a diventare un documento.
 *
 * Gli altri allegati accettati vengono comunque importati — così l'utente può
 * aprirli — ma non analizzati: uno solo è la pratica, gli altri sono materiale.
 */
export async function importAndAnalyze(
  deps: SyncDeps,
  input: {
    connection: ConnectionRow; adapter: EmailProviderAdapter; accessToken: string;
    messageId: string; message: NormalizedEmailMessage; counters: SyncCounters;
  },
): Promise<boolean> {
  const { connection, adapter, accessToken, message, counters } = input;
  const companyId = connection.company_id;

  const { data: attachmentRows } = await deps.sb.from('email_attachments')
    .select('id, provider_attachment_id, mime_type, size_bytes, safe_filename, import_status')
    .eq('email_message_id', input.messageId).eq('import_status', 'pending');

  const imported: { id: string; documentId: string; mimeType: string; sizeBytes: number | null; bytes: Uint8Array }[] = [];

  for (const row of (attachmentRows ?? []) as { id: string; provider_attachment_id: string; mime_type: string; size_bytes: number | null; safe_filename: string }[]) {
    try {
      const bytes = await adapter.getAttachment({
        accessToken, messageId: message.externalId, attachmentId: row.provider_attachment_id,
      });

      // §15 — il controllo che conta: i BYTE devono corrispondere al tipo. Un
      // eseguibile rinominato `fattura.pdf` e dichiarato `application/pdf` ha
      // superato nome ed estensione, e si ferma qui.
      if (!sniffMatches(bytes, row.mime_type)) {
        await markAttachment(deps.sb, row.id, {
          import_status: 'skipped_unsupported', skip_reason: 'content_mismatch',
        });
        continue;
      }

      const filename = safeAttachmentName(row.safe_filename, extensionForMime(row.mime_type));
      const doc = await createOrReuseDocument(deps.sb, {
        companyId,
        title: message.subject ? `${message.subject} — ${filename}` : filename,
        filename,
        mimeType: row.mime_type,
        bytes,
        folder: 'email',
      });
      await linkDocument(deps.sb, {
        companyId, messageId: input.messageId, documentId: doc.documentId,
        relation: 'attachment', attachmentId: row.id,
      });
      await markAttachment(deps.sb, row.id, {
        import_status: 'imported', storage_path: doc.storagePath, file_hash: doc.fileHash,
      });
      counters.attachmentsImported++;
      if (!doc.reused) counters.documentsCreated++;
      imported.push({ id: row.id, documentId: doc.documentId, mimeType: row.mime_type, sizeBytes: row.size_bytes, bytes });
    } catch (error) {
      await markAttachment(deps.sb, row.id, {
        import_status: 'failed',
        error_code: error instanceof EmailProviderError ? error.code : 'ATTACHMENT_FAILED',
      });
    }
  }

  const primary = pickPrimaryAttachment(imported.map((a) => ({ ...a, mimeType: a.mimeType, sizeBytes: a.sizeBytes })));

  if (primary) {
    return await analyzeDocument(deps, {
      companyId, documentId: primary.documentId, messageId: input.messageId,
      bytes: primary.bytes, mimeType: primary.mimeType, counters,
    });
  }

  // Nessun allegato analizzabile: la richiesta è nel corpo. Diventa un documento
  // vero, con il suo file in Storage e il suo hash — non un testo passato di
  // nascosto al modello (§14).
  const bodyText = message.textBody.trim();
  if (bodyText.length < 40) return false;         // niente da analizzare: si dichiara

  if (await hasLinkedDocument(deps.sb, input.messageId, 'body')) return false;

  const bytes = new TextEncoder().encode(bodyText);
  const doc = await createOrReuseDocument(deps.sb, {
    companyId,
    title: message.subject ?? `${message.from?.email ?? 'email'} — ${message.receivedAt.slice(0, 10)}`,
    filename: 'messaggio.txt',
    mimeType: 'text/plain',
    bytes,
    folder: 'email',
  });
  await linkDocument(deps.sb, { companyId, messageId: input.messageId, documentId: doc.documentId, relation: 'body' });
  if (!doc.reused) counters.documentsCreated++;

  return await analyzeDocument(deps, {
    companyId, documentId: doc.documentId, messageId: input.messageId,
    bytes, mimeType: 'text/plain', counters,
  });
}

/** Esegue la pipeline Admin AI — la stessa del caricamento manuale, non una copia. */
async function analyzeDocument(
  deps: SyncDeps,
  input: {
    companyId: string; documentId: string; messageId: string;
    bytes: Uint8Array; mimeType: string; counters: SyncCounters;
  },
): Promise<boolean> {
  if (!deps.createMessage) return false;

  // Un documento già analizzato (deduplicazione per hash) non si rianalizza:
  // il costo sarebbe reale e il risultato identico.
  const { data: existing } = await deps.sb.from('document_analyses')
    .select('id').eq('document_id', input.documentId).neq('analysis_status', 'failed').limit(1);
  if (Array.isArray(existing) && existing.length) return true;

  const slot = await reserveSystemAiSlot(deps.sb, {
    companyId: input.companyId,
    kind: 'inbox_analysis',
    limitPerMinute: ANALYSIS_LIMIT_PER_MINUTE,
    documentId: input.documentId,
    provider: 'anthropic',
  });
  if (!slot) throw new EmailProviderError('PROVIDER_RATE_LIMITED', 'quota di analisi esaurita');

  await setMessageProcessing(deps.sb, input.messageId, 'analyzing');

  const extractStart = Date.now();
  let extraction: ExtractionResult;
  if (input.mimeType === 'text/plain') {
    extraction = textExtraction(new TextDecoder().decode(input.bytes));
  } else {
    extraction = await ocrExtract({
      bytes: input.bytes,
      mimeType: input.mimeType,
      createMessage: (request) => deps.createMessage!(request as never) as Promise<ModelMessage>,
    });
  }

  const companyContext = await loadCompanyContext(deps.sb, input.companyId);
  const result = await runAnalysisPipeline(deps.sb as never, deps.createMessage, {
    documentId: input.documentId,
    companyId: input.companyId,
    // §80 — nessuna persona ha chiesto questa analisi: `userId` resta null.
    userId: null,
    extraction,
    extractionDurationMs: Date.now() - extractStart,
    logId: slot,
    outputLanguage: deps.outputLanguage,
    companyContext,
    todayIso: new Date().toISOString().slice(0, 10),
    provider: 'anthropic',
  });

  // Copia della scadenza sulla riga del messaggio, per poter filtrare la lista
  // senza join (§9/§104). Solo la data: citazione, fiducia e tipo restano
  // nell'analisi, che il dettaglio legge per intero. Se l'analisi non ha
  // trovato una scadenza il campo resta null — nessuna data di ripiego.
  const deadline = result.analysis.deadline?.date ?? null;
  if (deadline) {
    await deps.sb.from('email_messages').update({ analysis_deadline: deadline }).eq('id', input.messageId);
  }

  input.counters.analysesStarted++;
  return true;
}

async function loadCompanyContext(sb: ServerClient, companyId: string): Promise<CompanyContext> {
  const { data: company } = await sb.from('companies')
    .select('legal_name, canton, municipality, legal_form').eq('id', companyId).maybeSingle();
  const { data: profile } = await sb.from('company_profiles')
    .select('sector').eq('company_id', companyId).maybeSingle();
  return {
    legalName: company?.legal_name ?? null,
    canton: company?.canton ?? null,
    municipality: company?.municipality ?? null,
    legalForm: company?.legal_form ?? null,
    sector: profile?.sector ?? null,
  };
}
