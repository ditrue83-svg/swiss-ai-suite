// ============================================================================
// Edge Function: calendar-sync — il worker della coda, e la sincronizzazione
// su richiesta.
//
// TRE CHIAMANTI, TRE AUTENTICAZIONI DIVERSE, e non è un dettaglio:
//
//   POST { action: 'drain' }      lo chiama lo SCHEDULER. Autenticato con un
//                                 segreto confrontato a tempo costante. Svuota
//                                 la coda e, ogni tanto, riconcilia.
//   POST { action: 'sync' }       lo chiama una PERSONA dal pulsante
//                                 «Sincronizza ora». Autenticato con il suo
//                                 JWT, limitato nella frequenza (§74).
//   POST { action: 'reconcile' }  lo chiama lo scheduler, per una connessione
//                                 sola. Serve alla diagnostica.
//
// ⚠️ IL BUDGET DI TEMPO NON È PRUDENZA, È LA LEZIONE PIÙ CARA DEL PROGETTO
// Supabase chiude la richiesta a 150 secondi e uccide l'isolate: il `finally`
// NON gira. Un worker che non si ferma da solo viene fermato a metà, e ciò che
// stava facendo resta appeso. Qui ogni passo controlla il proprio tempo prima
// di cominciarne un altro, e il lavoro rimasto è quello della prossima
// esecuzione — che arriva fra pochi minuti.
//
// ⚠️ UN FALLIMENTO DEL CALENDARIO NON DEVE MAI TOCCARE L'ATTIVITÀ (§72)
// Questa funzione non scrive una riga di `tasks`. Se Google è irraggiungibile,
// la coda resta piena e l'attività resta esattamente com'era: il lavoro è più
// importante dell'integrazione.
// ============================================================================
import { timingSafeEqual } from '../_shared/email/crypto.ts';
import {
  EDGE_TIME_BUDGET_MS, MANUAL_SYNC_MIN_INTERVAL_SECONDS, QUEUE_BATCH, QUEUE_LOCK_SECONDS,
  QUEUE_MAX_ATTEMPTS, RECONCILE_BATCH, RECONCILE_EVERY_HOURS, queueBackoffSeconds,
} from '../_shared/calendar/contract.ts';
import {
  adapterFor, adminClient, appOrigin, assertMember, authenticate, CORS, env, failure,
  getEncryptionKey, json, logEvent, resolveEmailProvider,
} from '../_shared/calendar/runtime.ts';
import {
  claimQueue, enqueueTasks, finishRun, getConnection, linksForTask, markLinkFailed,
  queueDone, queueRetry, startRun, type CalendarConnectionRow, type ServerClient,
} from '../_shared/calendar/store.ts';
import { reconcileConnection, syncTask, type SyncDeps } from '../_shared/calendar/sync.ts';
import { notifyCalendarProblem } from '../_shared/calendar/notify.ts';
import { CalendarProviderError } from '../_shared/calendar/types.ts';

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  const body = await req.json().catch(() => ({})) as { action?: string; connectionId?: string; companyId?: string };
  const action = body.action ?? 'drain';

  try {
    if (action === 'drain') return await handleDrain(req);
    if (action === 'reconcile') return await handleReconcile(req);
    if (action === 'sync') return await handleManualSync(req, body);
    return failure('BAD_REQUEST', 400);
  } catch (error) {
    const code = error instanceof CalendarProviderError ? error.code : 'UNKNOWN';
    logEvent('calendar-sync', { action, code });
    return json({ status: 'failed', code }, code === 'CONFIG_MISSING' ? 503 : 500);
  }
});

/** Il segreto dello scheduler. Confronto a tempo costante, come per l'Inbox. */
function schedulerAuthorized(req: Request): boolean {
  const expected = env('CALENDAR_WORKER_SECRET');
  if (!expected) return false;
  const provided = req.headers.get('x-calendar-worker-secret') ?? '';
  return timingSafeEqual(provided, expected);
}

