// ============================================================================
// Da HTML non fidato a testo. Tokenizzatore, non espressioni regolari.
//
// PERCHÉ NON SI SANIFICA L'HTML
// La strada abituale è tenere l'HTML e ripulirlo prima di renderlo. Funziona
// finché nessuno dimentica di chiamare il sanificatore, finché il sanificatore
// non ha un buco, e finché nessuno aggiunge una scorciatoia «tanto è solo
// un'anteprima». Sono tre condizioni che devono valere per sempre.
//
// Qui l'HTML non esce mai da questo file: entra, e ne esce TESTO. Chi scrive la
// UI non ha nulla da sanificare perché non ha nulla di pericoloso fra le mani,
// e non esiste alcun percorso in cui un `<script>` arrivi al DOM. Il costo è
// che la posta non si vede impaginata; in una Inbox che serve a decidere cosa
// richiede attenzione, è un costo accettabile.
//
// Non si usano espressioni regolari sulla struttura (§54): un `<img src=x
// onerror=alert(1)>` o un `<scr<script>ipt>` sono banali da costruire e
// difficili da escludere con un pattern. Qui c'è un automa a stati che riconosce
// tag, attributi, commenti e testo grezzo, e che di tutto ciò conserva solo i
// nodi di testo.
//
// Modulo PORTABILE e puro: nessuna rete, nessun ambiente, nessuno stato globale.
// ============================================================================

/** Elementi il cui CONTENUTO non è testo da leggere: si scarta anche dentro. */
const DROP_CONTENT = new Set([
  'script', 'style', 'head', 'noscript', 'template', 'svg', 'math',
  'iframe', 'object', 'embed', 'applet', 'frameset', 'frame', 'canvas', 'audio', 'video',
]);

/** Elementi che introducono uno stacco di riga nel testo risultante. */
const BLOCK = new Set([
  'p', 'div', 'br', 'tr', 'li', 'ul', 'ol', 'table', 'thead', 'tbody', 'section', 'article',
  'header', 'footer', 'blockquote', 'pre', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'form', 'fieldset',
]);

/** Elementi che separano celle: uno spazio, non un a capo. */
const CELL = new Set(['td', 'th']);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  euro: '€', pound: '£', yen: '¥', cent: '¢', sect: '§', para: '¶', middot: '·', bull: '•',
  hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  agrave: 'à', egrave: 'è', eacute: 'é', igrave: 'ì', ograve: 'ò', ugrave: 'ù',
  auml: 'ä', ouml: 'ö', uuml: 'ü', Auml: 'Ä', Ouml: 'Ö', Uuml: 'Ü', szlig: 'ss',
  ccedil: 'ç', ecirc: 'ê', acirc: 'â', ocirc: 'ô', ucirc: 'û', deg: '°', copy: '©', reg: '®', trade: '™',
  times: '×', divide: '÷', shy: '', zwnj: '', zwj: '', ensp: ' ', emsp: ' ', thinsp: ' ',
};

/**
 * Decodifica le entità di UN NODO DI TESTO. Si applica dopo aver tolto i tag,
 * quindi `&lt;script&gt;` diventa la stringa `<script>` — che è testo, e come
 * testo verrà mostrata. Non c'è modo che torni a essere markup: nessuno
 * reinterpreta questo risultato come HTML.
 */
export function decodeEntities(input: string): string {
  if (!input.includes('&')) return input;
  let out = '';
  let i = 0;
  while (i < input.length) {
    const amp = input.indexOf('&', i);
    if (amp < 0) { out += input.slice(i); break; }
    out += input.slice(i, amp);
    const semi = input.indexOf(';', amp + 1);
    // Un'entità non può essere lunga a piacere: oltre 32 caratteri è una `&` sciolta.
    if (semi < 0 || semi - amp > 32) { out += '&'; i = amp + 1; continue; }
    const body = input.slice(amp + 1, semi);
    if (body.startsWith('#')) {
      const isHex = body[1] === 'x' || body[1] === 'X';
      const digits = isHex ? body.slice(2) : body.slice(1);
      const valid = isHex ? /^[0-9a-fA-F]{1,6}$/.test(digits) : /^[0-9]{1,7}$/.test(digits);
      const code = valid ? Number.parseInt(digits, isHex ? 16 : 10) : NaN;
      if (Number.isFinite(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
        out += String.fromCodePoint(code);
        i = semi + 1;
        continue;
      }
      out += '&'; i = amp + 1; continue;
    }
    if (Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, body)) {
      out += NAMED_ENTITIES[body];
      i = semi + 1;
      continue;
    }
    out += '&'; i = amp + 1;
  }
  return out;
}

