// ============================================================================
// financeIssuedService — le fatture EMESSE verso i clienti (0053).
//
// Gemello voluto di `crmQuoteService`: stessa forma (lista con mappatura
// camelCase, bozza via RPC, PDF via Edge Function, apertura con URL firmato),
// perché due servizi che fanno la stessa cosa in due modi diversi sono un
// difetto che aspetta il primo ritocco.
//
// Le DIFFERENZE rispetto ai preventivi non sono gusti, sono la 0053:
//   · niente versioni: dopo l'emissione la fattura è IMMUTABILE, le correzioni
//     passano per annullo (`voided`) + nota di credito;
//   · le scritture sono SOLO le tre RPC (`save`/`issue`/`setStatus`): le tabelle
//     si leggono con la SELECT del membro e basta;
//   · «inviata» NON si imposta da qui: lo scrive `send-crm-email` dopo che il
//     provider ha accettato il messaggio, e «scaduta» la scrive la scansione.
//
// ⚠️⚠️ IL MODULO NON MUOVE DENARO. Qui non si prepara un pagamento, non si
// compone un file bancario, non si trasforma un IBAN in un'azione: «pagata» è
// una dichiarazione di una persona, registrata con la sua data effettiva.
// ============================================================================
import { requireSupabase } from '@/lib/supabase';
import { AppError, toUserMessage } from '@/lib/errors';
import { translate as tr } from '@/i18n';
import { documentService } from '@/services/documentService';
import { crmQuoteService, type CrmVatRate } from '@/services/crmQuoteService';
import type { Json } from '@/types/database';
import type {
  FinanceIssuedInvoiceDocKind, FinanceIssuedInvoiceLanguage,
  IssuedInvoice, IssuedInvoiceDocument, IssuedInvoiceItem,
} from '@/types/models';

/** Ciò che serve a creare o riscrivere una BOZZA. Le righe seguono la forma
 *  dei preventivi: `lineNumber` lo assegna il database, in ordine di arrivo. */
export interface IssuedInvoiceDraftInput {
  invoiceId?: string | null;
  organizationId: string;
  opportunityId?: string | null;
  quoteVersionId?: string | null;
  language: FinanceIssuedInvoiceLanguage;
  currency: string;
  title: string;
  notes?: string | null;
  issuedOn: string;
  dueDate: string;
  items: Array<{ description: string; quantity: number; unitPrice: number; vatRateId: string }>;
}

/** Il dettaglio: testata, righe e i PDF collegati (fattura, nota di credito, solleciti). */
export interface IssuedInvoiceDetail {
  invoice: IssuedInvoice;
  items: IssuedInvoiceItem[];
  documents: IssuedInvoiceDocument[];
}

const n = (value: unknown) => Number(value ?? 0);
const s = (value: unknown) => (value as string | null) ?? null;

// ---------------------------------------------------------------------------
// Gli errori: il database e la funzione rispondono con CODICI, la frase la
// scrive l'interfaccia nella lingua di chi legge (§108). Un codice che qui non
// è previsto NON viene indovinato: passa da `toUserMessage` come ovunque.
// ---------------------------------------------------------------------------

/** Errori delle RPC e dei guardiani della 0053, riconosciuti dal messaggio. */
function rpcFail(error: unknown): never {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  if (raw.includes('finance_issued_invoice_iban_required')) {
    throw new AppError(tr('finance.issued.errors.ibanMissing'), error, 'INVOICE_IBAN_MISSING');
  }
  if (raw.includes('finance_issued_invoice_pdf_required')) {
    throw new AppError(tr('finance.issued.errors.pdfRequired'), error, 'INVOICE_PDF_REQUIRED');
  }
  if (raw.includes('finance_issued_invoice_immutable')
    || raw.includes('finance_issued_invoice_cannot_issue')
    || raw.includes('finance_issued_invoice_status_transition_invalid')
    || raw.includes('finance_issued_invoice_not_found')) {
    throw new AppError(tr('finance.issued.errors.transition'), error);
  }
  throw new AppError(toUserMessage(error), error);
}

/** Errori della Edge Function: il codice sta nel corpo della risposta, che
 *  su un 4xx/5xx NON arriva in `data` — va letto dal `context` dell'errore. */
async function edgeFail(error: unknown, data: { code?: string } | null): Promise<never> {
  let code = data?.code ?? null;
  const context = (error as { context?: Response } | null)?.context;
  if (!code && context && typeof context.json === 'function') {
    code = await context.json().then((body: { code?: string }) => body?.code ?? null).catch(() => null);
  }
  switch (code) {
    case 'INVOICE_IBAN_MISSING':
      throw new AppError(tr('finance.issued.errors.ibanMissing'), error, code);
    case 'INVOICE_NOT_AVAILABLE':
      throw new AppError(tr('finance.issued.errors.notAvailable'), error, code);
    case 'INVOICE_QR_FAILED':
      throw new AppError(tr('finance.issued.errors.qrFailed'), error, code);
    default:
      throw new AppError(toUserMessage(error), error);
  }
}

