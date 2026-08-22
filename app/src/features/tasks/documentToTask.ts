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

// ---------------------------------------------------------------------------
// L'APPARTENENZA — la regola che nessuna schermata deve poter dimenticare
//
// «Appartenenza in dubbio = niente attività»: finché nessuno conferma che il
// documento riguardi l'azienda, da lì non nascono scadenze né attività. La
// regola esisteva già, ma viveva in UNA schermata (il dettaglio del documento),
// e il commento accanto dichiarava che `canCreateTask` era «l'unico
// interruttore che tutti i punti di creazione consultano».
//
// ⚠️⚠️ NON ERA VERO, e il 2026-08-21 è costato un'attività vera: da una fattura
// Sunrise intestata a una persona fisica — `valutaAppartenenza` risponde
// `{doubt: true, via: 'nome'}` — è nata «Pagare la fattura», creata dalla
// schermata di Admin AI, che quel cancello non lo aveva. Una regola scritta in
// una schermata è una regola che la schermata successiva non eredita.
//
// Perciò l'appartenenza è un campo OBBLIGATORIO di questo ingresso: un punto di
// creazione nuovo non compila finché non dichiara che cosa sa. Le tre risposte
// sono diverse fra loro e nessuna è un ripiego dell'altra:
//   · `senza-dubbio`  — valutata, e il documento risulta dell'azienda;
//   · `in-dubbio`     — valutata, e NON risulta: qui non si crea niente;
//   · `non-valutata`  — non si è potuto valutare, e si dice PERCHÉ.
//
// ⚠️ `non-valutata` NON blocca, ed è deliberato: il dettaglio del documento si
// comporta già così (il verdetto arriva da una lettura che può essere ancora in
// corso o fallita, e in quel caso `ownershipDoubt` è falso). Bloccare su
// «non so» cambierebbe il comportamento di una schermata che nessuno ha
// chiesto di cambiare — ma il `perche` obbliga a scrivere in chiaro quale
// buco resta aperto, invece di lasciarlo invisibile.
// ---------------------------------------------------------------------------
export type Appartenenza =
  | { stato: 'senza-dubbio' }
  | { stato: 'in-dubbio' }
  | { stato: 'non-valutata'; perche: string };

/**
 * Il rifiuto del cancello.
 *
 * ⚠️ È un'ECCEZIONE e non un esito fra gli altri, perché a questo punto non si
 * deve mai arrivare: ogni schermata disabilita già il proprio pulsante. Questo
 * è il fondo del sacco — quello che regge quando una schermata futura si
 * dimentica di farlo — e un fondo del sacco silenzioso non è un fondo del
 * sacco: lascerebbe credere che l'attività sia nata.
 */
export class AppartenenzaInDubbio extends Error {
  constructor(readonly documentId: string) {
    super('appartenenza in dubbio: da questo documento non nascono attività');
    this.name = 'AppartenenzaInDubbio';
  }
}

/**
 * Dal verdetto di attendibilità alla dichiarazione di appartenenza.
 *
 * ⚠️ Esiste perché la traduzione la facevano DUE schermate, e una delle due non
 * la faceva affatto. `verdetto === null` NON è «senza dubbio»: è «non lo so
 * ancora» — la lettura delle correzioni può essere in corso o essere fallita, e
 * `analysisTrust` in quel caso non risponde. Chiamare quel silenzio «nessun
 * dubbio» sarebbe la dichiarazione falsa che questo cancello esiste per evitare.
 *
 * Il parametro è STRUTTURALE e non `TrustVerdict`: così questo file non importa
 * nulla da `features/documents` e resta caricabile da uno script di prova.
 */
export function appartenenzaDa(
  verdetto: { unavailable: 'ownership' | null } | null,
  perche: string,
): Appartenenza {
  if (!verdetto) return { stato: 'non-valutata', perche };
  return verdetto.unavailable === 'ownership' ? { stato: 'in-dubbio' } : { stato: 'senza-dubbio' };
}

export interface CreateFromDocumentInput {
  companyId: string;
  userId: string;
  documentId: string;
  title: string;
  /**
   * Che cosa si sa dell'appartenenza del documento all'azienda. OBBLIGATORIO:
   * vedi il blocco qui sopra — è la ragione per cui esiste questo campo.
   */
  appartenenza: Appartenenza;
  /** L'analisi, quando c'è: da lì vengono ente, scadenza, priorità e passaggi. */
  analysis?: DocumentAnalysis | null;
  /** Ente e scadenza già risolti (valori EFFETTIVI del Hub, correzioni comprese). */
  authority?: string | null;
  dueDate?: string | null;
  /**
   * Il giorno dell'evento, quando il documento ne fissa uno (0040/0041).
   *
   * ⚠️ NON è un ripiego della scadenza. Se il chiamante non lo passa si prende
   * dall'analisi, e se l'analisi non ne ha resta `null`: un'attività senza
   * termine e senza appuntamento è una cosa legittima, non un buco da riempire.
   */
  appointmentDate?: string | null;
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
      // ⚠️⚠️ LE DUE DATE VIAGGIANO SEPARATE, e questa riga è il punto esatto in
      // cui il difetto del 2026-07-26 è entrato nel mondo: da un'analisi che
      // metteva un sopralluogo nel campo Scadenza sono nate tre attività
      // datate 10.09.2026. Ora ciò che è un evento arriva come evento, e ciò
      // che è un termine come termine — nessuna delle due si travasa nell'altra.
      appointmentDate: input.appointmentDate !== undefined
        ? input.appointmentDate
        : analysis?.appointmentDate ?? null,
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
  // ⚠️ PRIMA di qualunque scrittura: un'attività creata e poi «annullata»
  // avrebbe già fatto scattare i trigger e lasciato una riga nello storico.
  if (input.appartenenza.stato === 'in-dubbio') throw new AppartenenzaInDubbio(input.documentId);

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
