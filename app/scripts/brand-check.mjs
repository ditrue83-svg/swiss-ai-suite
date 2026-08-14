#!/usr/bin/env node
// ============================================================================
// brand:check — il marchio dell'applicazione è quello del titolare, carattere
// per carattere.
//   npm run brand:check
//   npm run brand:check -- --self-test    (solo l'autoverifica del rilevatore)
//
// ⚠️ PERCHÉ ESISTE, e la data conta. Fino al 2026-08-14 lo stesso marchio era
// disegnato in TRE modi diversi nella stessa pagina:
//   · la barra laterale lo RICOMPONEVA in Inter, sul blu d'azione `--accent`;
//   · la favicon portava i contorni veri, ma su un riquadro suo
//     (`14.2 31.9 301.8 301.8`), con gli angoli arrotondati e i numeri
//     riscritti a una cifra decimale, anch'essa su `--accent`;
//   · la vetrina serviva l'artefatto del titolare: `20 20 300 326`, spigoli
//     vivi, `#00AEEF`.
// Tre segni simili non sono un marchio: sono tre. E nessun controllo poteva
// accorgersene, perché `site/` sta in un altro repository e questo albero non
// lo guardava.
//
// CHE COSA CONFRONTA
//   1. i due tracciati di `src/components/ui/brandArt.ts` con quelli di
//      `site/static/logo-ai-swisse.svg`, come STRINGHE: nessuna tolleranza,
//      nessun arrotondamento — un tracciato «quasi uguale» è il modo in cui i
//      tre segni erano nati;
//   2. il documento SVG della favicon in `index.html`, decodificato, con
//      `site/static/favicon.svg`: stesso riquadro, stesso rettangolo, stesso
//      tracciato, stessi colori;
//   3. il colore `--brand` di `app.css` con quello che la vetrina dipinge.
//
// ⚠️ SE LA VETRINA NON È RAGGIUNGIBILE non si inventa un verde: si DICHIARA che
// il confronto non è stato fatto e si esce 0. È la stessa scelta di
// `test:shell-unit` § 3c — nel monorepo (e in CI) la vetrina è sorella dell'app
// e il confronto gira davvero; su una macchina che ha solo l'albero di lavoro
// la riga lo dice invece di fingere. Ciò che NON si fa mai è dire «allineato»
// senza aver letto l'altra sede.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const VERDE = '\x1b[32m', ROSSO = '\x1b[31m', DIM = '\x1b[2m', X = '\x1b[0m';

let falliti = 0;
function check(nome, ok, dettaglio = '') {
  if (ok) { console.log(`  ${VERDE}✓${X} ${nome}`); return; }
  falliti++;
  console.log(`  ${ROSSO}✗ ${nome}${X}`);
  if (dettaglio) console.log(`    ${DIM}${dettaglio}${X}`);
}

/** I due tracciati e il colore del rettangolo, letti da un SVG del marchio. */
export function leggiMarchio(svg) {
  const tracciati = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
  const rect = svg.match(/<rect([^>]*)>/)?.[1] ?? '';
  const campo = rect.match(/fill="([^"]+)"/)?.[1] ?? '';
  const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1] ?? '';
  return { tracciati, campo, viewBox };
}

/** Le due costanti di `brandArt.ts`, come le scrive il generatore. */
export function leggiArte(sorgente) {
  const uno = (nome) => sorgente.match(new RegExp(`${nome}\\s*=\\s*\\n?\\s*'([^']*)'`))?.[1] ?? '';
  return {
    sigla: uno('TRACCIATO_SIGLA'),
    parola: uno('TRACCIATO_PAROLA'),
  };
}

