// ============================================================================
// Il valutatore delle condizioni. Funzione PURA, e il posto più delicato del
// modulo dopo il registro.
//
// ⚠️ LA LOGICA È A TRE VALORI, NON A DUE.
// Vero, falso e NON DETERMINABILE. La terza non è un lusso: se il mittente non
// è stato riconosciuto, «il mittente è l'AFC» non è falso — è una domanda a cui
// non sappiamo rispondere. Trattarla come falso significherebbe non eseguire
// una regola che invece doveva partire; trattarla come vera, eseguirne una che
// non doveva. L'unica risposta onesta è «non lo so», e in quel caso NON SI
// ESEGUE (§26).
//
// Le tre righe che seguono sono la logica di Kleene, e ognuna ha una
// conseguenza concreta:
//   · TUTTE  (`all`) — basta un FALSO per dire «non corrisponde», anche in
//     presenza di ignoti: falso e ignoto fa falso. Così una regola su tre
//     condizioni, di cui una chiaramente non soddisfatta, dice «non
//     corrisponde» invece di «non valutabile», che sarebbe rumore.
//   · ALMENO UNA (`any`) — basta un VERO per dire «corrisponde», anche in
//     presenza di ignoti.
//   · In tutti gli altri casi con un ignoto: non determinabile.
//
// Modulo PORTABILE: nessun import fuori da questa cartella.
// ============================================================================
import type { Operator, WorkflowCondition } from './registry.ts';
import type { Fact, Facts } from './facts.ts';

export type Outcome = 'true' | 'false' | 'unknown';

export interface ConditionResult {
  field: string;
  operator: Operator;
  /** Il valore ATTESO, cioè quello scritto nella regola. */
  expected: string | number | boolean | string[] | null;
  currency?: string | null;
  outcome: Outcome;
  /**
   * Perché non è determinabile. `missing`/`low_confidence` vengono dal fatto;
   * `currency_mismatch` è la valuta diversa (§27); `unknown_field` è una
   * condizione che nomina un campo che non esiste — che il validatore avrebbe
   * dovuto fermare, e se arriva fin qui è un guasto, non un «no».
   */
  reason?: 'missing' | 'low_confidence' | 'currency_mismatch' | 'unknown_field';
}

export interface Evaluation {
  /** Le condizioni sono soddisfatte. */
  matched: boolean;
  /**
   * Si è potuto DECIDERE. Falso quando l'esito dipende da un valore ignoto: in
   * quel caso non si esegue e lo si dichiara, invece di tirare a indovinare.
   */
  evaluable: boolean;
  results: ConditionResult[];
}

