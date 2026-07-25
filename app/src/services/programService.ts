// ============================================================================
// programService — catalogo dei programmi di incentivo letto dal DB (§ dati reali).
// Ricostruisce il ProgramModel (con gli split hard/soft ed evaluable/informative
// derivati) così il motore di matching (engine.ts) resta identico a prima.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import type { Database, Json } from '@/types/database';
import type { Exclusion, ProgramModel, Requirement, SupportType } from '@/features/subsidy-ai/programs';

type Row = Database['public']['Tables']['subsidy_programs']['Row'];

function toRequirements(v: Json): Requirement[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((r) => r as { id?: unknown; text?: unknown; question?: unknown; hard?: unknown })
    .filter((r) => r && typeof r.id === 'string' && typeof r.text === 'string')
    .map((r) => ({
      id: r.id as string,
      text: r.text as string,
      question: typeof r.question === 'string' ? r.question : (r.text as string),
      mustBe: 'si' as const,
      hard: r.hard === true,
    }));
}

function toExclusions(v: Json): Exclusion[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => x as { id?: unknown; text?: unknown; question?: unknown; triggeringAnswer?: unknown; evaluable?: unknown })
    .filter((x) => x && typeof x.text === 'string')
    .map((x, i) => ({
      id: typeof x.id === 'string' ? x.id : `excl-${i}`,
      text: x.text as string,
      question: typeof x.question === 'string' ? x.question : null,
      triggeringAnswer: typeof x.triggeringAnswer === 'string' ? x.triggeringAnswer : null,
      evaluable: x.evaluable === true,
    }));
}

function toProgram(row: Row): ProgramModel {
  const requirements = toRequirements(row.requirements);
  const exclusions = toExclusions(row.exclusions);
  return {
    id: row.id,
    name: row.name,
    authority: row.authority,
    supportType: (row.support_type as SupportType) || 'grant',
    geography: row.geography ?? [],
    targetSectors: row.target_sectors ?? [],
    companySize: { min: row.company_size_min, max: row.company_size_max },
    projectTypes: row.project_types ?? [],
    requirements,
    hardRequirements: requirements.filter((r) => r.hard),
    softRequirements: requirements.filter((r) => !r.hard),
    exclusions,
    evaluableExclusions: exclusions.filter((x) => x.evaluable),
    informativeExclusions: exclusions.filter((x) => !x.evaluable),
    contributionDescription: row.contribution_description ?? '',
    applicationWindow: row.application_window ?? '',
    mustApplyBeforeStart: row.must_apply_before_start,
    mustApplyBeforeStartText: row.must_apply_before_start_text,
    documentsRequired: row.documents_required ?? [],
    officialSourceUrl: row.official_source_url,
    sourceTitle: row.source_title ?? '',
    lastCheckedAt: row.last_checked_at,
    dataStatus: (row.data_status as ProgramModel['dataStatus']) || 'verified',
    // 0011 — solo il valore esplicito 'suspended' sospende. Un valore
    // sconosciuto (schema più recente del codice) non deve far sparire un
    // programma né dichiararlo indisponibile senza saperlo.
    availability: row.availability === 'suspended' ? 'suspended' : 'available',
    availabilityNote: row.availability_note ?? null,
    availabilitySourceUrl: row.availability_source_url ?? null,
    availabilityCheckedAt: row.availability_checked_at ?? null,
  };
}

export const programService = {
  /** Programmi attivi del catalogo, ricostruiti come ProgramModel. */
  async listActive(): Promise<ProgramModel[]> {
    const { data, error } = await requireSupabase()
      .from('subsidy_programs')
      .select('*')
      .eq('active', true)
      .order('id', { ascending: true });
    if (error) throw new AppError(toUserMessage(error), error);
    return (data ?? []).map(toProgram);
  },
};
