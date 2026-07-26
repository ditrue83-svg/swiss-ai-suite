// ============================================================================
// Normalizzazione dei campi di posta. Puro, portabile, senza rete.
//
// Regola che governa tutto il file: **quando non si è sicuri, non si taglia.**
// Ridurre il rumore aiuta la classificazione, ma una riga tolta per errore può
// essere la riga che conteneva la scadenza. Ogni funzione che accorcia qualcosa
// ha quindi una condizione di rinuncia esplicita, e l'originale non viene mai
// modificato: `bodyText` resta intero, `bodyClean` è una derivazione.
// ============================================================================
import { collapseWhitespace, decodeEntities, htmlToText, linksFromPlainText, safeHttpUrl } from './html.ts';
import type { NormalizedLink, NormalizedRecipient } from './types.ts';

/** Oltre questi limiti si tronca DICHIARANDOLO a chi legge il record. */
export const MAX_SUBJECT_CHARS = 500;
export const MAX_BODY_CHARS = 200_000;
export const PREVIEW_CHARS = 200;

// ---- RFC 2047 ---------------------------------------------------------------
// Gmail restituisce gli header grezzi: un oggetto in tedesco arriva spesso come
// `=?UTF-8?B?TWFobnVuZyDDvGJlcg==?=`. Senza decodifica, la Inbox mostrerebbe
// quella stringa — e il classificatore leggerebbe base64 al posto del testo.

const B64_ALPHABET = /^[A-Za-z0-9+/=]*$/;

