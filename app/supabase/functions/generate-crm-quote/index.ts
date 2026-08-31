// ============================================================================
// generate-crm-quote — genera il PDF della bozza e lo registra nei Documenti.
//
// La lettura del payload passa dal JWT della persona e dalla RLS. Il service
// role serve soltanto per scrivere il file generato e il legame di provenienza;
// i guardiani della 0049 ricontrollano comunque azienda, trattativa e documento.
// ============================================================================
import {
  adminClient, assertMember, authenticate, CORS, failure, json, userClient,
} from '../_shared/calendar/runtime.ts';
import { createQuotePdf, type QuotePdfInput } from '../_shared/crm-quotes/pdf.ts';

type RequestBody = { companyId?: string; quoteVersionId?: string };

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

const documentWord = { it: 'Preventivo', de: 'Offerte', fr: 'Devis' } as const;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);
  const auth = await authenticate(req);
  if (!auth) return failure('UNAUTHENTICATED', 401);
  const body = await req.json().catch(() => null) as RequestBody | null;
  const companyId = id(body?.companyId);
  const quoteVersionId = id(body?.quoteVersionId);
  if (!companyId || !quoteVersionId) return failure('BAD_REQUEST', 400);
  if (!(await assertMember(auth, companyId))) return failure('FORBIDDEN', 403);

  const sbUser = userClient(auth.authHeader) as any;
  const { data: payload, error: payloadError } = await sbUser.rpc('crm_quote_pdf_payload', {
    p_company_id: companyId, p_quote_version_id: quoteVersionId,
  });
  if (payloadError) return failure('QUOTE_LOOKUP_FAILED', 500);
  if (!payload || !Array.isArray(payload.items) || payload.items.length === 0) {
    return failure('QUOTE_NOT_DRAFT', 422);
  }

  const sb = adminClient() as any;
  let logo: Uint8Array | null = null;
  if (payload.company?.logoStoragePath && payload.company?.logoMimeType) {
    const { data: logoFile, error: logoError } = await sb.storage.from('company-documents')
      .download(payload.company.logoStoragePath);
    if (logoError || !logoFile) return failure('QUOTE_LOGO_LOOKUP_FAILED', 500);
    if (logoFile) logo = new Uint8Array(await logoFile.arrayBuffer());
  }

  let pdf: Uint8Array;
  try {
    pdf = await createQuotePdf(payload as QuotePdfInput, logo, payload.company?.logoMimeType ?? null);
  } catch {
    return failure('QUOTE_PDF_FAILED', 500);
  }

  const isExisting = Boolean(payload.documentId);
  const documentId = id(payload.documentId) ?? crypto.randomUUID();
  const cleanNumber = filename(payload.quoteNumber) || 'preventivo';
  const originalFilename = `${cleanNumber}-v${payload.version}.pdf`;
  const storagePath = `${companyId}/${documentId}/${originalFilename}`;
  const title = `${documentWord[payload.language as keyof typeof documentWord]} ${payload.quoteNumber} · v${payload.version}`;
  const fileHash = await sha256(pdf);

  if (!isExisting) {
    const { error: insertError } = await sb.from('documents').insert({
      id: documentId, company_id: companyId, uploaded_by: auth.userId,
      title, original_filename: originalFilename, mime_type: 'application/pdf',
      file_size: pdf.byteLength, storage_path: storagePath, source_type: 'generated',
      status: 'uploaded', file_hash: fileHash,
    });
    if (insertError) return failure('QUOTE_DOCUMENT_STORE_FAILED', 500);
  }

  const { error: uploadError } = await sb.storage.from('company-documents').upload(
    storagePath, pdf, { contentType: 'application/pdf', upsert: true },
  );
  if (uploadError) {
    if (!isExisting) {
      const { error: cleanupError } = await sb.from('documents').delete().eq('id', documentId);
      if (cleanupError) return failure('QUOTE_DOCUMENT_STORE_FAILED', 500);
    }
    return failure('QUOTE_PDF_STORE_FAILED', 500);
  }

  if (isExisting) {
    const { error: updateError } = await sb.from('documents').update({
      title, original_filename: originalFilename, mime_type: 'application/pdf',
      file_size: pdf.byteLength, storage_path: storagePath, file_hash: fileHash,
      status: 'uploaded',
    }).eq('id', documentId).eq('company_id', companyId);
    if (updateError) return failure('QUOTE_DOCUMENT_STORE_FAILED', 500);
  }

  const { error: registerError } = await sb.rpc('crm_register_quote_pdf', {
    p_company_id: companyId, p_quote_version_id: quoteVersionId, p_document_id: documentId,
  });
  if (registerError) return failure('QUOTE_DOCUMENT_LINK_FAILED', 500);
  return json({ documentId, quoteVersionId, filename: originalFilename, bytes: pdf.byteLength });
});
