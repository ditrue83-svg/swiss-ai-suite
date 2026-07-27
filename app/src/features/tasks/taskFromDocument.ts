// ============================================================================
// Da un documento a un'attività — una sola implementazione.
//
// La conversione esisteva già dentro la schermata di analisi di Admin AI. Con
// il Document Hub il punto di partenza diventa un secondo: dal dettaglio di un
// documento si apre un'attività senza passare dall'analisi. Riscriverla lì
// avrebbe voluto dire due conversioni con regole che col tempo divergono —
// proprio le regole delicate, quelle che decidono cosa NON copiare.
//
// Le regole, che restano una cosa sola:
//   · le azioni ancora aperte diventano i passaggi della checklist;
//   · quelle già completate NON si copiano — come «da fare» sarebbero false, e
//     già spuntate farebbero riscrivere al trigger chi e quando con l'utente e
//     l'ora di adesso, cancellando estremi veri registrati nell'analisi;
//   · è una derivazione UNA TANTUM: da qui in poi le due liste non si inseguono.
//
// Se i passaggi non si riescono ad aggiungere, l'attività resta e lo si DICE:
// `stepsFailed` risale a chi ha premuto il pulsante.
// ============================================================================
import { taskService } from '@/services/taskService';
import { taskChecklistService } from '@/services/taskChecklistService';
import { stepsFromActions } from './taskFormat';
import type { DocumentAnalysis, Task, TaskPriority } from '@/types/models';

const URGENCY_TO_PRIORITY: Record<string, TaskPriority> = { alta: 'high', media: 'medium', bassa: 'low' };

export interface CreateFromDocumentInput {
  companyId: string;
  userId: string;
  documentId: string;
  title: string;
  /** L'analisi, quando c'è: da lì vengono ente, scadenza, priorità e passaggi. */
  analysis?: DocumentAnalysis | null;
  /** Ente e scadenza già risolti (valori EFFETTIVI del Hub, correzioni comprese). */
  authority?: string | null;
  dueDate?: string | null;
  priority?: TaskPriority;
}

export interface CreateFromDocumentOutcome {
  task: Task;
  /** Quanti passaggi sono stati aggiunti davvero. */
  steps: number;
  /** L'attività c'è, i passaggi no: va detto, non nascosto. */
  stepsFailed: boolean;
}

export async function createTaskFromDocument(input: CreateFromDocumentInput): Promise<CreateFromDocumentOutcome> {
  const analysis = input.analysis ?? null;
  const steps = analysis ? stepsFromActions(analysis.actions, input.title) : [];

  const task = await taskService.create({
    companyId: input.companyId,
    userId: input.userId,
    title: input.title,
    // I valori effettivi hanno la precedenza su quelli dell'analisi: se una
    // persona ha corretto il mittente, l'attività porta il nome corretto.
    authority: input.authority !== undefined ? input.authority : analysis?.sender ?? null,
    dueDate: input.dueDate !== undefined ? input.dueDate : analysis?.deadline ?? null,
    priority: input.priority
      ?? (analysis ? URGENCY_TO_PRIORITY[analysis.urgency] ?? 'medium' : 'medium'),
    source: analysis ? 'admin_ai' : 'manual',
    documentId: input.documentId,
  });

  if (!steps.length) return { task, steps: 0, stepsFailed: false };

  try {
    await taskChecklistService.addMany(input.companyId, task.id, steps);
    return { task, steps: steps.length, stepsFailed: false };
  } catch {
    return { task, steps: 0, stepsFailed: true };
  }
}