function decodeBase64ToBytes(input: string): Uint8Array | null {
  if (!B64_ALPHABET.test(input)) return null;
  try {
    const bin = atob(input);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

function decodeCharset(bytes: Uint8Array, charset: string): string | null {
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
  } catch {
    try { return new TextDecoder('utf-8', { fatal: false }).decode(bytes); } catch { return null; }
  }
}

/** Decodifica le «encoded words» RFC 2047. Ciò che non si decodifica resta com'è. */
export function decodeEncodedWords(input: string): string {
  if (!input.includes('=?')) return input;
  let out = '';
  let i = 0;
  while (i < input.length) {
    const start = input.indexOf('=?', i);
    if (start < 0) { out += input.slice(i); break; }
    const end = input.indexOf('?=', start + 2);
    if (end < 0) { out += input.slice(i); break; }
    const inner = input.slice(start + 2, end);
    const parts = inner.split('?');
    if (parts.length !== 3) { out += input.slice(i, start + 2); i = start + 2; continue; }
    const [charset, encodingRaw, payload] = parts;
    const encoding = encodingRaw.toUpperCase();
    let decoded: string | null = null;

    if (encoding === 'B') {
      const bytes = decodeBase64ToBytes(payload);
      decoded = bytes ? decodeCharset(bytes, charset || 'utf-8') : null;
    } else if (encoding === 'Q') {
      const bytes: number[] = [];
      let k = 0;
      let malformed = false;
      while (k < payload.length) {
        const c = payload[k];
        if (c === '_') { bytes.push(0x20); k++; continue; }
        if (c === '=') {
          const hex = payload.slice(k + 1, k + 3);
          if (!/^[0-9A-Fa-f]{2}$/.test(hex)) { malformed = true; break; }
          bytes.push(Number.parseInt(hex, 16));
          k += 3;
          continue;
        }
        bytes.push(c.charCodeAt(0) & 0xff);
        k++;
      }
      decoded = malformed ? null : decodeCharset(new Uint8Array(bytes), charset || 'utf-8');
    }

    out += decoded ?? input.slice(start, end + 2);
    i = end + 2;
    // Fra due encoded-word consecutive lo spazio non fa parte del testo.
    const nextStart = input.indexOf('=?', i);
    if (nextStart > i && input.slice(i, nextStart).trim() === '') i = nextStart;
  }
  return out;
}

// ---- Oggetto ----------------------------------------------------------------

/**
 * L'oggetto può essere assente, vuoto, codificato o lunghissimo (§113). Qui si
 * decodifica e si normalizza; l'assenza resta `null`, perché «Senza oggetto» è
 * un'etichetta dell'interfaccia — e come tale va tradotta, non scritta nel
 * database in una lingua sola.
 */
export function normalizeSubject(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const decoded = decodeEncodedWords(String(raw));
  const cleaned = collapseWhitespace(decoded.replace(/\n+/g, ' '));
  if (!cleaned) return null;
  return cleaned.length > MAX_SUBJECT_CHARS ? `${cleaned.slice(0, MAX_SUBJECT_CHARS - 1)}…` : cleaned;
}

// ---- Indirizzi --------------------------------------------------------------

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/**
 * Nome e indirizzo SEPARATI (§111): tenere `AFC <noreply@…>` come stringa unica
 * rende impossibile interrogare il dominio, che è il segnale più affidabile per
 * riconoscere un ente. Se l'indirizzo non è riconoscibile si restituisce null
 * invece di salvare una stringa che sembra un indirizzo e non lo è.
 */
export function parseAddress(raw: string | null | undefined): NormalizedRecipient | null {
  if (!raw) return null;
  const value = decodeEncodedWords(String(raw)).trim();
  if (!value) return null;

  const angle = value.lastIndexOf('<');
  if (angle >= 0) {
    const close = value.indexOf('>', angle);
    const email = value.slice(angle + 1, close < 0 ? value.length : close).trim().toLowerCase();
    let name = value.slice(0, angle).trim().replace(/^["']|["']$/g, '').trim();
    if (name === email) name = '';
    if (!EMAIL_RE.test(email)) return null;
    return { name: name || null, email };
  }
  const bare = value.replace(/^["']|["']$/g, '').trim().toLowerCase();
  if (!EMAIL_RE.test(bare)) return null;
  return { name: null, email: bare };
}

/** Lista di destinatari da un header (`a@x.ch, "Nome" <b@y.ch>`). */
export function parseAddressList(raw: string | null | undefined, max = 25): NormalizedRecipient[] {
  if (!raw) return [];
  const out: NormalizedRecipient[] = [];
  const seen = new Set<string>();
  // Le virgole dentro un nome quotato non separano: si spezza fuori dalle quote.
  let depth = 0;
  let current = '';
  const flush = () => {
    const parsed = parseAddress(current);
    current = '';
    if (parsed && !seen.has(parsed.email) && out.length < max) {
      seen.add(parsed.email);
      out.push(parsed);
    }
  };
  for (const ch of String(raw)) {
    if (ch === '"') { depth = depth ? 0 : 1; current += ch; continue; }
    if ((ch === ',' || ch === ';') && !depth) { flush(); continue; }
    current += ch;
  }
  flush();
  return out;
}

export function normalizeRecipients(list: { name?: string | null; email?: string | null }[] | null | undefined, max = 25): NormalizedRecipient[] {
  if (!Array.isArray(list)) return [];
  const out: NormalizedRecipient[] = [];
  const seen = new Set<string>();
  for (const item of list) {
    const email = String(item?.email ?? '').trim().toLowerCase();
    if (!EMAIL_RE.test(email) || seen.has(email)) continue;
    seen.add(email);
    const name = item?.name ? decodeEncodedWords(String(item.name)).trim() : '';
    out.push({ name: name && name.toLowerCase() !== email ? name : null, email });
    if (out.length >= max) break;
  }
  return out;
}

// ---- Corpo ------------------------------------------------------------------

export interface NormalizedBody {
  text: string;
  preview: string;
  links: NormalizedLink[];
  truncated: boolean;
}

/**
 * Corpo → testo + collegamenti, da HTML o da testo semplice. Se il provider
 * fornisce entrambi si preferisce l'HTML: nelle email amministrative la parte
 * testuale è spesso un riassunto povero o assente, mentre l'HTML contiene la
 * tabella con gli importi.
 */
export function normalizeBody(input: { html?: string | null; text?: string | null }): NormalizedBody {
  const html = input.html ?? '';
  const plain = input.text ?? '';

  let text: string;
  let links: NormalizedLink[];

  if (html.trim()) {
    const converted = htmlToText(html);
    text = converted.text;
    links = converted.links;
    // Un HTML che si riduce quasi a nulla (immagine unica, tabella vuota) ma
    // che ha accanto un testo vero: si usa il testo. Il contrario di un
    // fallback silenzioso — la scelta segue una condizione dichiarata.
    if (text.length < 40 && plain.trim().length > text.length) {
      text = collapseWhitespace(decodeEntities(plain));
      links = mergeLinks(links, linksFromPlainText(text));
    }
  } else {
    text = collapseWhitespace(plain);
    links = linksFromPlainText(text);
  }

  const truncated = text.length > MAX_BODY_CHARS;
  if (truncated) text = text.slice(0, MAX_BODY_CHARS);

  return { text, preview: makePreview(text), links, truncated };
}

function mergeLinks(a: NormalizedLink[], b: NormalizedLink[]): NormalizedLink[] {
  const seen = new Set(a.map((l) => l.url));
  const out = [...a];
  for (const link of b) {
    if (seen.has(link.url)) continue;
    seen.add(link.url);
    out.push(link);
  }
  return out;
}

export function makePreview(text: string, chars = PREVIEW_CHARS): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > chars ? `${oneLine.slice(0, chars - 1)}…` : oneLine;
}

// ---- Storico citato e firme -------------------------------------------------

/**
 * Marcatori di inizio dello storico citato. Sono formule dei client di posta,
 * non frasi di una lingua: qui c'è tutto quello che Gmail, Outlook e Apple Mail
 * scrivono nelle tre lingue di lavoro. L'elenco è volutamente CORTO: aggiungere
 * pattern generici («Il giorno … ha scritto») significa rischiare di tagliare
 * una frase legittima, e un taglio sbagliato non lascia traccia.
 */
const QUOTE_MARKERS: RegExp[] = [
  /^-{2,}\s*(original message|messaggio originale|message d'origine|ursprüngliche nachricht)\s*-{2,}$/i,
  /^_{10,}$/,
  /^-{2,}\s*(forwarded message|messaggio inoltrato|message transféré|weitergeleitete nachricht)\s*-{2,}$/i,
  /^(von|from|da|de)\s*:\s*.+<[^>]+>\s*$/i,
];

export interface CleanedBody {
  text: string;
  quotedRemoved: boolean;
}

/**
 * Testo depurato di storico citato e firma, per la classificazione (§115/§116).
 *
 * Tre condizioni di rinuncia, tutte esplicite:
 *   · nessun marcatore riconosciuto → non si taglia;
 *   · il taglio lascerebbe meno di 60 caratteri → non si taglia: una parte
 *     nuova così corta («vedi sotto») significa che l'informazione sta nel
 *     testo citato, ed è proprio il caso in cui toglierlo farebbe danno;
 *   · il taglio rimuoverebbe più del 92% del testo → non si taglia (probabile
 *     falso riconoscimento su una email che è tutta un inoltro).
 */
export function stripQuotedAndSignature(text: string): CleanedBody {
  if (!text) return { text: '', quotedRemoved: false };
  const lines = text.split('\n');

  let cut = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    if (QUOTE_MARKERS.some((re) => re.test(line))) { cut = i; break; }
    // Blocco di righe citate con `>`: il taglio parte dalla prima, ma solo se
    // ce ne sono almeno due di fila (una `>` isolata capita nel testo normale).
    if (line.startsWith('>') && (lines[i + 1] ?? '').trim().startsWith('>')) { cut = i; break; }
  }

  let candidate = cut >= 0 ? lines.slice(0, cut).join('\n').trimEnd() : text;
  let quotedRemoved = false;
  if (cut >= 0 && candidate.trim().length >= 60 && candidate.length >= text.length * 0.08) {
    quotedRemoved = true;
  } else {
    candidate = text;
  }

  // Delimitatore di firma RFC 3676 («-- » su riga propria): è uno standard, non
  // un'euristica. Si taglia solo se la coda è una firma plausibile, cioè breve.
  const sigLines = candidate.split('\n');
  const sigIndex = sigLines.findIndex((l) => l === '-- ' || l.trimEnd() === '--');
  if (sigIndex > 0) {
    const head = sigLines.slice(0, sigIndex).join('\n').trimEnd();
    const tailLength = candidate.length - head.length;
    if (head.trim().length >= 60 && tailLength < candidate.length * 0.4) candidate = head;
  }

  return { text: candidate.trim(), quotedRemoved };
}

// ---- Header di massa --------------------------------------------------------

/**
 * Posta di massa secondo gli header. È un FATTO leggibile, non un giudizio:
 * un ente può benissimo mandare una comunicazione vera con List-Unsubscribe.
 * Per questo il valore alimenta la classificazione ma non decide da solo (§30).
 */
export function detectBulk(headers: Record<string, string>): boolean {
  const get = (name: string) => headers[name.toLowerCase()] ?? '';
  if (get('list-unsubscribe')) return true;
  if (/^(bulk|list|junk)$/i.test(get('precedence').trim())) return true;
  if (get('list-id')) return true;
  if (/^(promotional|bulk)$/i.test(get('x-priority').trim())) return true;
  if (get('x-campaign-id') || get('x-mailer-campaign') || get('x-sg-eid')) return true;
  return false;
}

/** Header come mappa in minuscolo: i nomi degli header non sono case sensitive. */
export function headerMap(headers: { name?: string | null; value?: string | null }[] | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers ?? []) {
    const name = String(h?.name ?? '').toLowerCase();
    if (!name) continue;
    // Il primo vince: un header duplicato è un'anomalia, e prendere l'ultimo
    // permetterebbe di sovrascrivere il vero mittente aggiungendone uno in coda.
    if (!(name in out)) out[name] = String(h?.value ?? '');
  }
  return out;
}

/** Data affidabile: quella del provider se c'è, altrimenti l'header. Mai «adesso». */
export function normalizeDate(value: string | number | null | undefined): string | null {
  if (value == null || value === '') return null;
  const date = typeof value === 'number' ? new Date(value) : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  // Una data futura oltre un giorno o antecedente al 1990 è un orologio sbagliato
  // del mittente: si dichiara sconosciuta invece di ordinarci la Inbox.
  const ms = date.getTime();
  if (ms < Date.UTC(1990, 0, 1) || ms > Date.now() + 86_400_000) return null;
  return date.toISOString();
}

export { safeHttpUrl };
