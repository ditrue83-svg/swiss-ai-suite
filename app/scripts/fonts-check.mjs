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
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { brotliDecompressSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';
// L'elenco dei dizionari vive in UN posto: il disco, riconciliato con LOCALES.
import { dizionari } from './i18n-locales.mjs';

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
// 2. LA GAMMA CHIESTA AL SUBSETTER — la stessa passata sulla riga di comando.
//
//    ⚠️⚠️ NON È CIÒ CHE I FILE CONTENGONO, e per tre giorni questo file ha
//    scritto il contrario («è LA definizione»). Il subsetter tiene solo i glifi
//    che servono ai caratteri richiesti E che il font sorgente ha: la gamma qui
//    sotto chiede 556 codepoint, i tre .woff2 ne disegnano 445. Centoundici
//    sono chiesti e assenti.
//
//    Finché la copertura si misurava CONTRO QUESTA COSTANTE, un carattere
//    dentro la gamma ma assente dal file passava verde e a schermo lo
//    disegnava un altro carattere tipografico: esattamente il difetto che
//    questo controllo esiste per impedire, con la gamma nel ruolo del
//    testimone che conferma la propria versione. Oggi la copertura si misura
//    aprendo i binari (§2 più sotto): la gamma resta qui perché serve a
//    RIGENERARE i file, non a giudicarli.
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

/** Stringhe letterali — apici singoli, DOPPI e template: ciò che finisce a
 * schermo non dipende dal delimitatore. ⚠️ Fino al 2026-08-13 si guardavano
 * solo gli apici singoli: una stringa in apici doppi sfuggiva INTERA. Latente
 * (i dizionari sono al 100% in apici singoli), ma un controllo appeso a una
 * convenzione di stile non dichiarata muore al primo formatter. */
const LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g;

/** Il testo di un match, con le interpolazioni `${…}` dei template rimosse:
 * sono codice, non testo (le stringhe eventualmente annidate lì dentro non
 * vengono estratte — limite dichiarato, oggi senza casi reali). */
const testoDelLetterale = (m) => (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, '');

/**
 * I caratteri di un sorgente che NESSUNO dei nostri file disegna.
 *
 * `copre` dice che cosa conta come coperto. In esecuzione vera gli si passa la
 * cmap LETTA DAI .woff2 — i glifi che esistono davvero. L'autoverifica gli
 * passa invece `dentroGamma`, perché quei diciotto casi provano l'estrazione
 * delle stringhe (apici, template, commenti), non il contenuto dei binari:
 * mescolare le due cose renderebbe l'autoverifica dipendente da un file che
 * può cambiare, e un caso noto deve restare noto.
 */
export function scoperti(src, copre = dentroGamma) {
  const out = new Map();
  LITERAL.lastIndex = 0;
  let m;
  while ((m = LITERAL.exec(src)) !== null) {
    const testo = testoDelLetterale(m);
    for (const c of testo) {
      const cp = c.codePointAt(0);
      if (copre(cp) || cp in AL_RIPIEGO) continue;
      if (!out.has(cp)) out.set(cp, testo.slice(0, 70));
    }
  }
  return out;
}

/**
 * I codepoint che un .woff2 disegna davvero, letti dalla sua tabella `cmap`.
 *
 * Un woff2 è intestazione + direttorio + UN flusso brotli con tutte le tabelle
 * in fila. `glyf` e `loca` viaggiano trasformate; `cmap` no, quindi si legge
 * direttamente dal flusso decompresso. Si guarda la mappa dei caratteri e non
 * i contorni: la domanda è «questo carattere ha un glifo?», non «che forma ha».
 */
export function codepointsDelFile(percorso) {
  const b = readFileSync(percorso);
  if (b.readUInt32BE(0) !== 0x774f4632) throw new Error(`${percorso}: non è un woff2`);

  const base128 = (buf, pos) => {
    let v = 0;
    for (let i = 0; i < 5; i++) {
      const byte = buf[pos++];
      v = ((v << 7) | (byte & 0x7f)) >>> 0;
      if ((byte & 0x80) === 0) return [v, pos];
    }
    throw new Error('UIntBase128 malformato');
  };

  let p = 48;
  const tavole = [];
  for (let i = 0, n = b.readUInt16BE(12); i < n; i++) {
    const flags = b[p++];
    const idx = flags & 0x3f;
    let tag;
    if (idx === 63) { tag = b.toString('ascii', p, p + 4); p += 4; }
    else tag = TAG_NOTI[idx];
    let lunghezza; [lunghezza, p] = base128(b, p);
    // Versione 0 = trasformata, e solo glyf/loca lo sono: lì la lunghezza nel
    // flusso è un secondo numero.
    if ((tag === 'glyf' || tag === 'loca') && ((flags >> 6) & 3) === 0) {
      [lunghezza, p] = base128(b, p);
    }
    tavole.push({ tag, lunghezza });
  }

  const flusso = brotliDecompressSync(b.subarray(p));
  let off = 0; let cmap = null;
  for (const t of tavole) {
    if (t.tag === 'cmap') cmap = flusso.subarray(off, off + t.lunghezza);
    off += t.lunghezza;
  }
  if (!cmap) throw new Error(`${percorso}: nessuna tabella cmap`);

  const trovati = new Set();
  for (let i = 0, n = cmap.readUInt16BE(2); i < n; i++) {
    const sub = cmap.readUInt32BE(4 + i * 8 + 4);
    const formato = cmap.readUInt16BE(sub);
    if (formato === 4) {
      const segX2 = cmap.readUInt16BE(sub + 6);
      const fine = sub + 14; const inizio = fine + segX2 + 2;
      const delta = inizio + segX2; const rangeOff = delta + segX2;
      for (let s = 0; s < segX2 / 2; s++) {
        const st = cmap.readUInt16BE(inizio + s * 2);
        const en = cmap.readUInt16BE(fine + s * 2);
        if (st === 0xffff) continue;
        const d = cmap.readInt16BE(delta + s * 2);
        const ro = cmap.readUInt16BE(rangeOff + s * 2);
        for (let c = st; c <= en; c++) {
          let g;
          if (ro === 0) g = (c + d) & 0xffff;
          else {
            const gi = rangeOff + s * 2 + ro + (c - st) * 2;
            if (gi + 1 >= cmap.length) continue;
            g = cmap.readUInt16BE(gi);
            if (g !== 0) g = (g + d) & 0xffff;
          }
          if (g !== 0) trovati.add(c);
        }
      }
    } else if (formato === 12) {
      for (let gI = 0, gruppi = cmap.readUInt32BE(sub + 12); gI < gruppi; gI++) {
        const g0 = sub + 16 + gI * 12;
        for (let c = cmap.readUInt32BE(g0), en = cmap.readUInt32BE(g0 + 4); c <= en; c++) trovati.add(c);
      }
    }
  }
  return trovati;
}

/** I tag delle tabelle nell'ordine che il formato woff2 dà per noto. */
const TAG_NOTI = [
  'cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm',
  'glyf', 'loca', 'prep', 'CFF ', 'VORG', 'EBDT', 'EBLC', 'gasp', 'hdmx', 'kern',
  'LTSH', 'PCLT', 'VDMX', 'vhea', 'vmtx', 'BASE', 'GDEF', 'GPOS', 'GSUB', 'EBSC',
  'JSTF', 'MATH', 'CBDT', 'CBLC', 'COLR', 'CPAL', 'SVG ', 'sbix', 'acnt', 'avar',
  'bdat', 'bloc', 'bsln', 'cvar', 'fdsc', 'feat', 'fmtx', 'fvar', 'gvar', 'hsty',
  'just', 'lcar', 'mort', 'morx', 'opbd', 'prop', 'trak', 'Zapf', 'Silf', 'Glat',
  'Gloc', 'Feat', 'Sill',
];

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
  // ⚠️ GLI APICI DOPPI E I TEMPLATE. Fino al 2026-08-13 si guardavano SOLO gli
  // apici singoli: questi due casi, con la regex vecchia, uscivano «0 scoperti»
  // — una stringa intera invisibile per via del delimitatore. Latente (i
  // dizionari sono al 100% in apici singoli), ma un controllo appeso a una
  // convenzione di stile non dichiarata muore al primo formatter.
  { nome: '⚠️ APICI DOPPI: il cirillico non dichiarato si vede anche lì', src: `const a = "Привет";`, scoperti: 6 },
  { nome: '⚠️ TEMPLATE: l’ideogramma nel testo statico si vede', src: 'const a = `doc 文書 ${x}`;', scoperti: 2 },
  { nome: 'l’interpolazione di un template è codice, non testo', src: 'const a = `fatto ${emojiScelta}`;', scoperti: 0 },
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
// ⚠️ L'elenco viene dal disco, riconciliato con LOCALES: fino al 2026-08-13
// era cablato qui («it, de, fr») e una quarta lingua non la guardava nessuno.
// labels.ts non è un locale: è il file delle etichette condivise, e resta.
const DIZIONARI = dizionari().concat('src/i18n/labels.ts');

// La cmap VERA di ogni peso. Si intersecano: un carattere che il 400 disegna e
// il 600 no comparirebbe in grassetto con un altro carattere tipografico, e
// sarebbe più difficile da vedere che se mancasse ovunque.
let copertiDaTutti = null;
const perPeso = [];
for (const c of CARATTERI) {
  const percorso = resolve(ROOT, c.file);
  if (!existsSync(percorso)) continue;
  let insieme;
  try { insieme = codepointsDelFile(percorso); }
  catch (e) {
    problemi.push(`${c.file}: la cmap non si legge (${e.message}). `
      + 'Senza aprire il file, la copertura sarebbe una dichiarazione, non una misura.');
    continue;
  }
  perPeso.push({ peso: c.peso, n: insieme.size });
  copertiDaTutti = copertiDaTutti === null
    ? insieme
    : new Set([...copertiDaTutti].filter((cp) => insieme.has(cp)));
}
if (copertiDaTutti === null) {
  problemi.push('nessun file leggibile: la copertura non è stata misurata');
  copertiDaTutti = new Set();
}
const disallineati = perPeso.filter((p) => p.n !== perPeso[0]?.n);
if (disallineati.length) {
  problemi.push(`i tre pesi non coprono gli stessi caratteri: ${perPeso.map((p) => `${p.peso}→${p.n}`).join(', ')}\n`
    + '      Una parola in grassetto cambierebbe carattere a metà. Rigenerare i tre file con la stessa gamma.');
}

const copre = (cp) => copertiDaTutti.has(cp);
for (const rel of DIZIONARI) {
  const percorso = resolve(ROOT, rel);
  if (!existsSync(percorso)) { problemi.push(`${rel} non trovato`); continue; }
  const mancanti = scoperti(readFileSync(percorso, 'utf8'), copre);
  for (const [cp, esempio] of mancanti) {
    problemi.push(`${rel}: U+${cp.toString(16).toUpperCase().padStart(4, '0')} «${String.fromCodePoint(cp)}» `
      + `NON è disegnato dai file — es. «${esempio}»\n`
      + '      Lo disegnerebbe un altro carattere. Allarga la gamma e RIGENERA i .woff2, '
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

// --- 4. I pesi CHIESTI dai fogli di stile esistono come file? ---------------
// ⚠️ Il difetto che questo controllo chiude, misurato a schermo il 2026-08-13:
// i fogli chiedevano 700 in 48 regole e 800 in 9, ma i file sono 400/500/600.
// Il browser non sintetizza niente — sceglie la faccia più vicina e disegna
// SEISCENTO. `.kpi-value` a 800 e `.kpi-label` a 600 erano lo stesso peso: un
// gradino di gerarchia dichiarato nel codice e inesistente sullo schermo.
// Nessun rosso da nessuna parte, perché nulla confrontava le due liste.
//
// ⚠️ PERIMETRO: TUTTI i `.css` di src/ dal 2026-08-28 (issue #83). Fino ad
// allora si leggevano solo i due globali, ma con la migrazione a CSS Modules
// ogni feature dichiara i propri `font-weight` nel suo foglio: un 700 scritto
// in un modulo sarebbe sfuggito al controllo proprio dove le regole si sono
// spostate. La decisione sorvegliata è la stessa — nessuna regola chiede un
// peso che non esiste come file — cambiato solo dove la si legge.
const PESI_SERVITI = new Set(CARATTERI.map((c) => c.peso));
const fogliDiStile = [];
(function walkCss(dir) {
  for (const nome of readdirSync(dir)) {
    const p = resolve(dir, nome);
    if (statSync(p).isDirectory()) walkCss(p);
    else if (nome.endsWith('.css')) fogliDiStile.push(p);
  }
})(resolve(ROOT, 'src'));
for (const percorso of fogliDiStile) {
  const rel = relative(ROOT, percorso);
  const foglio = senzaCommenti(readFileSync(percorso, 'utf8'));
  const chiesti = new Set([...foglio.matchAll(/font-weight:\s*(\d{3})/g)].map((m) => Number(m[1])));
  for (const peso of [...chiesti].sort((a, b) => a - b)) {
    if (PESI_SERVITI.has(peso)) continue;
    const vicino = [...PESI_SERVITI].reduce((a, b) => (Math.abs(b - peso) < Math.abs(a - peso) ? b : a));
    problemi.push(`${rel} chiede font-weight ${peso}, che non esiste fra i file (${[...PESI_SERVITI].sort().join(', ')})\n`
      + `      Il browser disegnerebbe ${vicino}: il peso dichiarato non è quello reso. `
      + 'Portare la regola a un peso servito, oppure aggiungere il file — e allora anche a CARATTERI.');
  }
}

if (problemi.length === 0) {
  const kb = CARATTERI.reduce((n, c) => n + readFileSync(resolve(ROOT, c.file)).length, 0) / 1024;
  console.log(`  ${G}Nessun problema${X}: ${CARATTERI.length} pesi (${kb.toFixed(0)} KB in tutto, `
    + `precaricato il solo ${PESO_PRECARICATO}), impronte corrispondenti,`);
  console.log(`  ogni carattere dei dizionari è disegnato dai file (${copertiDaTutti.size} codepoint, letti dalla cmap `
    + 'di ciascun peso) o è dichiarato al ripiego,\n  e nessuna regola chiede un peso che non esista come file.\n');
  console.log(`  ${DIM}⚠️ Questo controllo NON sa che aspetto abbia il testo a schermo: quello`);
  console.log(`  si guarda, in tre lingue.${X}\n`);
  process.exit(0);
}

console.error(`  ${R}${problemi.length} problemi:${X}\n`);
for (const p of problemi) console.error(`    ${R}✗${X} ${p}`);
console.error('');
process.exit(1);
