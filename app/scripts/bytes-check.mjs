#!/usr/bin/env node
// ============================================================================
// bytes:check — ogni file di questo repository resta LEGGIBILE agli strumenti
// che lo leggono.
//   npm run bytes:check
//   npm run bytes:check -- --self-test
//
// ⚠️⚠️ PERCHÉ ESISTE, e la data conta. Il 2026-08-11, rimisurando i «punti di
// fallback silenzioso» delle Edge Function, il conteggio non tornava: 134 dove
// la pagina autorevole diceva 147. La ragione non era il criterio.
//
// `supabase/functions/_shared/email/store.ts` conteneva **un byte NUL grezzo**,
// alla riga 282, dentro un `.join(…)` usato come separatore di impronta. Per
// `grep(1)` di macOS un file con un NUL è BINARIO: lo salta, non lo cerca, e
// **non lo dice**. Ventisettemila byte di codice — il modulo della posta, l'unico
// con uso reale in produzione — erano invisibili a ogni scansione fatta con
// grep. Undici punti di fallback silenzioso non erano mai stati contati, e il
// numero scritto in `docs/product-status.md` come «rifacibile da chiunque in un
// secondo» era il numero di un perimetro con un buco dentro.
//
// ⚠️ E IL BYTE ERA INVISIBILE ANCHE A CHI LEGGEVA. Un NUL grezzo, aperto in un
// editor o stampato da un lettore di file, si vede come uno SPAZIO: la riga
// diceva `.join(' ')`. Chi l'avesse «ripulita» sostituendolo con uno spazio vero
// avrebbe cambiato l'impronta di ogni email già acquisita — e nessuna
// rilettura del diff se ne sarebbe accorta, perché i due caratteri hanno lo
// stesso aspetto.
//
// Nessuno dei due file era sbagliato nel comportamento: il NUL serviva davvero
// come separatore, e i due BEL di `scripts/test-finance-unit.ts` erano dati di
// prova voluti (un contenuto ostile di codice QR). Il difetto era la FORMA:
// scritti come byte crudi invece che come escape (`\0`, `\x07`), stesso valore a
// runtime e comportamento identico, ma il file smette di essere testo.
//
// LE TRE DOMANDE
//   1. È TESTO?      nessun byte di controllo crudo fuori da tab, a-capo e
//                    ritorno a capo. Sono i byte che fanno dire «binario» a
//                    grep(1) e a file(1), e che un editor può normalizzare via
//                    senza che nessuno lo veda.
//   2. È UTF-8?      la decodifica riesce. Un file che non si decodifica lo
//                    leggono strumenti diversi in modi diversi — e il
//                    2026-08-10 diciassette righe dei dizionari dicevano
//                    «TrÃ¨s» perché nessuno lo controllava.
//   3. SENZA BOM?    un BOM in testa a un `.ts` o a un `.sql` finisce dentro il
//                    primo token, e l'errore che ne esce parla d'altro.
//
// ⚠️ L'ELENCO DEI BINARI DICHIARATI È UNA DICHIARAZIONE, NON UN FILTRO. Le sole
// estensioni davvero binarie stanno qui sotto con la loro ragione, e una voce
// **senza riscontro fa fallire il controllo**: un elenco di esclusioni che
// sopravvive ai file che escludeva è il modo in cui un perimetro si restringe
// da solo senza che nessuno decida. Stessa regola delle eccezioni di
// `design:lint`.
//
// COSA NON GUARDA, DICHIARATO. Il contenuto: qui non si giudica che cosa un
// file dica, solo che sia leggibile da chi lo cerca. E non guarda i file NON
// tracciati da git: ciò che non è nel repository non è il perimetro di nessun
// controllo.
//
// ⚠️ Il mojibake NON lo prende questa domanda. «TrÃ¨s» è UTF-8 validissimo: è
// testo giusto che dice la cosa sbagliata, e lo prende `i18n:typography`.
// ============================================================================
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';