// ---------------------------------------------------------------------------
// Le mappature riga → modello. I totali arrivano dal database (SQL decimale),
// mai ricalcolati qui.
// ---------------------------------------------------------------------------

function toInvoice(row: Record<string, unknown>): IssuedInvoice {
  const org = row.organization as { display_name?: string } | null;
  return {
    id: row.id as string,
    organizationId: row.organization_id as string,
    // Il join dà il nome attuale della scheda; se non c'è, lo snapshot che la
    // fattura porta scritto su di sé — che è ciò che il PDF dice davvero.
    customerName: org?.display_name ?? (row.customer_display_name as string),
    opportunityId: s(row.opportunity_id),
    quoteVersionId: s(row.quote_version_id),
    invoiceNumber: row.invoice_number as string,
    creditNoteNumber: s(row.credit_note_number),
    status: row.status as IssuedInvoice['status'],
    language: row.language as IssuedInvoice['language'],
    currency: row.currency as string,
    title: row.title as string,
    notes: s(row.notes),
    issuedOn: row.issued_on as string,
    dueDate: row.due_date as string,
    subtotalAmount: n(row.subtotal_amount),
    vatAmount: n(row.vat_amount),
    totalAmount: n(row.total_amount),
    companyBankIban: s(row.company_bank_iban),
    paymentReferenceType: s(row.payment_reference_type),
    paymentReference: s(row.payment_reference),
    documentId: s(row.document_id),
    pdfGeneratedAt: s(row.pdf_generated_at),
    issuedAt: s(row.issued_at),
    sentAt: s(row.sent_at),
    paidAt: s(row.paid_at),
    paidOn: s(row.paid_on),
    overdueAt: s(row.overdue_at),
    voidedAt: s(row.voided_at),
    voidReason: s(row.void_reason),
    createdAt: row.created_at as string,
  };
}

const INVOICE_COLUMNS = [
  'id', 'organization_id', 'opportunity_id', 'quote_version_id',
  'invoice_number', 'credit_note_number', 'status', 'language', 'currency',
  'title', 'notes', 'issued_on', 'due_date',
  'subtotal_amount', 'vat_amount', 'total_amount',
  'customer_display_name', 'company_bank_iban',
  'payment_reference_type', 'payment_reference',
  'document_id', 'pdf_generated_at',
  'issued_at', 'sent_at', 'paid_at', 'paid_on', 'overdue_at',
  'voided_at', 'void_reason', 'created_at',
].join(', ');

