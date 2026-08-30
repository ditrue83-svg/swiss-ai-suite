// ============================================================================
// Primitive pure del webhook Resend del CRM.
//
// Il provider firma il CORPO GREZZO con Svix. La verifica deve avvenire prima
// del JSON.parse: serializzare di nuovo lo stesso oggetto produrrebbe byte
// diversi e, peggio, trasformerebbe la firma in una verifica del parser.
// Questo modulo usa solo Web Crypto, così gli stessi casi girano offline in
// Node e nel runtime Deno senza SDK o traffico di rete.
// ============================================================================
import { fromBase64, timingSafeEqual } from '../email/crypto.ts';

const MAX_CLOCK_SKEW_SECONDS = 5 * 60;

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function secretBytes(secret: string): Uint8Array | null {
  const encoded = secret.trim().replace(/^whsec_/, '');
  if (!encoded) return null;
  try { return fromBase64(encoded); } catch { return null; }
}

/** Verifica firma e finestra anti-replay secondo il formato Svix usato da Resend. */
export async function verifyResendWebhook(input: {
  rawBody: string;
  webhookId: string;
  webhookTimestamp: string;
  webhookSignature: string;
  secret: string;
  nowMs?: number;
}): Promise<boolean> {
  const timestamp = Number(input.webhookTimestamp);
  const nowSeconds = Math.floor((input.nowMs ?? Date.now()) / 1000);
  if (!input.webhookId || !Number.isInteger(timestamp)
      || Math.abs(nowSeconds - timestamp) > MAX_CLOCK_SKEW_SECONDS) return false;

  const keyBytes = secretBytes(input.secret);
  if (!keyBytes) return false;
  const key = await crypto.subtle.importKey(
    'raw', keyBytes as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signed = `${input.webhookId}.${input.webhookTimestamp}.${input.rawBody}`;
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signed));
  const expected = toBase64(new Uint8Array(digest));

  return input.webhookSignature.split(/\s+/).some((candidate) => {
    const [version, signature] = candidate.split(',', 2);
    return version === 'v1' && Boolean(signature) && timingSafeEqual(signature, expected);
  });
}

export type DeliveryEvent = {
  eventType: 'email.sent' | 'email.delivered' | 'email.failed' | 'email.bounced';
  providerEmailId: string;
  occurredAt: string;
  errorSafe: string | null;
};

/** Traduce solo gli eventi che modificano i tre stati dichiarati dal prodotto. */
export function parseDeliveryEvent(payload: unknown): DeliveryEvent | null {
  if (!payload || typeof payload !== 'object') return null;
  const row = payload as { type?: unknown; created_at?: unknown; data?: { email_id?: unknown } };
  const supported = new Set(['email.sent', 'email.delivered', 'email.failed', 'email.bounced']);
  if (typeof row.type !== 'string' || !supported.has(row.type)) return null;
  if (typeof row.data?.email_id !== 'string' || !row.data.email_id.trim()) return null;
  if (typeof row.created_at !== 'string' || !Number.isFinite(Date.parse(row.created_at))) return null;

  const errorSafe = row.type === 'email.bounced'
    ? 'Il server del destinatario ha rifiutato il messaggio.'
    : row.type === 'email.failed'
      ? 'Il provider email non è riuscito a consegnare il messaggio.'
      : null;
  return {
    eventType: row.type as DeliveryEvent['eventType'],
    providerEmailId: row.data.email_id.trim(),
    occurredAt: new Date(row.created_at).toISOString(),
    errorSafe,
  };
}
