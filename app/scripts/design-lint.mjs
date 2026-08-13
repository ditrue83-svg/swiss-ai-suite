// ============================================================================
// design:lint — la regola 1 del sistema di design, resa un controllo che fallisce.
//   npm run design:lint                  (esce 1 se trova violazioni)
//   npm run design:lint -- --report      (elenco riga per riga)
//   npm run design:lint -- --self-test   (solo l'autoverifica del rilevatore)
//
// PERCHÉ ESISTE. «Nessun valore scritto a mano: misure e colori vengono dai
// token» (docs/design-system.md, regola 1) era una regola scritta, non un
// controllo: fra la stesura e l'8 agosto 2026 gli stili inline nei componenti
// sono passati da 50 a 95, e i valori di padding/margin/gap scritti a mano in
// src/styles/ sono rimasti fermi a ~267 mentre i token --sp-* venivano usati
// 212 volte NEI POSTI NUOVI. Un sistema di design che vale solo per il codice
// che ancora non esiste non è un sistema: è una speranza. Questo controllo
// blocca la CI, come i18n:coverage — perché anche lì la regola scritta non era
// bastata, due volte.
//
// COSA SEGNALA
//   carattere    font-size (o shorthand font) con un valore in px: la misura
//                del testo viene dai sei gradini --fs-*.
//   colore       un letterale #…, rgb(…), rgba(…), hsl(…), hsla(…) fuori dai
//                blocchi `:root` (base, tema scuro, stampa): i colori si
//                definiscono lì UNA volta e si usano con var(--…). È la regola
//                che ha reso possibile il tema scuro e la stampa senza toccare
//                le singole regole.
//   spaziatura   padding, margin o gap con un valore in px: il ritmo viene
//                dalla scala --sp-* (multipli di 4). Un px «giusto» (8px) è
//                comunque scritto a mano: il giorno in cui la scala cambia,
//                quel valore non la segue. Il rapporto distingue i valori che
//                coincidono con un gradino (conversione meccanica), quelli
//                vicini (arrotondare) e quelli oltre 4px dal gradino più
//                vicino (DA DECIDERE, non da forzare).
//   inline       style={{ … }} nei componenti con colore, bordo o spaziatura
//                statici. Un valore davvero dinamico (larghezza di una barra,
//                colore che arriva dai dati come var(--…)) resta inline, con
//                un commento che dice perché; tutto il resto sta nel CSS.
//
// COSA NON FA, DI PROPOSITO
//   · non tocca border-radius, larghezze, posizioni: la regola 1 vale anche lì,
//     ma un controllo nasce sul perimetro dove il degrado è misurato. Allargare
//     il perimetro È un intervento, con i suoi numeri prima e dopo.
//   · non riconosce i nomi di classe. La regola 5 del sistema di design esiste
//     perché «tag» aveva catturato .price-tag e «badge» .rel-badge: qui si
//     guardano SOLO le dichiarazioni (proprietà: valore), mai il nome di ciò
//     che le contiene.
//   · non corregge niente: dice dove guardare, con il gradino più vicino
//     accanto. La correzione la fa una persona che poi GUARDA la schermata.
//
// LE ECCEZIONI sono dichiarate qui sotto, una riga ciascuna con il motivo:
// ciò che non passa dal controllo deve passare da una frase che si può
// contestare. Un'eccezione che non corrisponde più a nulla nel codice fa
// FALLIRE il controllo («eccezione morta»): la riga va tolta, non dimenticata.
// ============================================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const CSS_ROOT = 'src/styles';
const TSX_ROOT = 'src';

// ---------------------------------------------------------------------------
// LA SCALA NON SI DICHIARA QUI: si legge da app.css. Se questo file elencasse
// «4, 8, 12…», il giorno in cui la scala cambia il controllo mentirebbe — è la
// seconda fonte di verità che questo repository vieta. Se i token non si
// trovano, il controllo si rifiuta di rispondere: nessun fallback silenzioso.
// ---------------------------------------------------------------------------
function readTokens(cssSource) {
  const sp = new Map();      // 8 → '--sp-2'
  const fs = new Map();      // 15 → '--fs-body'
  for (const m of cssSource.matchAll(/(--sp-\d+)\s*:\s*(\d+(?:\.\d+)?)px/g)) {
    sp.set(Number(m[2]), m[1]);
  }
  for (const m of cssSource.matchAll(/(--fs-[a-z0-9]+)\s*:\s*(\d+(?:\.\d+)?)px/g)) {
    fs.set(Number(m[2]), m[1]);
  }
  if (sp.size < 3 || fs.size < 3) {
    console.error('✗ Non trovo la scala --sp-*/--fs-* in src/styles/app.css: senza, questo controllo non può giudicare.');
    process.exit(1);
  }
  return { sp, fs };
}

