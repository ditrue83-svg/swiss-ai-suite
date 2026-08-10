#!/usr/bin/env node
// ============================================================================
// fonts:check — i caratteri serviti sono quelli che crediamo, e coprono il testo
// che mostriamo.
//   npm run fonts:check
//   npm run fonts:check -- --self-test
//
// ⚠️⚠️ PERCHÉ ESISTE, e la data conta. Il 2026-08-10, passando dal carattere di
// sistema a Inter ospitato in proprio, il primo candidato era il sottoinsieme
// «latin» di Google (via @fontsource/inter): 24 KB, il file che quasi tutti
// usano. NON contiene U+202F, lo spazio fine insecabile che TUTTA l'interfaccia
// francese usa davanti a : ; ! ? e dentro i guillemets — e che
// `i18n:typography` impone da settimane. Ogni etichetta francese avrebbe avuto
// quel carattere disegnato da un altro font: un buco invisibile in revisione,
// visibile solo a schermo e solo se si guarda il francese.
//
// Il difetto non stava nel codice: stava DENTRO un file binario, dove nessuna
// rilettura arriva. Questo controllo porta lì la stessa domanda che il resto
// del progetto fa al codice — «l'hai provato, o l'hai dedotto?».
//
// LE TRE DOMANDE
//   1. INTEGRITÀ  i tre .woff2 sono ancora i byte che sono stati verificati?
//                 Le impronte sono fissate qui: sostituire un file senza
//                 accorgersene fa fallire il controllo. (E se si rigenerano
//                 davvero, `public/_headers` spiega perché vanno RINOMINATI.)
//   2. COPERTURA  ogni carattere che i dizionari mostrano a schermo sta dentro
//                 la gamma che il sottoinsieme dichiara? È la domanda che
//                 avrebbe fermato U+202F, e che fermerà la traduzione futura
//                 che introduce un carattere nuovo.
//   3. CABLAGGIO  il @font-face e il preload puntano a file che esistono, e ai
//                 pesi che il CSS dichiara — né uno di più né uno di meno.
//
// COSA NON GUARDA, DICHIARATO. Il testo che scrivono i CLIENTI: nomi di
// azienda, titoli di documento, testo dei contratti. Può contenere qualunque
// cosa, e ciò che il sottoinsieme non ha lo disegna il carattere di sistema —
// che è il comportamento voluto, non un ripiego. Qui si controlla ciò che
// scriviamo NOI.
//
// Come si rigenerano i file (serve python3 con fontTools, che NON è nella
// catena di questo repository: i file sono committati apposta):
//   npm pack inter-ui@4.1.1 && tar -xzf inter-ui-4.1.1.tgz
//   python3 -m fontTools.subset package/web/Inter-Regular.woff2 \
//     --unicodes="<la gamma qui sotto>" \
//     --layout-features+=tnum,zero,frac,case \
//     --flavor=woff2 --output-file=inter-400.woff2
//   (Medium → 500, SemiBold → 600.)
// ⚠️ `--layout-features+=tnum` con il PIÙ prima dell'uguale. Scrivendo
// `--layout-features="+tnum"` la funzione viene scartata in silenzio: il primo
// giro di questo lavoro ha prodotto file senza cifre tabulari, e il file
// sembrava a posto. Verificato riaprendo i .woff2, non fidandosi del comando.
// ============================================================================
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';

// ---------------------------------------------------------------------------
// 1. I FILE, con la loro impronta.
// ---------------------------------------------------------------------------
export const CARATTERI = [
  { peso: 400, file: 'public/fonts/inter-400.woff2', sha256: 'edecd01198efa14809a24d46681653a243f3d0fb6753bc4714864993e371cdfb' },
  { peso: 500, file: 'public/fonts/inter-500.woff2', sha256: 'e4dab64ea243f32b6588a75a16ec30275a57e5ef6d24b41d9b59b0831fd266c3' },
  { peso: 600, file: 'public/fonts/inter-600.woff2', sha256: '8847a7369472e5597c597016825ad401d5da51f1c42650ca15b570e323ac41ae' },
];

