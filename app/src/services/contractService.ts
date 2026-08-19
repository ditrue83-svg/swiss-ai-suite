// ============================================================================
// contractService — l'accesso ai contratti dal browser.
//
// ⚠️ QUESTO SERVIZIO NON PUÒ CAMBIARE UN TERMINE CONTRATTUALE, e non è una
// limitazione tecnica: è il modulo. I termini in vigore cambiano in un solo
// posto, `contract_verify_terms`, che è un gesto umano su una versione intera.
// Da qui si possono aggiungere CORREZIONI a una bozza, e la bozza non vale
// niente finché qualcuno non la verifica.
//
// ⚠️ NON ESISTE, E NON DEVE ESISTERE, alcun metodo che invii una disdetta,
// accetti un rinnovo, firmi o scriva alla controparte (§51/§101/§134/§135).
//
// La lista e il dettaglio passano dalla STESSA funzione del database
// (`list_contracts`, con `p_contract_id`): due ricomposizioni dei «termini
// effettivi» finirebbero per mostrare due preavvisi diversi sullo stesso
// contratto. È la disciplina di `list_documents` e `list_finance_items`.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import type { Database, Json } from '@/types/database';
import { toUserMessage } from '@/lib/errors';
import { etichettaDaRigaDocumento } from '@/lib/documentTitle';
import type {
  ContractAttentionClause, ContractAutoRenewal, ContractCorrection, ContractCostFrequency,
  ContractDetail, ContractDocumentLink, ContractDocumentRelation, ContractDocumentSuggestion,
  ContractEndKind, ContractEvent, ContractEvidence, ContractExtraction, ContractFilters,
  ContractLifecycleStatus, ContractLinkedTask, ContractListItem, ContractMilestone,
  ContractMilestoneKind, ContractObligation, ContractPage, ContractPenalty,
  ContractPeriodUnit, ContractReferencedAnnex, ContractSummary, ContractTermVersion,
  ContractTerminationMethod, ContractType,
} from '@/types/models';

function fail(error: unknown): never {
  throw new Error(toUserMessage(error));
}

/** Il messaggio da mostrare, dai codici che i guardiani della 0024 sollevano. */
export function contractErrorMessage(error: unknown): string {
  return toUserMessage(error);
}

// ---------------------------------------------------------------------------
// Mappatura delle righe
// ---------------------------------------------------------------------------

interface ListRow {
  id: string; display_name: string; contract_type: ContractType;
  counterparty_name: string | null; owner_user_id: string | null;
  review_status: ContractListItem['reviewStatus'];
  lifecycle_status: ContractLifecycleStatus; origin: ContractListItem['origin'];
  quality_flags: ContractListItem['qualityFlags']; internal_note: string | null;
  archived_at: string | null; verified_at: string | null;
  created_at: string; updated_at: string;
  term_version_id: string | null; term_version: number | null; terms_are_draft: boolean;
  start_date: string | null; end_date: string | null; end_date_kind: ContractEndKind;
  auto_renewal: ContractAutoRenewal;
  renewal_period_value: number | null; renewal_period_unit: ContractPeriodUnit | null;
  notice_period_value: number | null; notice_period_unit: ContractPeriodUnit | null;
  notice_anchor: ContractListItem['noticeAnchor']; notice_anchor_text: string | null;
  termination_method: ContractTerminationMethod | null;
  cost_amount: number | string | null; cost_currency: string | null;
  cost_frequency: ContractCostFrequency; price_adjustment: boolean;
  next_renewal_date: string | null; next_renewal_status: ContractMilestone['status'] | null;
  next_notice_date: string | null; next_notice_status: ContractMilestone['status'] | null;
  pending_draft_id: string | null;
  document_count: number | string; amendment_count: number | string;
  open_task_count: number | string;
  processing_pending_count: number | string; processing_failed_count: number | string;
  total_count: number | string;
}

const num = (v: number | string | null | undefined): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

