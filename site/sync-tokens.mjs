// ============================================================================
// Estrae i token dell'applicazione e li scrive in tokens.css.
//
//   node sync-tokens.mjs            aggiorna tokens.css
//   node sync-tokens.mjs --check    esce 1 se tokens.css è disallineato
//
// PERCHÉ ESISTE
// La vetrina e l'applicazione sono due basi di codice separate — una è React,
// l'altra sono tre file statici — ma devono avere lo STESSO aspetto: chi arriva
// dal sito e crea un account non deve avere l'impressione di cambiare prodotto.
// I token erano stati copiati a mano, e una copia a mano diverge al primo
// ritocco: era già successo con `theme-color`, rimasto su un blu che l'accento
// dell'app non aveva più.
//
// Qui non si copia: si DERIVA. La fonte è `src/styles/app.css` del progetto
// principale; questo script ne estrae il blocco `:root` e la sua variante per
// il tema scuro, e li riscrive in `tokens.css` con l'indicazione di provenienza.
// `tokens.css` non va modificato a mano: al prossimo `--check` risulterebbe
// disallineato.
//
// Se il progetto principale non è presente (per esempio su un'altra macchina),
// lo script NON inventa nulla e NON tocca `tokens.css`: esce con un errore
// esplicito. La copia già generata resta valida e il fatto viene dichiarato.
// ============================================================================
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const ROOT = dirname(fileURLToPath(import.meta.url));
const APP_CSS = process.env.APP_CSS || join(homedir(), 'swiss-ai-suite-app', 'src', 'styles', 'app.css');
const OUT = join(ROOT, 'tokens.css');
const checkOnly = process.argv.includes('--check');

if (!existsSync(APP_CSS)) {
  console.error(`\n  Sorgente dei token non trovata: ${APP_CSS}`);
  console.error('  tokens.css NON è stato toccato: la copia esistente resta quella dell\'ultima sincronizzazione.');
  console.error('  Indicare il percorso con APP_CSS=... se il progetto sta altrove.\n');
  process.exit(1);
}

const src = readFileSync(APP_CSS, 'utf8');

/** Estrae un blocco `{…}` bilanciato a partire dall'indice della graffa aperta. */
function blockAt(text, openIndex) {
  let depth = 0;
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(openIndex + 1, i);
    }
  }
  throw new Error('graffa non chiusa');
}

/** Il primo `:root { … }` del file: i token del tema chiaro. */
function rootBlock(text) {
  // `^[ \t]*` perché dentro `@media` il selettore è indentato.
  const m = /(^|\n)[ \t]*:root\s*\{/.exec(text);
  if (!m) throw new Error(':root non trovato');
  return blockAt(text, m.index + m[0].length - 1);
}

/** Il `:root` dentro `@media (prefers-color-scheme: dark)`: la variante scura. */
function darkRootBlock(text) {
  const m = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{/.exec(text);
  if (!m) throw new Error('blocco del tema scuro non trovato');
  const inside = blockAt(text, m.index + m[0].length - 1);
  return rootBlock(inside);
}

/**
 * Tiene solo le dichiarazioni di custom property e la famiglia di caratteri,
 * conservando i commenti che le spiegano: sono la ragione dei valori, e senza
 * di essi il file diventa una lista di numeri.
 * Scarta ciò che riguarda solo l'app (per ora `--topbar-h`, che nella vetrina
 * non esiste).
 */
const SOLO_APP = new Set(['--topbar-h']);
function keepTokens(block) {
  const out = [];
  let inComment = false;
  for (const line of block.split('\n')) {
    const code = line.trim();
    // Dentro un commento su più righe si copia tutto fino alla chiusura.
    // Filtrare riga per riga lasciava aperto `/* --- Colore d'azione ---`, e
    // in CSS un commento aperto si chiude al primo `*/` che incontra: si
    // mangiava la dichiarazione di --accent.
    if (inComment) {
      out.push(line);
      if (code.includes('*/')) inComment = false;
      continue;
    }
    if (!code) { out.push(line); continue; }                    // righe vuote: ritmo
    if (code.startsWith('/*')) {
      out.push(line);
      if (!code.includes('*/')) inComment = true;
      continue;
    }
    const prop = /^(--[\w-]+)\s*:/.exec(code);
    if (prop) { if (!SOLO_APP.has(prop[1])) out.push(line); continue; }
    if (/^font-family\s*:/.test(code)) out.push(line);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd();
}

const light = keepTokens(rootBlock(src));
const dark = keepTokens(darkRootBlock(src));

const out = `/* ============================================================================
   GENERATO — non modificare a mano.

   Token estratti da src/styles/app.css dell'applicazione con
   \`node sync-tokens.mjs\`. La vetrina e l'app devono avere lo stesso aspetto:
   chi arriva dal sito e crea un account non deve credere di cambiare prodotto.

   Per aggiornarli: cambiare il valore NELL'APP, poi rilanciare lo script.
   \`node sync-tokens.mjs --check\` dice se questo file è rimasto indietro.

   La documentazione delle scelte sta in docs/design-system.md del progetto
   principale.
   ========================================================================== */
:root {
${light}
}

@media (prefers-color-scheme: dark) {
  :root {
${dark}
  }
}
`;

// Controllo di integrità: un commento rimasto aperto in CSS non è un errore di
// sintassi, è peggio — si chiude al primo `*/` successivo e fa sparire in
// silenzio le dichiarazioni che stanno in mezzo.
const aperti = (out.match(/\/\*/g) || []).length;
const chiusi = (out.match(/\*\//g) || []).length;
if (aperti !== chiusi) {
  console.error(`\n  Estrazione non valida: ${aperti} commenti aperti e ${chiusi} chiusi.`);
  console.error('  tokens.css non è stato scritto.\n');
  process.exit(1);
}
// I token si cercano ovunque nella riga, non a inizio riga: nell'app le
// spaziature stanno tutte su una riga sola (`--sp-1: 4px;  --sp-2: 8px; …`).
// E si cercano DOPO aver tolto i commenti, che è ciò che vede il browser.
const visibile = out.replace(/\/\*[\s\S]*?\*\//g, '');
for (const atteso of ['--accent:', '--ink:', '--fs-body:', '--sp-4:', '--amber-fill:', '--focus:']) {
  if (!visibile.includes(atteso)) {
    console.error(`\n  Estrazione non valida: manca ${atteso}\n`);
    process.exit(1);
  }
}

if (checkOnly) {
  const current = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
  if (current === out) {
    console.log('\n  tokens.css allineato ai token dell\'applicazione.\n');
    process.exit(0);
  }
  console.error('\n  tokens.css è DISALLINEATO rispetto a src/styles/app.css.');
  console.error('  Rilanciare: node sync-tokens.mjs\n');
  process.exit(1);
}

writeFileSync(OUT, out, 'utf8');
const n = (out.match(/^\s*--[\w-]+\s*:/gm) || []).length;
console.log(`\n  tokens.css aggiornato — ${n} token da ${APP_CSS.replace(homedir(), '~')}\n`);
