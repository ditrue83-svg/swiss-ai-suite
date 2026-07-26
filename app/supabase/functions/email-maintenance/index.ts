// ============================================================================
// Edge Function: email-maintenance — rinnovi, riconciliazione, pulizia.
//
// È la rete di sicurezza dell'Inbox, e la ragione per cui il push può fallire
// senza che nessuno perda una scadenza. Fa tre cose, tutte idempotenti:
//
//   1. RINNOVA le sottoscrizioni push in scadenza. Gmail vuole un `watch`
//      rinnovato entro sette giorni, Graph una subscription entro tre: un
//      rinnovo mancato non dà errore, semplicemente le notifiche smettono di
//      arrivare. È il guasto più silenzioso di tutto il sistema.
//   2. RICONCILIA le caselle che non si aggiornano da troppo tempo, rileggendo
//      una finestra recente. Google stesso raccomanda di non considerare il push
//      una garanzia di consegna.
//   3. PULISCE ciò che non serve più: stati OAuth scaduti, impronte di eventi
//      webhook vecchie. Nessuna cancellazione di dati aziendali (§53).
//
// AUTENTICAZIONE: un'intestazione segreta, confrontata a tempo costante. Non è
// un endpoint pubblico per definizione come il webhook, ma è raggiungibile, e
// un'esecuzione forzata da un estraneo consumerebbe chiamate al provider.
// ============================================================================
import { timingSafeEqual } from '../_shared/email/crypto.ts';
import {
  GOOGLE_WATCH_RENEW_EVERY_HOURS, WATCH_RENEW_BEFORE_HOURS,
} from '../_shared/email/contract.ts';
import {
  adapterForConnection, adminClient, aiCreateMessage, CORS, env, failure,
  getEncryptionKey, json, logEvent, outputLanguage, webhookUrl,
} from '../_shared/email/runtime.ts';
import { getConnection, readSecrets, writeSecrets, type ServerClient } from '../_shared/email/store.ts';
import { getValidAccessToken, runSync, type SyncDeps } from '../_shared/email/sync.ts';
import { EmailProviderError } from '../_shared/email/types.ts';

/** Se una casella non si sincronizza da così tanto, qualcosa non ha funzionato. */
const RECONCILE_IF_SILENT_HOURS = 6;
/** Quante connessioni trattare per esecuzione: il job gira spesso, non deve fare tutto ora. */
const MAX_PER_RUN = 25;
/** Le impronte degli eventi webhook servono a riconoscere i duplicati, non per sempre. */
const WEBHOOK_EVENT_RETENTION_DAYS = 14;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  const expected = env('INBOX_MAINTENANCE_SECRET');
  if (!expected) return failure('CONFIG_MISSING', 503);
  const provided = req.headers.get('x-inbox-maintenance-secret') ?? '';
  if (!timingSafeEqual(provided, expected)) return failure('FORBIDDEN', 403);

  const body = await req.json().catch(() => ({}));
  const language = outputLanguage((body as { outputLanguage?: unknown })?.outputLanguage);

  const sb = adminClient();
  const report = { renewed: 0, renewFailed: 0, reconciled: 0, reconcileFailed: 0, cleanedStates: 0, cleanedEvents: 0 };

  try {
    const deps: SyncDeps = {
      sb,
      encryptionKey: await getEncryptionKey(),
      adapterFor: adapterForConnection,
      createMessage: aiCreateMessage(),
      outputLanguage: language,
      notificationUrl: null,
    };

    await renewWatches(deps, report);
    await reconcile(deps, report);
    report.cleanedStates = await cleanupOauthStates(sb);
    report.cleanedEvents = await cleanupWebhookEvents(sb);
  } catch (error) {
    const code = error instanceof EmailProviderError ? error.code : 'UNKNOWN';
    logEvent('email-maintenance', { code });
    return json({ status: 'failed', code, report }, 500);
  }

  logEvent('email-maintenance', { ...report });
  return json({ status: 'ok', report });
});

// ---- 1. Rinnovo delle sottoscrizioni ----------------------------------------

