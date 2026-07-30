// ============================================================================
// incentivesService — l'accesso al modulo Incentivi (Subsidy AI 2.0) dal browser.
//
// ⚠️⚠️ QUESTO SERVIZIO NON PUÒ CANDIDARE NESSUNO, e non è una limitazione
// tecnica: è il modulo. Non esiste — e non deve esistere — alcun metodo che
// invii una domanda, acceda a un portale, compili un formulario, firmi, carichi
// allegati presso un'autorità o dichiari qualcosa a un ente. Nessuna di queste
// azioni ha una colonna, una funzione o un permesso nella 0032: non sono
// spente, non ci sono.
//
// ⚠️⚠️ E NON PUÒ VALUTARE NIENTE. Le sei misure — rilevanza, idoneità,
// completezza, tempistica, freschezza, prontezza — le scrive il motore
// (`subsidy-worker`), e sull'opportunità il client ha il permesso di scrivere
// TRE colonne sole: `saved_at`, `dismissed_reason`, `dismissed_note`. Un
// metodo che aggiornasse la rilevanza troverebbe un `42501` del database, ed è
// giusto così: un'opportunità la cui rilevanza si cambia dal browser non è una
// valutazione, è un'opinione.
//
// La lista e i conteggi passano dalle funzioni del database
// (`list_subsidy_opportunities`, `list_subsidy_projects`, `list_subsidy_cases`,
// `subsidy_home_summary`): due ricomposizioni degli stessi numeri finirebbero
// per mostrarne due diversi sulla stessa scheda, ed è la disciplina che
// `list_documents` e `list_crm_organizations` hanno già stabilito.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { toUserMessage } from '@/lib/errors';
import type { Database, Json } from '@/types/database';
import type {
  SubsidyCallStatus, SubsidyCaseEventKind, SubsidyCaseOutcome, SubsidyCaseStatus,
  SubsidyChecklistKind, SubsidyCompleteness, SubsidyCriterionState,
  SubsidyDismissalReason, SubsidyEligibilityStatus, SubsidyFactSource,
  SubsidyFreshness, SubsidyOpportunityKind, SubsidyProjectStage, SubsidyReadiness,
  SubsidyRelevanceLevel, SubsidyRuleEvaluability, SubsidyRuleHardness,
  SubsidySourceCriticality, SubsidySourceType, SubsidyTiming,
} from '@/types/database';
import type {
  IncentiveCase, IncentiveCaseEvent, IncentiveCaseItem, IncentiveCatalogProgram,
  IncentiveCriterion, IncentiveOpportunity, IncentiveProject, IncentiveRelevanceReason,
  IncentiveSummary,
} from '@/types/models';
import { OPPORTUNITY_PAGE_SIZE, type OpportunityView } from '@/features/incentives/incentivesModel';

function fail(error: unknown): never {
  throw new Error(toUserMessage(error));
}