/** Il peso PRECARICATO in index.html: uno solo, ed è il corpo del testo. */
const PESO_PRECARICATO = 400;

// ---------------------------------------------------------------------------
// 2. LA GAMMA del sottoinsieme — la stessa passata al subsetter, in forma di
//    dato. Non è una copia da tenere allineata a mano: è LA definizione, e la
//    riga del comando qui sopra la cita.
// ---------------------------------------------------------------------------
export const GAMMA = [
  [0x0000, 0x00FF], [0x0100, 0x017F], [0x0192, 0x0192], [0x02C6, 0x02C6],
  [0x02DC, 0x02DC], [0x2000, 0x206F], [0x20A0, 0x20BF], [0x2122, 0x2122],
  [0x2190, 0x2193], [0x2202, 0x2202], [0x2206, 0x2206], [0x220F, 0x220F],
  [0x2211, 0x2212], [0x2215, 0x2215], [0x2219, 0x221A], [0x221E, 0x221E],
  [0x222B, 0x222B], [0x2248, 0x2248], [0x2260, 0x2261], [0x2264, 0x2265],
  [0x25CA, 0x25CA], [0xFB01, 0xFB02], [0xFEFF, 0xFEFF], [0xFFFD, 0xFFFD],
];

/**
 * I caratteri che LASCIAMO al ripiego, di proposito, ciascuno con la ragione.
 *
 * ⚠️ Non è una scappatoia: un'emoji disegnata da Inter sarebbe un contorno
 * monocromatico storto: quel segno lo deve fare il carattere emoji del sistema,
 * a colori, come in ogni altra applicazione. Una riga qui è una decisione; un
 * carattere che non compare né qui né nella gamma è un difetto.
 */
export const AL_RIPIEGO = {
  0x26A0: '⚠ segnale di avviso: è un’emoji, la disegna il sistema a colori',
  0xFE0F: 'selettore di presentazione emoji, viaggia insieme al segno di avviso',
};

export const dentroGamma = (cp) => GAMMA.some(([a, b]) => cp >= a && cp <= b);

/**
 * Il sorgente senza commenti CSS e HTML.
 *
 * ⚠️ Serve al controllo su Google Fonts, e la prima stesura ci è cascata: la
 * testata di `fonts.css` SPIEGA perché non si carica da fonts.googleapis.com,
 * e il controllo ha letto quella spiegazione come una violazione. È lo stesso
 * difetto che il rilevatore degli import di `test:operations` aveva il mattino
 * dello stesso giorno — un controllo che legge il testo grezzo scambia il
 * discorso su una cosa per la cosa.
 */
export function senzaCommenti(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
}

/** Stringhe letterali in apici singoli — ciò che finisce a schermo. */
const LITERAL = /'((?:[^'\\\n]|\\.)*)'/g;