export const financeIssuedService = {
  /** Le fatture dell'azienda, dalla più recente, col nome attuale del cliente. */
  async list(companyId: string): Promise<IssuedInvoice[]> {
    const { data, error } = await requireSupabase()
      .from('finance_issued_invoices')
      .select(`${INVOICE_COLUMNS}, organization:crm_organizations(display_name)`)
      .eq('company_id', companyId)
      .order('created_at', { ascending: false });
    if (error) rpcFail(error);
    return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(toInvoice);
  },

  /** Testata + righe + i PDF collegati. `null` se non esiste o non è dell'azienda. */
  async get(companyId: string, invoiceId: string): Promise<IssuedInvoiceDetail | null> {
    const sb = requireSupabase();
    const { data, error } = await sb
      .from('finance_issued_invoices')
      .select(`${INVOICE_COLUMNS}, organization:crm_organizations(display_name)`)
      .eq('company_id', companyId)
      .eq('id', invoiceId)
      .maybeSingle();
    if (error) rpcFail(error);
    if (!data) return null;
    const row = data as unknown as Record<string, unknown>;

    const [{ data: items, error: itemsError }, { data: docs, error: docsError }] = await Promise.all([
      sb.from('finance_issued_invoice_items')
        .select('id, line_number, description, quantity, unit_price, vat_rate_id, vat_rate, net_amount, vat_amount, total_amount')
        .eq('invoice_id', invoiceId).order('line_number'),
      sb.from('finance_issued_invoice_documents')
        .select('id, kind, level, document_id, created_at, document:documents(storage_path)')
        .eq('invoice_id', invoiceId).order('created_at'),
    ]);
    if (itemsError) rpcFail(itemsError);
    if (docsError) rpcFail(docsError);

    return {
      invoice: toInvoice(row),
      items: ((items ?? []) as Array<Record<string, unknown>>).map((item) => ({
        id: item.id as string,
        lineNumber: n(item.line_number),
        description: item.description as string,
        quantity: n(item.quantity),
        unitPrice: n(item.unit_price),
        vatRateId: item.vat_rate_id as string,
        vatRate: n(item.vat_rate),
        netAmount: n(item.net_amount),
        vatAmount: n(item.vat_amount),
        totalAmount: n(item.total_amount),
      })),
      documents: ((docs ?? []) as unknown as Array<Record<string, unknown>>).map((doc) => ({
        id: doc.id as string,
        kind: doc.kind as FinanceIssuedInvoiceDocKind,
        level: doc.level === null || doc.level === undefined ? null : n(doc.level),
        documentId: doc.document_id as string,
        storagePath: s((doc.document as { storage_path?: string | null } | null)?.storage_path),
        createdAt: doc.created_at as string,
      })),
    };
  },

  /** Le aliquote sono quelle dei preventivi: la stessa tabella, lo stesso servizio. */
  vatRates(): Promise<CrmVatRate[]> {
    return crmQuoteService.vatRates();
  },

  /** Crea la bozza (`invoiceId` assente) o la riscrive: la 0053 invalida il PDF. */
  async saveDraft(companyId: string, input: IssuedInvoiceDraftInput): Promise<string> {
    const { data, error } = await requireSupabase().rpc('finance_save_issued_invoice_draft', {
      p_company_id: companyId,
      p_invoice_id: input.invoiceId ?? null,
      p_organization_id: input.organizationId,
      p_opportunity_id: input.opportunityId ?? null,
      p_quote_version_id: input.quoteVersionId ?? null,
      p_language: input.language,
      p_currency: input.currency,
      p_title: input.title,
      p_notes: input.notes ?? null,
      p_issued_on: input.issuedOn,
      p_due_date: input.dueDate,
      p_items: input.items as unknown as Json,
    });
    if (error) rpcFail(error);
    if (!data) throw new AppError(tr('finance.issued.errors.generic'));
    return data;
  },

  /** Bozza → emessa. Il guardiano pretende PDF generato, IBAN e CHF/EUR. */
  async issue(companyId: string, invoiceId: string): Promise<void> {
    const { error } = await requireSupabase().rpc('finance_issue_invoice', {
      p_company_id: companyId, p_invoice_id: invoiceId,
    });
    if (error) rpcFail(error);
  },

  /** Il PDF — fattura, nota di credito o sollecito — via Edge Function. */
  async generatePdf(
    companyId: string, invoiceId: string,
    kind: FinanceIssuedInvoiceDocKind = 'invoice', level?: number,
  ): Promise<string> {
    const { data, error } = await requireSupabase().functions.invoke<{
      documentId?: string; code?: string;
    }>('generate-finance-invoice', {
      body: { companyId, invoiceId, kind, level: kind === 'reminder' ? level ?? null : null },
    });
    if (error || !data?.documentId) await edgeFail(error, data);
    // edgeFail lancia sempre: chi arriva qui ha un documento. Il controllo
    // resta perché TypeScript non si fida di una `Promise<never>` attesa.
    if (!data?.documentId) throw new AppError(tr('finance.issued.errors.generic'));
    return data.documentId;
  },

  /** «Pagata» la dichiara una persona, con la data effettiva del versamento. */
  async setPaid(companyId: string, invoiceId: string, paidOn: string): Promise<void> {
    const { error } = await requireSupabase().rpc('finance_set_issued_invoice_status', {
      p_company_id: companyId, p_invoice_id: invoiceId, p_status: 'paid', p_paid_on: paidOn,
    });
    if (error) rpcFail(error);
  },

  /** Lo storno assegna il numero di nota di credito e non si può annullare. */
  async void(companyId: string, invoiceId: string, reason: string): Promise<void> {
    const { error } = await requireSupabase().rpc('finance_set_issued_invoice_status', {
      p_company_id: companyId, p_invoice_id: invoiceId,
      p_status: 'voided', p_void_reason: reason,
    });
    if (error) rpcFail(error);
  },

  /** Apre un PDF collegato: percorso dallo Storage, URL firmato, nuova scheda. */
  async openPdf(documentId: string): Promise<void> {
    const { data, error } = await requireSupabase()
      .from('documents').select('storage_path').eq('id', documentId).maybeSingle();
    if (error) rpcFail(error);
    const storagePath = (data as { storage_path: string | null } | null)?.storage_path;
    if (!storagePath) throw new AppError(tr('finance.issued.errors.generic'));
    const url = await documentService.getSignedUrl(storagePath);
    window.open(url, '_blank', 'noopener,noreferrer');
  },
};
