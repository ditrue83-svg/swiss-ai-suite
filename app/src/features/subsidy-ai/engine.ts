// ============================================================================
// SUBSIDY AI — motore: RILEVANZA (fit progetto↔programma) separata da
// IDONEITÀ (hard/soft rules + esclusioni valutabili). Porting fedele.
// ============================================================================
import type { EligibilityStatus } from '@/types/models';
import {
  PROGRAMS_MODEL, labelTipo, type ProgramModel, type Requirement, type Exclusion,
} from './programs';

/** Profilo minimo per il matching (derivato da Company + CompanyProfile). */
export interface MatchProfile {
  canton: string | null;
  sector: string | null;
  employeeCount: number | null;
  projects: string[];
}

export interface Relevance { score: number; reasons: string[]; gaps: string[] }

// RILEVANZA: quanto il programma sembra pertinente al progetto. NON è la
// probabilità di ottenere il contributo.
export function computeRelevance(profile: MatchProfile, prog: ProgramModel): Relevance | null {
  const progetti = new Set(profile.projects || []);
  const reasons: string[] = [];
  const gaps: string[] = [];
  const geoOk = prog.geography.includes('ALL') || (profile.canton != null && prog.geography.includes(profile.canton));
  if (!geoOk) return null;
  let score = 0;
  if (!prog.geography.includes('ALL')) { score += 20; reasons.push(`Programma dedicato al Cantone ${profile.canton}`); }
  else { score += 16; reasons.push('Programma disponibile in tutta la Svizzera'); }
  const tipiMatch = prog.projectTypes.filter((t) => progetti.has(t));
  if (tipiMatch.length === 0) return null;
  score += Math.round(28 + 12 * (tipiMatch.length / prog.projectTypes.length));
  reasons.push('Progetto pertinente: ' + tipiMatch.map(labelTipo).join(', '));
  if (profile.sector && prog.targetSectors.includes(profile.sector)) { score += 20; reasons.push('Settore aziendale tra quelli ammessi'); }
  else if (prog.targetSectors.includes('ALL')) score += 16;
  else if (!profile.sector) { score += 10; gaps.push('Settore aziendale non indicato nel profilo'); }
  else { score += 4; gaps.push('Il settore indicato non è tra quelli tipicamente ammessi'); }
  const dip = profile.employeeCount;
  if (dip == null || !Number.isFinite(dip)) { score += 10; gaps.push('Numero di dipendenti non indicato'); }
  else if (dip >= prog.companySize.min && dip <= prog.companySize.max) { score += 20; reasons.push('Dimensione aziendale nel target'); }
  else gaps.push(`Dimensione fuori target (${prog.companySize.min}–${prog.companySize.max === 100000 ? '∞' : prog.companySize.max} dipendenti)`);
  return { score: Math.min(100, score), reasons, gaps };
}

export interface Priority { level: 'alta' | 'media' | 'bassa'; reason: string }
export function priorityOf(rel: number, prog: ProgramModel): Priority {
  if (prog.mustApplyBeforeStart && rel >= 65) return { level: 'alta', reason: 'Rilevante e con domanda da presentare prima di iniziare' };
  if (rel >= 60) return { level: 'media', reason: 'Programma rilevante da approfondire' };
  return { level: 'bassa', reason: 'Rilevanza moderata' };
}

export interface MatchResult {
  program: ProgramModel;
  relevanceScore: number;
  reasons: string[];
  profileGaps: string[];
  reqToVerify: number;
  priority: Priority;
}

// matching: ordina per RILEVANZA. L'idoneità NON entra nel punteggio.
export function matchPrograms(profile: MatchProfile): MatchResult[] {
  const out: MatchResult[] = [];
  for (const prog of PROGRAMS_MODEL) {
    const rel = computeRelevance(profile, prog);
    if (!rel || rel.score < 40) continue;
    out.push({
      program: prog, relevanceScore: rel.score, reasons: rel.reasons, profileGaps: rel.gaps,
      reqToVerify: prog.requirements.length + prog.evaluableExclusions.length,
      priority: priorityOf(rel.score, prog),
    });
  }
  return out.sort((a, b) => b.relevanceScore - a.relevanceScore);
}

