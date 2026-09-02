import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { documentService } from '@/services/documentService';
import type { CrmQuoteLanguage, CrmQuoteStatus } from '@/types/database';

export interface CrmQuoteItem {
  id: string; lineNumber: number; description: string; quantity: number;
  unitPrice: number; vatRateId: string; vatRate: number;
  netAmount: number; vatAmount: number; totalAmount: number;
}

export interface CrmQuoteVersion {
  id: string; quoteId: string; quoteNumber: string; version: number;
  /** La controparte e la trattativa della versione: servono a chi la riusa
   *  come proposta — la fattura emessa dal preventivo accettato (0053). */
  organizationId: string; opportunityId: string;
  status: CrmQuoteStatus; language: CrmQuoteLanguage; issuedOn: string;
  validUntil: string; currency: string; title: string;
  introduction: string | null; notes: string | null;
  subtotalAmount: number; vatAmount: number; totalAmount: number;
  documentId: string | null; documentStoragePath: string | null;
  pdfGeneratedAt: string | null; sentAt: string | null;
  items: CrmQuoteItem[];
}

export interface CrmVatRate {
  id: string; kind: string; rate: number; sourceUrl: string;
  sourceTitle: string | null; checkedAt: string;
}

export interface CrmQuoteDraftInput {
  quoteId?: string | null; language: CrmQuoteLanguage; validUntil: string;
  currency: string; title: string; introduction?: string | null; notes?: string | null;
  items: Array<{ description: string; quantity: number; unitPrice: number; vatRateId: string }>;
}

function fail(error: unknown): never { throw new AppError(toUserMessage(error), error); }
const n = (value: unknown) => Number(value ?? 0);

