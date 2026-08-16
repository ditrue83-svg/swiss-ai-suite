// ============================================================================
// calendarService — il modello di LETTURA del calendario interno.
//
// Non c'è nessuna scrittura qui dentro, e non è una dimenticanza: il calendario
// non possiede niente. Le attività si creano e si modificano da `taskService`,
// che è la stessa strada che usa la schermata Attività. Un secondo percorso di
// creazione avrebbe significato due posti in cui ricordarsi della priorità
// proposta, dei passaggi derivati dall'analisi e delle garanzie del trigger.
//
// L'intervallo lo interroga il DATABASE (`calendar_tasks`), non il browser
// filtrando una lista intera: con mille attività, disegnare marzo scaricando
// tutto per tenerne trenta è un'applicazione che si ferma (§23).
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError } from '@/lib/errors';
import { taskErrorMessage } from './taskService';
import type { CalendarTaskItem, TaskPriority, TaskStatus } from '@/types/models';

export interface CalendarRangeFilters {
  /** `true` = solo le mie. È il valore predefinito della schermata (§18). */
  mine?: boolean;
  status?: TaskStatus | null;
  priority?: TaskPriority | null;
  assigneeUserId?: string | null;
  /**
   * Le scadute entrano anche se cadono fuori dall'intervallo. Un'attività in
   * ritardo non smette di esserlo perché si è girata pagina al mese (§20).
   */
  includeOverdue?: boolean;
  limit?: number;
}

interface CalendarRow {
  id: string;
  title: string;
  due_date: string;
  priority: TaskPriority;
  status: TaskStatus;
  source: CalendarTaskItem['source'];
  assignee_user_id: string | null;
  assignee_name: string | null;
  document_id: string | null;
  appointment_date: string | null;
  on_date: string;
  date_kind: string;
}

const toItem = (r: CalendarRow): CalendarTaskItem => ({
  id: r.id,
  title: r.title,
  dueDate: r.due_date,
  appointmentDate: r.appointment_date ?? null,
  // ⚠️ `on_date` e `date_kind` arrivano dal database e non si ricalcolano qui:
  // la stessa attività può tornare due volte, e da fuori non si saprebbe quale
  // delle due righe è il termine e quale l'appuntamento (0042).
  onDate: r.on_date,
  dateKind: r.date_kind === 'appointment' ? 'appointment' : 'deadline',
  priority: r.priority,
  status: r.status,
  source: r.source,
  assigneeUserId: r.assignee_user_id,
  assigneeName: r.assignee_name,
  documentId: r.document_id,
});

export const calendarService = {
  /** Le attività con scadenza in `[from, to]`, più le scadute pertinenti. */
  async range(
    companyId: string, from: string, to: string, filters: CalendarRangeFilters = {},
  ): Promise<CalendarTaskItem[]> {
    const { data, error } = await requireSupabase().rpc('calendar_tasks', {
      p_company_id: companyId,
      p_from: from,
      p_to: to,
      p_mine: filters.mine ?? true,
      p_status: filters.status ?? null,
      p_priority: filters.priority ?? null,
      p_assignee: filters.assigneeUserId ?? null,
      p_include_overdue: filters.includeOverdue ?? true,
      p_limit: filters.limit ?? 500,
    });
    if (error) throw new AppError(taskErrorMessage(error), error);
    return ((data ?? []) as CalendarRow[]).map(toItem);
  },

  /**
   * Quante attività aperte non hanno scadenza (§21).
   *
   * Si mostra il numero e si rimanda ad Attività. Non si inventa una data per
   * farle stare in una casella: una scadenza inventata è esattamente il tipo di
   * dato che questo prodotto non produce.
   */
  async undatedCount(companyId: string, mine: boolean): Promise<number> {
    const { data, error } = await requireSupabase().rpc('calendar_undated_count', {
      p_company_id: companyId, p_mine: mine,
    });
    if (error) throw new AppError(taskErrorMessage(error), error);
    return typeof data === 'number' ? data : 0;
  },
};
