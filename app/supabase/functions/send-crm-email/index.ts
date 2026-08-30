// ============================================================================
// send-crm-email — gesto umano dal CRM, mai dalla casella Gmail.
//
// L'Inbox conserva il suo contratto readonly: qui non si importano token OAuth
// e non si chiama Gmail. La chiave Resend resta nella Edge Function; il browser
// invia soltanto un riferimento a un recapito già registrato nel CRM.
// ============================================================================
import {
  adminClient, assertMember, authenticate, CORS, failure, json, resolveEmailProvider,
  userClient,
} from '../_shared/calendar/runtime.ts';

type RequestBody = {
  companyId?: string;
  organizationId?: string;
  contactId?: string;
  opportunityId?: string;
  recipientMethodId?: string;
  subject?: string;
  bodyText?: string;
  idempotencyKey?: string;
};

function text(value: unknown, maximum: number): string | null {
  return typeof value === 'string' && value.trim() && value.trim().length <= maximum
    ? value.trim() : null;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  const provider = resolveEmailProvider();
  // Non e' un 500: l'installazione non offre quel canale e la UI lo puo'
  // dichiarare senza fingersi pronta a spedire.
  if (!provider) return json({ available: false, code: 'EMAIL_NOT_CONFIGURED' }, 503);

  const auth = await authenticate(req);
  if (!auth) return failure('UNAUTHENTICATED', 401);
  const body = await req.json().catch(() => null) as RequestBody | null;
  const companyId = text(body?.companyId, 64);
  const recipientMethodId = text(body?.recipientMethodId, 64);
  const subject = text(body?.subject, 300);
  const bodyText = text(body?.bodyText, 20_000);
  const idempotencyKey = text(body?.idempotencyKey, 64);
  if (!companyId || !recipientMethodId || !subject || !bodyText || !idempotencyKey) return failure('BAD_REQUEST', 400);
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
  // Idempotenza PRIMA dell'invio: una doppia pressione o un timeout riusa la
  // stessa riga e la stessa chiave Resend, invece di creare una seconda email.
  const { data: existing, error: existingError } = await sb.from('email_messages')
    .select('id, delivery_status, delivery_error_safe, delivery_provider_id')
    .eq('company_id', companyId).eq('send_idempotency_key', idempotencyKey).maybeSingle();
  if (existingError) return failure('STORE_FAILED', 500);
  if (existing) return json({ available: true, emailId: existing.id, status: existing.delivery_status,
    reason: existing.delivery_error_safe, providerMessageId: existing.delivery_provider_id });

  const messageId = crypto.randomUUID();
  const now = new Date().toISOString();
  const recipients = [{ name: null, email: method.value }];
  const { error: insertError } = await sb.from('email_messages').insert({
    id: messageId, company_id: companyId, connection_id: null,
    provider_message_id: `crm:${idempotencyKey}`, subject,
    sender_name: null, sender_email: null, to_recipients: recipients, cc_recipients: [],
    received_at: now, sent_at: now, body_text: bodyText, body_preview: bodyText.slice(0, 500),
    body_clean: bodyText, body_char_count: bodyText.length, body_links: [],
    processing_status: 'done', attention_status: 'handled', direction: 'out', delivery_status: 'sent',
    send_idempotency_key: idempotencyKey, sent_by: auth.userId,
  });
  if (insertError) return failure('STORE_FAILED', 500);

  const links: Array<{ table: string; values: Record<string, unknown> }> = [
    { table: 'crm_outgoing_email_recipients', values: { company_id: companyId, email_message_id: messageId, contact_method_id: method.id, email_address: method.value } },
  ];
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
    const result = await provider.send({ to: method.value, subject, text: bodyText, idempotencyKey });
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
