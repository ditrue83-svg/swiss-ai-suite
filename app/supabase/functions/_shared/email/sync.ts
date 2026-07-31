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
  ANALYSIS_DRAIN_BATCH, ANALYSIS_SLOT_MS, INCREMENTAL_MAX_MESSAGES, INITIAL_SYNC_DAYS,
  INITIAL_SYNC_MAX_MESSAGES, MIN_BODY_CHARS_FOR_ANALYSIS, RECONCILE_MAX_MESSAGES,
  RECONCILE_WINDOW_HOURS, SYNC_LEASE_SECONDS, attentionForRelevance,
} from './contract.ts';
import {
  buildClassifierInput, prescreen, CLASSIFIER_VERSION, inboxCodeForAiError, isClassifyRetryable,
  CLASSIFY_RETRYABLE_CODES,
} from './classify.ts';
import { buildClassifyRequest, validateClassifierOutput, CLASSIFIER_MODEL, CLASSIFIER_PROMPT_VERSION } from './classifyPrompt.ts';
import { pickPrimaryAttachment, planAttachments, sniffMatches, safeAttachmentName, extensionForMime } from './attachments.ts';
import { EmailProviderError } from './types.ts';
import type { EmailProviderAdapter, NormalizedEmailMessage, OAuthTokens } from './types.ts';
import {
  acquireLease, createOrReuseDocument, downloadDocument, finalizeSystemAiSlot, finishSyncRun,
  getConnection, isKnownAdministrativeSender, linkDocument, listLinkedDocuments, markAttachment,
  newCounters, readSecrets, recordAttachmentPlan, releaseLease, reserveSystemAiSlot,
  setMessageClassification, setMessageProcessing, startSyncRun, upsertMessage, writeSecrets,
  type ConnectionRow, type LinkedDocument, type ServerClient, type SyncCounters,
} from './store.ts';