function depsFor(sb: ServerClient, key: CryptoKey): SyncDeps {
  return {
    sb,
    encryptionKey: key,
    adapterFor,
    appOrigin: appOrigin(),
    // Nuova a ogni invocazione: un nome azienda memorizzato fra due invocazioni
    // dello stesso isolate resterebbe stantio dopo una rinomina.
    companyNames: new Map(),
  };
}

// ---- 1. La coda -------------------------------------------------------------

async function handleDrain(req: Request): Promise<Response> {
  if (!env('CALENDAR_WORKER_SECRET')) return failure('CONFIG_MISSING', 503);
  if (!schedulerAuthorized(req)) return failure('FORBIDDEN', 403);

  const sb = adminClient();
  const key = await getEncryptionKey();
  const deps = depsFor(sb, key);
  const deadline = Date.now() + EDGE_TIME_BUDGET_MS;

  const report = {
    claimed: 0, upserted: 0, deleted: 0, failures: 0, retried: 0, givenUp: 0,
    untouchable: 0, reconciled: 0,
    // Dichiarato nella risposta: chi legge il report deve poter distinguere
    // «non c'era altro da fare» da «il tempo è finito prima del lavoro».
    timeBudgetReached: false,
  };

  const items = await claimQueue(sb, QUEUE_BATCH, QUEUE_LOCK_SECONDS);
  report.claimed = items.length;

  for (const item of items) {
    if (Date.now() >= deadline) break;
    const outcome = await syncTask(deps, item.task_id);
    report.upserted += outcome.upserted;
    report.deleted += outcome.deleted;
    report.untouchable += outcome.untouchable;

    if (outcome.failures === 0) {
      await queueDone(sb, item.task_id, item.lock_id);
      continue;
    }

    report.failures += outcome.failures;
    const attempts = item.attempts + 1;

    // Un consenso revocato non si risolve riprovando, e nemmeno un tetto di
    // tentativi raggiunto. In entrambi i casi si SMETTE e si DICHIARA: la coda
    // si libera, i collegamenti restano marcati come falliti, e la persona
    // riceve un avviso — una volta sola (§122/§123).
    if (outcome.fatal || attempts >= QUEUE_MAX_ATTEMPTS) {
      await queueDone(sb, item.task_id, item.lock_id);
      report.givenUp++;
      await declareFailure(deps, item.task_id, outcome.errorCode ?? 'UNKNOWN', outcome.fatal);
      continue;
    }

    await queueRetry(sb, item.task_id, item.lock_id, item.attempts,
      queueBackoffSeconds(attempts), outcome.errorCode ?? 'UNKNOWN');
    report.retried++;
  }

  // Con tempo avanzato si riconcilia UNA connessione, la più trascurata. Un
  // giro alla volta: la riconciliazione è la rete di sicurezza, non il lavoro
  // principale, e non deve rubare il turno alla coda.
  if (Date.now() < deadline - 30_000) {
    report.reconciled = await reconcileOldest(deps, deadline);
  }

  report.timeBudgetReached = Date.now() >= deadline;
  logEvent('calendar-sync', { action: 'drain', ...report });
  return json({ status: 'ok', report });
}

/**
 * Dichiara un guasto che non si risolverà da solo.
 *
 * Marca i collegamenti come falliti — così la schermata può dire «questa
 * attività non è sul calendario» invece di lasciarlo credere — e avvisa la
 * persona una volta sola.
 */
async function declareFailure(
  deps: SyncDeps, taskId: string, code: string, fatal: boolean,
): Promise<void> {
  const links = await linksForTask(deps.sb, taskId);
  for (const link of links) await markLinkFailed(deps.sb, link.id, code);

  // Chi va avvisato: il responsabile dell'attività, che è il proprietario dei
  // calendari coinvolti. Se non ce n'è, non c'è nessuno da avvisare e non si
  // inventa un destinatario.
  const { data } = await deps.sb.from('tasks')
    .select('company_id, assignee_user_id').eq('id', taskId).maybeSingle();
  const task = data as { company_id: string; assignee_user_id: string | null } | null;
  if (!task?.assignee_user_id) return;

  const { data: conns } = await deps.sb.from('calendar_connections')
    .select('id').eq('company_id', task.company_id).eq('user_id', task.assignee_user_id).limit(1);
  const connectionId = ((conns ?? []) as { id: string }[])[0]?.id;
  if (!connectionId) return;

  await notifyCalendarProblem({
    sb: deps.sb, appOrigin: deps.appOrigin, emailProvider: resolveEmailProvider(),
  }, {
    companyId: task.company_id,
    userId: task.assignee_user_id,
    connectionId,
    reauth: fatal,
  });
}

