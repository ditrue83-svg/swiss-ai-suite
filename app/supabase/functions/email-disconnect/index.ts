// ============================================================================
// Edge Function: email-disconnect — scollega una casella.
//
// «Scollega» significa: AI-Swisse smette di poter leggere quella casella.
// NON significa cancellare la posta già acquisita, i documenti che ne sono
// nati o le analisi che vi si appoggiano (§40). Sono due decisioni diverse e
// solo una delle due è stata presa dall'utente premendo questo pulsante.
//
// L'ordine delle operazioni conta: prima si smette di ricevere, poi si revoca,
// poi si distruggono i segreti, e solo alla fine si cambia lo stato. Se qualcosa
// fallisce a metà, ciò che è già stato fatto va nella direzione giusta — e i
// segreti vengono distrutti anche quando la revoca presso il provider non
// riesce, perché un token che non possiamo più leggere è un token che non
// possiamo più usare.
// ============================================================================
import {
  adapterForConnection, adminClient, assertAdmin, authenticate,
  CORS, failure, getEncryptionKey, json, logEvent,
} from '../_shared/email/runtime.ts';
import { deleteSecrets, getConnection, readSecrets, recordAudit } from '../_shared/email/store.ts';
import { EmailProviderError } from '../_shared/email/types.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  const auth = await authenticate(req);
  if (!auth) return failure('UNAUTHENTICATED', 401);

  const body = await req.json().catch(() => null);
  const connectionId = typeof body?.connectionId === 'string' ? body.connectionId : null;
  if (!connectionId) return failure('BAD_REQUEST', 400);

  const sb = adminClient();
  const connection = await getConnection(sb, connectionId);
  if (!connection) return failure('NOT_FOUND', 404);

  // §51 — scollegare è simmetrico a collegare: titolare o amministratore.
  if (!(await assertAdmin(auth, connection.company_id))) return failure('FORBIDDEN', 403);

  const key = await getEncryptionKey();
  const secrets = await readSecrets(sb, key, connectionId);
  const adapter = adapterForConnection(connection);

  // I due passi che dipendono dal provider possono fallire — la rete non è
  // garantita — e il loro fallimento non deve impedire lo scollegamento. Si
  // registra cosa è riuscito, così la schermata può dirlo invece di sostenere
  // che tutto è andato bene.
  let watchStopped = false;
  let revoked = false;

  if (secrets.accessToken) {
    try {
      await adapter.stopWatch({ accessToken: secrets.accessToken, resourceId: connection.watch_resource_id });
      watchStopped = true;
    } catch (error) {
      logEvent('email-disconnect', { step: 'stopWatch', code: error instanceof EmailProviderError ? error.code : 'UNKNOWN' });
    }
    try {
      await adapter.revoke({ accessToken: secrets.accessToken, refreshToken: secrets.refreshToken });
      // Microsoft non espone una revoca del singolo consenso: `revoke()` non fa
      // nulla, e dichiararlo qui evita di far credere all'utente che il permesso
      // sia stato tolto dal suo account Microsoft. La schermata lo spiega.
      revoked = connection.provider === 'google';
    } catch (error) {
      logEvent('email-disconnect', { step: 'revoke', code: error instanceof EmailProviderError ? error.code : 'UNKNOWN' });
    }
  }

  // Da qui in poi non si può più leggere quella casella, qualunque cosa sia
  // successa sopra.
  await deleteSecrets(sb, connectionId);
  await sb.from('email_connections').update({
    status: 'disconnected',
    sync_enabled: false,
    watch_resource_id: null,
    watch_expires_at: null,
    watch_last_error_code: null,
    sync_cursor: null,
    sync_lease_id: null,
    sync_lease_until: null,
    last_error_code: null,
    last_error_at: null,
  }).eq('id', connectionId);

  await recordAudit(sb, {
    companyId: connection.company_id,
    connectionId,
    actorUserId: auth.userId,
    action: 'disconnected',
    detail: { provider: connection.provider, watchStopped, revoked },
  });

  logEvent('email-disconnect', { provider: connection.provider, watchStopped: String(watchStopped), revoked: String(revoked) });
  return json({ status: 'disconnected', watchStopped, revoked });
});
