// ============================================================================
// companyService — aziende, membership, profilo azienda.
// Multi-tenant ready: un utente può appartenere a più aziende.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import type { Company, CompanyMembership, CompanyProfile, MemberRole } from '@/types/models';
import type { Database } from '@/types/database';
import { translate as tr } from '@/i18n';

type CompanyRow = Database['public']['Tables']['companies']['Row'];
type CompanyProfileRow = Database['public']['Tables']['company_profiles']['Row'];

function toCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    legalName: row.legal_name,
    uidChe: row.uid_che,
    canton: row.canton,
    municipality: row.municipality,
    legalForm: row.legal_form,
    createdAt: row.created_at,
  };
}

function toCompanyProfile(row: CompanyProfileRow): CompanyProfile {
  const projects = Array.isArray(row.current_projects) ? (row.current_projects as unknown[]).map(String) : [];
  return {
    companyId: row.company_id,
    sector: row.sector,
    employeeCount: row.employee_count,
    revenueBand: row.revenue_band,
    ownsProperty: row.owns_property,
    vehicleCount: row.vehicle_count,
    currentProjects: projects,
  };
}

export interface CreateCompanyInput {
  legalName: string;
  uidChe?: string | null;
  canton?: string | null;
  municipality?: string | null;
  legalForm?: string | null;
  sector?: string | null;
  employeeCount?: number | null;
  revenueBand?: string | null;
}

export const companyService = {
  /** Aziende dell'utente con il relativo ruolo (per il CompanyContext). */
  async listMemberships(userId: string): Promise<CompanyMembership[]> {
    const { data, error } = await requireSupabase()
      .from('company_members')
      .select('role, company:companies(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw new AppError(toUserMessage(error), error);
    const rows = (data ?? []) as unknown as { role: MemberRole; company: CompanyRow | null }[];
    return rows
      .filter((r) => r.company)
      .map((r) => ({ role: r.role, company: toCompany(r.company as CompanyRow) }));
  },

  async getCompany(companyId: string): Promise<Company | null> {
    const { data, error } = await requireSupabase().from('companies').select('*').eq('id', companyId).maybeSingle();
    if (error) throw new AppError(toUserMessage(error), error);
    return data ? toCompany(data) : null;
  },

  /** Onboarding: crea azienda + membership owner + profilo (RPC atomica). */
  async createCompanyWithOwner(input: CreateCompanyInput): Promise<string> {
    const { data, error } = await requireSupabase().rpc('create_company_with_owner', {
      p_legal_name: input.legalName,
      p_uid_che: input.uidChe ?? null,
      p_canton: input.canton ?? null,
      p_municipality: input.municipality ?? null,
      p_legal_form: input.legalForm ?? null,
      p_sector: input.sector ?? null,
      p_employee_count: input.employeeCount ?? null,
      p_revenue_band: input.revenueBand ?? null,
    });
    if (error) throw new AppError(toUserMessage(error), error);
    if (!data) throw new AppError(tr('errors.companyCreateFailed'));
    return data as string;
  },

  async updateCompany(companyId: string, patch: Partial<CreateCompanyInput>): Promise<void> {
    const { error } = await requireSupabase()
      .from('companies')
      .update({
        legal_name: patch.legalName,
        uid_che: patch.uidChe,
        canton: patch.canton,
        municipality: patch.municipality,
        legal_form: patch.legalForm,
      })
      .eq('id', companyId);
    if (error) throw new AppError(toUserMessage(error), error);
  },

  async getCompanyProfile(companyId: string): Promise<CompanyProfile | null> {
    const { data, error } = await requireSupabase()
      .from('company_profiles')
      .select('*')
      .eq('company_id', companyId)
      .maybeSingle();
    if (error) throw new AppError(toUserMessage(error), error);
    return data ? toCompanyProfile(data) : null;
  },

  /** Aggiorna/crea il profilo operativo (settore, progetti, immobili, veicoli…). */
  async upsertCompanyProfile(
    companyId: string,
    patch: Partial<Omit<CompanyProfile, 'companyId'>>,
  ): Promise<void> {
    const payload = {
      company_id: companyId,
      sector: patch.sector ?? null,
      employee_count: patch.employeeCount ?? null,
      revenue_band: patch.revenueBand ?? null,
      owns_property: patch.ownsProperty ?? false,
      vehicle_count: patch.vehicleCount ?? 0,
      current_projects: (patch.currentProjects ?? []) as unknown as Database['public']['Tables']['company_profiles']['Insert']['current_projects'],
    };
    const { error } = await requireSupabase().from('company_profiles').upsert(payload, { onConflict: 'company_id' });
    if (error) throw new AppError(toUserMessage(error), error);
  },
};
