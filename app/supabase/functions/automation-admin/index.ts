// ============================================================================
// Edge Function: automation-admin — creare, modificare, attivare, provare.
//
// ⚠️ ESISTE PERCHÉ IL BROWSER NON HA NESSUN PERMESSO DI SCRITTURA SULLE REGOLE,
// e la ragione non è la paura del browser: è che la validazione contro il
// REGISTRO — quali campi esistono, quali operatori, quali azioni, quali
// segnaposto — vive in TypeScript, e il database non può ripeterla senza
// diventare una seconda copia dello stesso elenco. Invece di duplicare, si è
// tolto il permesso: le regole si scrivono da qui, dove il registro c'è.
// È la stessa disciplina delle connessioni di posta (0013).
//
// TRE CONTROLLI PRIMA DI OGNI SCRITTURA, e nessuno dei tre è ridondante:
//   1. l'utente è AUTENTICATO (il suo JWT, non un parametro);
//   2. è OWNER o ADMIN di QUELLA azienda, e lo si chiede al database CON IL SUO
//      JWT: con il service role la risposta arriverebbe anche per aziende che
//      non può vedere;
//   3. la configurazione supera il registro. Per l'attivazione anche i
//      RIFERIMENTI: il responsabile è ancora in azienda? l'etichetta esiste?
//
// ⚠️ La prova a vuoto non scrive niente. Nemmeno una riga di audit.
// ============================================================================
import {
  assertAdmin, authenticate, CORS, adminClient, failure, json, logEvent,
} from '../_shared/automation/runtime.ts';
import { dryRun, simulateRecent } from '../_shared/automation/engine.ts';
import { checkReferences, type ServerClient } from '../_shared/automation/store.ts';
import { validateWorkflow } from '../_shared/automation/validate.ts';
import { findTrigger, type WorkflowConfig } from '../_shared/automation/registry.ts';

interface Body {
  action?: string;
  companyId?: string;
  id?: string;
  runId?: string;
  name?: string;
  description?: string | null;
  triggerType?: string;
  conditionMatch?: string;
  conditions?: unknown;
  actions?: unknown;
  entityId?: string;
  days?: number;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  const body = await req.json().catch(() => ({})) as Body;
  const action = String(body.action ?? '');
  const companyId = String(body.companyId ?? '');
  if (!companyId) return failure('BAD_REQUEST', 400);

  const auth = await authenticate(req);
  if (!auth) return failure('UNAUTHENTICATED', 401);
  if (!(await assertAdmin(auth, companyId))) return failure('FORBIDDEN', 403);

  const sb = adminClient();

  try {
    switch (action) {
      case 'save':     return await handleSave(sb, auth.userId, companyId, body);
      case 'activate': return await handleStatus(sb, auth.userId, companyId, body, 'active');
      case 'pause':    return await handleStatus(sb, auth.userId, companyId, body, 'paused');
      case 'archive':  return await handleStatus(sb, auth.userId, companyId, body, 'archived');
      case 'restore':  return await handleStatus(sb, auth.userId, companyId, body, 'draft');
      case 'dryRun':   return await handleDryRun(sb, companyId, body);
      case 'simulate': return await handleSimulate(sb, companyId, body);
      case 'retryRun': return await handleRetry(sb, auth.userId, companyId, body);
      case 'samples':  return await handleSamples(auth.sbUser, companyId, body);
      default:         return failure('BAD_REQUEST', 400);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith('CONFIG_MISSING')) return failure('CONFIG_MISSING', 503);
    logEvent('automation-admin', { action, companyId, code: 'unknown' });
    return failure('UNKNOWN', 500);
  }
});

/** La configurazione tipizzata a partire dal corpo della richiesta. */
function configFrom(body: Body): WorkflowConfig {
  return {
    triggerType: body.triggerType as WorkflowConfig['triggerType'],
    conditionMatch: body.conditionMatch === 'any' ? 'any' : 'all',
    conditions: Array.isArray(body.conditions) ? body.conditions as WorkflowConfig['conditions'] : [],
    actions: Array.isArray(body.actions) ? body.actions as WorkflowConfig['actions'] : [],
  };
}

// ---- Salvataggio -------------------------------------------------------------

