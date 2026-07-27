// ============================================================================
// Copertura i18n: nessun testo d'interfaccia scritto a mano nel codice.
//   npm run i18n:coverage
//   npm run i18n:coverage -- src/features/admin-ai   (limita a un percorso)
//   npm run i18n:coverage -- --list                  (elenca sempre le voci)
//
// STORIA DI DUE GUASTI, ENTRAMBI DELLO STESSO TIPO
//
// 1) La PRIMA versione cercava PAROLE ITALIANE, con una lista di articoli e
//    verbi al singolare. Dichiarava «nessuna stringa da tradurre» mentre un
//    centinaio di etichette erano in italiano: quasi tutte al plurale, e quindi
//    invisibili a quella lista.
//
// 2) La SECONDA versione — quella che avrebbe dovuto risolvere — cercava il
//    testo fra i tag JSX dopo aver «annullato» il contenuto delle graffe. Ma
//    trattava come graffa JSX OGNI `{`, comprese quelle che delimitano il corpo
//    di una funzione. Siccome tutto il JSX vive dentro una funzione, l'intero
//    file veniva annullato e il controllo non guardava nulla. Verificato il
//    2026-07-26 su un file composto ESCLUSIVAMENTE da testo scritto a mano:
//    usciva «Nessuno: tutto il testo passa dai dizionari».
//
// Le due versioni sono fallite per la stessa ragione: nessuno aveva provato il
// controllo su un caso che doveva far fallire. Un controllo che dice verde
// quando non lo è vale meno di nessun controllo, perché dà la certezza che il
// lavoro sia finito. Per questo ora c'è `--self-test`, che esegue il rilevatore
// su casi noti — positivi E negativi — e fallisce se non li riconosce:
//    npm run i18n:coverage -- --self-test
//
// COME FUNZIONA ADESSO
// Un piccolo automa percorre il file distinguendo davvero il codice dal JSX:
// riconosce l'apertura di un tag, ne salta gli attributi, entra fra i figli,
// e sospende la raccolta quando incontra `{…}` (che è codice) riprendendola
// alla chiusura. Le graffe di una funzione non aprono nulla, perché in quel
// punto non si è dentro un elemento JSX.
//
// Segnala:
//   1. testo fra i tag JSX:            <div>Azioni da completare</div>
//   2. attributi che l'utente legge:   placeholder, aria-label, title, alt, label
//   3. testo passato a showToast(…)
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, basename } from 'node:path';

const ROOT = 'src';
const SKIP_DIRS = new Set(['i18n']);          // i dizionari SONO testo, per definizione
const SKIP_FILES = new Set([
  'Icon.tsx',      // tracciati SVG, non testo
  'engine.ts',     // motore locale: nomi di enti e chiavi di riconoscimento (dati di dominio)
  'programs.ts',   // dataset dei programmi di incentivo
]);

// Testi uguali in italiano, tedesco e francese: sigle, unità, simboli, segni.
// Tutto ciò che non è in questa lista deve passare dai dizionari.
const SAME_IN_EVERY_LANGUAGE = new Set([
  'PDF', 'IMG', 'EMAIL', 'TXT', 'CHF', 'AI', 'OCR', 'IDI', 'UID', 'CHE', 'IVA', 'AVS', 'AI-Swisse',
  'Admin AI', 'Subsidy AI', 'Inbox', 'Zefix', 'Email', 'E-Mail', 'Password', 'Google', 'Microsoft',
  '—', '·', '×', '→', '←', '%', ':', '/', '(', ')', '«', '»', '&nbsp;', '&amp;', '&middot;',
  '?', '!', '.', ',', '-', '+', '{', '}', '…',
]);

/** Testo che l'utente leggerebbe: almeno una lettera, e non solo simboli. */
function isUserText(s) {
  const t = s.trim();
  if (!t || !/\p{L}/u.test(t)) return false;
  if (SAME_IN_EVERY_LANGUAGE.has(t)) return false;
  const words = t.split(/\s+/);
  if (words.every((w) => SAME_IN_EVERY_LANGUAGE.has(w))) return false;
  return true;
}

// Un `<` è l'inizio di un tag JSX solo se NON segue un identificatore: così
// `Record<string, X>`, `useState<Foo>()` e `a < b` restano quello che sono.
// Dentro i figli di un elemento la regola non serve — là un `<Tag` è sempre un
// tag — ed è proprio la distinzione che mancava alla versione precedente.
const IDENT_END = /[A-Za-z0-9_$)\]]/;

