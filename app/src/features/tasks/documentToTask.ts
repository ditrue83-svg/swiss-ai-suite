// ============================================================================
// Da un documento a un'attività — LE REGOLE. Una sola implementazione.
//
// PERCHÉ QUESTO FILE È SEPARATO DA `taskFromDocument.ts`
// Le regole erano già in un posto solo, e va benissimo così: quello che
// mancava era poterle PROVARE. `taskFromDocument.ts` importa `taskService` e
// `taskChecklistService`, che importano il client Supabase: uno script di
// prova non riesce nemmeno a caricare quel modulo. Finché è stato così,
// l'unica verifica possibile era su database reale — e tre esiti di questa
// funzione là non si sanno provocare, a cominciare da quello che conta di più:
// «l'attività è nata, i passaggi no».
//
// Quindi: qui le regole, con i due servizi come PARAMETRO; in
// `taskFromDocument.ts` il collegamento ai servizi veri, cinque righe che
// nessuna regola contengono. Nessun percorso di produzione passa da un doppio.
//
// Le regole, che restano una cosa sola:
//   · le azioni ancora aperte diventano i passaggi della checklist;
//   · quelle già completate NON si copiano — come «da fare» sarebbero false, e
//     già spuntate farebbero riscrivere al trigger chi e quando con l'utente e
//     l'ora di adesso, cancellando estremi veri registrati nell'analisi;
//   · è una derivazione UNA TANTUM: da qui in poi le due liste non si inseguono;
//   · i valori EFFETTIVI (correzioni umane comprese) battono quelli dell'analisi.
//
// Se i passaggi non si riescono ad aggiungere, l'attività resta e lo si DICE:
// `stepsFailed` risale a chi ha premuto il pulsante.
// ============================================================================
import { stepsFromActions } from './taskFormat';
// ⚠️ `import type` e non un import normale: viene CANCELLATO alla
// compilazione, quindi questo file non tira dentro il client Supabase e resta
// caricabile da uno script di prova. Se un giorno servisse un valore — e non
// solo un tipo — da `taskService`, andrebbe passato come parametro.
import type { CreateTaskInput } from '@/services/taskService';
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
  /**
   * Chi se ne occupa. Arriva dal modulo di revisione, che è lo stesso
   * dell'elenco Attività: qui NON si ripete nulla di quella logica — si riceve
   * un campo che il modulo ha già raccolto e lo si passa al servizio.
   */
  assigneeUserId?: string | null;
}

export interface CreateFromDocumentOutcome {
  task: Task;
  /** Quanti passaggi sono stati aggiunti davvero. */
  steps: number;
  /** L'attività c'è, i passaggi no: va detto, non nascosto. */
  stepsFailed: boolean;
}

/** I due servizi, come parametro. In esercizio sono quelli veri. */
export interface DocumentToTaskDeps {
  createTask: (input: CreateTaskInput) => Promise<Task>;
  addSteps: (companyId: string, taskId: string, texts: string[]) => Promise<unknown>;
}

/**
 * Che cosa verrà scritto, prima di scriverlo.
 *
 * Separata dalla scrittura perché è la parte che il modulo di revisione mostra
 * a una persona: i valori che compaiono a schermo devono essere gli stessi che
 * finiscono nel database, e l'unico modo di garantirlo è che li calcoli la
 * stessa funzione. È la lezione delle Automazioni, dove la tendina mostrava
 * CHF e la configurazione salvata non lo conteneva.
 */
export function documentTaskDraft(input: CreateFromDocumentInput): {
  payload: CreateTaskInput; steps: string[];
} {
  const analysis = input.analysis ?? null;
  return {
    steps: analysis ? stepsFromActions(analysis.actions, input.title) : [],
    payload: {
      companyId: input.companyId,
      userId: input.userId,
      title: input.title,
      authority: input.authority !== undefined ? input.authority : analysis?.sender ?? null,
      dueDate: input.dueDate !== undefined ? input.dueDate : analysis?.deadline ?? null,
      priority: input.priority
        ?? (analysis ? URGENCY_TO_PRIORITY[analysis.urgency] ?? 'medium' : 'medium'),
      assigneeUserId: input.assigneeUserId ?? null,
      // Un'attività nata da un'analisi non è «a mano»: chi la riceve ha diritto
      // di sapere da dove viene.
      source: analysis ? 'admin_ai' : 'manual',
      documentId: input.documentId,
    },
  };
}

export async function runCreateFromDocument(
  input: CreateFromDocumentInput,
  deps: DocumentToTaskDeps,
): Promise<CreateFromDocumentOutcome> {
  const { payload, steps } = documentTaskDraft(input);
  const task = await deps.createTask(payload);

  if (!steps.length) return { task, steps: 0, stepsFailed: false };

  try {
    await deps.addSteps(input.companyId, task.id, steps);
    return { task, steps: steps.length, stepsFailed: false };
  } catch {
    // ⚠️ L'attività NON viene cancellata e l'errore NON viene rilanciato:
    // esiste, ed è un fatto. Il chiamante deve poterla aprire lo stesso, e
    // dichiarare che i passaggi mancano.
    return { task, steps: 0, stepsFailed: true };
  }
}