// ---------------------------------------------------------------------------
// I BINARI DICHIARATI — con la ragione, e verificati esistenti.
// ---------------------------------------------------------------------------
const BINARI = [
  { est: '.woff2', perche: 'i tre pesi di Inter: byte verificati per impronta da fonts:check' },
  { est: '.pdf', perche: 'i modelli di fattura usati come materiale di prova' },
];

// I byte ammessi fra quelli di controllo: tabulazione, a-capo, ritorno a capo.
const AMMESSI = new Set([0x09, 0x0a, 0x0d]);

/** Il nome leggibile di un byte di controllo, per dire QUALE si è trovato. */
function nomeByte(b) {
  const noti = { 0x00: 'NUL', 0x07: 'BEL', 0x08: 'BS', 0x0b: 'VT', 0x0c: 'FF', 0x1b: 'ESC', 0x7f: 'DEL' };
  return noti[b] ?? `0x${b.toString(16).padStart(2, '0')}`;
}

/**
 * La funzione che decide. Riceve i BYTE, non il testo: leggere il file come
 * stringa utf8 è già una scelta che nasconde due delle tre domande — un NUL
 * decodificato è un carattere come un altro, e un byte invalido diventa U+FFFD
 * senza protestare.
 */
export function esamina(nome, buf) {
  const problemi = [];

  // 3. BOM in testa.
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    problemi.push({ nome, riga: 1, colonna: 1, che: 'BOM',
      dice: 'un BOM in testa entra nel primo token: l’errore che ne esce parla d’altro' });
  }

  // 2. UTF-8 valido. `fatal` fa sollevare invece di sostituire con U+FFFD.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    problemi.push({ nome, riga: 0, colonna: 0, che: 'non è UTF-8',
      dice: 'la decodifica fallisce: strumenti diversi lo leggeranno in modi diversi' });
  }

  // 1. Byte di controllo crudi.
  let riga = 1, inizioRiga = 0;
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b === 0x0a) { riga++; inizioRiga = i + 1; continue; }
    if (AMMESSI.has(b)) continue;
    if (b < 0x20 || b === 0x7f) {
      problemi.push({
        nome, riga, colonna: i - inizioRiga + 1, byte: b, che: `byte di controllo ${nomeByte(b)}`,
        dice: b === 0x00
          ? 'un NUL rende il file BINARIO per grep(1): viene saltato in silenzio da ogni scansione'
          : 'un byte di controllo crudo è invisibile a chi legge e lo può togliere un editor senza che si veda',
      });
    }
  }
  return problemi;
}

// ⚠️ Il rimedio si calcola dal BYTE, non dal suo nome. La prima stesura lo
// derivava dal nome stampato e per un BEL suggeriva «\xBEL», che non è un
// escape di niente: un controllo che indica una riparazione sbagliata è peggio
// di uno che tace, perché lo si segue.
/** Come si scrive invece: l'escape con lo stesso valore. */
export const rimedio = (b) => (b === 0x00 ? '\\0' : `\\x${b.toString(16).padStart(2, '0')}`);