// ---- 2. Riconciliazione ------------------------------------------------------

/** La connessione che non viene controllata da più tempo. Una per esecuzione. */
async function reconcileOldest(deps: SyncDeps, deadline: number): Promise<number> {
  const cutoff = new Date(Date.now() - RECONCILE_EVERY_HOURS * 3600_000).toISOString();
  const { data } = await deps.sb.from('calendar_connections')
    .select('id')
    .eq('status', 'active').eq('sync_enabled', true)
    .or(`last_sync_at.is.null,last_sync_at.lt.${cutoff}`)
    .order('last_sync_at', { ascending: true, nullsFirst: true })
    .limit(1);

  const id = ((data ?? []) as { id: string }[])[0]?.id;
  if (!id) return 0;

  const connection = await getConnection(deps.sb, id);
  if (!connection) return 0;

  const started = Date.now();
  const runId = await startRun(deps.sb, {
    companyId: connection.company_id, connectionId: connection.id,
    provider: connection.provider, trigger: 'schedule',
  });
  const outcome = await reconcileConnection(deps, connection, RECONCILE_BATCH, deadline);
  await finishRun(deps.sb, runId, {
    status: outcome.errorCode ? 'failed' : 'ok',
    upserted: 0, deleted: 0, failures: outcome.errorCode ? 1 : 0,
    startedAtMs: started, errorCode: outcome.errorCode,
  });
  return 1;
}

async function handleReconcile(req: Request): Promise<Response> {
  if (!env('CALENDAR_WORKER_SECRET')) return failure('CONFIG_MISSING', 503);
  if (!schedulerAuthorized(req)) return failure('FORBIDDEN', 403);

  const sb = adminClient();
  const deps = depsFor(sb, await getEncryptionKey());
  const deadline = Date.now() + EDGE_TIME_BUDGET_MS;
  const done = await reconcileOldest(deps, deadline);
  return json({ status: 'ok', reconciled: done });
}

// ---- 3. «Sincronizza ora» ----------------------------------------------------

/**
 * Sincronizzazione su richiesta di una persona.
 *
 * Non scrive eventi direttamente: rimette in coda le attività della persona e
 * poi svuota subito la coda per quella connessione. Un solo percorso di
 * scrittura in tutto il sistema — se il pulsante avesse il proprio, sarebbe
 * quello meno provato, perché nessun test automatico preme un pulsante.
 *
 * ⚠️ Limitato nella frequenza (§74): venti clic non sono venti giri contro
 * l'API di Google. Il limite è per connessione e sta nel database, non in un
 * contatore in memoria che si azzera a ogni isolate nuovo.
 */
