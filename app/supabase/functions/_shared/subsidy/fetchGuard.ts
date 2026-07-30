// ============================================================================
// LA GUARDIA DELLE FONTI — §13, §147.
//
// ⚠️ NON ESISTE UN CRAWLER GENERICO IN QUESTO PRODOTTO, e non è una scelta di
// comodo. Un backend che scarica un URL scelto da un utente è un SSRF: dal
// browser di un cliente si potrebbero raggiungere i servizi interni della rete
// che ospita la funzione, i servizi di metadati del cloud (`169.254.169.254`,
// da cui si leggono credenziali), e qualunque host privato. Qui l'unico
// indirizzo raggiungibile è quello di una riga di `subsidy_sources`, che solo
// il ruolo di servizio può scrivere.
//
// ⚠️ L'HOST SI VALIDA A OGNI SALTO DELLA CATENA DI REDIRECT. Un controllo fatto
// solo sull'URL iniziale non protegge da niente: basta che la pagina ufficiale
// risponda 302 verso un indirizzo privato — per un errore o per un attacco — e
// la richiesta finirebbe dove non deve. Per questo il `redirect` di `fetch` è
// impostato a `manual` e i salti li seguiamo noi.
//
// ⚠️ CIÒ CHE QUESTA GUARDIA NON PUÒ FARE, e va dichiarato invece di lasciarlo
// credere: non risolve il DNS prima della richiesta, quindi non può accorgersi
// che un host pubblico *punti* a un indirizzo privato (DNS rebinding). Deno
// non espone una risoluzione DNS che permetta di legare l'IP risolto alla
// connessione effettiva, e fingere di controllarlo sarebbe peggio che dirlo.
// La difesa che resta è l'allowlist: gli host ammessi sono quelli di
// amministrazioni pubbliche svizzere, scritti a mano da chi cura il catalogo.
//
// Modulo PORTABILE: nessun import di runtime.
// ============================================================================

import {
  SOURCE_ALLOWED_CONTENT_TYPES, SOURCE_FETCH_TIMEOUT_MS, SOURCE_MAX_BYTES, SOURCE_MAX_REDIRECTS,
} from './contract.ts';
import type { SubsidyErrorCode } from './contract.ts';

/**
 * I domini ufficiali ammessi, per suffisso.
 *
 * ⚠️ È UN ELENCO INCOMPLETO, E LO DICHIARA (§12). Copre le autorità dei sette
 * programmi realmente a catalogo più i domini federali generali. Un'autorità
 * nuova richiede una riga qui E un adapter: aggiungere solo la fonte non basta,
 * ed è voluto — un dominio ammesso senza qualcuno che sappia leggerlo produce
 * una fonte che risponde e non dice niente.
 *
 * ⚠️ Il confronto è per SUFFISSO DI ETICHETTA, non per sottostringa:
 * `admin.ch` deve accettare `www.admin.ch` e rifiutare `admin.ch.evil.com`.
 * La differenza fra `endsWith('admin.ch')` e questo controllo è un dominio
 * intero sotto il controllo di chiunque.
 */
export const ALLOWED_SOURCE_HOSTS: readonly string[] = [
  // Confederazione e agenzie federali
  'admin.ch',
  'innosuisse.admin.ch',
  'innosuisse.ch',
  'seco.admin.ch',
  'bfe.admin.ch',
  'energieschweiz.ch',
  // Programmi federali con dominio proprio, tutti di enti pubblici o loro
  // mandatari: verificati uno per uno contro il catalogo (docs/subsidy-sources.md)
  'prokw.ch',
  'pronovo.ch',
  'ilprogrammaedifici.ch',
  'dasgebaeudeprogramm.ch',
  'leprogrammebatiments.ch',
  // Cantone Ticino
  'ti.ch',
  // Portali normativi cantonali e federali
  'fedlex.admin.ch',
  'bj.admin.ch',
];

export interface GuardResult {
  ok: boolean;
  errorCode?: SubsidyErrorCode;
  reason?: string;
}

/** Estrae l'host in minuscolo, senza porta. */
export function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** `a.b.example.ch` corrisponde a `example.ch`; `example.ch.evil.com` no. */
export function hostMatches(host: string, allowed: string): boolean {
  const h = host.toLowerCase();
  const a = allowed.toLowerCase();
  return h === a || h.endsWith(`.${a}`);
}

export function isAllowedHost(host: string, extra: readonly string[] = []): boolean {
  return [...ALLOWED_SOURCE_HOSTS, ...extra].some((a) => hostMatches(host, a));
}

/**
 * Riconosce gli indirizzi che non devono mai essere raggiunti.
 *
 * ⚠️ Copre anche le forme che sembrano pubbliche: `0x7f.0.0.1`, `2130706433`,
 * `[::1]`, `::ffff:127.0.0.1`. Un controllo che guardasse solo `127.` e
 * `localhost` sarebbe aggirabile con una riscrittura del numero, ed è
 * esattamente il modo in cui questi controlli falliscono.
 */
