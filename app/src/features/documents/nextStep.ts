// ============================================================================
// «Prossimo passo» — che cosa conviene fare adesso su questo documento.
//
// PERCHÉ ESISTE, E CHE COSA NON FA
// Il dettaglio di un documento mostrava tutto ciò che si sa e non diceva mai
// che cosa restava da fare: «Analizza» stava dentro il riquadro dell'analisi,
// «Crea attività» in fondo, e in mezzo un'analisi ancora in elaborazione
// lasciava comunque premere «Crea attività» — che avrebbe prodotto un'attività
// senza scadenza e senza passaggi, cioè un dato incompleto nato da un'attesa.
//
// Questa funzione NON introduce dati nuovi: legge quello che il dettaglio già
// ha (stato dell'analisi, valori effettivi, attività collegate) e decide che
// cosa mettere in primo piano. È PURA per la stessa ragione delle guardie di
// rotta: una decisione di questo tipo si sbaglia in silenzio — non lancia, non
// colora niente di rosso, propone soltanto la cosa sbagliata.
//
// LE DUE REGOLE CHE NON VANNO ROVESCIATE
//  1. «Più attività su un documento» resta LEGITTIMO (§40): non si impedisce,
//     si sposta in secondo piano, perché nel caso frequente la cosa da fare è
//     aprire l'attività che c'è già.
//  2. Ciò che il modulo dice deve essere ciò che il modulo farà: se la scadenza
//     va ancora verificata lo si dichiara PRIMA, non dopo aver creato
//     l'attività con dentro quella data.
// ============================================================================
import { stepsFromActions } from '@/features/tasks/taskFormat';
import type { Phrase } from '@/features/tasks/taskFormat';
import type { DocumentDetail } from '@/types/models';

/**
 * In che situazione si trova il documento. L'ordine di valutazione è quello
 * dichiarato in `nextStepFor` e non è indifferente: `processing` viene prima di
 * tutto perché è l'unico stato in cui NON si deve poter produrre niente.
 */
export type NextStepKind =
  | 'processing'   // l'analisi sta lavorando: si aspetta
  | 'none'         // nessuna analisi: si analizza
  | 'failed'       // l'analisi è fallita: si riprova
  | 'has_tasks'    // il lavoro è già nato: si apre
  | 'to_verify'    // c'è un'analisi, ma va verificata
  | 'ready';       // c'è un'analisi verificabile e nessuna attività

export type NextStepAction =
  | 'analyze' | 'retry_analysis' | 'verify_analysis'
  | 'create_task' | 'create_another_task' | 'open_task' | 'see_tasks' | 'wait';

export interface NextStepChoice {
  action: NextStepAction;
  /** Valorizzato solo per `open_task`: quale attività aprire. */
  taskId?: string;
}

export interface NextStep {
  kind: NextStepKind;
  /** Una sola azione primaria. Se è `wait` non c'è niente da premere. */
  primary: NextStepChoice;
  /** Le alternative, in ordine. «Crea un'altra attività» vive qui e mai in primaria. */
  secondary: NextStepChoice[];
  /**
   * Ciò che una persona deve sapere PRIMA di decidere: chiavi di traduzione,
   * mai testo. Il testo lo compone la schermata, nelle tre lingue.
   */
  notices: Phrase[];
  /**
   * Si può creare un'attività da questo documento?
   * ⚠️ È `false` in UN SOLO caso — mentre l'analisi lavora — e non è una
   * restrizione di comodo: creare in quell'istante significa fissare
   * un'attività senza la scadenza e senza i passaggi che stanno per arrivare.
   */
  canCreateTask: boolean;
  facts: {
    deadline: string | null;
    deadlineRequiresVerification: boolean;
    sender: string | null;
    /** Il titolo che il modulo proporrà: prima azione richiesta, altrimenti il documento. */
    proposedTitle: string;
    /** Azioni dell'analisi ancora aperte. */
    openActions: number;
    /** Passaggi che verranno creati DAVVERO: è `stepsFromActions`, non una stima. */
    stepsToCreate: number;
    uncertainties: number;
    openTasks: number;
    totalTasks: number;
    archived: boolean;
  };
}

/**
 * Il titolo proposto per l'attività: la prima azione richiesta dal documento se
 * c'è — è quella che dice cosa va fatto — altrimenti il NOME del documento.
 * Esportato perché è la stessa regola che il dettaglio usa per precompilare il
 * modulo: scritta due volte, prima o poi direbbe due titoli diversi.
 *
 * ⚠️ `nomeDocumento` È UN PARAMETRO, e non si legge più `document.title`. Il
 * titolo grezzo può non essere mostrabile — è il caso di «2.5» — e un'attività
 * intitolata «2.5» porta il difetto anche nello scadenziario, dove resta per
 * mesi. Il nome tradotto lo risolve la schermata (`useDocumentLabel`), perché
 * questo modulo è puro e non ha dizionari. Quando non arriva si ripiega sul
 * titolo grezzo: è un ripiego dichiarato, non un'abitudine.
 */
export function proposedTaskTitle(detail: DocumentDetail, nomeDocumento?: string): string {
  return detail.analysis?.primaryAction || (nomeDocumento ?? '').trim() || detail.document.title;
}