/**
 * Un URL è accettabile solo se è http/https e se il parser lo capisce.
 * `javascript:`, `data:`, `vbscript:` e tutto il resto non passano — e non
 * passano perché lo schema viene LETTO dal parser, non cercato con un pattern:
 * `java\tscript:` inganna un pattern, non `new URL()`.
 */
export function safeHttpUrl(raw: string): { url: string; host: string } | null {
  const value = raw.trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (!parsed.hostname) return null;
  return { url: parsed.toString(), host: parsed.hostname.replace(/^www\./i, '') };
}

export interface HtmlToTextResult {
  text: string;
  links: { url: string; label: string; host: string }[];
}

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  attrs: Record<string, string>;
  end: number;
}

/**
 * Legge un tag a partire da `<`. Restituisce null se non è un tag ben formato:
 * in quel caso il `<` viene trattato come testo, che è la scelta prudente —
 * mostrare un carattere in più non fa danni, interpretarlo sì.
 */
function readTag(src: string, start: number): Tag | null {
  let i = start + 1;
  const closing = src[i] === '/';
  if (closing) i++;
  const nameStart = i;
  while (i < src.length && /[A-Za-z0-9:-]/.test(src[i])) i++;
  if (i === nameStart) return null;
  const name = src.slice(nameStart, i).toLowerCase();

  const attrs: Record<string, string> = {};
  let selfClosing = false;

  while (i < src.length) {
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) return null;
    if (src[i] === '>') { i++; break; }
    if (src[i] === '/' && src[i + 1] === '>') { selfClosing = true; i += 2; break; }

    const attrStart = i;
    while (i < src.length && !/[\s=>/]/.test(src[i])) i++;
    if (i === attrStart) { i++; continue; }            // carattere inatteso: si avanza
    const attrName = src.slice(attrStart, i).toLowerCase();

    while (i < src.length && /\s/.test(src[i])) i++;
    let value = '';
    if (src[i] === '=') {
      i++;
      while (i < src.length && /\s/.test(src[i])) i++;
      const quote = src[i];
      if (quote === '"' || quote === "'") {
        i++;
        const vStart = i;
        while (i < src.length && src[i] !== quote) i++;
        value = src.slice(vStart, i);
        i++;                                            // la quota di chiusura
      } else {
        const vStart = i;
        while (i < src.length && !/[\s>]/.test(src[i])) i++;
        value = src.slice(vStart, i);
      }
    }
    // Si conservano solo gli attributi che servono a QUESTO modulo. `onerror`,
    // `onclick`, `style`, `srcdoc` non vengono nemmeno letti: non esiste un
    // percorso in cui possano finire da qualche parte.
    if (attrName === 'href' || attrName === 'alt') attrs[attrName] = value;
  }
  return { name, closing, selfClosing, attrs, end: i };
}

/**
 * HTML → testo + collegamenti. Il testo non contiene mai markup; i
 * collegamenti sono solo http/https, con l'host reale accanto all'etichetta
 * visibile, perché è quello che l'utente deve poter confrontare (§56).
 */