export function isPrivateAddress(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');

  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;

  // IPv6: loopback, link-local, unique-local, e IPv4 mappato.
  if (h.includes(':')) {
    if (h === '::1' || h === '::' ) return true;
    if (h.startsWith('fe80') || h.startsWith('fc') || h.startsWith('fd')) return true;
    const mapped = h.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return false;
  }

  // Forma decimale intera (`2130706433` = 127.0.0.1).
  if (/^\d+$/.test(h)) {
    const n = Number(h);
    if (Number.isFinite(n) && n <= 0xffffffff) {
      const octets = [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];
      return isPrivateAddress(octets.join('.'));
    }
    return true;
  }

  // Forma con ottetti, anche esadecimali od ottali.
  const parts = h.split('.');
  if (parts.length === 4) {
    const nums = parts.map((p) => {
      if (/^0x[0-9a-f]+$/.test(p)) return parseInt(p, 16);
      if (/^0[0-7]+$/.test(p)) return parseInt(p, 8);
      if (/^\d+$/.test(p)) return Number(p);
      return NaN;
    });
    if (nums.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) {
      const [a, b] = nums;
      if (a === 127 || a === 0 || a === 10) return true;
      if (a === 172 && b >= 16 && b <= 31) return true;
      if (a === 192 && b === 168) return true;
      if (a === 169 && b === 254) return true;   // link-local e metadati cloud
      if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
      if (a >= 224) return true;                  // multicast e riservati
      return false;
    }
  }

  return false;
}

