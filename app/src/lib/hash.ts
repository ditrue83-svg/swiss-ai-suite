// SHA-256 via Web Crypto — usato per il file_hash di deduplicazione (§28/§29).
// L'hash è del CONTENUTO (byte del file o testo), mai del filename.
export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === 'string'
    ? new TextEncoder().encode(data)
    : data instanceof Uint8Array ? data : new Uint8Array(data);
  // cast: le lib DOM recenti tipizzano Uint8Array su ArrayBufferLike (incl. SharedArrayBuffer),
  // ma a runtime passiamo sempre un buffer normale.
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