export function htmlToText(html: string, options: { maxLinks?: number } = {}): HtmlToTextResult {
  const maxLinks = options.maxLinks ?? 50;
  const out: string[] = [];
  const links: { url: string; label: string; host: string }[] = [];
  const seenLinks = new Set<string>();

  let i = 0;
  // Quando si entra in uno di DROP_CONTENT si ignora tutto fino alla chiusura
  // corrispondente. Si conta l'annidamento: `<svg><svg></svg></svg>` non deve
  // far credere di essere usciti alla prima chiusura.
  let dropDepth = 0;
  let dropTag = '';
  let currentLink: { url: string; host: string; labelFrom: number } | null = null;

  const push = (s: string) => { if (s) out.push(s); };

  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) {
      if (!dropDepth) push(decodeEntities(html.slice(i)));
      break;
    }
    if (lt > i && !dropDepth) push(decodeEntities(html.slice(i, lt)));

    // Commento, doctype, CDATA: si scartano senza interpretarli.
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', lt)) {
      const end = html.indexOf(']]>', lt + 9);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<!', lt) || html.startsWith('<?', lt)) {
      const end = html.indexOf('>', lt + 2);
      i = end < 0 ? html.length : end + 1;
      continue;
    }

    const tag = readTag(html, lt);
    if (!tag) {
      // `<` che non apre un tag: è testo. `a < b` in una email è legittimo.
      if (!dropDepth) push('<');
      i = lt + 1;
      continue;
    }
    i = tag.end;

    if (dropDepth) {
      if (tag.name === dropTag) {
        if (tag.closing) dropDepth--;
        else if (!tag.selfClosing) dropDepth++;
      }
      continue;
    }

    if (!tag.closing && DROP_CONTENT.has(tag.name)) {
      if (!tag.selfClosing) { dropDepth = 1; dropTag = tag.name; }
      continue;
    }

    if (tag.name === 'a') {
      if (!tag.closing) {
        const href = tag.attrs.href ? safeHttpUrl(decodeEntities(tag.attrs.href)) : null;
        currentLink = href ? { url: href.url, host: href.host, labelFrom: out.length } : null;
      } else if (currentLink) {
        const label = out.slice(currentLink.labelFrom).join('').replace(/\s+/g, ' ').trim();
        const key = `${currentLink.url}|${label}`;
        if (links.length < maxLinks && !seenLinks.has(key)) {
          seenLinks.add(key);
          links.push({ url: currentLink.url, label: label || currentLink.host, host: currentLink.host });
        }
        currentLink = null;
      }
      continue;
    }

    if (tag.name === 'img' && !tag.closing) {
      // L'immagine non viene né caricata né conservata: al più se ne tiene il
      // testo alternativo, che a volte porta l'unica informazione utile.
      const alt = decodeEntities(tag.attrs.alt ?? '').trim();
      if (alt) push(` ${alt} `);
      continue;
    }

    if (BLOCK.has(tag.name)) push('\n');
    else if (CELL.has(tag.name)) push('\t');
  }

  return { text: collapseWhitespace(out.join('')), links };
}

/**
 * Normalizza gli spazi conservando la struttura in paragrafi. Le email HTML
 * generano righe vuote a decine; comprimerle rende il testo leggibile senza
 * togliere nulla.
 */
export function collapseWhitespace(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/ /g, ' ')
    // Spazi orizzontali ripetuti, ma non gli a capo.
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Collegamenti presenti in un corpo di sola TESTO. Le email amministrative
 * arrivano spesso senza HTML, e il link al portale è l'unica azione possibile.
 * Qui l'espressione regolare è legittima: cerca un URL dentro del testo, non
 * struttura dentro del markup — e il risultato passa comunque da `safeHttpUrl`.
 */
export function linksFromPlainText(text: string, maxLinks = 50): { url: string; label: string; host: string }[] {
  const out: { url: string; label: string; host: string }[] = [];
  const seen = new Set<string>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"')\]]+/gi)) {
    if (out.length >= maxLinks) break;
    // La punteggiatura finale quasi mai fa parte dell'indirizzo.
    const cleaned = match[0].replace(/[.,;:!?]+$/, '');
    const safe = safeHttpUrl(cleaned);
    if (!safe || seen.has(safe.url)) continue;
    seen.add(safe.url);
    out.push({ url: safe.url, label: safe.url, host: safe.host });
  }
  return out;
}
