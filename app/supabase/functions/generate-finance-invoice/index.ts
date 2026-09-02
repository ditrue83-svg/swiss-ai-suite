// ============================================================================
// generate-finance-invoice — PDF di fattura emessa, nota di credito o
// sollecito, registrato nei Documenti.
//
// La lettura del payload passa dal JWT della persona e dalla RLS: le regole
// di tipo (fattura solo in bozza, nota di credito solo su annullata, sollecito
// solo su emessa/invitata/scaduta) le impone la RPC della 0053. Il service
// role serve soltanto per scrivere il file generato e il legame di
// provenienza; i guardiani della 0053 ricontrollano comunque azienda, fattura
// e documento.
//
// Sulla fattura la polizza QR non è un optional: il riferimento di pagamento
// (QRR o SCOR, lo decide il conto) e il payload SIX si costruiscono qui con
// `qrbill.ts`, il PNG con `qrcode`, la croce svizzera nel modulo PDF. Senza
// IBAN aziendale la fattura non si genera — e tanto meno si emette.
// ============================================================================
import {
  adminClient, assertMember, authenticate, CORS, failure, json, userClient,
} from '../_shared/calendar/runtime.ts';
import {
  createInvoicePdf, invoiceDocumentWord, type InvoiceDocKind, type InvoicePdfInput,
} from '../_shared/finance/invoice-pdf.ts';
import { buildSwissQrPayload, generatePaymentReference } from '../_shared/finance/qrbill.ts';
import * as QRCode from 'npm:qrcode@1.5.4';

type RequestBody = { companyId?: string; invoiceId?: string; kind?: string; level?: number };

const KINDS: InvoiceDocKind[] = ['invoice', 'credit_note', 'reminder'];
/** La parola «fattura» nella lingua del documento, per il messaggio del QR. */
const invoiceWord = { it: 'Fattura', de: 'Rechnung', fr: 'Facture' } as const;

function id(value: unknown): string | null {
  return typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value) ? value : null;
}

function filename(value: string): string {
  return value.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes.byteLength); copy.set(bytes);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', copy.buffer));
  return [...hash].map((part) => part.toString(16).padStart(2, '0')).join('');
}

