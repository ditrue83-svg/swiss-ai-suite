// ============================================================================
// actionProgressService — stato della checklist delle azioni.
//
// Perché esiste (0010): spuntare un'azione è un fatto dell'UTENTE, non
// dell'analisi. Finché il "done" viveva dentro document_analyses.actions, ogni
// membro doveva poter aggiornare l'intera riga dell'analisi — e quindi anche
// scadenza, mittente e importi. Lo stato sta qui, lo snapshot resta immutabile.
//
// Il done non si legge più dallo snapshot (dove è sempre false): la fonte di
// verità è questa tabella. Le spunte storiche sono state importate dalla 0010.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import type { ChecklistAction } from '@/types/models';

export interface ActionProgress {
  actionIndex: number;
  done: boolean;
  /** null per le spunte importate dalla 0010: autore reale ignoto, non inventato. */
  doneBy: string | null;
  /** null per le spunte importate dalla 0010: momento reale ignoto. */
  doneAt: string | null;
}

export const actionProgressService = {
  /** Progresso di un'analisi, indicizzato per posizione dell'azione. */
  async forAnalysis(analysisId: string): Promise<Map<number, ActionProgress>> {
    const { data, error } = await requireSupabase()
      .from('action_progress')
      .select('action_index, done, done_by, done_at')
      .eq('analysis_id', analysisId);
    if (error) throw new AppError(toUserMessage(error), error);
    const out = new Map<number, ActionProgress>();
    for (const r of data ?? []) {
      out.set(r.action_index, {
        actionIndex: r.action_index,
        done: r.done,
        doneBy: r.done_by,
        doneAt: r.done_at,
      });
    }
    return out;
  },

  /**
   * Applica il progresso alle azioni dello snapshot. Lo snapshot porta il testo
   * e l'evidenza, questa tabella porta il "fatto".
   */
  merge(actions: ChecklistAction[], progress: Map<number, ActionProgress>): ChecklistAction[] {
    return actions.map((a) => ({ ...a, done: progress.get(a.id)?.done ?? false }));
  },

  /**
   * Spunta o despunta una singola azione. `actionText` è una copia diagnostica
   * del testo al momento della spunta: non viene riletta per mostrare la
   * checklist, serve a poter dimostrare che l'indice punta ancora alla stessa
   * azione dello snapshot.
   *
   * `done_by`/`done_at` non vengono inviati: li decide il trigger nel database,
   * così una spunta non è attribuibile a un collega né databile a piacere.
   */
  async setDone(input: {
    analysisId: string;
    companyId: string;
    action: ChecklistAction;
    done: boolean;
  }): Promise<void> {
    const { error } = await requireSupabase()
      .from('action_progress')
      .upsert(
        {
          analysis_id: input.analysisId,
          company_id: input.companyId,
          action_index: input.action.id,
          action_text: input.action.text,
          done: input.done,
        },
        { onConflict: 'analysis_id,action_index' },
      );
    if (error) throw new AppError(toUserMessage(error), error);
  },
};
