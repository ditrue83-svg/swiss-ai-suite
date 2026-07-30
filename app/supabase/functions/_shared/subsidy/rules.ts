// ============================================================================
// LA VALUTAZIONE DI UN CRITERIO — dodici operatori, nessuna espressione.
//
// ⚠️ NON ESISTE ALCUN PERCORSO in cui una stringa scritta nel catalogo diventi
// codice: niente `eval`, niente `new Function`, niente SQL costruito a
// stringhe, niente template arbitrari (§52). Un criterio è una struttura con
// un fatto, un operatore e un valore atteso; ognuno degli operatori è una delle
// funzioni scritte qui sotto, e ciò che non è in questo file non si può fare.
//
// ⚠️ LA LOGICA È A CINQUE STATI, non a due. `unknown` NON è `not_satisfied`:
// un'impresa che non ha ancora indicato il numero di dipendenti non è
// un'impresa che non li ha. Confondere le due cose produce esclusioni false, ed
// è l'errore che questo modulo esiste per non fare (§51).
//
// Modulo PORTABILE: nessun import di runtime.
// ============================================================================

import type { CriterionState, RuleHardness, RuleEvaluability, RuleOperator } from './contract.ts';
import { UNARY_OPERATORS } from './contract.ts';
import type { Fact, FactMap } from './facts.ts';
import { isKnown, isKnownFactKey } from './facts.ts';
import type { FactSource } from './contract.ts';

export interface SubsidyRule {
  ruleKey: string;
  label: string;
  factKey: string | null;
  operator: RuleOperator | null;
  expectedValue: unknown;
  hardness: RuleHardness;
  evaluability: RuleEvaluability;
  question: string | null;
  sourceEvidence: unknown;
  sortOrder: number;
}

/** Una risposta esplicita a un criterio (§93). */
export type AnswerValue = 'yes' | 'no' | 'unknown';

export interface CriterionOutcome {
  ruleKey: string;
  hardness: RuleHardness;
  state: CriterionState;
  observedValue: string | null;
  valueSource: FactSource | null;
  /**
   * Perché lo stato è quello. ⚠️ Serve alla schermata per dire cose diverse:
   * «manca un dato» porta a compilare il profilo, «va verificato sulla fonte»
   * porta a leggere la pagina dell'ente. Sono due azioni diverse.
   */
  reasonCode:
    | 'answer' | 'auto' | 'missing_fact' | 'unknown_fact_key'
    | 'unknown_operator' | 'manual_review' | 'conflict' | 'rule_incomplete';
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Gli operatori
// ---------------------------------------------------------------------------

const asNumber = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  // ⚠️ Una stringa numerica si accetta SOLO se è interamente un numero:
  //    `Number('12 dipendenti')` fa NaN, ma `parseInt` farebbe 12 — e un
  //    confronto su un numero indovinato dentro una frase è precisamente il
  //    tipo di deduzione che questo modulo non fa.
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
  return null;
};

const asDate = (v: unknown): number | null => {
  if (typeof v !== 'string') return null;
  // Solo ISO `YYYY-MM-DD` o un istante completo. Una data scritta «12.08.2026»
  // è ambigua fra due convenzioni e non si indovina (la stessa cautela della
  // bandiera `ambiguous_date` di Finanze).
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(v.trim())) return null;
  const t = Date.parse(v.length === 10 ? `${v}T00:00:00Z` : v);
  return Number.isFinite(t) ? t : null;
};

const asList = (v: unknown): string[] | null => {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === 'string') return [v];
  return null;
};

/**
 * Applica un operatore. Restituisce `null` quando il confronto non è possibile
 * — tipi incompatibili, valore atteso mancante — e `null` diventa
 * `not_evaluable`, mai `false`.
 */