/** I caratteri di un sorgente che NON sono coperti né dalla gamma né dall'elenco. */
export function scoperti(src) {
  const out = new Map();
  LITERAL.lastIndex = 0;
  let m;
  while ((m = LITERAL.exec(src)) !== null) {
    for (const c of m[1]) {
      const cp = c.codePointAt(0);
      if (dentroGamma(cp) || cp in AL_RIPIEGO) continue;
      if (!out.has(cp)) out.set(cp, m[1].slice(0, 70));
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Autoverifica: metà dei casi DEVE risultare scoperta.
// ---------------------------------------------------------------------------
const CASI = [
  { nome: 'testo italiano normale', src: `const a = 'Già avviato, così';`, scoperti: 0 },
  { nome: 'vocali tedesche e ß', src: `const a = 'Möglicherweise förderfähig, Straße';`, scoperti: 0 },
  { nome: 'accenti francesi e legatura œ', src: `const a = 'Très pertinente, cœur, à';`, scoperti: 0 },
  { nome: '⚠️ lo spazio fine insecabile U+202F — il caso che ha originato il controllo',
    src: `const a = 'Priorité : toutes';`, scoperti: 0 },
  { nome: 'guillemets e trattino lungo', src: `const a = '« citazione » — fine';`, scoperti: 0 },
  { nome: 'freccia e simbolo di euro', src: `const a = 'Progetto → esito, 1 200 €';`, scoperti: 0 },
  { nome: 'l’emoji di avviso è dichiarata al ripiego, non è un buco',
    src: `const a = '⚠️ attenzione';`, scoperti: 0 },
  // I positivi: caratteri che il sottoinsieme NON ha e che nessuno ha dichiarato.
  { nome: '⚠️ un carattere cirillico non dichiarato → scoperto', src: `const a = 'Привет';`, scoperti: 6 },
  { nome: '⚠️ un ideogramma non dichiarato → scoperto', src: `const a = '文書';`, scoperti: 2 },
  { nome: '⚠️ un’emoji NON dichiarata → scoperta', src: `const a = 'fatto 🎉';`, scoperti: 1 },
  // I negativi che contano: il controllo guarda le STRINGHE, non i commenti.
  { nome: 'un commento con un ideogramma non è testo d’interfaccia',
    src: `// il documento 文書 non passa di qui`, scoperti: 0 },
];

/** I casi del riferimento esterno: la prosa che NE PARLA non è un caricamento. */
const CASI_ESTERNI = [
  { nome: '⚠️ un @import vero da Google Fonts → violazione',
    src: `@import url('https://fonts.googleapis.com/css2?family=Inter');`, viola: true },
  { nome: '⚠️ un <link> vero a gstatic → violazione',
    src: `<link rel="preconnect" href="https://fonts.gstatic.com" />`, viola: true },
  { nome: 'un COMMENTO CSS che spiega perché non si usa Google Fonts → nessuna violazione',
    src: `/* niente fonts.googleapis.com: l'informativa lo vieta */\n@font-face { src: url('/fonts/a.woff2'); }`,
    viola: false },
  { nome: 'un COMMENTO HTML che nomina gstatic → nessuna violazione',
    src: `<!-- mai da fonts.gstatic.com -->\n<link rel="preload" href="/fonts/a.woff2" />`, viola: false },
];

const citaGoogleFonts = (src) => /fonts\.googleapis|fonts\.gstatic/.test(senzaCommenti(src));

function autoverifica() {
  return [
    ...CASI.map((c) => ({ ...c, ok: scoperti(c.src).size === c.scoperti })),
    ...CASI_ESTERNI.map((c) => ({ ...c, ok: citaGoogleFonts(c.src) === c.viola })),
  ];
}

// ---------------------------------------------------------------------------
const esiti = autoverifica();
const rotti = esiti.filter((e) => !e.ok);
if (rotti.length) {
  console.error(`\n  ${R}✗ Autoverifica FALLITA${X}: il rilevatore non riconosce i propri casi noti.`);
  for (const c of rotti) {
    const dettaglio = 'viola' in c
      ? `atteso ${c.viola ? 'violazione' : 'nessuna violazione'}`
      : `attesi ${c.scoperti}, trovati ${scoperti(c.src).size}`;
    console.error(`    ${c.nome} — ${dettaglio}`);
  }
  console.error('  Un controllo che non supera i propri casi non può dare un verde.\n');
  process.exit(1);
}
if (process.argv.includes('--self-test')) {
  console.log(`\n  ${G}✓${X} Autoverifica superata: ${esiti.length} casi (positivi e negativi).\n`);
  process.exit(0);
}

console.log(`\n${B}Caratteri — i file serviti e ciò che devono coprire${X}`);
console.log(`${DIM}(rilevatore verificato su ${esiti.length} casi noti)${X}\n`);

const problemi = [];

// --- 1. Integrità -----------------------------------------------------------
for (const c of CARATTERI) {
  const percorso = resolve(ROOT, c.file);
  if (!existsSync(percorso)) {
    problemi.push(`${c.file} NON ESISTE: il @font-face punta nel vuoto e il peso ${c.peso} cadrebbe sul ripiego`);
    continue;
  }
  const impronta = createHash('sha256').update(readFileSync(percorso)).digest('hex');
  if (impronta !== c.sha256) {
    problemi.push(`${c.file} è cambiato — atteso ${c.sha256.slice(0, 16)}…, trovato ${impronta.slice(0, 16)}…\n`
      + '      Se il cambio è voluto: RINOMINA il file (public/_headers dice perché) e aggiorna l’impronta qui.');
  }
}

// --- 2. Copertura -----------------------------------------------------------
const DIZIONARI = ['it', 'de', 'fr'].map((l) => `src/i18n/locales/${l}.ts`).concat('src/i18n/labels.ts');
for (const rel of DIZIONARI) {
  const percorso = resolve(ROOT, rel);
  if (!existsSync(percorso)) { problemi.push(`${rel} non trovato`); continue; }
  const mancanti = scoperti(readFileSync(percorso, 'utf8'));
  for (const [cp, esempio] of mancanti) {
    problemi.push(`${rel}: U+${cp.toString(16).toUpperCase().padStart(4, '0')} «${String.fromCodePoint(cp)}» `
      + `non è nel sottoinsieme — es. «${esempio}»\n`
      + '      Lo disegnerebbe un altro carattere. Allarga la gamma e rigenera, '
      + 'oppure dichiaralo in AL_RIPIEGO con la ragione.');
  }
}

// --- 3. Cablaggio -----------------------------------------------------------
const css = readFileSync(resolve(ROOT, 'src/styles/fonts.css'), 'utf8');
const html = readFileSync(resolve(ROOT, 'index.html'), 'utf8');

const pesiDichiarati = [...css.matchAll(/font-weight:\s*(\d{3})/g)].map((m) => Number(m[1])).sort();
const pesiAttesi = CARATTERI.map((c) => c.peso).sort();
if (JSON.stringify(pesiDichiarati) !== JSON.stringify(pesiAttesi)) {
  problemi.push(`fonts.css dichiara i pesi ${pesiDichiarati.join(', ')}, i file sono ${pesiAttesi.join(', ')}`);
}
for (const c of CARATTERI) {
  const url = `/${c.file.replace(/^public\//, '')}`;
  if (!css.includes(url)) problemi.push(`fonts.css non cita ${url}: quel file non lo carica nessuno`);
}
const precaricati = [...html.matchAll(/rel="preload"[^>]*href="(\/fonts\/[^"]+)"/g)].map((m) => m[1]);
const attesoPreload = `/fonts/inter-${PESO_PRECARICATO}.woff2`;
if (JSON.stringify(precaricati) !== JSON.stringify([attesoPreload])) {
  problemi.push(`index.html precarica ${precaricati.length ? precaricati.join(', ') : 'niente'}, `
    + `atteso il solo ${attesoPreload}`);
}
if (!/rel="preload"[^>]*crossorigin/s.test(html)) {
  problemi.push('il preload del carattere non ha `crossorigin`: senza, il browser scarica il file DUE volte');
}
if (citaGoogleFonts(html + css)) {
  problemi.push('c’è un riferimento a Google Fonts: l’informativa dichiara che non si caricano risorse esterne');
}

if (problemi.length === 0) {
  const kb = CARATTERI.reduce((n, c) => n + readFileSync(resolve(ROOT, c.file)).length, 0) / 1024;
  console.log(`  ${G}Nessun problema${X}: ${CARATTERI.length} pesi (${kb.toFixed(0)} KB in tutto, `
    + `precaricato il solo ${PESO_PRECARICATO}), impronte corrispondenti,`);
  console.log('  e ogni carattere dei dizionari sta nel sottoinsieme o è dichiarato al ripiego.\n');
  console.log(`  ${DIM}⚠️ Questo controllo NON sa che aspetto abbia il testo a schermo: quello`);
  console.log(`  si guarda, in tre lingue.${X}\n`);
  process.exit(0);
}

console.error(`  ${R}${problemi.length} problemi:${X}\n`);
for (const p of problemi) console.error(`    ${R}✗${X} ${p}`);
console.error('');
process.exit(1);
