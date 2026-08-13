// ============================================================================
// Chiavi di traduzione ORFANE: voci dei dizionari che nessuno chiama più.
//   npm run i18n:orphans
//   npm run i18n:orphans -- --list        (elenca tutte le orfane, non solo le prime)
//   npm run i18n:orphans -- --self-test   (solo l'autoverifica del rilevatore)
//
// PERCHÉ ESISTE, con due casi veri e datati.
// Il 2026-08-13, dopo la PR #44, `subsidy.results.priority` è rimasta in tre
// dizionari senza un chiamante (le due schermate che la usavano erano passate a
// `PriorityMark`) e `L.eligibility` senza nessuno che la invocasse. Nessun
// guardiano se ne è accorto: `i18n:coverage` cerca il TESTO SCRITTO A MANO nei
// componenti, cioè il difetto opposto — una frase che NON passa dal dizionario.
// Una chiave che non passa più da nessun codice è invisibile a quel controllo,
// e le due sono state trovate solo cercando i marcatori nel bundle SERVITO da
// app.ai-swisse.com dopo il merge. Una chiave orfana è una seconda fonte di
// verità che aspetta di essere ripescata: la frase resta lì, invecchia con il
// prodotto, e un giorno qualcuno la richiama credendola viva.
//
// PERCHÉ LEGGE IL DIZIONARIO IMPORTANDOLO, e non con una regex.
// La storia di questo progetto è piena di rilevatori che mentivano perché
// leggevano un sorgente con un'espressione regolare (i18n:coverage due volte,
// `grep` cieco su un byte NUL). Qui il dizionario si IMPORTA: `it` è l'oggetto
// vero, con le sue foglie vere. Basta `it` perché `de.ts` e `fr.ts` sono
// tipizzati `Dictionary`: una chiave mancante o una di troppo rompe
// `npm run typecheck` prima di arrivare qui — l'insieme delle chiavi è uno solo
// e lo garantisce il compilatore, non questo file.
//
// COME RICONOSCE UN USO
// Un tokenizzatore percorre ogni sorgente una volta sola distinguendo codice,
// commenti, stringhe, template ed espressioni regolari, e raccoglie:
//   · i letterali con dei punti          t('tasks.dueNone'), labelKey: 'a.b.c'
//   · il prefisso statico dei template   `subsidy.cases.statuses.${k}` → nodo
//   · i letterali che finiscono in punto 'incentives.reasons.' + r.key → nodo
// Un token che corrisponde a un NODO (non a una foglia) vale per tutto ciò che
// gli sta sotto: è così che `pick('subsidy.labels.eligibility', v)` in
// `labels.ts` copre i quattro stati senza che nessuno li nomini.
//
// ⚠️ I COMMENTI NON CONTANO COME USO, ed è il motivo del tokenizzatore.
// Una chiave citata solo in un commento — e questo codice ne cita parecchie,
// per spiegare perché una scelta è stata fatta — resterebbe «viva» per sempre.
// Toglierli con una regex `//.*$` non si può: `'https://…'` perderebbe metà
// riga, ed è esattamente il difetto già pagato da `i18n-coverage` («i commenti
// vanno saltati PRIMA delle virgolette»).
//
// ⚠️ IL LIMITE, DICHIARATO. Una chiave raggiunta per ACCESSO A PROPRIETÀ e mai
// scritta come stringa (`it.tasks.areaSubtitle` dentro un test) non è vista
// come usata. È deliberato: quello è l'uso di un CONTROLLO, non del prodotto —
// una chiave che solo un test nomina è comunque una chiave che l'interfaccia
// non mostra a nessuno. Se un giorno servisse il contrario, si dichiara
// un'eccezione con la sua riga.
// ============================================================================
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { it } from '../src/i18n/locales/it.ts';

const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Le cartelle in cui si cerca un uso. `src/i18n/locales` NO: là le chiavi
 *  sono DEFINITE, e contarne la definizione come uso renderebbe tutto vivo. */
const CERCA_IN = ['src', 'supabase/functions', 'scripts'];
const NON_CERCARE = new Set([join(APP, 'src/i18n/locales')]);

