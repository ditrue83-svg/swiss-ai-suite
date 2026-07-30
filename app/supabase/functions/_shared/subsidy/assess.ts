// ============================================================================
// LA VALUTAZIONE COMPLETA — dove le sei misure si mettono insieme senza
// diventare un punteggio solo.
//
// ⚠️ SEI MISURE, SEI COLONNE (§43): rilevanza, idoneità, completezza,
// tempistica, freschezza, prontezza. Comprimerle in un numero unico è
// precisamente il modo in cui un prodotto del genere comincia a mentire: un
// «78%» che mescola «il programma ti riguarda» con «la call è aperta» e «ti
// mancano tre dati» non risponde a nessuna delle tre domande.
//
// ⚠️ IL FINGERPRINT È L'IDEMPOTENZA (§60, §181). Stessi ingressi, stessa
// versione, stessa call, stesso motore → nessuna valutazione nuova. Senza, il
// worker riscriverebbe una riga di storico ogni cinque minuti e la «storia
// delle valutazioni» diventerebbe rumore in cui il cambiamento vero non si
// distingue più.
//
// Modulo PORTABILE: nessun import di runtime.
// ============================================================================

import type {
  CompletenessLevel, FreshnessLevel, RelevanceLevel, SubsidyEligibilityStatus, TimingState,
} from './contract.ts';
import { SUBSIDY_ENGINE_VERSION } from './contract.ts';
import type { FactMap } from './facts.ts';
import { isKnown, isKnownFactKey } from './facts.ts';
import type { AnswerValue, CriterionOutcome, SubsidyRule } from './rules.ts';
import { evaluateRule, summarizeCompleteness, summarizeEligibility } from './rules.ts';
import type { RelevanceResult } from './relevance.ts';
import type { CallLike } from './timing.ts';
import { computeFreshness, computeTiming, worstFreshness } from './timing.ts';

// ---------------------------------------------------------------------------
// Impronta deterministica
// ---------------------------------------------------------------------------

/**
 * FNV-1a a 64 bit su BigInt.
 *
 * ⚠️ NON è una funzione crittografica e non deve diventarlo: serve a dire «gli
 * ingressi sono gli stessi di prima», non a proteggere qualcosa. È sincrona di
 * proposito — l'alternativa (`crypto.subtle.digest`) è asincrona e avrebbe reso
 * asincrona tutta la catena di valutazione per un uso che non lo richiede. Per
 * l'impronta dei CONTENUTI delle fonti si usa invece SHA-256, in `hash.ts`.
 */
export function fnv1a64(input: string): string {
  let h = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * Serializzazione CANONICA: chiavi ordinate a ogni livello.
 *
 * ⚠️ `JSON.stringify` da solo NON basta: l'ordine delle chiavi di un oggetto
 * dipende da come è stato costruito, quindi due mappe di fatti identiche
 * potrebbero produrre due impronte diverse — e il worker rivaluterebbe
 * all'infinito senza che nulla sia cambiato.
 */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  return JSON.stringify(value);
}

export interface FingerprintInput {
  programVersionId: string;
  callId: string | null;
  /** Solo i fatti USATI, non l'intero profilo: un dato che nessun criterio
   *  guarda non deve far ripartire una valutazione. */
  facts: FactMap;
  answers: Record<string, AnswerValue>;
  /** Lo stato della call che entra nella tempistica. */
  callState: string;
  engineVersion?: string;
}

export function assessmentFingerprint(input: FingerprintInput): string {
  const factPart: Record<string, unknown> = {};
  for (const [k, f] of Object.entries(input.facts)) {
    // ⚠️ Entrano valore E provenienza: lo stesso valore che arriva da una
    //    risposta esplicita invece che da un'interpretazione AI è un fatto
    //    diverso, perché cambia la fiducia con cui la schermata lo mostra.
    factPart[k] = { v: f.value, s: f.source };
  }
  return fnv1a64(canonicalize({
    v: input.programVersionId,
    c: input.callId,
    f: factPart,
    a: input.answers,
    s: input.callState,
    e: input.engineVersion ?? SUBSIDY_ENGINE_VERSION,
  }));
}

// ---------------------------------------------------------------------------
// La valutazione
// ---------------------------------------------------------------------------

