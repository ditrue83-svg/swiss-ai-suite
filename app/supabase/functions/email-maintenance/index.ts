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
//   3. RECUPERA ciò che è rimasto a metà. Un'Edge Function uccisa a metà non
//      esegue il proprio `finally`: il messaggio resta «in elaborazione» e la
//      sincronizzazione resta «in corso» per sempre. Nessuno li ripescava, e
//      uno stato appeso è un guasto travestito da lavoro in corso.
//   4. PULISCE ciò che non serve più: stati OAuth scaduti, impronte di eventi
//      webhook vecchie. Nessuna cancellazione di dati aziendali (§53).
//
// AUTENTICAZIONE: un'intestazione segreta, confrontata a tempo costante. Non è
// un endpoint pubblico per definizione come il webhook, ma è raggiungibile, e
// un'esecuzione forzata da un estraneo consumerebbe chiamate al provider.
// ============================================================================
import { timingSafeEqual } from '../_shared/email/crypto.ts';
import {
  EDGE_TIME_BUDGET_MS, GOOGLE_WATCH_RENEW_EVERY_HOURS, STALE_PROCESSING_MINUTES,
  WATCH_RENEW_BEFORE_HOURS,
} from '../_shared/email/contract.ts';
import {
  adapterForConnection, adminClient, aiCreateMessage, CORS, env, failure,
  getEncryptionKey, json, logEvent, outputLanguage, webhookUrl,
} from '../_shared/email/runtime.ts';
import { getConnection, newCounters, readSecrets, writeSecrets, type ServerClient } from '../_shared/email/store.ts';
import {
  drainPendingAnalyses, drainPendingClassifications, getValidAccessToken, runSync, type SyncDeps,
} from '../_shared/email/sync.ts';
import { EmailProviderError } from '../_shared/email/types.ts';
// ⚠️ QUESTA FUNZIONE NON È PIÙ SOLO DELL'INBOX, e vale la pena dirlo qui.
// `recoverStuckAnalyses` chiude i documenti di Admin AI rimasti «in
// elaborazione» — compresi quelli caricati a mano, che con l'Inbox non hanno
// niente a che vedere. Vive qui perché QUESTO è l'unico lavoro periodico già
// acceso che guarda i `documents`, e aggiungere una Edge Function e un job
// pg_cron per venticinque righe avrebbe chiesto una migrazione all'utente per
// ottenere la stessa cosa cinque minuti prima. Se un giorno la manutenzione si
// divide, questa chiamata si sposta con il suo modulo: sta tutta in `_shared`.
import { recoverStuckAnalyses } from '../_shared/recoverStuckAnalyses.ts';

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
  const report = {
    renewed: 0, renewFailed: 0, reconciled: 0, reconcileFailed: 0, analysed: 0,
    reclassified: 0, reclassifyFailed: 0,
    requeued: 0, interrupted: 0, runsClosed: 0, cleanedStates: 0, cleanedEvents: 0,
    // Documenti di Admin AI rimasti appesi: dichiarati falliti, oppure solo
    // riallineati quando l'analisi c'era già ed era lo stato a essere indietro.
    stuckRecovered: 0, stuckReconciled: 0,
    // Dichiarato nella risposta: chi legge il report deve poter distinguere
    // «non c'era altro da fare» da «il tempo è finito prima del lavoro».
    timeBudgetReached: false,
  };

  try {
    const deps: SyncDeps = {
      sb,
      encryptionKey: await getEncryptionKey(),
      adapterFor: adapterForConnection,
      createMessage: aiCreateMessage(),
      outputLanguage: language,
      notificationUrl: null,
    };

    // Il tempo è la risorsa scarsa qui: oltre i 150 secondi la richiesta viene
    // chiusa e l'isolate ucciso a metà. Tutti i passi lavorano dentro lo stesso
    // budget e si fermano in ordine; il lavoro rimasto è quello della prossima
    // esecuzione, che arriva fra un'ora.
    const deadline = Date.now() + EDGE_TIME_BUDGET_MS;

    await renewWatches(deps, report, deadline);
    // Prima di riconciliare e di smaltire: ciò che è rimasto appeso torna in uno
    // stato onesto, e quello che merita un ritentativo entra in coda in tempo per
    // lo smaltimento di questa stessa esecuzione.
    await recoverInterrupted(sb, report);
    // Stesso principio un piano più in là: ciò che è rimasto appeso torna in
    // uno stato onesto. Qui però non si ritenta — vedi il modulo.
    const stuck = await recoverStuckAnalyses(sb);
    report.stuckRecovered = stuck.recovered;
    report.stuckReconciled = stuck.reconciled;
    await reconcile(deps, report, deadline);
    // ⚠️ PRIMA delle analisi, di proposito: un messaggio classificato adesso
    // come «azionabile» entra nella coda delle analisi nello stesso giro,
    // invece di aspettare quindici minuti.
    const ripresa = await drainClassifications(deps, deadline);
    report.reclassified = ripresa.classified;
    report.reclassifyFailed = ripresa.failed;
    report.analysed = await drainAnalyses(deps, deadline);
    report.cleanedStates = await cleanupOauthStates(sb);
    report.cleanedEvents = await cleanupWebhookEvents(sb);
    report.timeBudgetReached = Date.now() >= deadline;
  } catch (error) {
    const code = error instanceof EmailProviderError ? error.code : 'UNKNOWN';
    logEvent('email-maintenance', { code });
    return json({ status: 'failed', code, report }, 500);
  }

  logEvent('email-maintenance', { ...report });
  return json({ status: 'ok', report });
});

