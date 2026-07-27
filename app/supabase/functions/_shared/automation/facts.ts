// ============================================================================
// I FATTI: che cosa il motore sa di un'entità, nel momento in cui la regola
// viene valutata.
//
// Un fatto non è solo un valore: è un valore E la sua CERTEZZA. La differenza
// non è teorica — è tutta la differenza fra assegnare a qualcuno una fattura da
// cinquemila franchi e assegnargliela perché l'AI ha letto male un importo di
// cui non era sicura.
//
//   `known: true`   il valore è stabilito e si può decidere su di esso
//   `known: false`  non è determinabile, per assenza o per incertezza. Una
//                   condizione su un fatto non noto vale `unknown`, non `false`,
//                   e in caso di ambiguità NON SI ESEGUE (§26).
//
// Modulo PORTABILE: solo tipi e funzioni pure, nessun accesso al database.
// Chi legge dal database è `store.ts`, che chiama queste funzioni per costruire
// i fatti a partire dalle righe.
// ============================================================================
import { MIN_ANALYSIS_CONFIDENCE } from './contract.ts';

export type FactValue = string | number | boolean | null;

export interface Fact {
  value: FactValue;
  known: boolean;
  /**
   * Perché non è noto. `missing` = il dato non c'è; `low_confidence` = c'è ma
   * l'analisi non era abbastanza sicura, e nessuno l'ha confermato a mano.
   * Serve alla schermata dell'esecuzione, che deve poter dire QUALE delle due.
   */
  reason?: 'missing' | 'low_confidence';
  /** Solo per gli importi. Non si convertono valute, mai (§27). */
  currency?: string | null;
}

export type Facts = Record<string, Fact>;

/** Un fatto stabilito. */
export function known(value: FactValue, currency?: string | null): Fact {
  return currency !== undefined ? { value, known: true, currency } : { value, known: true };
}

/** Un fatto assente. Il valore resta `null`: non si inventa un ripiego. */
export function missing(): Fact {
  return { value: null, known: false, reason: 'missing' };
}

/** Un fatto che c'è ma non è abbastanza affidabile per deciderci sopra. */
export function uncertain(value: FactValue, currency?: string | null): Fact {
  return { value, known: false, reason: 'low_confidence', currency: currency ?? null };
}

/**
 * Un valore che può essere assente: `null`, stringa vuota e `undefined` sono
 * tutti «non c'è».
 */
export function optional(value: FactValue | undefined): Fact {
  if (value === undefined || value === null) return missing();
  if (typeof value === 'string' && value.trim() === '') return missing();
  return known(value);
}

/**
 * Un valore prodotto dall'AI, con la sua certezza (§25).
 *
 * TRE SEGNALI, in quest'ordine:
 *   1. CORRETTO A MANO → certo, sempre. Una correzione è la verità dell'azienda
 *      e vince su qualunque punteggio (§24).
 *   2. `overallConfidence` sotto la soglia → incerto. È la misura che l'analisi
 *      dichiara di sé stessa.
 *   3. `confidenceLabel === 'bassa'` → incerto. È il giudizio in parole, per le
 *      analisi che non hanno un punteggio numerico.
 *
 * ⚠️ Quando NON esiste alcun segnale — nessun punteggio, nessuna etichetta — il
 * valore resta utilizzabile. Dedurre incertezza dall'assenza di una misura
 * sarebbe inventare a rovescio, ed è la stessa ragione per cui `configStatus`
 * non allarma quando la rete è irraggiungibile.
 */
export function aiFact(input: {
  value: FactValue | undefined;
  corrected?: boolean;
  overallConfidence?: number | null;
  confidenceLabel?: string | null;
  currency?: string | null;
}): Fact {
  const base = optional(input.value);
  if (!base.known) return input.currency !== undefined ? { ...base, currency: input.currency } : base;

  if (input.corrected) return known(base.value, input.currency);

  if (typeof input.overallConfidence === 'number' && Number.isFinite(input.overallConfidence)) {
    return input.overallConfidence < MIN_ANALYSIS_CONFIDENCE
      ? uncertain(base.value, input.currency)
      : known(base.value, input.currency);
  }
  if (input.confidenceLabel === 'bassa') return uncertain(base.value, input.currency);

  return known(base.value, input.currency);
}

/**
 * Urgenza di un documento.
 *
 * ⚠️ QUESTA FUNZIONE È UN DOPPIONE DICHIARATO di `urgencyFromType` +
 * `daysUntil` in `src/features/admin-ai/engine.ts`, ed è un doppione per una
 * ragione precisa: quel file vive nel bundle del browser e importa il resto del
 * motore locale, mentre questa gira in Deno dentro una Edge Function. È la
 * stessa situazione — e la stessa soluzione — di `DEFAULT_TIMEZONE`, che esiste
 * sia nel contratto del calendario sia in `preferencesDefaults`.
 *
 * ⚠️ E COME LÀ, LA COPIA NON È LASCIATA ALLA BUONA FEDE: `test:workflows-unit`
 * confronta le due implementazioni su una matrice di tipi e di distanze dalla
 * scadenza, e fallisce se divergono anche di un caso. Se un domani l'urgenza
 * cambia definizione, il test lo dice prima che la schermata e la regola
 * comincino a raccontare due cose diverse sullo stesso documento.
 *
 * ⚠️ Il calcolo dei giorni è a MILLISECONDI e non a giorni di calendario,
 * perché così è nel motore locale: allinearsi a una versione «migliore» qui
 * significherebbe divergere. È un limite noto ed è scritto anche là.
 */
const URGENT_TYPES = new Set(['sollecito', 'reminder']);
const MEDIUM_TYPES = new Set([
  'decisione', 'controllo',
  'official_decision', 'inspection_notice', 'payment_request', 'invoice',
  'declaration_request', 'request_for_documents',
]);

export function daysUntilMs(iso: string | null | undefined, now: Date = new Date()): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.ceil((t - now.getTime()) / 86_400_000);
}

export function urgencyFrom(
  documentType: string | null | undefined,
  deadline: string | null | undefined,
  now: Date = new Date(),
): 'alta' | 'media' | 'bassa' {
  const tipo = documentType ?? '';
  const days = daysUntilMs(deadline, now);
  if (URGENT_TYPES.has(tipo)) return 'alta';
  if (days !== null && days <= 10) return 'alta';
  if (days !== null && days <= 30) return 'media';
  if (MEDIUM_TYPES.has(tipo)) return 'media';
  return 'bassa';
}

/** Il dominio di un indirizzo email, in minuscolo. `null` se non c'è. */
export function emailDomain(address: string | null | undefined): string | null {
  const at = (address ?? '').lastIndexOf('@');
  if (at < 0) return null;
  const domain = address!.slice(at + 1).trim().toLowerCase();
  return domain || null;
}
