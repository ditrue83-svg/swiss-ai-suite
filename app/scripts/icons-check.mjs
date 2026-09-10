#!/usr/bin/env node
// ============================================================================
// icons:check — le icone della PWA sono quelle che crediamo, della misura che
// dichiariamo, e raggiungibili da manifest e documento.
//   npm run icons:check
//   npm run icons:check -- --self-test
//
// PERCHÉ ESISTE. Fratello di `fonts:check` (2026-08-10): il difetto che conta
// sta DENTRO un binario, dove nessuna rilettura del codice arriva. Qui i
// binari sono PNG: un'icona rigenerata «a occhio» con la sigla sfasata di
// qualche pixel, o una maskable senza margine, non la vede nessuna revisione —
// la vede il telefono del cliente, ritagliata in cerchio dal launcher.
//
// LE CINQUE DOMANDE
//   1. INTEGRITÀ   i quattro PNG sono ancora i byte verificati? (impronte
//                  fissate qui; se si rigenerano, `public/_headers` spiega
//                  perché vanno RINOMINATI.)
//   2. MISURA      le dimensioni dichiarate nel manifest sono quelle vere dei
//                  file? Un «512x512» su un file da 192 è una promessa falsa.
//   3. ZONA SICURA la maskable tiene il segno entro la fascia centrale (80%):
//                  Android la ritaglia in cerchio, ciò che sta fuori si perde.
//   4. OPACITÀ     la touch-icon di Apple non ha alfa: iOS dipingerebbe il
//                  trasparente di NERO, e il blocco del marchio diventerebbe
//                  una mattonella scura con la sigla che galleggia.
//   5. CABLAGGIO   manifest, index.html e _headers puntano ai file che
//                  esistono, né uno di più né uno di meno.
//
// Come si rigenerano le icone (Playwright + Chromium, che NON sono nella
// catena di questo repository: i file sono committati apposta): si renderizza
// il marchio SVG di `site/static/favicon.svg` con `preserveAspectRatio="slice"`
// su un riquadro #37AEEF della misura voluta (82% per la maskable) e si
// fotografa il viewport — lo script di generazione stava in /tmp, i risultati
// sono questi byte e le loro impronte.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PNG } from 'pngjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';

// Il blocco del marchio: ciò che NON è questo colore è «il segno», e per la
// maskable il segno deve stare nella zona sicura.
const BLU_MARCHIO = { r: 0x37, g: 0xae, b: 0xef };

// ---------------------------------------------------------------------------
// 1. I FILE, con la loro impronta e la loro misura.
// ---------------------------------------------------------------------------
export const ICONE = [
  { file: 'public/icons/any-192.png', lato: 192, sha256: 'e82759373b1f8204d23def927a3a7d901d23b965e943cd46c7d769cd27973122' },
  { file: 'public/icons/any-512.png', lato: 512, sha256: 'dbf7de5eb2f9ca096d30e8021978db9b7e22a514e42c2d2472ed15620501dca7' },
  { file: 'public/icons/apple-180.png', lato: 180, sha256: 'c6717218326efa5de986999a4b3a2c0a8f6764532c064c12478bcad48f68dc61' },
  { file: 'public/icons/maskable-512.png', lato: 512, sha256: '94367ed390eee2c3d635e123a6a201f0306f74bc542a11521ee0b66c02deae30' },
];

/** Quale file risponde a quale richiesta — la mappa che il cablaggio deve onorare. */
const MANIFEST_ATTESO = [
  { src: '/icons/any-192.png', sizes: '192x192', purpose: 'any' },
  { src: '/icons/any-512.png', sizes: '512x512', purpose: 'any' },
  { src: '/icons/maskable-512.png', sizes: '512x512', purpose: 'maskable' },
];

/** La fascia centrale in cui il segno deve stare: i launcher ritagliano il resto. */
const ZONA_SICURA = 0.8;