/** Gradino più vicino a `px` e distanza. A pari distanza li riporta entrambi:
 *  la scelta fra 4 e 8 per un 6px è una decisione, non un arrotondamento. */
function nearestStep(px, spMap) {
  const steps = [...spMap.keys()].sort((a, b) => a - b);
  const v = Math.abs(px);
  let best = Infinity;
  for (const s of steps) best = Math.min(best, Math.abs(s - v));
  const at = steps.filter((s) => Math.abs(s - v) === best);
  return { steps: at, delta: best, exact: best === 0 };
}

// ---------------------------------------------------------------------------
// ECCEZIONI — una riga, un fatto, un motivo.
//
// La corrispondenza è per (file, contesto, frammento): il contesto è il
// selettore CSS o la chiave dello stile inline, il frammento è la
// dichiarazione ESATTA (spazi normalizzati). Niente nomi di classe usati come
// filtro, niente pattern: se la dichiarazione cambia anche di un carattere,
// l'eccezione muore e il controllo lo dice. `occorrenze` (default 1) va tenuto
// uguale al numero di volte in cui la STESSA dichiarazione compare nello
// STESSO contesto: di meno = eccezione morta, di più = violazione.
//
// Le famiglie, e il loro perché:
//
// · NEGATIVI. La scala non parla in negativo: un margine che risale compensa
//   qualcosa di specifico (un line-height, la scatola da 1px di sr-only) e
//   si dichiara qui col suo perché.
//   (La famiglia «sotto il primo gradino» — 53 valori da 1–3px — è vissuta in
//   questa lista dal 2026-08-09 al 2026-08-10, finché la sua stessa taglia ha
//   convinto la scala a nominare --sp-05: 2px. Le eccezioni erano il segno che
//   mancava un gradino: nominato il gradino, sono tornate scala.)
//
// · OLTRE 4PX DAL GRADINO. Il mandato resta: fino a 4px di scarto si
//   arrotonda, oltre ci si ferma e si decide GUARDANDO la schermata, mai
//   forzando. La famiglia oggi è vuota: l'ultimo caso — i 40/64px della
//   cornice .main — è stato deciso a schermo il 2026-08-10 (lati a --sp-12,
//   fondo allineato al 48 dei breakpoint stretti).
//
// · CARATTERE LEGATO AL CERCHIO. Le due pseudo-classi documentate in
//   docs/design-system.md: la misura dipende dal cerchio che le contiene, non
//   dalla gerarchia del testo.
// ---------------------------------------------------------------------------
const EXCEPTIONS = [
  { file: 'src/styles/app.css', contesto: '.brand-sub', frammento: 'margin-top: -1px', motivo: 'il sottotitolo risale di un filo contro il line-height del nome: negativo, la scala non parla in negativo' },
  { file: 'src/styles/app.css', contesto: '.dash-inc-stats', frammento: 'margin: -2px 0 var(--sp-3)', motivo: 'compensa il line-height del titolo sopra: valore negativo, la scala non parla in negativo' },
  { file: 'src/styles/extra.css', contesto: '.dash-sorted', frammento: 'margin: -6px 0 var(--sp-2)', motivo: 'risale sotto il titolo che il card-title ha già distanziato: negativo, fuori dal ritmo' },
  { file: 'src/styles/app.css', contesto: '.segmented .btn + .btn', frammento: 'margin-left: -1px', motivo: 'i due estremi di un interruttore condividono UN bordo: risale esattamente 1px, cioè lo spessore del bordo che sta sovrapponendo — negativo, e la scala non parla in negativo' },
  { file: 'src/styles/app.css', contesto: '.ct-sr', frammento: 'margin: -1px', motivo: 'idioma sr-only: la scatola da 1px esce dal flusso per i soli lettori di schermo' },
  { file: 'src/styles/extra.css', contesto: '.sr-only', frammento: 'margin: -1px', motivo: 'idioma sr-only: la scatola da 1px esce dal flusso per i soli lettori di schermo' },
  { file: 'src/styles/app.css', contesto: 'html, body', frammento: 'background: #ffffff !important', motivo: 'stampa: rete di sicurezza contro i default del browser, documentata nel blocco — protegge anche a token rotti' },
  { file: 'src/styles/app.css', contesto: 'html, body', frammento: 'color: #000000 !important', motivo: 'stampa: rete di sicurezza contro i default del browser, documentata nel blocco — protegge anche a token rotti' },
  { file: 'src/styles/extra.css', contesto: '.print-kv dt', frammento: 'color: #333', motivo: 'grigio dell\'etichetta su carta: fra --muted (sfuma in retinatura) e --ink (ruberebbe il nero al valore) la palette di stampa non nomina un gradino' },
  { file: 'src/styles/extra.css', contesto: '.print-url', frammento: 'color: #333', motivo: 'grigio dell\'etichetta su carta: fra --muted (sfuma in retinatura) e --ink (ruberebbe il nero al valore) la palette di stampa non nomina un gradino' },
  { file: 'src/styles/extra.css', contesto: '.print-foot', frammento: 'color: #333', motivo: 'grigio dell\'etichetta su carta: fra --muted (sfuma in retinatura) e --ink (ruberebbe il nero al valore) la palette di stampa non nomina un gradino' },
  { file: 'src/styles/extra.css', contesto: '.bell-badge', frammento: 'color: #fff', motivo: 'bianco sul riempimento --red in tutt\'e due i temi; unico fondo pieno rosso dell\'app: il token nascerà col secondo caso' },
  { file: 'src/styles/app.css', contesto: '.state-list li::before', frammento: 'font-size: 11px', motivo: 'la spunta segue il cerchio che la contiene, non la gerarchia del testo (documentato nella scala tipografica)' },
  // `.verify-box li::before` non è più qui: il blocco «da verificare» è la
  // `.verify-note` delle marcature (2026-08-12), e il «?» è un glifo SVG, non
  // un carattere da dimensionare a mano.
];

