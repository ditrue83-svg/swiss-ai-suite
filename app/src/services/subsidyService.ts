// ============================================================================
// subsidyService — attività incentivi persistite: match (idoneità valutata) e
// pratiche (con checklist documenti). I programmi restano nel dataset demo.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { translate as tr } from '@/i18n';
import type { EligibilityStatus, SubsidyCase, SubsidyCaseItem, SubsidyCaseStatus, SubsidyMatch } from '@/types/models';
import type { Database, Json } from '@/types/database';
import type { ProgramModel } from '@/features/subsidy-ai/programs';
import type { EligibilityResult } from '@/features/subsidy-ai/engine';

type MatchRow = Database['public']['Tables']['subsidy_matches']['Row'];
type CaseRow = Database['public']['Tables']['subsidy_cases']['Row'];
type CaseItemRow = Database['public']['Tables']['subsidy_case_items']['Row'];

const asStringArray = (v: Json): string[] => (Array.isArray(v) ? v.map(String) : []);

function toMatch(row: MatchRow): SubsidyMatch {
  return {
    id: row.id,
    companyId: row.company_id,
    programId: row.program_id,
    relevanceScore: row.relevance_score,
    eligibilityStatus: row.eligibility_status,
    answers: (row.answers && typeof row.answers === 'object' && !Array.isArray(row.answers) ? (row.answers as Record<string, string>) : {}),
    satisfiedRequirements: asStringArray(row.satisfied_requirements),
    unknownRequirements: asStringArray(row.unknown_requirements),
    failedRequirements: asStringArray(row.failed_requirements),
    sourceLastCheckedAt: row.source_last_checked_at,
    evaluatedAt: row.evaluated_at,
  };
}

function toCaseItem(row: CaseItemRow): SubsidyCaseItem {
  return { id: row.id, subsidyCaseId: row.subsidy_case_id, title: row.title, completed: row.completed, sortOrder: row.sort_order };
}

function toCase(row: CaseRow, items: SubsidyCaseItem[] = []): SubsidyCase {
  return {
    id: row.id,
    companyId: row.company_id,
    createdBy: row.created_by,
    programId: row.program_id,
    programName: row.program_name,
    authority: row.authority,
    status: row.status,
    eligibilityStatusAtCreation: row.eligibility_status_at_creation,
    relevanceScore: row.relevance_score,
    sourceLastCheckedAt: row.source_last_checked_at,
    eligibilitySnapshot: row.eligibility_snapshot,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    items,
  };
}

export interface UpsertMatchInput {
  companyId: string;
  programId: string;
  relevanceScore: number | null;
  eligibilityStatus: EligibilityStatus;
  answers: Record<string, string>;
  satisfiedRequirements: string[];
  unknownRequirements: string[];
  failedRequirements: string[];
  sourceLastCheckedAt: string | null;
}

export type CaseKind = 'candidatura' | 'preliminare' | 'riferimento';

export interface CreateCaseInput {
  companyId: string;
  userId: string;
  program: ProgramModel;
  verdict: EligibilityResult;
  relevanceScore: number | null;
  kind: CaseKind;
}

