// ============================================================================
// companyService — aziende, membership, profilo azienda.
// Multi-tenant ready: un utente può appartenere a più aziende.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import type { Company, CompanyMembership, MemberRole } from '@/types/models';
import type { Database } from '@/types/database';
import { translate as tr } from '@/i18n';

type CompanyRow = Database['public']['Tables']['companies']['Row'];

function toCompany(row: CompanyRow): Company {
  return {
    id: row.id,
    legalName: row.legal_name,
    uidChe: row.uid_che,
    canton: row.canton,
    municipality: row.municipality,
    legalForm: row.legal_form,
    street: row.street,
    postalCode: row.postal_code,
    city: row.city,
    countryCode: row.country_code,
    logoStoragePath: row.logo_storage_path,
    logoMimeType: row.logo_mime_type,
    createdAt: row.created_at,
  };
}

export interface CreateCompanyInput {
  legalName: string;
  uidChe?: string | null;
  canton?: string | null;
  municipality?: string | null;
  legalForm?: string | null;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  countryCode?: string | null;
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

  /** Onboarding: crea azienda + membership owner in una RPC atomica. */
  async createCompanyWithOwner(input: CreateCompanyInput): Promise<string> {
    const { data, error } = await requireSupabase().rpc('create_company_with_owner', {
      p_legal_name: input.legalName,
      p_uid_che: input.uidChe ?? null,
      p_canton: input.canton ?? null,
      p_municipality: input.municipality ?? null,
      p_legal_form: input.legalForm ?? null,
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
        street: patch.street,
        postal_code: patch.postalCode,
        city: patch.city,
        country_code: patch.countryCode,
      })
      .eq('id', companyId);
    if (error) throw new AppError(toUserMessage(error), error);
  },

  /** Logo del documento commerciale: PNG/JPEG, 2 MB, percorso stabile per azienda. */
  async uploadQuoteLogo(companyId: string, file: File): Promise<void> {
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 2 * 1024 * 1024) {
      throw new AppError(tr('companySettings.logoInvalid'));
    }
    const path = `${companyId}/company/logo`;
    const sb = requireSupabase();
    const { error: uploadError } = await sb.storage.from('company-documents')
      .upload(path, file, { contentType: file.type, upsert: true });
    if (uploadError) throw new AppError(toUserMessage(uploadError), uploadError);
    const { error } = await sb.from('companies').update({
      logo_storage_path: path, logo_mime_type: file.type,
    }).eq('id', companyId);
    if (error) throw new AppError(toUserMessage(error), error);
  },

  async removeQuoteLogo(companyId: string): Promise<void> {
    const sb = requireSupabase();
    const { error } = await sb.from('companies').update({
      logo_storage_path: null, logo_mime_type: null,
    }).eq('id', companyId);
    if (error) throw new AppError(toUserMessage(error), error);
    // Il metadato viene tolto prima: se Storage fallisce non resta un logo
    // visibile che punti a un file mancante, soltanto un file orfano invisibile.
    await sb.storage.from('company-documents').remove([`${companyId}/company/logo`]);
  },

};
