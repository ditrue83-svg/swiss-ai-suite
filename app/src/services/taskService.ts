// ============================================================================
// taskService — le Attività (Work Hub).
//
// È il punto in cui ciò che AI-Swisse ha capito diventa lavoro assegnato e
// concluso. Rispetto allo Scadenziario da cui deriva cambia soprattutto una
// cosa: le garanzie non stanno più qui, stanno nel database.
//
//   · chi ha completato e quando  → trigger `tasks_guard`
//   · assegnatario membro dell'azienda → trigger `tasks_guard`
//   · storico delle modifiche     → trigger `tasks_record_events`
//
// Questo service quindi NON manda `completed_at`, `completed_by` né
// `archived_by`: sarebbero ignorati, e mandarli darebbe l'impressione che sia
// il browser a decidere.
//
// La lista passa dalla funzione `list_tasks`, che filtra, ordina e pagina nel
// database: l'ordine «prima le scadute, poi la priorità, poi la scadenza più
// vicina» non è esprimibile con una sequenza di colonne, e ordinare in memoria
// obbligherebbe a scaricare tutte le attività per sapere quali contano.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { translate as tr } from '@/i18n';
import { priorityFromDueDate } from '@/features/tasks/taskFormat';
import type { Task, TaskPriority, TaskSource, TaskStatus, TaskWithPeople } from '@/types/models';
import type { Database } from '@/types/database';

type TaskRow = Database['public']['Tables']['tasks']['Row'];

/** Le viste della lista. Sono cinque perché rispondono a cinque domande diverse. */
export type TaskView = 'todo' | 'mine' | 'overdue' | 'completed' | 'archived' | 'all';