// ---------------------------------------------------------------------------
// Funzioni pure — provate dall'autoverifica prima di giudicare i file veri.
// ---------------------------------------------------------------------------

/** Dimensioni e pixel di un PNG, letti dai byte — non dal nome del file. */
export function leggiPng(buf) {
  const png = PNG.sync.read(buf);
  return { larghezza: png.width, altezza: png.height, dati: png.data };
}

/** Il rettangolo che racchiude i pixel diversi dallo sfondo (e opachi). */
export function bboxDelSegno(png, sfondo = BLU_MARCHIO) {
  const { larghezza: w, altezza: h, dati: d } = png;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 255) continue; // il trasparente non è segno, è sfondo mancante
      if (d[i] === sfondo.r && d[i + 1] === sfondo.g && d[i + 2] === sfondo.b) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** Vero se il segno esce dalla fascia centrale `quota` (0.8 = zona sicura maskable). */
export function fuoriZonaSicura(png, quota = ZONA_SICURA) {
  const bbox = bboxDelSegno(png);
  if (!bbox) return true; // un'icona senza segno è un riquadro vuoto: difetto
  const margineX = (png.larghezza * (1 - quota)) / 2;
  const margineY = (png.altezza * (1 - quota)) / 2;
  return (
    bbox.minX < margineX || bbox.maxX >= png.larghezza - margineX ||
    bbox.minY < margineY || bbox.maxY >= png.altezza - margineY
  );
}

/** Vero se almeno un pixel ha alfa: la touch-icon di Apple deve essere opaca. */
export function haPixelTrasparenti(png) {
  for (let i = 3; i < png.dati.length; i += 4) {
    if (png.dati[i] < 255) return true;
  }
  return false;
}

/** I problemi di cablaggio, dati i tre documenti come TESTO. */
export function problemiCablaggio(manifestSrc, htmlSrc, headersSrc) {
  const problemi = [];
  let manifest;
  try {
    manifest = JSON.parse(manifestSrc);
  } catch {
    return ['manifest.webmanifest non si legge come JSON'];
  }
  const icone = Array.isArray(manifest.icons) ? manifest.icons : [];
  for (const attesa of MANIFEST_ATTESO) {
    const trovata = icone.find(
      (i) => i.src === attesa.src && i.sizes === attesa.sizes && i.purpose === attesa.purpose,
    );
    if (!trovata) {
      problemi.push(`il manifest non dichiara ${attesa.src} (${attesa.sizes}, ${attesa.purpose})`);
    }
  }
  for (const i of icone) {
    if (!MANIFEST_ATTESO.some((a) => a.src === i.src)) {
      problemi.push(`il manifest dichiara ${i.src}, che non è fra i file verificati`);
    }
  }
  for (const campo of ['name', 'short_name', 'start_url', 'display', 'background_color', 'theme_color']) {
    if (!manifest[campo]) problemi.push(`il manifest non ha «${campo}»: l'app non sarebbe installabile`);
  }
  if (manifest.display !== 'standalone') {
    problemi.push(`il manifest ha display «${manifest.display}»: serve «standalone» per la finestra propria`);
  }
  if (!htmlSrc.includes('rel="manifest" href="/manifest.webmanifest"')) {
    problemi.push('index.html non linka il manifest: nessun browser lo scoprirebbe');
  }
  if (!htmlSrc.includes('rel="apple-touch-icon" href="/icons/apple-180.png"')) {
    problemi.push('index.html non linka la touch-icon: iOS ignorerebbe l’icona');
  }
  if (!/^\/icons\/\*/m.test(headersSrc)) {
    problemi.push('_headers non ha il blocco /icons/*: la disciplina di cache non è dichiarata');
  }
  return problemi;
}