async function handleManualSync(
  req: Request, body: { connectionId?: string },
): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return failure('UNAUTHENTICATED', 401);
  if (!body.connectionId) return failure('BAD_REQUEST', 400);

  const sb = adminClient();
  const connection = await getConnection(sb, body.connectionId);
  if (!connection) return failure('NOT_FOUND', 404);

  // Doppio controllo, e nessuno dei due è ridondante: la connessione dev'essere
  // SUA (una connessione di calendario è personale) e l'azienda dev'essere una
  // di cui è membro, verificata tramite RLS con il suo stesso JWT.
  if (connection.user_id !== auth.userId) return failure('FORBIDDEN', 403);
  if (!(await assertMember(auth, connection.company_id))) return failure('FORBIDDEN', 403);

  if (connection.last_sync_at) {
    const elapsed = Date.now() - new Date(connection.last_sync_at).getTime();
    if (elapsed < MANUAL_SYNC_MIN_INTERVAL_SECONDS * 1000) return failure('SYNC_TOO_SOON', 429);
  }
  if (connection.status !== 'active') return failure('AUTH_EXPIRED', 409);

  await sb.from('calendar_connections')
    .update({ last_sync_at: new Date().toISOString() }).eq('id', connection.id);

  const key = await getEncryptionKey();
  const deps = depsFor(sb, key);
  const deadline = Date.now() + EDGE_TIME_BUDGET_MS;
  const started = Date.now();
  const runId = await startRun(sb, {
    companyId: connection.company_id, connectionId: connection.id,
    provider: connection.provider, trigger: 'manual',
  });

  const report = { queued: 0, upserted: 0, deleted: 0, failures: 0, timeBudgetReached: false };

  try {
    const ids = await requeueForConnection(sb, connection);
    report.queued = ids.length;

    // ⚠️ Si prenotano SOLO le attività appena accodate, non le prime della coda.
    // Senza il filtro, «Sincronizza ora» prenderebbe le righe più vecchie —
    // che possono essere di chiunque — e il messaggio «N eventi aggiornati»
    // conterebbe il lavoro di qualcun altro.
    const items = await claimQueue(sb, QUEUE_BATCH, QUEUE_LOCK_SECONDS, ids);
    for (const item of items) {
      if (Date.now() >= deadline) { report.timeBudgetReached = true; break; }
      const outcome = await syncTask(deps, item.task_id);
      report.upserted += outcome.upserted;
      report.deleted += outcome.deleted;
      report.failures += outcome.failures;
      if (outcome.failures === 0) await queueDone(sb, item.task_id, item.lock_id);
      else {
        await queueRetry(sb, item.task_id, item.lock_id, item.attempts,
          queueBackoffSeconds(item.attempts + 1), outcome.errorCode ?? 'UNKNOWN');
      }
    }

    await finishRun(sb, runId, {
      status: report.failures ? 'partial' : 'ok',
      upserted: report.upserted, deleted: report.deleted, failures: report.failures,
      startedAtMs: started,
    });
  } catch (error) {
    const code = error instanceof CalendarProviderError ? error.code : 'UNKNOWN';
    await finishRun(sb, runId, {
      status: 'failed', upserted: report.upserted, deleted: report.deleted,
      failures: report.failures + 1, startedAtMs: started, errorCode: code,
    });
    return json({ status: 'failed', code, report }, 200);
  }

  logEvent('calendar-sync', { action: 'manual', ...report });
  return json({ status: 'ok', report });
}

/**
 * Rimette in coda tutto ciò che riguarda una connessione: le attività che
 * DOVREBBERO avere un evento e quelle che ne hanno uno da rimuovere.
 * Il secondo insieme non è un di più — senza, «Sincronizza ora» non toglierebbe
 * mai un evento rimasto indietro, che è proprio il caso in cui una persona
 * preme quel pulsante.
 */
async function requeueForConnection(sb: ServerClient, connection: CalendarConnectionRow): Promise<string[]> {
  const [{ data: shouldHave }, { data: hasLink }] = await Promise.all([
    sb.from('tasks').select('id')
      .eq('company_id', connection.company_id)
      .eq('assignee_user_id', connection.user_id)
      .neq('status', 'completed').is('archived_at', null).not('due_date', 'is', null)
      .limit(300),
    sb.from('calendar_event_links').select('task_id').eq('connection_id', connection.id).limit(300),
  ]);

  const ids = new Set<string>();
  for (const t of (shouldHave ?? []) as { id: string }[]) ids.add(t.id);
  for (const l of (hasLink ?? []) as { task_id: string }[]) ids.add(l.task_id);

  const rows = [...ids].map((id) => ({ taskId: id, companyId: connection.company_id }));
  await enqueueTasks(sb, rows);
  return [...ids];
}
