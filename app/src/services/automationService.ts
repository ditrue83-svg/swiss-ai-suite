// ============================================================================
// automationService — le Automazioni.
//
// LETTURA dal database: regole, esecuzioni, azioni, storico, metriche. La RLS
// filtra per azienda, e i permessi sono di sola SELECT — su nessuna di queste
// tabelle il browser può scrivere una riga.
//
// SCRITTURA: solo attraverso la Edge Function `automation-admin`. Non è una
// scelta di comodo: la validazione di una regola contro il registro (quali
// campi, quali operatori, quali azioni, quali segnaposto) vive in TypeScript, e
// il database non può ripeterla senza diventarne una seconda copia. Invece di
// duplicare l'elenco si è tolto il permesso — la stessa disciplina delle
// connessioni di posta (0013).
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { translate as tr } from '@/i18n';
import type { Database } from '@/types/database';
import type {
  AutomationEventType, AutomationSample, Workflow, WorkflowAction, WorkflowActionRun,
  WorkflowAuditEntry, WorkflowCondition, WorkflowConditionResult, WorkflowMetrics,
  WorkflowRun, WorkflowStatus,
} from '@/types/models';
import type { ValidationIssue } from '@/features/automations/registry';

type WorkflowRow = Database['public']['Tables']['workflow_definitions']['Row'];
type RunRow = Database['public']['Tables']['workflow_runs']['Row'];
type ActionRunRow = Database['public']['Tables']['workflow_action_runs']['Row'];
type AuditRow = Database['public']['Tables']['workflow_events']['Row'];

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

