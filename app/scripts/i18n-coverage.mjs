// ============================================================================
// Copertura i18n: nessun testo d'interfaccia scritto a mano nel codice.
//   npm run i18n:coverage
//   npm run i18n:coverage -- src/features/admin-ai   (limita a un percorso)
//
// PERCHÉ È STATO RISCRITTO (2026-07-26)
// La versione precedente cercava PAROLE ITALIANE nel codice, con una lista di
// articoli e verbi al singolare («documento», «scadenza», «per», «che»).
// Dichiarava «nessuna stringa da tradurre» mentre l'interfaccia aveva un
// centinaio di etichette italiane: quasi tutte al plurale o senza articoli —
// «Azioni da completare», «Documenti da verificare», «Statistiche documenti» —
// e quindi invisibili a quella lista. La dashboard in tedesco era metà in
// italiano con il controllo verde.
//
// Un controllo che dice verde quando non lo è vale meno di nessun controllo:
// dà la falsa certezza che il lavoro sia finito.
//
// COSA CONTROLLA ADESSO
// Non si chiede più «questa stringa è italiana?» — domanda a cui serve un
// vocabolario, e ogni vocabolario ha dei buchi — ma «questo testo passa dai
// dizionari?». Segnala QUALUNQUE testo letterale che finisce sullo schermo:
//   1. testo dentro il JSX:            <div>Azioni da completare</div>
//   2. attributi che l'utente legge:   placeholder, aria-label, title, alt, label
//   3. testo passato a showToast(…)
// Non serve conoscere la lingua: un letterale in quei posti è comunque un
// testo che non seguirà la lingua scelta.
//
// La regola è deterministica, quindi non ha falsi verdi. Ha invece bisogno di
// due eccezioni dichiarate, qui sotto: i simboli (che sono uguali in tutte le
// lingue) e i file che contengono dati di dominio o disegni, non interfaccia.
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
  'Admin AI', 'Subsidy AI', 'Zefix', 'Email', 'E-Mail', 'Password',
  '—', '·', '×', '→', '←', '%', ':', '/', '(', ')', '«', '»', '&nbsp;', '&amp;', '&middot;',
  '?', '!', '.', ',', '-', '+', '{', '}', '…',
]);

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p); }
    else if (/\.(tsx|ts)$/.test(name) && !SKIP_FILES.has(basename(name))) files.push(p);
  }
})(ROOT);

/** Sostituisce commenti e blocchi {…} con spazi, conservando righe e colonne. */
function blank(src) {
  const out = src.split('');
  let i = 0, depth = 0;
  const wipe = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < src.length) {
    const two = src.slice(i, i + 2);
    if (two === '//') { const end = src.indexOf('\n', i); const to = end < 0 ? src.length : end; wipe(i, to); i = to; continue; }
    if (two === '/*') { const end = src.indexOf('*/', i + 2); const to = end < 0 ? src.length : end + 2; wipe(i, to); i = to; continue; }
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const quote = c; let k = i + 1;
      while (k < src.length && src[k] !== quote) { if (src[k] === '\\') k++; k++; }
      i = k + 1; continue;               // le stringhe restano: servono al controllo 2 e 3
    }
    // Espressioni JSX {…}: dentro c'è codice, non testo.
    if (c === '{') { depth++; out[i] = ' '; i++; continue; }
    if (c === '}') { depth = Math.max(0, depth - 1); out[i] = ' '; i++; continue; }
    if (depth > 0 && c !== '\n') out[i] = ' ';
    i++;
  }
  return out.join('');
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Testo che l'utente leggerebbe: almeno una lettera, e non solo simboli. */
function isUserText(s) {
  const t = s.trim();
  if (!t || !/\p{L}/u.test(t)) return false;
  if (SAME_IN_EVERY_LANGUAGE.has(t)) return false;
  // Sequenze di soli simboli e sigle ammesse (es. «PDF · TXT»).
  const words = t.split(/\s+/);
  if (words.every((w) => SAME_IN_EVERY_LANGUAGE.has(w))) return false;
  return true;
}

/**
 * Distingue il testo JSX dai generici di TypeScript: `Promise<string>` e
 * `useState<Foo>(…)` hanno anche loro un `>` seguito da testo e da un `<`.
 * Il testo che l'utente legge non contiene punteggiatura di codice.
 */
function looksLikeCode(s) {
  return /[;=(){}[\]|<>"'`]|=>|\/\/|::/.test(s) || /\w\/\w/.test(s);
}

const listMode = process.argv.includes('--list');
const filterPath = process.argv.find((a) => a.startsWith('src/'));

const results = [];
for (const file of files) {
  if (filterPath && !file.startsWith(filterPath)) continue;
  const src = readFileSync(file, 'utf8');
  const masked = blank(src);
  const hits = [];

  // 1. Testo fra tag JSX, con le espressioni {…} già rimosse. Solo nei .tsx:
  // in un .ts un `>` seguito da testo è sempre un generico.
  if (file.endsWith('.tsx')) {
    for (const m of masked.matchAll(/>([^<>]+)</g)) {
      const text = m[1];
      if (!isUserText(text) || looksLikeCode(text)) continue;
      hits.push({ line: lineOf(masked, m.index), kind: 'jsx', text: text.trim().slice(0, 90) });
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

  if (hits.length) results.push({ file: relative('.', file), hits: hits.sort((a, b) => a.line - b.line) });
}

const total = results.reduce((n, r) => n + r.hits.length, 0);
console.log('\nCopertura i18n — testo d\'interfaccia scritto a mano nel codice\n');

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