/**
 * ⚠️ QUESTO FILE NON GUARDA SÉ STESSO, e senza questa riga il meccanismo delle
 * eccezioni non funzionava affatto: le chiavi scritte in `ECCEZIONI` sono
 * letterali in un sorgente dentro `scripts/`, quindi il rilevatore le contava
 * come USI — l'orfana spariva dall'elenco, l'eccezione restava senza niente
 * dietro, e ogni eccezione dichiarata nasceva morta. Trovato con la
 * controprova, non con un caso inventato: il caso «un'eccezione copre
 * un'orfana vera» usciva rosso invece che verde. Qui una chiave è DICHIARATA,
 * come nei dizionari, non usata.
 */
const NON_LEGGERE = new Set([join(APP, 'scripts/i18n-orphans.ts')]);

// ---------------------------------------------------------------------------
// LE ECCEZIONI, una riga ciascuna con il motivo.
//
// ⚠️ Come in `design:lint` e nella sezione 7 di `test:shell-unit`: ciò che non
// passa dal controllo passa da una frase che si può contestare, e un'eccezione
// SENZA PIÙ NIENTE DIETRO fa fallire il controllo. Un'esenzione sopravvissuta a
// ciò che esentava è una porta lasciata aperta.
//
// Si dichiara una CHIAVE ESATTA o un NODO (che copre le sue foglie).
// ---------------------------------------------------------------------------
export const ECCEZIONI: { chiave: string; motivo: string }[] = [];

// ---------------------------------------------------------------------------
// Il tokenizzatore
// ---------------------------------------------------------------------------

/**
 * DOVE PUÒ COMINCIARE UN'ESPRESSIONE REGOLARE, e perché non è la domanda che
 * sembra.
 *
 * ⚠️ LA PRIMA VERSIONE DI QUESTO FILE HA MENTITO SU 125 CHIAVI. Diceva «un `/`
 * apre una regex se NON segue un identificatore», che è la regola giusta per il
 * JavaScript e sbagliata per il JSX: in
 *     <MarkGlyph name="question" />{t('adminAi.result.needsReview')}</span>
 * il `/` di `/>` segue una virgoletta, veniva preso per l'inizio di una regex, e
 * la finta regex si chiudeva sul `/` di `</span>` — portandosi dentro la chiave.
 * Sei chiavi su sei del primo elenco erano usate e visibili con un grep. Non
 * l'ha scoperto un caso di prova: l'ha scoperto il confronto con il codice vero.
 *
 * Quindi si guarda dove una regex può DAVVERO cominciare — dopo un operatore,
 * una parentesi aperta, una virgola, un due punti — invece di elencare dove non
 * può. `>` è l'unico ambiguo: chiude una lambda (`=> /re/`) e chiude un tag
 * JSX (`/>`), e si distingue guardando la coppia.
 */
const APRE_REGEX = new Set(['(', ',', '=', ':', '[', '!', '&', '|', '?', ';', '{', '+', '-', '*', '%', '^', '~']);

/**
 * I letterali di testo di un sorgente, commenti esclusi.
 *
 * Ritorna le stringhe complete (virgolette singole, doppie, template senza
 * interpolazione) e, per i template CON interpolazione, la sola parte statica
 * che precede il primo `${` — che è il prefisso da cui la chiave si compone.
 *
 * ⚠️⚠️ E ENTRA DENTRO LE INTERPOLAZIONI. La prima versione le SALTAVA contando
 * le graffe, e ha dichiarato orfane quattro chiavi vive che stavano proprio lì:
 *     `${t('calendar.dayAriaToday')}`   `· ${t('automations.runDuration', …)}`
 * Comporre una frase con dentro una traduzione è normale in questo codice, e un
 * lettore che si ferma sul bordo dell'interpolazione non legge il codice: legge
 * la sua cornice. Qui `${…}` torna a essere CODICE — con le sue stringhe, i
 * suoi commenti e i suoi template annidati.
 */
export function letterali(src: string): string[] {
  const out: string[] = [];
  scanCodice(src, 0, out, false);
  return out;
}