export interface AssessInput {
  programVersionId: string;
  rules: readonly SubsidyRule[];
  facts: FactMap;
  conflicts: readonly string[];
  answers: Record<string, AnswerValue>;
  relevance: RelevanceResult;
  call: CallLike | null;
  /** Quando è stato verificato l'ultima volta ciascun tipo di dato. */
  checkedAt: {
    requirements: string | null;
    availability: string | null;
    call: string | null;
  };
  today: string;
}

export interface AssessResult {
  relevanceLevel: RelevanceLevel;
  relevanceScore: number;
  relevanceReasons: RelevanceResult['reasons'];
  eligibilityStatus: SubsidyEligibilityStatus;
  decidingRuleKey: string | null;
  completeness: CompletenessLevel;
  timing: TimingState;
  freshness: FreshnessLevel;
  criteria: CriterionOutcome[];
  /** Le chiavi dei fatti che servivano a un criterio e non c'erano (§100). */
  missingFacts: string[];
  conflicts: string[];
  fingerprint: string;
  engineVersion: string;
}

export function assess(input: AssessInput): AssessResult {
  const criteria = input.rules
    .map((r) => evaluateRule(r, input.facts, input.answers[r.ruleKey] ?? null, input.conflicts))
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const eligibility = summarizeEligibility(criteria);
  const completeness = summarizeCompleteness(criteria);
  const timing = computeTiming(input.call, input.today);

  // ⚠️ La freschezza è la PEGGIORE fra i tre tipi di dato, e la call entra
  //    solo se esiste: pretendere una data di controllo per una call che non
  //    c'è renderebbe `unverified` ogni programma a finestra continua.
  const levels: FreshnessLevel[] = [
    computeFreshness(input.checkedAt.requirements, 'requirements', input.today),
    computeFreshness(input.checkedAt.availability, 'availability', input.today),
  ];
  if (input.call) {
    levels.push(computeFreshness(input.checkedAt.call, 'call', input.today));
  }
  const freshness = worstFreshness(levels);

  // I fatti mancanti: quelli nominati da un criterio rimasto aperto per
  // assenza del dato. ⚠️ Solo quelli NOTI al registro — una chiave che il
  // motore non conosce non è un dato che l'utente possa aggiungere, e metterla
  // in «cosa manca» manderebbe a cercare qualcosa che non esiste.
  const missing = new Set<string>();
  for (const c of criteria) {
    if (c.reasonCode !== 'missing_fact') continue;
    const rule = input.rules.find((r) => r.ruleKey === c.ruleKey);
    if (rule?.factKey && isKnownFactKey(rule.factKey) && !isKnown(input.facts[rule.factKey])) {
      missing.add(rule.factKey);
    }
  }

  const fingerprint = assessmentFingerprint({
    programVersionId: input.programVersionId,
    callId: input.call ? (input.call as CallLike & { id?: string }).id ?? null : null,
    facts: input.facts,
    answers: input.answers,
    callState: timing,
  });

  return {
    relevanceLevel: input.relevance.level,
    relevanceScore: input.relevance.score,
    relevanceReasons: input.relevance.reasons,
    eligibilityStatus: eligibility.status,
    decidingRuleKey: eligibility.decidingRuleKey,
    completeness,
    timing,
    freshness,
    criteria,
    missingFacts: [...missing].sort(),
    conflicts: [...input.conflicts].sort(),
    fingerprint,
    engineVersion: SUBSIDY_ENGINE_VERSION,
  };
}

/**
 * Quanti criteri si chiuderebbero aggiungendo un certo dato (§100).
 *
 * ⚠️ È la differenza fra «profilo incompleto al 47%» — che non dice a nessuno
 * che cosa fare — e «aggiungendo il numero di dipendenti valuteremo 4 criteri
 * in più», che è un'istruzione. La prima è una metrica, la seconda è un aiuto.
 */
export function factImpact(
  rules: readonly SubsidyRule[],
  outcomes: readonly CriterionOutcome[],
): Record<string, number> {
  const byKey = new Map(rules.map((r) => [r.ruleKey, r]));
  const out: Record<string, number> = {};
  for (const o of outcomes) {
    if (o.reasonCode !== 'missing_fact') continue;
    const rule = byKey.get(o.ruleKey);
    if (!rule?.factKey || !isKnownFactKey(rule.factKey)) continue;
    out[rule.factKey] = (out[rule.factKey] ?? 0) + 1;
  }
  return out;
}