async function renewWatches(deps: SyncDeps, report: { renewed: number; renewFailed: number }): Promise<void> {
  const threshold = new Date(Date.now() + WATCH_RENEW_BEFORE_HOURS * 3600_000).toISOString();
  // Si prendono anche quelle SENZA scadenza nota: una sottoscrizione di cui non
  // si conosce la scadenza è indistinguibile da una che non c'è.
  const { data } = await deps.sb.from('email_connections')
    .select('id')
    .eq('status', 'active').eq('sync_enabled', true)
    .or(`watch_expires_at.is.null,watch_expires_at.lt.${threshold}`)
    .limit(MAX_PER_RUN);

  for (const row of (data ?? []) as { id: string }[]) {
    const connection = await getConnection(deps.sb, row.id);
    if (!connection) continue;

    // Gmail va rinnovato a cadenza fissa: la documentazione raccomanda un
    // rinnovo quotidiano e un `watch` ricreato è sempre valido. Il criterio è
    // «quando l'ho rinnovato l'ultima volta», non «quando scade»: la scadenza
    // dichiarata da Gmail è sempre a sette giorni e non dice nulla su quanto
    // tempo è passato.
    if (connection.provider === 'google' && connection.watch_last_renewed_at) {
      const sinceRenewMs = Date.now() - new Date(connection.watch_last_renewed_at).getTime();
      if (sinceRenewMs < GOOGLE_WATCH_RENEW_EVERY_HOURS * 3600_000) continue;
    }

    try {
      const adapter = adapterForConnection(connection);
      const accessToken = await getValidAccessToken(deps, connection, adapter);
      const secrets = await readSecrets(deps.sb, deps.encryptionKey, connection.id);

      // Senza segreto condiviso una notifica Microsoft non sarebbe verificabile:
      // se manca se ne genera uno nuovo e lo si salva prima di sottoscrivere.
      let clientState = secrets.webhookState;
      if (!clientState) {
        clientState = crypto.randomUUID().replace(/-/g, '');
        await writeSecrets(deps.sb, deps.encryptionKey, {
          connectionId: connection.id, companyId: connection.company_id, webhookState: clientState,
        });
      }

      const watch = await adapter.renewWatch({
        accessToken,
        resourceId: connection.watch_resource_id,
        notificationUrl: webhookUrl(connection.provider),
        clientState,
      });
      await deps.sb.from('email_connections').update({
        watch_resource_id: watch.resourceId,
        watch_expires_at: watch.expiresAt,
        watch_last_renewed_at: new Date().toISOString(),
        watch_last_error_code: null,
      }).eq('id', connection.id);
      report.renewed++;
    } catch (error) {
      const code = error instanceof EmailProviderError ? error.code : 'UNKNOWN';
      await deps.sb.from('email_connections').update({ watch_last_error_code: code }).eq('id', row.id);
      report.renewFailed++;
      logEvent('email-maintenance', { step: 'renew', code });
    }
  }
}

// ---- 2. Riconciliazione ------------------------------------------------------

async function reconcile(deps: SyncDeps, report: { reconciled: number; reconcileFailed: number }): Promise<void> {
  const silentSince = new Date(Date.now() - RECONCILE_IF_SILENT_HOURS * 3600_000).toISOString();
  const { data } = await deps.sb.from('email_connections')
    .select('id')
    .eq('status', 'active').eq('sync_enabled', true)
    .or(`last_successful_sync_at.is.null,last_successful_sync_at.lt.${silentSince}`)
    .limit(MAX_PER_RUN);

  for (const row of (data ?? []) as { id: string }[]) {
    const outcome = await runSync(deps, {
      connectionId: row.id, syncType: 'reconciliation', triggeredBy: 'schedule',
    });
    // `busy` non è un fallimento: significa che una sincronizzazione è già in
    // corso, cioè esattamente ciò che si voleva ottenere.
    if (outcome.status === 'ok' || outcome.status === 'busy') report.reconciled++;
    else report.reconcileFailed++;
  }
}

// ---- 3. Pulizia --------------------------------------------------------------

async function cleanupOauthStates(sb: ServerClient): Promise<number> {
  const { data } = await sb.from('email_oauth_states')
    .delete()
    .lt('expires_at', new Date(Date.now() - 3600_000).toISOString())
    .select('id');
  return Array.isArray(data) ? data.length : 0;
}

async function cleanupWebhookEvents(sb: ServerClient): Promise<number> {
  const cutoff = new Date(Date.now() - WEBHOOK_EVENT_RETENTION_DAYS * 86_400_000).toISOString();
  const { data } = await sb.from('email_webhook_events').delete().lt('received_at', cutoff).select('id');
  return Array.isArray(data) ? data.length : 0;
}
