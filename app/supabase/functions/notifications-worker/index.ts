// ============================================================================
// Edge Function: notifications-worker — promemoria e consegne email.
//
// Lo chiama uno SCHEDULER, non una persona. Autenticato con un segreto
// confrontato a tempo costante: non è un endpoint pubblico per definizione come
// un webhook, ma è raggiungibile, e un'esecuzione forzata da un estraneo
// consumerebbe invii verso il provider di posta.
//
// ⚠️ NON DIPENDE DAL BROWSER (§39)
// Nessun `setInterval` da nessuna parte nel frontend. Un promemoria che arriva
// solo a chi tiene AI-Swisse aperto non è un promemoria: è una cosa che vede
// chi stava già guardando.
//
// ⚠️ IL BUDGET DI TEMPO
// Come per la sincronizzazione: i 150 secondi di Supabase uccidono l'isolate
// senza far girare il `finally`. La generazione viene PRIMA della consegna, di
// proposito: se il tempo finisce, si perde un tentativo di invio — che verrà
// ripetuto — e non la notifica, che è il fatto.
//
// COSA RESTITUISCE: numeri, non testi. Nel report non compaiono titoli di
// attività né indirizzi (§128).
// ============================================================================
import { timingSafeEqual } from '../_shared/email/crypto.ts';
import { correlationId, EDGE_TIME_BUDGET_MS } from '../_shared/calendar/contract.ts';
import {
  adminClient, appOrigin, CORS, env, failure, json, logEvent, resolveEmailProvider,
} from '../_shared/calendar/runtime.ts';
import { deliverEmails, generateReminders, type NotifyDeps } from '../_shared/calendar/notify.ts';
import { CalendarProviderError } from '../_shared/calendar/types.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  const expected = env('NOTIFICATIONS_WORKER_SECRET');
  if (!expected) return failure('CONFIG_MISSING', 503);
  const provided = req.headers.get('x-notifications-worker-secret') ?? '';
  if (!timingSafeEqual(provided, expected)) return failure('FORBIDDEN', 403);

  // ⚠️ L'apertura si scrive PRIMA di qualsiasi lavoro, e la ragione è il budget
  // di 150 secondi: se l'isolate viene ucciso a metà, la riga di chiusura non
  // arriva MAI. Senza un'apertura, un'esecuzione morta è indistinguibile da
  // un'esecuzione mai partita — e sono due guasti diversi, con due cause
  // diverse. `rid` lega le due righe fra loro.
  const rid = correlationId(req.headers);
  const startedAtMs = Date.now();
  logEvent('notifications-worker', { phase: 'start', rid });

  const deadline = startedAtMs + EDGE_TIME_BUDGET_MS;
  const emailProvider = resolveEmailProvider();

  const report = {
    tasksScanned: 0, created: 0, emailsQueued: 0, unassignedAlerts: 0, skippedNoTimezone: 0,
    attempted: 0, sent: 0, retried: 0, failed: 0,
    // Dichiarato: chi legge il report deve sapere che le email non partono
    // perché non è configurato niente, e non perché qualcosa è rotto (§79).
    emailProviderConfigured: !!emailProvider,
    timeBudgetReached: false,
  };

  try {
    const deps: NotifyDeps = {
      sb: adminClient(),
      appOrigin: appOrigin(),
      emailProvider,
    };

    // 1. Il fatto. Prima, perché è la parte che non si può recuperare: una
    //    notifica non generata oggi non verrà generata domani, la sua finestra
    //    è passata.
    const generated = await generateReminders(deps, new Date(), deadline);
    report.tasksScanned = generated.tasksScanned;
    report.created = generated.created;
    report.emailsQueued = generated.emailsQueued;
    report.unassignedAlerts = generated.unassignedAlerts;
    report.skippedNoTimezone = generated.skippedNoTimezone;

    // 2. Il tentativo. Dopo, perché una consegna non riuscita adesso viene
    //    ripresa fra qualche minuto senza che nulla vada perso.
    const delivered = await deliverEmails(deps, deadline);
    report.attempted = delivered.attempted;
    report.sent = delivered.sent;
    report.retried = delivered.retried;
    report.failed = delivered.failed;

    report.timeBudgetReached = Date.now() >= deadline;
  } catch (error) {
    const code = error instanceof CalendarProviderError ? error.code : 'UNKNOWN';
    logEvent('notifications-worker', {
      phase: 'end', rid, durationMs: Date.now() - startedAtMs, status: 'failed', code, ...report,
    });
    return json({ status: 'failed', code, report }, 500);
  }

  logEvent('notifications-worker', {
    phase: 'end', rid, durationMs: Date.now() - startedAtMs, status: 'ok', ...report,
  });
  return json({ status: 'ok', report });
});