export interface TaskFilters {
  view?: TaskView;
  status?: TaskStatus | null;
  priority?: TaskPriority | null;
  source?: TaskSource | null;
  assigneeUserId?: string | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export interface TaskPage {
  items: TaskWithPeople[];
  /** Quante attività soddisfano il filtro, non quante ne sono state consegnate. */
  total: number;
}

function toTask(row: TaskRow): Task {
  return {
    id: row.id,
    companyId: row.company_id,
    createdBy: row.created_by,
    documentId: row.document_id,
    subsidyCaseId: row.subsidy_case_id,
    title: row.title,
    description: row.description,
    authority: row.authority,
    dueDate: row.due_date,
    priority: row.priority,
    status: row.status,
    source: row.source,
    assigneeUserId: row.assignee_user_id,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    archivedAt: row.archived_at,
    archivedBy: row.archived_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    // 0020 — l'esecuzione che l'ha creata, se è nata da una regola.
    workflowRunId: row.workflow_run_id ?? null,
  };
}

type ListRow = TaskRow & {
  assignee_name: string | null;
  email_message_id: string | null;
  total_count: number;
};

export interface CreateTaskInput {
  companyId: string;
  userId: string;
  title: string;
  authority?: string | null;
  description?: string | null;
  dueDate?: string | null;         // YYYY-MM-DD
  priority?: TaskPriority;
  source?: TaskSource;
  documentId?: string | null;
  subsidyCaseId?: string | null;
  assigneeUserId?: string | null;
  /**
   * 0026 — la controparte e la trattativa a cui l'attività si riferisce.
   * Facoltative: un'attività interna non ne ha nessuna.
   *
   * ⚠️ Il guardiano `tasks_crm_guard` verifica che appartengano alla stessa
   * azienda e, se si passa la sola opportunità, RICAVA l'organizzazione da
   * essa. Passarle entrambe incoerenti viene RIFIUTATO, non corretto in
   * silenzio: due valori che dicono cose diverse sulla stessa riga.
   */
  crmOrganizationId?: string | null;
  crmOpportunityId?: string | null;
}

export interface UpdateTaskInput {
  title?: string;
  description?: string | null;
  authority?: string | null;
  dueDate?: string | null;
  priority?: TaskPriority;
  status?: TaskStatus;
  assigneeUserId?: string | null;
}

/**
 * Priorità PROPOSTA a partire dalla scadenza.
 *
 * Resta un default iniziale e nient'altro: una fattura fra venti giorni può
 * essere importante e un'informazione di domani può non esserlo. Chi crea
 * l'attività può sempre scegliere diversamente, e da quel momento la scelta
 * della persona non viene più sovrascritta.
 *
 * ⚠️ L'IMPLEMENTAZIONE VIVE IN `features/tasks/taskFormat`, e questa riga la
 * riesporta soltanto. La ragione è che un servizio importa il client Supabase e
 * quindi non è caricabile da uno script di prova: lasciata qui, questa regola
 * non si sarebbe potuta provare senza database. Stessa scelta già fatta da
 * `notificationService` con `preferencesDefaults`. Riscriverla nel modulo di
 * creazione avrebbe prodotto due tabelle di soglie destinate a divergere.
 */
export { priorityFromDueDate };

/**
 * Messaggi comprensibili per i guasti che questo dominio può produrre davvero.
 * Un `23514` con dentro `assignee_not_member` non è un errore di sistema: è una
 * persona che nel frattempo è uscita dall'azienda, e va detto così.
 */
export function taskErrorMessage(error: unknown): string {
  const raw = error as { message?: string; code?: string; hint?: string } | null;
  const text = `${raw?.message ?? ''} ${raw?.hint ?? ''}`;
  if (text.includes('assignee_not_member')) return tr('tasks.errors.assigneeNotMember');
  if (text.includes('checklist_company_mismatch') || text.includes('comment_company_mismatch')) {
    return tr('tasks.errors.wrongCompany');
  }
  // 0026 — le guardie del collegamento al CRM. `task_crm_opportunity_organization_mismatch`
  // ha un messaggio PROPRIO perché la causa è diversa da un problema di azienda:
  // l'opportunità scelta appartiene a un'altra controparte, e chi lo legge deve
  // sapere che il rimedio è cambiare la scelta, non i permessi.
  if (text.includes('task_crm_opportunity_organization_mismatch')) {
    return tr('crm.errors.organizationMismatch');
  }
  if (text.includes('task_crm_company_mismatch')
    || text.includes('task_crm_opportunity_company_mismatch')) {
    return tr('crm.errors.companyMismatch');
  }
  return toUserMessage(error);
}

export const taskService = {
  /** Una pagina di attività, già filtrata e ordinata dal database. */
  async list(companyId: string, filters: TaskFilters = {}): Promise<TaskPage> {
    const { data, error } = await requireSupabase().rpc('list_tasks', {
      p_company_id: companyId,
      p_view: filters.view ?? 'todo',
      p_status: filters.status ?? null,
      p_priority: filters.priority ?? null,
      p_source: filters.source ?? null,
      p_assignee: filters.assigneeUserId ?? null,
      p_search: filters.search ?? null,
      p_limit: filters.limit ?? 25,
      p_offset: filters.offset ?? 0,
    });
    if (error) throw new AppError(taskErrorMessage(error), error);
    const rows = (data ?? []) as ListRow[];
    return {
      items: rows.map((r) => ({
        ...toTask(r),
        assigneeName: r.assignee_name,
        emailMessageId: r.email_message_id,
      })),
      // `total_count` è uguale su ogni riga (window function); senza righe è zero.
      total: rows.length ? Number(rows[0].total_count) : 0,
    };
  },

  async get(id: string): Promise<Task | null> {
    const { data, error } = await requireSupabase().from('tasks').select('*').eq('id', id).maybeSingle();
    if (error) throw new AppError(taskErrorMessage(error), error);
    return data ? toTask(data) : null;
  },

  async create(input: CreateTaskInput): Promise<Task> {
    const payload: Database['public']['Tables']['tasks']['Insert'] = {
      company_id: input.companyId,
      created_by: input.userId,
      title: input.title.trim(),
      authority: input.authority ?? null,
      description: input.description ?? null,
      due_date: input.dueDate ?? null,
      priority: input.priority ?? priorityFromDueDate(input.dueDate),
      status: 'open',
      source: input.source ?? 'manual',
      document_id: input.documentId ?? null,
      subsidy_case_id: input.subsidyCaseId ?? null,
      assignee_user_id: input.assigneeUserId ?? null,
      crm_organization_id: input.crmOrganizationId ?? null,
      crm_opportunity_id: input.crmOpportunityId ?? null,
    };
    const { data, error } = await requireSupabase().from('tasks').insert(payload).select('*').single();
    if (error || !data) throw new AppError(taskErrorMessage(error), error);
    return toTask(data);
  },

  /** Modifica: si cambia ciò che si vuole, senza cancellare e ricreare. */
  async update(id: string, input: UpdateTaskInput): Promise<Task> {
    const patch: Database['public']['Tables']['tasks']['Update'] = {};
    if (input.title !== undefined) patch.title = input.title.trim();
    if (input.description !== undefined) patch.description = input.description;
    if (input.authority !== undefined) patch.authority = input.authority;
    if (input.dueDate !== undefined) patch.due_date = input.dueDate;
    if (input.priority !== undefined) patch.priority = input.priority;
    if (input.status !== undefined) patch.status = input.status;
    if (input.assigneeUserId !== undefined) patch.assignee_user_id = input.assigneeUserId;

    const { data, error } = await requireSupabase()
      .from('tasks').update(patch).eq('id', id).select('*').single();
    if (error || !data) throw new AppError(taskErrorMessage(error), error);
    return toTask(data);
  },

  async setStatus(id: string, status: TaskStatus): Promise<Task> {
    return await taskService.update(id, { status });
  },

  async assign(id: string, assigneeUserId: string | null): Promise<Task> {
    return await taskService.update(id, { assigneeUserId });
  },

  /**
   * Archivia invece di cancellare. Il lavoro fatto resta consultabile: su un
   * prodotto B2B far sparire un'attività con un clic significa perdere la
   * traccia di una decisione, e nessuno se ne accorge finché non serve.
   * Il timbro (quando, da chi) lo mette il trigger.
   */
  async archive(id: string): Promise<Task> {
    const { data, error } = await requireSupabase()
      .from('tasks').update({ archived_at: new Date().toISOString() }).eq('id', id).select('*').single();
    if (error || !data) throw new AppError(taskErrorMessage(error), error);
    return toTask(data);
  },

  async restore(id: string): Promise<Task> {
    const { data, error } = await requireSupabase()
      .from('tasks').update({ archived_at: null }).eq('id', id).select('*').single();
    if (error || !data) throw new AppError(taskErrorMessage(error), error);
    return toTask(data);
  },
};
