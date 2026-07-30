// ============================================================================
// IL REGISTRO DEI FATTI — che cosa il motore può sapere di un'impresa e di un
// progetto, e DA DOVE lo sa.
//
// ⚠️ È IL PERIMETRO DELLA VALUTAZIONE, non un elenco di comodo. Un criterio del
// catalogo può nominare SOLO una di queste chiavi. Una chiave che non è qui non
// produce un ripiego: produce `not_evaluable`, cioè «questo criterio non
// sappiamo valutarlo». Un criterio che non sappiamo valutare NON è un criterio
// superato, ed è la differenza fra un prodotto che dichiara i propri limiti e
// uno che li nasconde.
//
// ⚠️ CHE COSA NON C'È, E NON PER DIMENTICANZA (§39, §40):
//   · `company.revenue` dedotta dalle fatture di Finanze — il fatturato non è
//     la somma delle fatture ricevute, e chiamarlo così sarebbe un dato falso
//     su cui un ente potrebbe basare una decisione;
//   · `company.employee_count` dedotta dai contatti del CRM — i contatti sono
//     le persone che conosciamo, non i dipendenti;
//   · `company.exports` dedotta dalle email in lingua straniera;
//   · `company.is_startup` dedotta dalla data del primo documento;
//   · `project.is_innovative` dedotta dalla presenza della parola «AI».
//   Sono tutte deduzioni plausibili e tutte sbagliate. Il modo per non farle è
//   non avere la chiave con cui scriverle.
//
// Modulo PORTABILE: nessun import, nessuna API di runtime.
// ============================================================================

import type { FactSource } from './contract.ts';
import { FACT_SOURCE_AUTHORITY } from './contract.ts';

export type FactValueType = 'string' | 'number' | 'boolean' | 'date' | 'enum' | 'string_list';

export interface FactDefinition {
  key: string;
  type: FactValueType;
  /** Chiave di traduzione dell'etichetta. MAI testo: comparirebbe in tedesco. */
  labelKey: string;
  /** Valori ammessi, per i fatti di tipo enum. */
  options?: readonly string[];
  /**
   * Dove si compila, se manca. Serve alla frase operativa «aggiungendo il
   * numero di dipendenti potremo valutare 4 criteri in più» (§100), che è
   * un'informazione azionabile — al contrario di «profilo completo al 47%».
   */
  fillIn: 'company_profile' | 'company_settings' | 'project' | 'answer';
}

/**
 * I fatti dell'IMPRESA. Vengono da `companies`, `company_profiles` e dal
 * registro IDI: dati che l'impresa ha dichiarato o che un registro pubblico
 * attesta (§37).
 */
export const COMPANY_FACTS: readonly FactDefinition[] = [
  { key: 'company.canton', type: 'string', labelKey: 'subsidy.facts.companyCanton', fillIn: 'company_settings' },
  { key: 'company.country', type: 'string', labelKey: 'subsidy.facts.companyCountry', fillIn: 'company_settings' },
  { key: 'company.legal_form', type: 'string', labelKey: 'subsidy.facts.legalForm', fillIn: 'company_settings' },
  { key: 'company.sector', type: 'enum', labelKey: 'subsidy.facts.sector', fillIn: 'company_profile' },
  { key: 'company.employee_count', type: 'number', labelKey: 'subsidy.facts.employeeCount', fillIn: 'company_profile' },
  // ⚠️ Solo se l'IDI ha superato la cifra di controllo: un IDI non verificato
  //    non identifica nessuno (0026).
  { key: 'company.has_uid', type: 'boolean', labelKey: 'subsidy.facts.hasUid', fillIn: 'company_settings' },
  { key: 'company.owns_property', type: 'boolean', labelKey: 'subsidy.facts.ownsProperty', fillIn: 'company_profile' },
  { key: 'company.vehicle_count', type: 'number', labelKey: 'subsidy.facts.vehicleCount', fillIn: 'company_profile' },
];

/** I fatti del PROGETTO. Vengono dai campi strutturati di `subsidy_projects`. */
export const PROJECT_FACTS: readonly FactDefinition[] = [
  { key: 'project.stage', type: 'enum', labelKey: 'subsidy.facts.stage',
    options: ['idea', 'planned', 'started', 'completed', 'cancelled'], fillIn: 'project' },
  { key: 'project.types', type: 'string_list', labelKey: 'subsidy.facts.projectTypes', fillIn: 'project' },
  { key: 'project.canton', type: 'string', labelKey: 'subsidy.facts.projectCanton', fillIn: 'project' },
  { key: 'project.country', type: 'string', labelKey: 'subsidy.facts.projectCountry', fillIn: 'project' },
  { key: 'project.sector', type: 'enum', labelKey: 'subsidy.facts.projectSector', fillIn: 'project' },
  { key: 'project.budget_amount', type: 'number', labelKey: 'subsidy.facts.budget', fillIn: 'project' },
  { key: 'project.budget_currency', type: 'string', labelKey: 'subsidy.facts.budgetCurrency', fillIn: 'project' },
  { key: 'project.start_date', type: 'date', labelKey: 'subsidy.facts.startDate', fillIn: 'project' },
  { key: 'project.end_date', type: 'date', labelKey: 'subsidy.facts.endDate', fillIn: 'project' },
  { key: 'project.employee_impact', type: 'number', labelKey: 'subsidy.facts.employeeImpact', fillIn: 'project' },
  { key: 'project.has_research_partner', type: 'boolean', labelKey: 'subsidy.facts.researchPartner', fillIn: 'project' },
  { key: 'project.has_innovation_partner', type: 'boolean', labelKey: 'subsidy.facts.innovationPartner', fillIn: 'project' },
  { key: 'project.has_international_partners', type: 'boolean', labelKey: 'subsidy.facts.internationalPartners', fillIn: 'project' },
  // ⚠️ Derivato da `project.stage`, non da una data: «già avviato» è uno stato
  //    che una persona dichiara. È il fatto più importante del registro, perché
  //    moltissimi programmi vogliono la domanda PRIMA dell'avvio (§71).
  { key: 'project.not_started', type: 'boolean', labelKey: 'subsidy.facts.notStarted', fillIn: 'project' },
];