function toItem(row: ListRow): ContractListItem {
  return {
    id: row.id,
    displayName: row.display_name,
    contractType: row.contract_type,
    counterpartyName: row.counterparty_name,
    ownerUserId: row.owner_user_id,
    reviewStatus: row.review_status,
    lifecycleStatus: row.lifecycle_status,
    origin: row.origin,
    qualityFlags: row.quality_flags ?? [],
    internalNote: row.internal_note,
    archivedAt: row.archived_at,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    termVersionId: row.term_version_id,
    termVersion: row.term_version,
    // ⚠️ `null` dal database significa che non esiste alcuna versione: in quel
    // caso ciò che si mostra NON è un termine verificato, ed è più prudente
    // dirlo che tacerlo.
    termsAreDraft: row.terms_are_draft !== false,
    startDate: row.start_date,
    endDate: row.end_date,
    endDateKind: row.end_date_kind ?? 'unknown',
    autoRenewal: row.auto_renewal ?? 'unclear',
    renewalPeriodValue: row.renewal_period_value,
    renewalPeriodUnit: row.renewal_period_unit,
    noticePeriodValue: row.notice_period_value,
    noticePeriodUnit: row.notice_period_unit,
    noticeAnchor: row.notice_anchor,
    noticeAnchorText: row.notice_anchor_text,
    terminationMethod: row.termination_method,
    costAmount: num(row.cost_amount),
    costCurrency: row.cost_currency,
    costFrequency: row.cost_frequency ?? 'unknown',
    priceAdjustment: row.price_adjustment === true,
    nextRenewalDate: row.next_renewal_date,
    nextRenewalStatus: row.next_renewal_status,
    nextNoticeDate: row.next_notice_date,
    nextNoticeStatus: row.next_notice_status,
    pendingDraftId: row.pending_draft_id,
    documentCount: Number(row.document_count ?? 0),
    amendmentCount: Number(row.amendment_count ?? 0),
    openTaskCount: Number(row.open_task_count ?? 0),
    processingPendingCount: Number(row.processing_pending_count ?? 0),
    processingFailedCount: Number(row.processing_failed_count ?? 0),
  };
}