// ---------------------------------------------------------------------------
// SCANNER CSS — un automa, non una regex sul file intero.
// Tiene la pila dei blocchi: sa se sta dentro `:root` (dove i colori si
// definiscono), dentro una @media (che NON è una dichiarazione: i suoi
// `(max-width: 640px)` non sono spaziature), o dentro una regola normale.
// ---------------------------------------------------------------------------
const SPACING_PROPS = new Set([
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'padding-block', 'padding-inline',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'margin-block', 'margin-inline',
  'gap', 'row-gap', 'column-gap',
]);
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/;

export function scanCss(file, src, tokens) {
  const hits = [];
  const stack = [];                      // { sel, isRoot }
  let i = 0, declStart = 0, buf = '';
  const n = src.length;
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  const inRoot = () => stack.some((f) => f.isRoot);

  const handleDecl = (text, at) => {
    const colon = text.indexOf(':');
    if (colon < 0) return;
    const prop = text.slice(0, colon).trim().toLowerCase();
    const value = text.slice(colon + 1).trim();
    if (!prop || !value) return;
    const sel = stack.length ? stack[stack.length - 1].sel : '';
    const line = lineOf(at);
    const decl = `${prop}: ${value}`;

    // colore: vietato fuori da :root, qualunque sia la proprietà — anche la
    // definizione di un token locale (`--x: #fff` dentro una classe) è un
    // colore che sfugge ai tre blocchi di tema.
    if (!inRoot() && COLOR_LITERAL.test(value)) {
      hits.push({ file, line, cat: 'colore', ctx: sel, decl, note: 'letterale fuori da :root' });
    }
    if (inRoot()) return;                // dentro :root si definisce: tutto lecito

    // carattere
    if (prop === 'font-size' || prop === 'font') {
      const m = value.match(/(\d+(?:\.\d+)?)px/);
      if (m) {
        const px = Number(m[1]);
        const tok = tokens.fs.get(px);
        hits.push({
          file, line, cat: 'carattere', ctx: sel, decl,
          note: tok ? `coincide con ${tok}: usare var(${tok})` : `${px}px non è un gradino --fs-*`,
        });
      }
    }

    // spaziatura: ogni valore in px della dichiarazione conta per sé —
    // `padding: 4px 18px` sono DUE valori scritti a mano, non uno.
    if (SPACING_PROPS.has(prop)) {
      for (const m of value.matchAll(/(-?\d+(?:\.\d+)?)px/g)) {
        const px = Number(m[1]);
        if (px === 0) continue;          // lo zero è assenza, non misura
        const near = nearestStep(px, tokens.sp);
        let note;
        if (near.exact && px > 0) note = `coincide con ${tokens.sp.get(px)}: usare var(${tokens.sp.get(px)})`;
        else if (near.delta <= 4) note = `fuori scala: gradino più vicino ${near.steps.join(' o ')}px (scarto ${near.delta}px)`;
        else note = `OLTRE 4px dal gradino più vicino (${near.steps.join(' o ')}px, scarto ${near.delta}px): da decidere, non da forzare`;
        hits.push({ file, line, cat: 'spaziatura', ctx: sel, decl, px, note });
      }
    }
  };

  // `buf` accumula selettori E dichiarazioni; i commenti non vi entrano MAI.
  // La prima versione ricavava il selettore affettando il sorgente «dall'ultimo
  // punto e virgola alla graffa»: il commento di testata finiva nel selettore,
  // «/* … */ :root» non era più ':root', e i 34 token del blocco base venivano
  // segnalati come colori fuori posto. Trovato dall'elenco riga per riga il
  // 2026-08-09, ora inchiodato da un caso d'autoverifica.
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      if (!buf.trim()) declStart = i;
      let k = i + 1;
      while (k < n && src[k] !== c) { if (src[k] === '\\') k++; k++; }
      buf += src.slice(i, k + 1); i = k + 1; continue;
    }
    if (c === '{') {
      const sel = buf.replace(/\s+/g, ' ').trim();
      stack.push({ sel, isRoot: sel === ':root' });
      buf = ''; i++; continue;
    }
    if (c === '}') {
      if (stack.length && buf.trim()) handleDecl(buf, declStart);
      stack.pop(); buf = ''; i++; continue;
    }
    if (c === ';') {
      if (stack.length && buf.trim()) handleDecl(buf, declStart);
      buf = ''; i++; continue;
    }
    if (!buf.trim() && !/\s/.test(c)) declStart = i;
    buf += c;
    i++;
  }
  return hits;
}

