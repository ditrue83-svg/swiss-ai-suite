// ============================================================================
// Che PESO ha una riga della Inbox.
//
// PERCHÉ ESISTE. Il triage funzionava già: «Attempted Absolution» di Andrew
// Tate era etichettata «Non amministrativa» e la ricevuta di Anthropic
// «Informativa», e nessuna delle due era sbagliata. Ma le due righe avevano la
// stessa altezza, lo stesso peso tipografico e la stessa posizione di una
// comunicazione che chiede un'azione: il modulo faceva il lavoro di triage e
// poi lo buttava via all'ultimo passo, lasciando all'utente il compito di
// rifarlo a mano con gli occhi. Una classificazione che non cambia la forma
// della pagina non è una classificazione: è un'etichetta.
//
// ⚠️ COMPRIMERE NON È NASCONDERE. La riga compressa dice quante sono, e un clic
// le riapre. Nessun messaggio viene archiviato, messo via o escluso dalla
// ricerca in base alla classificazione: comprimere è una scelta di
// presentazione, reversibile; nascondere un dato non lo sarebbe.
//
// LA REGOLA STA QUI UNA VOLTA SOLA, in due lingue che devono dire la stessa
// cosa: il predicato che il browser applica a una riga già letta, e il filtro
// che PostgREST applica alla query. Se divergessero, il numero scritto sulla
// riga compressa e l'elenco che si apre parlerebbero di due insiemi diversi —
// il difetto dei «19 documenti» contro «2 di 2», già visto e già corretto una
// volta. `test:inbox-unit` confronta le due scritture caso per caso.
// ============================================================================
import type { EmailAttentionStatus } from '@/types/models';

/**
 * Sotto questa fiducia una classificazione «non amministrativa» NON basta a
 * comprimere: il messaggio resta in evidenza.
 *
 * ⚠️ Il costo dei due errori non è simmetrico, e la soglia lo dice: comprimere
 * per sbaglio una lettera dell'AFC costa una scadenza, mostrare di troppo una
 * promozione costa una riga. Nel dubbio si mostra.
 *
 * PERCHÉ 0.9 E NON UN NUMERO QUALSIASI. Misurato sui 148 messaggi reali del
 * 2026-08-16: i 9 «non amministrativa» decisi dal modello stanno a 0.97–0.98,
 * i «da verificare» a 0.55–0.70. Fra le due popolazioni c'è un vuoto, e la
 * soglia sta dentro il vuoto. Oggi quindi NON sposta alcuna riga — è una
 * protezione, non un filtro, e va detto invece di lasciarla passare per lavoro
 * fatto.
 */
export const SOGLIA_COMPRESSIONE = 0.9;

/** I tre pesi che una riga può avere. Non sono cinque: sono quelli che si vedono. */
export type InboxEmphasis =
  /** Chiede un'azione, o non si sa: piena evidenza. */
  | 'action'
  /** Riguarda l'azienda ma non chiede nulla: visibile, peso ridotto. */
  | 'informational'
  /** Non amministrativa e la macchina ne è sicura: una riga sola, in fondo. */
  | 'collapsed';

/** Ciò che una riga deve portare perché se ne possa dire il peso. */
export interface EmphasisInput {
  attentionStatus: EmailAttentionStatus;
  relevanceConfidence: number | null;
}

/**
 * Comprimibile solo `ignored` — l'unico stato che significa «non
 * amministrativa» — e solo quando la fiducia non contraddice la conclusione.
 *
 * ⚠️ FIDUCIA ASSENTE NON VUOL DIRE FIDUCIA BASSA, e la differenza vale 63
 * messaggi su 72. Una fiducia `null` su questo stato viene dal filtro
 * deterministico (`prescreen:bulk_no_administrative_signal`): lì non c'è una
 * probabilità perché non c'è un modello — c'è una regola che pretende posta di
 * massa E nessun indizio amministrativo, dove basta UN indizio a fermarla. Un
 * mittente `*.admin.ch` è uno di quegli indizi, quindi una lettera dell'AFC non
 * può finire in questo insieme: non è una speranza, è la forma della regola in
 * `_shared/email/classify.ts`.
 */
export function comprimibile(m: EmphasisInput): boolean {
  if (m.attentionStatus !== 'ignored') return false;
  if (m.relevanceConfidence === null) return true;
  return m.relevanceConfidence >= SOGLIA_COMPRESSIONE;
}

/**
 * Il peso di una riga.
 *
 * ⚠️ `to_verify` sta con chi chiede un'azione, non con le informative: è il
 * valore di una classificazione INCERTA, e un'incertezza non si declassa.
 * Stessa ragione per un `ignored` che non supera la soglia — se non si sa se
 * sia spazzatura, non si sa nemmeno se chieda qualcosa.
 */
export function inboxEmphasis(m: EmphasisInput): InboxEmphasis {
  if (comprimibile(m)) return 'collapsed';
  // Già messa via da una persona, o giudicata informativa: niente da fare.
  if (m.attentionStatus === 'informational' || m.attentionStatus === 'handled') return 'informational';
  return 'action';
}

/**
 * La stessa regola scritta per PostgREST.
 *
 * `eq` sono le uguaglianze da applicare con `.eq()`, `or` è l'argomento di
 * `.or()`: le due parti si compongono in AND, come fa il costruttore di query
 * di supabase-js. Le stringhe si costruiscono da `SOGLIA_COMPRESSIONE` e non
 * dal numero scritto a mano, perché un giorno la soglia cambierà.
 */
export const QUERY_COMPRESSI = {
  eq: { attention_status: 'ignored' },
  or: `relevance_confidence.is.null,relevance_confidence.gte.${SOGLIA_COMPRESSIONE}`,
} as const;

/**
 * Il complemento esatto del precedente, dentro «non messe via».
 *
 * ⚠️ Deve essere un COMPLEMENTO, non «più o meno l'opposto»: la somma delle due
 * viste è l'elenco intero, e un messaggio che non cadesse in nessuna delle due
 * sparirebbe dalla pagina senza che nessuno se ne accorga. La logica a tre
 * valori di SQL è la trappola — `relevance_confidence.lt.0.9` su un NULL non è
 * falso, è ignoto — ed è il motivo per cui questo file ha un test.
 */
export const QUERY_IN_EVIDENZA = {
  or: `attention_status.neq.ignored,relevance_confidence.lt.${SOGLIA_COMPRESSIONE}`,
} as const;