export const ALL_FACTS: readonly FactDefinition[] = [...COMPANY_FACTS, ...PROJECT_FACTS];

const FACT_INDEX = new Map<string, FactDefinition>(ALL_FACTS.map((f) => [f.key, f]));

export function findFact(key: string): FactDefinition | null {
  return FACT_INDEX.get(key) ?? null;
}

export function isKnownFactKey(key: string): boolean {
  return FACT_INDEX.has(key);
}

// ---------------------------------------------------------------------------
// Il valore di un fatto, con la sua provenienza
// ---------------------------------------------------------------------------

export type FactPrimitive = string | number | boolean | string[] | null;

export interface Fact {
  value: FactPrimitive;
  source: FactSource;
  /**
   * Quanto è affidabile, fra 0 e 1. ⚠️ Un valore dichiarato da una persona o
   * letto da un registro non ha un punteggio: vale 1. Il punteggio esiste per
   * ciò che viene dall'AI, che è l'unica fonte che può sbagliarsi in silenzio.
   */
  confidence: number;
  /** Da dove viene, in forma leggibile: un id di documento, una citazione, «profilo». */
  reference?: string | null;
}

export type FactMap = Record<string, Fact>;

/**
 * Un fatto è NOTO quando ha un valore. ⚠️ `false` è un valore noto: dire che
 * «non ha un partner di ricerca» è un'informazione, e trattarla come assenza
 * significherebbe non poter mai valutare un criterio negativo.
 */
export function isKnown(fact: Fact | undefined | null): boolean {
  if (!fact) return false;
  if (fact.value === null || fact.value === undefined) return false;
  if (Array.isArray(fact.value)) return fact.value.length > 0;
  if (typeof fact.value === 'string') return fact.value.trim().length > 0;
  return true;
}

/**
 * Risolve due candidati per lo stesso fatto (§36).
 *
 * ⚠️ Quando due fonti di autorità DIVERSA si contraddicono, vince la più
 * autorevole e basta: è il caso normale, e dichiararlo un conflitto
 * riempirebbe la schermata di allarmi su cose già decise. Quando l'autorità è
 * la STESSA e i valori differiscono, il conflitto è vero e va detto — sceglierne
 * uno in silenzio significherebbe inventare quale delle due fonti è giusta.
 */
export function resolveFact(a: Fact | null, b: Fact | null): { fact: Fact | null; conflicting: boolean } {
  if (!isKnown(a) && !isKnown(b)) return { fact: a ?? b, conflicting: false };
  if (!isKnown(a)) return { fact: b, conflicting: false };
  if (!isKnown(b)) return { fact: a, conflicting: false };

  const fa = a as Fact;
  const fb = b as Fact;
  const wa = FACT_SOURCE_AUTHORITY[fa.source] ?? 0;
  const wb = FACT_SOURCE_AUTHORITY[fb.source] ?? 0;

  const same = JSON.stringify(fa.value) === JSON.stringify(fb.value);
  if (same) return { fact: wa >= wb ? fa : fb, conflicting: false };

  if (wa === wb) return { fact: fa, conflicting: true };
  return { fact: wa > wb ? fa : fb, conflicting: false };
}

/** Unisce più mappe di fatti risolvendo i conflitti. L'ordine non conta. */
export function mergeFacts(...maps: FactMap[]): { facts: FactMap; conflicts: string[] } {
  const out: FactMap = {};
  const conflicts: string[] = [];
  for (const map of maps) {
    for (const [key, fact] of Object.entries(map)) {
      const existing = out[key] ?? null;
      const { fact: winner, conflicting } = resolveFact(existing, fact);
      if (winner) out[key] = winner;
      if (conflicting && !conflicts.includes(key)) conflicts.push(key);
    }
  }
  return { facts: out, conflicts };
}

/**
 * Il fatto derivato `project.not_started`.
 *
 * ⚠️ `idea` e `planned` sono «non ancora avviato»; `started` e `completed` sono
 * «avviato»; `cancelled` NON produce alcun valore, perché di un progetto
 * annullato la domanda non ha senso e rispondere `false` sarebbe una risposta
 * a una domanda che nessuno ha fatto.
 */
export function deriveNotStarted(stage: string | null | undefined): boolean | null {
  if (stage === 'idea' || stage === 'planned') return true;
  if (stage === 'started' || stage === 'completed') return false;
  return null;
}