/**
 * Testo JSX di un sorgente. Ritorna [{ index, text }].
 * L'automa tiene una pila di contesti: `jsx` quando si è fra i figli di un
 * elemento, `brace` per ogni graffa aperta. In cima alla pila c'è `jsx` solo
 * quando il testo che segue finirà davvero sullo schermo.
 */
export function scanJsxText(src) {
  const hits = [];
  const stack = [];
  let i = 0;
  const n = src.length;
  let buf = '';
  let bufStart = 0;

  const inChildren = () => stack.length > 0 && stack[stack.length - 1] === 'jsx';
  const flush = () => {
    if (buf && isUserText(buf)) hits.push({ index: bufStart, text: buf.trim() });
    buf = '';
  };
  const prevMeaningful = (at) => {
    let k = at - 1;
    while (k >= 0 && /\s/.test(src[k])) k--;
    return k >= 0 ? src[k] : '';
  };

  /** Legge un tag di apertura a partire da `at`; ritorna l'indice dopo il `>`. */
  const readOpenTag = (at) => {
    let k = at + 1;
    let selfClosing = false;
    let depth = 0;
    while (k < n) {
      const ch = src[k];
      // ⚠️ I COMMENTI VANNO SALTATI PRIMA DELLE VIRGOLETTE, e non è un dettaglio.
      // Un attributo può contenere un'espressione su più righe con dentro un
      // commento, e un commento italiano contiene apostrofi: senza questo
      // controllo, `// l'etichetta` apriva una stringa che si chiudeva molto
      // più avanti, dentro un'altra istruzione. Da lì in poi il conteggio delle
      // graffe era sfasato, il `>` di chiusura non veniva riconosciuto e
      // l'automa restava convinto di trovarsi fra i figli di un elemento —
      // segnalando come «testo d'interfaccia» le righe di commento successive.
      // Trovato il 2026-07-27 su CalendarPage.tsx: un falso positivo, quindi
      // meno pericoloso di un falso verde, ma un controllo che segnala il nulla
      // insegna a ignorarlo, ed è così che poi passa quello che conta.
      if (ch === '/' && src[k + 1] === '/') {
        const nl = src.indexOf('\n', k);
        k = nl < 0 ? n : nl + 1;
        continue;
      }
      if (ch === '/' && src[k + 1] === '*') {
        const end = src.indexOf('*/', k + 2);
        k = end < 0 ? n : end + 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === '`') {
        const q = ch; k++;
        while (k < n && src[k] !== q) { if (src[k] === '\\') k++; k++; }
        k++; continue;
      }
      if (ch === '{') { depth++; k++; continue; }
      if (ch === '}') { depth = Math.max(0, depth - 1); k++; continue; }
      if (depth === 0 && ch === '/' && src[k + 1] === '>') { selfClosing = true; k += 2; break; }
      if (depth === 0 && ch === '>') { k++; break; }
      k++;
    }
    return { end: k, selfClosing };
  };

  while (i < n) {
    const c = src[i];

    if (inChildren()) {
      if (c === '<') {
        flush();
        if (src[i + 1] === '/') {                          // chiusura </Tag>
          const gt = src.indexOf('>', i);
          i = gt < 0 ? n : gt + 1;
          stack.pop();
          continue;
        }
        if (/[A-Za-z_$>]/.test(src[i + 1] ?? '')) {         // apertura annidata
          const { end, selfClosing } = readOpenTag(i);
          if (!selfClosing) stack.push('jsx');
          i = end;
          continue;
        }
        // `<` che non apre un tag: è testo (`a < b` in una frase).
        if (!buf) bufStart = i;
        buf += c;
        i++;
        continue;
      }
      if (c === '{') { flush(); stack.push('brace'); i++; continue; }
      if (!buf) bufStart = i;
      buf += c;
      i++;
      continue;
    }

    // ---- modalità codice ----
    const two = src.slice(i, i + 2);
    if (two === '//') { const e = src.indexOf('\n', i); i = e < 0 ? n : e; continue; }
    if (two === '/*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'" || c === '`') {
      let k = i + 1;
      while (k < n && src[k] !== c) { if (src[k] === '\\') k++; k++; }
      i = k + 1; continue;
    }
    if (c === '{') { stack.push('brace'); i++; continue; }
    if (c === '}') { if (stack.length) stack.pop(); i++; continue; }
    if (c === '<' && /[A-Za-z_$>]/.test(src[i + 1] ?? '') && !IDENT_END.test(prevMeaningful(i))) {
      const { end, selfClosing } = readOpenTag(i);
      if (!selfClosing) stack.push('jsx');
      i = end;
      continue;
    }
    i++;
  }
  flush();
  return hits;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Le tre famiglie di controlli su un singolo file. */
export function findHardcodedText(file, src) {
  const hits = [];

  // 1. Testo fra i tag JSX. Solo nei .tsx: in un .ts un `<` è sempre un generico.
  if (file.endsWith('.tsx')) {
    for (const h of scanJsxText(src)) {
      hits.push({ line: lineOf(src, h.index), kind: 'jsx', text: h.text.replace(/\s+/g, ' ').slice(0, 90) });
    }
  }

  // 2. Attributi che l'utente legge, con valore letterale.
  for (const m of src.matchAll(/\b(placeholder|aria-label|title|alt|label)\s*=\s*(["'])([^"'\n]*)\2/g)) {
    if (!isUserText(m[3])) continue;
    hits.push({ line: lineOf(src, m.index), kind: m[1], text: m[3].slice(0, 90) });
  }

  // 3. Messaggi passati a showToast() come letterale.
  for (const m of src.matchAll(/showToast\(\s*(["'])([^"'\n]*)\1/g)) {
    if (!isUserText(m[2])) continue;
    hits.push({ line: lineOf(src, m.index), kind: 'toast', text: m[2].slice(0, 90) });
  }

  return hits.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------
// Autoverifica del rilevatore.
//
// Ogni caso porta il numero di segnalazioni ATTESE. I casi negativi (attese 0)
// contano quanto i positivi: un controllo che segnala tutto è inutilizzabile
// quanto uno che non segnala niente, e finirebbe per essere disattivato.
// ---------------------------------------------------------------------------
const SELF_TEST_CASES = [
  { name: 'testo JSX dentro una funzione', expected: 1, file: 'a.tsx', src: `
    export function P() {
      return (<div className="x"><span>Azioni da completare</span></div>);
    }` },
  { name: 'testo dopo un elemento auto-chiuso', expected: 1, file: 'a.tsx', src: `
    export function P() {
      return (<button><Icon name="refresh" /> Riprova</button>);
    }` },
  { name: 'testo attorno a un tag inline', expected: 2, file: 'a.tsx', src: `
    export function P() {
      return (<p>Serve a trovare programmi <em>pertinenti</em></p>);
    }` },
  { name: 'testo dentro un ramo condizionale', expected: 1, file: 'a.tsx', src: `
    export function P({ x }: { x: boolean }) {
      return (<div>{x ? <b>Scaduta</b> : null}</div>);
    }` },
  // ⚠️ IL CASO DEL 2026-07-27, e il motivo per cui sembra scritto male.
  //
  // Un commento italiano dentro la lista degli attributi di un tag contiene un
  // apostrofo, e l'apostrofo veniva letto come APERTURA DI STRINGA. Se prima
  // del `>` ne compare un numero pari, l'ultima «stringa» resta aperta e si
  // mangia il `>` del tag: da lì in poi l'automa crede di essere fra i figli di
  // un elemento e segnala come testo d'interfaccia le righe di commento
  // successive. Su `CalendarPage.tsx` bastavano due commenti.
  //
  // Questo frammento NON è prosa scritta a mano: è il riproduttore MINIMO
  // ottenuto per delta debugging dal file vero, verificato contro la versione
  // difettosa (segnala) e contro quella corretta (non segnala). Tre tentativi
  // di riscriverlo «in bello» avevano prodotto casi che non fallivano più
  // nemmeno con il difetto rimesso — cioè test inerti, che sono peggio di
  // nessun test perché suggeriscono una copertura che non c'è.
  //
  // È un caso NEGATIVO, e i casi negativi contano quanto i positivi: un
  // controllo che segnala il nulla insegna a ignorarlo, ed è così che poi passa
  // quello che conta.
  { name: 'apostrofi in commenti dentro un tag (falso positivo del 2026-07-27)', expected: 0, file: 'a.tsx', src: `                <td
                    // l'etichetta, e visivamente è un cerchio pieno (§98).
                      aprire. Su telefono il numero vero sta nell'etichetta
                </td>
// ---- Vista agenda ------------------------------------------------------------
` },
  { name: 'tutto tradotto: nessuna segnalazione', expected: 0, file: 'a.tsx', src: `
    export function P() {
      const t = useT();
      return (<div className="card"><span>{t('archive.title')}</span></div>);
    }` },
  { name: 'generici TypeScript non sono JSX', expected: 0, file: 'a.tsx', src: `
    const m: Record<string, TKey> = {};
    const [v, setV] = useState<Locale>('it');
    function f(a: number, b: number) { return a < b && b > a; }` },
  { name: 'stringhe e commenti non contano', expected: 0, file: 'a.tsx', src: `
    // Questo commento è in italiano e non deve contare
    const s = 'Anche questa stringa non conta di per sé';
    export function P() { return (<div>{s}</div>); }` },
  { name: 'sigle uguali in tutte le lingue', expected: 0, file: 'a.tsx', src: `
    export function P() { return (<span>PDF · CHF</span>); }` },
  { name: 'attributo leggibile scritto a mano', expected: 1, file: 'a.tsx', src: `
    export function P() { return (<input placeholder="Cerca un documento" />); }` },
  { name: 'showToast con letterale', expected: 1, file: 'a.ts', src: `
    function f() { showToast('Documento eliminato'); }` },
];

function runSelfTest() {
  let failed = 0;
  console.log('\nAutoverifica del rilevatore\n');
  for (const testCase of SELF_TEST_CASES) {
    const found = findHardcodedText(testCase.file, testCase.src).length;
    const ok = found === testCase.expected;
    if (!ok) failed++;
    console.log(`  ${ok ? '✓' : '✗'} ${testCase.name} — attese ${testCase.expected}, trovate ${found}`);
  }
  if (failed) {
    console.error(`\n  ${failed} casi non superati: il rilevatore NON è affidabile.\n`);
    process.exit(1);
  }
  console.log('\n  Tutti i casi superati.\n');
  return true;
}

// ---------------------------------------------------------------------------
// Esecuzione
// ---------------------------------------------------------------------------
const selfTestOnly = process.argv.includes('--self-test');
if (selfTestOnly) {
  runSelfTest();
  process.exit(0);
}

// L'autoverifica gira SEMPRE prima della scansione: se il rilevatore è rotto,
// il verde della scansione non significa nulla e non va nemmeno stampato.
const selfTestFailures = SELF_TEST_CASES.filter(
  (c) => findHardcodedText(c.file, c.src).length !== c.expected,
);
if (selfTestFailures.length) {
  console.error('\n✗ Il rilevatore non supera la propria autoverifica:');
  for (const c of selfTestFailures) console.error(`    ${c.name}`);
  console.error('  Esegui: npm run i18n:coverage -- --self-test\n');
  process.exit(1);
}

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p); }
    else if (/\.(tsx|ts)$/.test(name) && !SKIP_FILES.has(basename(name))) files.push(p);
  }
})(ROOT);

const listMode = process.argv.includes('--list');
const filterPath = process.argv.find((a) => a.startsWith('src/'));

const results = [];
for (const file of files) {
  if (filterPath && !file.startsWith(filterPath)) continue;
  const hits = findHardcodedText(file, readFileSync(file, 'utf8'));
  if (hits.length) results.push({ file: relative('.', file), hits });
}

const total = results.reduce((n, r) => n + r.hits.length, 0);
console.log('\nCopertura i18n — testo d\'interfaccia scritto a mano nel codice');
console.log(`(rilevatore verificato su ${SELF_TEST_CASES.length} casi noti)\n`);

if (!total) {
  console.log('  Nessuno: tutto il testo passa dai dizionari.\n');
  process.exit(0);
}

for (const r of results.sort((a, b) => b.hits.length - a.hits.length)) {
  console.log(`  ${r.file}  (${r.hits.length})`);
  if (listMode || total <= 60) {
    for (const h of r.hits) console.log(`    ${String(h.line).padStart(4)}  [${h.kind}] ${h.text}`);
  }
}
console.log(`\n  ${total} da tradurre in ${results.length} file`);
console.log('  Ogni voce va spostata nei tre dizionari e richiamata con t() o translate().\n');
process.exit(1);