export function applyOperator(op: RuleOperator, actual: unknown, expected: unknown): boolean | null {
  switch (op) {
    case 'exists':
      return actual !== null && actual !== undefined
        && !(typeof actual === 'string' && actual.trim() === '')
        && !(Array.isArray(actual) && actual.length === 0);
    case 'not_exists': {
      const e = applyOperator('exists', actual, null);
      return e === null ? null : !e;
    }
    case 'equals':
      if (expected === undefined) return null;
      if (typeof actual === 'boolean' || typeof expected === 'boolean') {
        if (typeof actual !== 'boolean' || typeof expected !== 'boolean') return null;
        return actual === expected;
      }
      if (Array.isArray(actual)) return null;
      return String(actual) === String(expected);
    case 'not_equals': {
      const e = applyOperator('equals', actual, expected);
      return e === null ? null : !e;
    }
    case 'contains': {
      // ⚠️ Su una LISTA `contains` significa «l'elemento c'è», non «una
      //    sottostringa combacia». È la lezione dei ruoli del CRM: con il
      //    confronto per sottostringa, «il ruolo contiene customer» rispondeva
      //    sì anche a `former_customer`.
      const list = Array.isArray(actual) ? actual.map(String) : null;
      if (list) return expected !== undefined && list.includes(String(expected));
      if (typeof actual === 'string' && expected !== undefined) {
        return actual.toLowerCase().includes(String(expected).toLowerCase());
      }
      return null;
    }
    case 'in': {
      const allowed = asList(expected);
      if (!allowed) return null;
      if (Array.isArray(actual)) return actual.map(String).some((x) => allowed.includes(x));
      if (actual === null || actual === undefined) return null;
      return allowed.includes(String(actual));
    }
    case 'greater_than':
    case 'greater_or_equal':
    case 'less_than':
    case 'less_or_equal': {
      const a = asNumber(actual);
      const b = asNumber(expected);
      if (a === null || b === null) return null;
      if (op === 'greater_than') return a > b;
      if (op === 'greater_or_equal') return a >= b;
      if (op === 'less_than') return a < b;
      return a <= b;
    }
    case 'before':
    case 'after': {
      const a = asDate(actual);
      const b = asDate(expected);
      if (a === null || b === null) return null;
      return op === 'before' ? a < b : a > b;
    }
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// La valutazione di un criterio
// ---------------------------------------------------------------------------

function displayValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v)) return v.length ? v.map(String).join(', ') : null;
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  const s = String(v).trim();
  return s.length ? s : null;
}

