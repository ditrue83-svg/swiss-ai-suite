// ============================================================================
// L'ACCESSO AL DATABASE del modulo Incentivi.
//
// ⚠️ QUI SI USA IL RUOLO DI SERVIZIO, e per un motivo preciso: questo codice
// gira in un worker senza sessione utente e deve poter leggere il catalogo e
// scrivere valutazioni per conto di aziende diverse. È il contrario della
// regola dell'assistente, dove le letture usano il client dell'UTENTE perché
// lì una sessione c'è.
//
// ⚠️ CONSEGUENZA: OGNI FUNZIONE DI QUESTO FILE DEVE DIFENDERSI DA SOLA. Con il
// service role la RLS non filtra niente, quindi ogni query nomina esplicitamente
// la propria `company_id` e nessuna la riceve dal chiamante senza averla letta
// da una riga. È la lezione della 0017: una funzione che scavalca la RLS non
// può fidarsi di una policy scritta altrove.
// ============================================================================

import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import type { SubsidyRule } from './rules.ts';
import type { CallLike } from './timing.ts';
import type { RelevanceProgram } from './relevance.ts';

export interface PublishedProgram {
  programId: string;
  versionId: string;
  versionNumber: number;
  name: string;
  authority: string;
  supportType: string;
  officialSourceUrl: string;
  lastCheckedAt: string | null;
  availabilityCheckedAt: string | null;
  relevance: RelevanceProgram;
  rules: SubsidyRule[];
}

/**
 * Il catalogo attivo: SOLO le versioni pubblicate correnti (§172).
 *
 * ⚠️ Non si confronta un progetto con tutte le versioni storiche. Le vecchie
 * servono a rileggere le pratiche, non a produrre match nuovi: interrogarle
 * moltiplicherebbe il lavoro per il numero di revisioni che un programma ha
 * avuto negli anni.
 */
export async function loadPublishedCatalog(sb: SupabaseClient): Promise<PublishedProgram[]> {
  const { data: versions, error } = await sb
    .from('subsidy_program_versions')
    // ⚠️ IL NOME DEL VINCOLO VA DICHIARATO. Fra queste due tabelle ci sono DUE
    //    chiavi esterne — `subsidy_program_versions.program_id` verso il
    //    programma, e `subsidy_programs.current_version_id` verso la versione —
    //    e PostgREST rifiuta l'intera richiesta invece di sceglierne una. È la
    //    stessa classe del PGRST200 che aveva impedito al dettaglio del
    //    Document Hub di aprirsi, e nessun test poteva vederla: le prove sul
    //    database interrogano le tabelle una per una.
    .select('id, program_id, version_number, normalized_content, '
      + 'subsidy_programs!subsidy_program_versions_program_id_fkey!inner('
      + 'id, name, authority, support_type, geography, target_sectors, '
      + 'company_size_min, company_size_max, project_types, must_apply_before_start, '
      + 'official_source_url, last_checked_at, availability, availability_checked_at, lifecycle, active)')
    .eq('status', 'published');
  if (error) throw new Error(`catalog_read_failed: ${error.message}`);

  const rows = (versions ?? []) as unknown as Array<{
    id: string; program_id: string; version_number: number;
    normalized_content: Record<string, unknown> | null;
    subsidy_programs: {
      id: string; name: string; authority: string; support_type: string;
      geography: string[]; target_sectors: string[]; company_size_min: number;
      company_size_max: number; project_types: string[]; must_apply_before_start: boolean;
      official_source_url: string; last_checked_at: string | null;
      availability: string; availability_checked_at: string | null;
      lifecycle: string; active: boolean;
    };
  }>;

  const active = rows.filter((r) => r.subsidy_programs?.active && r.subsidy_programs.lifecycle !== 'retired');
  if (active.length === 0) return [];

  const { data: ruleRows, error: rErr } = await sb
    .from('subsidy_program_rules')
    .select('*')
    .in('program_version_id', active.map((r) => r.id))
    .order('sort_order', { ascending: true });
  if (rErr) throw new Error(`rules_read_failed: ${rErr.message}`);

  const byVersion = new Map<string, SubsidyRule[]>();
  for (const r of ruleRows ?? []) {
    const list = byVersion.get(r.program_version_id) ?? [];
    list.push({
      ruleKey: r.rule_key, label: r.label, factKey: r.fact_key,
      operator: r.operator, expectedValue: r.expected_value,
      hardness: r.hardness, evaluability: r.evaluability,
      question: r.question, sourceEvidence: r.source_evidence,
      sortOrder: r.sort_order,
    });
    byVersion.set(r.program_version_id, list);
  }

  return active.map((v) => {
    const p = v.subsidy_programs;
    const content = (v.normalized_content ?? {}) as Record<string, unknown>;
    return {
      programId: p.id,
      versionId: v.id,
      versionNumber: v.version_number,
      name: p.name,
      authority: p.authority,
      supportType: p.support_type,
      officialSourceUrl: p.official_source_url,
      lastCheckedAt: p.last_checked_at,
      availabilityCheckedAt: p.availability_checked_at,
      relevance: {
        programId: p.id,
        geography: p.geography ?? [],
        targetSectors: p.target_sectors ?? [],
        companySizeMin: p.company_size_min,
        companySizeMax: p.company_size_max,
        projectTypes: p.project_types ?? [],
        mustApplyBeforeStart: p.must_apply_before_start,
        requiresResearchPartner: content.requiresResearchPartner === true,
        availability: p.availability === 'suspended' ? 'suspended' : 'available',
        lifecycle: p.lifecycle === 'retired' ? 'retired' : p.lifecycle === 'draft' ? 'draft' : 'active',
      },
      rules: byVersion.get(v.id) ?? [],
    };
  });
}