function toTermVersion(row: Record<string, unknown>): ContractTermVersion {
  return {
    id: row.id as string,
    contractId: row.contract_id as string,
    version: Number(row.version),
    status: row.status as ContractTermVersion['status'],
    effectiveFrom: (row.effective_from as string | null) ?? null,
    counterpartyName: (row.counterparty_name as string | null) ?? null,
    companyParty: (row.company_party as string | null) ?? null,
    startDate: (row.start_date as string | null) ?? null,
    endDate: (row.end_date as string | null) ?? null,
    endDateKind: (row.end_date_kind as ContractEndKind) ?? 'unknown',
    minimumTermValue: num(row.minimum_term_value as number | null),
    minimumTermUnit: (row.minimum_term_unit as ContractPeriodUnit | null) ?? null,
    autoRenewal: (row.auto_renewal as ContractAutoRenewal) ?? 'unclear',
    renewalPeriodValue: num(row.renewal_period_value as number | null),
    renewalPeriodUnit: (row.renewal_period_unit as ContractPeriodUnit | null) ?? null,
    noticePeriodValue: num(row.notice_period_value as number | null),
    noticePeriodUnit: (row.notice_period_unit as ContractPeriodUnit | null) ?? null,
    noticeAnchor: (row.notice_anchor as ContractTermVersion['noticeAnchor']) ?? null,
    noticeAnchorText: (row.notice_anchor_text as string | null) ?? null,
    terminationMethod: (row.termination_method as ContractTerminationMethod | null) ?? null,
    terminationAddress: (row.termination_address as string | null) ?? null,
    costAmount: num(row.cost_amount as number | null),
    costCurrency: (row.cost_currency as string | null) ?? null,
    costFrequency: (row.cost_frequency as ContractCostFrequency) ?? 'unknown',
    costVatIncluded: (row.cost_vat_included as boolean | null) ?? null,
    priceAdjustment: row.price_adjustment === true,
    sourceExtractionIds: (row.source_extraction_ids as string[] | null) ?? [],
    basedOnVersionId: (row.based_on_version_id as string | null) ?? null,
    verifiedAt: (row.verified_at as string | null) ?? null,
    verifiedBy: (row.verified_by as string | null) ?? null,
    supersededAt: (row.superseded_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function toExtraction(row: Record<string, unknown>): ContractExtraction {
  return {
    id: row.id as string,
    contractId: row.contract_id as string,
    documentId: row.document_id as string,
    extractionVersion: Number(row.extraction_version),
    status: row.status as ContractExtraction['status'],
    method: (row.method as string) ?? 'ai',
    model: (row.model as string | null) ?? null,
    promptVersion: (row.prompt_version as string | null) ?? null,
    detectedType: (row.detected_type as ContractType | null) ?? null,
    outOfScopeKind: (row.out_of_scope_kind as string | null) ?? null,
    companyParty: (row.company_party as string | null) ?? null,
    counterparty: (row.counterparty as string | null) ?? null,
    counterpartyAddress: (row.counterparty_address as string | null) ?? null,
    documentDate: (row.document_date as string | null) ?? null,
    signatureDate: (row.signature_date as string | null) ?? null,
    startDate: (row.start_date as string | null) ?? null,
    endDate: (row.end_date as string | null) ?? null,
    endDateKind: (row.end_date_kind as ContractEndKind) ?? 'unknown',
    minimumTermValue: num(row.minimum_term_value as number | null),
    minimumTermUnit: (row.minimum_term_unit as ContractPeriodUnit | null) ?? null,
    autoRenewal: (row.auto_renewal as ContractAutoRenewal) ?? 'unclear',
    renewalPeriodValue: num(row.renewal_period_value as number | null),
    renewalPeriodUnit: (row.renewal_period_unit as ContractPeriodUnit | null) ?? null,
    noticePeriodValue: num(row.notice_period_value as number | null),
    noticePeriodUnit: (row.notice_period_unit as ContractPeriodUnit | null) ?? null,
    noticeAnchor: (row.notice_anchor as ContractExtraction['noticeAnchor']) ?? null,
    noticeAnchorText: (row.notice_anchor_text as string | null) ?? null,
    terminationMethod: (row.termination_method as ContractTerminationMethod | null) ?? null,
    terminationAddress: (row.termination_address as string | null) ?? null,
    costAmount: num(row.cost_amount as number | null),
    costCurrency: (row.cost_currency as string | null) ?? null,
    costFrequency: (row.cost_frequency as ContractCostFrequency) ?? 'unknown',
    costVatIncluded: (row.cost_vat_included as boolean | null) ?? null,
    priceAdjustment: row.price_adjustment === true,
    obligations: (row.obligations as ContractObligation[] | null) ?? [],
    attentionClauses: (row.attention_clauses as ContractAttentionClause[] | null) ?? [],
    penalties: (row.penalties as ContractPenalty[] | null) ?? [],
    referencedAnnexes: (row.referenced_annexes as ContractReferencedAnnex[] | null) ?? [],
    governingLaw: (row.governing_law as string | null) ?? null,
    jurisdiction: (row.jurisdiction as string | null) ?? null,
    signed: (row.signed as boolean | null) ?? null,
    evidence: (row.evidence as Record<string, ContractEvidence> | null) ?? {},
    fieldConfidence: (row.field_confidence as Record<string, number> | null) ?? {},
    uncertainties: (row.uncertainties as ContractExtraction['uncertainties'] | null) ?? [],
    qualityFlags: (row.quality_flags as ContractExtraction['qualityFlags'] | null) ?? [],
    documentLanguage: (row.document_language as string | null) ?? null,
    truncated: row.truncated === true,
    errorCode: (row.error_code as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function toMilestone(row: Record<string, unknown>, taskCount = 0): ContractMilestone {
  return {
    id: row.id as string,
    contractId: row.contract_id as string,
    termVersionId: (row.term_version_id as string | null) ?? null,
    kind: row.kind as ContractMilestoneKind,
    dueDate: row.due_date as string,
    source: row.source as ContractMilestone['source'],
    status: row.status as ContractMilestone['status'],
    calculation: (row.calculation as string | null) ?? null,
    calculationVersion: num(row.calculation_version as number | null),
    calculationInputs: (row.calculation_inputs as Record<string, unknown> | null) ?? {},
    label: (row.label as string | null) ?? null,
    windowOpenedAt: (row.window_opened_at as string | null) ?? null,
    verifiedAt: (row.verified_at as string | null) ?? null,
    verifiedBy: (row.verified_by as string | null) ?? null,
    dismissedAt: (row.dismissed_at as string | null) ?? null,
    dismissedBy: (row.dismissed_by as string | null) ?? null,
    createdAt: row.created_at as string,
    taskCount,
  };
}

// ---------------------------------------------------------------------------
// I parametri della lista
// ---------------------------------------------------------------------------

export function toListArgs(companyId: string, f: ContractFilters = {}) {
  return {
    p_company_id: companyId,
    p_view: f.view ?? 'all',
    p_query: f.query?.trim() || null,
    p_type: f.type ?? null,
    p_lifecycle: f.lifecycle ?? null,
    p_review: f.review ?? null,
    p_owner: f.owner ?? null,
    p_auto_renewal: f.autoRenewal ?? null,
    p_without_owner: f.withoutOwner === true,
    p_window_days: f.windowDays ?? 90,
    p_archived: f.archived === true,
    p_sort: f.sort ?? 'default',
    p_limit: f.limit ?? 25,
    p_offset: f.offset ?? 0,
    p_contract_id: null as string | null,
  };
}

// ---------------------------------------------------------------------------

export const contractService = {
  /** Una pagina di contratti, già filtrata, ordinata e composta dal database. */
  async list(companyId: string, filters: ContractFilters = {}): Promise<ContractPage> {
    const { data, error } = await requireSupabase()
      .rpc('list_contracts', toListArgs(companyId, filters));
    if (error) fail(error);
    const rows = (data ?? []) as unknown as ListRow[];
    return {
      items: rows.map(toItem),
      // `total_count` è uguale su ogni riga (funzione finestra): affidabile SOLO
      // se una riga c'è. Senza righe non esiste un totale da leggere.
      total: rows.length ? Number(rows[0].total_count) : 0,
    };
  },

  /** I quattro numeri del cruscotto (§67). */
  async summary(companyId: string, windowDays = 90): Promise<ContractSummary> {
    const { data, error } = await requireSupabase()
      .rpc('contract_summary', { p_company_id: companyId, p_window_days: windowDays });
    if (error) fail(error);
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | null;
    return {
      needsReview: Number(row?.needs_review ?? 0),
      renewalsSoon: Number(row?.renewals_soon ?? 0),
      noticesSoon: Number(row?.notices_soon ?? 0),
      withoutOwner: Number(row?.without_owner ?? 0),
      processing: Number(row?.processing ?? 0),
    };
  },

  /** Il dettaglio. La testata passa dalla STESSA funzione della lista. */
  async get(contractId: string, companyId: string): Promise<ContractDetail | null> {
    const sb = requireSupabase();

    const [{ data: rowData, error: rowErr }, { data: listRows, error: listErr }] = await Promise.all([
      sb.from('contracts').select('id, company_id').eq('id', contractId).maybeSingle(),
      sb.rpc('list_contracts', { ...toListArgs(companyId), p_contract_id: contractId, p_limit: 1 }),
    ]);
    if (rowErr) fail(rowErr);
    if (listErr) fail(listErr);
    if (!rowData) return null;
    // ⚠️ Difesa esplicita OLTRE alla RLS: dopo un cambio di azienda un contratto
    // dell'azienda precedente non deve restare in pagina (§158).
    if ((rowData as { company_id: string }).company_id !== companyId) return null;

    const rows = (listRows ?? []) as unknown as ListRow[];
    // La riga può mancare per un motivo legittimo: il contratto è archiviato e
    // la vista predefinita non lo mostra. Si richiede allora fra gli archiviati.
    let item = rows.length ? toItem(rows[0]) : null;
    if (!item) {
      // ⚠️ Anche qui: senza `error`, una lettura fallita usciva come
      // `return null`, e la pagina diceva «contratto non trovato» — che è una
      // risposta, e non era la verità. La verità era «non ho potuto leggere».
      const { data: archivedRows, error: arErr } = await sb.rpc('list_contracts', {
        ...toListArgs(companyId, { archived: true }), p_contract_id: contractId, p_limit: 1,
      });
      if (arErr) fail(arErr);
      const ar = (archivedRows ?? []) as unknown as ListRow[];
      if (!ar.length) return null;
      item = toItem(ar[0]);
    }

    const [versions, documents, extractions, milestones, corrections, events, tasks] =
      await Promise.all([
        contractService.termVersions(contractId),
        contractService.documents(contractId),
        contractService.extractions(contractId),
        contractService.milestones(contractId),
        contractService.corrections(contractId),
        contractService.events(contractId),
        contractService.tasks(contractId),
      ]);

    const current = versions.find((v) => v.id === item!.termVersionId) ?? null;
    const draft = versions.find((v) => v.status === 'draft' && v.id !== current?.id) ?? null;

    return {
      contract: item,
      terms: current,
      draft,
      versionHistory: versions.filter((v) => v.id !== current?.id && v.id !== draft?.id),
      documents, extractions, milestones, corrections, events, tasks,
    };
  },

  async termVersions(contractId: string): Promise<ContractTermVersion[]> {
    const { data, error } = await requireSupabase()
      .from('contract_term_versions').select('*')
      .eq('contract_id', contractId).order('version', { ascending: false });
    if (error) fail(error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(toTermVersion);
  },

  /** I documenti del contratto, con il titolo che il Document Hub custodisce. */
  async documents(contractId: string): Promise<ContractDocumentLink[]> {
    const sb = requireSupabase();
    const { data, error } = await sb
      .from('contract_documents')
      .select('id, document_id, relation, origin, processing_status, current_extraction_id, '
        + 'extraction_attempts, error_code, suggested, added_at, added_by')
      .eq('contract_id', contractId)
      .order('added_at', { ascending: true });
    if (error) fail(error);
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    if (!rows.length) return [];

    // ⚠️ Nessun `embed` di PostgREST verso `documents`: una lettura separata
    // costa una interrogazione e non rischia il PGRST200 che il Document Hub ha
    // già pagato quando una relazione dichiarata non esisteva davvero.
    const ids = rows.map((r) => r.document_id as string);
    // ⚠️ SI LEGGE ANCHE L'ULTIMA ANALISI VALIDA, e non per curiosità: senza
    // mittente e tipo, un documento il cui titolo non è mostrabile qui
    // comparirebbe come «2.5» — è successo, e il §6 vale anche fuori dal
    // Document Hub. L'aggancio è lo stesso di `documentHubService.statsRows`:
    // ultima riga non fallita, una per documento.
    // ⚠️ E L'ERRORE SI DICHIARA. Senza, un guasto qui rendeva `docs` nullo e
    // OGNI allegato del contratto diventava «Documento senza titolo»: una
    // schermata piena di fatti falsi, in silenzio. Il caso non è teorico —
    // questa è proprio la relazione che il commento qui sopra dichiara di
    // temere per il PGRST200.
    const { data: docs, error: dErr } = await sb.from('documents')
      .select('id, title, original_filename, storage_path, mime_type, created_at, '
        + 'document_analyses(sender, document_type, confidence)')
      .neq('document_analyses.analysis_status', 'failed')
      .order('created_at', { referencedTable: 'document_analyses', ascending: false })
      .limit(1, { referencedTable: 'document_analyses' })
      .in('id', ids);
    if (dErr) fail(dErr);
    const byId = new Map(((docs ?? []) as unknown as Record<string, unknown>[]).map((d) => [d.id as string, d]));

    return rows.map((r) => {
      const d = byId.get(r.document_id as string);
      return {
        id: r.id as string,
        documentId: r.document_id as string,
        relation: r.relation as ContractDocumentRelation,
        origin: r.origin as ContractDocumentLink['origin'],
        processingStatus: r.processing_status as ContractDocumentLink['processingStatus'],
        extractionId: (r.current_extraction_id as string | null) ?? null,
        extractionAttempts: Number(r.extraction_attempts ?? 0),
        errorCode: (r.error_code as string | null) ?? null,
        suggested: r.suggested === true,
        addedAt: r.added_at as string,
        addedBy: (r.added_by as string | null) ?? null,
        title: (d?.title as string) ?? '',
        label: etichettaDaRigaDocumento(d),
        storagePath: (d?.storage_path as string | null) ?? null,
        mimeType: (d?.mime_type as string | null) ?? null,
        documentCreatedAt: (d?.created_at as string) ?? (r.added_at as string),
      };
    });
  },

  async extractions(contractId: string): Promise<ContractExtraction[]> {
    const { data, error } = await requireSupabase()
      .from('contract_extractions').select('*')
      .eq('contract_id', contractId)
      .order('created_at', { ascending: false });
    if (error) fail(error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map(toExtraction);
  },

  /** Le date, con quante attività ne sono già nate (serve alla dedup, §93). */
  async milestones(contractId: string): Promise<ContractMilestone[]> {
    const sb = requireSupabase();
    // ⚠️ Due letture, due errori: il secondo si perdeva, e un guasto sul
    // conteggio faceva mostrare «0 attività collegate» su ogni tappa — uno
    // zero che sembra una misura e invece è un silenzio.
    const [{ data, error }, { data: taskRows, error: taskErr }] = await Promise.all([
      sb.from('contract_milestones').select('*')
        .eq('contract_id', contractId)
        .order('due_date', { ascending: true }),
      sb.from('tasks').select('contract_milestone_id')
        .eq('contract_id', contractId).not('contract_milestone_id', 'is', null),
    ]);
    if (error) fail(error);
    if (taskErr) fail(taskErr);
    const counts = new Map<string, number>();
    for (const t of ((taskRows ?? []) as { contract_milestone_id: string }[])) {
      counts.set(t.contract_milestone_id, (counts.get(t.contract_milestone_id) ?? 0) + 1);
    }
    return ((data ?? []) as unknown as Record<string, unknown>[])
      .map((r) => toMilestone(r, counts.get(r.id as string) ?? 0));
  },

  async corrections(contractId: string): Promise<ContractCorrection[]> {
    const { data, error } = await requireSupabase()
      .from('contract_corrections')
      .select('id, contract_id, term_version_id, field, original_value, corrected_value, corrected_by, corrected_at')
      .eq('contract_id', contractId).order('corrected_at', { ascending: false });
    if (error) fail(error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      contractId: r.contract_id as string,
      termVersionId: r.term_version_id as string,
      field: r.field as string,
      originalValue: r.original_value,
      correctedValue: r.corrected_value,
      correctedBy: (r.corrected_by as string | null) ?? null,
      correctedAt: r.corrected_at as string,
    }));
  },

  async events(contractId: string): Promise<ContractEvent[]> {
    const { data, error } = await requireSupabase()
      .from('contract_events').select('id, contract_id, actor_user_id, kind, detail, created_at')
      .eq('contract_id', contractId).order('created_at', { ascending: false }).limit(100);
    if (error) fail(error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      contractId: r.contract_id as string,
      actorUserId: (r.actor_user_id as string | null) ?? null,
      kind: r.kind as ContractEvent['kind'],
      detail: (r.detail as Record<string, unknown> | null) ?? {},
      createdAt: r.created_at as string,
    }));
  },

  async tasks(contractId: string): Promise<ContractLinkedTask[]> {
    const { data, error } = await requireSupabase()
      .from('tasks')
      .select('id, title, status, priority, due_date, assignee_user_id, contract_milestone_id')
      .eq('contract_id', contractId).is('archived_at', null)
      .order('created_at', { ascending: false });
    if (error) fail(error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      status: r.status as ContractLinkedTask['status'],
      priority: r.priority as ContractLinkedTask['priority'],
      dueDate: (r.due_date as string | null) ?? null,
      assigneeUserId: (r.assignee_user_id as string | null) ?? null,
      milestoneId: (r.contract_milestone_id as string | null) ?? null,
    }));
  },

  // -------------------------------------------------------------------------
  // Scrittura
  // -------------------------------------------------------------------------

  /** Crea un contratto. Nasce SEMPRE da verificare: la verifica è un gesto umano. */
  async create(input: {
    companyId: string; displayName: string; contractType?: ContractType;
    counterpartyName?: string | null; ownerUserId?: string | null;
  }): Promise<string> {
    const { data, error } = await requireSupabase().from('contracts').insert({
      company_id: input.companyId,
      display_name: input.displayName.trim(),
      contract_type: input.contractType ?? 'other',
      counterparty_name: input.counterpartyName?.trim() || null,
      owner_user_id: input.ownerUserId ?? null,
    }).select('id').single();
    if (error) fail(error);
    return (data as { id: string }).id;
  },

  /**
   * L'organizzazione del contratto: nome, tipo, controparte, responsabile, stato
   * operativo, nota, archiviazione.
   * ⚠️ NON i termini: quelli passano dalle correzioni e dalla verifica.
   */
  async update(contractId: string, patch: {
    displayName?: string; contractType?: ContractType;
    counterpartyName?: string | null; ownerUserId?: string | null;
    lifecycleStatus?: ContractLifecycleStatus; internalNote?: string | null;
    archivedAt?: string | null;
  }): Promise<void> {
    // ⚠️ Tipizzato e non `Record<string, unknown>`: così una colonna che il
    // client NON ha il permesso di scrivere (stato di verifica, provenienza)
    // rompe il typecheck invece di essere rifiutata al salvataggio.
    const row: Database['public']['Tables']['contracts']['Update'] = {};
    if (patch.displayName !== undefined) row.display_name = patch.displayName.trim();
    if (patch.contractType !== undefined) row.contract_type = patch.contractType;
    if (patch.counterpartyName !== undefined) row.counterparty_name = patch.counterpartyName?.trim() || null;
    if (patch.ownerUserId !== undefined) row.owner_user_id = patch.ownerUserId;
    if (patch.lifecycleStatus !== undefined) row.lifecycle_status = patch.lifecycleStatus;
    if (patch.internalNote !== undefined) row.internal_note = patch.internalNote?.trim() || null;
    if (patch.archivedAt !== undefined) row.archived_at = patch.archivedAt;
    if (!Object.keys(row).length) return;
    const { error } = await requireSupabase().from('contracts').update(row).eq('id', contractId);
    if (error) fail(error);
  },

  /** Collega un documento già presente nel Document Hub (§75/§76). */
  async addDocument(input: {
    companyId: string; contractId: string; documentId: string;
    relation: ContractDocumentRelation; suggested?: boolean;
  }): Promise<void> {
    const { error } = await requireSupabase().from('contract_documents').insert({
      company_id: input.companyId,
      contract_id: input.contractId,
      document_id: input.documentId,
      relation: input.relation,
      suggested: input.suggested === true,
    });
    if (error) fail(error);
  },

  /** Scollega un documento. ⚠️ Il documento resta nel Document Hub (§108). */
  async removeDocument(linkId: string): Promise<void> {
    const { error } = await requireSupabase().from('contract_documents').delete().eq('id', linkId);
    if (error) fail(error);
  },

  async setRelation(linkId: string, relation: ContractDocumentRelation): Promise<void> {
    const { error } = await requireSupabase()
      .from('contract_documents').update({ relation }).eq('id', linkId);
    if (error) fail(error);
  },

  /** «Riprova lettura» (§131): rimette in coda, il worker la raccoglie. */
  async retryDocument(linkId: string): Promise<void> {
    const { error } = await requireSupabase()
      .from('contract_documents').update({ processing_status: 'pending' }).eq('id', linkId);
    if (error) fail(error);
  },

  async suggestions(contractId: string, limit = 10): Promise<ContractDocumentSuggestion[]> {
    const { data, error } = await requireSupabase()
      .rpc('contract_document_suggestions', { p_contract_id: contractId, p_limit: limit });
    if (error) fail(error);
    return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      documentId: r.document_id as string,
      title: r.title as string,
      createdAt: r.created_at as string,
      category: (r.category as ContractDocumentSuggestion['category']) ?? null,
      reason: r.reason as ContractDocumentSuggestion['reason'],
    }));
  },

  /**
   * Corregge un campo della BOZZA.
   * ⚠️ Non tocca l'estrazione (§21): il valore letto dalla macchina resta
   * visibile e auditabile. Il valore va come JSON: `null` è una cancellazione
   * voluta — «questo il contratto non lo dice» — e non un campo mancante.
   */
  async correct(input: {
    companyId: string; contractId: string; termVersionId: string;
    field: string; originalValue: unknown; correctedValue: unknown;
  }): Promise<void> {
    const { error } = await requireSupabase().from('contract_corrections').insert({
      company_id: input.companyId,
      contract_id: input.contractId,
      term_version_id: input.termVersionId,
      field: input.field,
      original_value: (input.originalValue ?? null) as Json,
      corrected_value: (input.correctedValue ?? null) as Json,
    });
    if (error) fail(error);
  },

  /**
   * Verifica una versione dei termini: da qui in poi sono quelli in vigore.
   * ⚠️ «Segna i dati come verificati», MAI «approva legalmente» (§83).
   */
  async verifyTerms(termVersionId: string): Promise<void> {
    const { error } = await requireSupabase()
      .rpc('contract_verify_terms', { p_version_id: termVersionId });
    if (error) fail(error);
  },

  /** Riapre una bozza su un contratto verificato, per correggerlo. */
  async openDraft(contractId: string): Promise<string | null> {
    const { data, error } = await requireSupabase()
      .rpc('contract_open_draft', { p_contract_id: contractId });
    if (error) fail(error);
    return (data as string | null) ?? null;
  },

  /** §44 — una data proposta diventa una data di cui qualcuno risponde. */
  async verifyMilestone(milestoneId: string): Promise<void> {
    const { error } = await requireSupabase()
      .from('contract_milestones').update({ status: 'verified' }).eq('id', milestoneId);
    if (error) fail(error);
  },

  async dismissMilestone(milestoneId: string): Promise<void> {
    const { error } = await requireSupabase()
      .from('contract_milestones').update({ status: 'dismissed' }).eq('id', milestoneId);
    if (error) fail(error);
  },

  /** Una data aggiunta a mano: è una decisione, e nasce già verificata. */
  async addMilestone(input: {
    companyId: string; contractId: string; kind: ContractMilestoneKind;
    dueDate: string; label?: string | null;
  }): Promise<void> {
    const { error } = await requireSupabase().from('contract_milestones').insert({
      company_id: input.companyId,
      contract_id: input.contractId,
      kind: input.kind,
      due_date: input.dueDate,
      label: input.label?.trim() || null,
    });
    if (error) fail(error);
  },

  /**
   * Crea un'attività da una data del contratto (§86).
   *
   * ⚠️ SOLO DA UNA DATA VERIFICATA (§87), e il controllo è qui perché il
   * database non può distinguere «l'ha chiesto una persona guardando la
   * schermata» da «l'ha chiesto qualcuno con la chiave anon». La difesa vera
   * resta il fatto che nessun percorso automatico crea attività da candidate:
   * il motore riceve solo eventi di date verificate.
   */
  async createTaskFromMilestone(input: {
    companyId: string; contractId: string; milestone: ContractMilestone;
    title: string; dueDate: string | null; assigneeUserId?: string | null;
    priority?: 'low' | 'medium' | 'high';
    /** ⚠️ OBBLIGATORIO: vedi sotto. */
    userId: string;
  }): Promise<string> {
    if (input.milestone.status !== 'verified') {
      throw new Error('milestone_not_verified');
    }
    // ⚠️⚠️ `created_by` NON È FACOLTATIVO, ed è la ragione per cui questo
    // percorso falliva in silenzio con «non hai i diritti»: la policy
    // `tasks_insert_member` della 0004 richiede `created_by = auth.uid()`, e
    // un insert senza quel campo viene respinto dalla RLS — non dal codice, che
    // sembrava perfettamente ragionevole. Trovato PREMENDO IL PULSANTE nella
    // schermata, non rileggendo il servizio.
    const { data, error } = await requireSupabase().from('tasks').insert({
      company_id: input.companyId,
      created_by: input.userId,
      title: input.title.trim(),
      due_date: input.dueDate,
      priority: input.priority ?? 'medium',
      status: 'open',
      source: 'manual',
      assignee_user_id: input.assigneeUserId ?? null,
      contract_id: input.contractId,
      contract_milestone_id: input.milestone.id,
    }).select('id').single();
    if (error) fail(error);
    return (data as { id: string }).id;
  },
};
