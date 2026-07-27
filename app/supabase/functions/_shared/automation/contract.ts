// ============================================================================
// Le costanti del motore delle automazioni, in un posto solo.
//
// Stanno qui — e non sparse fra worker, database e componenti — perché sono
// numeri che la UI DICHIARA all'utente e il sistema APPLICA. Quando le copie
// divergono, l'interfaccia promette una cosa e il motore ne fa un'altra: è già
// successo con `INITIAL_SYNC_DAYS` dell'Inbox, e da allora un test verifica che
// coincidano. Qui le copie sono due — questo file e `automation_limits()` nella
// 0020 — e `npm run test:workflows` le confronta contro il database vero.
//
// Modulo PORTABILE: nessuna API Deno, nessun import. Lo leggono il worker
// (Deno), i test (Node) e il browser (Vite) attraverso il re-export in
// `src/features/automations/registry.ts`.
// ============================================================================

/** Quante regole attive può avere un'azienda. Oltre, si sceglie cosa spegnere. */
export const MAX_ACTIVE_WORKFLOWS = 10;
/** Quante condizioni può avere una regola (§166). */
export const MAX_CONDITIONS = 10;
/**
 * Quante azioni può avere una regola (§74).
 *
 * Cinque e non cinquanta: oltre questa soglia una regola smette di essere una
 * regola e diventa un programma, cioè una cosa che nessuno rilegge prima di
 * attivarla. Chi ha bisogno di più passaggi scrive due regole, e le vede
 * entrambe nell'elenco.
 */
export const MAX_ACTIONS = 5;
/**
 * Profondità massima di una catena causale (§70).
 *
 * Una regola che crea un'attività fa nascere l'evento «attività creata», che
 * un'altra regola può ascoltare. È utile — e a cinque passi si ferma, perché
 * oltre non è più una catena di lavoro, è un ciclo che nessuno ha voluto.
 * Il taglio viene REGISTRATO (`chain_depth_exceeded`), non fatto in silenzio.
 */
export const MAX_CHAIN_DEPTH = 5;
/** Tentativi di elaborazione di un evento prima della lettera morta (§63). */
export const MAX_EVENT_ATTEMPTS = 5;
/** Quanti eventi della STESSA azienda si trattano in un'esecuzione (§73). */
export const MAX_RUNS_PER_COMPANY_PER_PASS = 50;
/** Lunghezza massima di un modello di testo (§166). */
export const MAX_TEMPLATE_LENGTH = 200;
/** Lunghezza massima della descrizione generata da un modello. */
export const MAX_DESCRIPTION_TEMPLATE_LENGTH = 1000;

/**
 * ⚠️ Deve coincidere con `public.automation_limits()` della 0020.
 * Non è una comodità: è l'oggetto che il test confronta con il database.
 */
export const AUTOMATION_LIMITS = {
  maxActiveWorkflows: MAX_ACTIVE_WORKFLOWS,
  maxConditions: MAX_CONDITIONS,
  maxActions: MAX_ACTIONS,
  maxChainDepth: MAX_CHAIN_DEPTH,
  maxEventAttempts: MAX_EVENT_ATTEMPTS,
  maxRunsPerCompanyPerPass: MAX_RUNS_PER_COMPANY_PER_PASS,
  maxTemplateLength: MAX_TEMPLATE_LENGTH,
} as const;

/** Quanti eventi si prenotano per esecuzione del worker. */
export const EVENT_BATCH = 40;
/** Per quanto una riga della coda resta prenotata. Scade da sé se il worker muore. */
export const EVENT_LOCK_SECONDS = 120;

/**
 * Budget di tempo del worker. Supabase chiude la richiesta a 150 secondi e
 * uccide l'isolate: il `finally` NON gira. Ogni passo controlla il proprio
 * tempo prima di cominciarne un altro — la lezione più cara del progetto.
 */
export const EDGE_TIME_BUDGET_MS = 100_000;

/** Attesa fra i tentativi, in secondi: esponenziale con jitter (§62). */
export function eventBackoffSeconds(attempts: number, random: () => number = Math.random): number {
  const base = Math.min(60 * 2 ** Math.max(0, attempts - 1), 3600);
  return Math.round(base + random() * base * 0.25);
}

/**
 * Fallimenti PERMANENTI consecutivi dopo i quali una regola si mette in pausa
 * da sé (§104). Non uno — un guasto isolato non deve spegnere una regola — e
 * non infinito, che significherebbe fallire diecimila volte senza che nessuno
 * se ne accorga.
 */
export const AUTO_PAUSE_AFTER_FAILURES = 5;

/**
 * Quanti giorni all'indietro guarda la scansione delle attività scadute.
 *
 * Non è un dettaglio di prestazioni: senza questo limite, la prima esecuzione
 * dopo l'attivazione di una regola emetterebbe un evento per OGNI attività
 * scaduta dell'azienda, cioè farebbe esattamente il backfill che §164 vieta.
 */
export const OVERDUE_LOOKBACK_DAYS = 3;

/**
 * Soglia sotto la quale un dato prodotto dall'AI non viene trattato come certo
 * (§25).
 *
 * ⚠️ Non è una soglia inventata per avere un numero: è la stessa idea del resto
 * del prodotto — ciò che non è certo si dichiara, non si usa. Un valore
 * CORRETTO A MANO da una persona è sempre certo, qualunque cosa dicesse l'AI:
 * la correzione è la verità dell'azienda (§24). E quando non esiste alcun
 * segnale di affidabilità — il motore locale non ne produce — il valore resta
 * utilizzabile: dedurre incertezza dall'assenza di una misura sarebbe a sua
 * volta inventare.
 */
export const MIN_ANALYSIS_CONFIDENCE = 0.5;

/**
 * Codici di errore che il motore può produrre. La UI li traduce; un codice
 * fuori da questo elenco NON viene mostrato grezzo (§50) — diventa il messaggio
 * generico, che è la verità.
 */
export const AUTOMATION_ERROR_CODES = [
  'config_invalid',            // la configurazione non supera il registro
  'entity_missing',            // il documento/l'attività non esiste più
  'entity_company_mismatch',   // l'entità non è dell'azienda dell'evento
  'condition_not_evaluable',   // un valore non è determinabile: non si esegue (§26)
  'template_value_missing',    // un segnaposto non ha valore: non si inventa (§31)
  'value_not_derivable',       // priorità o scadenza da ricavare, ma il dato non c'è
  'assignee_not_member',       // il responsabile non è più in azienda (§55)
  'tag_missing',               // l'etichetta è stata cancellata
  'no_recipient',              // non c'è nessuno da avvisare
  'manual_category',           // la categoria l'ha scelta una persona: non si tocca (§89)
  'already_set',               // era già così: non è un errore, è un no-op
  'duplicate',                 // l'azione era già stata eseguita (idempotenza)
  'chain_depth_exceeded',      // la catena è troppo profonda (§70)
  'action_failed',             // il database ha rifiutato la scrittura
  'unknown',
] as const;
export type AutomationErrorCode = (typeof AUTOMATION_ERROR_CODES)[number];