// ---------------------------------------------------------------------------
// Autoverifica: i casi che DEVONO fallire devono fallire qui, non in produzione.
// ---------------------------------------------------------------------------
function pngFinto(lato, disegna) {
  const png = new PNG({ width: lato, height: lato });
  for (let i = 0; i < png.data.length; i += 4) {
    png.data[i] = BLU_MARCHIO.r; png.data[i + 1] = BLU_MARCHIO.g;
    png.data[i + 2] = BLU_MARCHIO.b; png.data[i + 3] = 255;
  }
  disegna(png);
  return leggiPng(PNG.sync.write(png));
}
const dipingiPixel = (png, x, y, alfa = 255) => {
  const i = (y * png.width + x) * 4;
  png.data[i] = 255; png.data[i + 1] = 255; png.data[i + 2] = 255; png.data[i + 3] = alfa;
};

function autoverifica() {
  const centrato = pngFinto(100, (p) => { dipingiPixel(p, 50, 50); dipingiPixel(p, 60, 60); });
  const alBordo = pngFinto(100, (p) => dipingiPixel(p, 2, 50));
  const trasparente = pngFinto(100, (p) => dipingiPixel(p, 50, 50, 0));
  const vuota = pngFinto(100, () => {});
  const manifestBuono = JSON.stringify({
    name: 'AI-Swisse', short_name: 'AI-Swisse', start_url: '/', display: 'standalone',
    background_color: '#ffffff', theme_color: '#ffffff',
    icons: MANIFEST_ATTESO.map((a) => ({ ...a, type: 'image/png' })),
  });
  const htmlBuono = '<link rel="manifest" href="/manifest.webmanifest" /><link rel="apple-touch-icon" href="/icons/apple-180.png" />';
  const headersBuono = '/icons/*\n  Cache-Control: public';
  return [
    { nome: 'le dimensioni si leggono dai byte, non dal nome', ok: centrato.larghezza === 100 && centrato.altezza === 100 },
    { nome: 'segno centrato → DENTRO la zona sicura', ok: fuoriZonaSicura(centrato) === false },
    { nome: '⚠️ segno al bordo → FUORI zona sicura', ok: fuoriZonaSicura(alBordo) === true },
    { nome: '⚠️ icona senza segno (riquadro vuoto) → difetto', ok: fuoriZonaSicura(vuota) === true },
    { nome: 'icona opaca → nessun problema di alfa', ok: haPixelTrasparenti(centrato) === false },
    { nome: '⚠️ un pixel con alfa → la touch-icon sarebbe dipinta su nero', ok: haPixelTrasparenti(trasparente) === true },
    { nome: 'cablaggio corretto → zero problemi', ok: problemiCablaggio(manifestBuono, htmlBuono, headersBuono).length === 0 },
    { nome: '⚠️ manifest senza maskable → problema', ok: problemiCablaggio(JSON.stringify({ name: 'x', short_name: 'x', start_url: '/', display: 'standalone', background_color: '#fff', theme_color: '#fff', icons: MANIFEST_ATTESO.filter((a) => a.purpose !== 'maskable') }), htmlBuono, headersBuono).length > 0 },
    { nome: '⚠️ html senza link al manifest → problema', ok: problemiCablaggio(manifestBuono, '<html></html>', headersBuono).length > 0 },
    { nome: '⚠️ display «browser» → problema', ok: problemiCablaggio(manifestBuono.replace('standalone', 'browser'), htmlBuono, headersBuono).length > 0 },
    { nome: '⚠️ JSON rotto → un problema, non un’eccezione', ok: problemiCablaggio('{non json', htmlBuono, headersBuono).length === 1 },
  ];
}

const esiti = autoverifica();
const rotti = esiti.filter((e) => !e.ok);
if (rotti.length) {
  console.error(`\n  ${R}✗ Autoverifica FALLITA${X}: il rilevatore non riconosce i propri casi noti.`);
  for (const c of rotti) console.error(`    ${c.nome}`);
  console.error('  Un controllo che non supera i propri casi non può dare un verde.\n');
  process.exit(1);
}
if (process.argv.includes('--self-test')) {
  console.log(`\n  ${G}✓${X} Autoverifica superata: ${esiti.length} casi (positivi e negativi).\n`);
  process.exit(0);
}