/** Il PNG dello Swiss QR Code: contenuto SIX, senza margini (li dà la pagina). */
async function renderQrPng(payload: string): Promise<Uint8Array> {
  const dataUrl = await QRCode.toDataURL(payload, { errorCorrectionLevel: 'M', margin: 0, scale: 4 });
  const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);
  const auth = await authenticate(req);
  if (!auth) return failure('UNAUTHENTICATED', 401);
  const body = await req.json().catch(() => null) as RequestBody | null;
  const companyId = id(body?.companyId);
  const invoiceId = id(body?.invoiceId);
  const kind = (body?.kind ?? 'invoice') as InvoiceDocKind;
  const level = Number.isInteger(body?.level) ? Number(body?.level) : null;
  if (!companyId || !invoiceId || !KINDS.includes(kind)) return failure('BAD_REQUEST', 400);
  if (kind === 'reminder' && !(level !== null && level >= 1 && level <= 3)) {
    return failure('BAD_REQUEST', 400);
  }
  if (!(await assertMember(auth, companyId))) return failure('FORBIDDEN', 403);

  const sbUser = userClient(auth.authHeader) as any;
  const { data: payload, error: payloadError } = await sbUser.rpc('finance_issued_invoice_pdf_payload', {
    p_company_id: companyId, p_invoice_id: invoiceId,
    p_kind: kind, p_level: kind === 'reminder' ? level : null,
  });
  if (payloadError) return failure('INVOICE_LOOKUP_FAILED', 500);
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
    return failure('INVOICE_NOT_AVAILABLE', 422);
  }

  // Il motivo dell'annullo non sta nel payload (la RPC è `stable` e lo esclude):
  // per la nota di credito si legge dalla riga, sempre col JWT della persona.
  let creditReason: string | null = null;
  if (kind === 'credit_note') {
    const { data: invoiceRow, error: reasonError } = await sbUser
      .from('finance_issued_invoices').select('void_reason')
      .eq('id', invoiceId).eq('company_id', companyId).maybeSingle();
    if (reasonError) return failure('INVOICE_LOOKUP_FAILED', 500);
    creditReason = typeof invoiceRow?.void_reason === 'string' ? invoiceRow.void_reason : null;
  }

  const sb = adminClient() as any;
  let logo: Uint8Array | null = null;
  if (payload.company?.logoStoragePath && payload.company?.logoMimeType) {
    const { data: logoFile, error: logoError } = await sb.storage.from('company-documents')
      .download(payload.company.logoStoragePath);
    if (logoError || !logoFile) return failure('INVOICE_LOGO_LOOKUP_FAILED', 500);
    if (logoFile) logo = new Uint8Array(await logoFile.arrayBuffer());
  }

  // La polizza QR solo sulla fattura: conto e riferimento si decidono a
  // vicenda dentro qrbill.ts, che rilegge ciò che ha scritto prima di uscire.
  let qrPng: Uint8Array | null = null;
  let paymentReference: { referenceType: 'QRR' | 'SCOR'; reference: string } | null = null;
  if (kind === 'invoice') {
    const company = payload.company ?? {};
    const iban = typeof company.bankIban === 'string' ? company.bankIban.trim() : '';
    if (!iban) return failure('INVOICE_IBAN_MISSING', 422);
    if (payload.currency !== 'CHF' && payload.currency !== 'EUR') {
      return failure('INVOICE_QR_FAILED', 422);
    }
    try {
      paymentReference = generatePaymentReference(String(payload.invoiceNumber), iban);
      const customer = payload.customer ?? {};
      const debtor = customer.displayName && customer.postalCode && customer.city
        ? {
          name: String(customer.displayName), street: customer.street ?? undefined,
          postalCode: String(customer.postalCode), city: String(customer.city),
          countryCode: String(customer.countryCode ?? 'CH'),
        }
        : undefined;
      const qrPayload = buildSwissQrPayload({
        iban,
        creditor: {
          name: String(company.legalName ?? ''), street: company.street ?? undefined,
          postalCode: String(company.postalCode ?? ''), city: String(company.city ?? ''),
          countryCode: String(company.countryCode ?? 'CH'),
        },
        amount: String(payload.total),
        currency: payload.currency,
        debtor,
        referenceType: paymentReference.referenceType,
        reference: paymentReference.reference,
        message: `${invoiceWord[payload.language as keyof typeof invoiceWord] ?? 'Fattura'} ${payload.invoiceNumber}`,
      });
      qrPng = await renderQrPng(qrPayload);
    } catch {
      return failure('INVOICE_QR_FAILED', 422);
    }
  }

  const pdfInput: InvoicePdfInput = {
    invoiceNumber: String(payload.invoiceNumber),
    language: payload.language,
    currency: String(payload.currency),
    issuedOn: String(payload.issuedOn),
    dueDate: String(payload.dueDate),
    title: String(payload.title),
    notes: payload.notes ?? null,
    subtotal: String(payload.subtotal),
    vatTotal: String(payload.vatTotal),
    total: String(payload.total),
    company: payload.company,
    customer: payload.customer,
    items: payload.items,
    kind,
    level: kind === 'reminder' ? level : null,
    creditNoteNumber: payload.creditNoteNumber ?? null,
    creditReason,
    referenceType: paymentReference?.referenceType ?? payload.referenceType ?? null,
    reference: paymentReference?.reference ?? payload.reference ?? null,
  };

  let pdf: Uint8Array;
  try {
    pdf = await createInvoicePdf(pdfInput, logo, payload.company?.logoMimeType ?? null, qrPng);
  } catch {
    return failure('INVOICE_PDF_FAILED', 500);
  }

  // Rigenerare la fattura in bozza sovrascrive lo stesso Documento; nota di
  // credito e sollecito sono documenti nuovi a ogni generazione.
  const isExisting = kind === 'invoice' && Boolean(id(payload.documentId));
  const documentId = id(payload.documentId) ?? crypto.randomUUID();
  const cleanNumber = filename(String(payload.invoiceNumber)) || 'fattura';
  const originalFilename = kind === 'invoice' ? `${cleanNumber}.pdf`
    : kind === 'credit_note' ? `${cleanNumber}-NC.pdf`
    : `${cleanNumber}-S${level}.pdf`;
  const storagePath = `${companyId}/${documentId}/${originalFilename}`;
  const docWord = invoiceDocumentWord(pdfInput.language, kind, level);
  const titleNumber = kind === 'credit_note'
    ? String(payload.creditNoteNumber ?? payload.invoiceNumber)
    : String(payload.invoiceNumber);
  const title = `${docWord} ${titleNumber}`;
  const fileHash = await sha256(pdf);

  if (!isExisting) {
    const { error: insertError } = await sb.from('documents').insert({
      id: documentId, company_id: companyId, uploaded_by: auth.userId,
      title, original_filename: originalFilename, mime_type: 'application/pdf',
      file_size: pdf.byteLength, storage_path: storagePath, source_type: 'generated',
      status: 'uploaded', file_hash: fileHash,
    });
    if (insertError) return failure('INVOICE_DOCUMENT_STORE_FAILED', 500);
  }

  const { error: uploadError } = await sb.storage.from('company-documents').upload(
    storagePath, pdf, { contentType: 'application/pdf', upsert: true },
  );
  if (uploadError) {
    if (!isExisting) {
      const { error: cleanupError } = await sb.from('documents').delete().eq('id', documentId);
      if (cleanupError) return failure('INVOICE_DOCUMENT_STORE_FAILED', 500);
    }
    return failure('INVOICE_PDF_STORE_FAILED', 500);
  }

  if (isExisting) {
    const { error: updateError } = await sb.from('documents').update({
      title, original_filename: originalFilename, mime_type: 'application/pdf',
      file_size: pdf.byteLength, storage_path: storagePath, file_hash: fileHash,
      status: 'uploaded',
    }).eq('id', documentId).eq('company_id', companyId);
    if (updateError) return failure('INVOICE_DOCUMENT_STORE_FAILED', 500);
  }

  const { error: registerError } = await sb.rpc('finance_register_issued_invoice_pdf', {
    p_company_id: companyId, p_invoice_id: invoiceId,
    p_kind: kind, p_level: kind === 'reminder' ? level : null, p_document_id: documentId,
  });
  if (registerError) return failure('INVOICE_DOCUMENT_LINK_FAILED', 500);
  return json({ documentId, invoiceId, kind, filename: originalFilename, bytes: pdf.byteLength });
});
