// ============================================================================
// taskChecklistService — i passaggi operativi di un'attività.
//
// ⚠️ NON è `action_progress`, e vale la pena tenerlo a mente.
//   · `action_progress` sono le azioni ESTRATTE dall'analisi di un documento:
//     appartengono all'analisi, che è immutabile, e dicono cosa il documento
//     chiede. Non si aggiungono e non si riscrivono.
//   · Le voci di checklist sono i passaggi che una persona decide per portare
//     a termine un'attività. Si aggiungono, si riordinano, si cancellano.
// Quando un'azione suggerita diventa attività ne usa il testo per titolo e
// descrizione: non si travasa in checklist, o gli stessi dati vivrebbero in due
// posti con due cicli di vita diversi.
//
// «Chi ha spuntato e quando» lo scrive il trigger `checklist_guard`: qui non si
// manda, perché verrebbe comunque sovrascritto.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError } from '@/lib/errors';
import { taskErrorMessage } from './taskService';
import type { TaskChecklistItem } from '@/types/models';
import type { Database } from '@/types/database';

type Row = Database['public']['Tables']['task_checklist_items']['Row'];

function toItem(row: Row): TaskChecklistItem {
  return {
    id: row.id,
    companyId: row.company_id,
    taskId: row.task_id,
    text: row.text,
    position: row.position,
    done: row.done,
    doneAt: row.done_at,
    doneBy: row.done_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const taskChecklistService = {
  async list(taskId: string): Promise<TaskChecklistItem[]> {
    const { data, error } = await requireSupabase()
      .from('task_checklist_items')
      .select('*')
      .eq('task_id', taskId)
      .order('position', { ascending: true })
      .order('created_at', { ascending: true });
    if (error) throw new AppError(taskErrorMessage(error), error);
    return (data ?? []).map(toItem);
  },

  /**
   * Aggiunge in fondo. La posizione la calcola il chiamante passando quante
   * voci ci sono già: è un dato che la schermata ha sotto mano, e chiederlo al
   * database costerebbe una query per ogni riga aggiunta.
   */
  async add(input: { companyId: string; taskId: string; text: string; position: number }): Promise<TaskChecklistItem> {
    const { data, error } = await requireSupabase()
      .from('task_checklist_items')
      .insert({
        company_id: input.companyId,
        task_id: input.taskId,
        text: input.text.trim(),
        position: input.position,
      })
      .select('*')
      .single();
    if (error || !data) throw new AppError(taskErrorMessage(error), error);
    return toItem(data);
  },

  async setDone(id: string, done: boolean): Promise<TaskChecklistItem> {
    const { data, error } = await requireSupabase()
      .from('task_checklist_items').update({ done }).eq('id', id).select('*').single();
    if (error || !data) throw new AppError(taskErrorMessage(error), error);
    return toItem(data);
  },

  async setText(id: string, text: string): Promise<TaskChecklistItem> {
    const { data, error } = await requireSupabase()
      .from('task_checklist_items').update({ text: text.trim() }).eq('id', id).select('*').single();
    if (error || !data) throw new AppError(taskErrorMessage(error), error);
    return toItem(data);
  },

  async remove(id: string): Promise<void> {
    const { error } = await requireSupabase().from('task_checklist_items').delete().eq('id', id);
    if (error) throw new AppError(taskErrorMessage(error), error);
  },

  /**
   * Sposta una voce di un posto. Due aggiornamenti e non un drag-and-drop: il
   * riordino serve di rado su liste di cinque voci, e una libreria di trascinamento
   * costerebbe più di quanto renda — con il peso di un pacchetto in più su ogni
   * caricamento dell'applicazione.
   */
  async swapPositions(a: TaskChecklistItem, b: TaskChecklistItem): Promise<void> {
    const sb = requireSupabase();
    const { error: e1 } = await sb.from('task_checklist_items').update({ position: b.position }).eq('id', a.id);
    if (e1) throw new AppError(taskErrorMessage(e1), e1);
    const { error: e2 } = await sb.from('task_checklist_items').update({ position: a.position }).eq('id', b.id);
    if (e2) throw new AppError(taskErrorMessage(e2), e2);
  },
};
