import { createResendProvider } from '../supabase/functions/_shared/calendar/email.ts';
import { parseDeliveryEvent, verifyResendWebhook } from '../supabase/functions/_shared/crm-email/webhook.ts';

let passed = 0;
let failed = 0;
function ok(condition: boolean, label: string) {
  if (condition) { passed++; console.log(`  ✓ ${label}`); }
  else { failed++; console.error(`  ✗ ${label}`); }
}

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function signature(secretBytes: Uint8Array, id: string, timestamp: string, body: string) {
  const key = await crypto.subtle.importKey(
    'raw', secretBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signed = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
  return `v1,${base64(new Uint8Array(signed))}`;
}

console.log('CRM email — webhook e provider simulato\n');
const secretBytes = crypto.getRandomValues(new Uint8Array(32));
const secret = `whsec_${base64(secretBytes)}`;
const nowMs = Date.parse('2026-08-30T12:00:00.000Z');
const timestamp = String(Math.floor(nowMs / 1000));
const id = 'msg_webhook_01';
const body = JSON.stringify({
  type: 'email.delivered', created_at: '2026-08-30T11:59:58.000Z', data: { email_id: 'resend_01' },
});
const validSignature = await signature(secretBytes, id, timestamp, body);

ok(await verifyResendWebhook({ rawBody: body, webhookId: id, webhookTimestamp: timestamp,
  webhookSignature: validSignature, secret, nowMs }), 'accetta una firma Svix valida sul corpo grezzo');
ok(!(await verifyResendWebhook({ rawBody: `${body} `, webhookId: id, webhookTimestamp: timestamp,
  webhookSignature: validSignature, secret, nowMs })), 'rifiuta il corpo alterato anche se il JSON sarebbe equivalente');
ok(!(await verifyResendWebhook({ rawBody: body, webhookId: id, webhookTimestamp: String(Number(timestamp) - 301),
  webhookSignature: validSignature, secret, nowMs })), 'rifiuta una firma oltre la finestra anti-replay');
ok(!(await verifyResendWebhook({ rawBody: body, webhookId: id, webhookTimestamp: timestamp,
  webhookSignature: 'v1,non-valida', secret, nowMs })), 'rifiuta una firma errata');

const delivered = parseDeliveryEvent(JSON.parse(body));
ok(delivered?.eventType === 'email.delivered' && delivered.errorSafe === null,
  'traduce la consegna senza inventare una ragione di errore');
ok(parseDeliveryEvent({ type: 'email.bounced', created_at: '2026-08-30T12:00:00Z',
  data: { email_id: 'resend_02' } })?.errorSafe?.includes('rifiutato') === true,
  'traduce il bounce in una ragione umana e priva di dettaglio del provider');
ok(parseDeliveryEvent({ type: 'email.failed', created_at: '2026-08-30T12:00:00Z',
  data: { email_id: 'resend_03' } })?.eventType === 'email.failed', 'riconosce il fallimento definitivo');
ok(parseDeliveryEvent({ type: 'email.opened', created_at: '2026-08-30T12:00:00Z',
  data: { email_id: 'resend_04' } }) === null, 'ignora aperture e tracciamenti fuori perimetro');
ok(parseDeliveryEvent({ type: 'email.delivered', created_at: 'non-data', data: { email_id: 'x' } }) === null,
  'rifiuta eventi privi di un istante valido');

let request: Request | null = null;
const provider = createResendProvider({
  apiKey: 're_test', from: 'AI-Swisse <crm@example.ch>',
  fetchImpl: async (input, init) => {
    request = new Request(input, init);
    return new Response(JSON.stringify({ id: 'resend_fake_01' }), {
      status: 200, headers: { 'content-type': 'application/json' },
    });
  },
});
const result = await provider.send({
  to: 'cliente@example.ch', subject: 'Proposta', text: 'Buongiorno',
  idempotencyKey: 'crm-send-01',
  attachments: [{ filename: 'offerta.pdf', content: 'ZmFrZQ==', contentType: 'application/pdf' }],
});
const sentBody = JSON.parse(await request!.clone().text()) as Record<string, unknown>;
ok(result.providerMessageId === 'resend_fake_01', 'legge l’identificativo dalla fetch finta');
ok(request!.headers.get('Idempotency-Key') === 'crm-send-01', 'inoltra la chiave di idempotenza al provider');
ok(Array.isArray(sentBody.attachments) && sentBody.to instanceof Array,
  'inoltra destinatario e allegati senza effettuare un invio vero');

console.log(`\n${passed} superati · ${failed} falliti`);
process.exit(failed ? 1 : 0);