/** Gli ultimi `quanti` caratteri non-spazio prima di `at`, in ordine di lettura. */
function precedenti(src: string, at: number, quanti: number): string {
  const out: string[] = [];
  let k = at - 1;
  while (k >= 0 && out.length < quanti) {
    if (!/\s/.test(src[k])) out.push(src[k]);
    k--;
  }
  return out.reverse().join('');
}

function apreRegex(src: string, at: number): boolean {
  const p = precedenti(src, at, 1);
  if (p === '') return true;                     // inizio del file
  if (APRE_REGEX.has(p)) return true;
  // ⚠️ `>` è ambiguo: `=> /re/` è una lambda, `/>` è un tag JSX che si chiude.
  if (p === '>') return precedenti(src, at, 2) === '=>';
  return false;
}

/**
 * Percorre del CODICE da `start`, raccogliendo i letterali che incontra.
 * Con `fermaSuGraffa` si ferma sulla `}` che chiude l'interpolazione in cui
 * si trova, e ritorna l'indice dopo di essa.
 */
function scanCodice(src: string, start: number, out: string[], fermaSuGraffa: boolean): number {
  const n = src.length;
  let i = start;
  let graffe = 0;

  while (i < n) {
    const c = src[i];

    if (fermaSuGraffa && c === '}' && graffe === 0) return i + 1;
    if (c === '{') { graffe++; i++; continue; }
    if (c === '}') { graffe--; i++; continue; }

    // -- commenti: si saltano PRIMA di tutto il resto -----------------------
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }

    // -- espressioni regolari: possono contenere virgolette ----------------
    if (c === '/' && apreRegex(src, i)) {
      i++;
      let classe = false;
      while (i < n) {
        const d = src[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '[') classe = true;
        else if (d === ']') classe = false;
        else if (d === '/' && !classe) { i++; break; }
        else if (d === '\n') break; // non era una regex: si esce e si prosegue
        i++;
      }
      continue;
    }

    // -- stringhe con virgolette -------------------------------------------
    if (c === "'" || c === '"') {
      const chiusura = c;
      let buf = '';
      i++;
      while (i < n) {
        const d = src[i];
        if (d === '\\') { buf += src[i + 1] ?? ''; i += 2; continue; }
        if (d === chiusura) { i++; break; }
        if (d === '\n') break; // stringa non chiusa: non si tira dietro il file
        buf += d;
        i++;
      }
      out.push(buf);
      continue;
    }

    if (c === '`') { i = scanTemplate(src, i, out); continue; }

    i++;
  }
  return i;
}

/** Percorre un template a partire dal suo backtick; ritorna l'indice dopo la chiusura. */
function scanTemplate(src: string, start: number, out: string[]): number {
  const n = src.length;
  let i = start + 1;
  let buf = '';
  let interpolato = false;

  while (i < n) {
    const d = src[i];
    if (d === '\\') { buf += src[i + 1] ?? ''; i += 2; continue; }
    if (d === '$' && src[i + 1] === '{') {
      interpolato = true;                        // da qui in poi la parte statica finisce
      i = scanCodice(src, i + 2, out, true);     // ⚠️ dentro è CODICE, non cornice
      continue;
    }
    if (d === '`') { i++; break; }
    if (!interpolato) buf += d;
    i++;
  }
  out.push(buf);
  return i;
}

/** Ha la forma di un percorso nel dizionario? (anche troncato col punto finale) */
const SEMBRA_CHIAVE = /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)*\.?$/;

/** I token che possono nominare una chiave, presi da un sorgente. */
export function tokenChiave(src: string): string[] {
  return letterali(src)
    .map((s) => s.trim())
    .filter((s) => s.includes('.') && SEMBRA_CHIAVE.test(s));
}

// ---------------------------------------------------------------------------
// Il dizionario e il confronto
// ---------------------------------------------------------------------------