export function evaluateRule(
  rule: SubsidyRule,
  facts: FactMap,
  answer: AnswerValue | null,
  conflicts: readonly string[] = [],
): CriterionOutcome {
  const base = {
    ruleKey: rule.ruleKey,
    hardness: rule.hardness,
    sortOrder: rule.sortOrder,
  };

  // ⚠️ LA RISPOSTA DI UNA PERSONA VIENE PRIMA DI TUTTO (§36). Se qualcuno ha
  //    dichiarato che il criterio è soddisfatto, il motore non lo ricalcola:
  //    contraddire una risposta esplicita con una deduzione significherebbe
  //    dire all'utente che si sbaglia su un fatto che riguarda la sua impresa.
  if (answer === 'yes' || answer === 'no') {
    return {
      ...base,
      state: answer === 'yes' ? 'satisfied' : 'not_satisfied',
      observedValue: answer,
      valueSource: 'user_answer',
      reasonCode: 'answer',
    };
  }
  if (answer === 'unknown') {
    return { ...base, state: 'unknown', observedValue: null, valueSource: 'user_answer', reasonCode: 'answer' };
  }

  // Un criterio che la fonte dichiara verificabile solo a mano non si valuta e
  // non si finge (§50). Compare, si legge, e chiede una verifica.
  if (rule.evaluability === 'manual') {
    return { ...base, state: 'not_evaluable', observedValue: null, valueSource: null, reasonCode: 'manual_review' };
  }

  // Un criterio che aspetta una risposta e non l'ha avuta è `unknown`, non
  // `not_evaluable`: la differenza è che qui esiste un modo di chiuderlo.
  if (rule.evaluability === 'question' && !rule.factKey) {
    return { ...base, state: 'unknown', observedValue: null, valueSource: null, reasonCode: 'missing_fact' };
  }

  if (!rule.factKey || !rule.operator) {
    return { ...base, state: 'not_evaluable', observedValue: null, valueSource: null, reasonCode: 'rule_incomplete' };
  }

  // ⚠️ UN FATTO CHE IL REGISTRO NON CONOSCE NON È UN CRITERIO SUPERATO. Il
  //    catalogo può nominare una chiave che il prodotto non sa ancora
  //    calcolare: in quel caso lo si dice, non lo si assolve.
  if (!isKnownFactKey(rule.factKey)) {
    return { ...base, state: 'not_evaluable', observedValue: null, valueSource: null, reasonCode: 'unknown_fact_key' };
  }

  if (conflicts.includes(rule.factKey)) {
    const f = facts[rule.factKey];
    return {
      ...base, state: 'conflicting',
      observedValue: f ? displayValue(f.value) : null,
      valueSource: f?.source ?? null, reasonCode: 'conflict',
    };
  }

  const fact: Fact | undefined = facts[rule.factKey];
  const unary = UNARY_OPERATORS.includes(rule.operator);

  if (!isKnown(fact) && !unary) {
    // Il fatto manca: il criterio resta aperto, e la schermata sa dire quale
    // dato lo chiuderebbe (§100).
    return { ...base, state: 'unknown', observedValue: null, valueSource: null, reasonCode: 'missing_fact' };
  }

  const actual = fact ? fact.value : null;
  const result = applyOperator(rule.operator, actual, rule.expectedValue);

  if (result === null) {
    return {
      ...base, state: 'not_evaluable',
      observedValue: displayValue(actual), valueSource: fact?.source ?? null,
      reasonCode: 'unknown_operator',
    };
  }

  return {
    ...base,
    state: result ? 'satisfied' : 'not_satisfied',
    observedValue: displayValue(actual),
    valueSource: fact?.source ?? null,
    reasonCode: 'auto',
  };
}

// ---------------------------------------------------------------------------
// Dall'insieme dei criteri allo stato di idoneità
// ---------------------------------------------------------------------------

export interface EligibilitySummary {
  status: import('./contract.ts').SubsidyEligibilityStatus;
  /** Il criterio che determina lo stato, quando ce n'è uno. */
  decidingRuleKey: string | null;
  satisfied: number;
  notSatisfied: number;
  unknown: number;
  notEvaluable: number;
  conflicting: number;
  hardOpen: number;
}

/**
 * ⚠️ NON ESISTE `eligible` (§47). Il valore più alto è `potentially_eligible`:
 * «i criteri che possiamo valutare sembrano soddisfatti». Dire di più
 * significherebbe sostituirsi all'autorità, che è l'unica a poter decidere.
 *
 * ⚠️ `ineligible` si produce SOLO da un'esclusione attivata o da un requisito
 * OBBLIGATORIO verificato come non soddisfatto — e sempre «rispetto ai criteri
 * pubblicati in questa versione» (§48). Un criterio non bloccante non
 * soddisfatto NON esclude (§49): abbassa la completezza, e basta.
 */
