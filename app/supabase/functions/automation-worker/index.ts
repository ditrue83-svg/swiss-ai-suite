// ============================================================================
// Edge Function: automation-worker — il consumatore della coda degli eventi.
//
// Lo chiama uno SCHEDULER, non una persona. Autenticato con un segreto
// confrontato a tempo costante: non è un endpoint pubblico per definizione come
// un webhook, ma è raggiungibile, e un'esecuzione forzata da un estraneo
// farebbe creare attività e notifiche a nome di regole altrui.
//
// ⚠️ NON DIPENDE DAL BROWSER (§10/§58).
// Nessun `runWorkflows()` chiamato da un componente, nessun `setInterval`.
// Un'automazione che gira solo mentre qualcuno tiene AI-Swisse aperto non è
// un'automazione: è una cosa che succede a chi stava già guardando.
//
// ⚠️ IL BUDGET DI TEMPO È LA LEZIONE PIÙ CARA DEL PROGETTO.
// Supabase chiude la richiesta a 150 secondi e uccide l'isolate: il `finally`
// NON gira. Qui ogni evento si controlla il tempo prima di cominciare, e ciò
// che resta è lavoro della prossima esecuzione — che arriva fra pochi minuti.
// Gli eventi lasciati indietro non si perdono: hanno un lease che scade.
//
// COSA RESTITUISCE: numeri, non testi. Nel rapporto non compaiono titoli di
// attività, mittenti, oggetti di email (§168).
// ============================================================================
import { timingSafeEqual } from '../_shared/email/crypto.ts';
import {
  EDGE_TIME_BUDGET_MS, EVENT_BATCH, EVENT_LOCK_SECONDS, MAX_EVENT_ATTEMPTS,
  MAX_RUNS_PER_COMPANY_PER_PASS, OVERDUE_LOOKBACK_DAYS, eventBackoffSeconds,
} from '../_shared/automation/contract.ts';
import { adminClient, CORS, env, failure, json, logEvent } from '../_shared/automation/runtime.ts';
import {
  claimEvents, eventDeadLetter, eventDone, eventFailed, eventRetry,
} from '../_shared/automation/store.ts';
import { emptyReport, processEvent } from '../_shared/automation/engine.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  const expected = env('AUTOMATION_WORKER_SECRET');
  if (!expected) return failure('CONFIG_MISSING', 503);
  const provided = req.headers.get('x-automation-worker-secret') ?? '';
  if (!timingSafeEqual(provided, expected)) return failure('FORBIDDEN', 403);

  const deadline = Date.now() + EDGE_TIME_BUDGET_MS;
  const sb = adminClient();

  const report = {
    overdueEmitted: 0,
    claimed: 0, processed: 0, retried: 0, failed: 0, deadLettered: 0,
    ...emptyReport(),
    // Dichiarato nella risposta: chi legge deve poter distinguere «non c'era
    // altro da fare» da «il tempo è finito prima del lavoro».
    timeBudgetReached: false,
  };

  try {
    // (1) Il fatto che non ha un UPDATE: «questa attività è scaduta».
    //     Prima della coda, perché produce eventi che la coda stessa tratterà —
    //     nella stessa esecuzione se c'è tempo, altrimenti nella prossima.
    const { data: emitted, error: emitError } = await sb.rpc('automation_emit_overdue', {
      p_lookback_days: OVERDUE_LOOKBACK_DAYS, p_limit: 200,
    });
    if (emitError) throw new Error(`overdue: ${(emitError as { message?: string }).message ?? 'errore'}`);
    report.overdueEmitted = typeof emitted === 'number' ? emitted : 0;

    // (2) La coda.
    const events = await claimEvents(sb, EVENT_BATCH, EVENT_LOCK_SECONDS, MAX_RUNS_PER_COMPANY_PER_PASS);
    report.claimed = events.length;

    for (const event of events) {
      if (Date.now() >= deadline) break;

      try {
        const outcome = await processEvent(sb, event);

        report.workflowsConsidered += outcome.report.workflowsConsidered;
        report.matched += outcome.report.matched;
        report.notMatched += outcome.report.notMatched;
        report.notEvaluable += outcome.report.notEvaluable;
        report.invalidConfig += outcome.report.invalidConfig;
        report.runs += outcome.report.runs;
        report.actionsDone += outcome.report.actionsDone;
        report.actionsSkipped += outcome.report.actionsSkipped;
        report.actionsFailed += outcome.report.actionsFailed;

        if (outcome.outcome === 'failed') {
          // Guasto PERMANENTE: l'entità non c'è più, oppure non è di questa
          // azienda. Riprovare darebbe lo stesso esito, quindi non si riprova
          // — e lo si dichiara invece di lasciare l'evento in coda per sempre.
          await eventFailed(sb, event.id, event.lock_id, outcome.code ?? 'unknown');
          report.failed++;
        } else {
          await eventDone(sb, event.id, event.lock_id);
          report.processed++;
        }
      } catch (error) {
        // Un'ECCEZIONE è un guasto transitorio — rete, database, timeout. Si
        // riprova con attesa crescente, e al tetto dei tentativi si smette e si
        // DICHIARA: la lettera morta è visibile nella schermata, non è un
        // silenzio (§63).
        const code = codeOf(error);
        if (event.attempts >= MAX_EVENT_ATTEMPTS) {
          await eventDeadLetter(sb, event.id, event.lock_id, code);
          report.deadLettered++;
        } else {
          await eventRetry(sb, event.id, event.lock_id, eventBackoffSeconds(event.attempts), code);
          report.retried++;
        }
        logEvent('automation-worker', { eventId: event.id, companyId: event.company_id, code });
      }
    }

    report.timeBudgetReached = Date.now() >= deadline;
  } catch (error) {
    const code = codeOf(error);
    logEvent('automation-worker', { code, phase: 'drain' });
    return json({ status: 'failed', code, report }, 500);
  }

  logEvent('automation-worker', { ...report });
  return json({ status: 'ok', report });
});

/** Il codice tecnico, mai il messaggio: un messaggio può contenere dati. */
function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.startsWith('CONFIG_MISSING')) return 'CONFIG_MISSING';
  // Solo la prima parola, e solo se è un identificatore: basta a distinguere i
  // casi nei log senza rischiare che ci finisca dentro il titolo di qualcosa.
  const first = message.split(':')[0]?.trim() ?? '';
  return /^[a-z_]{3,40}$/i.test(first) ? first : 'unknown';
}
