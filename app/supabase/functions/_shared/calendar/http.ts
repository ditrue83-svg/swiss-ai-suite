// ============================================================================
// Chiamate ai provider di calendario: timeout, ritentativi, errori tipizzati.
//
// NON riscrive la logica di rete. `providerFetch` in `_shared/email/http.ts` fa
// già esattamente ciò che serve — un `AbortController` su ogni richiesta,
// l'attesa esponenziale con jitter, il rispetto di `Retry-After`, e mai il
// corpo della risposta nei log — ed è stato messo alla prova sul campo per
// mesi. Riscriverne una seconda copia significherebbe avere due comportamenti
// di rete che divergono al primo aggiustamento.
//
// Quello che invece NON si riusa è la TASSONOMIA DEGLI ERRORI. `CURSOR_EXPIRED`
// e `SUBSCRIPTION_GONE` non vogliono dire niente per un calendario, e
// `CALENDAR_GONE` non vuol dire niente per una casella di posta. Un errore che
// il chiamante non sa interpretare è un errore che finisce nel ramo generico, e
// il ramo generico è dove si perdono le distinzioni utili.
//
// Quindi: la rete è la stessa, il vocabolario è diverso. Questo file è la
// traduzione fra i due, e sono quaranta righe.
//
// ⚠️ `_shared/email/http.ts` e `_shared/email/crypto.ts` non contengono nulla di
// specifico della posta: stanno sotto `email/` perché sono nati con la 0013.
// Spostarli vorrebbe dire toccare cinque Edge Function in esercizio per una
// questione di nome, e il prezzo non vale il guadagno.
// ============================================================================
import { providerFetch, providerJson, safeHost, type RequestOptions } from '../email/http.ts';
import { EmailProviderError } from '../email/types.ts';
import { CalendarProviderError, type CalendarErrorCode } from './types.ts';

export type { RequestOptions };

/** Dal vocabolario della posta a quello del calendario. */
function translateCode(code: string): CalendarErrorCode {
  switch (code) {
    case 'PROVIDER_UNAVAILABLE':
    case 'PROVIDER_RATE_LIMITED':
    case 'AUTH_EXPIRED':
    case 'AUTH_INSUFFICIENT_SCOPE':
    case 'NOT_FOUND':
    case 'INVALID_RESPONSE':
    case 'CONFIG_MISSING':
      return code;
    // Un cursore scaduto o una sottoscrizione sparita non esistono in questo
    // dominio: se arrivassero, sarebbero un guasto sconosciuto, e va detto così
    // invece di riciclare un'etichetta che descrive un'altra cosa.
    default:
      return 'UNKNOWN';
  }
}

export function asCalendarError(error: unknown, fallback: CalendarErrorCode = 'UNKNOWN'): CalendarProviderError {
  if (error instanceof CalendarProviderError) return error;
  if (error instanceof EmailProviderError) {
    return new CalendarProviderError(translateCode(error.code), error.message, {
      retryable: error.retryable,
      retryAfterMs: error.retryAfterMs,
      status: error.status,
    });
  }
  return new CalendarProviderError(fallback, (error as Error)?.message ?? 'errore sconosciuto');
}

/** Richiesta grezza. Lo stato torna al chiamante: 404 e 409 sono spesso risposte, non guasti. */
export async function calFetch(url: string, options: RequestOptions = {}) {
  try {
    return await providerFetch(url, options);
  } catch (error) {
    throw asCalendarError(error);
  }
}

/** Come sopra, con il corpo già interpretato come JSON. */
export async function calJson<T>(url: string, options: RequestOptions = {}): Promise<T> {
  try {
    return await providerJson<T>(url, options);
  } catch (error) {
    throw asCalendarError(error);
  }
}

/**
 * Richiesta che TOLLERA certi stati invece di sollevare.
 *
 * Serve dove uno stato di errore è una risposta legittima: un 404 su una
 * cancellazione significa «era già cancellato», cioè l'esito voluto; un 409 su
 * una creazione con identificativo scelto da noi significa «esiste già», cioè
 * il ritentativo ha funzionato la prima volta. Trattarli come guasti
 * porterebbe a ritentare all'infinito una cosa già riuscita.
 *
 * ⚠️ Questi stati non passano dai ritentativi di `providerFetch`, ed è giusto:
 * un 404 non migliora riprovando. Per questo la richiesta è fatta qui senza il
 * suo aiuto, con un solo tentativo e il proprio timeout.
 */
export async function calFetchTolerating(
  url: string,
  tolerated: number[],
  options: RequestOptions = {},
): Promise<{ status: number; text: string; tolerated: boolean }> {
  const doFetch = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000);
  try {
    const response = await doFetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body as BodyInit | null | undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    if (response.ok) return { status: response.status, text, tolerated: false };
    if (tolerated.includes(response.status)) return { status: response.status, text, tolerated: true };

    // Non tollerato: si ricade sul percorso normale, che sa costruire l'errore
    // giusto a partire dallo stato.
    const retryAfter = response.headers.get('retry-after');
    throw asCalendarError(new EmailProviderError(
      response.status === 401 ? 'AUTH_EXPIRED'
        : response.status === 403 ? 'AUTH_INSUFFICIENT_SCOPE'
        : response.status === 404 ? 'NOT_FOUND'
        : response.status === 429 ? 'PROVIDER_RATE_LIMITED'
        : response.status >= 500 ? 'PROVIDER_UNAVAILABLE'
        : 'INVALID_RESPONSE',
      `${options.method ?? 'GET'} ${safeHost(url)} → ${response.status}`,
      { status: response.status, retryAfterMs: retryAfter ? Number(retryAfter) * 1000 : null },
    ));
  } catch (raw) {
    if (raw instanceof CalendarProviderError) throw raw;
    const aborted = (raw as Error)?.name === 'AbortError';
    throw new CalendarProviderError(
      'PROVIDER_UNAVAILABLE',
      aborted ? `timeout ${safeHost(url)}` : `rete ${safeHost(url)}`,
      { retryable: true },
    );
  } finally {
    clearTimeout(timer);
  }
}

export function parseJsonSafe<T>(text: string, url: string): T {
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new CalendarProviderError('INVALID_RESPONSE', `risposta non JSON da ${safeHost(url)}`);
  }
}