export const crmQuoteService = {
  async list(companyId: string, opportunityId: string): Promise<CrmQuoteVersion[]> {
    const sb = requireSupabase();
    const { data: quotes, error: quoteError } = await sb.from('crm_quotes')
      .select('id, quote_number').eq('company_id', companyId)
      .eq('opportunity_id', opportunityId).order('created_at', { ascending: false });
    if (quoteError) fail(quoteError);
    const roots = (quotes ?? []) as Array<{ id: string; quote_number: string }>;
    if (!roots.length) return [];
    const rootById = new Map(roots.map((quote) => [quote.id, quote.quote_number]));
    const { data: versions, error: versionError } = await sb.from('crm_quote_versions')
      .select('id, quote_id, organization_id, opportunity_id, version, status, language, issued_on, valid_until, currency, title, introduction, notes, subtotal_amount, vat_amount, total_amount, document_id, pdf_generated_at, sent_at')
      .eq('company_id', companyId).in('quote_id', roots.map((quote) => quote.id))
      .order('version', { ascending: false });
    if (versionError) fail(versionError);
    const versionRows = (versions ?? []) as Array<Record<string, unknown>>;
    const versionIds = versionRows.map((row) => row.id as string);
    const [{ data: items, error: itemError }, { data: documents, error: documentError }] = await Promise.all([
      sb.from('crm_quote_items').select('id, quote_version_id, line_number, description, quantity, unit_price, vat_rate_id, vat_rate, net_amount, vat_amount, total_amount')
        .in('quote_version_id', versionIds).order('line_number'),
      sb.from('documents').select('id, storage_path').in('id', versionRows.map((row) => row.document_id as string).filter(Boolean)),
    ]);
    if (itemError) fail(itemError); if (documentError) fail(documentError);
    const itemByVersion = new Map<string, CrmQuoteItem[]>();
    for (const row of (items ?? []) as Array<Record<string, unknown>>) {
      const list = itemByVersion.get(row.quote_version_id as string) ?? [];
      list.push({ id: row.id as string, lineNumber: n(row.line_number), description: row.description as string,
        quantity: n(row.quantity), unitPrice: n(row.unit_price), vatRateId: row.vat_rate_id as string,
        vatRate: n(row.vat_rate), netAmount: n(row.net_amount), vatAmount: n(row.vat_amount), totalAmount: n(row.total_amount) });
      itemByVersion.set(row.quote_version_id as string, list);
    }
    const pathById = new Map(((documents ?? []) as Array<{ id: string; storage_path: string | null }>)
      .map((document) => [document.id, document.storage_path]));
    return versionRows.map((row) => ({
      id: row.id as string, quoteId: row.quote_id as string,
      quoteNumber: rootById.get(row.quote_id as string) ?? '', version: n(row.version),
      organizationId: row.organization_id as string, opportunityId: row.opportunity_id as string,
      status: row.status as CrmQuoteStatus, language: row.language as CrmQuoteLanguage,
      issuedOn: row.issued_on as string, validUntil: row.valid_until as string,
      currency: row.currency as string, title: row.title as string,
      introduction: (row.introduction as string | null) ?? null, notes: (row.notes as string | null) ?? null,
      subtotalAmount: n(row.subtotal_amount), vatAmount: n(row.vat_amount), totalAmount: n(row.total_amount),
      documentId: (row.document_id as string | null) ?? null,
      documentStoragePath: row.document_id ? pathById.get(row.document_id as string) ?? null : null,
      pdfGeneratedAt: (row.pdf_generated_at as string | null) ?? null,
      sentAt: (row.sent_at as string | null) ?? null,
      items: itemByVersion.get(row.id as string) ?? [],
    }));
  },

  async vatRates(): Promise<CrmVatRate[]> {
    const today = new Date().toISOString().slice(0, 10);
    const { data, error } = await requireSupabase().from('finance_vat_rates')
      .select('id, kind, rate, source_url, source_title, checked_at')
      .eq('country_code', 'CH').lte('valid_from', today)
      .or(`valid_to.is.null,valid_to.gte.${today}`).order('rate');
    if (error) fail(error);
    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: row.id as string, kind: row.kind as string, rate: n(row.rate),
      sourceUrl: row.source_url as string, sourceTitle: (row.source_title as string | null) ?? null,
      checkedAt: row.checked_at as string,
    }));
  },

  /** UNA versione, con le righe: serve a proporre la fattura dal preventivo
   *  accettato (0053). `null` se non esiste o non è dell'azienda attiva. */
  async getVersion(companyId: string, quoteVersionId: string): Promise<CrmQuoteVersion | null> {
    const sb = requireSupabase();
    const { data, error } = await sb.from('crm_quote_versions')
      .select('id, quote_id, organization_id, opportunity_id, version, status, language, issued_on, valid_until, currency, title, introduction, notes, subtotal_amount, vat_amount, total_amount, document_id, pdf_generated_at, sent_at, quote:crm_quotes(quote_number)')
      .eq('company_id', companyId).eq('id', quoteVersionId).maybeSingle();
    if (error) fail(error);
    if (!data) return null;
    const row = data as unknown as Record<string, unknown>;
    const { data: items, error: itemError } = await sb.from('crm_quote_items')
      .select('id, quote_version_id, line_number, description, quantity, unit_price, vat_rate_id, vat_rate, net_amount, vat_amount, total_amount')
      .eq('quote_version_id', quoteVersionId).order('line_number');
    if (itemError) fail(itemError);
    return {
      id: row.id as string, quoteId: row.quote_id as string,
      quoteNumber: (row.quote as { quote_number?: string } | null)?.quote_number ?? '',
      version: n(row.version),
      organizationId: row.organization_id as string, opportunityId: row.opportunity_id as string,
      status: row.status as CrmQuoteStatus, language: row.language as CrmQuoteLanguage,
      issuedOn: row.issued_on as string, validUntil: row.valid_until as string,
      currency: row.currency as string, title: row.title as string,
      introduction: (row.introduction as string | null) ?? null, notes: (row.notes as string | null) ?? null,
      subtotalAmount: n(row.subtotal_amount), vatAmount: n(row.vat_amount), totalAmount: n(row.total_amount),
      documentId: (row.document_id as string | null) ?? null, documentStoragePath: null,
      pdfGeneratedAt: (row.pdf_generated_at as string | null) ?? null,
      sentAt: (row.sent_at as string | null) ?? null,
      items: ((items ?? []) as Array<Record<string, unknown>>).map((item) => ({
        id: item.id as string, lineNumber: n(item.line_number), description: item.description as string,
        quantity: n(item.quantity), unitPrice: n(item.unit_price), vatRateId: item.vat_rate_id as string,
        vatRate: n(item.vat_rate), netAmount: n(item.net_amount), vatAmount: n(item.vat_amount), totalAmount: n(item.total_amount),
      })),
    };
  },

  async saveDraft(companyId: string, opportunityId: string, input: CrmQuoteDraftInput): Promise<string> {
    const { data, error } = await requireSupabase().rpc('crm_save_quote_draft', {
      p_company_id: companyId, p_opportunity_id: opportunityId, p_quote_id: input.quoteId ?? null,
      p_language: input.language, p_valid_until: input.validUntil,
      p_currency: input.currency, p_title: input.title,
      p_introduction: input.introduction ?? null, p_notes: input.notes ?? null,
      p_items: input.items as unknown as import('@/types/database').Json,
    });
    if (error || !data) fail(error);
    return data;
  },

  async generatePdf(companyId: string, quoteVersionId: string): Promise<string> {
    const { data, error } = await requireSupabase().functions.invoke<{ documentId?: string; code?: string }>(
      'generate-crm-quote', { body: { companyId, quoteVersionId } },
    );
    if (error || !data?.documentId) fail(error ?? data?.code);
    return data.documentId;
  },

  async newVersion(companyId: string, quoteId: string): Promise<string> {
    const { data, error } = await requireSupabase().rpc('crm_new_quote_version', {
      p_company_id: companyId, p_quote_id: quoteId,
    });
    if (error || !data) fail(error);
    return data;
  },

  async setStatus(companyId: string, quoteVersionId: string,
    status: 'accepted' | 'rejected' | 'expired'): Promise<void> {
    const { error } = await requireSupabase().rpc('crm_set_quote_status', {
      p_company_id: companyId, p_quote_version_id: quoteVersionId, p_status: status,
    });
    if (error) fail(error);
  },

  async openPdf(storagePath: string): Promise<void> {
    const url = await documentService.getSignedUrl(storagePath);
    window.open(url, '_blank', 'noopener,noreferrer');
  },
};