async function handleSave(
  sb: ServerClient, userId: string, companyId: string, body: Body,
): Promise<Response> {
  const config = configFrom(body);
  const name = String(body.name ?? '').trim();

  // Una BOZZA può essere incompleta — è un lavoro a metà, ed è legittimo. Ciò
  // che non può essere è INVALIDA: un campo inesistente o un'azione inventata
  // non si salvano nemmeno in bozza, altrimenti resterebbero lì finché
  // qualcuno prova ad attivare e non capisce perché.
  const issues = validateWorkflow({ ...config, name }, { forActivation: false });
  if (issues.length) return failure('INVALID_CONFIG', 422, { issues });

  const row = {
    company_id: companyId,
    name,
    description: body.description ? String(body.description).slice(0, 500) : null,
    trigger_type: config.triggerType,
    condition_match: config.conditionMatch,
    conditions: config.conditions,
    actions: config.actions,
    updated_by: userId,
  };

  if (body.id) {
    // ⚠️ Si modifica solo ciò che è già di QUESTA azienda: senza il filtro,
    // un identificativo altrui verrebbe scritto lo stesso, perché qui si lavora
    // con il service role e la RLS non c'è (§113).
    const { data, error } = await sb.from('workflow_definitions')
      .update(row).eq('id', body.id).eq('company_id', companyId)
      .select('id, version, status').maybeSingle();
    if (error) return failure('SAVE_FAILED', 400, { detail: dbHint(error) });
    if (!data) return failure('NOT_FOUND', 404);
    return json({ status: 'ok', workflow: data });
  }

  const { data, error } = await sb.from('workflow_definitions')
    .insert({ ...row, created_by: userId, status: 'draft' })
    .select('id, version, status').single();
  if (error) return failure('SAVE_FAILED', 400, { detail: dbHint(error) });
  return json({ status: 'ok', workflow: data });
}

// ---- Stato -------------------------------------------------------------------

async function handleStatus(
  sb: ServerClient, userId: string, companyId: string, body: Body,
  status: 'active' | 'paused' | 'archived' | 'draft',
): Promise<Response> {
  if (!body.id) return failure('BAD_REQUEST', 400);

  const { data: current } = await sb.from('workflow_definitions')
    .select('id, name, trigger_type, condition_match, conditions, actions')
    .eq('id', body.id).eq('company_id', companyId).maybeSingle();
  if (!current) return failure('NOT_FOUND', 404);
  const wf = current as {
    name: string; trigger_type: string; condition_match: string;
    conditions: unknown; actions: unknown;
  };

  if (status === 'active') {
    // §54 — non si attiva ciò che non può funzionare. Meglio un rifiuto con
    // l'elenco di cosa manca che una regola «attiva» che fallisce a ogni evento.
    const config: WorkflowConfig = {
      triggerType: wf.trigger_type as WorkflowConfig['triggerType'],
      conditionMatch: wf.condition_match === 'any' ? 'any' : 'all',
      conditions: Array.isArray(wf.conditions) ? wf.conditions as WorkflowConfig['conditions'] : [],
      actions: Array.isArray(wf.actions) ? wf.actions as WorkflowConfig['actions'] : [],
    };
    const issues = validateWorkflow({ ...config, name: wf.name }, { forActivation: true });
    if (issues.length) return failure('INVALID_CONFIG', 422, { issues });

    const problems = await checkReferences(sb, companyId, config.actions);
    if (problems.length) return failure('INVALID_REFERENCES', 422, { problems });
  }

  const patch: Record<string, unknown> = { status, updated_by: userId };
  // Riportare in bozza è il modo di «ripescare» una regola archiviata: torna
  // modificabile e non riparte da sola. Riattivarla resta un gesto esplicito.
  if (status === 'draft' || status === 'paused') patch.attention_code = null;

  const { data, error } = await sb.from('workflow_definitions')
    .update(patch).eq('id', body.id).eq('company_id', companyId)
    .select('id, status, version, activated_at').maybeSingle();
  if (error) return failure('SAVE_FAILED', 400, { detail: dbHint(error) });
  if (!data) return failure('NOT_FOUND', 404);

  logEvent('automation-admin', { action: status, companyId, workflowId: String(body.id) });
  return json({ status: 'ok', workflow: data });
}

// ---- Prova a vuoto ------------------------------------------------------------

async function handleDryRun(sb: ServerClient, companyId: string, body: Body): Promise<Response> {
  const config = configFrom(body);
  const trigger = findTrigger(String(config.triggerType ?? ''));
  if (!trigger) return failure('BAD_REQUEST', 400);
  if (!body.entityId) return failure('BAD_REQUEST', 400);

  const result = await dryRun(sb, {
    companyId,
    name: String(body.name ?? ''),
    config,
    entityType: trigger.entityType,
    entityId: String(body.entityId),
    eventType: trigger.key,
  });
  return json({ status: 'ok', result });
}

async function handleSimulate(sb: ServerClient, companyId: string, body: Body): Promise<Response> {
  const config = configFrom(body);
  const trigger = findTrigger(String(config.triggerType ?? ''));
  if (!trigger) return failure('BAD_REQUEST', 400);

  const result = await simulateRecent(sb, {
    companyId, config, entityType: trigger.entityType, eventType: trigger.key,
    days: body.days ?? 30,
  });
  return json({ status: 'ok', result });
}