/** Il controllo completo su un indirizzo, prima di qualunque richiesta. */
export function guardUrl(url: string, allowedHost: string): GuardResult {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, errorCode: 'source_blocked', reason: 'url_invalid' };
  }

  // ⚠️ Solo HTTPS. `http:` è rifiutato, e con esso `file:`, `ftp:`, `data:`,
  //    `gopher:` e tutto il resto: l'elenco dei protocolli ammessi è di uno.
  if (parsed.protocol !== 'https:') {
    return { ok: false, errorCode: 'source_blocked', reason: 'protocol_not_https' };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, errorCode: 'source_blocked', reason: 'credentials_in_url' };
  }
  // Una porta esplicita diversa da 443 non appartiene a un sito istituzionale
  // e serve quasi solo a raggiungere un servizio interno.
  if (parsed.port && parsed.port !== '443') {
    return { ok: false, errorCode: 'source_blocked', reason: 'non_standard_port' };
  }

  const host = parsed.hostname.toLowerCase();
  if (isPrivateAddress(host)) {
    return { ok: false, errorCode: 'source_blocked', reason: 'private_address' };
  }
  if (!hostMatches(host, allowedHost)) {
    return { ok: false, errorCode: 'source_blocked', reason: 'host_not_declared' };
  }
  if (!isAllowedHost(host)) {
    return { ok: false, errorCode: 'source_blocked', reason: 'host_not_in_allowlist' };
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// La lettura
// ---------------------------------------------------------------------------

export interface FetchOutcome {
  ok: boolean;
  errorCode?: SubsidyErrorCode;
  reason?: string;
  status?: number;
  statusCategory?: '2xx' | '3xx' | '4xx' | '5xx' | 'none';
  contentType?: string | null;
  etag?: string | null;
  lastModified?: string | null;
  /** Testo, per le pagine. Vuoto per i PDF, che restano in `bytes`. */
  text?: string;
  bytes?: Uint8Array;
  truncated?: boolean;
  durationMs: number;
  finalUrl?: string;
}

export interface FetchDeps {
  fetch: typeof fetch;
  now: () => number;
}

/**
 * Legge una fonte ufficiale rispettando tutti i limiti.
 *
 * ⚠️ `redirect: 'manual'` e la catena la seguiamo noi: è l'unico modo di
 * validare l'host a OGNI salto. Con `redirect: 'follow'` il controllo
 * iniziale non proteggerebbe da un 302 verso un indirizzo privato.
 *
 * ⚠️ Il corpo si legge a PEZZI con un tetto: `await res.text()` su una risorsa
 * da 900 MB riempirebbe la memoria dell'isolate prima che qualcuno possa
 * accorgersene, e l'isolate morirebbe senza lasciare traccia dell'errore.
 */
export async function fetchSource(
  url: string,
  allowedHost: string,
  deps: FetchDeps,
  opts: { etag?: string | null; lastModified?: string | null } = {},
): Promise<FetchOutcome> {
  const started = deps.now();
  let current = url;

  for (let hop = 0; hop <= SOURCE_MAX_REDIRECTS; hop++) {
    const guard = guardUrl(current, allowedHost);
    if (!guard.ok) {
      return {
        ok: false, errorCode: guard.errorCode, reason: guard.reason,
        statusCategory: 'none', durationMs: deps.now() - started,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SOURCE_FETCH_TIMEOUT_MS);
    let res: Response;
    try {
      const headers: Record<string, string> = {
        // ⚠️ Ci si identifica. Un'amministrazione ha diritto di sapere chi la
        //    interroga, e §12 dell'UFRC («niente interrogazioni di massa»)
        //    vale come principio anche qui.
        'user-agent': 'AI-Swisse/1.0 (+https://ai-swisse.com) subsidy-catalog',
        'accept': 'text/html,application/xhtml+xml,application/pdf,application/json;q=0.9,*/*;q=0.1',
      };
      // §153 — prima si chiede se è cambiato, e solo dopo si scarica.
      if (opts.etag) headers['if-none-match'] = opts.etag;
      if (opts.lastModified) headers['if-modified-since'] = opts.lastModified;

      res = await deps.fetch(current, {
        method: 'GET', redirect: 'manual', signal: controller.signal, headers,
      });
    } catch (e) {
      clearTimeout(timer);
      return {
        ok: false, errorCode: 'source_unreachable',
        reason: e instanceof Error ? e.name : 'fetch_failed',
        statusCategory: 'none', durationMs: deps.now() - started,
      };
    }
    clearTimeout(timer);

    const cat = res.status >= 500 ? '5xx' : res.status >= 400 ? '4xx'
      : res.status >= 300 ? '3xx' : '2xx';

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get('location');
      if (!location) {
        return { ok: false, errorCode: 'source_unreachable', reason: 'redirect_without_location',
                 status: res.status, statusCategory: cat, durationMs: deps.now() - started };
      }
      let next: string;
      try {
        next = new URL(location, current).toString();
      } catch {
        return { ok: false, errorCode: 'source_redirect_off_host', reason: 'redirect_url_invalid',
                 status: res.status, statusCategory: cat, durationMs: deps.now() - started };
      }
      current = next;
      continue;
    }

    // 304: non è cambiato niente, e non abbiamo scaricato nulla. È il caso
    // migliore, non un errore.
    if (res.status === 304) {
      return {
        ok: true, status: 304, statusCategory: '3xx',
        contentType: res.headers.get('content-type'),
        etag: opts.etag ?? null, lastModified: opts.lastModified ?? null,
        durationMs: deps.now() - started, finalUrl: current,
      };
    }

    if (!res.ok) {
      return { ok: false, errorCode: 'source_unreachable', reason: `http_${res.status}`,
               status: res.status, statusCategory: cat, durationMs: deps.now() - started };
    }

    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    const base = contentType.split(';')[0].trim();
    if (!SOURCE_ALLOWED_CONTENT_TYPES.includes(base as (typeof SOURCE_ALLOWED_CONTENT_TYPES)[number])) {
      return { ok: false, errorCode: 'source_content_type', reason: base || 'missing',
               status: res.status, statusCategory: cat, durationMs: deps.now() - started };
    }

    // ⚠️ Il `content-length` dichiarato si controlla PRIMA di leggere, ma non
    //    ci si fida: un server può mentire o ometterlo, quindi il tetto vero è
    //    quello applicato durante la lettura.
    const declared = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > SOURCE_MAX_BYTES) {
      return { ok: false, errorCode: 'source_too_large', reason: `declared_${declared}`,
               status: res.status, statusCategory: cat, durationMs: deps.now() - started };
    }

    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    const reader = res.body?.getReader();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        total += value.byteLength;
        if (total > SOURCE_MAX_BYTES) {
          truncated = true;
          await reader.cancel().catch(() => {});
          break;
        }
        chunks.push(value);
      }
    }

    const bytes = new Uint8Array(total > SOURCE_MAX_BYTES ? SOURCE_MAX_BYTES : total);
    let off = 0;
    for (const c of chunks) {
      if (off + c.byteLength > bytes.byteLength) break;
      bytes.set(c, off);
      off += c.byteLength;
    }

    const isPdf = base === 'application/pdf';
    return {
      ok: true,
      status: res.status,
      statusCategory: cat,
      contentType: base,
      etag: res.headers.get('etag'),
      lastModified: res.headers.get('last-modified'),
      // ⚠️ Il PDF NON si decodifica come testo: resta in byte e lo tratta
      //    l'adapter, che sa che cosa farne (§148). Un `TextDecoder` su un PDF
      //    produce rumore che sembra testo.
      text: isPdf ? '' : new TextDecoder('utf-8', { fatal: false }).decode(bytes),
      bytes: isPdf ? bytes : undefined,
      truncated,
      durationMs: deps.now() - started,
      finalUrl: current,
    };
  }

  return {
    ok: false, errorCode: 'source_redirect_off_host', reason: 'too_many_redirects',
    statusCategory: '3xx', durationMs: deps.now() - started,
  };
}