export function nextStepFor(detail: DocumentDetail, nomeDocumento?: string): NextStep {
  const { item, analysis } = detail;
  const archived = !!detail.document.archivedAt;
  const proposedTitle = proposedTaskTitle(detail, nomeDocumento);
  const openActions = analysis ? analysis.actions.filter((a) => !a.done).length : 0;
  // I passaggi si contano con la funzione che li creerà davvero: dire «ne
  // creerò 4» e crearne 2 sarebbe una promessa non mantenuta, e la differenza
  // nasce proprio dalle regole di `stepsFromActions` (azioni fatte, testo
  // uguale al titolo, testi vuoti).
  const stepsToCreate = analysis ? stepsFromActions(analysis.actions, proposedTitle).length : 0;
  const openTasks = detail.tasks.filter((t) => t.status !== 'completed' && !t.archivedAt).length;

  const facts: NextStep['facts'] = {
    deadline: item.deadline,
    deadlineRequiresVerification: item.deadlineRequiresVerification,
    sender: item.sender,
    proposedTitle,
    openActions,
    stepsToCreate,
    uncertainties: analysis?.uncertaintyItems.length ?? 0,
    openTasks,
    totalTasks: detail.tasks.length,
    archived,
  };

  const notices: Phrase[] = [];
  // Un documento archiviato non impedisce niente, ma non deve nemmeno lasciar
  // creare un'attività senza che sia evidente su che cosa la si sta creando.
  if (archived) notices.push({ key: 'documents.nextStep.noticeArchived' });

  // ---- 1. L'analisi sta lavorando ------------------------------------------
  // Nessun pulsante che produca dati incompleti: è l'unica situazione in cui
  // creare un'attività è peggio che aspettare trenta secondi.
  if (item.state === 'processing') {
    return {
      kind: 'processing', primary: { action: 'wait' }, secondary: [],
      notices: [...notices, { key: 'documents.nextStep.noticeProcessing' }],
      canCreateTask: false, facts,
    };
  }

  // ---- 2. Nessuna analisi ---------------------------------------------------
  if (item.state === 'none') {
    notices.push({ key: 'documents.nextStep.noticeNoAnalysis' });
    return {
      kind: 'none', primary: { action: 'analyze' },
      secondary: detail.tasks.length ? [taskChoice(detail)] : [{ action: 'create_task' }],
      notices, canCreateTask: true, facts,
    };
  }

  // ---- 3. L'analisi è fallita ----------------------------------------------
  // Non si racconta come un risultato: niente mittente, niente scadenza.
  if (item.state === 'failed') {
    notices.push({ key: 'documents.nextStep.noticeFailed' });
    return {
      kind: 'failed', primary: { action: 'retry_analysis' },
      secondary: detail.tasks.length ? [taskChoice(detail)] : [{ action: 'create_task' }],
      notices, canCreateTask: true, facts,
    };
  }

  // Da qui in poi un'analisi utilizzabile c'è. Le avvertenze valgono per tutti
  // i rami che restano, e vanno DETTE prima che qualcuno prema un pulsante.
  if (item.lastAttemptFailed) notices.push({ key: 'documents.nextStep.noticeLastAttemptFailed' });
  if (item.deadlineRequiresVerification) notices.push({ key: 'documents.nextStep.noticeDeadlineToVerify' });
  if (!item.deadline) notices.push({ key: 'documents.nextStep.noticeNoDeadline' });
  if (facts.uncertainties > 0) {
    notices.push({
      key: facts.uncertainties === 1
        ? 'documents.nextStep.noticeUncertaintyOne'
        : 'documents.nextStep.noticeUncertaintyMany',
      params: { n: facts.uncertainties },
    });
  }
  if (stepsToCreate === 0) notices.push({ key: 'documents.nextStep.noticeNoActions' });

  // ---- 4. Il lavoro è già nato ---------------------------------------------
  // ⚠️ Viene PRIMA di «da verificare» e di «pronta», e la ragione è che nel caso
  // frequente la cosa da fare è aprire l'attività che esiste, non farne una
  // seconda. Crearne un'altra resta possibile: è secondaria, non vietata (§40).
  if (detail.tasks.length > 0) {
    notices.push({
      key: detail.tasks.length === 1
        ? 'documents.nextStep.noticeExistingOne'
        : 'documents.nextStep.noticeExistingMany',
      params: { n: detail.tasks.length },
    });
    const secondary: NextStepChoice[] = [{ action: 'create_another_task' }];
    if (item.state === 'to_verify') secondary.unshift({ action: 'verify_analysis' });
    return { kind: 'has_tasks', primary: taskChoice(detail), secondary, notices, canCreateTask: true, facts };
  }

  // ---- 5. C'è un'analisi, ma va verificata ---------------------------------
  if (item.state === 'to_verify') {
    notices.push({ key: 'documents.nextStep.noticeToVerify' });
    return {
      kind: 'to_verify', primary: { action: 'verify_analysis' },
      secondary: [{ action: 'create_task' }], notices, canCreateTask: true, facts,
    };
  }

  // ---- 6. Analisi verificabile e nessuna attività --------------------------
  return {
    kind: 'ready', primary: { action: 'create_task' }, secondary: [], notices,
    canCreateTask: true, facts,
  };
}

/** Una attività si apre, più di una si guardano: sono due frasi diverse. */
function taskChoice(detail: DocumentDetail): NextStepChoice {
  return detail.tasks.length === 1
    ? { action: 'open_task', taskId: detail.tasks[0].id }
    : { action: 'see_tasks' };
}