function toWorkflow(row: WorkflowRow): Workflow {
  return {
    id: row.id,
    companyId: row.company_id,
    name: row.name,
    description: row.description,
    status: row.status,
    triggerType: row.trigger_type,
    conditionMatch: row.condition_match === 'any' ? 'any' : 'all',
    conditions: asArray<WorkflowCondition>(row.conditions),
    actions: asArray<WorkflowAction>(row.actions),
    version: row.version,
    activatedAt: row.activated_at,
    attentionCode: row.attention_code,
    attentionAt: row.attention_at,
    consecutiveFailures: row.consecutive_failures,
    lastRunAt: row.last_run_at,
    lastRunStatus: row.last_run_status,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toRun(row: RunRow): WorkflowRun {
  const snapshot = (row.config_snapshot ?? {}) as WorkflowRun['configSnapshot'];
  return {
    id: row.id,
    companyId: row.company_id,
    workflowId: row.workflow_id,
    workflowVersion: row.workflow_version,
    configSnapshot: typeof snapshot === 'object' && snapshot !== null ? snapshot : {},
    triggerEventId: row.trigger_event_id,
    entityType: (row.entity_type as WorkflowRun['entityType']) ?? null,
    entityId: row.entity_id,
    status: row.status,
    conditionResults: asArray<WorkflowConditionResult>(row.condition_results),
    startedAt: row.started_at,
    completedAt: row.completed_at,
    durationMs: row.duration_ms,
    errorCode: row.error_code,
  };
}

const WORKFLOW_COLUMNS =
  'id, company_id, name, description, status, trigger_type, condition_match, conditions, actions, '
  + 'version, activated_at, attention_code, attention_at, consecutive_failures, last_run_at, '
  + 'last_run_status, created_by, updated_by, created_at, updated_at, archived_at, archived_by';

const RUN_COLUMNS =
  'id, company_id, workflow_id, workflow_version, config_snapshot, trigger_event_id, '
  + 'entity_type, entity_id, status, condition_results, started_at, completed_at, duration_ms, '
  + 'error_code, created_at';

/** Il corpo di una regola, come lo compone il generatore. */
export interface WorkflowDraft {
  id?: string;
  name: string;
  description?: string | null;
  triggerType: AutomationEventType;
  conditionMatch: 'all' | 'any';
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
}

/** L'esito di una prova a vuoto (§51/§53). Nessuna scrittura, da nessuna parte. */
export interface DryRunResult {
  found: boolean;
  matched: boolean;
  evaluable: boolean;
  conditions: WorkflowConditionResult[];
  actions: {
    key: string;
    outcome: 'ready' | 'skip';
    errorCode?: string;
    preview: Record<string, string | number | boolean | null>;
  }[];
  referenceProblems: { code: string; actionIndex: number }[];
  validation: ValidationIssue[];
}

export interface SimulationResult {
  examined: number;
  matched: number;
  notEvaluable: number;
  limit: number;
  days: number;
}

/** Un errore della Edge Function, con il codice e — se c'è — cosa non va. */
export class AutomationError extends AppError {
  code: string;
  issues?: ValidationIssue[];
  problems?: { code: string; actionIndex: number }[];
  constructor(code: string, message: string, extra?: {
    issues?: ValidationIssue[]; problems?: { code: string; actionIndex: number }[];
  }) {
    super(message);
    this.code = code;
    this.issues = extra?.issues;
    this.problems = extra?.problems;
  }
}

/**
 * Chiama la Edge Function e traduce il CODICE che risponde.
 *
 * La funzione non manda mai frasi: manda codici, perché la frase va letta nella
 * lingua di chi usa l'app e il server non ne ha una.
 */
async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await requireSupabase().functions.invoke(name, { body });
  if (error) {
    const context = (error as { context?: Response }).context;
    let payload: { code?: string; issues?: ValidationIssue[]; detail?: string;
      problems?: { code: string; actionIndex: number }[] } | null = null;
    if (context && typeof context.json === 'function') {
      payload = await context.json().catch(() => null);
    }
    const code = payload?.code ?? 'UNKNOWN';
    throw new AutomationError(code, automationErrorMessage(code, payload?.detail), {
      issues: payload?.issues, problems: payload?.problems,
    });
  }
  return data as T;
}

/**
 * Il messaggio per un codice. Un codice fuori dall'elenco NON viene mostrato
 * grezzo: diventa il messaggio generico, che è la verità (§50).
 */
export function automationErrorMessage(code: string, detail?: string): string {
  if (code === 'FORBIDDEN') return tr('automations.errors.forbidden');
  if (code === 'INVALID_CONFIG') return tr('automations.errors.invalidConfig');
  if (code === 'INVALID_REFERENCES') return tr('automations.errors.invalidReferences');
  if (code === 'RUN_NOT_RETRYABLE') return tr('automations.errors.notRetryable');
  if (code === 'NOT_FOUND') return tr('automations.errors.notFound');
  if (code === 'CONFIG_MISSING') return tr('automations.errors.notConfigured');
  if (code === 'SAVE_FAILED') {
    if (detail === 'too_many_active') return tr('automations.errors.tooManyActive');
    if (detail === 'no_actions') return tr('automations.errors.noActions');
    if (detail === 'not_member') return tr('automations.errors.notMember');
    if (detail === 'too_many_conditions') return tr('automations.errors.tooManyConditions');
    if (detail === 'too_many_actions') return tr('automations.errors.tooManyActions');
  }
  return tr('errors.generic');
}

export const automationService = {
  /** Le regole dell'azienda. Le archiviate solo se richieste esplicitamente. */
  async list(companyId: string, includeArchived = false): Promise<Workflow[]> {
    let query = requireSupabase().from('workflow_definitions')
      .select(WORKFLOW_COLUMNS).eq('company_id', companyId);
    if (!includeArchived) query = query.neq('status', 'archived');
    const { data, error } = await query.order('created_at', { ascending: false });
    if (error) throw new AppError(toUserMessage(error), error);
    return ((data ?? []) as unknown as WorkflowRow[]).map(toWorkflow);
  },

  async get(id: string): Promise<Workflow | null> {
    const { data, error } = await requireSupabase().from('workflow_definitions')
      .select(WORKFLOW_COLUMNS).eq('id', id).maybeSingle();
    if (error) throw new AppError(toUserMessage(error), error);
    return data ? toWorkflow(data as unknown as WorkflowRow) : null;
  },

  /** Le ultime esecuzioni di una regola. */
  async runs(workflowId: string, limit = 20): Promise<WorkflowRun[]> {
    const { data, error } = await requireSupabase().from('workflow_runs')
      .select(RUN_COLUMNS).eq('workflow_id', workflowId)
      .order('started_at', { ascending: false }).limit(limit);
    if (error) throw new AppError(toUserMessage(error), error);
    return ((data ?? []) as unknown as RunRow[]).map(toRun);
  },

  async run(runId: string): Promise<WorkflowRun | null> {
    const { data, error } = await requireSupabase().from('workflow_runs')
      .select(RUN_COLUMNS).eq('id', runId).maybeSingle();
    if (error) throw new AppError(toUserMessage(error), error);
    return data ? toRun(data as unknown as RunRow) : null;
  },

  async actionRuns(runId: string): Promise<WorkflowActionRun[]> {
    const { data, error } = await requireSupabase().from('workflow_action_runs')
      .select('id, company_id, workflow_run_id, action_key, action_position, status, '
        + 'idempotency_key, output_entity_type, output_entity_id, error_code, '
        + 'started_at, completed_at, created_at')
      .eq('workflow_run_id', runId).order('action_position', { ascending: true });
    if (error) throw new AppError(toUserMessage(error), error);
    return ((data ?? []) as unknown as ActionRunRow[]).map((r) => ({
      id: r.id,
      workflowRunId: r.workflow_run_id,
      actionKey: r.action_key,
      actionPosition: r.action_position,
      status: r.status,
      outputEntityType: r.output_entity_type,
      outputEntityId: r.output_entity_id,
      errorCode: r.error_code,
      completedAt: r.completed_at,
    }));
  },

  /** Lo storico dei gesti sulle regole. Solo amministratori (RLS). */
  async audit(workflowId: string, limit = 20): Promise<WorkflowAuditEntry[]> {
    const { data, error } = await requireSupabase().from('workflow_events')
      .select('id, company_id, workflow_id, actor_user_id, kind, detail, created_at')
      .eq('workflow_id', workflowId)
      .order('created_at', { ascending: false }).limit(limit);
    if (error) throw new AppError(toUserMessage(error), error);
    return ((data ?? []) as unknown as AuditRow[]).map((r) => ({
      id: r.id,
      workflowId: r.workflow_id,
      actorUserId: r.actor_user_id,
      kind: r.kind,
      detail: (r.detail ?? {}) as Record<string, unknown>,
      createdAt: r.created_at,
    }));
  },

  async metrics(workflowId: string, days = 30): Promise<WorkflowMetrics> {
    const { data, error } = await requireSupabase()
      .rpc('workflow_metrics', { p_workflow_id: workflowId, p_days: days });
    if (error) throw new AppError(toUserMessage(error), error);
    const row = ((data ?? []) as { runs: number; actions_done: number; actions_failed: number; errors: number }[])[0];
    return {
      runs: Number(row?.runs ?? 0),
      actionsDone: Number(row?.actions_done ?? 0),
      actionsFailed: Number(row?.actions_failed ?? 0),
      errors: Number(row?.errors ?? 0),
    };
  },

  /**
   * Lo stato della coda del motore (§169).
   *
   * Se il worker non gira, l'età dell'evento più vecchio cresce: è la misura
   * che permette di ACCORGERSENE invece di scoprirlo perché «le automazioni non
   * fanno più niente». Solo amministratori.
   */
  async backlog(companyId: string): Promise<{ pending: number; deadLetter: number; oldestSeconds: number }> {
    const { data, error } = await requireSupabase()
      .rpc('automation_backlog', { p_company_id: companyId });
    if (error) throw new AppError(toUserMessage(error), error);
    const row = ((data ?? []) as { pending: number; dead_letter: number; oldest_pending_seconds: number }[])[0];
    return {
      pending: Number(row?.pending ?? 0),
      deadLetter: Number(row?.dead_letter ?? 0),
      oldestSeconds: Number(row?.oldest_pending_seconds ?? 0),
    };
  },

  // ---- Scrittura: passa sempre dalla Edge Function --------------------------

  async save(companyId: string, draft: WorkflowDraft): Promise<{ id: string; version: number; status: WorkflowStatus }> {
    const out = await invoke<{ workflow: { id: string; version: number; status: WorkflowStatus } }>(
      'automation-admin',
      {
        action: 'save', companyId, id: draft.id, name: draft.name,
        description: draft.description ?? null,
        triggerType: draft.triggerType, conditionMatch: draft.conditionMatch,
        conditions: draft.conditions, actions: draft.actions,
      },
    );
    return out.workflow;
  },

  async setStatus(
    companyId: string, id: string, action: 'activate' | 'pause' | 'archive' | 'restore',
  ): Promise<void> {
    await invoke('automation-admin', { action, companyId, id });
  },

  /** Prova a vuoto: mostra cosa succederebbe, senza far succedere niente. */
  async dryRun(companyId: string, draft: WorkflowDraft, entityId: string): Promise<DryRunResult> {
    const out = await invoke<{ result: DryRunResult }>('automation-admin', {
      action: 'dryRun', companyId, entityId, name: draft.name,
      triggerType: draft.triggerType, conditionMatch: draft.conditionMatch,
      conditions: draft.conditions, actions: draft.actions,
    });
    return out.result;
  },

  /** «Negli ultimi N giorni avrebbe corrisposto a X elementi» (§165). */
  async simulate(companyId: string, draft: WorkflowDraft, days = 30): Promise<SimulationResult> {
    const out = await invoke<{ result: SimulationResult }>('automation-admin', {
      action: 'simulate', companyId, days,
      triggerType: draft.triggerType, conditionMatch: draft.conditionMatch,
      conditions: draft.conditions, actions: draft.actions,
    });
    return out.result;
  },

  /** Gli elementi recenti su cui provare. Letti con i permessi di chi chiede. */
  async samples(companyId: string, triggerType: AutomationEventType): Promise<AutomationSample[]> {
    const out = await invoke<{ samples: AutomationSample[] }>('automation-admin', {
      action: 'samples', companyId, triggerType,
    });
    return out.samples ?? [];
  },

  /** Ritenta un'esecuzione fallita, senza rifare ciò che era già riuscito (§64). */
  async retryRun(companyId: string, runId: string): Promise<void> {
    await invoke('automation-admin', { action: 'retryRun', companyId, runId });
  },
};
