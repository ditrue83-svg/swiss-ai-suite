// ============================================================================
// Edge Function: email-sync — sincronizzazione e analisi su richiesta.
//
// Due chiamanti, due autenticazioni diverse:
//   · l'UTENTE, con il suo JWT: preme «Sincronizza» o «Analizza». Si verifica
//     l'appartenenza tramite RLS e si applica un limite di frequenza, perché
//     ogni pressione consuma chiamate al provider (§126).
//   · il SISTEMA (callback OAuth, webhook, job periodico), con la service role
//     e un'intestazione dedicata. Nessun utente da attribuire.
//
// Il lavoro vero sta in `_shared/email/sync.ts`: questa funzione è un
// involucro HTTP sottile, come `analyze-document`.
// ============================================================================
import { MANUAL_SYNC_MIN_INTERVAL_SECONDS } from '../_shared/email/contract.ts';
import { timingSafeEqual } from '../_shared/email/crypto.ts';
import {
  adapterForConnection, adminClient, aiCreateMessage, assertMember, authenticate,
  CORS, env, failure, getEncryptionKey, json, logEvent, outputLanguage,
} from '../_shared/email/runtime.ts';
import { getConnection, recordAudit, type ServerClient } from '../_shared/email/store.ts';
import { importAndAnalyze, runSync, getValidAccessToken, type SyncDeps } from '../_shared/email/sync.ts';
import { EmailProviderError } from '../_shared/email/types.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') return failure('BAD_REQUEST', 400);

  const internal = isInternalCall(req);

  try {
    if (body.action === 'analyze') return await handleAnalyze(req, body, internal);
    return await handleSync(req, body, internal);
  } catch (error) {
    const code = error instanceof EmailProviderError ? error.code : 'UNKNOWN';
    logEvent('email-sync', { code });
    return failure(code, code === 'CONFIG_MISSING' ? 503 : 500);
  }
});

/**
 * Chiamata interna: service role E intestazione dedicata. Il confronto della
 * chiave è a tempo costante — un `===` su un segreto permette di ricostruirlo
 * misurando i tempi di risposta.
 */
function isInternalCall(req: Request): boolean {
  if (req.headers.get('x-inbox-internal') !== '1') return false;
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  return !!serviceKey && !!bearer && timingSafeEqual(bearer, serviceKey);
}

async function buildDeps(sb: ServerClient, language: unknown): Promise<SyncDeps> {
  return {
    sb,
    encryptionKey: await getEncryptionKey(),
    adapterFor: adapterForConnection,
    createMessage: aiCreateMessage(),
    outputLanguage: outputLanguage(language),
    notificationUrl: null,
  };
}