/**
 * La call da usare per un programma.
 *
 * ⚠️ SI PRENDE LA PIÙ PERTINENTE, NON LA PIÙ RECENTE: una call aperta batte
 * una futura, una futura batte una chiusa. Prendere l'ultima creata
 * assocerebbe un'opportunità a una finestra chiusa solo perché è stata
 * inserita dopo (§161).
 */
export async function loadCurrentCalls(
  sb: SupabaseClient, programIds: readonly string[],
): Promise<Map<string, CallLike & { id: string }>> {
  const out = new Map<string, CallLike & { id: string }>();
  if (programIds.length === 0) return out;

  const { data, error } = await sb
    .from('subsidy_calls')
    .select('id, program_id, status, opens_on, deadline_on, deadline_at, continuous, checked_at')
    .in('program_id', [...programIds]);
  if (error) throw new Error(`calls_read_failed: ${error.message}`);

  const rank: Record<string, number> = {
    open: 0, continuous: 1, upcoming: 2, unknown: 3, suspended: 4, closed: 5,
  };
  for (const c of data ?? []) {
    const current = out.get(c.program_id);
    const candidate = {
      id: c.id, status: c.status, opensOn: c.opens_on, deadlineOn: c.deadline_on,
      deadlineAt: c.deadline_at, continuous: c.continuous, checkedAt: c.checked_at,
    } as CallLike & { id: string };
    if (!current || (rank[candidate.status] ?? 9) < (rank[current.status] ?? 9)) {
      out.set(c.program_id, candidate);
    }
  }
  return out;
}

export interface CompanyFactsRow {
  companyId: string;
  canton: string | null;
  country: string | null;
  legalForm: string | null;
  uidChe: string | null;
  sector: string | null;
  employeeCount: number | null;
  ownsProperty: boolean | null;
  vehicleCount: number | null;
}