// ---------------------------------------------------------------------------
// Conversioni difensive
//
// ⚠️ `numeric` di Postgres arriva come STRINGA da PostgREST quando il valore
//    eccede la precisione sicura di un numero JavaScript. `num()` lo converte
//    in un punto solo, e `null` resta `null`: un importo assente NON diventa
//    zero, perché «non richiesto» e «richiesto zero» sono due cose diverse.
// ---------------------------------------------------------------------------
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number {
  const n = num(v);
  return n === null ? 0 : Math.trunc(n);
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

function bool(v: unknown): boolean {
  return v === true;
}

/**
 * Un booleano a TRE valori.
 *
 * ⚠️ È la conversione più importante del file. `null` significa «non lo
 * sappiamo» e NON deve diventare `false`: un criterio su un fatto ignoto resta
 * `unknown`, non «non soddisfatto». Un `Boolean(v)` scritto per comodità qui
 * trasformerebbe ogni dato mancante in una negazione — cioè renderebbe non
 * idonea un'impresa di cui semplicemente non sappiamo abbastanza.
 */
function tri(v: unknown): boolean | null {
  if (v === true) return true;
  if (v === false) return false;
  return null;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}

/**
 * Le ragioni della rilevanza: chiavi di traduzione con parametri.
 *
 * ⚠️ Una riga senza `key` viene SCARTATA, non riempita con un'etichetta
 * generica: «altro motivo» accanto a un programma è peggio di nessun motivo,
 * perché sembra una spiegazione.
 */
function reasons(v: Json | unknown): IncentiveRelevanceReason[] {
  if (!Array.isArray(v)) return [];
  const out: IncentiveRelevanceReason[] = [];
  for (const raw of v) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const rec = raw as Record<string, unknown>;
    const key = str(rec.key);
    if (!key) continue;
    const params = rec.params && typeof rec.params === 'object' && !Array.isArray(rec.params)
      ? (rec.params as Record<string, string | number>)
      : undefined;
    out.push(params ? { key, params } : { key });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Mappatura delle righe
// ---------------------------------------------------------------------------

function toOpportunity(r: Record<string, unknown>): IncentiveOpportunity {
  return {
    id: String(r.id),
    projectId: str(r.project_id),
    projectTitle: str(r.project_title),
    kind: (r.kind as SubsidyOpportunityKind) ?? 'project',
    programId: String(r.program_id),
    programName: String(r.program_name ?? ''),
    authority: String(r.authority ?? ''),
    supportType: String(r.support_type ?? ''),
    programAvailability: String(r.program_availability ?? 'available'),
    programLifecycle: String(r.program_lifecycle ?? 'active'),
    officialSourceUrl: String(r.official_source_url ?? ''),
    programVersionId: String(r.program_version_id),
    versionNumber: int(r.version_number),
    versionEffectiveFrom: str(r.version_effective_from),
    callId: str(r.call_id),
    callTitle: str(r.call_title),
    callStatus: (str(r.call_status) as SubsidyCallStatus | null),
    callDeadlineOn: str(r.call_deadline_on),
    callDeadlineAt: str(r.call_deadline_at),
    callContinuous: bool(r.call_continuous),
    relevanceLevel: (r.relevance_level as SubsidyRelevanceLevel) ?? 'low',
    relevanceScore: int(r.relevance_score),
    eligibilityStatus: (r.eligibility_status as SubsidyEligibilityStatus) ?? 'not_assessed',
    completeness: (r.completeness as SubsidyCompleteness) ?? 'major_gaps',
    timing: (r.timing as SubsidyTiming) ?? 'unknown',
    sourceFreshness: (r.source_freshness as SubsidyFreshness) ?? 'unverified',
    readiness: (r.readiness as SubsidyReadiness) ?? 'not_started',
    missingFactCount: int(r.missing_fact_count),
    openCriteriaCount: int(r.open_criteria_count),
    assessmentStale: bool(r.assessment_stale),
    savedAt: str(r.saved_at),
    dismissedAt: str(r.dismissed_at),
    dismissedReason: (str(r.dismissed_reason) as SubsidyDismissalReason | null),
    reopenSuggestedAt: str(r.reopen_suggested_at),
    lastAssessedAt: str(r.last_assessed_at),
    firstMatchedAt: String(r.first_matched_at ?? ''),
    caseId: str(r.case_id),
    caseStatus: (str(r.case_status) as SubsidyCaseStatus | null),
    relevanceReasons: reasons(r.relevance_reasons),
    // ⚠️ `list_subsidy_opportunities` NON rende `current_assessment_id`: i
    // criteri si chiedono con una seconda lettura mirata (vedi `criteria()`).
    // Dichiararlo qui a `null` è la verità di ciò che la funzione risponde.
    currentAssessmentId: null,
  };
}

function toProject(r: Record<string, unknown>): IncentiveProject {
  return {
    id: String(r.id),
    title: String(r.title ?? ''),
    description: str(r.description),
    stage: (r.stage as SubsidyProjectStage) ?? 'idea',
    ownerUserId: str(r.owner_user_id),
    locationCanton: str(r.location_canton),
    sector: str(r.sector),
    estimatedStartDate: str(r.estimated_start_date),
    estimatedEndDate: str(r.estimated_end_date),
    budgetAmount: num(r.budget_amount),
    budgetCurrency: str(r.budget_currency),
    employeeImpact: num(r.employee_impact) === null ? null : int(r.employee_impact),
    hasResearchPartner: tri(r.has_research_partner),
    hasInnovationPartner: tri(r.has_innovation_partner),
    hasInternationalPartners: tri(r.has_international_partners),
    projectTypes: strArray(r.project_types),
    goals: str(r.goals),
    status: String(r.status ?? 'active'),
    archivedAt: str(r.archived_at),
    createdAt: String(r.created_at ?? ''),
    updatedAt: String(r.updated_at ?? ''),
    opportunityCount: int(r.opportunity_count),
    highRelevanceCount: int(r.high_relevance_count),
    staleCount: int(r.stale_count),
    documentCount: int(r.document_count),
    partnerCount: int(r.partner_count),
    // ⚠️ `null` e non `0`: «nessuna interpretazione» non è «la versione zero».
    interpretationVersion: num(r.interpretation_version) === null ? null : int(r.interpretation_version),
  };
}

function toCase(r: Record<string, unknown>): IncentiveCase {
  return {
    id: String(r.id),
    opportunityId: str(r.opportunity_id),
    projectId: str(r.project_id),
    projectTitle: str(r.project_title),
    programId: String(r.program_id ?? ''),
    programName: str(r.program_name),
    authority: str(r.authority),
    status: (r.status as SubsidyCaseStatus) ?? 'draft',
    ownerUserId: str(r.owner_user_id),
    officialDeadline: str(r.official_deadline),
    officialDeadlineAt: str(r.official_deadline_at),
    internalDeadline: str(r.internal_deadline),
    amountRequested: num(r.amount_requested),
    amountAwarded: num(r.amount_awarded),
    currency: str(r.currency),
    outcome: (r.outcome as SubsidyCaseOutcome) ?? 'unknown',
    submittedAt: str(r.submitted_at),
    decisionAt: str(r.decision_at),
    legacySnapshot: bool(r.legacy_snapshot),
    sourceChangedAt: str(r.source_changed_at),
    archivedAt: str(r.archived_at),
    createdAt: String(r.created_at ?? ''),
    itemsTotal: int(r.items_total),
    itemsDone: int(r.items_done),
    itemsRequiredOpen: int(r.items_required_open),
    documentCount: int(r.document_count),
  };
}

type CaseItemRow = Database['public']['Tables']['subsidy_case_items']['Row'];

function toCaseItem(r: CaseItemRow): IncentiveCaseItem {
  return {
    id: r.id,
    subsidyCaseId: r.subsidy_case_id,
    title: r.title,
    completed: r.completed,
    sortOrder: r.sort_order,
    kind: r.kind,
    documentId: r.document_id,
    taskId: r.task_id,
    dueDate: r.due_date,
    required: r.required,
    sourceRequirementKey: r.source_requirement_key,
    completedAt: r.completed_at,
    completedBy: r.completed_by,
  };
}

function toCriterion(r: Record<string, unknown>): IncentiveCriterion {
  const ev = r.source_evidence;
  return {
    ruleKey: String(r.rule_key),
    label: String(r.label ?? r.rule_key),
    hardness: (r.hardness as SubsidyRuleHardness) ?? 'informative',
    evaluability: (r.evaluability as SubsidyRuleEvaluability) ?? 'manual',
    question: str(r.question),
    state: (r.state as SubsidyCriterionState) ?? 'unknown',
    observedValue: str(r.observed_value),
    valueSource: (str(r.value_source) as SubsidyFactSource | null),
    reasonCode: str(r.reason_code),
    factKey: str(r.fact_key),
    sourceEvidence: ev && typeof ev === 'object' && !Array.isArray(ev)
      ? (ev as IncentiveCriterion['sourceEvidence'])
      : null,
    sortOrder: int(r.sort_order),
  };
}

// ---------------------------------------------------------------------------
// Il catalogo
//
// ⚠️ Tre letture e non un embed unico, e la ragione è stata pagata: fra
//    `subsidy_program_versions` e `subsidy_programs` esistono DUE chiavi
//    esterne (`program_id` e `current_version_id`), e PostgREST rifiuta
//    l'embed senza il nome del vincolo (PGRST200). Tre `select` con `in(...)`
//    sono più lunghe da scrivere e non possono sbagliare.
// ---------------------------------------------------------------------------
interface ProgramRow {
  id: string; name: string; authority: string; support_type: string;
  official_source_url: string; availability: string; availability_note: string | null;
  availability_checked_at: string | null; lifecycle: string; data_status: string;
  last_checked_at: string | null; geography: string[]; project_types: string[];
  contribution_description: string | null; must_apply_before_start: boolean;
  documents_required: string[]; primary_source_id: string | null;
  current_version_id: string | null;
}

export const incentivesService = {
  // -------------------------------------------------------------------------
  // Opportunità
  // -------------------------------------------------------------------------
  /**
   * ⚠️ `total` si legge dalla PRIMA riga (`total_count` è una funzione
   * finestra: identico su ogni riga) e vale solo se una riga c'è. Senza righe
   * non esiste un totale da leggere, e inventare `0` sarebbe corretto per caso.
   */
  async opportunities(
    companyId: string,
    options: { view?: OpportunityView; projectId?: string | null; offset?: number } = {},
  ): Promise<{ items: IncentiveOpportunity[]; total: number }> {
    const { data, error } = await requireSupabase().rpc('list_subsidy_opportunities', {
      p_company_id: companyId,
      p_project_id: options.projectId ?? null,
      p_view: options.view ?? 'all',
      p_limit: OPPORTUNITY_PAGE_SIZE,
      p_offset: options.offset ?? 0,
    });
    if (error) fail(error);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return {
      items: rows.map(toOpportunity),
      total: rows.length ? int(rows[0]!.total_count) : 0,
    };
  },

  /**
   * I criteri della valutazione CORRENTE di un'opportunità.
   *
   * Due letture: prima si chiede quale sia la valutazione corrente, poi i suoi
   * criteri. ⚠️ Se l'opportunità non ha ancora una valutazione si torna un
   * elenco VUOTO con `assessmentId: null`, e la schermata dice «non ancora
   * valutata». Chiedere i criteri di una valutazione inesistente e mostrare
   * «nessun criterio» farebbe sembrare senza requisiti un programma che ne ha.
   */
  async criteria(opportunityId: string): Promise<{ assessmentId: string | null; items: IncentiveCriterion[] }> {
    const sb = requireSupabase();
    const { data: opp, error: oErr } = await sb
      .from('subsidy_opportunities')
      .select('current_assessment_id')
      .eq('id', opportunityId)
      .limit(1);
    if (oErr) fail(oErr);
    const assessmentId = (opp ?? [])[0]?.current_assessment_id ?? null;
    if (!assessmentId) return { assessmentId: null, items: [] };

    const { data, error } = await sb.rpc('subsidy_assessment_criteria', { p_assessment_id: assessmentId });
    if (error) fail(error);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return { assessmentId, items: rows.map(toCriterion) };
  },

  /** Salva o toglie dai salvati. La colonna è una delle TRE concesse al client. */
  async setSaved(opportunityId: string, saved: boolean): Promise<void> {
    const { error } = await requireSupabase()
      .from('subsidy_opportunities')
      .update({ saved_at: saved ? new Date().toISOString() : null })
      .eq('id', opportunityId);
    if (error) fail(error);
  },

  /**
   * Mette da parte un'opportunità.
   *
   * ⚠️ IL RECORD NON SI CANCELLA (§101), e il motivo è obbligatorio: se domani
   * la call cambia si può proporre di riguardarla, e senza il motivo non si
   * saprebbe se abbia senso farlo. `dismissed_at` e `dismissed_by` li timbra il
   * trigger: il browser non decide né quando né chi.
   */
  async dismiss(opportunityId: string, reason: SubsidyDismissalReason, note: string | null): Promise<void> {
    const { error } = await requireSupabase()
      .from('subsidy_opportunities')
      .update({ dismissed_reason: reason, dismissed_note: note })
      .eq('id', opportunityId);
    if (error) fail(error);
  },

  /** Riapre: si azzera il motivo, e il trigger toglie il timbro. */
  async reopen(opportunityId: string): Promise<void> {
    const { error } = await requireSupabase()
      .from('subsidy_opportunities')
      .update({ dismissed_reason: null, dismissed_note: null })
      .eq('id', opportunityId);
    if (error) fail(error);
  },

  /**
   * Registra una risposta a un criterio.
   *
   * ⚠️ APPEND-ONLY: si INSERISCE sempre, non si aggiorna mai. Rispondere di
   * nuovo scrive una riga nuova e la corrente è la più recente; la precedente
   * resta, perché se un criterio è stato dichiarato soddisfatto a marzo e non
   * soddisfatto a giugno quel cambiamento è un fatto che riguarda una pratica
   * in corso. `answered_by` e `answered_at` li timbra il database.
   *
   * ⚠️ La risposta è legata alla VERSIONE del programma, non al programma: un
   * criterio riformulato non eredita la vecchia risposta, che sarebbe una
   * risposta a una domanda diversa.
   */
  async answer(input: {
    companyId: string; projectId: string | null; programVersionId: string;
    ruleKey: string; value: 'yes' | 'no' | 'unknown'; note?: string | null;
  }): Promise<void> {
    const { error } = await requireSupabase().from('subsidy_answers').insert({
      company_id: input.companyId,
      project_id: input.projectId,
      program_version_id: input.programVersionId,
      rule_key: input.ruleKey,
      value: input.value,
      note: input.note ?? null,
    });
    if (error) fail(error);
  },

  // -------------------------------------------------------------------------
  // Progetti
  // -------------------------------------------------------------------------
  async projects(companyId: string, includeArchived = false): Promise<IncentiveProject[]> {
    const { data, error } = await requireSupabase().rpc('list_subsidy_projects', {
      p_company_id: companyId,
      p_include_archived: includeArchived,
    });
    if (error) fail(error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(toProject);
  },

  async createProject(
    companyId: string, input: Database['public']['Tables']['subsidy_projects']['Insert'],
  ): Promise<string> {
    const { data, error } = await requireSupabase()
      .from('subsidy_projects')
      .insert({ ...input, company_id: companyId })
      .select('id')
      .single();
    if (error || !data) fail(error);
    return data.id;
  },

  async updateProject(
    projectId: string, patch: Database['public']['Tables']['subsidy_projects']['Update'],
  ): Promise<void> {
    const { error } = await requireSupabase()
      .from('subsidy_projects').update(patch).eq('id', projectId);
    if (error) fail(error);
  },

  /**
   * ⚠️ ARCHIVIA, non cancella: non esiste alcun `delete` su questa tabella, e
   * la ragione è di merito — cancellare un progetto porterebbe via opportunità,
   * valutazioni e, a cascata, il legame delle pratiche che ne sono nate. I
   * timbri (`archived_at`, `archived_by`) li mette il trigger.
   */
  async setProjectArchived(projectId: string, archived: boolean): Promise<void> {
    const { error } = await requireSupabase()
      .from('subsidy_projects')
      .update({ status: archived ? 'archived' : 'active' })
      .eq('id', projectId);
    if (error) fail(error);
  },

  // -------------------------------------------------------------------------
  // Pratiche
  // -------------------------------------------------------------------------
  async cases(companyId: string, includeArchived = false): Promise<IncentiveCase[]> {
    const { data, error } = await requireSupabase().rpc('list_subsidy_cases', {
      p_company_id: companyId,
      p_include_archived: includeArchived,
    });
    if (error) fail(error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(toCase);
  },

  async caseItems(caseId: string): Promise<IncentiveCaseItem[]> {
    const { data, error } = await requireSupabase()
      .from('subsidy_case_items')
      .select('*')
      .eq('subsidy_case_id', caseId)
      .order('sort_order', { ascending: true });
    if (error) fail(error);
    return ((data ?? []) as CaseItemRow[]).map(toCaseItem);
  },

  /**
   * Lo storico della pratica.
   *
   * ⚠️ VA RILETTO dopo ogni azione: gli eventi li scrivono i trigger, quindi la
   * schermata non sa che cosa sia stato registrato e indovinarlo racconterebbe
   * una storia parallela a quella vera. È la lezione del dettaglio Attività.
   */
  async caseEvents(caseId: string, limit = 50): Promise<IncentiveCaseEvent[]> {
    const { data, error } = await requireSupabase()
      .from('subsidy_case_events')
      .select('id, kind, detail, actor_user_id, created_at')
      .eq('subsidy_case_id', caseId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) fail(error);
    return ((data ?? []) as Array<{
      id: string; kind: SubsidyCaseEventKind; detail: Json;
      actor_user_id: string | null; created_at: string;
    }>).map((r) => ({
      id: r.id,
      kind: r.kind,
      detail: (r.detail && typeof r.detail === 'object' && !Array.isArray(r.detail)
        ? (r.detail as Record<string, unknown>) : {}),
      actorUserId: r.actor_user_id,
      createdAt: r.created_at,
    }));
  },

  /**
   * Apre una pratica da un'opportunità.
   *
   * ⚠️ L'ISTANTANEA È IL PUNTO (§109). Alla creazione si congela ciò che il
   * catalogo diceva: quale versione, quale call, quale scadenza, quali criteri
   * e come stavano. Se domani il catalogo cambia, la pratica NON si aggiorna da
   * sola — mostra il confronto. Senza questo blocco la pratica direbbe, fra un
   * anno, di aver soddisfatto criteri che non esistevano quando è nata.
   *
   * ⚠️ La scadenza UFFICIALE si copia dalla call e non si tocca più: è
   * dell'autorità. Quella interna la sceglie l'impresa, ed è un altro campo.
   */
  async createCase(input: {
    companyId: string; userId: string; opportunity: IncentiveOpportunity;
    criteria: IncentiveCriterion[]; ownerUserId?: string | null;
  }): Promise<string> {
    const { opportunity: o } = input;
    const snapshot = {
      capturedAt: new Date().toISOString(),
      programId: o.programId,
      programName: o.programName,
      authority: o.authority,
      supportType: o.supportType,
      officialSourceUrl: o.officialSourceUrl,
      programVersionId: o.programVersionId,
      versionNumber: o.versionNumber,
      versionEffectiveFrom: o.versionEffectiveFrom,
      call: o.callId
        ? {
          id: o.callId, title: o.callTitle, status: o.callStatus,
          deadlineOn: o.callDeadlineOn, deadlineAt: o.callDeadlineAt,
          continuous: o.callContinuous,
        }
        : null,
      measures: {
        relevanceLevel: o.relevanceLevel,
        eligibilityStatus: o.eligibilityStatus,
        completeness: o.completeness,
        timing: o.timing,
        sourceFreshness: o.sourceFreshness,
        readiness: o.readiness,
      },
      // I criteri COME ERANO, con il loro stato e la loro evidenza: è la parte
      // che permette di rileggere la pratica fra due anni.
      criteria: input.criteria.map((c) => ({
        ruleKey: c.ruleKey, label: c.label, hardness: c.hardness,
        state: c.state, observedValue: c.observedValue, valueSource: c.valueSource,
        sourceEvidence: c.sourceEvidence,
      })),
      relevanceReasons: o.relevanceReasons,
      lastAssessedAt: o.lastAssessedAt,
    };

    const { data, error } = await requireSupabase().from('subsidy_cases').insert({
      company_id: input.companyId,
      created_by: input.userId,
      opportunity_id: o.id,
      project_id: o.projectId,
      program_id: o.programId,
      program_name: o.programName,
      authority: o.authority,
      program_version_id: o.programVersionId,
      call_id: o.callId,
      owner_user_id: input.ownerUserId ?? null,
      status: 'draft',
      official_deadline: o.callDeadlineOn,
      official_deadline_at: o.callDeadlineAt,
      program_snapshot: snapshot as unknown as Json,
      // L'impronta del catalogo alla creazione: quando diverge da quella
      // corrente, la schermata mostra il confronto invece di aggiornare in
      // silenzio. La calcola il motore alla rivalutazione; qui si registra la
      // versione, che è l'ancora verificabile.
      snapshot_hash: `${o.programId}:v${o.versionNumber}`,
      relevance_score: o.relevanceScore,
      source_last_checked_at: o.lastAssessedAt,
    }).select('id').single();
    if (error || !data) fail(error);
    return data.id;
  },

  async updateCase(
    caseId: string, patch: Database['public']['Tables']['subsidy_cases']['Update'],
  ): Promise<void> {
    const { error } = await requireSupabase()
      .from('subsidy_cases').update(patch).eq('id', caseId);
    if (error) fail(error);
  },

  async setCaseArchived(caseId: string, archived: boolean): Promise<void> {
    const { error } = await requireSupabase()
      .from('subsidy_cases')
      .update({ archived_at: archived ? new Date().toISOString() : null })
      .eq('id', caseId);
    if (error) fail(error);
  },

  // ---- La checklist ----
  async addCaseItem(input: {
    caseId: string; title: string; kind?: SubsidyChecklistKind;
    required?: boolean; dueDate?: string | null; sortOrder: number;
  }): Promise<IncentiveCaseItem> {
    const { data, error } = await requireSupabase().from('subsidy_case_items').insert({
      subsidy_case_id: input.caseId,
      title: input.title,
      kind: input.kind ?? 'other',
      required: input.required ?? true,
      due_date: input.dueDate ?? null,
      sort_order: input.sortOrder,
    }).select('*').single();
    if (error || !data) fail(error);
    return toCaseItem(data as CaseItemRow);
  },

  /**
   * ⚠️ LA SPUNTA LA METTE UNA PERSONA (§115). Non esiste, e non deve esistere,
   * un percorso che completi un passo perché è comparso un documento con il
   * nome giusto: dedurre il completamento dall'esistenza di un file è il modo
   * più elegante di dichiarare pronta una pratica che non lo è. `completed_at`
   * e `completed_by` li timbra il trigger.
   */
  async setCaseItemCompleted(itemId: string, completed: boolean): Promise<void> {
    const { error } = await requireSupabase()
      .from('subsidy_case_items').update({ completed }).eq('id', itemId);
    if (error) fail(error);
  },

  async removeCaseItem(itemId: string): Promise<void> {
    const { error } = await requireSupabase().from('subsidy_case_items').delete().eq('id', itemId);
    if (error) fail(error);
  },

  // -------------------------------------------------------------------------
  // Il riassunto
  // -------------------------------------------------------------------------
  /**
   * ⚠️ Torna `null` quando la funzione non risponde con un oggetto, e il
   * chiamante deve trattarlo come «non lo sappiamo», non come sette zeri.
   * Mostrare zeri a chi non ha accesso sarebbe un guasto travestito da stato
   * legittimo — la trappola dell'Inbox che diceva «collega la posta» invece
   * dell'errore.
   */
  async summary(companyId: string, days = 30): Promise<IncentiveSummary | null> {
    const { data, error } = await requireSupabase().rpc('subsidy_home_summary', {
      p_company_id: companyId, p_days: days,
    });
    if (error) fail(error);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const r = data as Record<string, unknown>;
    return {
      newOpportunities: int(r.newOpportunities),
      highRelevance: int(r.highRelevance),
      staleAssessments: int(r.staleAssessments),
      openCases: int(r.openCases),
      casesWithSourceChange: int(r.casesWithSourceChange),
      deadlinesSoon: int(r.deadlinesSoon),
      activeProjects: int(r.activeProjects),
    };
  },

  // -------------------------------------------------------------------------
  // Il catalogo — SOLA LETTURA
  //
  // ⚠️ Non esiste alcun metodo di scrittura, e non è una dimenticanza: §28 dice
  //    che non c'è un editor di catalogo per il cliente, e la 0032 non concede
  //    al client alcun permesso su queste tabelle. Il catalogo è condiviso: se
  //    un'impresa potesse riscriverlo, riscriverebbe i requisiti che il
  //    prodotto presenta a tutte le altre.
  //
  // ⚠️ Le REVISIONI in attesa (`subsidy_catalog_reviews`) NON si leggono, e non
  //    per un permesso mancante: la 0032 non ha alcuna policy per loro proprio
  //    perché contengono proposte che nessuno ha ancora guardato. Mostrarle
  //    significherebbe presentare come dato del catalogo qualcosa di non
  //    verificato — il contrario esatto di ciò a cui la revisione serve.
  // -------------------------------------------------------------------------
  async catalog(): Promise<IncentiveCatalogProgram[]> {
    const sb = requireSupabase();
    const { data: programs, error } = await sb
      .from('subsidy_programs')
      .select('id, name, authority, support_type, official_source_url, availability, '
        + 'availability_note, availability_checked_at, lifecycle, data_status, last_checked_at, '
        + 'geography, project_types, contribution_description, must_apply_before_start, '
        + 'documents_required, primary_source_id, current_version_id')
      .eq('active', true)
      .order('authority', { ascending: true })
      .order('name', { ascending: true });
    if (error) fail(error);
    const rows = (programs ?? []) as unknown as ProgramRow[];
    if (rows.length === 0) return [];

    const programIds = rows.map((p) => p.id);
    const versionIds = rows.map((p) => p.current_version_id).filter((v): v is string => v !== null);
    const sourceIds = rows.map((p) => p.primary_source_id).filter((v): v is string => v !== null);

    // Le versioni pubblicate. ⚠️ La RLS nasconde le BOZZE: una versione in
    // attesa di revisione non è ciò che il prodotto presenta come vigente.
    const versionsQuery = versionIds.length
      ? sb.from('subsidy_program_versions')
        .select('id, program_id, version_number, effective_from, published_at, reviewed_at')
        .in('id', versionIds)
      : null;
    const rulesQuery = versionIds.length
      ? sb.from('subsidy_program_rules').select('program_version_id').in('program_version_id', versionIds)
      : null;
    const callsQuery = sb.from('subsidy_calls')
      .select('id, program_id, title, status, opens_on, deadline_on, deadline_at, '
        + 'continuous, expected_next_call, external_reference')
      .in('program_id', programIds);
    const sourcesQuery = sourceIds.length
      ? sb.from('subsidy_sources')
        .select('id, authority, source_type, canonical_url, criticality, '
          + 'last_successful_check_at, check_frequency_days, last_error_at')
        .in('id', sourceIds)
      : null;

    const [versions, rules, calls, sources] = await Promise.all([
      versionsQuery, rulesQuery, callsQuery, sourcesQuery,
    ]);
    for (const res of [versions, rules, calls, sources]) {
      if (res?.error) fail(res.error);
    }

    // Quanti criteri per versione. Il conteggio si fa qui perché PostgREST non
    // rende un `count` raggruppato senza una vista, e una vista in più per un
    // numero non vale una migrazione.
    const criteriaCount = new Map<string, number>();
    for (const r of (rules?.data ?? []) as Array<{ program_version_id: string }>) {
      criteriaCount.set(r.program_version_id, (criteriaCount.get(r.program_version_id) ?? 0) + 1);
    }

    const versionById = new Map(
      ((versions?.data ?? []) as Array<{
        id: string; version_number: number; effective_from: string | null;
        published_at: string | null; reviewed_at: string | null;
      }>).map((v) => [v.id, v]),
    );

    const callsByProgram = new Map<string, IncentiveCatalogProgram['calls']>();
    for (const c of (calls?.data ?? []) as unknown as Array<{
      id: string; program_id: string; title: string | null; status: SubsidyCallStatus;
      opens_on: string | null; deadline_on: string | null; deadline_at: string | null;
      continuous: boolean; expected_next_call: string | null; external_reference: string | null;
    }>) {
      const list = callsByProgram.get(c.program_id) ?? [];
      list.push({
        id: c.id, title: c.title, status: c.status, opensOn: c.opens_on,
        deadlineOn: c.deadline_on, deadlineAt: c.deadline_at, continuous: c.continuous,
        expectedNextCall: c.expected_next_call, externalReference: c.external_reference,
      });
      callsByProgram.set(c.program_id, list);
    }

    const sourceById = new Map(
      ((sources?.data ?? []) as unknown as Array<{
        id: string; authority: string; source_type: SubsidySourceType;
        canonical_url: string; criticality: SubsidySourceCriticality;
        last_successful_check_at: string | null; check_frequency_days: number;
        last_error_at: string | null;
      }>).map((s) => [s.id, s]),
    );

    return rows.map((p) => {
      const v = p.current_version_id ? versionById.get(p.current_version_id) ?? null : null;
      const s = p.primary_source_id ? sourceById.get(p.primary_source_id) ?? null : null;
      return {
        id: p.id,
        name: p.name,
        authority: p.authority,
        supportType: p.support_type,
        officialSourceUrl: p.official_source_url,
        availability: p.availability,
        availabilityNote: p.availability_note,
        availabilityCheckedAt: p.availability_checked_at,
        lifecycle: p.lifecycle,
        dataStatus: p.data_status,
        lastCheckedAt: p.last_checked_at,
        geography: p.geography ?? [],
        projectTypes: p.project_types ?? [],
        contributionDescription: p.contribution_description,
        mustApplyBeforeStart: p.must_apply_before_start,
        documentsRequired: p.documents_required ?? [],
        version: v
          ? {
            id: v.id, versionNumber: v.version_number, effectiveFrom: v.effective_from,
            publishedAt: v.published_at, reviewedAt: v.reviewed_at,
            criteriaCount: criteriaCount.get(v.id) ?? 0,
          }
          : null,
        // Le call ordinate come le legge una persona: prima quelle su cui si
        // può fare qualcosa. ⚠️ Una call senza scadenza NON va in fondo per
        // difetto — «continua» è una finestra permanente, non una mancanza.
        calls: (callsByProgram.get(p.id) ?? []).sort((a, b) => {
          const rank = (st: SubsidyCallStatus) =>
            st === 'open' ? 0 : st === 'continuous' ? 1 : st === 'upcoming' ? 2
              : st === 'unknown' ? 3 : st === 'suspended' ? 4 : 5;
          const d = rank(a.status) - rank(b.status);
          if (d !== 0) return d;
          return (a.deadlineOn ?? '9999').localeCompare(b.deadlineOn ?? '9999');
        }),
        source: s
          ? {
            id: s.id, authority: s.authority, sourceType: s.source_type,
            canonicalUrl: s.canonical_url, criticality: s.criticality,
            lastSuccessfulCheckAt: s.last_successful_check_at,
            checkFrequencyDays: s.check_frequency_days,
            lastErrorAt: s.last_error_at,
          }
          : null,
      };
    });
  },
};
