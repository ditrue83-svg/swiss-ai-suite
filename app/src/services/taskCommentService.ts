// ============================================================================
// taskCommentService — la conversazione attorno a un'attività.
//
// Testo semplice, mai markup. Il corpo di un commento non viene interpretato
// né qui né al render: non esiste HTML da sanificare perché non esiste HTML.
// È la stessa scelta fatta per il corpo delle email, e ha lo stesso effetto —
// il bug «mi sono dimenticato di sanificare» non può accadere.
//
// L'AUTORE non è un parametro: la policy `comments_insert_author` accetta la
// riga solo se `author_user_id = auth.uid()`, e il trigger lo riscrive
// comunque. Nessuno può firmare un commento a nome di un collega, e non perché
// il servizio si comporti bene.
//
// I nomi degli autori arrivano dalla rubrica dei membri (`memberService`),
// perché `profiles` è leggibile solo dal proprietario: senza quella, la
// conversazione mostrerebbe identificativi al posto delle persone.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError } from '@/lib/errors';
import { taskErrorMessage } from './taskService';
import type { TaskComment, TaskEvent } from '@/types/models';
import type { Database } from '@/types/database';

type CommentRow = Database['public']['Tables']['task_comments']['Row'];
type EventRow = Database['public']['Tables']['task_events']['Row'];

/** Quanti commenti si caricano per volta: una conversazione, non una chat. */
export const COMMENT_PAGE_SIZE = 30;

export const taskCommentService = {
  /**
   * Gli ultimi commenti, dal più recente. La schermata li mostra in ordine
   * cronologico: si inverte lì, dove è una scelta di lettura.
   */
  async list(taskId: string, limit = COMMENT_PAGE_SIZE): Promise<TaskComment[]> {
    const { data, error } = await requireSupabase()
      .from('task_comments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new AppError(taskErrorMessage(error), error);
    return ((data ?? []) as CommentRow[]).map((row) => ({
      id: row.id,
      companyId: row.company_id,
      taskId: row.task_id,
      authorUserId: row.author_user_id,
      authorName: null,           // lo risolve la schermata con la rubrica
      body: row.body,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  },

  async add(input: { companyId: string; taskId: string; authorUserId: string; body: string }): Promise<TaskComment> {
    const { data, error } = await requireSupabase()
      .from('task_comments')
      .insert({
        company_id: input.companyId,
        task_id: input.taskId,
        // Deve combaciare con `auth.uid()`, altrimenti la policy rifiuta la riga:
        // non è un valore di comodo, è il controllo stesso.
        author_user_id: input.authorUserId,
        body: input.body.trim(),
      })
      .select('*')
      .single();
    if (error || !data) throw new AppError(taskErrorMessage(error), error);
    return {
      id: data.id,
      companyId: data.company_id,
      taskId: data.task_id,
      authorUserId: data.author_user_id,
      authorName: null,
      body: data.body,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },
};

export const taskEventService = {
  /**
   * Lo storico di un'attività. In sola lettura per costruzione: le righe le
   * scrivono i trigger e il client non ha il permesso di inserirle — un
   * registro che l'interessato può riscrivere non è un registro.
   */
  async list(taskId: string, limit = 40): Promise<TaskEvent[]> {
    const { data, error } = await requireSupabase()
      .from('task_events')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new AppError(taskErrorMessage(error), error);
    return ((data ?? []) as EventRow[]).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      actorUserId: row.actor_user_id,
      actorName: null,
      kind: row.kind,
      detail: (row.detail ?? {}) as Record<string, unknown>,
      createdAt: row.created_at,
    }));
  },
};