/** Limiti di spesa AI per azienda al minuto, distinti per tipo di lavoro (§58). */
const CLASSIFY_LIMIT_PER_MINUTE = 30;
/**
 * Il limite di analisi è lo stesso di `analyze-document`, e resta tale di
 * proposito: è il tetto di spesa dell'azienda, non un dettaglio della Inbox.
 * A cambiare è il MODO di consumarlo — a lotti dalla coda, non tutto insieme —
 * perché alzare il limite avrebbe spostato il problema al primo cliente con una
 * casella più attiva, invece di risolverlo.
 */
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
  input: {
    connectionId: string; syncType: SyncType; triggeredBy: string;
    /**
     * Istante oltre il quale non si comincia altro lavoro. Chi chiama da una
     * Edge Function lo passa sempre: senza, il rischio non è finire tardi, è
     * essere uccisi a metà (vedi {@link EDGE_TIME_BUDGET_MS}).
     */
    deadlineMs?: number;
  },
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
  /** Il tempo è finito prima della lista: restano messaggi non guardati. */
  let truncated = false;

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
      // Fermarsi con il lavoro in ordine è meglio che essere uccisi a metà: i
      // messaggi rimasti li prende la prossima esecuzione, e l'esito lo DICE
      // invece di farlo sembrare un lavoro concluso.
      if (input.deadlineMs && Date.now() + ANALYSIS_SLOT_MS > input.deadlineMs) {
        status = 'partial';
        errorCode = 'TIME_BUDGET';
        truncated = true;
        break;
      }
      try {
        await processMessage(deps, {
          connection, adapter, accessToken, providerMessageId: messageId, counters,
          deferAnalysis: input.syncType === 'initial',
        });
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

    // Smaltisce un lotto della coda di analisi. Vale anche per l'import
    // iniziale: le prime analisi partono subito, il resto segue.
    // Il contatore lo incrementa già `analyzeDocument`: sommare anche il
    // risultato dello smaltimento conterebbe due volte le stesse analisi, e un
    // registro che gonfia i numeri è peggio di un registro assente.
    await drainPendingAnalyses(deps, connection, adapter, accessToken, counters,
      ANALYSIS_DRAIN_BATCH, input.deadlineMs);

    const patch: Record<string, unknown> = {
      sync_cursor: cursorAfter,
      last_sync_at: new Date().toISOString(),
    };
    if (status === 'ok') {
      patch.last_successful_sync_at = new Date().toISOString();
      patch.last_error_code = null;
      patch.last_error_at = null;
    }
    // «Import iniziale completato» significa che la lista è stata percorsa
    // tutta. Se il tempo è finito prima, scriverlo sarebbe una dichiarazione
    // falsa — e per giunta una che spegne la ripresa: la manutenzione riprende
    // proprio le caselle che questo campo dichiara incomplete.
    if (input.syncType === 'initial' && !truncated) {
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
    /** true durante l'import iniziale: si classifica e si mette in coda. */
    deferAnalysis: boolean;
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
    // ⚠️ Il codice è quello VERO, non un unico `CLASSIFY_FAILED` per tutto:
    // da esso dipende se questo messaggio verrà ripreso o resterà fermo per
    // sempre. `drainPendingClassifications` ripesca i codici d'ambiente, come
    // il drenaggio delle analisi già fa con `PROVIDER_RATE_LIMITED`.
    const code = error instanceof EmailProviderError ? error.code : inboxCodeForAiError(error);
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

  // L'import iniziale promuove decine di messaggi in pochi secondi: analizzarli
  // tutti sul momento esaurisce la quota e riempie «Da gestire» di analisi
  // fallite — misurato al primo collegamento reale. Si METTE IN CODA, che è uno
  // stato dichiarato e non un fallimento, e la manutenzione periodica smaltisce
  // a lotti. Nelle sincronizzazioni successive, che portano pochi messaggi per
  // volta, l'analisi resta immediata.
  if (input.deferAnalysis) {
    await setMessageProcessing(deps.sb, upserted.id, 'awaiting_analysis');
    return;
  }

  await analyzeOne(deps, { connection, adapter, accessToken, messageId: upserted.id, message, counters });
}

/**
 * Analizza UN messaggio già classificato, gestendo l'esaurimento della quota
 * per quello che è.
 *
 * `PROVIDER_RATE_LIMITED` non è un fallimento dell'analisi: è «non adesso». Il
 * messaggio torna in coda e verrà ripreso, invece di essere marcato `failed` e
 * mostrato all'utente come un guasto. La distinzione conta: un guasto chiede
 * un intervento, una coda no.
 *
 * Ritorna false se la quota è esaurita, così il chiamante può fermare il lotto
 * invece di sbatterci contro per ogni messaggio rimasto.
 */
async function analyzeOne(
  deps: SyncDeps,
  input: {
    connection: ConnectionRow; adapter: EmailProviderAdapter; accessToken: string;
    messageId: string; message: NormalizedEmailMessage; counters: SyncCounters;
  },
): Promise<boolean> {
  try {
    await setMessageProcessing(deps.sb, input.messageId, 'importing');
    const started = await importAndAnalyze(deps, {
      connection: input.connection, adapter: input.adapter, accessToken: input.accessToken,
      messageId: input.messageId, message: input.message, counters: input.counters,
    });
    await setMessageProcessing(deps.sb, input.messageId, 'done', started ? { error_code: null } : { error_code: 'ANALYSIS_SKIPPED' });
    return true;
  } catch (error) {
    const code = error instanceof EmailProviderError ? error.code : 'ANALYSIS_FAILED';
    if (code === 'PROVIDER_RATE_LIMITED') {
      await setMessageProcessing(deps.sb, input.messageId, 'awaiting_analysis', { error_code: null });
      return false;
    }
    await setMessageProcessing(deps.sb, input.messageId, 'failed', { error_code: code });
    return true;
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
    // ⚠️ La LETTURA della risposta ha un codice suo. «Il modello ha risposto
    // qualcosa che non si riesce a usare» e «l'ambiente ci ha rifiutato» sono
    // guasti opposti: il secondo si riprende da solo, il primo no. Confonderli
    // è ciò che ha reso non diagnosticabili i 16 messaggi del 2026-07-31.
    let parsed;
    try {
      const testo = block?.text ?? '{}';
      parsed = validateClassifierOutput(JSON.parse(testo.slice(testo.indexOf('{'))));
    } catch (_e) {
      throw new EmailProviderError('INVALID_RESPONSE', 'risposta del classificatore non utilizzabile');
    }

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
      errorCode: error instanceof EmailProviderError ? error.code : inboxCodeForAiError(error),
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

  const bodyText = message.textBody.trim();
  const linked = await listLinkedDocuments(deps.sb, companyId, input.messageId);
  const plan = planAnalysisTarget({
    freshAttachments: imported.map((a) => ({ documentId: a.documentId, mimeType: a.mimeType, sizeBytes: a.sizeBytes })),
    linkedDocuments: linked,
    bodyLength: bodyText.length,
  });

  switch (plan.kind) {
    case 'fresh': {
      const primary = imported.find((a) => a.documentId === plan.documentId)!;
      return await analyzeDocument(deps, {
        companyId, documentId: primary.documentId, messageId: input.messageId,
        bytes: primary.bytes, mimeType: primary.mimeType, counters,
      });
    }

    // Il documento esiste già da un tentativo precedente: si analizza quello,
    // rileggendo dall'archivio i byte che sono stati davvero salvati.
    case 'resume': {
      const doc = linked.find((d) => d.documentId === plan.documentId)!;
      const bytes = await downloadDocument(deps.sb, doc.storagePath!);
      // Un documento in elenco il cui file non si scarica è un guasto, non un
      // «niente da fare»: se restituissimo false il messaggio verrebbe marcato
      // come gestito senza che nessuno l'abbia letto. Errore normale e non
      // `EmailProviderError`, che descrive i guasti del fornitore di posta: qui
      // il fornitore non c'entra. Il chiamante lo registra come ANALYSIS_FAILED.
      if (!bytes) throw new Error('documento non rileggibile dall\'archivio');
      return await analyzeDocument(deps, {
        companyId, documentId: doc.documentId, messageId: input.messageId,
        bytes, mimeType: doc.mimeType, counters,
      });
    }

    // Nessun allegato analizzabile: la richiesta è nel corpo. Diventa un
    // documento vero, con il suo file in Storage e il suo hash — non un testo
    // passato di nascosto al modello (§14).
    case 'body': {
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

    case 'unavailable':
      throw new Error('documento collegato senza file in archivio');

    // `already` = l'analisi c'è già (deduplicazione per hash, o un ritentativo
    // dopo un'esecuzione andata a buon fine). Vale come lavoro fatto.
    case 'already':
      return true;

    case 'nothing':
      return false;
  }
}

/**
 * Decide COSA analizzare per un messaggio. Pura: nessun database, nessuna rete.
 *
 * È separata dall'esecuzione perché è la decisione che al primo collegamento
 * reale è stata sbagliata, e una decisione che si può provare da sola è una
 * decisione che si può difendere. Il codice precedente chiedeva «esiste già un
 * documento per questo messaggio?» e, se sì, usciva senza fare nulla: il
 * chiamante lo leggeva come «niente da analizzare» e marcava il messaggio come
 * gestito. Quattordici messaggi reali, con il documento in archivio e l'analisi
 * mai eseguita, sarebbero passati a «fatto» senza che nessuno li leggesse.
 *
 * Le regole, in ordine:
 *   1. un allegato appena importato che merita l'analisi ha la precedenza;
 *   2. altrimenti il documento già collegato (allegato principale, se non c'è
 *      il corpo): se è già analizzato il lavoro c'è, se il suo file non è
 *      raggiungibile è un guasto, altrimenti si analizza;
 *   3. altrimenti si crea il documento dal corpo, se il corpo dice qualcosa;
 *   4. altrimenti non c'è niente da analizzare, e lo si dichiara.
 */
export type AnalysisTarget =
  | { kind: 'fresh'; documentId: string }
  | { kind: 'resume'; documentId: string }
  | { kind: 'body' }
  | { kind: 'unavailable' }
  | { kind: 'already' }
  | { kind: 'nothing' };

export function planAnalysisTarget(input: {
  freshAttachments: { documentId: string; mimeType: string; sizeBytes: number | null }[];
  linkedDocuments: LinkedDocument[];
  bodyLength: number;
}): AnalysisTarget {
  const fresh = pickPrimaryAttachment(input.freshAttachments);
  if (fresh) return { kind: 'fresh', documentId: fresh.documentId };

  // Stesso criterio del primo passaggio — `pickPrimaryAttachment` scarta i
  // `text/plain`, perché per un allegato di testo la fonte principale resta il
  // corpo del messaggio.
  const attachments = input.linkedDocuments.filter((d) => d.relation === 'attachment');
  const chosen = pickPrimaryAttachment(attachments)
    ?? input.linkedDocuments.find((d) => d.relation === 'body')
    ?? null;

  if (chosen) {
    if (chosen.analysed) return { kind: 'already' };
    if (!chosen.storagePath) return { kind: 'unavailable' };
    return { kind: 'resume', documentId: chosen.documentId };
  }

  if (input.bodyLength >= MIN_BODY_CHARS_FOR_ANALYSIS) return { kind: 'body' };
  return { kind: 'nothing' };
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

/**
 * Smaltisce un LOTTO di analisi rimaste in coda.
 *
 * Prende i messaggi in `awaiting_analysis` e quelli che una volta erano falliti
 * per esaurimento quota — che sono ritentabili per costruzione, a differenza di
 * un fallimento di analisi vero, che resta dov'è.
 *
 * Si ferma al primo esaurimento di quota invece di provare tutti gli altri: la
 * quota è per azienda, quindi se non c'è per uno non c'è per nessuno, e
 * insistere produrrebbe solo una fila di errori identici.
 *
 * Ritorna quante analisi sono state completate.
 */
export async function drainPendingAnalyses(
  deps: SyncDeps,
  connection: ConnectionRow,
  adapter: EmailProviderAdapter,
  accessToken: string,
  counters: SyncCounters,
  max = ANALYSIS_DRAIN_BATCH,
  deadlineMs?: number,
): Promise<number> {
  if (!deps.createMessage) return 0;

  const { data } = await deps.sb.from('email_messages')
    .select('id, provider_message_id, processing_status, error_code')
    .eq('connection_id', connection.id)
    .eq('relevance', 'likely_actionable')
    .or('processing_status.eq.awaiting_analysis,and(processing_status.eq.failed,error_code.eq.PROVIDER_RATE_LIMITED)')
    .order('received_at', { ascending: false })
    .limit(max);

  const pending = (data ?? []) as { id: string; provider_message_id: string }[];
  let done = 0;

  for (const row of pending) {
    // Un'analisi iniziata senza tempo davanti è un'analisi persa a metà, che
    // lascia il messaggio in `analyzing` e costa comunque una richiesta al
    // modello. Se non ci sta, resta in coda: è il posto giusto per aspettare.
    if (deadlineMs && Date.now() + ANALYSIS_SLOT_MS > deadlineMs) break;

    let message: NormalizedEmailMessage;
    try {
      message = await adapter.getMessage({ accessToken, messageId: row.provider_message_id });
    } catch (error) {
      const code = error instanceof EmailProviderError ? error.code : 'UNKNOWN';
      // Il messaggio non è più leggibile presso il provider (cancellato,
      // spostato): non è un'analisi fallita, è una fonte che non c'è più.
      await setMessageProcessing(deps.sb, row.id, 'failed', { error_code: code });
      continue;
    }
    const ok = await analyzeOne(deps, {
      connection, adapter, accessToken, messageId: row.id, message, counters,
    });
    if (!ok) break;                       // quota esaurita: il resto attende
    done++;
  }
  return done;
}

/**
 * Riprende le classificazioni cadute per un guasto dell'AMBIENTE.
 *
 * PERCHÉ ESISTE. Un messaggio già acquisito non passa mai una seconda volta da
 * `processMessage` (`if (!upserted.isNew) return`), e `recoverInterrupted`
 * guarda soltanto gli stati in lavorazione: un messaggio chiuso come `failed`
 * non lo riprendeva NESSUNO. Il 2026-07-31 in produzione c'erano 16 messaggi
 * mai classificati, tredici dei quali caduti mentre il credito era esaurito —
 * cioè per una ragione che si era già risolta da sola.
 *
 * ⚠️ Non è un meccanismo nuovo: è la stessa forma che `drainPendingAnalyses`
 * usa già da mesi per `failed` + `PROVIDER_RATE_LIMITED`. Qui cambia solo che
 * cosa manca — la classificazione invece dell'analisi.
 *
 * Si riprendono SOLO i codici d'ambiente (`isClassifyRetryable`) e SOLO i
 * messaggi mai classificati (`relevance is null`): un messaggio che una
 * relevance ce l'ha è già passato di là, e riclassificarlo cancellerebbe un
 * giudizio già dato.
 */
export async function drainPendingClassifications(
  deps: SyncDeps,
  connection: ConnectionRow,
  adapter: EmailProviderAdapter,
  accessToken: string,
  max = ANALYSIS_DRAIN_BATCH,
  deadlineMs?: number,
): Promise<{ classified: number; failed: number }> {
  const esito = { classified: 0, failed: 0 };
  if (!deps.createMessage) return esito;

  const { data } = await deps.sb.from('email_messages')
    .select('id, provider_message_id, error_code')
    .eq('connection_id', connection.id)
    .eq('processing_status', 'failed')
    .is('relevance', null)
    .in('error_code', [...CLASSIFY_RETRYABLE_CODES])
    .order('received_at', { ascending: false })
    .limit(max);

  for (const row of (data ?? []) as { id: string; provider_message_id: string; error_code: string }[]) {
    if (!isClassifyRetryable(row.error_code)) continue;      // difesa in profondità
    // Una classificazione costa meno di un'analisi, ma il budget resta quello
    // dell'esecuzione: senza tempo davanti si lascia in coda, che è il posto
    // giusto per aspettare.
    if (deadlineMs && Date.now() + ANALYSIS_SLOT_MS > deadlineMs) break;

    let message: NormalizedEmailMessage;
    try {
      message = await adapter.getMessage({ accessToken, messageId: row.provider_message_id });
    } catch (error) {
      const code = error instanceof EmailProviderError ? error.code : 'UNKNOWN';
      await setMessageProcessing(deps.sb, row.id, 'failed', { error_code: code });
      esito.failed++;
      continue;
    }

    const senderKnown = await isKnownAdministrativeSender(
      deps.sb, connection.company_id, message.from?.email ?? null,
    );
    const screening = prescreen({ message, cleanBody: null, senderKnown });
    if (screening.skipAi) {
      // Il filtro deterministico basta: non si spende per saperlo.
      await setMessageClassification(deps.sb, row.id, {
        relevance: 'clearly_irrelevant', confidence: null,
        reason: 'prescreen:bulk_no_administrative_signal',
        classifierVersion: CLASSIFIER_VERSION,
        provider: null, model: null, promptVersion: null,
      });
      await setMessageProcessing(deps.sb, row.id, 'done', { error_code: null });
      esito.classified++;
      continue;
    }

    try {
      await classifyMessage(deps, {
        companyId: connection.company_id, messageId: row.id, message, screening,
      });
      // Classificato: il messaggio riprende la strada normale. L'analisi la
      // deciderà il drenaggio delle analisi, che guarda `likely_actionable`.
      await setMessageProcessing(deps.sb, row.id, 'done', { error_code: null });
      esito.classified++;
    } catch (error) {
      const code = error instanceof EmailProviderError ? error.code : inboxCodeForAiError(error);
      await setMessageProcessing(deps.sb, row.id, 'failed', {
        error_code: code, attention_status: 'to_verify',
      });
      esito.failed++;
      // Se l'ambiente rifiuta di nuovo, il resto del lotto non andrà meglio.
      if (isClassifyRetryable(code)) break;
    }
  }
  return esito;
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
