// ============================================================================
// send-crm-email — gesto umano dal CRM, mai dalla casella Gmail.
//
// L'Inbox conserva il suo contratto readonly: qui non si importano token OAuth
// e non si chiama Gmail. La chiave Resend resta nella Edge Function; il browser
// invia soltanto un riferimento a un recapito già registrato nel CRM.
// ============================================================================
import {
  adminClient, assertMember, authenticate, CORS, env, failure, json,
  userClient,
} from '../_shared/calendar/runtime.ts';
import { createResendProvider } from '../_shared/calendar/email.ts';

type RequestBody = {
  companyId?: string;
  organizationId?: string;
  contactId?: string;
  opportunityId?: string;
  recipientMethodId?: string;
  subject?: string;
  bodyText?: string;
  idempotencyKey?: string;
  documentIds?: unknown;
};

const MAX_ATTACHMENTS = 5;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

function text(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.trim() && value.trim().length <= maximum
    ? value.trim() : null;
}

function ids(value: unknown): string[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ATTACHMENTS) return null;
  const out = value.map((id) => text(id, 64));
  return out.every(Boolean) && new Set(out).size === out.length ? out as string[] : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  const auth = await authenticate(req);
  if (!auth) return failure('UNAUTHENTICATED', 401);
  const body = await req.json().catch(() => null) as RequestBody | null;
  const companyId = text(body?.companyId, 64);
  const recipientMethodId = text(body?.recipientMethodId, 64);
  const subject = text(body?.subject, 300);
  const bodyText = text(body?.bodyText, 20_000);
  const idempotencyKey = text(body?.idempotencyKey, 64);
  const documentIds = ids(body?.documentIds);
  if (!companyId || !recipientMethodId || !subject || !bodyText || !idempotencyKey || !documentIds) return failure('BAD_REQUEST', 400);
  if (!(await assertMember(auth, companyId))) return failure('FORBIDDEN', 403);

  // La lettura passa dalla RLS dell'utente: anche il service role non deve
  // trasformare un id che il browser non puo' vedere in un destinatario.
  const sbUser = userClient(auth.authHeader) as any;
  const { data: method, error } = await sbUser.from('crm_contact_methods')
    .select('id, company_id, type, value, contact_id, organization_id')
    .eq('id', recipientMethodId).eq('company_id', companyId).eq('type', 'email').maybeSingle();
  if (error) return failure('RECIPIENT_LOOKUP_FAILED', 500);
  if (!method) return failure('RECIPIENT_NOT_REGISTERED', 422);

  const sb = adminClient() as any;
  const { data: sender, error: senderError } = await sb.from('crm_email_senders')
    .select('display_name, from_address').eq('company_id', companyId).maybeSingle();
  const apiKey = env('NOTIFICATION_EMAIL_API_KEY');
  const verifiedDomain = env('CRM_EMAIL_FROM_DOMAIN')?.toLowerCase();
  const senderAddress = typeof sender?.from_address === 'string' ? sender.from_address.trim().toLowerCase() : '';
  if (senderError) return failure('SENDER_LOOKUP_FAILED', 500);
  if (!apiKey || !verifiedDomain || !sender || !senderAddress.endsWith(`@${verifiedDomain}`)) {
    return json({ available: false, code: 'EMAIL_NOT_CONFIGURED' }, 503);
  }
  const provider = createResendProvider({ apiKey, from: `${sender.display_name} <${senderAddress}>` });
  // Idempotenza PRIMA dell'invio: una doppia pressione o un timeout riusa la
  // stessa riga e la stessa chiave Resend, invece di creare una seconda email.
  const { data: existing, error: existingError } = await sb.from('email_messages')
    .select('id, delivery_status, delivery_error_safe, delivery_provider_id')
    .eq('company_id', companyId).eq('send_idempotency_key', idempotencyKey).maybeSingle();
  if (existingError) return failure('STORE_FAILED', 500);
  if (existing) return json({ available: true, emailId: existing.id, status: existing.delivery_status,
    reason: existing.delivery_error_safe, providerMessageId: existing.delivery_provider_id });

  const { data: documents, error: documentsError } = documentIds.length
    ? await sb.from('documents').select('id, storage_path, original_filename, title, mime_type, file_size')
      .eq('company_id', companyId).in('id', documentIds)
    : { data: [], error: null };
  if (documentsError) return failure('ATTACHMENT_LOOKUP_FAILED', 500);
  const documentRows = (documents ?? []) as Array<{ id: string; storage_path: string | null; original_filename: string | null; title: string; mime_type: string | null; file_size: number | null }>;
  if (documentRows.length !== documentIds.length || documentRows.some((d) => !d.storage_path)
      || documentRows.reduce((total, d) => total + (d.file_size ?? 0), 0) > MAX_ATTACHMENT_BYTES) {
    return failure('ATTACHMENT_NOT_AVAILABLE', 422);
  }
  const attachments: Array<{ filename: string; content: string; contentType: string }> = [];
  for (const document of documentRows) {
    const { data: file, error: downloadError } = await sb.storage.from('company-documents').download(document.storage_path!);
    if (downloadError || !file) return failure('ATTACHMENT_NOT_AVAILABLE', 422);
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    attachments.push({ filename: document.original_filename || document.title, content: btoa(binary), contentType: document.mime_type || 'application/octet-stream' });
  }

  const messageId = crypto.randomUUID();
  const now = new Date().toISOString();
  const recipients = [{ name: null, email: method.value }];
  const { error: insertError } = await sb.from('email_messages').insert({
    id: messageId, company_id: companyId, connection_id: null,
    provider_message_id: `crm:${idempotencyKey}`, subject,
    sender_name: sender.display_name, sender_email: senderAddress, to_recipients: recipients, cc_recipients: [],
    received_at: now, sent_at: now, body_text: bodyText, body_preview: bodyText.slice(0, 500),
    body_clean: bodyText, body_char_count: bodyText.length, body_links: [],
    processing_status: 'done', attention_status: 'handled', direction: 'out', delivery_status: 'sent',
    send_idempotency_key: idempotencyKey, sent_by: auth.userId,
  });
  if (insertError) return failure('STORE_FAILED', 500);

  const links: Array<{ table: string; values: Record<string, unknown> }> = [
    { table: 'crm_outgoing_email_recipients', values: { company_id: companyId, email_message_id: messageId, contact_method_id: method.id, email_address: method.value } },
  ];
  for (const documentId of documentIds) links.push({ table: 'crm_outgoing_email_attachments', values: { company_id: companyId, email_message_id: messageId, document_id: documentId } });
  if (text(body?.organizationId, 64)) links.push({ table: 'crm_organization_emails', values: { company_id: companyId, organization_id: body!.organizationId, email_message_id: messageId, match_reason: 'manual', confirmed_by: auth.userId } });
  if (text(body?.contactId, 64)) links.push({ table: 'crm_contact_emails', values: { company_id: companyId, contact_id: body!.contactId, email_message_id: messageId, match_reason: 'manual', confirmed_by: auth.userId } });
  if (text(body?.opportunityId, 64)) links.push({ table: 'crm_opportunity_emails', values: { company_id: companyId, opportunity_id: body!.opportunityId, email_message_id: messageId } });
  for (const link of links) {
    const { error: linkError } = await sb.from(link.table).insert(link.values);
    if (linkError) {
      const { error: cleanupError } = await sb.from('email_messages').delete().eq('id', messageId);
      if (cleanupError) return failure('STORE_FAILED', 500);
      return failure('LINK_MISMATCH', 422);
    }
  }

  try {
    const result = await provider.send({ to: method.value, subject, text: bodyText, idempotencyKey, attachments });
    const { error: recordedError } = await sb.from('email_messages')
      .update({ delivery_status: 'sent', delivery_provider_id: result.providerMessageId }).eq('id', messageId);
    if (recordedError) return failure('STORE_FAILED', 500);
    return json({ available: true, emailId: messageId, status: 'sent', providerMessageId: result.providerMessageId });
  } catch (error) {
    // Il motivo e' volutamente umano: nessuna risposta/chiave/provider payload
    // entra nella timeline o nel browser come dettaglio tecnico.
    const reason = 'Il servizio di invio non ha accettato il messaggio.';
    const { error: recordedError } = await sb.from('email_messages')
      .update({ delivery_status: 'failed', delivery_error_safe: reason }).eq('id', messageId);
    if (recordedError) return failure('STORE_FAILED', 500);
    return json({ available: true, emailId: messageId, status: 'failed', reason }, 502);
  }
});