/** Tutte le foglie di un dizionario, come percorsi puntati. */
export function foglie(dict: unknown, prefisso = ''): string[] {
  if (typeof dict !== 'object' || dict === null) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(dict as Record<string, unknown>)) {
    const percorso = prefisso ? `${prefisso}.${k}` : k;
    if (v && typeof v === 'object') out.push(...foglie(v, percorso));
    else out.push(percorso);
  }
  return out;
}

/**
 * Le foglie che nessun token nomina.
 *
 * Un token vale per sé E per tutto ciò che gli sta sotto: un NODO nominato
 * (`pick('subsidy.labels.eligibility', v)`) copre le sue foglie, ed è
 * l'unico modo di non gridare su una chiave composta a runtime.
 *
 * Funzione PURA: si prova sui casi che devono farla fallire senza leggere un
 * file e senza un dizionario vero.
 */
export function orfane(tutteLeFoglie: string[], token: Iterable<string>): string[] {
  const nomi = new Set<string>();
  const prefissi: string[] = [];
  for (const t of token) {
    if (t.endsWith('.')) prefissi.push(t);
    else { nomi.add(t); prefissi.push(`${t}.`); }
  }
  return tutteLeFoglie.filter((f) => {
    if (nomi.has(f)) return false;
    return !prefissi.some((p) => f.startsWith(p));
  });
}

// ---------------------------------------------------------------------------
// L'autoverifica: casi che DEVONO far fallire il rilevatore se si rompe
// ---------------------------------------------------------------------------
const DIZIONARIO_FINTO = {
  tasks: { titolo: 'x', sottotitolo: 'y' },
  stati: { aperto: 'a', chiuso: 'b' },
  etichette: { idoneita: { nota: 'n', probabile: 'p' } },
};