// ---- 1. Rinnovo delle sottoscrizioni ----------------------------------------

async function renewWatches(
  deps: SyncDeps, report: { renewed: number; renewFailed: number }, deadline: number,
): Promise<void> {
  const threshold = new Date(Date.now() + WATCH_RENEW_BEFORE_HOURS * 3600_000).toISOString();
  // Si prendono anche quelle SENZA scadenza nota: una sottoscrizione di cui non
  // si conosce la scadenza è indistinguibile da una che non c'è.
  const { data } = await deps.sb.from('email_connections')
    .select('id')
    .eq('status', 'active').eq('sync_enabled', true)
    .or(`watch_expires_at.is.null,watch_expires_at.lt.${threshold}`)
    .limit(MAX_PER_RUN);

  for (const row of (data ?? []) as { id: string }[]) {
    if (Date.now() >= deadline) return;
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

async function reconcile(
  deps: SyncDeps, report: { reconciled: number; reconcileFailed: number }, deadline: number,
): Promise<void> {
  const silentSince = new Date(Date.now() - RECONCILE_IF_SILENT_HOURS * 3600_000).toISOString();
  // Si prendono anche le caselle il cui import iniziale non è mai arrivato in
  // fondo, ANCHE se si sono sincronizzate da poco: senza questa condizione un
  // import troncato non verrebbe mai ripreso, perché la riconciliazione guarda
  // solo le ultime 72 ore e i messaggi più vecchi resterebbero fuori per sempre.
  const { data } = await deps.sb.from('email_connections')
    .select('id, initial_sync_completed_at')
    .eq('status', 'active').eq('sync_enabled', true)
    .or(`last_successful_sync_at.is.null,last_successful_sync_at.lt.${silentSince},initial_sync_completed_at.is.null`)
    .limit(MAX_PER_RUN);

  for (const row of (data ?? []) as { id: string; initial_sync_completed_at: string | null }[]) {
    if (Date.now() >= deadline) return;
    // Un import iniziale incompleto si RIPRENDE come import iniziale: rileggere
    // solo le ultime 72 ore lascerebbe fuori proprio la parte che manca. Costa
    // poco: i messaggi già acquisiti vengono riconosciuti e saltati, senza
    // classificarli e senza spendere.
    const outcome = await runSync(deps, {
      connectionId: row.id,
      syncType: row.initial_sync_completed_at ? 'reconciliation' : 'initial',
      triggeredBy: 'schedule',
      deadlineMs: deadline,
    });
    // `busy` non è un fallimento: significa che una sincronizzazione è già in
    // corso, cioè esattamente ciò che si voleva ottenere.
    if (outcome.status === 'ok' || outcome.status === 'busy') report.reconciled++;
    else report.reconcileFailed++;
  }
}

// ---- 3. Coda delle analisi ---------------------------------------------------

/**
 * Smaltisce la coda delle analisi documentali rimaste in sospeso.
 *
 * Esiste perché l'import iniziale di una casella promuove decine di messaggi
 * insieme e la quota AI, giustamente, non li lascia passare tutti. Rinviare e
 * smaltire a lotti è ciò che rende il primo collegamento sopportabile senza
 * alzare un limite che protegge davvero.
 */
/**
 * Riprende le classificazioni cadute per un guasto dell'AMBIENTE.
 *
 * ⚠️ Senza questo passo un messaggio chiuso come `failed` non lo riprendeva
 * NESSUNO: `processMessage` salta i messaggi già acquisiti e
 * `recoverInterrupted` guarda solo gli stati in lavorazione. Il 2026-07-31 in
 * produzione c'erano 16 messaggi mai classificati, tredici dei quali caduti
 * mentre il credito era esaurito — per una ragione che si era già risolta.
 */
async function drainClassifications(
  deps: SyncDeps, deadline: number,
): Promise<{ classified: number; failed: number }> {
  const esito = { classified: 0, failed: 0 };
  const { data } = await deps.sb.from('email_connections')
    .select('id')
    .eq('status', 'active').eq('sync_enabled', true)
    .limit(MAX_PER_RUN);

  for (const row of (data ?? []) as { id: string }[]) {
    if (Date.now() >= deadline) break;
    const connection = await getConnection(deps.sb, row.id);
    if (!connection) continue;
    try {
      const adapter = adapterForConnection(connection);
      const accessToken = await getValidAccessToken(deps, connection, adapter);
      const parziale = await drainPendingClassifications(
        deps, connection, adapter, accessToken, undefined, deadline,
      );
      esito.classified += parziale.classified;
      esito.failed += parziale.failed;
    } catch (error) {
      logEvent('email-maintenance', {
        step: 'reclassify',
        code: error instanceof EmailProviderError ? error.code : 'UNKNOWN',
      });
    }
  }
  return esito;
}

async function drainAnalyses(deps: SyncDeps, deadline: number): Promise<number> {
  const { data } = await deps.sb.from('email_connections')
    .select('id')
    .eq('status', 'active').eq('sync_enabled', true)
    .limit(MAX_PER_RUN);

  let totale = 0;
  for (const row of (data ?? []) as { id: string }[]) {
    if (Date.now() >= deadline) break;
    const connection = await getConnection(deps.sb, row.id);
    if (!connection) continue;
    try {
      const adapter = adapterForConnection(connection);
      const accessToken = await getValidAccessToken(deps, connection, adapter);
      totale += await drainPendingAnalyses(deps, connection, adapter, accessToken, newCounters(),
        undefined, deadline);
    } catch (error) {
      // Una casella che non si autentica non blocca le altre: il suo stato è
      // già stato registrato da `getValidAccessToken`.
      logEvent('email-maintenance', {
        step: 'drain',
        code: error instanceof EmailProviderError ? error.code : 'UNKNOWN',
      });
    }
  }
  return totale;
}

// ---- 4. Recupero di ciò che è rimasto a metà ---------------------------------

/**
 * Rimette in uno stato onesto i lavori interrotti.
 *
 * Un'Edge Function che supera il proprio tempo massimo viene uccisa: il `finally`
 * non gira, e restano un messaggio in `analyzing` e una sincronizzazione in
 * `running` che nessuna parte del sistema ripesca. Visto sul campo al primo
 * collegamento reale: un messaggio fermo in `classifying` e una sincronizzazione
 * «in corso» da ventiquattro ore.
 *
 * Due destini diversi, perché due cose diverse:
 *   · un messaggio già riconosciuto come azionabile e interrotto durante
 *     l'importazione o l'analisi torna IN CODA — merita un ritentativo, e
 *     riprenderlo è sicuro perché l'analisi riparte dal documento già creato;
 *   · tutto il resto diventa un ERRORE DICHIARATO. Un messaggio interrotto
 *     durante la classificazione non è riclassificabile in automatico (la
 *     sincronizzazione salta i messaggi già acquisiti): resta visibile fra
 *     quelli da verificare, con il suo codice, e la persona decide.
 *
 * Il ritentativo è UNO SOLO: `error_code` resta `INTERRUPTED` mentre il
 * messaggio è in coda, quindi una seconda interruzione lo trova già marcato e
 * lo ferma. Un'analisi che si interrompe sempre non può diventare una spesa
 * ricorrente. Al successo il codice viene azzerato dalla pipeline: la traccia
 * sparisce da sola.
 */
async function recoverInterrupted(
  sb: ServerClient, report: { requeued: number; interrupted: number; runsClosed: number },
): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_PROCESSING_MINUTES * 60_000).toISOString();

  const { data: stale } = await sb.from('email_messages')
    .select('id, processing_status, relevance, error_code')
    .in('processing_status', ['pending', 'classifying', 'importing', 'analyzing'])
    .lt('updated_at', cutoff)
    .limit(200);

  for (const row of (stale ?? []) as {
    id: string; processing_status: string; relevance: string | null; error_code: string | null;
  }[]) {
    const inAnalysis = row.processing_status === 'importing' || row.processing_status === 'analyzing';
    const retryable = inAnalysis && row.relevance === 'likely_actionable' && row.error_code !== 'INTERRUPTED';

    if (retryable) {
      await sb.from('email_messages')
        .update({ processing_status: 'awaiting_analysis', error_code: 'INTERRUPTED' })
        .eq('id', row.id);
      report.requeued++;
    } else {
      await sb.from('email_messages')
        .update({ processing_status: 'failed', error_code: 'INTERRUPTED' })
        .eq('id', row.id);
      report.interrupted++;
    }
  }

  // Una sincronizzazione «in corso» da mezz'ora non è in corso. `duration_ms`
  // resta vuoto di proposito: quanto sia durata prima di morire non lo sappiamo,
  // e un numero inventato in un registro diagnostico è peggio di un campo vuoto.
  const { data: runs } = await sb.from('email_sync_runs')
    .update({ status: 'failed', completed_at: new Date().toISOString(), error_code: 'INTERRUPTED' })
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .select('id');
  report.runsClosed = Array.isArray(runs) ? runs.length : 0;
}

// ---- 5. Pulizia --------------------------------------------------------------

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
