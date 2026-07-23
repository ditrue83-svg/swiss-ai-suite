// ============================================================================
// taskService — Scadenziario. Sostituisce il localStorage con la tabella tasks.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import type { Task, TaskPriority, TaskSource, TaskStatus } from '@/types/models';
import type { Database } from '@/types/database';

type TaskRow = Database['public']['Tables']['tasks']['Row'];

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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

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
}

/** Priorità derivata dalla distanza in giorni (come nel prototipo). */
export function priorityFromDueDate(dueDate: string | null | undefined): TaskPriority {
  if (!dueDate) return 'low';
  const days = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86400000);
  if (days <= 10) return 'high';
  if (days <= 30) return 'medium';
  return 'low';
}

export const taskService = {
  async list(companyId: string): Promise<Task[]> {
    const { data, error } = await requireSupabase()
      .from('tasks')
      .select('*')
      .eq('company_id', companyId)
      .order('due_date', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });
    if (error) throw new AppError(toUserMessage(error), error);
    return (data ?? []).map(toTask);
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
    };
    const { data, error } = await requireSupabase().from('tasks').insert(payload).select('*').single();
    if (error || !data) throw new AppError(toUserMessage(error), error);
    return toTask(data);
  },

  async setStatus(id: string, status: TaskStatus): Promise<void> {
    const { error } = await requireSupabase().from('tasks').update({ status }).eq('id', id);
    if (error) throw new AppError(toUserMessage(error), error);
  },

  async remove(id: string): Promise<void> {
    const { error } = await requireSupabase().from('tasks').delete().eq('id', id);
    if (error) throw new AppError(toUserMessage(error), error);
  },
};