/**
 * Gli elementi recenti su cui si può provare la regola.
 *
 * ⚠️ SI LEGGONO CON IL JWT DELL'UTENTE, non con il service role (§123): la
 * prova deve poter essere fatta solo su ciò che quella persona può già vedere.
 * Non è teorico — è l'unico punto in cui un identificativo scelto da chi usa
 * l'app entra nel motore.
 */
async function handleSamples(
  sbUser: { from: (t: string) => any }, companyId: string, body: Body,
): Promise<Response> {
  const trigger = findTrigger(String(body.triggerType ?? ''));
  if (!trigger) return failure('BAD_REQUEST', 400);

  if (trigger.entityType === 'document') {
    const { data } = await sbUser.from('documents')
      .select('id, title, created_at').eq('company_id', companyId)
      .order('created_at', { ascending: false }).limit(15);
    return json({ status: 'ok', samples: (data ?? []).map(labelled('title')) });
  }
  if (trigger.entityType === 'email_message') {
    const { data } = await sbUser.from('email_messages')
      .select('id, subject, received_at').eq('company_id', companyId)
      .order('received_at', { ascending: false }).limit(15);
    return json({ status: 'ok', samples: (data ?? []).map(labelled('subject')) });
  }
  const { data } = await sbUser.from('tasks')
    .select('id, title, created_at').eq('company_id', companyId)
    .order('created_at', { ascending: false }).limit(15);
  return json({ status: 'ok', samples: (data ?? []).map(labelled('title')) });
}

/** Un elemento da mostrare in un menu. Il titolo può mancare: non si inventa. */
const labelled = (field: string) => (row: Record<string, unknown>) => ({
  id: String(row.id),
  label: typeof row[field] === 'string' && (row[field] as string).trim()
    ? (row[field] as string).slice(0, 120)
    : null,
});

// ---- Ritentativo manuale (§64) -------------------------------------------------

/**
 * ⚠️ IL RITENTATIVO PRESERVA L'IDEMPOTENZA, e sta tutto in due righe.
 *
 * Si rimette in coda l'EVENTO, non si crea una nuova esecuzione: il vincolo
 * unico (regola, evento) fa sì che il worker ritrovi quella di prima. Poi si
 * riportano a «da fare» le sole azioni FALLITE — quelle riuscite restano
 * riuscite e non vengono rifatte, quindi un ritentativo non può creare una
 * seconda attività (§135).
 */
async function handleRetry(
  sb: ServerClient, userId: string, companyId: string, body: Body,
): Promise<Response> {
  if (!body.runId) return failure('BAD_REQUEST', 400);

  const { data } = await sb.from('workflow_runs')
    .select('id, company_id, workflow_id, trigger_event_id, status')
    .eq('id', body.runId).eq('company_id', companyId).maybeSingle();
  if (!data) return failure('NOT_FOUND', 404);
  const run = data as {
    id: string; workflow_id: string; trigger_event_id: string | null; status: string;
  };
  if (!run.trigger_event_id) return failure('RUN_NOT_RETRYABLE', 409);
  if (run.status !== 'failed' && run.status !== 'partial') return failure('RUN_NOT_RETRYABLE', 409);

  await sb.from('workflow_action_runs')
    .update({ status: 'pending', error_code: null, completed_at: null })
    .eq('workflow_run_id', run.id).eq('status', 'failed');

  await sb.from('workflow_runs')
    .update({ status: 'pending', error_code: null, completed_at: null }).eq('id', run.id);

  await sb.from('automation_events').update({
    processing_status: 'pending', next_attempt_at: new Date().toISOString(),
    attempts: 0, locked_until: null, lock_id: null, error_code: null,
  }).eq('id', run.trigger_event_id).eq('company_id', companyId);

  // Un ritentativo è una decisione di una persona, e lo storico deve dire chi.
  await sb.from('workflow_events').insert({
    company_id: companyId, workflow_id: run.workflow_id, actor_user_id: userId,
    kind: 'retried', detail: { runId: run.id },
  });

  logEvent('automation-admin', { action: 'retry', companyId, runId: run.id });
  return json({ status: 'ok' });
}

/**
 * Il vincolo che il database ha rifiutato, come CODICE. Mai il messaggio
 * grezzo: contiene nomi di tabelle e di vincoli, che a chi legge non dicono
 * niente e a chi guarda dicono troppo (§50).
 */
function dbHint(error: unknown): string {
  const e = error as { message?: string; hint?: string } | null;
  const text = `${e?.message ?? ''} ${e?.hint ?? ''}`;
  if (text.includes('workflow_too_many_active')) return 'too_many_active';
  if (text.includes('workflow_no_actions')) return 'no_actions';
  if (text.includes('workflow_author_not_member') || text.includes('workflow_editor_not_member')) {
    return 'not_member';
  }
  if (text.includes('workflow_conditions_max')) return 'too_many_conditions';
  if (text.includes('workflow_actions_max')) return 'too_many_actions';
  return 'unknown';
}