/** Testo confrontabile: senza spazi ai bordi, spazi interni normalizzati, minuscolo. */
function norm(v: unknown): string {
  return String(v ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  // La virgola come separatore decimale è normale in Svizzera: chi scrive
  // «5000,50» in un campo non sta sbagliando, sta scrivendo un numero.
  const n = Number(String(v ?? '').replace(/'/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Giorni di CALENDARIO da oggi alla data. Aritmetica in UTC: non può scivolare. */
export function daysUntilDate(iso: string, now: Date): number | null {
  const due = Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(due)) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((due - today) / 86_400_000);
}

/**
 * Una condizione sola.
 *
 * `exists` e `not_exists` sono gli unici operatori che rispondono anche su un
 * fatto non noto: «c'è una scadenza?» ha una risposta anche quando la scadenza
 * non c'è. Ma non quando il fatto è INCERTO — là il valore c'è e non c'è
 * insieme, e la risposta onesta resta «non lo so».
 */
export function evaluateCondition(
  condition: WorkflowCondition, facts: Facts, now: Date = new Date(),
): ConditionResult {
  const base = {
    field: condition.field,
    operator: condition.operator,
    expected: condition.value ?? null,
    currency: condition.currency ?? null,
  };

  const fact: Fact | undefined = facts[condition.field];
  if (!fact) {
    // Il validatore non l'avrebbe lasciata passare: se si arriva qui è perché
    // la regola è stata scritta per una versione dell'innesco che aveva quel
    // campo. Non si indovina: non determinabile.
    return { ...base, outcome: 'unknown', reason: 'unknown_field' };
  }

  if (condition.operator === 'exists' || condition.operator === 'not_exists') {
    if (fact.reason === 'low_confidence') {
      return { ...base, outcome: 'unknown', reason: 'low_confidence' };
    }
    const present = fact.known && fact.value !== null && fact.value !== '';
    const wanted = condition.operator === 'exists';
    return { ...base, outcome: present === wanted ? 'true' : 'false' };
  }

  if (!fact.known) {
    return { ...base, outcome: 'unknown', reason: fact.reason ?? 'missing' };
  }

  const outcome = compare(condition, fact, now);
  return typeof outcome === 'string'
    ? { ...base, outcome }
    : { ...base, outcome: 'unknown', reason: outcome.reason };
}

function compare(
  condition: WorkflowCondition, fact: Fact, now: Date,
): Outcome | { reason: ConditionResult['reason'] } {
  const op = condition.operator;
  const expected = condition.value;

  switch (op) {
    case 'equals':      return norm(fact.value) === norm(expected) ? 'true' : 'false';
    case 'not_equals':  return norm(fact.value) !== norm(expected) ? 'true' : 'false';
    case 'contains':    return norm(fact.value).includes(norm(expected)) ? 'true' : 'false';
    case 'not_contains': return norm(fact.value).includes(norm(expected)) ? 'false' : 'true';
    case 'starts_with': return norm(fact.value).startsWith(norm(expected)) ? 'true' : 'false';

    case 'in': {
      const list = Array.isArray(expected) ? expected : [expected];
      return list.some((v) => norm(v) === norm(fact.value)) ? 'true' : 'false';
    }

    case 'greater_than':
    case 'greater_or_equal':
    case 'less_than':
    case 'less_or_equal': {
      // ⚠️ §27 — CHF 5'000 non è EUR 5'000, e non si converte.
      // Quando le valute non coincidono la risposta NON è «no»: è «non lo so»,
      // perché la domanda posta dalla regola («più di cinquemila franchi») non
      // si applica a un importo in un'altra valuta. Dire «no» sarebbe una
      // risposta, e sarebbe sbagliata.
      if (condition.currency) {
        const factCurrency = (fact.currency ?? '').trim().toUpperCase();
        if (!factCurrency) return { reason: 'currency_mismatch' };
        if (factCurrency !== condition.currency.trim().toUpperCase()) {
          return { reason: 'currency_mismatch' };
        }
      }
      const a = asNumber(fact.value);
      const b = asNumber(expected);
      if (a === null || b === null) return { reason: 'missing' };
      if (op === 'greater_than')     return a > b ? 'true' : 'false';
      if (op === 'greater_or_equal') return a >= b ? 'true' : 'false';
      if (op === 'less_than')        return a < b ? 'true' : 'false';
      return a <= b ? 'true' : 'false';
    }

    case 'within_days': {
      const days = daysUntilDate(String(fact.value), now);
      const limit = asNumber(expected);
      if (days === null || limit === null) return { reason: 'missing' };
      // ⚠️ Una scadenza GIÀ PASSATA rientra in «entro N giorni», e la scelta va
      // dichiarata: una regola scritta per accorgersi di ciò che scade fra
      // dieci giorni deve accorgersi anche di ciò che è scaduto ieri. Il
      // contrario — escludere il passato — produrrebbe il caso peggiore:
      // silenzio proprio quando il problema è più grave.
      return days <= limit ? 'true' : 'false';
    }

    default:
      // Un operatore fuori dall'insieme chiuso non viene interpretato: sarebbe
      // il solo punto in cui una stringa dell'utente potrebbe diventare un
      // comportamento. Non determinabile, e la regola non esegue.
      return { reason: 'unknown_field' };
  }
}

/**
 * Tutte le condizioni, con la modalità scelta.
 *
 * ⚠️ NESSUNA CONDIZIONE = CORRISPONDE SEMPRE, ed è voluto: «quando arriva un
 * documento dall'Inbox, aggiungi l'etichetta Da protocollare» è una regola
 * legittima e non ha bisogno di un «se». La schermata lo dice esplicitamente
 * prima dell'attivazione, così nessuno lo scopre dopo.
 */
export function evaluateConditions(
  conditions: readonly WorkflowCondition[],
  match: 'all' | 'any',
  facts: Facts,
  now: Date = new Date(),
): Evaluation {
  const results = conditions.map((c) => evaluateCondition(c, facts, now));
  if (!results.length) return { matched: true, evaluable: true, results };

  const anyTrue = results.some((r) => r.outcome === 'true');
  const anyFalse = results.some((r) => r.outcome === 'false');
  const anyUnknown = results.some((r) => r.outcome === 'unknown');

  if (match === 'all') {
    if (anyFalse) return { matched: false, evaluable: true, results };
    if (anyUnknown) return { matched: false, evaluable: false, results };
    return { matched: true, evaluable: true, results };
  }

  if (anyTrue) return { matched: true, evaluable: true, results };
  if (anyUnknown) return { matched: false, evaluable: false, results };
  return { matched: false, evaluable: true, results };
}