const CASI: { nome: string; src: string; attese: string[] }[] = [
  {
    nome: 'una chiave che nessuno chiama è orfana',
    src: "const a = t('tasks.titolo');",
    attese: ['tasks.sottotitolo', 'stati.aperto', 'stati.chiuso', 'etichette.idoneita.nota', 'etichette.idoneita.probabile'],
  },
  {
    nome: 'un letterale la tiene viva',
    src: "t('tasks.titolo'); t('tasks.sottotitolo'); t('stati.aperto'); t('stati.chiuso');\n"
      + "t('etichette.idoneita.nota'); t('etichette.idoneita.probabile');",
    attese: [],
  },
  {
    nome: 'un template con interpolazione copre il suo nodo',
    src: "t('tasks.titolo'); t('tasks.sottotitolo'); t(`stati.${k}` as TKey);\n"
      + "t('etichette.idoneita.nota'); t('etichette.idoneita.probabile');",
    attese: [],
  },
  {
    nome: 'un nodo nominato (pick) copre le sue foglie',
    src: "t('tasks.titolo'); t('tasks.sottotitolo'); t('stati.aperto'); t('stati.chiuso');\n"
      + "pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    nome: 'un letterale che finisce in punto è un prefisso',
    src: "t('tasks.titolo'); t('tasks.sottotitolo'); const k = 'stati.' + v;\n"
      + "pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    // ⚠️ IL CASO CHE GIUSTIFICA IL TOKENIZZATORE.
    nome: 'una chiave citata solo in un commento NON è usata',
    src: "// vedi t('tasks.sottotitolo'), che spiega la scelta\n"
      + "/* e anche stati.aperto, stati.chiuso */\n"
      + "t('tasks.titolo'); pick('etichette.idoneita', v);",
    attese: ['tasks.sottotitolo', 'stati.aperto', 'stati.chiuso'],
  },
  {
    // ⚠️ L'ALTRA METÀ: un commento non deve nemmeno MANGIARE il codice vero.
    nome: 'un indirizzo dentro una stringa non apre un commento',
    src: "const u = 'https://esempio.ch/x'; t('tasks.titolo'); t('tasks.sottotitolo');\n"
      + "t('stati.aperto'); t('stati.chiuso'); pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    // ⚠️ Una regex con dentro una virgoletta non deve aprire una stringa che
    // si chiude molto più avanti, portandosi via le chiavi che incontra.
    nome: 'una regex con virgolette dentro non nasconde il codice che segue',
    src: "const r = /['\"]/g; t('tasks.titolo'); t('tasks.sottotitolo'); t('stati.aperto');\n"
      + "t('stati.chiuso'); pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    // ⚠️⚠️ IL CASO CHE HA SMASCHERATO LA PRIMA VERSIONE, riprodotto alla
    // lettera dal file dove è successo. Un tag JSX che si chiude da solo, e
    // subito dopo la chiave: `/>` veniva letto come inizio di regex e la finta
    // regex si chiudeva sul `/` di `</span>`, mangiandosi la chiave in mezzo.
    nome: 'un tag JSX che si chiude da solo non nasconde la chiave che segue',
    src: "export function P() { return (\n"
      + "  <span className=\"vn-title\"><MarkGlyph name=\"question\" />{t('tasks.sottotitolo')}</span>\n"
      + "); }\n"
      + "t('tasks.titolo'); t('stati.aperto'); t('stati.chiuso'); pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    // ⚠️⚠️ IL SECONDO CASO CHE HA SMASCHERATO IL RILEVATORE, e non l'ha trovato
    // un caso di prova: l'ha trovato il confronto col codice vero. Comporre una
    // frase con dentro una traduzione è normale qui, e chi salta il contenuto
    // di `${…}` non legge il codice — legge la sua cornice.
    nome: 'una chiave dentro un\'interpolazione conta come uso',
    src: "const a = `— ${t('tasks.sottotitolo')}`;\n"
      + "const b = `· ${t('stati.aperto', { n })} / ${t('stati.chiuso')}`;\n"
      + "t('tasks.titolo'); pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    // Un template annidato dentro l'interpolazione di un altro: la stessa
    // funzione deve poter rientrare in sé stessa senza perdere il filo.
    nome: 'un template annidato non fa perdere il filo',
    src: "const a = `${x ? `— ${t('tasks.sottotitolo')}` : ''}`;\n"
      + "t('tasks.titolo'); t('stati.aperto'); t('stati.chiuso'); pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    // L'altra metà: la freccia di una lambda apre davvero una regex, e se non
    // la si riconosce le virgolette che contiene aprono una finta stringa.
    nome: 'la regex dopo una freccia resta una regex',
    src: "const f = (s) => /['\"]/.test(s);\n"
      + "t('tasks.titolo'); t('tasks.sottotitolo'); t('stati.aperto'); t('stati.chiuso');\n"
      + "pick('etichette.idoneita', v);",
    attese: [],
  },
  {
    nome: 'una chiave che assomiglia a un percorso di file non conta come uso',
    src: "import x from './tasks.sottotitolo.js';\nt('tasks.titolo'); pick('etichette.idoneita', v);\n"
      + "t('stati.aperto'); t('stati.chiuso');",
    attese: ['tasks.sottotitolo'],
  },
];

function autoverifica(): void {
  const tutte = foglie(DIZIONARIO_FINTO);
  let falliti = 0;
  console.log('\nAutoverifica del rilevatore\n');
  for (const caso of CASI) {
    const trovate = orfane(tutte, tokenChiave(caso.src)).sort();
    const attese = [...caso.attese].sort();
    const ok = trovate.join('|') === attese.join('|');
    if (!ok) falliti++;
    console.log(`  ${ok ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m'} ${caso.nome}`);
    if (!ok) console.log(`      attese: ${attese.join(', ') || '—'}\n      trovate: ${trovate.join(', ') || '—'}`);
  }
  if (falliti) {
    console.error(`\n  ${falliti} casi non superati: il rilevatore NON è affidabile.\n`);
    process.exit(1);
  }
  console.log('\n  Tutti i casi superati.\n');
}

// ---------------------------------------------------------------------------
// Esecuzione
// ---------------------------------------------------------------------------
const argomenti = process.argv.slice(2);
const ignoti = argomenti.filter((a) => a !== '--list' && a !== '--self-test');
if (ignoti.length) {
  console.error(`\n✗ Argomenti non riconosciuti: ${ignoti.join(' ')}`);
  console.error('  Si accettano: --list, --self-test.\n');
  process.exit(2);
}