// ---------------------------------------------------------------------------
if (process.argv.includes('--self-test')) {
  console.log('\n  brand:check — autoverifica del rilevatore\n');
  const finto = '<svg viewBox="0 0 10 10"><rect fill="#00AEEF"/><path d="M1 2Z"/><path d="M3 4Z"/></svg>';
  const m = leggiMarchio(finto);
  check('legge i due tracciati', m.tracciati.length === 2 && m.tracciati[0] === 'M1 2Z');
  check('legge il campo del rettangolo', m.campo === '#00AEEF');
  check('legge il riquadro', m.viewBox === '0 0 10 10');
  check('un SVG senza rettangolo non inventa un colore', leggiMarchio('<svg><path d="M0Z"/></svg>').campo === '');
  const arte = leggiArte("export const TRACCIATO_SIGLA =\n  'M1 2Z';\nexport const TRACCIATO_PAROLA =\n  'M3 4Z';\n");
  check('legge le due costanti di brandArt', arte.sigla === 'M1 2Z' && arte.parola === 'M3 4Z');
  check('una costante assente resta vuota, non plausibile', leggiArte('niente').sigla === '');
  console.log(falliti ? `\n  ${ROSSO}${falliti} rossi${X}\n` : `\n  ${VERDE}autoverifica passata${X}\n`);
  process.exit(falliti ? 1 : 0);
}

// ---------------------------------------------------------------------------
console.log('\n  brand:check — il marchio dell\'app è quello della vetrina\n');

const vetrinaDir = [
  join(ROOT, '..', 'site', 'static'),
  join(homedir(), 'swiss-ai-suite-repo', 'site', 'static'),
].find((p) => existsSync(join(p, 'logo-ai-swisse.svg')));

if (!vetrinaDir) {
  console.log(`  ${DIM}! la vetrina non è raggiungibile da questo albero: il confronto NON è stato fatto.`);
  console.log(`    Gira nel monorepo, dove site/ è sorella di app/ — ed è dove gira la CI.${X}\n`);
  process.exit(0);
}
console.log(`  ${DIM}vetrina: ${vetrinaDir}${X}\n`);

const logoVetrina = leggiMarchio(readFileSync(join(vetrinaDir, 'logo-ai-swisse.svg'), 'utf8'));
const arte = leggiArte(readFileSync(join(ROOT, 'src/components/ui/brandArt.ts'), 'utf8'));

check('la vetrina ha due tracciati (sigla e parola)', logoVetrina.tracciati.length === 2,
  `trovati ${logoVetrina.tracciati.length}`);
check('il tracciato della SIGLA è identico a quello della vetrina',
  arte.sigla !== '' && arte.sigla === logoVetrina.tracciati[0],
  'brandArt.ts va rigenerato dall\'artefatto: i contorni non si riscrivono a mano');
check('il tracciato della PAROLA è identico a quello della vetrina',
  arte.parola !== '' && arte.parola === logoVetrina.tracciati[1],
  'brandArt.ts va rigenerato dall\'artefatto: i contorni non si riscrivono a mano');

// --- Il colore -------------------------------------------------------------
const appCss = readFileSync(join(ROOT, 'src/styles/app.css'), 'utf8');
const brand = appCss.match(/--brand:\s*([^;]+);/)?.[1].trim() ?? '';
check('il token --brand è il campo che dipinge la vetrina',
  brand.toLowerCase() === logoVetrina.campo.toLowerCase(),
  `app --brand: ${brand || '(assente)'} · vetrina: ${logoVetrina.campo || '(assente)'}`);

// --- La favicon ------------------------------------------------------------
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
const uri = html.match(/href="data:image\/svg\+xml,([^"]*)"/)?.[1] ?? '';
check('index.html porta una favicon', uri !== '');
if (uri) {
  // Si normalizzano gli spazi e le virgolette: il data: URI usa l'apice
  // singolo perché quello doppio chiuderebbe l'attributo HTML. Tutto il resto
  // — riquadro, misure, tracciato, colori — deve coincidere.
  const norm = (s) => s.replace(/"/g, "'").replace(/>\s+</g, '><').replace(/\s+/g, ' ').trim();
  const daHtml = norm(decodeURIComponent(uri));
  const daVetrina = norm(readFileSync(join(vetrinaDir, 'favicon.svg'), 'utf8'));
  check('la favicon di index.html è quella della vetrina',
    daHtml === daVetrina,
    `html:    ${daHtml.slice(0, 120)}…\n    vetrina: ${daVetrina.slice(0, 120)}…`);
}

console.log(falliti
  ? `\n  ${ROSSO}${falliti} rossi — il marchio dell'app e quello della vetrina non coincidono${X}\n`
  : `\n  ${VERDE}il marchio è uno solo${X}\n`);
process.exit(falliti ? 1 : 0);
