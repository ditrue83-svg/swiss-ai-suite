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

/**
 * Applica le traduzioni del catalogo (0012) alla lingua richiesta.
 *
 * I testi italiani stanno nelle colonne base; `translations` contiene le altre
 * lingue. Requisiti ed esclusioni sono indicizzati per id, non per posizione,
 * così una traduzione non può finire agganciata alla voce sbagliata.
 *
 * Quando una lingua manca si mostrano i testi italiani — ma il programma lo
 * segnala con `showingFallbackLanguage`, e l'interfaccia lo dichiara: un
 * requisito in una lingua diversa da quella scelta, senza avviso, sembrerebbe
 * tradotto e non lo è.
 */
function pickTranslation(row: Row, lang: string) {
  const all = (row.translations && typeof row.translations === 'object' && !Array.isArray(row.translations))
    ? (row.translations as Record<string, unknown>) : {};
  const available = Object.keys(all);
  // L'italiano è la lingua base: non è una traduzione mancante.
  if (lang === 'it') return { tr: null as Record<string, unknown> | null, available, fallback: false };
  const tr = all[lang];
  if (!tr || typeof tr !== 'object') return { tr: null, available, fallback: true };
  return { tr: tr as Record<string, unknown>, available, fallback: false };
}

const str = (v: unknown, fb: string) => (typeof v === 'string' && v.trim() ? v : fb);
const strArr = (v: unknown, fb: string[]) =>
  Array.isArray(v) && v.every((x) => typeof x === 'string') && v.length ? (v as string[]) : fb;

function toProgram(row: Row, lang = 'it'): ProgramModel {
  const { tr, available, fallback } = pickTranslation(row, lang);
  const trReq = (tr?.requirements ?? {}) as Record<string, { text?: string; question?: string }>;
  const trExc = (tr?.exclusions ?? {}) as Record<string, { text?: string; question?: string }>;

  const requirements = toRequirements(row.requirements).map((r) => ({
    ...r,
    text: str(trReq[r.id]?.text, r.text),
    question: str(trReq[r.id]?.question, r.question),
  }));
  const exclusions = toExclusions(row.exclusions).map((x) => ({
    ...x,
    text: str(trExc[x.id]?.text, x.text),
    question: x.question === null ? null : str(trExc[x.id]?.question, x.question),
  }));
  return {
    id: row.id,
    name: str(tr?.name, row.name),
    authority: str(tr?.authority, row.authority),
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
    contributionDescription: str(tr?.contribution_description, row.contribution_description ?? ''),
    applicationWindow: str(tr?.application_window, row.application_window ?? ''),
    mustApplyBeforeStart: row.must_apply_before_start,
    mustApplyBeforeStartText: str(tr?.must_apply_before_start_text, row.must_apply_before_start_text ?? '') || null,
    documentsRequired: strArr(tr?.documents_required, row.documents_required ?? []),
    officialSourceUrl: row.official_source_url,
    sourceTitle: str(tr?.source_title, row.source_title ?? ''),
    lastCheckedAt: row.last_checked_at,
    dataStatus: (row.data_status as ProgramModel['dataStatus']) || 'verified',
    // 0011 — solo il valore esplicito 'suspended' sospende. Un valore
    // sconosciuto (schema più recente del codice) non deve far sparire un
    // programma né dichiararlo indisponibile senza saperlo.
    availability: row.availability === 'suspended' ? 'suspended' : 'available',
    availabilityNote: str(tr?.availability_note, row.availability_note ?? '') || null,
    availabilitySourceUrl: row.availability_source_url ?? null,
    availabilityCheckedAt: row.availability_checked_at ?? null,
    translatedInto: available,
    showingFallbackLanguage: fallback,
  };
}

export const programService = {
  /** Programmi attivi del catalogo, ricostruiti come ProgramModel. */
  async listActive(lang = 'it'): Promise<ProgramModel[]> {
    const { data, error } = await requireSupabase()
      .from('subsidy_programs')
      .select('*')
      .eq('active', true)
      .order('id', { ascending: true });
    if (error) throw new AppError(toUserMessage(error), error);
    return (data ?? []).map((r) => toProgram(r, lang));
  },
};