// ---------------------------------------------------------------------------
// SCANNER TSX — solo oggetti letterali `style={{ … }}`.
//
// `style={variabile}` non si giudica da qui: se la variabile contiene un
// colore scritto a mano lo si vede dove è definita. L'oggetto si percorre
// contando le graffe e SALTANDO stringhe, template e commenti: è la lezione
// pagata da i18n:coverage il 2026-07-27 — un apostrofo in un commento aveva
// sfasato tutto il conteggio a valle.
//
// Le proprietà sorvegliate sono un elenco chiuso, non un pattern: `flex`,
// `minWidth`, `width` NON ci sono, ed è voluto — sono layout e valori
// dinamici (la larghezza di una barra viene dai dati), non colore/bordo/
// spaziatura.
// ---------------------------------------------------------------------------
const TSX_SPACING = new Set([
  'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
  'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'gap', 'rowGap', 'columnGap',
]);
const TSX_COLOR = new Set([
  'color', 'background', 'backgroundColor', 'boxShadow', 'fill', 'stroke',
  'textDecorationColor', 'caretColor',
]);
// Un bordo statico in markup non è mai «dinamico»: si segnala sempre.
const TSX_BORDER = new Set([
  'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft',
  'borderColor', 'borderWidth', 'borderStyle', 'borderRadius',
  'outline', 'outlineColor',
]);
const TSX_FONT = new Set(['fontSize']);

/** Il valore è un'espressione dinamica o un token? Allora può restare inline. */
function isDynamicOrToken(expr) {
  const e = expr.trim();
  if (!e) return true;
  // template: contano solo i caratteri FUORI da ${…} — `${x}px` è dinamico,
  // `\`8px 0\`` no.
  const staticPart = e.replace(/\$\{[^}]*\}/g, '');
  const quoted = staticPart.match(/["'`]/) ? staticPart.replace(/["'`]/g, ' ') : null;
  if (quoted !== null) {
    if (COLOR_LITERAL.test(quoted)) return false;         // 'rgba(…)' scritto a mano
    if (/\d/.test(quoted) && !/^\s*(100|50)?%?\s*$/.test(quoted)) {
      // una stringa con cifre ('8px 0', '13px') è una misura scritta a mano;
      if (/var\(--[a-z0-9-]+\)/.test(quoted) && !/\d(?![^(]*\))/.test(quoted.replace(/var\([^)]*\)/g, ''))) return true;
      return false;
    }
    return true;                                          // 'auto', '100%', 'var(--sp-2)'
  }
  if (/^-?\d+(\.\d+)?$/.test(e)) return false;            // numero puro: px in React
  if (/(^|[^.\w])\d+(\.\d+)?([^%\w]|$)/.test(e) && /[?:]/.test(e)) return false; // ternario con numeri scritti a mano
  return true;                                            // identificatore, chiamata, membro
}

