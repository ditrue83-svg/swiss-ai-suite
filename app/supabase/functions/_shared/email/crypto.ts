// ============================================================================
// Cifratura dei token e primitive di sicurezza del flusso OAuth.
//
// «Non inventare crittografia» (§18/§121): qui non c'è nessun algoritmo scritto
// a mano. Si usa la Web Crypto API — presente sia in Deno sia in Node 20, quindi
// nessuna dipendenza nuova — con AES-256-GCM, che è cifratura AUTENTICATA: un
// ciphertext modificato non si decifra, fallisce. Un token manomesso in un dump
// non diventa un token diverso: diventa un errore.
//
// IV di 12 byte casuali per ogni operazione, mai riusato: con GCM il riuso
// dell'IV sulla stessa chiave è l'errore che rompe tutto, ed è per questo che
// `encrypt` genera l'IV internamente e non lo accetta come parametro.
//
// La chiave vive come secret della Edge Function (EMAIL_TOKEN_KEY), non nel
// database: un dump del database non basta a leggere i token.
// ============================================================================

const IV_BYTES = 12;                       // raccomandato per AES-GCM
const KEY_BYTES = 32;                      // AES-256

export interface Sealed {
  ciphertext: Uint8Array;
  iv: Uint8Array;
}

function subtle(): SubtleCrypto {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    throw new Error('Web Crypto non disponibile in questo runtime');
  }
  return c.subtle;
}

/** Byte casuali crittograficamente sicuri. */
export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  globalThis.crypto.getRandomValues(out);
  return out;
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64(input: string): Uint8Array {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

/** Token opaco per state OAuth e clientState dei webhook. */
export function randomToken(bytes = 32): string {
  return toBase64Url(randomBytes(bytes));
}

export async function sha256Hex(input: string | Uint8Array): Promise<string> {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await subtle().digest('SHA-256', data as BufferSource);
  return toHex(new Uint8Array(digest));
}

/**
 * Importa la chiave dal secret. Si accetta base64 di 32 byte esatti e NIENTE
 * altro: una chiave «quasi giusta» — troppo corta, o una passphrase usata come
 * fosse una chiave — è un guasto di configurazione, e va detto subito invece di
 * cifrare tutto con una chiave debole senza che nessuno se ne accorga.
 */
export async function importKey(base64Key: string): Promise<CryptoKey> {
  let raw: Uint8Array;
  try {
    raw = fromBase64(base64Key.trim());
  } catch {
    throw new Error('EMAIL_TOKEN_KEY non è base64 valido');
  }
  if (raw.length !== KEY_BYTES) {
    throw new Error(`EMAIL_TOKEN_KEY deve essere di ${KEY_BYTES} byte in base64 (trovati ${raw.length})`);
  }
  return await subtle().importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

/** Genera una chiave nuova, in base64. Usata dalla documentazione di setup. */
export function generateKeyBase64(): string {
  let bin = '';
  for (const b of randomBytes(KEY_BYTES)) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Cifra. `aad` (additional authenticated data) lega il ciphertext al contesto:
 * ci si mette l'id della connessione, così un ciphertext spostato da una riga
 * all'altra non si decifra. Senza, chi potesse scrivere nel database potrebbe
 * assegnarsi i token di un'altra azienda senza mai leggerli.
 */
export async function seal(key: CryptoKey, plaintext: string, aad?: string): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const params: AesGcmParams = { name: 'AES-GCM', iv: iv as BufferSource };
  if (aad) params.additionalData = new TextEncoder().encode(aad) as BufferSource;
  const ct = await subtle().encrypt(params, key, new TextEncoder().encode(plaintext) as BufferSource);
  return { ciphertext: new Uint8Array(ct), iv };
}

/** Decifra. Un ciphertext manomesso o con AAD sbagliata solleva: non ritorna dati. */
export async function open(key: CryptoKey, sealed: Sealed, aad?: string): Promise<string> {
  const params: AesGcmParams = { name: 'AES-GCM', iv: sealed.iv as BufferSource };
  if (aad) params.additionalData = new TextEncoder().encode(aad) as BufferSource;
  const plain = await subtle().decrypt(params, key, sealed.ciphertext as BufferSource);
  return new TextDecoder().decode(plain);
}

// ---- PKCE (RFC 7636) --------------------------------------------------------
// Il flusso è a codice di autorizzazione con client confidenziale, quindi PKCE
// non è strettamente necessario. Si usa lo stesso perché costa due funzioni e
// toglie valore a un `code` intercettato: senza il verifier non è spendibile.

export interface PkcePair {
  verifier: string;
  challenge: string;
  method: 'S256';
}

export async function createPkcePair(): Promise<PkcePair> {
  const verifier = toBase64Url(randomBytes(48));         // 43-128 caratteri per la RFC
  const digest = await subtle().digest('SHA-256', new TextEncoder().encode(verifier) as BufferSource);
  return { verifier, challenge: toBase64Url(new Uint8Array(digest)), method: 'S256' };
}

/**
 * Confronto a tempo costante. Su un segreto condiviso (il `clientState` di
 * Microsoft) il confronto ingenuo con `===` esce al primo byte diverso, e la
 * differenza di tempo è misurabile: si può ricostruire il valore un byte alla
 * volta. Qui il tempo dipende solo dalla lunghezza.
 */
export function timingSafeEqual(a: string, b: string): boolean {
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
