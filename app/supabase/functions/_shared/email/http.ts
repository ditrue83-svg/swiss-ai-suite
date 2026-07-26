// ============================================================================
// Chiamate ai provider: timeout, errori tipizzati, ritentativi ragionati.
//
// Tre regole che valgono per ogni richiesta verso Google e Microsoft (§122):
//   1. Un timeout SEMPRE. Una `fetch` senza AbortController può restare appesa
//      quanto vuole il server remoto, e in una Edge Function significa tenere
//      occupato l'isolate finché non lo uccide il runtime — con il lease di
//      sincronizzazione ancora preso.
//   2. Un errore deve dire SE ha senso riprovare. `catch (e)` non distingue
//      «Google è occupato» da «l'utente ha revocato il consenso»: la prima si
//      ritenta, la seconda va mostrata all'utente e basta.
//   3. Mai il corpo della risposta nei log. Contiene messaggi ed eventualmente
//      token; per capire cosa è successo bastano metodo, host, stato.
// ============================================================================
import { EmailProviderError, type EmailErrorCode } from './types.ts';

export const DEFAULT_TIMEOUT_MS = 20_000;
export const MAX_ATTEMPTS = 4;

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Uint8Array | null;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  /** Numero massimo di tentativi complessivi (1 = nessun ritentativo). */
  attempts?: number;
  /** Iniettabile nei test per non attendere davvero. */
  sleepImpl?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Attesa esponenziale con jitter (§42). Il jitter non è un dettaglio: senza,
 * tutte le connessioni respinte da un 429 ritentano nello stesso istante e
 * ricreano esattamente il picco che le aveva fatte respingere.
 */
export function backoffDelay(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs != null && retryAfterMs > 0) {
    // Il provider ha detto quanto aspettare: si obbedisce, con un po' di jitter.
    return Math.min(retryAfterMs, 60_000) + Math.floor(Math.random() * 500);
  }
  const base = Math.min(1000 * 2 ** (attempt - 1), 16_000);
  return base + Math.floor(Math.random() * base * 0.3);
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const when = Date.parse(header);
  if (Number.isFinite(when)) return Math.max(0, when - Date.now());
  return null;
}

/** Traduce lo stato HTTP in un codice di dominio. */
export function codeForStatus(status: number, providerHint?: string): EmailErrorCode {
  if (status === 401) return 'AUTH_EXPIRED';
  if (status === 403) {
    // Google usa 403 sia per «quota superata» sia per «permesso mancante»: la
    // distinzione è nel corpo, e trattarli allo stesso modo o farebbe insistere
    // su un permesso che non arriverà mai, o spegnerebbe una casella per un
    // limite temporaneo. L'indizio arriva dal chiamante, che ha letto il corpo.
    if (providerHint === 'rate') return 'PROVIDER_RATE_LIMITED';
    return 'AUTH_INSUFFICIENT_SCOPE';
  }
  if (status === 404) return 'NOT_FOUND';
  if (status === 410) return 'CURSOR_EXPIRED';
  if (status === 429) return 'PROVIDER_RATE_LIMITED';
  if (status >= 500) return 'PROVIDER_UNAVAILABLE';
  return 'INVALID_RESPONSE';
}

export interface ProviderResponse {
  status: number;
  text: string;
  headers: Headers;
}

/**
 * Richiesta con timeout e ritentativi sui soli errori transitori. Restituisce
 * la risposta grezza: interpretare il corpo spetta all'adapter, che sa cosa
 * aspettarsi.
 */
export async function providerFetch(url: string, options: RequestOptions = {}): Promise<ProviderResponse> {
  const doFetch = options.fetchImpl ?? fetch;
  const doSleep = options.sleepImpl ?? sleep;
  const attempts = Math.max(1, options.attempts ?? MAX_ATTEMPTS);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const host = safeHost(url);

  let lastError: EmailProviderError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await doFetch(url, {
        method: options.method ?? 'GET',
        headers: options.headers,
        body: options.body as BodyInit | null | undefined,
        signal: controller.signal,
      });
      const text = await response.text();

      if (response.ok) return { status: response.status, text, headers: response.headers };

      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      // Il corpo si guarda SOLO per capire di che errore si tratta, e non
      // finisce nei log né nell'errore che risale.
      const hint = /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(text) ? 'rate' : undefined;
      const code = codeForStatus(response.status, hint);
      const error = new EmailProviderError(code, `${options.method ?? 'GET'} ${host} → ${response.status}`, {
        retryAfterMs: retryAfter,
        status: response.status,
      });

      if (!error.retryable || attempt === attempts) throw error;
      lastError = error;
      await doSleep(backoffDelay(attempt, retryAfter));
      continue;
    } catch (raw) {
      if (raw instanceof EmailProviderError) {
        if (!raw.retryable || attempt === attempts) throw raw;
        lastError = raw;
        await doSleep(backoffDelay(attempt, raw.retryAfterMs));
        continue;
      }
      const aborted = (raw as Error)?.name === 'AbortError';
      const error = new EmailProviderError(
        'PROVIDER_UNAVAILABLE',
        aborted ? `timeout ${host}` : `rete ${host}`,
        { retryable: true },
      );
      if (attempt === attempts) throw error;
      lastError = error;
      await doSleep(backoffDelay(attempt, null));
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new EmailProviderError('UNKNOWN', `richiesta fallita ${host}`);
}

/** Come sopra, ma con il corpo già interpretato come JSON. */
export async function providerJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const response = await providerFetch(url, options);
  if (!response.text) return {} as T;
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new EmailProviderError('INVALID_RESPONSE', `risposta non JSON da ${safeHost(url)}`);
  }
}

/** Scarica dati binari con lo stesso trattamento di timeout ed errori. */
export async function providerBytes(url: string, options: RequestOptions = {}): Promise<Uint8Array> {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await doFetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new EmailProviderError(codeForStatus(response.status), `download → ${response.status}`, { status: response.status });
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (raw) {
    if (raw instanceof EmailProviderError) throw raw;
    const aborted = (raw as Error)?.name === 'AbortError';
    throw new EmailProviderError('PROVIDER_UNAVAILABLE', aborted ? 'timeout download' : 'rete download', { retryable: true });
  } finally {
    clearTimeout(timer);
  }
}

/** Solo l'host, per messaggi ed errori: un URL può contenere identificativi. */
export function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'provider';
  }
}

export function formEncode(params: Record<string, string>): string {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
}
