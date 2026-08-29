// ============================================================================
// crmService — l'accesso a clienti e controparti dal browser.
//
// ⚠️ QUESTO SERVIZIO NON PUÒ RISCRIVERE UN FATTO DI UN ALTRO MODULO, e non è una
// limitazione tecnica: è il modulo. Non esiste alcun metodo che cambi
// `contracts.counterparty_name`, `finance_items.eff_supplier_name` o
// `email_messages.sender_email`. Collegare scrive UNA colonna di riferimento;
// scollegare la azzera e non tocca nient'altro.
//
// ⚠️ NON ESISTE, E NON DEVE ESISTERE, alcun metodo che invii una email, iscriva
// a una sequenza, cerchi dati online o assegni un punteggio a una persona
// (§93, §95, §151, §152). L'Inbox è di sola lettura per contratto.
//
// La lista e il dettaglio passano dalla STESSA funzione del database
// (`list_crm_organizations`, con `p_organization_id`): due ricomposizioni dei
// conteggi finirebbero per mostrare due numeri diversi sulla stessa scheda.
// È la disciplina di `list_documents`, `list_contracts` e `list_finance_items`.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import type { Database, Json } from '@/types/database';
import type {
  CrmDocumentRelation, CrmFieldEntity, CrmFieldType, CrmInteractionType, CrmLinkStatus,
  CrmMatchReason, CrmOpportunityStage, CrmOrganizationRole, CrmRelationshipStatus, CrmSource,
  DocumentCategory,
} from '@/types/database';
import { toUserMessage } from '@/lib/errors';
import { etichettaDaRigaDocumento } from '@/lib/documentTitle';
import { normNameKey } from '@/features/crm/csvImport';
import {
  nextFieldPosition, sortFieldDefinitions, valueColumns,
} from '@/features/crm/crmFields';
import type {
  CrmContact, CrmContactMethod, CrmContactOrganization, CrmContractLink,
  CrmDocumentLink, CrmDuplicateCandidate, CrmEmailLink, CrmEmailMatch, CrmEvent,
  CrmFieldDefinition, CrmFieldEntry, CrmFieldValue,
  CrmFinanceLink, CrmHomeSummary, CrmInteraction, CrmLinkSuggestion,
  CrmOpportunity, CrmOrganization, CrmOrganizationDetail, CrmOrganizationOption,
  CrmPerson, CrmPipelineCell, CrmTimelineEntry,
} from '@/types/models';
import { CRM_PAGE_SIZE, CRM_TIMELINE_PAGE_SIZE, effectiveRole, safeWebsite, type CrmFilters } from '@/features/crm/crmModel';

function fail(error: unknown): never {
  throw new Error(crmErrorMessage(error));
}

/**
 * Il sito web da scrivere in colonna: `null` se non c'è, ERRORE se c'è e non è
 * http/https.
 *
 * ⚠️ SI RIFIUTA, NON SI RIPULISCE IN SILENZIO. Salvare `null` al posto di un
 * `javascript:…` toglierebbe il pericolo e anche la notizia: chi ha scritto
 * quel valore vedrebbe il campo svuotarsi senza sapere perché, e chi l'ha
 * scritto APPOSTA saprebbe solo che deve riprovare in un altro modo. Un guasto
 * è un errore esplicito, mai un risultato plausibile.
 */
function websiteDaSalvare(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  const safe = safeWebsite(value);
  if (!safe) throw new Error('crm.errors.websiteNotHttp');
  return safe;
}

/**
 * Il messaggio da mostrare, dai codici che i guardiani della 0026 sollevano.
 *
 * ⚠️ SENZA QUESTA FUNZIONE un errore delle guardie arriverebbe a schermo come
 * stringa tecnica: `toUserMessage` non mappa `23514`, quindi
 * `crm_owner_not_member` finirebbe in pagina così com'è — in italiano, dentro
 * un'interfaccia tedesca. È la stessa trappola già pagata con
 * `errorCreditExhausted`, dove la traduzione era scritta e non la usava
 * nessuno; e `contractService.contractErrorMessage` promette in un commento
 * questa mappatura senza farla. Qui si fa.
 *
 * Per i codici che non conosciamo resta il messaggio del server, che è il
 * valore GREZZO e non una categoria inventata.
 */
export function crmErrorMessage(error: unknown): string {
  const raw = error as { message?: string; hint?: string } | null;
  const text = `${raw?.message ?? ''} ${raw?.hint ?? ''}`;
  if (text.includes('crm_owner_not_member')) return 'crm.errors.ownerNotMember';
  if (text.includes('crm_opportunity_owner_not_member')) return 'crm.errors.ownerNotMember';
  if (text.includes('crm_opportunity_contact_not_in_organization')) return 'crm.errors.contactNotInOrganization';
  if (text.includes('crm_interaction_author_mismatch')) return 'crm.errors.authorMismatch';
  if (text.includes('crm_merge_not_admin')) return 'crm.errors.mergeNotAdmin';
  if (text.includes('crm_merge_into_self')) return 'crm.errors.mergeIntoSelf';
  if (text.includes('crm_merge_company_mismatch')) return 'crm.errors.companyMismatch';
  // I sentinella dei campi personalizzati (0047). `_company_mismatch` resta
  // coperto dalla regola generale sotto: `crm_field_value_company_mismatch`
  // ci finisce dentro da sé, e per chi legge la causa è la stessa.
  if (text.includes('crm_field_type_mismatch')) return 'crm.errors.fieldTypeMismatch';
  if (text.includes('crm_field_option_not_allowed')) return 'crm.errors.fieldOptionNotAllowed';
  if (text.includes('crm_field_value_empty')) return 'crm.errors.fieldValueEmpty';
  if (text.includes('crm_field_entity_mismatch')) return 'crm.errors.fieldEntityMismatch';
  if (text.includes('crm_field_archived')) return 'crm.errors.fieldArchived';
  if (text.includes('crm_field_unknown')) return 'crm.errors.fieldUnknown';
  if (text.includes('crm_field_options_duplicate')) return 'crm.errors.fieldOptionsDuplicate';
  if (text.includes('crm_field_options_invalid')) return 'crm.errors.fieldOptionsInvalid';
  // Tutte le guardie cross-tenant finiscono con `_company_mismatch`: un solo
  // messaggio, perché per chi legge la causa è la stessa — «queste due cose non
  // appartengono alla stessa azienda» — e distinguerle non cambierebbe nulla.
  if (text.includes('_company_mismatch')) return 'crm.errors.companyMismatch';
  if (text.includes('_organization_mismatch')) return 'crm.errors.organizationMismatch';
  return toUserMessage(error);
}

// ---------------------------------------------------------------------------
// Mappatura delle righe
//
// ⚠️ `numeric` di Postgres arriva come STRINGA da PostgREST quando il valore
// eccede la precisione sicura di un numero JavaScript. `num()` lo converte in
// un punto solo, e `null` resta `null`: un importo assente NON diventa zero,
// perché «non stimato» e «vale zero» sono due cose diverse (§46).
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

/**
 * Il nome di un'organizzazione, per scrivere «collegato a Rossi SA» invece di
 * «collegato a a10b1325…».
 *
 * ⚠️ Ritorna `null` se la riga non c'è o non è di questa azienda, e chi chiama
 * deve trattarlo come «non collegato»: un identificativo che punta al nulla non
 * è un collegamento, e mostrarlo come tale mentirebbe.
 */
async function nameOfOrganization(
  sb: ReturnType<typeof requireSupabase>, companyId: string, organizationId: string,
): Promise<{ id: string; displayName: string } | null> {
  const { data, error } = await sb.from('crm_organizations')
    .select('id, display_name').eq('company_id', companyId).eq('id', organizationId).limit(1);
  if (error) fail(error);
  const rows = (data ?? []) as Array<{ id: string; display_name: string }>;
  return rows.length ? { id: rows[0]!.id, displayName: rows[0]!.display_name } : null;
}

interface OrgRow {
  id: string; display_name: string; legal_name: string | null;
  uid_che: string | null; vat_number: string | null;
  website: string | null; website_domain: string | null;
  street: string | null; postal_code: string | null; city: string | null;
  canton: string | null; country_code: string | null;
  relationship_status: CrmRelationshipStatus;
  account_owner_user_id: string | null;
  source: CrmSource; source_detail: string | null; notes: string | null;
  last_contact_at: string | null; archived_at: string | null;
  merged_into_id: string | null;
  created_at: string; updated_at: string;
  roles: string[] | null;
  primary_contact_id: string | null; primary_contact_name: string | null;
  primary_email: string | null; primary_phone: string | null;
  contact_count: number; open_task_count: number; overdue_task_count: number;
  open_opportunity_count: number; won_opportunity_count: number;
  contract_count: number; document_count: number;
  email_count: number; finance_count: number;
  total_count: number | string;
}