export function scanTsx(file, src) {
  const hits = [];
  const lineOf = (idx) => src.slice(0, idx).split('\n').length;
  for (const m of src.matchAll(/style=\{\s*\{/g)) {
    const open = m.index + m[0].length - 1;               // la graffa dell'OGGETTO
    let i = open + 1, depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { const e = src.indexOf('\n', i); i = e < 0 ? src.length : e; continue; }
      if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; continue; }
      if (c === '"' || c === "'") { const q = c; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; } i++; continue; }
      if (c === '`') { i++; while (i < src.length && src[i] !== '`') { if (src[i] === '\\') i++; if (src[i] === '$' && src[i + 1] === '{') { let d = 1; i += 2; while (i < src.length && d > 0) { if (src[i] === '{') d++; if (src[i] === '}') d--; i++; } continue; } i++; } i++; continue; }
      if (c === '{') depth++;
      if (c === '}') depth--;
      i++;
    }
    const raw = src.slice(open + 1, i - 1);

    // I commenti si spengono PRIMA di spezzare le coppie, a lunghezza
    // invariata: un apostrofo in un commento (`// l'allineamento…`) aprirebbe
    // una «stringa» che si chiude molto più avanti, dentro un'altra coppia.
    // È lo stesso guasto pagato da i18n:coverage il 2026-07-27.
    let body = '';
    for (let p = 0; p < raw.length;) {
      const c = raw[p];
      if (c === '/' && raw[p + 1] === '/') { const e = raw.indexOf('\n', p); const stop = e < 0 ? raw.length : e; body += ' '.repeat(stop - p); p = stop; continue; }
      if (c === '/' && raw[p + 1] === '*') { const e = raw.indexOf('*/', p + 2); const stop = e < 0 ? raw.length : e + 2; body += ' '.repeat(stop - p); p = stop; continue; }
      if (c === '"' || c === "'" || c === '`') { const q = c; body += c; p++; while (p < raw.length && raw[p] !== q) { if (raw[p] === '\\') { body += raw[p]; p++; } body += raw[p]; p++; } body += raw[p] ?? ''; p++; continue; }
      body += c; p++;
    }

    // coppie chiave: valore al livello 0 dell'oggetto
    let k = 0, d = 0, entryStart = 0;
    const entries = [];
    while (k <= body.length) {
      const c = body[k];
      if (c === '"' || c === "'" || c === '`') { const q = c; k++; while (k < body.length && body[k] !== q) { if (body[k] === '\\') k++; k++; } k++; continue; }
      if (c === '(' || c === '{' || c === '[') d++;
      if (c === ')' || c === '}' || c === ']') d--;
      if ((c === ',' && d === 0) || k === body.length) {
        const entry = body.slice(entryStart, k).trim();
        if (entry) entries.push({ text: entry, at: open + 1 + entryStart });
        entryStart = k + 1;
      }
      k++;
    }
    for (const { text, at } of entries) {
      if (text.startsWith('...')) continue;               // spread: si giudica alla fonte
      const colon = text.indexOf(':');
      if (colon < 0) continue;
      const key = text.slice(0, colon).trim().replace(/^["']|["']$/g, '');
      const value = text.slice(colon + 1).trim();
      const line = lineOf(at);
      const decl = `${key}: ${value.replace(/\s+/g, ' ')}`;
      if (TSX_BORDER.has(key)) {
        hits.push({ file, line, cat: 'inline', ctx: key, decl, note: 'un bordo si definisce nel CSS (o con un token per tema, come --line-subtle)' });
      } else if (TSX_COLOR.has(key) && !isDynamicOrToken(value)) {
        hits.push({ file, line, cat: 'inline', ctx: key, decl, note: 'colore scritto a mano nel markup' });
      } else if (TSX_SPACING.has(key) && !isDynamicOrToken(value)) {
        hits.push({ file, line, cat: 'inline', ctx: key, decl, note: 'spaziatura statica nel markup: classe CSS con i token' });
      } else if (TSX_FONT.has(key) && !isDynamicOrToken(value)) {
        hits.push({ file, line, cat: 'inline', ctx: key, decl, note: 'misura del testo scritta a mano: i gradini sono --fs-*' });
      }
    }
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Eccezioni: consumo a conteggio esatto.
// ---------------------------------------------------------------------------
const norm = (s) => s.replace(/\s+/g, ' ').trim();

export function applyExceptions(hits, exceptions) {
  const remaining = [];
  const usage = exceptions.map(() => 0);
  for (const h of hits) {
    const idx = exceptions.findIndex((ex, j) =>
      ex.file === h.file && norm(ex.contesto) === norm(h.ctx) &&
      norm(ex.frammento) === norm(h.decl) && usage[j] < (ex.occorrenze ?? 1));
    if (idx >= 0) usage[idx]++;
    else remaining.push(h);
  }
  const dead = exceptions.filter((ex, j) => usage[j] < (ex.occorrenze ?? 1));
  return { remaining, dead };
}

// ---------------------------------------------------------------------------
// AUTOVERIFICA — casi che DEVONO fallire e casi che DEVONO passare.
// Un controllo non provato sul rosso è già stato pagato due volte qui dentro.
// ---------------------------------------------------------------------------
const FIXTURE_TOKENS = {
  sp: new Map([[4, '--sp-1'], [8, '--sp-2'], [12, '--sp-3'], [16, '--sp-4'], [24, '--sp-6'], [32, '--sp-8'], [48, '--sp-12']]),
  fs: new Map([[12, '--fs-label'], [13, '--fs-meta'], [15, '--fs-body'], [17, '--fs-strong'], [22, '--fs-h2'], [30, '--fs-h1']]),
};
const SELF_TEST_CASES = [
  { name: 'font-size in px in una regola', kind: 'css', expected: 1,
    src: '.card-title { font-size: 18px; }' },
  { name: 'font-size dal token non conta', kind: 'css', expected: 0,
    src: '.card-title { font-size: var(--fs-strong); }' },
  { name: 'colore letterale in una regola', kind: 'css', expected: 1,
    src: '.warn { color: #b45309; }' },
  { name: 'colore dentro :root non conta', kind: 'css', expected: 0,
    src: ':root { --accent: hsl(207, 88%, 39%); }' },
  // Il guasto del 2026-08-09: il commento di testata finiva nel selettore e
  // «/* … */ :root» non era più :root — 34 token segnalati come fuori posto.
  { name: ':root preceduto da un commento resta :root', kind: 'css', expected: 0,
    src: '/* testata\n   su più righe */\n:root { --accent: hsl(207, 88%, 39%); --card: #ffffff; }' },
  { name: 'regola preceduta da un commento: il colore conta comunque', kind: 'css', expected: 1,
    src: '/* nota */ .x { color: #c00; }' },
  { name: 'colore in :root del tema scuro non conta', kind: 'css', expected: 0,
    src: '@media (prefers-color-scheme: dark) { :root { --bg: hsl(213, 30%, 6%); } }' },
  { name: 'colore in :root della stampa non conta', kind: 'css', expected: 0,
    src: '@media print { :root { --bg: #ffffff; } }' },
  { name: 'token locale con colore fuori da :root conta', kind: 'css', expected: 1,
    src: '.panel { --line-local: #eee; }' },
  { name: 'padding sul gradino, ma scritto in px', kind: 'css', expected: 1,
    src: '.card { padding: 16px; }' },
  { name: 'shorthand: ogni px conta per sé', kind: 'css', expected: 2,
    src: '.card { padding: 4px 18px; }' },
  { name: 'gap fuori scala', kind: 'css', expected: 1,
    src: '.row { gap: 10px; }' },
  { name: 'spaziatura dai token non conta', kind: 'css', expected: 0,
    src: '.card { padding: var(--sp-4) var(--sp-2); margin: 0 auto; }' },
  { name: 'la @media non è una dichiarazione', kind: 'css', expected: 0,
    src: '@media (max-width: 640px) { .g { display: grid; } }' },
  // La trappola della regola 5: il nome somiglia a «tag», il contenuto è pulito.
  // Se questo caso segnala, il rilevatore sta guardando i nomi — ed è vietato.
  { name: 'un selettore .price-tag pulito non conta (regola 5)', kind: 'css', expected: 0,
    src: '.price-tag { font-size: var(--fs-h1); padding: var(--sp-2); }' },
  { name: 'border-width non è spaziatura', kind: 'css', expected: 0,
    src: '.box { border: 1px solid var(--line); }' },
  { name: 'margine negativo conta', kind: 'css', expected: 1,
    src: '.pull { margin-top: -6px; }' },

  { name: 'inline: margine numerico', kind: 'tsx', expected: 1,
    src: 'const x = <div style={{ marginTop: 8 }} />;' },
  { name: 'inline: margin: 0 è statico e conta', kind: 'tsx', expected: 1,
    src: 'const x = <div className="field" style={{ margin: 0 }} />;' },
  { name: 'inline: ternario con numeri scritti a mano conta', kind: 'tsx', expected: 1,
    src: 'const x = <div style={{ marginTop: deep ? 14 : 0 }} />;' },
  { name: 'inline: bordo con rgba conta una volta sola', kind: 'tsx', expected: 1,
    src: "const x = <div style={{ borderTop: '1px solid rgba(127,127,127,0.15)' }} />;" },
  { name: 'inline: colore esadecimale', kind: 'tsx', expected: 1,
    src: "const x = <span style={{ color: '#c00' }} />;" },
  { name: 'inline: larghezza dinamica della barra non conta', kind: 'tsx', expected: 0,
    src: 'const x = <div style={{ width: `${pct}%` }} />;' },
  { name: 'inline: colore dal token non conta', kind: 'tsx', expected: 0,
    src: "const x = <i style={{ background: ok ? 'var(--green-fill)' : 'var(--track)' }} />;" },
  { name: 'inline: spaziatura dal token non conta', kind: 'tsx', expected: 0,
    src: "const x = <div style={{ marginTop: 'var(--sp-2)' }} />;" },
  { name: 'inline: flex e minWidth sono layout, non contano', kind: 'tsx', expected: 0,
    src: 'const x = <div style={{ flex: 1, minWidth: 200 }} />;' },
  { name: 'inline: oggetto su più righe con commento e apostrofo', kind: 'tsx', expected: 1,
    src: `const x = <div style={{
      // l'allineamento qui è un dettaglio
      gap: 6,
      alignItems: 'center',
    }} />;` },
  { name: 'inline: style={variabile} si giudica alla fonte', kind: 'tsx', expected: 0,
    src: 'const x = <div style={barStyle} />;' },
];

function runDetector(testCase) {
  return testCase.kind === 'css'
    ? scanCss('fixture.css', testCase.src, FIXTURE_TOKENS)
    : scanTsx('fixture.tsx', testCase.src);
}

function selfTest(verbose) {
  const failures = [];
  for (const c of SELF_TEST_CASES) {
    const found = runDetector(c).length;
    const ok = found === c.expected;
    if (!ok) failures.push(c);
    if (verbose) console.log(`  ${ok ? '✓' : '✗'} ${c.name} — attese ${c.expected}, trovate ${found}`);
  }
  // Il meccanismo delle eccezioni si prova sui tre esiti: consumata, morta,
  // e conteggio sbagliato. Un'eccezione che silenzia più del dichiarato è il
  // fallback silenzioso che questo repository vieta.
  const vHits = scanCss('fixture.css', '.a { gap: 10px; } .b { gap: 10px; }', FIXTURE_TOKENS);
  const exUsed = applyExceptions(vHits, [{ file: 'fixture.css', contesto: '.a', frammento: 'gap: 10px', motivo: 'prova' }]);
  const okUsed = exUsed.remaining.length === 1 && exUsed.dead.length === 0;
  if (verbose) console.log(`  ${okUsed ? '✓' : '✗'} eccezione: consuma solo la sua occorrenza`);
  if (!okUsed) failures.push({ name: 'eccezione: consumo singolo' });
  const exDead = applyExceptions([], [{ file: 'fixture.css', contesto: '.a', frammento: 'gap: 10px', motivo: 'prova' }]);
  const okDead = exDead.dead.length === 1;
  if (verbose) console.log(`  ${okDead ? '✓' : '✗'} eccezione morta: rilevata`);
  if (!okDead) failures.push({ name: 'eccezione morta' });
  const exCount = applyExceptions(vHits, [{ file: 'fixture.css', contesto: '.a', frammento: 'gap: 10px', motivo: 'prova', occorrenze: 2 }]);
  const okCount = exCount.dead.length === 1 && exCount.remaining.length === 1;
  if (verbose) console.log(`  ${okCount ? '✓' : '✗'} eccezione con conteggio sbagliato: non silenzia l'altra riga`);
  if (!okCount) failures.push({ name: 'eccezione a conteggio esatto' });
  return failures;
}

// ---------------------------------------------------------------------------
// Esecuzione
// ---------------------------------------------------------------------------
const argv = process.argv.slice(2);
if (argv.includes('--self-test')) {
  console.log('\nAutoverifica del rilevatore\n');
  const failures = selfTest(true);
  if (failures.length) {
    console.error(`\n  ${failures.length} casi non superati: il rilevatore NON è affidabile.\n`);
    process.exit(1);
  }
  console.log('\n  Tutti i casi superati.\n');
  process.exit(0);
}

// L'autoverifica gira SEMPRE prima della scansione: se il rilevatore è rotto,
// il suo verde non significa niente e non va nemmeno stampato.
const silentFailures = selfTest(false);
if (silentFailures.length) {
  console.error('\n✗ Il rilevatore non supera la propria autoverifica:');
  for (const c of silentFailures) console.error(`    ${c.name}`);
  console.error('  Esegui: npm run design:lint -- --self-test\n');
  process.exit(1);
}

const tokens = readTokens(readFileSync(join(CSS_ROOT, 'app.css'), 'utf8'));

// ⚠️ UN SOLO WALK, RICORSIVO, E ANCHE PER I CSS. Fino al 2026-08-13 i fogli di
// stile si leggevano con un `readdirSync` piatto su src/styles: un CSS in una
// sottocartella — o in qualunque altro punto di src/ — sfuggiva al lint intero,
// provato con un `color: #c00` in src/styles/temi/ che usciva verde. Ora ogni
// `.css` sotto src/ viene lintato ovunque stia: non esiste un «fuori
// perimetro» da sorvegliare.
const cssFiles = [];
const tsxFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.tsx')) tsxFiles.push(p);
    else if (name.endsWith('.css')) cssFiles.push(p);
  }
})(TSX_ROOT);