// ---- Idoneità ---------------------------------------------------------------
export const ELIGIBILITY_LABEL: Record<EligibilityStatus, string> = {
  unknown: 'Requisiti da verificare', likely: 'Probabilmente idoneo',
  unlikely: 'Probabilmente non idoneo', ineligible: 'Non idoneo',
};
export const ELIGIBILITY_BADGE: Record<EligibilityStatus, string> = {
  unknown: 'media', likely: 'bassa', unlikely: 'alta', ineligible: 'alta',
};

export type QuizKind = 'hard' | 'excl' | 'soft';
export interface QuizQuestion { key: string; question: string; kind: QuizKind; ref: Requirement | Exclusion }

// Domande: hard requirements, poi esclusioni VALUTABILI (bloccanti), poi soft.
export function subsidyQuestions(prog: ProgramModel): QuizQuestion[] {
  return [
    ...prog.hardRequirements.map((r) => ({ key: r.id, question: r.question, kind: 'hard' as const, ref: r })),
    ...prog.evaluableExclusions.map((x) => ({ key: x.id, question: x.question ?? '', kind: 'excl' as const, ref: x })),
    ...prog.softRequirements.map((r) => ({ key: r.id, question: r.question, kind: 'soft' as const, ref: r })),
  ];
}

export type Answer = 'si' | 'no' | 'ns';
export interface EligibilityCause { type: 'exclusion' | 'requirement'; item: Requirement | Exclusion }
export interface EligibilityResult {
  status: EligibilityStatus;
  cause: EligibilityCause | null;
  satisfied: Requirement[];
  failed: Requirement[];
  unknown: Requirement[];
  exclusions: { triggered: Exclusion[]; cleared: Exclusion[]; unknown: Exclusion[]; informative: Exclusion[] };
  nextSteps: string[];
}

export function evaluateEligibility(prog: ProgramModel, answers: Record<string, string>): EligibilityResult {
  const satisfied: Requirement[] = [];
  const failed: Requirement[] = [];
  const unknown: Requirement[] = [];
  for (const r of prog.requirements) {
    const a = answers[r.id];
    if (a === r.mustBe) satisfied.push(r);
    else if (a === 'si' || a === 'no') failed.push(r);
    else unknown.push(r);
  }
  const exTriggered: Exclusion[] = [];
  const exCleared: Exclusion[] = [];
  const exUnknown: Exclusion[] = [];
  for (const x of prog.evaluableExclusions) {
    const a = answers[x.id];
    if (a === x.triggeringAnswer) exTriggered.push(x);
    else if (a === 'si' || a === 'no') exCleared.push(x);
    else exUnknown.push(x);
  }
  const hardFailed = failed.filter((r) => r.hard);
  const hardUnknown = unknown.some((r) => r.hard);
  let status: EligibilityStatus;
  let cause: EligibilityCause | null = null;
  if (exTriggered.length) { status = 'ineligible'; cause = { type: 'exclusion', item: exTriggered[0] }; }
  else if (hardFailed.length) { status = 'ineligible'; cause = { type: 'requirement', item: hardFailed[0] }; }
  else if (hardUnknown || exUnknown.length) status = 'unknown';
  else if (failed.length === 0 && unknown.length === 0) status = 'likely';
  else if (failed.length > 0 && satisfied.length === 0) status = 'unlikely';
  else status = 'unknown';
  return {
    status, cause, satisfied, failed, unknown,
    exclusions: { triggered: exTriggered, cleared: exCleared, unknown: exUnknown, informative: prog.informativeExclusions },
    nextSteps: [
      ...(status === 'ineligible' && cause ? [(cause.type === 'exclusion' ? 'Esclusione attivata' : 'Requisito obbligatorio non soddisfatto') + ': «' + cause.item.text + '». Il programma non sembra applicabile a questo caso.'] : []),
      ...(unknown.length > 0 || exUnknown.length > 0 ? ['Completare la verifica dei punti ancora aperti'] : []),
      ...(prog.informativeExclusions.length ? ['Verificare manualmente le esclusioni non ancora valutabili automaticamente'] : []),
      'Confermare condizioni, importi e scadenze sulla fonte ufficiale',
      ...(prog.mustApplyBeforeStart ? ["NON avviare il progetto/acquisto prima della conferma dell'ente"] : []),
      'Preparare i documenti richiesti per la candidatura',
    ],
  };
}