export async function loadCompanyFacts(sb: SupabaseClient, companyId: string): Promise<CompanyFactsRow | null> {
  const { data: company, error } = await sb
    .from('companies').select('id, canton, legal_form, uid_che').eq('id', companyId).maybeSingle();
  if (error) throw new Error(`company_read_failed: ${error.message}`);
  if (!company) return null;

  const { data: profile } = await sb
    .from('company_profiles')
    .select('sector, employee_count, owns_property, vehicle_count')
    .eq('company_id', companyId).maybeSingle();

  return {
    companyId,
    canton: company.canton ?? null,
    // ⚠️ Il paese non è una colonna: le imprese del prodotto sono svizzere per
    //    costruzione (l'onboarding chiede un cantone). Dichiararlo qui è meglio
    //    che lasciare un `null` che un criterio interpreterebbe come «ignoto».
    country: 'CH',
    legalForm: company.legal_form ?? null,
    uidChe: company.uid_che ?? null,
    sector: profile?.sector ?? null,
    employeeCount: profile?.employee_count ?? null,
    ownsProperty: profile?.owns_property ?? null,
    vehicleCount: profile?.vehicle_count ?? null,
  };
}

export interface ProjectRow {
  id: string;
  companyId: string;
  title: string;
  stage: string;
  locationCanton: string | null;
  locationCountry: string;
  sector: string | null;
  budgetAmount: number | null;
  budgetCurrency: string | null;
  employeeImpact: number | null;
  hasResearchPartner: boolean | null;
  hasInnovationPartner: boolean | null;
  hasInternationalPartners: boolean | null;
  projectTypes: string[];
  estimatedStartDate: string | null;
  estimatedEndDate: string | null;
  ownerUserId: string | null;
}

export async function loadActiveProjects(
  sb: SupabaseClient, companyId: string | null, limit: number,
): Promise<ProjectRow[]> {
  let q = sb.from('subsidy_projects').select('*').eq('status', 'active').limit(limit);
  if (companyId) q = q.eq('company_id', companyId);
  const { data, error } = await q;
  if (error) throw new Error(`projects_read_failed: ${error.message}`);
  return (data ?? []).map((p) => ({
    id: p.id, companyId: p.company_id, title: p.title, stage: p.stage,
    locationCanton: p.location_canton, locationCountry: p.location_country ?? 'CH',
    sector: p.sector, budgetAmount: p.budget_amount == null ? null : Number(p.budget_amount),
    budgetCurrency: p.budget_currency, employeeImpact: p.employee_impact,
    hasResearchPartner: p.has_research_partner,
    hasInnovationPartner: p.has_innovation_partner,
    hasInternationalPartners: p.has_international_partners,
    projectTypes: p.project_types ?? [],
    estimatedStartDate: p.estimated_start_date, estimatedEndDate: p.estimated_end_date,
    ownerUserId: p.owner_user_id,
  }));
}

/** Le risposte CORRENTI: la più recente per (progetto, versione, criterio). */
export async function loadAnswers(
  sb: SupabaseClient, companyId: string, projectId: string | null, versionId: string,
): Promise<Record<string, 'yes' | 'no' | 'unknown'>> {
  let q = sb.from('subsidy_answers')
    .select('rule_key, value, answered_at')
    .eq('company_id', companyId)
    .eq('program_version_id', versionId)
    .order('answered_at', { ascending: false });
  q = projectId ? q.eq('project_id', projectId) : q.is('project_id', null);
  const { data, error } = await q;
  if (error) throw new Error(`answers_read_failed: ${error.message}`);

  const out: Record<string, 'yes' | 'no' | 'unknown'> = {};
  // ⚠️ Le righe arrivano dalla più recente: la PRIMA che si incontra per una
  //    chiave è quella corrente, e le successive sono storia. Scrivere senza
  //    questo controllo farebbe vincere la risposta più vecchia.
  for (const r of data ?? []) {
    if (!(r.rule_key in out)) out[r.rule_key] = r.value;
  }
  return out;
}
