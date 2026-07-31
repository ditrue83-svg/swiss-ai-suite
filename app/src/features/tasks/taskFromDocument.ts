// ============================================================================
// Da un documento a un'attività — IL COLLEGAMENTO ai servizi veri.
//
// Le REGOLE non stanno qui: stanno in `documentToTask.ts`, che non importa
// nessun servizio ed è quindi caricabile da uno script di prova. Questo file
// contiene soltanto il legame con `taskService` e `taskChecklistService`, e
// mantiene invariata la firma che i tre chiamanti usano già — la schermata di
// analisi di Admin AI, il dettaglio di un documento e il dettaglio di una voce
// di Finanze.
//
// Nessuna regola va aggiunta qui: se ne fosse aggiunta una, sarebbe l'unica
// che nessuna asserzione può vedere.
// ============================================================================
import { taskService } from '@/services/taskService';
import { taskChecklistService } from '@/services/taskChecklistService';
import { runCreateFromDocument, type DocumentToTaskDeps } from './documentToTask';
import type { CreateFromDocumentInput, CreateFromDocumentOutcome } from './documentToTask';

export type { CreateFromDocumentInput, CreateFromDocumentOutcome };

const REAL_DEPS: DocumentToTaskDeps = {
  createTask: (input) => taskService.create(input),
  addSteps: (companyId, taskId, texts) => taskChecklistService.addMany(companyId, taskId, texts),
};

export async function createTaskFromDocument(
  input: CreateFromDocumentInput,
): Promise<CreateFromDocumentOutcome> {
  return await runCreateFromDocument(input, REAL_DEPS);
}