function toOrganization(r: OrgRow): CrmOrganization {
  return {
    id: r.id,
    displayName: r.display_name,
    legalName: r.legal_name,
    uidChe: r.uid_che,
    vatNumber: r.vat_number,
    website: r.website,
    websiteDomain: r.website_domain,
    street: r.street,
    postalCode: r.postal_code,
    city: r.city,
    canton: r.canton,
    countryCode: r.country_code,
    relationshipStatus: r.relationship_status,
    accountOwnerUserId: r.account_owner_user_id,
    source: r.source,
    sourceDetail: r.source_detail,
    notes: r.notes,
    lastContactAt: r.last_contact_at,
    archivedAt: r.archived_at,
    mergedIntoId: r.merged_into_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    roles: (r.roles ?? []) as CrmOrganizationRole[],
    primaryContactId: r.primary_contact_id,
    primaryContactName: r.primary_contact_name,
    primaryEmail: r.primary_email,
    primaryPhone: r.primary_phone,
    contactCount: int(r.contact_count),
    openTaskCount: int(r.open_task_count),
    overdueTaskCount: int(r.overdue_task_count),
    openOpportunityCount: int(r.open_opportunity_count),
    wonOpportunityCount: int(r.won_opportunity_count),
    contractCount: int(r.contract_count),
    documentCount: int(r.document_count),
    emailCount: int(r.email_count),
    financeCount: int(r.finance_count),
  };
}

interface OppRow {
  id: string; organization_id: string; organization_name: string;
  primary_contact_id: string | null; primary_contact_name: string | null;
  title: string; stage: CrmOpportunityStage; owner_user_id: string | null;
  value_amount: number | string | null; value_currency: string | null;
  expected_close_date: string | null;
  next_step: string | null; next_step_due_date: string | null;
  lost_reason: string | null; won_at: string | null; lost_at: string | null;
  archived_at: string | null; created_at: string; updated_at: string;
  open_task_count: number; overdue_task_count: number; document_count: number;
  total_count: number | string;
}

function toOpportunity(r: OppRow): CrmOpportunity {
  return {
    id: r.id,
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    primaryContactId: r.primary_contact_id,
    primaryContactName: r.primary_contact_name,
    title: r.title,
    stage: r.stage,
    ownerUserId: r.owner_user_id,
    valueAmount: num(r.value_amount),
    valueCurrency: r.value_currency,
    expectedCloseDate: r.expected_close_date,
    nextStep: r.next_step,
    nextStepDueDate: r.next_step_due_date,
    lostReason: r.lost_reason,
    wonAt: r.won_at,
    lostAt: r.lost_at,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    openTaskCount: int(r.open_task_count),
    overdueTaskCount: int(r.overdue_task_count),
    documentCount: int(r.document_count),
  };
}

// ---------------------------------------------------------------------------
// Argomenti delle funzioni di lista
// ---------------------------------------------------------------------------
type ListOrgArgs = Database['public']['Functions']['list_crm_organizations']['Args'];

function toListArgs(companyId: string, f: CrmFilters): ListOrgArgs {
  return {
    p_company_id: companyId,
    p_query: f.query,
    p_role: effectiveRole(f),
    p_owner_user_id: f.owner,
    p_status: f.status,
    p_stage: f.stage,
    p_stale_days: f.staleDays,
    p_only_overdue_tasks: f.onlyOverdueTasks,
    p_no_open_opportunity: f.noOpenOpportunity,
    p_archived: f.archived,
    p_sort: f.sort,
    p_limit: CRM_PAGE_SIZE,
    p_offset: f.offset,
  };
}

export interface CrmOrganizationPage {
  items: CrmOrganization[];
  total: number;
}

// ---------------------------------------------------------------------------
// Campi personalizzati (0047) — mappatura delle righe
// ---------------------------------------------------------------------------
interface FieldDefRow {
  id: string; company_id: string;
  entity: CrmFieldEntity; name: string; field_type: CrmFieldType;
  options: unknown; is_required: boolean; position: number;
  archived_at: string | null; created_at: string; updated_at: string;
}

interface FieldValueRow {
  id: string; field_id: string;
  organization_id: string | null; opportunity_id: string | null;
  value_text: string | null; value_number: number | string | null;
  value_date: string | null; updated_at: string;
}

