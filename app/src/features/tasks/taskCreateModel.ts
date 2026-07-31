// ============================================================================
// Le decisioni del MODULO DI CREAZIONE di un'attività — pure, senza React.
//
// PERCHÉ ESISTE QUESTO FILE
// Il modulo di creazione era scritto dentro `TasksPage`, e il dettaglio di un
// documento creava invece un'attività di colpo, senza mostrare niente. Portare
// il modulo anche là voleva dire o duplicarlo — due posti in cui ricordarsi
// della priorità proposta, del titolo vuoto, del doppio invio — oppure
// estrarlo. È stato estratto, e le sue decisioni stanno qui perché sono
// decisioni di prodotto e vanno provate: le suite di questo repository sono
// script Node, senza DOM, quindi ciò che vive dentro un componente non è
// verificabile da nessuna asserzione.
//
// Il componente `TaskCreateForm` è di conseguenza sottile: rende questi valori
// e chiama queste funzioni. Se una regola cambia, cambia qui, e i due posti che
// usano il modulo — Attività e Documenti — cambiano insieme.
// ============================================================================
import { priorityFromDueDate } from './taskFormat';
import type { TaskPriority } from '@/types/models';

/**
 * Lo stato del modulo. `priority` e `assigneeUserId` hanno una stringa vuota
 * come «non scelto» e non `null`: sono i valori che un `<select>` produce, e
 * tradurli avanti e indietro a ogni battuta avrebbe aggiunto una conversione
 * senza aggiungere una garanzia. La conversione avviene una volta sola, in
 * `taskFormSubmission`, che è il confine con il database.
 */
export interface TaskFormValues {
  title: string;
  /** '' oppure `YYYY-MM-DD`. */
  dueDate: string;
  /** '' = segui la priorità proposta dalla scadenza. */
  priority: TaskPriority | '';
  /** '' = non assegnata. */
  assigneeUserId: string;
}

export const EMPTY_TASK_FORM: TaskFormValues = {
  title: '', dueDate: '', priority: '', assigneeUserId: '',
};

/**
 * Una data che arriva dall'URL non entra in un campo senza essere guardata.
 *
 * È la regola che il Calendario usa già (`/attivita?nuova=2026-08-12`): un
 * valore arbitrario non deve finire in un campo che poi viene salvato. Qui è
 * una funzione invece di una riga dentro un effetto, così la si può provare —
 * ed è l'unico posto in cui la forma della data è scritta.
 */
export function safeDatePrefill(raw: string | null | undefined): string {
  return raw && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : '';
}

/**
 * La priorità che il modulo PROPONE finché la persona non sceglie.
 * Una sola implementazione, quella di `taskFormat`.
 */
export function proposedPriority(dueDate: string, now?: Date): TaskPriority {
  return priorityFromDueDate(dueDate || null, now);
}

/**
 * La priorità che verrà SALVATA: la scelta della persona se c'è, altrimenti la
 * proposta. ⚠️ Un valore MOSTRATO dev'essere un valore SALVATO — è la trappola
 * già pagata dal menu della valuta nelle Automazioni, dove la tendina mostrava
 * CHF e la configurazione non lo conteneva.
 */
export function effectivePriority(values: TaskFormValues, now?: Date): TaskPriority {
  return values.priority || proposedPriority(values.dueDate, now);
}

/**
 * Si può inviare? Riguarda ciò che si VEDE: il pulsante è premibile o no.
 *
 * ⚠️ NON è la protezione contro il doppio invio, e crederlo è costato una
 * prova nel browser: `saving` è uno stato React, e due clic nello stesso tick
 * lo leggono ENTRAMBI a `false` — la nuova resa arriva dopo. Il 2026-07-31,
 * con questa sola difesa, due clic ravvicinati hanno creato due attività
 * identiche a 14 millisecondi di distanza sul database vero.
 * La difesa che regge è `createSubmitLatch`, qui sotto.
 */
export function canSubmitTaskForm(values: TaskFormValues, saving: boolean): boolean {
  return !saving && values.title.trim().length > 0;
}

/**
 * Un salvataggio alla volta, deciso SINCRONAMENTE.
 *
 * Non è uno stato e non è un `useState`: è una variabile che cambia
 * nell'istante stesso del primo clic, quindi il secondo la trova già presa
 * anche se avviene prima di qualunque nuova resa. Il componente ne tiene una
 * in un `useRef`.
 *
 * ⚠️ Ciò che questo NON copre, e va detto: due schede aperte, oppure un clic
 * il cui esito si perde in rete e viene ritentato. Là il duplicato è possibile
 * e resta VISIBILE — l'alternativa (una chiave di idempotenza) chiederebbe una
 * migrazione, e questo intervento non ne introduce nessuna.
 */
export interface SubmitLatch {
  /** `true` se il posto era libero e ora è preso. */
  tryAcquire(): boolean;
  release(): void;
}

export function createSubmitLatch(): SubmitLatch {
  let inFlight = false;
  return {
    tryAcquire() {
      if (inFlight) return false;
      inFlight = true;
      return true;
    },
    release() { inFlight = false; },
  };
}

/** Ciò che si manda al servizio. È il confine fra «stringa vuota» e `null`. */
export interface TaskFormSubmission {
  title: string;
  dueDate: string | null;
  priority: TaskPriority;
  assigneeUserId: string | null;
}

export function taskFormSubmission(values: TaskFormValues, now?: Date): TaskFormSubmission {
  return {
    title: values.title,
    dueDate: values.dueDate || null,
    priority: effectivePriority(values, now),
    assigneeUserId: values.assigneeUserId || null,
  };
}