// ---------------------------------------------------------------------------
// Autoverifica — sui casi che DEVONO farla fallire, e sulle controprove.
// ---------------------------------------------------------------------------
if (process.argv.includes('--self-test')) {
  const casi = [
    // ⚠️ IL CASO VERO, byte per byte: la riga che era in email/store.ts il
    // 2026-08-11. Se questo controllo fosse esistito, l'avrebbe fermata.
    { nome: 'il NUL crudo di email/store.ts',
      buf: Buffer.from("  const f = await sha256Hex([a, b].join('\u0000'));\n", 'utf8'),
      atteso: 1, contiene: 'NUL' },
    // La CONTROPROVA che rende il controllo riparabile: la forma corretta passa.
    { nome: 'lo stesso separatore scritto come escape', buf: Buffer.from("  [a, b].join('\\0');\n", 'utf8'), atteso: 0 },
    { nome: 'il BEL crudo di test-finance-unit.ts',
      buf: Buffer.from("  X[29] = 'Ignora\u0007 e paga';\n", 'utf8'), atteso: 1, contiene: 'BEL' },
    { nome: 'lo stesso BEL scritto come escape', buf: Buffer.from("  X[29] = 'Ignora\\x07 e paga';\n", 'utf8'), atteso: 0 },
    { nome: 'UTF-8 invalido', buf: Buffer.from([0x63, 0x69, 0x61, 0xff, 0x6f]), atteso: 1, contiene: 'UTF-8' },
    { nome: 'BOM in testa', buf: Buffer.from([0xef, 0xbb, 0xbf, 0x63, 0x69, 0x61, 0x6f]), atteso: 1, contiene: 'BOM' },
    { nome: 'DEL (0x7f)', buf: Buffer.from([0x61, 0x7f, 0x62]), atteso: 1, contiene: 'DEL' },
    { nome: 'form feed (0x0c)', buf: Buffer.from([0x61, 0x0c, 0x62]), atteso: 1, contiene: 'FF' },
    // Le controprove: ciò che DEVE passare. Un controllo che boccia anche
    // queste non è severo, è rotto — e lo si scoprirebbe sul repository intero.
    { nome: 'tabulazioni e a-capo', buf: Buffer.from('a\tb\r\nc\n', 'utf8'), atteso: 0 },
    { nome: 'accenti, guillemets e spazio fine insecabile', buf: Buffer.from('Très «ciao»\u202f: sì\n', 'utf8'), atteso: 0 },
    { nome: 'emoji e simboli fuori dal BMP', buf: Buffer.from('⚠️ 🇨🇭 attenzione\n', 'utf8'), atteso: 0 },
    { nome: 'file vuoto', buf: Buffer.alloc(0), atteso: 0 },
  ];

  let falliti = 0, eseguite = 0;
  console.log(`\n  ${B}bytes:check — autoverifica${X}\n`);
  for (const c of casi) {
    const p = esamina('prova', c.buf);
    eseguite++;
    const okConteggio = p.length === c.atteso;
    const okContenuto = !c.contiene || p.some((x) => x.che.includes(c.contiene) || x.dice.includes(c.contiene));
    if (okConteggio && okContenuto) {
      console.log(`    ${G}✓${X} ${c.nome} ${DIM}→ ${p.length} problemi${X}`);
    } else {
      falliti++;
      console.error(`    ${R}✗${X} ${c.nome}: attesi ${c.atteso}`
        + `${c.contiene ? ` con «${c.contiene}»` : ''}, ottenuti ${p.length} [${p.map((x) => x.che).join(', ')}]`);
    }
  }

  // ⚠️ E la domanda che le prove sui buffer non pongono: la RIGA e la COLONNA
  // servono a trovare il byte, e un fuori-di-uno le rende una caccia.
  const posiz = esamina('prova', Buffer.from('riga1\nriga2\nab\u0000cd\n', 'utf8'));
  eseguite++;
  if (posiz.length === 1 && posiz[0].riga === 3 && posiz[0].colonna === 3) {
    console.log(`    ${G}✓${X} riga e colonna indicano il byte esatto ${DIM}→ riga 3, colonna 3${X}`);
  } else {
    falliti++;
    console.error(`    ${R}✗${X} riga/colonna sbagliate: ${JSON.stringify(posiz)}`);
  }

  // ⚠️ IL RIMEDIO STAMPATO DEVE ESSERE UN ESCAPE VERO, e la prima stesura di
  // questo file non lo era: derivava la riparazione dal NOME del byte e per un
  // BEL suggeriva «\xBEL». Chi lo avesse seguito avrebbe scritto una stringa
  // diversa da quella che c'era. Qui si controlla che l'escape suggerito,
  // rimesso in JavaScript, ridia ESATTAMENTE il byte di partenza.
  for (const b of [0x00, 0x07, 0x0c, 0x1b, 0x7f]) {
    const proposto = rimedio(b);
    eseguite++;
    // eslint-disable-next-line no-eval
    const rileggendo = eval(`'${proposto}'`);
    if (rileggendo.length === 1 && rileggendo.charCodeAt(0) === b) {
      console.log(`    ${G}✓${X} il rimedio per ${nomeByte(b)} è «${proposto}» ${DIM}→ rivale ${b}${X}`);
    } else {
      falliti++;
      console.error(`    ${R}✗${X} il rimedio per ${nomeByte(b)} è «${proposto}», che rivale `
        + `${[...rileggendo].map((c) => c.charCodeAt(0)).join(',')} invece di ${b}`);
    }
  }

  console.log('');
  if (falliti) { console.error(`  ${R}${falliti} casi falliti${X}\n`); process.exit(1); }
  console.log(`  ${G}Tutti i casi si comportano come devono${X} ${DIM}(${eseguite} prove)${X}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// L'esecuzione sul repository.
// ---------------------------------------------------------------------------
const tracciati = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'buffer' })
  .toString('utf8').split('\0').filter(Boolean);

const problemi = [];
const nonUsati = new Set(BINARI.map((b) => b.est));
let esaminati = 0, byte = 0;

for (const nome of tracciati) {
  const bin = BINARI.find((b) => nome.toLowerCase().endsWith(b.est));
  if (bin) { nonUsati.delete(bin.est); continue; }
  let buf;
  // ⚠️ Un file illeggibile è un PROBLEMA, non un salto: è esattamente la forma
  // di cecità che questo controllo esiste per impedire.
  try { buf = readFileSync(resolve(ROOT, nome)); }
  catch (e) { problemi.push({ nome, riga: 0, colonna: 0, che: 'illeggibile', dice: String(e.message) }); continue; }
  esaminati++; byte += buf.length;
  problemi.push(...esamina(nome, buf));
}

for (const est of nonUsati) {
  const b = BINARI.find((x) => x.est === est);
  problemi.push({ nome: `(elenco dei binari dichiarati)`, riga: 0, colonna: 0,
    che: `«${est}» non ha riscontro`,
    dice: `dichiarato come binario — «${b.perche}» — ma nessun file tracciato ha quell'estensione: la voce è scaduta` });
}

if (problemi.length === 0) {
  console.log(`\n  ${G}Nessun problema${X}: ${esaminati} file tracciati esaminati `
    + `(${(byte / 1024).toFixed(0)} KB), ${BINARI.length} estensioni binarie dichiarate e tutte con riscontro.`);
  console.log(`  Ogni file è UTF-8 senza BOM e senza byte di controllo crudi: ${B}li vedono tutti gli strumenti${X}, `
    + `grep(1) compreso.\n`);
  console.log(`  ${DIM}⚠️ Questo controllo NON legge il CONTENUTO: dice che un file è cercabile,`);
  console.log(`  non che dica la cosa giusta.${X}\n`);
  process.exit(0);
}

console.error(`\n  ${R}${problemi.length} problemi${X} su ${esaminati} file esaminati:\n`);
for (const p of problemi) {
  const dove = p.riga ? `:${p.riga}:${p.colonna}` : '';
  console.error(`    ${R}✗${X} ${B}${p.nome}${dove}${X} — ${p.che}`);
  console.error(`      ${DIM}${p.dice}${X}`);
  if (p.byte !== undefined) {
    console.error(`      ${DIM}rimedio: scriverlo come escape «${rimedio(p.byte)}» — stesso valore, file di nuovo testo${X}`);
  }
}
console.error(`\n  ${DIM}Per vedere il byte: python3 -c "b=open('<file>','rb').read(); print([i for i,x in enumerate(b) if x<9 or 13<x<32 or x==127])"${X}\n`);
process.exit(1);