let all = [];
for (const f of cssFiles) all = all.concat(scanCss(relative('.', f), readFileSync(f, 'utf8'), tokens));
for (const f of tsxFiles) all = all.concat(scanTsx(relative('.', f), readFileSync(f, 'utf8')));

const { remaining, dead } = applyExceptions(all, EXCEPTIONS);

const report = argv.includes('--report');
const byCat = new Map();
const byFile = new Map();
for (const h of remaining) {
  byCat.set(h.cat, (byCat.get(h.cat) ?? 0) + 1);
  byFile.set(h.file, (byFile.get(h.file) ?? 0) + 1);
}
const offScale = remaining.filter((h) => h.cat === 'spaziatura' && !h.note.startsWith('coincide')).length;
const beyond = remaining.filter((h) => h.note.includes('OLTRE 4px')).length;

console.log('\nLint del sistema di design — regola 1: nessun valore scritto a mano');
console.log(`(rilevatore verificato su ${SELF_TEST_CASES.length + 3} casi noti; eccezioni dichiarate: ${EXCEPTIONS.length})\n`);

if (dead.length) {
  console.error('  ✗ ECCEZIONI MORTE — dichiarate ma senza riscontro nel codice: vanno tolte, non dimenticate.');
  for (const ex of dead) console.error(`      ${ex.file} · ${ex.contesto} · «${ex.frammento}» — ${ex.motivo}`);
  console.error('');
}

if (!remaining.length && !dead.length) {
  console.log('  Nessuna violazione: misure e colori vengono dai token.\n');
  process.exit(0);
}

if (remaining.length) {
  console.log('  Per categoria:');
  for (const [cat, count] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
    let extra = '';
    if (cat === 'spaziatura') extra = `   (${offScale} fuori scala, di cui ${beyond} oltre 4px dal gradino)`;
    console.log(`    ${cat.padEnd(12)} ${String(count).padStart(4)}${extra}`);
  }
  console.log('\n  Per file:');
  for (const [file, count] of [...byFile.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`    ${String(count).padStart(4)}  ${file}`);
  }
  if (report) {
    console.log('\n  Riga per riga:');
    for (const h of remaining.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
      console.log(`    ${h.file}:${h.line}  [${h.cat}] ${h.ctx} — ${h.decl}`);
      console.log(`          ${h.note}`);
    }
  } else {
    console.log('\n  Con --report: l\'elenco riga per riga, con il gradino più vicino accanto.');
  }
  console.log(`\n  ${remaining.length} violazioni in ${byFile.size} file.\n`);
}
process.exit(1);