export const subsidyService = {
  // ---- Match (idoneità valutata per programma) ----
  async listMatches(companyId: string): Promise<SubsidyMatch[]> {
    const { data, error } = await requireSupabase()
      .from('subsidy_matches')
      .select('*')
      .eq('company_id', companyId)
      .order('evaluated_at', { ascending: false });
    if (error) throw new AppError(toUserMessage(error), error);
    return (data ?? []).map(toMatch);
  },

  async upsertMatch(input: UpsertMatchInput): Promise<SubsidyMatch> {
    const payload: Database['public']['Tables']['subsidy_matches']['Insert'] = {
      company_id: input.companyId,
      program_id: input.programId,
      relevance_score: input.relevanceScore,
      eligibility_status: input.eligibilityStatus,
      answers: input.answers as unknown as Json,
      satisfied_requirements: input.satisfiedRequirements as unknown as Json,
      unknown_requirements: input.unknownRequirements as unknown as Json,
      failed_requirements: input.failedRequirements as unknown as Json,
      source_last_checked_at: input.sourceLastCheckedAt,
      evaluated_at: new Date().toISOString(),
    };
    const { data, error } = await requireSupabase()
      .from('subsidy_matches')
      .upsert(payload, { onConflict: 'company_id,program_id' })
      .select('*')
      .single();
    if (error || !data) throw new AppError(toUserMessage(error), error);
    return toMatch(data);
  },

  // ---- Pratiche ----
  async listCases(companyId: string): Promise<SubsidyCase[]> {
    const sb = requireSupabase();
    const { data: cases, error } = await sb
      .from('subsidy_cases')
      .select('*')
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (error) throw new AppError(toUserMessage(error), error);
    const list = cases ?? [];
    if (list.length === 0) return [];

    const ids = list.map((c) => c.id);
    const { data: items, error: iErr } = await sb
      .from('subsidy_case_items')
      .select('*')
      .in('subsidy_case_id', ids)
      .order('sort_order', { ascending: true });
    if (iErr) throw new AppError(toUserMessage(iErr), iErr);

    const byCase = new Map<string, SubsidyCaseItem[]>();
    for (const it of items ?? []) {
      const arr = byCase.get(it.subsidy_case_id) ?? [];
      arr.push(toCaseItem(it));
      byCase.set(it.subsidy_case_id, arr);
    }
    return list.map((c) => toCase(c, byCase.get(c.id) ?? []));
  },

  async createCase(input: CreateCaseInput): Promise<SubsidyCase> {
    const sb = requireSupabase();
    const { program, verdict } = input;
    const snapshot = {
      kind: input.kind,
      eligibilityStatus: verdict.status,
      satisfiedRequirements: verdict.satisfied.map((r) => r.text),
      unknownRequirements: verdict.unknown.map((r) => r.text),
      failedRequirements: verdict.failed.map((r) => r.text),
      nextSteps: verdict.nextSteps,
      applicationWindow: program.applicationWindow,
      mustApplyBeforeStart: program.mustApplyBeforeStart,
      officialSourceUrl: program.officialSourceUrl,
    };
    const casePayload: Database['public']['Tables']['subsidy_cases']['Insert'] = {
      company_id: input.companyId,
      created_by: input.userId,
      program_id: program.id,
      program_name: program.name,
      authority: program.authority,
      status: 'draft',
      eligibility_status_at_creation: verdict.status,
      relevance_score: input.relevanceScore,
      source_last_checked_at: program.lastCheckedAt,
      eligibility_snapshot: snapshot as unknown as Json,
    };
    const { data: created, error } = await sb.from('subsidy_cases').insert(casePayload).select('*').single();
    if (error || !created) throw new AppError(toUserMessage(error), error);

    const itemsPayload: Database['public']['Tables']['subsidy_case_items']['Insert'][] =
      program.documentsRequired.map((d, i) => ({
        subsidy_case_id: created.id,
        title: tr('subsidy.cases.prepareItem', { doc: d }),
        completed: false,
        sort_order: i,
      }));
    let items: SubsidyCaseItem[] = [];
    if (itemsPayload.length) {
      const { data: itemRows, error: iErr } = await sb.from('subsidy_case_items').insert(itemsPayload).select('*');
      if (iErr) throw new AppError(toUserMessage(iErr), iErr);
      items = (itemRows ?? []).map(toCaseItem);
    }
    return toCase(created, items);
  },

  async setCaseStatus(id: string, status: SubsidyCaseStatus): Promise<void> {
    const { error } = await requireSupabase().from('subsidy_cases').update({ status }).eq('id', id);
    if (error) throw new AppError(toUserMessage(error), error);
  },

  async setItemCompleted(itemId: string, completed: boolean): Promise<void> {
    const { error } = await requireSupabase().from('subsidy_case_items').update({ completed }).eq('id', itemId);
    if (error) throw new AppError(toUserMessage(error), error);
  },

  async removeCase(id: string): Promise<void> {
    const { error } = await requireSupabase().from('subsidy_cases').delete().eq('id', id);
    if (error) throw new AppError(toUserMessage(error), error);
  },
};