async function handleSync(req: Request, body: Record<string, unknown>, internal: boolean): Promise<Response> {
  const connectionId = typeof body.connectionId === 'string' ? body.connectionId : null;
  if (!connectionId) return failure('BAD_REQUEST', 400);

  const sb = adminClient();
  const connection = await getConnection(sb, connectionId);
  if (!connection) return failure('NOT_FOUND', 404);

  let actorUserId: string | null = null;
  let syncType: 'initial' | 'incremental' | 'manual' | 'reconciliation' = 'manual';
  let triggeredBy = 'user';

  if (internal) {
    const requested = body.syncType;
    syncType = requested === 'initial' || requested === 'incremental' || requested === 'reconciliation'
      ? requested : 'incremental';
    triggeredBy = typeof body.triggeredBy === 'string' ? body.triggeredBy.slice(0, 40) : 'system';
  } else {
    const auth = await authenticate(req);
    if (!auth) return failure('UNAUTHENTICATED', 401);
    // L'appartenenza la decide la RLS, non un confronto di stringhe qui.
    if (!(await assertMember(auth, connection.company_id))) return failure('FORBIDDEN', 403);
    actorUserId = auth.userId;

    // §126 — niente raffiche sul pulsante. Il limite si misura sull'ultima
    // sincronizzazione REGISTRATA, che è un fatto nel database e non uno stato
    // in memoria che si perde a ogni isolate nuovo.
    if (connection.sync_lease_until && new Date(connection.sync_lease_until).getTime() > Date.now()) {
      return json({ status: 'busy', code: 'SYNC_BUSY' }, 409);
    }
    const { data: recent } = await sb.from('email_connections')
      .select('last_sync_at').eq('id', connectionId).maybeSingle();
    const lastSync = recent?.last_sync_at ? new Date(recent.last_sync_at as string).getTime() : 0;
    if (Date.now() - lastSync < MANUAL_SYNC_MIN_INTERVAL_SECONDS * 1000) {
      return json({ status: 'throttled', code: 'SYNC_TOO_SOON' }, 429);
    }

    await recordAudit(sb, {
      companyId: connection.company_id, connectionId, actorUserId,
      action: 'sync_requested', detail: {},
    });
  }

  const deps = await buildDeps(sb, body.outputLanguage);
  const outcome = await runSync(deps, { connectionId, syncType, triggeredBy });

  logEvent('email-sync', {
    provider: connection.provider, type: syncType, status: outcome.status,
    seen: outcome.counters.messagesSeen, added: outcome.counters.messagesNew,
    code: outcome.errorCode,
  });

  return json({
    status: outcome.status,
    code: outcome.errorCode,
    counters: outcome.counters,
  }, outcome.status === 'busy' ? 409 : 200);
}

/**
 * «Analizza» su un messaggio che la classificazione non aveva promosso.
 *
 * È l'unico punto in cui l'analisi documentale parte per decisione di una
 * persona invece che per policy: l'utente ha guardato il messaggio e ha deciso
 * che merita. Per questo qui non si riclassifica — si importa e si analizza.
 */
async function handleAnalyze(req: Request, body: Record<string, unknown>, internal: boolean): Promise<Response> {
  const messageId = typeof body.messageId === 'string' ? body.messageId : null;
  if (!messageId) return failure('BAD_REQUEST', 400);

  const sb = adminClient();
  const { data: row } = await sb.from('email_messages')
    .select('id, company_id, connection_id, provider_message_id, processing_status')
    .eq('id', messageId).maybeSingle();
  if (!row) return failure('NOT_FOUND', 404);

  if (!internal) {
    const auth = await authenticate(req);
    if (!auth) return failure('UNAUTHENTICATED', 401);
    if (!(await assertMember(auth, row.company_id as string))) return failure('FORBIDDEN', 403);
  }

  const connection = await getConnection(sb, row.connection_id as string);
  if (!connection) return failure('NOT_FOUND', 404);

  const deps = await buildDeps(sb, body.outputLanguage);
  if (!deps.createMessage) return failure('AI_NOT_CONFIGURED', 503);

  const adapter = adapterForConnection(connection);
  const accessToken = await getValidAccessToken(deps, connection, adapter);
  const message = await adapter.getMessage({ accessToken, messageId: row.provider_message_id as string });

  await sb.from('email_messages').update({ processing_status: 'importing', error_code: null }).eq('id', messageId);

  const counters = { messagesSeen: 0, messagesNew: 0, messagesUpdated: 0, attachmentsImported: 0, documentsCreated: 0, analysesStarted: 0 };
  try {
    const started = await importAndAnalyze(deps, {
      connection, adapter, accessToken, messageId, message, counters,
    });
    await sb.from('email_messages').update({
      processing_status: 'done',
      error_code: started ? null : 'ANALYSIS_SKIPPED',
    }).eq('id', messageId);
    return json({ status: started ? 'analyzed' : 'nothing_to_analyze', counters });
  } catch (error) {
    const code = error instanceof EmailProviderError ? error.code : 'ANALYSIS_FAILED';
    await sb.from('email_messages').update({ processing_status: 'failed', error_code: code }).eq('id', messageId);
    logEvent('email-sync', { action: 'analyze', code });
    return failure(code, 502);
  }
}
