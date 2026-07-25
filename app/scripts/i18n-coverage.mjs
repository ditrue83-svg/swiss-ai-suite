// ============================================================================
// Copertura i18n: quanto dell'interfaccia è ancora scritto in italiano nel codice.
//   npm run i18n:coverage
//   npm run i18n:coverage -- --list src/features/admin-ai   (mostra le stringhe)
//
// Perché serve: un'app tradotta a metà non si vede dal typecheck. I dizionari
// sono completi per costruzione (de/fr sono tipizzati come `Dictionary`, una
// chiave mancante rompe la build), ma nulla impedisce che una stringa resti
// scritta a mano dentro un componente. Questo script le trova e le conta.
//
// Euristica: testo leggibile dentro JSX o fra virgolette, che contenga lettere
// accentate o parole italiane frequenti. Non è un parser: serve a misurare il
// lavoro rimasto e a evitare regressioni, non a certificare la perfezione.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = 'src';
const SKIP_DIRS = new Set(['i18n']);                 // i dizionari SONO italiano, per definizione
const SKIP_FILES = new Set(['engine.ts', 'programs.ts']); // dati di dominio, non UI

// Parole italiane frequenti nelle stringhe d'interfaccia.
const IT_HINTS = /\b(il|lo|la|gli|le|un|una|del|della|dei|delle|che|non|per|con|sul|sulla|nel|nella|questo|questa|sono|è|già|puoi|devi|verifica|documento|azienda|scadenza|analisi|incentiv|riprova|salva|elimina|modifica|carica|inserisci|seleziona)\b/i;

const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { if (!SKIP_DIRS.has(name)) walk(p); }
    else if (/\.(tsx|ts)$/.test(name) && !SKIP_FILES.has(name)) files.push(p);
  }
})(ROOT);

const listMode = process.argv.includes('--list');
const filterPath = process.argv.find((a) => a.startsWith('src/'));

const results = [];
for (const file of files) {
  if (filterPath && !file.startsWith(filterPath)) continue;
  const src = readFileSync(file, 'utf8');
  const hits = [];
  for (const [i, line] of src.split('\n').entries()) {
    const code = line.trim();
    if (code.startsWith('//') || code.startsWith('*') || code.startsWith('/*')) continue;  // commenti
    // Testo fra tag JSX, oppure stringhe quotate lunghe.
    const candidates = [
      ...line.matchAll(/>\s*([A-ZÀ-Ù][^<>{}\n]{8,})\s*</g),
      ...line.matchAll(/(?:placeholder|title|label|aria-label)\s*=\s*["']([^"'\n]{8,})["']/g),
      ...line.matchAll(/["']([A-ZÀ-Ù][^"'\n]{12,})["']/g),
    ].map((m) => m[1].trim());
    for (const c of candidates) {
      if (!IT_HINTS.test(c)) continue;
      if (/^[A-Z_]+$/.test(c)) continue;                       // costanti
      if (c.includes('t(') || c.startsWith('@/')) continue;     // già tradotto / import
      hits.push({ line: i + 1, text: c.slice(0, 90) });
    }
  }
  if (hits.length) results.push({ file: relative('.', file), hits });
}

results.sort((a, b) => b.hits.length - a.hits.length);
const total = results.reduce((n, r) => n + r.hits.length, 0);

console.log(`\nCopertura i18n — stringhe italiane ancora scritte nel codice\n`);
if (!results.length) {
  console.log('  Nessuna stringa da tradurre trovata.\n');
  process.exit(0);
}

// Raggruppa per area, che è come si pianifica il lavoro.
const byArea = new Map();
for (const r of results) {
  const area = r.file.split('/').slice(0, 3).join('/');
  byArea.set(area, (byArea.get(area) ?? 0) + r.hits.length);
}
for (const [area, n] of [...byArea].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(4)}  ${area}`);
}
console.log(`\n  ${total} stringhe in ${results.length} file`);

if (listMode) {
  console.log('');
  for (const r of results) {
    console.log(`\n  ${r.file}`);
    for (const h of r.hits) console.log(`    ${String(h.line).padStart(4)}: ${h.text}`);
  }
}
console.log('');