if (argomenti.includes('--self-test')) {
  autoverifica();
  process.exit(0);
}

// L'autoverifica gira SEMPRE prima della scansione: se il rilevatore è rotto,
// il verde della scansione non significa niente e non va nemmeno stampato.
{
  const tutte = foglie(DIZIONARIO_FINTO);
  const rotti = CASI.filter((c) => orfane(tutte, tokenChiave(c.src)).sort().join('|') !== [...c.attese].sort().join('|'));
  if (rotti.length) {
    console.error('\n✗ Il rilevatore non supera la propria autoverifica:');
    for (const c of rotti) console.error(`    ${c.nome}`);
    console.error('  Esegui: npm run i18n:orphans -- --self-test\n');
    process.exit(1);
  }
}

const sorgenti: string[] = [];
for (const radice of CERCA_IN) {
  const base = join(APP, radice);
  try { statSync(base); } catch { continue; }
  (function cammina(dir: string) {
    if (NON_CERCARE.has(dir)) return;
    for (const nome of readdirSync(dir)) {
      const p = join(dir, nome);
      if (statSync(p).isDirectory()) { if (nome !== 'node_modules') cammina(p); }
      else if (/\.(tsx?|mjs|js)$/.test(nome) && !NON_LEGGERE.has(p)) sorgenti.push(p);
    }
  })(base);
}

const token = new Set<string>();
for (const f of sorgenti) for (const t of tokenChiave(readFileSync(f, 'utf8'))) token.add(t);

const tutteLeFoglie = foglie(it);
const trovate = orfane(tutteLeFoglie, token);

// Le eccezioni si applicano DOPO, e si pretende che servano a qualcosa.
const coperta = (chiave: string, e: string) => chiave === e || chiave.startsWith(`${e}.`);
const usate = new Set<string>();
const residue = trovate.filter((k) => {
  const e = ECCEZIONI.find((x) => coperta(k, x.chiave));
  if (e) { usate.add(e.chiave); return false; }
  return true;
});
const morte = ECCEZIONI.filter((e) => !usate.has(e.chiave));

console.log('\nChiavi di traduzione orfane — voci che nessun codice chiama più');
console.log(`\x1b[2m(rilevatore verificato su ${CASI.length} casi noti · `
  + `${tutteLeFoglie.length} chiavi, ${sorgenti.length} sorgenti, ${token.size} riferimenti)\x1b[0m\n`);

if (morte.length) {
  console.error('\x1b[31m✗ Eccezioni senza più niente dietro:\x1b[0m');
  for (const e of morte) console.error(`    ${e.chiave} — ${e.motivo}`);
  console.error('\n  Un\'esenzione sopravvissuta a ciò che esentava è una porta lasciata aperta:');
  console.error('  la riga va tolta da ECCEZIONI, non dimenticata.\n');
  process.exit(1);
}

if (!residue.length) {
  console.log('  \x1b[32mNessuna: ogni chiave dei dizionari ha almeno un chiamante.\x1b[0m\n');
  process.exit(0);
}

const perGruppo = new Map<string, string[]>();
for (const k of residue) {
  const g = k.split('.')[0];
  perGruppo.set(g, [...(perGruppo.get(g) ?? []), k]);
}
const mostraTutte = argomenti.includes('--list') || residue.length <= 40;
for (const [g, keys] of [...perGruppo].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`  ${g}  (${keys.length})`);
  if (mostraTutte) for (const k of keys) console.log(`    ${k}`);
}
if (!mostraTutte) console.log('\n  (elenco completo: npm run i18n:orphans -- --list)');
console.log(`\n  ${residue.length} orfane su ${tutteLeFoglie.length} chiavi, in ${perGruppo.size} sezioni`);
console.log('  Ogni voce va tolta dai TRE dizionari, oppure dichiarata in ECCEZIONI con il suo motivo.');
console.log('  ⚠️ Prima di cancellare: controllare che non sia composta a runtime in un modo');
console.log('     che questo rilevatore non vede — una chiave viva tolta è peggio di una morta.\n');
process.exit(1);