export function summarizeEligibility(outcomes: readonly CriterionOutcome[]): EligibilitySummary {
  let satisfied = 0, notSatisfied = 0, unknown = 0, notEvaluable = 0, conflicting = 0, hardOpen = 0;
  // ⚠️ CONTATORI SEPARATI PER I REQUISITI, e il difetto che chiudono è stato
  //    trovato da `test:subsidy-unit`, non rileggendo. Un'esclusione NON
  //    attivata ha stato `not_satisfied` — ed è una BUONA notizia: l'impresa
  //    non ricade nel caso che esclude. Contandola insieme ai requisiti falliti,
  //    un programma con una sola esclusione non attivata e nessun altro criterio
  //    finiva in `likely_ineligible`, cioè il contrario di ciò che i dati
  //    dicevano.
  let reqSatisfied = 0, reqNotSatisfied = 0;
  let exclusionHit: CriterionOutcome | null = null;
  let hardFail: CriterionOutcome | null = null;

  for (const o of outcomes) {
    if (o.state === 'satisfied') satisfied++;
    else if (o.state === 'not_satisfied') notSatisfied++;
    else if (o.state === 'unknown') unknown++;
    else if (o.state === 'not_evaluable') notEvaluable++;
    else if (o.state === 'conflicting') conflicting++;

    if (o.hardness === 'hard' || o.hardness === 'soft') {
      if (o.state === 'satisfied') reqSatisfied++;
      else if (o.state === 'not_satisfied') reqNotSatisfied++;
    }

    // ⚠️ Un'esclusione è «attivata» quando la condizione che esclude RISULTA
    //    VERA, cioè `satisfied`. È il contrario del requisito, e scambiarli
    //    escluderebbe esattamente le imprese che hanno diritto.
    if (o.hardness === 'exclusion' && o.state === 'satisfied' && !exclusionHit) exclusionHit = o;
    if (o.hardness === 'hard' && o.state === 'not_satisfied' && !hardFail) hardFail = o;
    if ((o.hardness === 'hard' || o.hardness === 'exclusion')
        && (o.state === 'unknown' || o.state === 'conflicting' || o.state === 'not_evaluable')) {
      hardOpen++;
    }
  }

  const counts = { satisfied, notSatisfied, unknown, notEvaluable, conflicting, hardOpen };

  if (exclusionHit) {
    return { status: 'ineligible', decidingRuleKey: exclusionHit.ruleKey, ...counts };
  }
  if (hardFail) {
    return { status: 'ineligible', decidingRuleKey: hardFail.ruleKey, ...counts };
  }
  if (outcomes.length === 0) {
    return { status: 'not_assessed', decidingRuleKey: null, ...counts };
  }
  if (hardOpen > 0) {
    // Un obbligatorio ancora aperto: non si può dire nulla di più che
    // «mancano informazioni». È lo stato più comune, ed è onesto che lo sia.
    return { status: 'insufficient_information', decidingRuleKey: null, ...counts };
  }
  if (reqNotSatisfied > 0 && reqSatisfied === 0) {
    // Solo criteri non bloccanti, e nessuno soddisfatto: il quadro è
    // sfavorevole ma non escludente. §49 vieta di trasformarlo in esclusione.
    // ⚠️ Si guardano i REQUISITI, non tutti gli esiti: un'esclusione non
    //    attivata è `not_satisfied` e significa il contrario.
    return { status: 'likely_ineligible', decidingRuleKey: null, ...counts };
  }
  if (unknown > 0 || notEvaluable > 0 || conflicting > 0) {
    return { status: 'insufficient_information', decidingRuleKey: null, ...counts };
  }
  return { status: 'potentially_eligible', decidingRuleKey: null, ...counts };
}

/**
 * La completezza: quanti criteri restano aperti sul totale (§43).
 *
 * ⚠️ È una misura del NOSTRO quadro informativo, non dell'impresa. Un'impresa
 * con dieci criteri aperti non è meno idonea: è meno valutata.
 */
export function summarizeCompleteness(outcomes: readonly CriterionOutcome[]): import('./contract.ts').CompletenessLevel {
  if (outcomes.length === 0) return 'major_gaps';
  const open = outcomes.filter(
    (o) => o.state === 'unknown' || o.state === 'not_evaluable' || o.state === 'conflicting',
  ).length;
  if (open === 0) return 'complete';
  // Un obbligatorio aperto pesa più di tre facoltativi: è quello che impedisce
  // di dire qualunque cosa.
  const hardOpen = outcomes.filter(
    (o) => (o.hardness === 'hard' || o.hardness === 'exclusion')
      && (o.state === 'unknown' || o.state === 'not_evaluable' || o.state === 'conflicting'),
  ).length;
  if (hardOpen > 0 || open / outcomes.length > 0.34) return 'major_gaps';
  return 'minor_gaps';
}