function toFieldDefinition(row: FieldDefRow): CrmFieldDefinition {
  return {
    id: row.id,
    companyId: row.company_id,
    entity: row.entity,
    name: row.name,
    fieldType: row.field_type,
    // Le opzioni arrivano come jsonb: il guardiano garantisce un array di
    // stringhe, ma il tipo della colonna è `Json` e la forma si verifica qui.
    options: Array.isArray(row.options) ? row.options.map(String) : [],
    isRequired: row.is_required,
    position: row.position,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toFieldValue(row: FieldValueRow, defs: CrmFieldDefinition[]): CrmFieldValue {
  // Delle tre colonne se ne legge UNA, quella del tipo della definizione: le
  // altre due sono NULL per costruzione, e leggerle «per sicurezza»
  // confonderebbe un refuso del database con un dato.
  const def = defs.find((d) => d.id === row.field_id);
  const value = def?.fieldType === 'number' ? num(row.value_number)
    : def?.fieldType === 'date' ? row.value_date
    : row.value_text;
  return {
    id: row.id,
    fieldId: row.field_id,
    organizationId: row.organization_id,
    opportunityId: row.opportunity_id,
    value,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Scritture
// ---------------------------------------------------------------------------
type OrgInsert = Database['public']['Tables']['crm_organizations']['Insert'];
type OrgUpdate = Database['public']['Tables']['crm_organizations']['Update'];
type ContactInsert = Database['public']['Tables']['crm_contacts']['Insert'];
type ContactUpdate = Database['public']['Tables']['crm_contacts']['Update'];
type OppInsert = Database['public']['Tables']['crm_opportunities']['Insert'];
type OppUpdate = Database['public']['Tables']['crm_opportunities']['Update'];
type FieldDefInsert = Database['public']['Tables']['crm_field_definitions']['Insert'];
type FieldDefUpdate = Database['public']['Tables']['crm_field_definitions']['Update'];
type FieldValueInsert = Database['public']['Tables']['crm_field_values']['Insert'];
type FieldValueUpdate = Database['public']['Tables']['crm_field_values']['Update'];

export interface CreateOrganizationInput {
  displayName: string;
  legalName?: string | null;
  uidChe?: string | null;
  vatNumber?: string | null;
  website?: string | null;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
  canton?: string | null;
  countryCode?: string | null;
  accountOwnerUserId?: string | null;
  notes?: string | null;
  /**
   * §96 — `registry` significa «i dati vengono dallo Zefix», e la schermata deve
   * mostrare il disclaimer di non vincolatività. Non è una parola libera: il
   * guardiano ammette dal browser solo `manual`, `registry` e `import`.
   */
  source?: Extract<CrmSource, 'manual' | 'registry' | 'import'>;
  sourceDetail?: string | null;
  /** I ruoli iniziali. Vuoto è legittimo: una controparte può non avere ancora un ruolo. */
  roles?: CrmOrganizationRole[];
}

export const crmService = {
  // -------------------------------------------------------------------------
  // Organizzazioni
  // -------------------------------------------------------------------------
  async list(companyId: string, filters: CrmFilters): Promise<CrmOrganizationPage> {
    const { data, error } = await requireSupabase()
      .rpc('list_crm_organizations', toListArgs(companyId, filters));
    if (error) fail(error);
    const rows = (data ?? []) as unknown as OrgRow[];
    return {
      items: rows.map(toOrganization),
      // `total_count` è uguale su ogni riga (funzione finestra): affidabile SOLO
      // se una riga c'è. Senza righe non esiste un totale da leggere.
      total: rows.length ? int(rows[0]!.total_count) : 0,
    };
  },

  /**
   * Il dettaglio passa dalla stessa funzione della lista, con
   * `p_organization_id`. Ritorna `null` se non esiste O se appartiene a un'altra
   * azienda: §117 — la schermata dice «non trovato» e non rivela la differenza,
   * perché distinguerle confermerebbe l'esistenza di un dato altrui.
   */
  async get(companyId: string, organizationId: string): Promise<CrmOrganization | null> {
    const { data, error } = await requireSupabase()
      .rpc('list_crm_organizations', {
        p_company_id: companyId,
        p_organization_id: organizationId,
        p_limit: 1,
      });
    if (error) fail(error);
    const rows = (data ?? []) as unknown as OrgRow[];
    return rows.length ? toOrganization(rows[0]!) : null;
  },

  async create(companyId: string, input: CreateOrganizationInput): Promise<string> {
    const sb = requireSupabase();
    const row: OrgInsert = {
      company_id: companyId,
      display_name: input.displayName.trim(),
      legal_name: input.legalName?.trim() || null,
      uid_che: input.uidChe?.trim() || null,
      vat_number: input.vatNumber?.trim() || null,
      website: websiteDaSalvare(input.website),
      street: input.street?.trim() || null,
      postal_code: input.postalCode?.trim() || null,
      city: input.city?.trim() || null,
      canton: input.canton?.trim().toUpperCase() || null,
      country_code: input.countryCode?.trim().toUpperCase() || null,
      account_owner_user_id: input.accountOwnerUserId || null,
      notes: input.notes?.trim() || null,
      source: input.source ?? 'manual',
      source_detail: input.sourceDetail?.trim() || null,
    };
    const { data, error } = await sb
      .from('crm_organizations').insert(row).select('id').single();
    if (error) fail(error);
    const id = (data as { id: string }).id;

    // ⚠️ I ruoli sono un secondo inserimento e NON una transazione con il
    // primo: PostgREST non ne offre una. Se questa parte falliRISCE
    // l'organizzazione resta — senza ruoli, che è uno stato legittimo e
    // visibile — e l'errore si dichiara. La lezione della conversione
    // Admin AI → Attività: se i passaggi non si inseriscono, l'attività resta e
    // il messaggio lo dice, invece di far sparire tutto.
    if (input.roles?.length) {
      const { error: roleError } = await sb.from('crm_organization_roles').insert(
        input.roles.map((role) => ({ company_id: companyId, organization_id: id, role })),
      );
      if (roleError) {
        throw new Error(`crm.errors.rolesNotSaved:${id}`);
      }
    }
    return id;
  },

  async update(organizationId: string, patch: Partial<CreateOrganizationInput>): Promise<void> {
    const row: OrgUpdate = {};
    if (patch.displayName !== undefined) row.display_name = patch.displayName.trim();
    if (patch.legalName !== undefined) row.legal_name = patch.legalName?.trim() || null;
    if (patch.uidChe !== undefined) row.uid_che = patch.uidChe?.trim() || null;
    if (patch.vatNumber !== undefined) row.vat_number = patch.vatNumber?.trim() || null;
    if (patch.website !== undefined) row.website = websiteDaSalvare(patch.website);
    if (patch.street !== undefined) row.street = patch.street?.trim() || null;
    if (patch.postalCode !== undefined) row.postal_code = patch.postalCode?.trim() || null;
    if (patch.city !== undefined) row.city = patch.city?.trim() || null;
    if (patch.canton !== undefined) row.canton = patch.canton?.trim().toUpperCase() || null;
    if (patch.countryCode !== undefined) row.country_code = patch.countryCode?.trim().toUpperCase() || null;
    if (patch.accountOwnerUserId !== undefined) row.account_owner_user_id = patch.accountOwnerUserId || null;
    if (patch.notes !== undefined) row.notes = patch.notes?.trim() || null;
    if (patch.sourceDetail !== undefined) row.source_detail = patch.sourceDetail?.trim() || null;

    const { error } = await requireSupabase()
      .from('crm_organizations').update(row).eq('id', organizationId);
    if (error) fail(error);
  },

  async setStatus(organizationId: string, status: CrmRelationshipStatus): Promise<void> {
    const { error } = await requireSupabase()
      .from('crm_organizations').update({ relationship_status: status } as OrgUpdate)
      .eq('id', organizationId);
    if (error) fail(error);
  },

  /**
   * §123 — archiviare NASCONDE, non cancella: collegamenti, timeline e storico
   * restano, e i documenti e i contratti dell'azienda non sono toccati. Il
   * valore vero di `archived_at` lo scrive il database: qui si DICHIARA
   * l'intenzione.
   */
  async archive(organizationId: string): Promise<void> {
    const { error } = await requireSupabase()
      .from('crm_organizations').update({ archived_at: new Date().toISOString() } as OrgUpdate)
      .eq('id', organizationId);
    if (error) fail(error);
  },

  async restore(organizationId: string): Promise<void> {
    const { error } = await requireSupabase()
      .from('crm_organizations').update({ archived_at: null } as OrgUpdate)
      .eq('id', organizationId);
    if (error) fail(error);
  },

  /** §31 — solo amministratori, e il database lo verifica: qui non si controlla nulla. */
  async merge(targetId: string, sourceId: string): Promise<void> {
    const { error } = await requireSupabase()
      .rpc('crm_merge_organizations', { p_target_id: targetId, p_source_id: sourceId });
    if (error) fail(error);
  },

  // -------------------------------------------------------------------------
  // Ruoli
  // -------------------------------------------------------------------------
  async addRole(companyId: string, organizationId: string, role: CrmOrganizationRole): Promise<void> {
    const { error } = await requireSupabase().from('crm_organization_roles')
      .insert({ company_id: companyId, organization_id: organizationId, role });
    // Un ruolo che c'è già non è un errore da mostrare: il risultato voluto è
    // già vero. `23505` = violazione di unicità.
    if (error && (error as { code?: string }).code !== '23505') fail(error);
  },

  async removeRole(organizationId: string, role: CrmOrganizationRole): Promise<void> {
    const { error } = await requireSupabase().from('crm_organization_roles')
      .delete().eq('organization_id', organizationId).eq('role', role);
    if (error) fail(error);
  },

  // -------------------------------------------------------------------------
  // Persone
  // -------------------------------------------------------------------------
  async people(companyId: string, organizationId: string): Promise<CrmPerson[]> {
    const sb = requireSupabase();
    const { data: links, error: linkError } = await sb
      .from('crm_contact_organizations')
      .select('id, contact_id, organization_id, job_title, department, is_primary, active_from, active_until')
      .eq('company_id', companyId)
      .eq('organization_id', organizationId)
      .order('is_primary', { ascending: false });
    if (linkError) fail(linkError);

    const rows = (links ?? []) as Array<{
      id: string; contact_id: string; organization_id: string;
      job_title: string | null; department: string | null; is_primary: boolean;
      active_from: string | null; active_until: string | null;
    }>;
    if (rows.length === 0) return [];

    const contactIds = [...new Set(rows.map((r) => r.contact_id))];
    // ⚠️ Due interrogazioni e non un embed PostgREST: `crm_contact_methods` ha
    // un vincolo XOR fra contatto e organizzazione, e un embed avrebbe portato
    // anche i recapiti dell'ORGANIZZAZIONE dentro quelli delle persone.
    const [{ data: contacts, error: cErr }, { data: methods, error: mErr }] = await Promise.all([
      sb.from('crm_contacts')
        .select('id, first_name, last_name, display_name, preferred_language, notes, archived_at, created_at, updated_at')
        .in('id', contactIds),
      sb.from('crm_contact_methods')
        .select('id, contact_id, organization_id, type, value, normalized_value, label, is_primary')
        .in('contact_id', contactIds),
    ]);
    if (cErr) fail(cErr);
    if (mErr) fail(mErr);

    const byId = new Map(
      ((contacts ?? []) as Array<Record<string, unknown>>).map((c) => [c.id as string, c]),
    );
    const methodsByContact = new Map<string, CrmContactMethod[]>();
    for (const m of (methods ?? []) as Array<Record<string, unknown>>) {
      const key = m.contact_id as string;
      const list = methodsByContact.get(key) ?? [];
      list.push({
        id: m.id as string,
        contactId: (m.contact_id as string | null) ?? null,
        organizationId: (m.organization_id as string | null) ?? null,
        type: m.type as CrmContactMethod['type'],
        value: m.value as string,
        normalizedValue: (m.normalized_value as string | null) ?? null,
        label: (m.label as string | null) ?? null,
        isPrimary: Boolean(m.is_primary),
      });
      methodsByContact.set(key, list);
    }

    return rows
      .filter((r) => byId.has(r.contact_id))
      .map((r) => {
        const c = byId.get(r.contact_id)!;
        const contact: CrmContact = {
          id: c.id as string,
          firstName: (c.first_name as string | null) ?? null,
          lastName: (c.last_name as string | null) ?? null,
          displayName: c.display_name as string,
          preferredLanguage: (c.preferred_language as CrmContact['preferredLanguage']) ?? null,
          notes: (c.notes as string | null) ?? null,
          archivedAt: (c.archived_at as string | null) ?? null,
          createdAt: c.created_at as string,
          updatedAt: c.updated_at as string,
        };
        const org: CrmContactOrganization = {
          id: r.id,
          contactId: r.contact_id,
          organizationId: r.organization_id,
          organizationName: null,
          jobTitle: r.job_title,
          department: r.department,
          isPrimary: r.is_primary,
          activeFrom: r.active_from,
          activeUntil: r.active_until,
        };
        return { contact, methods: methodsByContact.get(r.contact_id) ?? [], organizations: [org] };
      });
  },

  /**
   * Crea una persona e la collega all'organizzazione.
   *
   * ⚠️ §127 — un indirizzo email appartiene a UN solo soggetto dentro
   * l'azienda: se `info@rossi.ch` è già dell'organizzazione, questo inserimento
   * riceve un `23505` e il messaggio invita a spostarlo invece di duplicarlo.
   */
  async addPerson(companyId: string, organizationId: string, input: {
    displayName: string;
    firstName?: string | null;
    lastName?: string | null;
    preferredLanguage?: 'it' | 'de' | 'fr' | null;
    jobTitle?: string | null;
    email?: string | null;
    phone?: string | null;
    isPrimary?: boolean;
    notes?: string | null;
  }): Promise<string> {
    const sb = requireSupabase();
    const contact: ContactInsert = {
      company_id: companyId,
      display_name: input.displayName.trim(),
      first_name: input.firstName?.trim() || null,
      last_name: input.lastName?.trim() || null,
      preferred_language: input.preferredLanguage ?? null,
      notes: input.notes?.trim() || null,
    };
    const { data, error } = await sb.from('crm_contacts').insert(contact).select('id').single();
    if (error) fail(error);
    const contactId = (data as { id: string }).id;

    const { error: linkError } = await sb.from('crm_contact_organizations').insert({
      company_id: companyId,
      contact_id: contactId,
      organization_id: organizationId,
      job_title: input.jobTitle?.trim() || null,
      is_primary: input.isPrimary ?? false,
    });
    if (linkError) fail(linkError);

    const methods: Array<Database['public']['Tables']['crm_contact_methods']['Insert']> = [];
    if (input.email?.trim()) {
      methods.push({
        company_id: companyId, contact_id: contactId, type: 'email',
        value: input.email.trim(), is_primary: true,
      });
    }
    if (input.phone?.trim()) {
      methods.push({
        company_id: companyId, contact_id: contactId, type: 'phone',
        value: input.phone.trim(), is_primary: true,
      });
    }
    if (methods.length) {
      const { error: mError } = await sb.from('crm_contact_methods').insert(methods);
      if (mError) fail(mError);
    }
    return contactId;
  },

  async updatePerson(contactId: string, patch: {
    displayName?: string;
    firstName?: string | null;
    lastName?: string | null;
    preferredLanguage?: 'it' | 'de' | 'fr' | null;
    notes?: string | null;
  }): Promise<void> {
    const row: ContactUpdate = {};
    if (patch.displayName !== undefined) row.display_name = patch.displayName.trim();
    if (patch.firstName !== undefined) row.first_name = patch.firstName?.trim() || null;
    if (patch.lastName !== undefined) row.last_name = patch.lastName?.trim() || null;
    if (patch.preferredLanguage !== undefined) row.preferred_language = patch.preferredLanguage;
    if (patch.notes !== undefined) row.notes = patch.notes?.trim() || null;
    const { error } = await requireSupabase().from('crm_contacts').update(row).eq('id', contactId);
    if (error) fail(error);
  },

  /** §126 — archiviato non appare nei selettori, ma le vecchie email restano. */
  async archivePerson(contactId: string): Promise<void> {
    const { error } = await requireSupabase().from('crm_contacts')
      .update({ archived_at: new Date().toISOString() } as ContactUpdate).eq('id', contactId);
    if (error) fail(error);
  },

  // -------------------------------------------------------------------------
  // Recapiti
  // -------------------------------------------------------------------------
  async organizationMethods(companyId: string, organizationId: string): Promise<CrmContactMethod[]> {
    const { data, error } = await requireSupabase().from('crm_contact_methods')
      .select('id, contact_id, organization_id, type, value, normalized_value, label, is_primary')
      .eq('company_id', companyId).eq('organization_id', organizationId)
      .order('is_primary', { ascending: false });
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((m) => ({
      id: m.id as string,
      contactId: (m.contact_id as string | null) ?? null,
      organizationId: (m.organization_id as string | null) ?? null,
      type: m.type as CrmContactMethod['type'],
      value: m.value as string,
      normalizedValue: (m.normalized_value as string | null) ?? null,
      label: (m.label as string | null) ?? null,
      isPrimary: Boolean(m.is_primary),
    }));
  },

  async addMethod(companyId: string, owner: { organizationId?: string; contactId?: string }, input: {
    type: CrmContactMethod['type']; value: string; label?: string | null; isPrimary?: boolean;
  }): Promise<void> {
    const { error } = await requireSupabase().from('crm_contact_methods').insert({
      company_id: companyId,
      organization_id: owner.organizationId ?? null,
      contact_id: owner.contactId ?? null,
      type: input.type,
      value: input.value.trim(),
      label: input.label?.trim() || null,
      is_primary: input.isPrimary ?? false,
    });
    if (error) fail(error);
  },

  async removeMethod(methodId: string): Promise<void> {
    const { error } = await requireSupabase()
      .from('crm_contact_methods').delete().eq('id', methodId);
    if (error) fail(error);
  },

  // -------------------------------------------------------------------------
  // Opportunità
  // -------------------------------------------------------------------------
  async opportunities(companyId: string, options: {
    organizationId?: string | null;
    stage?: CrmOpportunityStage | null;
    owner?: string | null;
    query?: string | null;
    onlyOverdueNextStep?: boolean;
    onlyWithoutNextStep?: boolean;
    archived?: boolean;
    sort?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: CrmOpportunity[]; total: number }> {
    const { data, error } = await requireSupabase().rpc('list_crm_opportunities', {
      p_company_id: companyId,
      p_query: options.query ?? null,
      p_stage: options.stage ?? null,
      p_owner_user_id: options.owner ?? null,
      p_organization_id: options.organizationId ?? null,
      p_only_overdue_next_step: options.onlyOverdueNextStep ?? false,
      p_only_without_next_step: options.onlyWithoutNextStep ?? false,
      p_archived: options.archived ?? false,
      p_sort: options.sort ?? 'updated',
      p_limit: options.limit ?? 50,
      p_offset: options.offset ?? 0,
    });
    if (error) fail(error);
    const rows = (data ?? []) as unknown as OppRow[];
    return { items: rows.map(toOpportunity), total: rows.length ? int(rows[0]!.total_count) : 0 };
  },

  async opportunity(companyId: string, opportunityId: string): Promise<CrmOpportunity | null> {
    const { data, error } = await requireSupabase().rpc('list_crm_opportunities', {
      p_company_id: companyId, p_opportunity_id: opportunityId, p_limit: 1,
    });
    if (error) fail(error);
    const rows = (data ?? []) as unknown as OppRow[];
    return rows.length ? toOpportunity(rows[0]!) : null;
  },

  async createOpportunity(companyId: string, organizationId: string, input: {
    title: string;
    stage?: CrmOpportunityStage;
    ownerUserId?: string | null;
    primaryContactId?: string | null;
    valueAmount?: number | null;
    valueCurrency?: string | null;
    expectedCloseDate?: string | null;
    nextStep?: string | null;
    nextStepDueDate?: string | null;
  }): Promise<string> {
    const row: OppInsert = {
      company_id: companyId,
      organization_id: organizationId,
      title: input.title.trim(),
      stage: input.stage ?? 'lead',
      owner_user_id: input.ownerUserId || null,
      primary_contact_id: input.primaryContactId || null,
      value_amount: input.valueAmount ?? null,
      // §45 — se c'è un importo c'è la valuta, e il database ha un vincolo che
      // lo pretende: mandare l'uno senza l'altra produce un rifiuto, non una
      // riga con una valuta indovinata.
      value_currency: input.valueCurrency?.trim().toUpperCase() || null,
      expected_close_date: input.expectedCloseDate || null,
      next_step: input.nextStep?.trim() || null,
      next_step_due_date: input.nextStepDueDate || null,
    };
    const { data, error } = await requireSupabase()
      .from('crm_opportunities').insert(row).select('id').single();
    if (error) fail(error);
    return (data as { id: string }).id;
  },

  async updateOpportunity(opportunityId: string, patch: {
    title?: string;
    stage?: CrmOpportunityStage;
    ownerUserId?: string | null;
    primaryContactId?: string | null;
    valueAmount?: number | null;
    valueCurrency?: string | null;
    expectedCloseDate?: string | null;
    nextStep?: string | null;
    nextStepDueDate?: string | null;
    lostReason?: string | null;
  }): Promise<void> {
    const row: OppUpdate = {};
    if (patch.title !== undefined) row.title = patch.title.trim();
    if (patch.stage !== undefined) row.stage = patch.stage;
    if (patch.ownerUserId !== undefined) row.owner_user_id = patch.ownerUserId || null;
    if (patch.primaryContactId !== undefined) row.primary_contact_id = patch.primaryContactId || null;
    if (patch.valueAmount !== undefined) row.value_amount = patch.valueAmount;
    if (patch.valueCurrency !== undefined) row.value_currency = patch.valueCurrency?.trim().toUpperCase() || null;
    if (patch.expectedCloseDate !== undefined) row.expected_close_date = patch.expectedCloseDate || null;
    if (patch.nextStep !== undefined) row.next_step = patch.nextStep?.trim() || null;
    if (patch.nextStepDueDate !== undefined) row.next_step_due_date = patch.nextStepDueDate || null;
    if (patch.lostReason !== undefined) row.lost_reason = patch.lostReason?.trim() || null;
    const { error } = await requireSupabase()
      .from('crm_opportunities').update(row).eq('id', opportunityId);
    if (error) fail(error);
  },

  /**
   * §42 e §43 — cambiare fase è un GESTO UMANO. I timbri `won_at`/`lost_at` li
   * scrive il database, il ruolo `customer` lo aggiunge un trigger, e lo
   * storico del passaggio resta in `crm_events` anche se qualcuno riapre.
   */
  async setStage(opportunityId: string, stage: CrmOpportunityStage, lostReason?: string | null): Promise<void> {
    const row: OppUpdate = { stage };
    if (stage === 'lost') row.lost_reason = lostReason?.trim() || null;
    const { error } = await requireSupabase()
      .from('crm_opportunities').update(row).eq('id', opportunityId);
    if (error) fail(error);
  },

  async archiveOpportunity(opportunityId: string): Promise<void> {
    const { error } = await requireSupabase().from('crm_opportunities')
      .update({ archived_at: new Date().toISOString() } as OppUpdate).eq('id', opportunityId);
    if (error) fail(error);
  },

  // -------------------------------------------------------------------------
  // Interazioni
  // -------------------------------------------------------------------------
  async interactions(companyId: string, organizationId: string, limit = 50): Promise<CrmInteraction[]> {
    const { data, error } = await requireSupabase().from('crm_interactions')
      .select('id, organization_id, contact_id, opportunity_id, type, occurred_at, subject, notes, created_by, created_at, updated_at')
      .eq('company_id', companyId).eq('organization_id', organizationId)
      .order('occurred_at', { ascending: false }).limit(limit);
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      organizationId: r.organization_id as string,
      contactId: (r.contact_id as string | null) ?? null,
      opportunityId: (r.opportunity_id as string | null) ?? null,
      type: r.type as CrmInteractionType,
      occurredAt: r.occurred_at as string,
      subject: (r.subject as string | null) ?? null,
      notes: (r.notes as string | null) ?? null,
      createdBy: (r.created_by as string | null) ?? null,
      createdAt: r.created_at as string,
      updatedAt: r.updated_at as string,
    }));
  },

  /**
   * ⚠️ NON si manda `created_by`: lo scrive il database da `auth.uid()`, e il
   * guardiano RIFIUTA un autore diverso invece di riscriverlo in silenzio. È la
   * correzione della 0016 sui commenti delle attività, dove chi provava a
   * firmare come un collega riceveva «inserito».
   */
  async addInteraction(companyId: string, organizationId: string, input: {
    type: CrmInteractionType;
    occurredAt?: string;
    subject?: string | null;
    notes?: string | null;
    contactId?: string | null;
    opportunityId?: string | null;
  }): Promise<void> {
    const { error } = await requireSupabase().from('crm_interactions').insert({
      company_id: companyId,
      organization_id: organizationId,
      type: input.type,
      occurred_at: input.occurredAt ?? new Date().toISOString(),
      subject: input.subject?.trim() || null,
      notes: input.notes?.trim() || null,
      contact_id: input.contactId || null,
      opportunity_id: input.opportunityId || null,
    });
    if (error) fail(error);
  },

  async removeInteraction(interactionId: string): Promise<void> {
    const { error } = await requireSupabase()
      .from('crm_interactions').delete().eq('id', interactionId);
    if (error) fail(error);
  },

  // -------------------------------------------------------------------------
  // Timeline, storico, duplicati
  // -------------------------------------------------------------------------
  async timeline(companyId: string, organizationId: string, offset = 0): Promise<{
    entries: CrmTimelineEntry[]; total: number;
  }> {
    const { data, error } = await requireSupabase().rpc('crm_timeline', {
      p_company_id: companyId,
      p_organization_id: organizationId,
      p_limit: CRM_TIMELINE_PAGE_SIZE,
      p_offset: offset,
    });
    if (error) fail(error);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    return {
      entries: rows.map((r) => ({
        id: r.id as string,
        kind: r.kind as CrmTimelineEntry['kind'],
        occurredAt: r.occurred_at as string,
        title: (r.title as string | null) ?? null,
        detail: (r.detail as Record<string, unknown> | null) ?? {},
        entityType: r.entity_type as string,
        entityId: r.entity_id as string,
        actorUserId: (r.actor_user_id as string | null) ?? null,
        contactId: (r.contact_id as string | null) ?? null,
        opportunityId: (r.opportunity_id as string | null) ?? null,
        threadKey: (r.thread_key as string | null) ?? null,
      })),
      total: rows.length ? int(rows[0]!.total_count) : 0,
    };
  },

  async duplicates(companyId: string, organizationId?: string | null): Promise<CrmDuplicateCandidate[]> {
    const { data, error } = await requireSupabase().rpc('crm_duplicate_candidates', {
      p_company_id: companyId, p_organization_id: organizationId ?? null,
    });
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      organizationId: r.organization_id as string,
      displayName: r.display_name as string,
      duplicateId: r.duplicate_id as string,
      duplicateName: r.duplicate_name as string,
      reason: r.reason as CrmMatchReason,
      reasonDetail: (r.reason_detail as string | null) ?? null,
    }));
  },

  /**
   * L'indice per la deduplicazione dell'import CSV, caricato UNA volta prima
   * dell'anteprima: chiavi normalizzate e nomi, non righe intere.
   *
   * ⚠️ NESSUN FILTRO SULLE ARCHIVIATE, ed è voluto: i due vincoli unici
   * (`uq_crm_org_uid`, `uq_crm_method_email`) non guardano `archived_at`,
   * quindi un'anagrafica archiviata BLOCCA comunque un inserimento. Escluderla
   * qui farebbe dire all'anteprima «importabile» di una riga che il database
   * respingerebbe — la schermata saprebbe meno del vincolo.
   */
  async importDedupIndex(companyId: string): Promise<{
    uids: string[]; emails: string[]; domains: string[]; names: string[];
  }> {
    const sb = requireSupabase();
    const [{ data: orgs, error: oErr }, { data: methods, error: mErr }] = await Promise.all([
      sb.from('crm_organizations')
        .select('display_name, uid_norm, website_domain')
        .eq('company_id', companyId),
      sb.from('crm_contact_methods')
        .select('normalized_value')
        .eq('company_id', companyId)
        .eq('type', 'email'),
    ]);
    if (oErr) fail(oErr);
    if (mErr) fail(mErr);
    const uids: string[] = [];
    const domains: string[] = [];
    const names: string[] = [];
    for (const r of (orgs ?? []) as Array<Record<string, unknown>>) {
      if (r.uid_norm) uids.push(r.uid_norm as string);
      if (r.website_domain) domains.push(r.website_domain as string);
      const key = normNameKey((r.display_name as string | null) ?? '');
      if (key) names.push(key);
    }
    const emails = ((methods ?? []) as Array<Record<string, unknown>>)
      .map((m) => m.normalized_value as string | null)
      .filter((v): v is string => Boolean(v));
    return { uids, emails, domains, names };
  },

  // -------------------------------------------------------------------------
  // Misure
  // -------------------------------------------------------------------------
  /**
   * ⚠️ Ritorna `null` quando il database non rende alcuna riga, e la differenza
   * conta: la funzione SQL filtra su `is_company_member`, quindi zero righe
   * significa «non sei membro», non «tutti i numeri sono zero». Restituire zeri
   * sarebbe un guasto travestito da stato legittimo — la trappola dell'Inbox
   * che diceva «collega la posta aziendale» invece dell'errore.
   */
  async homeSummary(companyId: string, staleDays: number): Promise<CrmHomeSummary | null> {
    const { data, error } = await requireSupabase().rpc('crm_home_summary', {
      p_company_id: companyId, p_stale_days: staleDays,
    });
    if (error) fail(error);
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return null;
    const r = rows[0]!;
    return {
      openOpportunities: int(r.open_opportunities),
      withoutNextStep: int(r.without_next_step),
      overdueFollowUps: int(r.overdue_follow_ups),
      staleRelationships: int(r.stale_relationships),
      pendingSuggestions: int(r.pending_suggestions),
    };
  },

  async pipeline(companyId: string): Promise<CrmPipelineCell[]> {
    const { data, error } = await requireSupabase()
      .rpc('crm_pipeline_summary', { p_company_id: companyId });
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      stage: r.stage as CrmOpportunityStage,
      currency: (r.currency as string | null) ?? null,
      opportunityCount: int(r.opportunity_count),
      totalAmount: num(r.total_amount),
    }));
  },

  // -------------------------------------------------------------------------
  // Collegamenti agli altri moduli
  // -------------------------------------------------------------------------
  /**
   * §22 — chi è questo indirizzo. `email_exact` è un'identità; `domain_match` è
   * un sospetto e chi lo usa deve proporre, non collegare.
   */
  async matchEmail(companyId: string, email: string): Promise<CrmEmailMatch[]> {
    const { data, error } = await requireSupabase()
      .rpc('crm_match_email', { p_company_id: companyId, p_email: email });
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      organizationId: (r.organization_id as string | null) ?? null,
      organizationName: (r.organization_name as string | null) ?? null,
      contactId: (r.contact_id as string | null) ?? null,
      contactName: (r.contact_name as string | null) ?? null,
      reason: r.reason as CrmMatchReason,
      reasonDetail: (r.reason_detail as string | null) ?? null,
    }));
  },

  async options(companyId: string, query?: string | null): Promise<CrmOrganizationOption[]> {
    const { data, error } = await requireSupabase()
      .rpc('crm_organization_options', { p_company_id: companyId, p_query: query ?? null });
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      displayName: r.display_name as string,
      city: (r.city as string | null) ?? null,
      roles: (r.roles as CrmOrganizationRole[] | null) ?? [],
    }));
  },

  async linkDocument(companyId: string, organizationId: string, documentId: string,
    relation: CrmDocumentRelation = 'counterparty'): Promise<void> {
    const { error } = await requireSupabase().from('crm_organization_documents').insert({
      company_id: companyId, organization_id: organizationId,
      document_id: documentId, relation,
    });
    if (error && (error as { code?: string }).code !== '23505') fail(error);
  },

  async unlinkDocument(organizationId: string, documentId: string): Promise<void> {
    const { error } = await requireSupabase().from('crm_organization_documents')
      .delete().eq('organization_id', organizationId).eq('document_id', documentId);
    if (error) fail(error);
  },

  async linkEmail(companyId: string, organizationId: string, emailMessageId: string): Promise<void> {
    const { error } = await requireSupabase().from('crm_organization_emails').insert({
      company_id: companyId, organization_id: organizationId, email_message_id: emailMessageId,
    });
    if (error && (error as { code?: string }).code !== '23505') fail(error);
  },

  async unlinkEmail(organizationId: string, emailMessageId: string): Promise<void> {
    const { error } = await requireSupabase().from('crm_organization_emails')
      .delete().eq('organization_id', organizationId).eq('email_message_id', emailMessageId);
    if (error) fail(error);
  },

  /**
   * §26 e §188 — collegare una controparte NON tocca `counterparty_name`, e
   * scollegare non lo cancella. Il nome che il contratto dice resta quello che
   * il contratto dice.
   */
  async linkContract(contractId: string, organizationId: string | null): Promise<void> {
    const { error } = await requireSupabase().from('contracts')
      .update({ counterparty_organization_id: organizationId }).eq('id', contractId);
    if (error) fail(error);
  },

  /** §27 e §189 — `eff_supplier_name` resta il nome letto sulla fattura. */
  async linkFinanceItem(financeItemId: string, organizationId: string | null): Promise<void> {
    const { error } = await requireSupabase().from('finance_items')
      .update({ supplier_organization_id: organizationId }).eq('id', financeItemId);
    if (error) fail(error);
  },

  async linkTask(taskId: string, organizationId: string | null, opportunityId?: string | null): Promise<void> {
    const { error } = await requireSupabase().from('tasks').update({
      crm_organization_id: organizationId,
      crm_opportunity_id: opportunityId ?? null,
    }).eq('id', taskId);
    if (error) fail(error);
  },

  // -------------------------------------------------------------------------
  // Ciò che è collegato — si LEGGE all'inverso
  //
  // ⚠️ Nessun embed PostgREST verso `profiles`: `assignee_user_id` punta ad
  // `auth.users` e PostgREST rifiuterebbe l'intera richiesta con `PGRST200`. È
  // il difetto che ha impedito al dettaglio dei Documenti di aprirsi, e nessun
  // test poteva vederlo perché le prove sul database usano il service role. I
  // nomi si risolvono con `company_member_directory`.
  //
  // ⚠️ Nessun embed nemmeno verso le tabelle degli altri moduli: si interroga
  // la tabella d'origine filtrando sulla colonna di collegamento, così il nome
  // estratto arriva da chi lo possiede.
  // -------------------------------------------------------------------------
  async linkedTasks(companyId: string, organizationId: string): Promise<Array<{
    id: string; title: string; status: string; priority: string;
    dueDate: string | null; assigneeUserId: string | null; opportunityId: string | null;
  }>> {
    const { data, error } = await requireSupabase().from('tasks')
      .select('id, title, status, priority, due_date, assignee_user_id, crm_opportunity_id')
      .eq('company_id', companyId).eq('crm_organization_id', organizationId)
      .is('archived_at', null)
      .order('due_date', { ascending: true, nullsFirst: false });
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      title: r.title as string,
      status: r.status as string,
      priority: r.priority as string,
      dueDate: (r.due_date as string | null) ?? null,
      assigneeUserId: (r.assignee_user_id as string | null) ?? null,
      opportunityId: (r.crm_opportunity_id as string | null) ?? null,
    }));
  },

  async linkedDocuments(companyId: string, organizationId: string): Promise<CrmDocumentLink[]> {
    const sb = requireSupabase();
    const { data: links, error } = await sb.from('crm_organization_documents')
      .select('id, document_id, relation, match_reason, created_at')
      .eq('company_id', companyId).eq('organization_id', organizationId)
      .order('created_at', { ascending: false });
    if (error) fail(error);
    const rows = (links ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.document_id as string);
    // ⚠️ Anche qui l'ultima analisi valida: senza mittente e tipo un titolo non
    // mostrabile arriverebbe a schermo com'è (§6). Stessa forma dei contratti.
    const { data: docs, error: dErr } = await sb.from('documents')
      .select('id, title, original_filename, category, created_at, '
        + 'document_analyses(sender, document_type, confidence)')
      .neq('document_analyses.analysis_status', 'failed')
      .order('created_at', { referencedTable: 'document_analyses', ascending: false })
      .limit(1, { referencedTable: 'document_analyses' })
      .in('id', ids);
    if (dErr) fail(dErr);
    const byId = new Map(
      ((docs ?? []) as unknown as Array<Record<string, unknown>>).map((d) => [d.id as string, d]),
    );
    return rows.map((r) => {
      const d = byId.get(r.document_id as string);
      return {
        id: r.id as string,
        documentId: r.document_id as string,
        title: (d?.title as string | null) ?? null,
        label: etichettaDaRigaDocumento(d),
        category: (d?.category as DocumentCategory | null) ?? null,
        uploadedAt: (d?.created_at as string | null) ?? null,
        relation: r.relation as CrmDocumentRelation,
        matchReason: r.match_reason as CrmMatchReason,
        createdAt: r.created_at as string,
      };
    });
  },

  /** ⚠️ Solo METADATI: oggetto, mittente, data. Il corpo non passa da qui (§61). */
  async linkedEmails(companyId: string, organizationId: string): Promise<CrmEmailLink[]> {
    const sb = requireSupabase();
    const { data: links, error } = await sb.from('crm_organization_emails')
      .select('id, email_message_id, match_reason')
      .eq('company_id', companyId).eq('organization_id', organizationId);
    if (error) fail(error);
    const rows = (links ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.email_message_id as string);
    const { data: msgs, error: mErr } = await sb.from('email_messages')
      .select('id, subject, sender_name, sender_email, received_at, provider_thread_id')
      .in('id', ids).order('received_at', { ascending: false });
    if (mErr) fail(mErr);
    const byLink = new Map(rows.map((r) => [r.email_message_id as string, r]));
    return ((msgs ?? []) as Array<Record<string, unknown>>).map((m) => {
      const l = byLink.get(m.id as string)!;
      return {
        id: l.id as string,
        emailMessageId: m.id as string,
        subject: (m.subject as string | null) ?? null,
        senderName: (m.sender_name as string | null) ?? null,
        senderEmail: (m.sender_email as string | null) ?? null,
        receivedAt: (m.received_at as string | null) ?? null,
        threadKey: (m.provider_thread_id as string | null) ?? null,
        matchReason: l.match_reason as CrmMatchReason,
      };
    });
  },

  /** `counterpartyName` è il nome che i Contratti hanno letto: si mostra accanto. */
  async linkedContracts(companyId: string, organizationId: string): Promise<CrmContractLink[]> {
    const { data, error } = await requireSupabase().from('contracts')
      .select('id, display_name, contract_type, lifecycle_status, review_status, counterparty_name, owner_user_id')
      .eq('company_id', companyId).eq('counterparty_organization_id', organizationId)
      .is('archived_at', null).order('updated_at', { ascending: false });
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      displayName: r.display_name as string,
      contractType: r.contract_type as string,
      lifecycleStatus: r.lifecycle_status as string,
      reviewStatus: r.review_status as string,
      counterpartyName: (r.counterparty_name as string | null) ?? null,
      ownerUserId: (r.owner_user_id as string | null) ?? null,
    }));
  },

  /**
   * ⚠️ `eff_supplier_name` è il nome LETTO sulla fattura, e si mostra così com'è.
   * §77 — non esiste il corrispettivo «fatture cliente»: Finanze gestisce
   * fatture fornitore e spese, quindi il CRM non ha ricavi da mostrare.
   */
  async linkedFinance(companyId: string, organizationId: string): Promise<CrmFinanceLink[]> {
    const { data, error } = await requireSupabase().from('finance_items')
      .select('id, document_id, type, eff_supplier_name, eff_gross_amount, eff_currency, eff_due_date, review_status')
      .eq('company_id', companyId).eq('supplier_organization_id', organizationId)
      .is('archived_at', null).order('eff_due_date', { ascending: true, nullsFirst: false });
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      documentId: r.document_id as string,
      type: r.type as string,
      supplierName: (r.eff_supplier_name as string | null) ?? null,
      grossAmount: num(r.eff_gross_amount),
      currency: (r.eff_currency as string | null) ?? null,
      dueDate: (r.eff_due_date as string | null) ?? null,
      reviewStatus: r.review_status as string,
    }));
  },

  // -------------------------------------------------------------------------
  // «Questo elemento è già collegato?» — letto dal LATO del modulo d'origine
  //
  // ⚠️ QUATTRO INTERROGAZIONI PICCOLE E NON UNA COLONNA IN PIÙ NELLE FUNZIONI DI
  // LISTA. Aggiungere `counterparty_organization_id` al `returns table` di
  // `list_contracts` — o a `list_finance_items` — vorrebbe dire `drop function`
  // con la firma esatta a 15 e 20 argomenti, ricreare, rifare revoke e grant, e
  // aggiornare a mano quattro punti nei tipi e nei servizi. Per un dato che
  // serve SOLO nel dettaglio, quel rischio non si paga: qui c'è un select su
  // una riga, con la RLS che fa il suo lavoro.
  //
  // ⚠️ Ognuno restituisce anche il NOME, perché il riquadro deve poter scrivere
  // «collegato a Rossi SA» e non «collegato a a10b1325…».
  // -------------------------------------------------------------------------
  async emailOrganization(companyId: string, emailMessageId: string): Promise<{
    id: string; displayName: string;
  } | null> {
    const sb = requireSupabase();
    const { data, error } = await sb.from('crm_organization_emails')
      .select('organization_id').eq('company_id', companyId)
      .eq('email_message_id', emailMessageId).limit(1);
    if (error) fail(error);
    const rows = (data ?? []) as Array<{ organization_id: string }>;
    if (rows.length === 0) return null;
    return nameOfOrganization(sb, companyId, rows[0]!.organization_id);
  },

  async documentOrganization(companyId: string, documentId: string): Promise<{
    id: string; displayName: string;
  } | null> {
    const sb = requireSupabase();
    const { data, error } = await sb.from('crm_organization_documents')
      .select('organization_id').eq('company_id', companyId)
      .eq('document_id', documentId).limit(1);
    if (error) fail(error);
    const rows = (data ?? []) as Array<{ organization_id: string }>;
    if (rows.length === 0) return null;
    return nameOfOrganization(sb, companyId, rows[0]!.organization_id);
  },

  async contractOrganization(companyId: string, contractId: string): Promise<{
    id: string; displayName: string;
  } | null> {
    const sb = requireSupabase();
    const { data, error } = await sb.from('contracts')
      .select('counterparty_organization_id').eq('company_id', companyId)
      .eq('id', contractId).limit(1);
    if (error) fail(error);
    const rows = (data ?? []) as Array<{ counterparty_organization_id: string | null }>;
    const orgId = rows[0]?.counterparty_organization_id ?? null;
    return orgId ? nameOfOrganization(sb, companyId, orgId) : null;
  },

  async financeOrganization(companyId: string, financeItemId: string): Promise<{
    id: string; displayName: string;
  } | null> {
    const sb = requireSupabase();
    const { data, error } = await sb.from('finance_items')
      .select('supplier_organization_id').eq('company_id', companyId)
      .eq('id', financeItemId).limit(1);
    if (error) fail(error);
    const rows = (data ?? []) as Array<{ supplier_organization_id: string | null }>;
    const orgId = rows[0]?.supplier_organization_id ?? null;
    return orgId ? nameOfOrganization(sb, companyId, orgId) : null;
  },

  // -------------------------------------------------------------------------
  // Suggerimenti
  // -------------------------------------------------------------------------
  async suggestions(companyId: string, limit = 20): Promise<CrmLinkSuggestion[]> {
    const { data, error } = await requireSupabase().from('crm_link_suggestions')
      .select('id, source_entity_type, source_entity_id, suggested_organization_id, suggested_contact_id, suggested_name, suggested_email, reason, reason_detail, status, created_at')
      .eq('company_id', companyId).eq('status', 'pending')
      .order('created_at', { ascending: false }).limit(limit);
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      sourceEntityType: r.source_entity_type as CrmLinkSuggestion['sourceEntityType'],
      sourceEntityId: r.source_entity_id as string,
      suggestedOrganizationId: (r.suggested_organization_id as string | null) ?? null,
      suggestedContactId: (r.suggested_contact_id as string | null) ?? null,
      suggestedName: (r.suggested_name as string | null) ?? null,
      suggestedEmail: (r.suggested_email as string | null) ?? null,
      reason: r.reason as CrmMatchReason,
      reasonDetail: (r.reason_detail as string | null) ?? null,
      status: r.status as CrmLinkStatus,
      createdAt: r.created_at as string,
    }));
  },

  /**
   * §21 — `ignored` non è `rejected`: «non ora» e «no» sono risposte diverse, e
   * la seconda non va riproposta. Il timbro di chi ha risolto lo scrive il
   * database.
   */
  async resolveSuggestion(suggestionId: string, status: Exclude<CrmLinkStatus, 'pending'>): Promise<void> {
    const { error } = await requireSupabase().from('crm_link_suggestions')
      .update({ status }).eq('id', suggestionId);
    if (error) fail(error);
  },

  /**
   * Accettare un suggerimento: si collega l'origine e SOLO POI si segna la riga
   * come accettata.
   *
   * ⚠️ L'ORDINE NON È INDIFFERENTE, ed è la stessa disciplina della
   * cancellazione di un documento («prima la riga, poi il file»): Postgres non
   * offre qui una transazione fra due tabelle attraverso PostgREST, e delle due
   * metà quella che deve riuscire per prima è il COLLEGAMENTO. Se fallisce, il
   * suggerimento resta in sospeso e si può riprovare; nell'ordine opposto un
   * guasto lascerebbe un suggerimento «accettato» che non ha collegato niente —
   * cioè una schermata che dice il falso senza modo di accorgersene.
   *
   * ⚠️ Non crea nulla: l'organizzazione deve esistere già. Il caso «questa
   * controparte nel CRM non c'è» passa dalla creazione, che è un gesto a sé.
   */
  /**
   * Come `acceptSuggestion`, ma partendo dal solo identificativo: la riga si
   * RILEGGE dal database.
   *
   * ⚠️ Non si accetta l'origine dall'indirizzo del browser, e non è formalismo:
   * la RLS impedirebbe comunque di toccare i dati di un'altra azienda, ma un
   * `sourceEntityId` scritto a mano nell'URL farebbe collegare alla nuova
   * scheda un contratto QUALSIASI della propria azienda. Chi decide che cosa
   * viene collegato è la riga del suggerimento, non chi arriva alla pagina.
   */
  async acceptSuggestionById(
    companyId: string, suggestionId: string, organizationId: string,
  ): Promise<void> {
    const { data, error } = await requireSupabase().from('crm_link_suggestions')
      .select('id, source_entity_type, source_entity_id, status')
      .eq('company_id', companyId).eq('id', suggestionId).limit(1);
    if (error) fail(error);
    const row = ((data ?? []) as Array<Record<string, unknown>>)[0];
    if (!row) throw new Error('crm.errors.suggestionNotFound');
    // Già risolto da qualcun altro nel frattempo: non lo si «riapre» e non si
    // collega niente di nascosto.
    if (row.status !== 'pending') throw new Error('crm.errors.suggestionNotFound');
    await crmService.acceptSuggestion({
      id: row.id as string,
      sourceEntityType: row.source_entity_type as CrmLinkSuggestion['sourceEntityType'],
      sourceEntityId: row.source_entity_id as string,
    }, organizationId);
  },

  async acceptSuggestion(
    suggestion: Pick<CrmLinkSuggestion, 'id' | 'sourceEntityType' | 'sourceEntityId'>,
    organizationId: string,
  ): Promise<void> {
    if (suggestion.sourceEntityType === 'contract') {
      await crmService.linkContract(suggestion.sourceEntityId, organizationId);
    } else if (suggestion.sourceEntityType === 'finance_item') {
      await crmService.linkFinanceItem(suggestion.sourceEntityId, organizationId);
    } else {
      // Le altre entità hanno percorsi di collegamento propri (documento,
      // email, attività) e questa funzione non li conosce. Meglio un errore
      // esplicito che un «accettato» che non ha collegato niente.
      throw new Error('crm.errors.suggestionSourceUnsupported');
    }
    await crmService.resolveSuggestion(suggestion.id, 'accepted');
  },

  // -------------------------------------------------------------------------
  // Campi personalizzati (0047)
  //
  // Le DEFINIZIONI le scrivono titolare e amministratori (policy
  // `crm_field_defs_*`): cambiano la forma dei dati di tutta l'azienda. I
  // VALORI li scrive ogni membro: sono attributi della scheda, non la sua
  // identità. Qui non si controlla nulla di tutto questo — come per la
  // fusione, il cancello è il database e il servizio dichiara l'intenzione.
  // -------------------------------------------------------------------------

  /** Le definizioni di un'entità, nell'ordine di comparsa. Di default solo le
   *  ATTIVE: quelle archiviate servono alle impostazioni (ripristino), non
   *  alla scheda. */
  async fieldDefinitions(
    companyId: string, entity: CrmFieldEntity, includeArchived = false,
  ): Promise<CrmFieldDefinition[]> {
    let q = requireSupabase().from('crm_field_definitions')
      .select('id, company_id, entity, name, field_type, options, is_required, position, archived_at, created_at, updated_at')
      .eq('company_id', companyId).eq('entity', entity);
    if (!includeArchived) q = q.is('archived_at', null);
    const { data, error } = await q;
    if (error) fail(error);
    return sortFieldDefinitions(((data ?? []) as unknown as FieldDefRow[]).map(toFieldDefinition));
  },

  /** La posizione la decide il servizio (in fondo agli altri): non è un dato
   *  che il modulo debba conoscere. */
  async createFieldDefinition(companyId: string, input: {
    entity: CrmFieldEntity; name: string; fieldType: CrmFieldType;
    options?: string[]; isRequired?: boolean;
  }): Promise<string> {
    const sb = requireSupabase();
    const existing = await crmService.fieldDefinitions(companyId, input.entity);
    const row: FieldDefInsert = {
      company_id: companyId,
      entity: input.entity,
      name: input.name.trim(),
      field_type: input.fieldType,
      // Le opzioni esistono se e solo se il tipo è una lista: il vincolo della
      // 0047 lo pretende, e qui non arriva mai il caso contrario.
      options: input.fieldType === 'select' ? (input.options ?? []) : null,
      is_required: input.isRequired ?? false,
      position: nextFieldPosition(existing),
    };
    const { data, error } = await sb.from('crm_field_definitions').insert(row).select('id').single();
    if (error) fail(error);
    return (data as { id: string }).id;
  },

  /** Si cambiano nome, opzioni e obbligatorietà. Tipo ed entità non ci sono
   *  tra gli argomenti perché non si possono cambiare: un campo diverso è un
   *  campo nuovo, e i grant della 0047 non concedono quelle colonne. */
  async updateFieldDefinition(fieldId: string, patch: {
    name?: string; options?: string[]; isRequired?: boolean;
  }): Promise<void> {
    const row: FieldDefUpdate = {};
    if (patch.name !== undefined) row.name = patch.name.trim();
    if (patch.options !== undefined) row.options = patch.options;
    if (patch.isRequired !== undefined) row.is_required = patch.isRequired;
    const { error } = await requireSupabase().from('crm_field_definitions')
      .update(row).eq('id', fieldId);
    if (error) fail(error);
  },

  /** Archiviare NASCONDE, non cancella (§123): i valori restano scritti e
   *  tornano visibili al ripristino. Il timbro vero lo scrive il guardiano. */
  async archiveFieldDefinition(fieldId: string): Promise<void> {
    const { error } = await requireSupabase().from('crm_field_definitions')
      .update({ archived_at: new Date().toISOString() }).eq('id', fieldId);
    if (error) fail(error);
  },

  async restoreFieldDefinition(fieldId: string): Promise<void> {
    const { error } = await requireSupabase().from('crm_field_definitions')
      .update({ archived_at: null }).eq('id', fieldId);
    if (error) fail(error);
  },

  /** Su e giù fra i campi dell'entità. Le posizioni si RISCRIVONO come
   *  l'ordine visto (solo le righe che cambiano): i pareggi di `position` —
   *  due campi nati nello stesso secondo — si sciolgono una volta per tutte
   *  invece di rendere lo spostamento successivo un terno al lotto. */
  async moveFieldDefinition(
    companyId: string, entity: CrmFieldEntity, fieldId: string, direction: 'up' | 'down',
  ): Promise<void> {
    const defs = await crmService.fieldDefinitions(companyId, entity);
    const idx = defs.findIndex((d) => d.id === fieldId);
    const other = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || other < 0 || other >= defs.length) return;
    const order = [...defs];
    [order[idx], order[other]] = [order[other]!, order[idx]!];
    const sb = requireSupabase();
    for (let i = 0; i < order.length; i++) {
      if (order[i]!.position === i) continue;
      const { error } = await sb.from('crm_field_definitions')
        .update({ position: i }).eq('id', order[i]!.id);
      if (error) fail(error);
    }
  },

  /** Definizioni attive e valori INSIEME: la forma in cui la scheda li
   *  consuma. Un campo senza valore c'è lo stesso, con `value: null` — la sua
   *  casella esiste ed è vuota. */
  async fieldEntries(
    companyId: string, entity: CrmFieldEntity, entityId: string,
  ): Promise<CrmFieldEntry[]> {
    const defs = await crmService.fieldDefinitions(companyId, entity);
    if (defs.length === 0) return [];
    const column = entity === 'organization' ? 'organization_id' : 'opportunity_id';
    const { data, error } = await requireSupabase().from('crm_field_values')
      .select('id, field_id, organization_id, opportunity_id, value_text, value_number, value_date, updated_at')
      .eq('company_id', companyId).eq(column, entityId);
    if (error) fail(error);
    const byField = new Map(
      ((data ?? []) as unknown as FieldValueRow[]).map((r) => [r.field_id, toFieldValue(r, defs)]),
    );
    return defs.map((definition) => ({ definition, value: byField.get(definition.id) ?? null }));
  },

  /**
   * Salva i valori CAMBIATI. Per ciascuno: `null` cancella la riga (la riga
   * esiste solo se porta un valore), altrimenti si aggiorna se c'è e si
   * inserisce se manca — la scelta si fa rileggendo gli id, e l'indice unico
   * della 0047 para la corsa fra due salvataggi contemporanei.
   *
   * ⚠️ NON È UNA TRANSAZIONE: PostgREST non ne offre una fra righe. Se un
   * valore viene rifiutato (tipo sbagliato, opzione fuori lista) i precedenti
   * restano salvati e l'errore si dichiara: meglio metà lavoro fatto e detto
   * che un «tutto salvo» falso.
   */
  async saveFieldValues(
    companyId: string,
    entity: CrmFieldEntity,
    entityId: string,
    changes: Array<{ definition: CrmFieldDefinition; value: string | number | null }>,
  ): Promise<void> {
    if (changes.length === 0) return;
    const column = entity === 'organization' ? 'organization_id' : 'opportunity_id';
    const sb = requireSupabase();
    const { data, error } = await sb.from('crm_field_values')
      .select('id, field_id').eq('company_id', companyId).eq(column, entityId);
    if (error) fail(error);
    const existing = new Map(
      ((data ?? []) as Array<{ id: string; field_id: string }>).map((r) => [r.field_id, r.id]),
    );
    for (const { definition, value } of changes) {
      const currentId = existing.get(definition.id);
      if (value === null) {
        if (!currentId) continue;
        const { error: delError } = await sb.from('crm_field_values').delete().eq('id', currentId);
        if (delError) fail(delError);
        continue;
      }
      const cols = valueColumns(definition, value);
      if (currentId) {
        const { error: updError } = await sb.from('crm_field_values')
          .update(cols as FieldValueUpdate).eq('id', currentId);
        if (updError) fail(updError);
      } else {
        const row: FieldValueInsert = {
          company_id: companyId,
          field_id: definition.id,
          organization_id: entity === 'organization' ? entityId : null,
          opportunity_id: entity === 'opportunity' ? entityId : null,
          ...cols,
        };
        const { error: insError } = await sb.from('crm_field_values').insert(row);
        if (insError) fail(insError);
      }
    }
  },
};
