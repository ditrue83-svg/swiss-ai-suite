// ============================================================================
// crm-email-webhook — esiti di consegna Resend per le email inviate dal CRM.
//
// Endpoint pubblico perché lo chiama Resend, non il browser. Ogni richiesta è
// autenticata sui byte grezzi con gli header Svix; il service role entra in
// gioco soltanto dopo una firma valida. Non si registrano destinatari, oggetti
// o corpi nei log e il contenuto non entra mai in crm_events.
// ============================================================================
import { adminClient, env, failure, json } from '../_shared/calendar/runtime.ts';
import { parseDeliveryEvent, verifyResendWebhook } from '../_shared/crm-email/webhook.ts';

const MAX_BODY_BYTES = 64 * 1024;

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);
  const secret = env('RESEND_WEBHOOK_SECRET');
  if (!secret) return failure('EMAIL_WEBHOOK_NOT_CONFIGURED', 503);

  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return failure('PAYLOAD_TOO_LARGE', 413);
  }
  const rawBody = await req.text();
  if (rawBody.length > MAX_BODY_BYTES) return failure('PAYLOAD_TOO_LARGE', 413);

  const webhookId = req.headers.get('svix-id') ?? '';
  const webhookTimestamp = req.headers.get('svix-timestamp') ?? '';
  const webhookSignature = req.headers.get('svix-signature') ?? '';
  if (!(await verifyResendWebhook({ rawBody, webhookId, webhookTimestamp, webhookSignature, secret }))) {
    return failure('INVALID_SIGNATURE', 401);
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody); } catch { return failure('BAD_REQUEST', 400); }
  const event = parseDeliveryEvent(payload);
  // Aperture, click e reclami non fanno parte della Fase 1.1. Si risponde 200:
  // un evento valido ma fuori perimetro non deve essere ritentato all'infinito.
  if (!event) return json({ status: 'ignored' });

  const { data, error } = await (adminClient() as any).rpc('crm_apply_email_delivery_event', {
    p_event_id: webhookId,
    p_provider_email_id: event.providerEmailId,
    p_event_type: event.eventType,
    p_occurred_at: event.occurredAt,
    p_error_safe: event.errorSafe,
  });
  if (error) return failure('STORE_FAILED', 500);
  return json({ status: data === false ? 'duplicate' : 'accepted' });
});
