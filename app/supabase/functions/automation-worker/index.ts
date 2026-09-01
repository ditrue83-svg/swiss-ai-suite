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
  CRM_FOLLOW_UP_LOOKBACK_DAYS, CRM_FOLLOW_UP_SEQUENCE_SCAN_LIMIT, CRM_SUGGESTION_SCAN_LIMIT,
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
    // 0026 — contato A PARTE e non sommato a `overdueEmitted`: sono due fatti
    // diversi («questa attività è scaduta», «questo follow-up è scaduto») e un
    // numero solo non direbbe quale delle due scansioni ha prodotto lavoro.
    crmFollowUpEmitted: 0,
    // ⚠️ Dichiarato con il tipo, non lasciato inferire: il typecheck NON guarda
    // gli `index.ts` delle Edge Function (`tsconfig` include solo `src` e
    // `scripts`, e nessuno importa i punti d'ingresso), quindi qui un errore di
    // tipo lo troverebbe soltanto il deploy.
    crmFollowUpError: null as string | null,
    // 0050 — passi delle sequenze dovuti per silenzio dopo una email uscente.
    crmFollowUpSequenceEmitted: 0,
    crmFollowUpSequenceError: null as string | null,
    // 0030 — quanti suggerimenti di collegamento sono stati CREATI in questo
    // giro. Zero è la risposta normale: le righe già proposte non si ripropongono.
    crmSuggestionsCreated: 0,
    crmSuggestionsError: null as string | null,
    claimed: 0, processed: 0, retried: 0, failed: 0, deadLettered: 0,
    // ⚠️ Quante volte NON siamo riusciti a scrivere l'esito nella coda. Quegli
    // eventi restano `processing` e torneranno da soli alla scadenza del lease:
    // finché questo numero non è zero, `retried` e `deadLettered` sono un
    // minimo e non un totale. Senza, un giro che non riesce a scrivere niente
    // riporta gli stessi zeri di un giro senza lavoro da fare.
    queueWriteFailed: 0,
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

    // (1-bis) L'altro fatto che non ha un UPDATE: «il prossimo passo di questa
    //     trattativa è scaduto» (0026). La 0026 lo dichiara nel proprio corpo:
    //     `crm_emit_follow_up_due` è la gemella di `automation_emit_overdue` e
    //     gira in QUESTO worker, nello stesso giro — nessun cron nuovo, nessuna
    //     Edge Function nuova.
    //
    //     ⚠️ NON è terminale come la scansione delle scadute, e la differenza è
    //     motivata: `automation_emit_overdue` appartiene alla 0020, cioè alla
    //     migrazione che crea la coda che questo worker consuma — senza di lei
    //     non c'è niente da fare comunque. La 0026 è un modulo successivo e può
    //     non essere applicata: fermare l'intera coda delle automazioni perché
    //     manca il CRM significherebbe spegnere Documenti, Finanze e Contratti
    //     per un modulo che quell'azienda non usa.
    //     Il guasto NON è silenzioso: il codice finisce nel rapporto E in una
    //     riga di log propria. Un rapporto con `crmFollowUpError` valorizzato è
    //     un'affermazione, non un'assenza.
    try {
      const { data: crmEmitted, error: crmError } = await sb.rpc('crm_emit_follow_up_due', {
        p_lookback_days: CRM_FOLLOW_UP_LOOKBACK_DAYS, p_limit: 200,
      });
      if (crmError) throw new Error(`crm_follow_up: ${(crmError as { message?: string }).message ?? 'errore'}`);
      report.crmFollowUpEmitted = typeof crmEmitted === 'number' ? crmEmitted : 0;
    } catch (error) {
      report.crmFollowUpError = codeOf(error);
      logEvent('automation-worker', { code: report.crmFollowUpError, phase: 'crm_follow_up' });
    }

    // (1-ter) Le sequenze CRM riusano lo stesso giro. La funzione SQL misura
    // il silenzio, emette un evento idempotente e non invia alcuna email.
    try {
      const { data: sequenceEmitted, error: sequenceError } = await sb.rpc(
        'crm_emit_follow_up_sequences', { p_limit: CRM_FOLLOW_UP_SEQUENCE_SCAN_LIMIT },
      );
      if (sequenceError) {
        throw new Error(`crm_follow_up_sequence: ${(sequenceError as { message?: string }).message ?? 'errore'}`);
      }
      report.crmFollowUpSequenceEmitted = typeof sequenceEmitted === 'number'
        ? sequenceEmitted : 0;
    } catch (error) {
      report.crmFollowUpSequenceError = codeOf(error);
      logEvent('automation-worker', {
        code: report.crmFollowUpSequenceError, phase: 'crm_follow_up_sequence',
      });
    }

    // (1-quater) Il candidato automatico (0030): legge le controparti dei
    //     contratti e i fornitori di Finanze e PROPONE. Non crea anagrafiche e
    //     non collega niente — scrive righe `crm_link_suggestions` in attesa
    //     di un sì (§21).
    //
    //     ⚠️ NON EMETTE EVENTI, quindi non alimenta la coda che segue: un
    //     suggerimento non è un fatto dell'azienda, è un'ipotesi del prodotto,
    //     e far scattare una regola su un'ipotesi significherebbe creare lavoro
    //     a partire da un sospetto. È scritto anche nel registro degli inneschi.
    //
    //     Non terminale, per la stessa ragione della scansione qui sopra.
    try {
      const { data: suggested, error: scanError } = await sb.rpc('crm_scan_link_suggestions', {
        p_limit: CRM_SUGGESTION_SCAN_LIMIT,
      });
      if (scanError) throw new Error(`crm_scan: ${(scanError as { message?: string }).message ?? 'errore'}`);
      report.crmSuggestionsCreated = typeof suggested === 'number' ? suggested : 0;
    } catch (error) {
      report.crmSuggestionsError = codeOf(error);
      logEvent('automation-worker', { code: report.crmSuggestionsError, phase: 'crm_suggestions' });
    }

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
        // ⚠️ QUESTE DUE SCRITTURE VIVONO DENTRO IL `catch`, e dal 2026-08-11
        // SOLLEVANO quando falliscono. Senza questa guardia il loro guasto
        // uscirebbe dal `catch` per evento e arriverebbe a quello esterno, che
        // risponde 500 e ABBANDONA il resto del lotto: un evento andato storto
        // ne trascinerebbe con sé altri ventiquattro che non c'entrano niente.
        //
        // Si conta invece di propagare, come per le scritture di servizio di
        // `deliverEmails`: un guasto che diventa un numero è esplicito quanto
        // un'eccezione, e non costa il lotto. `queueWriteFailed > 0` significa
        // che quell'evento è rimasto `processing` e tornerà da sé alla scadenza
        // del lease — quindi `retried` e `deadLettered` sono un minimo.
        try {
          if (event.attempts >= MAX_EVENT_ATTEMPTS) {
            await eventDeadLetter(sb, event.id, event.lock_id, code);
            report.deadLettered++;
          } else {
            await eventRetry(sb, event.id, event.lock_id, eventBackoffSeconds(event.attempts), code);
            report.retried++;
          }
        } catch (scritturaFallita) {
          report.queueWriteFailed++;
          logEvent('automation-worker', {
            eventId: event.id, companyId: event.company_id,
            code: codeOf(scritturaFallita), phase: 'queue_write',
          });
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