console.log(`\n${B}Icone della PWA — i file serviti e ciò che li cita${X}`);
console.log(`${DIM}(rilevatore verificato su ${esiti.length} casi noti)${X}\n`);

const problemi = [];

// --- 1-2. Integrità e misura ------------------------------------------------
for (const c of ICONE) {
  const percorso = resolve(ROOT, c.file);
  if (!existsSync(percorso)) {
    problemi.push(`${c.file} NON ESISTE: il manifest promette un'icona che non c'è`);
    continue;
  }
  const byte = readFileSync(percorso);
  const impronta = createHash('sha256').update(byte).digest('hex');
  if (impronta !== c.sha256) {
    problemi.push(`${c.file} è cambiato — atteso ${c.sha256.slice(0, 16)}…, trovato ${impronta.slice(0, 16)}…\n`
      + '      Se il cambio è voluto: RINOMINA il file (public/_headers dice perché) e aggiorna l’impronta qui.');
  }
  let png;
  try { png = leggiPng(byte); } catch (e) {
    problemi.push(`${c.file}: il PNG non si legge (${e.message})`);
    continue;
  }
  if (png.larghezza !== c.lato || png.altezza !== c.lato) {
    problemi.push(`${c.file} è ${png.larghezza}×${png.altezza}, atteso ${c.lato}×${c.lato}: `
      + 'la misura nel manifest diventerebbe una promessa falsa');
  }
}

// --- 3-4. Zona sicura e opacità (sui file VERI, non su casi di scuola) ------
const percorso = (nome) => resolve(ROOT, `public/icons/${nome}`);
if (existsSync(percorso('maskable-512.png'))) {
  const png = leggiPng(readFileSync(percorso('maskable-512.png')));
  if (fuoriZonaSicura(png)) {
    problemi.push('maskable-512.png: la sigla esce dalla fascia centrale dell’80% — '
      + 'Android la ritaglierebbe. Rigenerare col riquadro interno all’82%.');
  }
}
if (existsSync(percorso('apple-180.png'))) {
  const png = leggiPng(readFileSync(percorso('apple-180.png')));
  if (haPixelTrasparenti(png)) {
    problemi.push('apple-180.png ha pixel con alfa: iOS li dipingerebbe di nero. Rigenerare su sfondo pieno.');
  }
}

// --- 5. Cablaggio ------------------------------------------------------------
const leggi = (rel) => {
  const p = resolve(ROOT, rel);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
};
const manifest = leggi('public/manifest.webmanifest');
const html = leggi('index.html');
const headers = leggi('public/_headers');
if (!manifest) problemi.push('public/manifest.webmanifest NON ESISTE');
else problemi.push(...problemiCablaggio(manifest, html ?? '', headers ?? ''));

if (problemi.length === 0) {
  const kb = ICONE.reduce((n, c) => n + readFileSync(resolve(ROOT, c.file)).length, 0) / 1024;
  console.log(`  ${G}Nessun problema${X}: ${ICONE.length} icone (${kb.toFixed(1)} KB in tutto), impronte corrispondenti,`);
  console.log('  dimensioni vere come dichiarato, maskable dentro la zona sicura, touch-icon opaca,');
  console.log('  e manifest + index.html + _headers puntano ai file che esistono.\n');
  console.log(`  ${DIM}⚠️ Questo controllo NON vede come rende l'icona su un telefono vero:`);
  console.log(`  quello si guarda dopo l'installazione.${X}\n`);
  process.exit(0);
}

console.error(`  ${R}${problemi.length} problemi:${X}\n`);
for (const p of problemi) console.error(`    ${R}✗${X} ${p}`);
console.error('');
process.exit(1);
