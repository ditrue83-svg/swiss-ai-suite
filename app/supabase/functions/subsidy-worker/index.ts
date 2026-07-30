// ============================================================================
// Edge Function: subsidy-worker — il motore proattivo degli Incentivi.
//
// Lo chiama uno SCHEDULER, non una persona. Fa quattro cose, in quest'ordine:
//   1. rivaluta le opportunità dei progetti attivi contro il catalogo pubblicato;
//   2. controlla le fonti ufficiali scadute e apre le revisioni necessarie;
//   3. emette gli eventi delle scadenze in avvicinamento;
//   4. emette gli eventi delle valutazioni diventate obsolete e dei cambiamenti
//      critici che toccano una pratica aperta.
//
// ⚠️ NON DIPENDE DAL BROWSER. Nessun `setInterval` nel frontend: un'opportunità
// che compare solo mentre qualcuno tiene AI-Swisse aperto non è proattività, è
// una cosa che succede a chi stava già guardando.
//
// ⚠️ QUESTA FUNZIONE NON PRESENTA DOMANDE E NON PARLA CON NESSUNA AUTORITÀ.
// Non esiste qui — né altrove nel modulo — un percorso che invii una
// candidatura, compili un formulario ufficiale, firmi o carichi allegati su un
// portale. Legge il catalogo e scrive valutazioni.
//
// ⚠️ IL BUDGET DI TEMPO. Supabase chiude la richiesta a 150 secondi e uccide
// l'isolate: il `finally` NON gira. Ogni passo controlla il tempo PRIMA di
// cominciarne un altro, e ciò che resta è lavoro della prossima esecuzione.
//
// COSA RESTITUISCE: conteggi e codici. Mai nomi di aziende, titoli di progetto,
// importi o testi di fonti.
// ============================================================================
import { timingSafeEqual } from '../_shared/email/crypto.ts';
import { adminClient, CORS, env, failure, json, logEvent } from '../_shared/automation/runtime.ts';
import { EDGE_TIME_BUDGET_MS, DEADLINE_EMIT_DAYS, REASSESS_BATCH } from '../_shared/subsidy/contract.ts';
import { runMatching } from '../_shared/subsidy/match.ts';
import { emptySourceReport, runSourceChecks } from '../_shared/subsidy/sourceCheck.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  // Senza segreto configurato la funzione non è utilizzabile: 503, e non 403 —
  // «non sono pronto» e «non sei tu» sono due cose diverse, e chi mette in
  // esercizio il prodotto deve poterle distinguere.
  const expected = env('SUBSIDY_WORKER_SECRET');
  if (!expected) return failure('CONFIG_MISSING', 503);
  const provided = req.headers.get('x-subsidy-worker-secret') ?? '';
  if (!timingSafeEqual(provided, expected)) return failure('FORBIDDEN', 403);

  const started = Date.now();
  const deadline = started + EDGE_TIME_BUDGET_MS;
  const today = new Date().toISOString().slice(0, 10);
  const sb = adminClient();

  const report = {
    matching: { projectsScanned: 0, opportunitiesCreated: 0, assessmentsWritten: 0, assessmentsSkipped: 0, errors: [] as string[] },
    sources: emptySourceReport(),
    deadlinesEmitted: 0,
    staleEmitted: 0,
    criticalChangeEmitted: 0,
    matchingError: null as string | null,
    sourcesError: null as string | null,
    scanError: null as string | null,
    timeBudgetReached: false,
    durationMs: 0,
  };

  // ---- 1. Rivalutazione ----
  try {
    report.matching = await runMatching(sb, {
      today, limit: REASSESS_BATCH, deadlineMs: deadline, now: () => Date.now(),
    });
  } catch (error) {
    report.matchingError = codeOf(error);
  }

  // ---- 2. Fonti ----
  // ⚠️ Le fonti si controllano DOPO il matching, e l'ordine è una scelta: se il
  //    tempo finisce, è meglio aver rivalutato le opportunità di qualcuno che
  //    aver interrogato una pagina che cambia due volte l'anno.
  if (Date.now() < deadline) {
    try {
      report.sources = await runSourceChecks({
        sb, fetch: globalThis.fetch, now: () => Date.now(), deadlineMs: deadline,
      });
    } catch (error) {
      report.sourcesError = codeOf(error);
    }
  }

  // ---- 3 e 4. Le scansioni ----
  // ⚠️ NON SONO TERMINALI per il worker: se falliscono, il codice finisce nel
  //    rapporto e nei log e il resto del giro resta valido. È la stessa scelta
  //    fatta per le due scansioni del CRM; `automation_emit_overdue` resta
  //    terminale perché è della migrazione che crea la coda.
  if (Date.now() < deadline) {
    try {
      const { data: d } = await sb.rpc('subsidy_emit_deadline_approaching', {
        p_within_days: DEADLINE_EMIT_DAYS, p_limit: 200,
      });
      report.deadlinesEmitted = typeof d === 'number' ? d : 0;

      const { data: s } = await sb.rpc('subsidy_emit_stale_assessments', { p_limit: 200 });
      report.staleEmitted = typeof s === 'number' ? s : 0;

      const { data: c } = await sb.rpc('subsidy_emit_source_critical_change', { p_limit: 100 });
      report.criticalChangeEmitted = typeof c === 'number' ? c : 0;
    } catch (error) {
      report.scanError = codeOf(error);
    }
  }

  report.timeBudgetReached = Date.now() >= deadline;
  report.durationMs = Date.now() - started;

  // ⚠️ Solo conteggi e codici: nel rapporto non entra nulla che descriva
  //    un'azienda, un progetto, un programma o il contenuto di una fonte.
  logEvent('subsidy-worker', {
    projectsScanned: report.matching.projectsScanned,
    opportunitiesCreated: report.matching.opportunitiesCreated,
    assessmentsWritten: report.matching.assessmentsWritten,
    assessmentsSkipped: report.matching.assessmentsSkipped,
    sourcesChecked: report.sources.sourcesChecked,
    sourcesChanged: report.sources.changed,
    sourcesBlocked: report.sources.blocked,
    reviewsCreated: report.sources.reviewsCreated,
    deadlinesEmitted: report.deadlinesEmitted,
    staleEmitted: report.staleEmitted,
    criticalChangeEmitted: report.criticalChangeEmitted,
    matchingError: report.matchingError,
    sourcesError: report.sourcesError,
    scanError: report.scanError,
    timeBudgetReached: report.timeBudgetReached,
    durationMs: report.durationMs,
  });

  return json({ status: 'ok', report });
});

/** Il codice tecnico, mai il messaggio: un messaggio può contenere dati. */
function codeOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const first = message.split(':')[0]?.trim() ?? '';
  return /^[A-Z_a-z]{3,40}$/.test(first) ? first : 'unknown';
}
