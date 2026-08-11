#!/usr/bin/env node
// ============================================================================
// fallback:scan — QUANTI fallback silenziosi restano nelle Edge Function, e il
// numero lo dà un comando, non una pagina.
//   npm run fallback:scan
//   npm run fallback:scan -- --report      # riga per riga
//   npm run fallback:scan -- --self-test   # le regole provate sui casi che DEVONO reagire
//
// ⚠️⚠️ PERCHÉ ESISTE, e la data conta. Il 2026-08-11 `docs/product-status.md`
// dichiarava «147 punti restanti», e aggiungeva — testualmente — che quel numero
// vale «perché chiunque può rifarlo in un secondo e ottenere lo stesso numero».
//
// Non era vero, per due ragioni distinte, e sono due lezioni diverse.
//
//   1. IL COMANDO NON ERA SCRITTO DA NESSUNA PARTE. La pagina descriveva il
//      criterio a parole («le due forme…») e non riportava la riga da eseguire.
//      Un criterio a parole non è rifacibile: rifacendolo si ottiene un numero
//      vicino e diverso, e non si sa quale dei due sia sbagliato.
//   2. ⚠️ IL COMANDO ERA `grep`, E `grep` NON VEDEVA TUTTO. In
//      `_shared/email/store.ts` c'era un byte NUL scritto crudo: per grep(1) di
//      macOS quel file è BINARIO, e lo salta **in silenzio**. Ventisettemila
//      byte — il modulo della posta, l'unico con uso reale in produzione —
//      erano fuori da ogni scansione. Il numero autorevole era il numero di un
//      perimetro con un buco dentro. (Il byte è corretto, e `bytes:check`
//      impedisce che ne rientri un altro.)
//
// ⚠️⚠️ E LA PRIMA STESURA DI QUESTO FILE HA RIPETUTO L'ERRORE IN PICCOLO. Era a
// espressioni regolari, contava 137 punti, e ne mancava 17 su cento: non vedeva
// `const { count } = await …` (chiedeva la parola `data`), non vedeva le
// destrutturazioni dentro `Promise.all`, e soprattutto non poteva vedere la
// forma «il risultato è legato per intero e `.error` non lo legge nessuno» —
// che per deciderla bisogna sapere che cosa succede nel resto della funzione,
// cioè bisogna avere un albero sintattico, non una riga di testo.
//
// Da qui la forma definitiva: **il parser TypeScript vero** (`ts.createSourceFile`)
// sui byte letti da Node. Niente grep, niente regex sul sorgente. La misura non
// può essere azzoppata dal difetto che sta misurando, non si fa ingannare da un
// commento che cita la forma sbagliata, e dà lo stesso numero su macOS e in CI.
//
// CHE COSA CONTA COME PUNTO — una definizione sola, e meccanica:
// **una chiamata al database il cui errore non viene MAI consultato.**
// PostgREST non solleva: restituisce `{ data, error }`. Se `error` non viene
// legato a un nome, o viene legato e mai letto, il guasto sparisce e `data`
// vale `null` esattamente come quando la riga non c'è.
//
// ⚠️ COSA NON CONTA, E PERCHÉ IL CONFINE STA QUI. Ci sono punti in cui l'errore
// È letto e poi collassato su un valore plausibile — `if (error || !data)
// return null`, `if (!res.error) { … }` senza `else`, un ternario che ripiega
// sul fuso predefinito. Per la regola di casa sono fallback silenziosi eccome,
// e alcuni sono gravi. Ma deciderli richiede di sapere se quel `null` è un
// esito legittimo per QUELLA funzione, e quella è una lettura, non una misura:
// un contatore che ci prova produce falsi positivi, e un numero con dentro dei
// falsi positivi non lo si può usare come cricca. Restano fuori, dichiarati
// qui: una lettura del 2026-08-11 con il parser ne ha contati **12** (3 guardie
// invertite senza `else`, 3 ripieghi per ternario o helper, 6 `if (error)
// return <valore legittimo>`).
// Fuori anche: l'errore guardato SOLO attraverso un campo — `if (code &&
// code !== '23505')`, che lascia passare un guasto di trasporto senza `code`
// (ce n'è uno vero in `upsertMessage`) — e tutto ciò che sta fuori da
// `supabase/functions/`.
//
// ⚠️ E IL NUMERO NON MISURA IL DANNO. Dice quanti punti hanno la FORMA del
// difetto, non quanto costa ciascuno: un `releaseLease` che si autoripara in
// cinque minuti pesa uno esattamente come la lettura che fa analizzare il
// documento sbagliato. La gravità la dice la lettura del codice.
// ============================================================================
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';

const ts = createRequire(import.meta.url)('typescript');
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PERIMETRO = join(ROOT, 'supabase', 'functions');
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';

// I nomi con cui il client viaggia in questo codice. ⚠️ Limite dichiarato: un
// client battezzato altrimenti non verrebbe riconosciuto. L'autoverifica lo dice.
const CLIENT = new Set(['sb', 'sbUser', 'sbAdmin', 'db', 'supabase', 'admin', 'client', 'storage']);
// I metodi che rendono una catena una chiamata al database (e non un await qualunque).
const METODI = new Set(['from', 'rpc', 'storage', 'auth', 'schema']);

export const FORME = {
  'await-nudo': {
    titolo: 'il risultato non viene raccolto',
    perche: 'la chiamata è un’istruzione a sé: l’oggetto `{data, error}` viene distrutto '
      + 'appena creato, quindi nessuno può sapere che dentro c’era un errore',
  },
  'error-non-legato': {
    titolo: 'l’errore non viene nemmeno chiesto',
    perche: 'la destrutturazione non prende `error`: è irraggiungibile, e `data` vale `null` '
      + 'sia quando la riga non c’è sia quando la lettura è fallita',
  },
  'error-mai-letto': {
    titolo: 'l’errore è lì e non lo guarda nessuno',
    perche: 'il risultato è legato per intero, quindi `error` esiste — ma in tutta la funzione '
      + 'non c’è una sola lettura di `.error`: si prende solo `.data`',
  },
};

// ---------------------------------------------------------------------------
// Riconoscere una catena Supabase: la radice è un client, e da qualche parte
// nella catena c'è `.from(…)` / `.rpc(…)` / `.storage` / `.auth`.
// ---------------------------------------------------------------------------
function radice(nodo) {
  let n = nodo;
  for (;;) {
    if (ts.isCallExpression(n) || ts.isAwaitExpression(n)) { n = n.expression; continue; }
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) { n = n.expression; continue; }
    if (ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n)) { n = n.expression; continue; }
    return n;
  }
}

/**
 * La catena finisce con `.then(…)` o `.catch(…)`?
 *
 * ⚠️ Allora l'errore è già stato consegnato a qualcuno, e chi riceve il valore
 * trasformato non deve più guardarlo. È la forma dei caricatori di
 * `automation/store.ts` — `…maybeSingle().then((r) => letto(r, 'codice'))` —
 * corretti il 2026-08-11 proprio perché sollevino: contarli sarebbe segnare
 * come difetto la sua riparazione.
 */
function delegaLErrore(nodo) {
  let n = nodo;
  while (ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n)) n = n.expression;
  return ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
    && ['then', 'catch', 'finally'].includes(n.expression.name.text);
}

function catenaSupabase(nodo) {
  if (!nodo) return false;
  const r = radice(nodo);
  // `sb.from(…)` oppure `deps.sb.from(…)`: la radice è un identificatore, ma il
  // client può essere una proprietà (`deps.sb`), quindi si guarda tutta la catena.
  const nomi = [];
  let n = nodo;
  for (;;) {
    if (ts.isCallExpression(n) || ts.isAwaitExpression(n) || ts.isNonNullExpression(n)
      || ts.isParenthesizedExpression(n)) { n = n.expression; continue; }
    if (ts.isPropertyAccessExpression(n)) { nomi.push(n.name.text); n = n.expression; continue; }
    if (ts.isElementAccessExpression(n)) { n = n.expression; continue; }
    break;
  }
  if (ts.isIdentifier(n)) nomi.push(n.text);
  const haCliente = nomi.some((x) => CLIENT.has(x)) || (ts.isIdentifier(r) && CLIENT.has(r.text));
  const haMetodo = nomi.some((x) => METODI.has(x));
  return haCliente && haMetodo;
}

/** La funzione (o il file) che contiene il nodo: il perimetro in cui cercare `.error`. */
function contenitore(nodo) {
  let n = nodo.parent;
  while (n) {
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)
      || ts.isMethodDeclaration(n) || ts.isSourceFile(n)) return n;
    n = n.parent;
  }
  return nodo.getSourceFile();
}

/** Qualcuno legge `<nome>.error` dentro questo perimetro? */
function leggeError(perimetro, nome) {
  let trovato = false;
  const visita = (n) => {
    if (trovato) return;
    if (ts.isPropertyAccessExpression(n) && n.name.text === 'error'
      && ts.isIdentifier(n.expression) && n.expression.text === nome) { trovato = true; return; }
    // Anche `const { error } = risposta` conta come lettura.
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isIdentifier(n.initializer)
      && n.initializer.text === nome && n.name && ts.isObjectBindingPattern(n.name)
      && n.name.elements.some((e) => (e.propertyName ?? e.name).getText() === 'error')) { trovato = true; return; }
    // Passato a qualcun altro per intero: non possiamo più dire che nessuno lo guardi.
    if (ts.isCallExpression(n) && n.arguments.some((a) => ts.isIdentifier(a) && a.text === nome)) {
      trovato = true; return;
    }
    ts.forEachChild(n, visita);
  };
  ts.forEachChild(perimetro, visita);
  return trovato;
}

/** Il pattern di destrutturazione prende `error`? */
function prendeError(pattern) {
  return pattern.elements.some((e) => {
    const chiave = (e.propertyName ?? e.name);
    return ts.isIdentifier(chiave) && chiave.text === 'error';
  });
}

// ---------------------------------------------------------------------------
// L'analisi di un file.
// ---------------------------------------------------------------------------
export function esamina(nome, testo) {
  const sf = ts.createSourceFile(nome, testo, ts.ScriptTarget.Latest, /* setParentNodes */ true);
  const punti = [];
  const segna = (nodo, forma) => {
    const { line } = sf.getLineAndCharacterOfPosition(nodo.getStart(sf));
    punti.push({ forma, riga: line + 1 });
  };

  const visita = (n) => {
    if (ts.isAwaitExpression(n)) {
      const arg = n.expression;

      // `await Promise.all([…])`: ogni elemento dell'array è una chiamata a sé,
      // e il binding corrispondente dice se il suo errore viene preso.
      const isPromiseAll = ts.isCallExpression(arg)
        && ts.isPropertyAccessExpression(arg.expression)
        && ts.isIdentifier(arg.expression.expression) && arg.expression.expression.text === 'Promise'
        && ['all', 'allSettled'].includes(arg.expression.name.text)
        && arg.arguments.length === 1 && ts.isArrayLiteralExpression(arg.arguments[0]);

      if (isPromiseAll) {
        const elementi = arg.arguments[0].elements;
        const dich = ts.isVariableDeclaration(n.parent) ? n.parent : null;
        const binding = dich && ts.isArrayBindingPattern(dich.name) ? dich.name : null;
        elementi.forEach((el, i) => {
          if (!catenaSupabase(el)) return;
          if (delegaLErrore(el)) return;   // l'errore è già consegnato a `.then`
          if (!binding) {                                   // `await Promise.all([…])` e basta
            if (dich === null && ts.isExpressionStatement(n.parent)) segna(el, 'await-nudo');
            return;
          }
          const b = binding.elements[i];
          if (!b || ts.isOmittedExpression(b)) { segna(el, 'await-nudo'); return; }
          if (ts.isObjectBindingPattern(b.name)) {
            if (!prendeError(b.name)) segna(el, 'error-non-legato');
          } else if (ts.isIdentifier(b.name)) {
            if (!leggeError(contenitore(n), b.name.text)) segna(el, 'error-mai-letto');
          }
        });
        ts.forEachChild(n, visita);
        return;
      }

      if (catenaSupabase(arg) && !delegaLErrore(arg)) {
        const p = n.parent;
        if (ts.isExpressionStatement(p)) {
          segna(n, 'await-nudo');
        } else if (ts.isVariableDeclaration(p) && p.initializer === n) {
          if (ts.isObjectBindingPattern(p.name)) {
            if (!prendeError(p.name)) segna(n, 'error-non-legato');
          } else if (ts.isIdentifier(p.name)) {
            if (!leggeError(contenitore(n), p.name.text)) segna(n, 'error-mai-letto');
          }
        }
        // Ogni altro contesto — `return await …`, `if (await …)`, un argomento —
        // consegna il risultato a qualcuno: non è questa misura a giudicarlo.
      }
    }
    ts.forEachChild(n, visita);
  };

  ts.forEachChild(sf, visita);
  return punti.sort((a, b) => a.riga - b.riga);
}

function tuttiIFile(dir) {
  const out = [];
  for (const nome of readdirSync(dir)) {
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) out.push(...tuttiIFile(p));
    else if (nome.endsWith('.ts')) out.push(p);
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// IL NUMERO DICHIARATO — la cricca che impedisce alla misura di scivolare.
//
// ⚠️ Il confronto è di UGUAGLIANZA, nei due sensi, ed è voluto:
//   · più punti di così = ne è stato aggiunto uno nuovo, e va visto;
//   · meno = ne è stato corretto uno, e allora questo numero e la pagina di
//     stato vanno aggiornati NELLO STESSO commit che lo corregge. È l'unico
//     modo perché il conteggio scritto non invecchi: qui è un test rosso,
//     mentre in una pagina sarebbe solo una frase vecchia.
//
// ⚠️⚠️ E NON SI SOTTRAE AI NUMERI DI PRIMA. Sul difetto sono state fatte più
// misure con criteri diversi, e mescolarle è un conto a memoria:
//     189         triage a otto letture parallele, criteri di ciascun lettore
//     193 → 147   un grep, ma CIECO su `email/store.ts` (il byte NUL)
//     137         la prima stesura di questo file, a regex, che ne mancava ~28%
//     190         questo, col parser TypeScript
// Vale l'ultimo, e vale perché lo si rifà.
// ---------------------------------------------------------------------------
export const ATTESI = {
  totale: 190,
  quando: '2026-08-11, col parser TypeScript, sul perimetro intero — compreso `email/store.ts`, '
    + 'che fino a quel giorno nessuna scansione aveva letto',
};

// ---------------------------------------------------------------------------
// Autoverifica.
// ---------------------------------------------------------------------------
if (process.argv.includes('--self-test')) {
  const casi = [
    { nome: 'await nudo', src: "async function f(sb) { await sb.from('t').delete(); }", atteso: ['await-nudo'] },
    { nome: 'destrutturazione senza error', src: "async function f(sb) { const { data } = await sb.from('t').select(); return data; }", atteso: ['error-non-legato'] },
    // ⚠️ Il caso che la stesura a regex NON vedeva: la chiave non è `data`.
    { nome: 'destrutturazione di `count`, non di `data`', src: "async function f(sb) { const { count } = await sb.from('t').select('*', { count: 'exact' }); return count; }", atteso: ['error-non-legato'] },
    { nome: 'risultato legato e .error mai letto', src: "async function f(sb) { const r = await sb.from('t').select(); return r.data; }", atteso: ['error-mai-letto'] },
    // LE CONTROPROVE: le forme CORRETTE non devono contare, altrimenti correggere
    // un punto non farebbe scendere il numero e la cricca sarebbe inservibile.
    { nome: 'destrutturazione CON error', src: "async function f(sb) { const { data, error } = await sb.from('t').select(); if (error) throw error; return data; }", atteso: [] },
    { nome: 'error con alias', src: "async function f(sb) { const { data, error: e } = await sb.from('t').select(); if (e) throw e; return data; }", atteso: [] },
    { nome: 'risultato legato e .error LETTO', src: "async function f(sb) { const r = await sb.from('t').select(); if (r.error) throw r.error; return r.data; }", atteso: [] },
    { nome: 'risultato passato a un aiuto', src: "async function f(sb) { const r = await sb.from('t').select(); return letto(r, 'CODICE'); }", atteso: [] },
    { nome: 'risultato restituito', src: "async function f(sb) { return await sb.from('t').select(); }", atteso: [] },
    { nome: 'risultato dentro una condizione', src: "async function f(sb) { if (await sb.from('t').select()) return 1; return 0; }", atteso: [] },
    { nome: 'await che non è il database', src: 'async function f() { await sleep(10); }', atteso: [] },
    { nome: 'await su un client sconosciuto', src: "async function f(pippo) { await pippo.from('t').delete(); }", atteso: [] },
    // Promise.all, le due varianti — invisibili alla stesura a regex.
    { nome: 'Promise.all, destrutturazione senza error', src: "async function f(sb) { const [{ data: a }, { data: b }] = await Promise.all([sb.from('x').select(), sb.from('y').select()]); return [a, b]; }", atteso: ['error-non-legato', 'error-non-legato'] },
    { nome: 'Promise.all, uno controllato e uno no', src: "async function f(sb) { const [a, b] = await Promise.all([sb.from('x').select(), sb.from('y').select()]); if (a.error) throw a.error; return b.data; }", atteso: ['error-mai-letto'] },
    { nome: 'Promise.all con entrambi controllati', src: "async function f(sb) { const [a, b] = await Promise.all([sb.from('x').select(), sb.from('y').select()]); if (a.error || b.error) throw new Error('no'); return 1; }", atteso: [] },
    // ⚠️ LA RIPARAZIONE NON DEVE CONTARE COME DIFETTO. I caricatori di
    // `automation/store.ts` sono stati corretti il 2026-08-11 mettendo l'errore
    // dentro un aiuto che SOLLEVA, agganciato con `.then`. La prima stesura di
    // questo scanner li contava lo stesso — segnava come difetto la sua cura.
    { nome: 'l’errore delegato a `.then(r => letto(r, …))`', src: "async function f(sb) { const [a] = await Promise.all([sb.from('x').select().then((r) => letto(r, 'C'))]); return a; }", atteso: [] },
    { nome: 'l’errore delegato a `.catch`', src: "async function f(sb) { const r = await sb.from('x').select().catch(() => { throw new Error('C'); }); return r; }", atteso: [] },
    // ⚠️ Il parser non si fa ingannare da un commento che CITA la forma: la
    // stesura a regex doveva togliere i commenti a mano per non salire
    // scrivendo documentazione.
    { nome: 'la forma citata in un commento', src: "// const { data } = await sb.from('t').select();\nasync function f() { return 1; }", atteso: [] },
    { nome: 'la forma citata in una stringa', src: "const nota = \"const { data } = await sb.from('t')\";", atteso: [] },
    // ⚠️ E il caso che ha motivato tutto: un file con un byte NUL crudo dentro.
    // grep lo saltava; qui si conta.
    { nome: 'un file con un NUL crudo si conta lo stesso', src: "const sep = 'a\u0000b';\nasync function f(sb) { const { data } = await sb.from('t').select(); return data; }", atteso: ['error-non-legato'] },
  ];

  let falliti = 0, eseguite = 0;
  console.log(`\n  ${B}fallback:scan — autoverifica delle regole${X}\n`);
  for (const c of casi) {
    eseguite++;
    const trovati = esamina('prova.ts', c.src).map((p) => p.forma).sort();
    const atteso = [...c.atteso].sort();
    if (JSON.stringify(trovati) === JSON.stringify(atteso)) {
      console.log(`    ${G}✓${X} ${c.nome} ${DIM}→ [${trovati.join(', ') || '—'}]${X}`);
    } else {
      falliti++;
      console.error(`    ${R}✗${X} ${c.nome}: attesi [${atteso.join(', ')}], trovati [${trovati.join(', ')}]`);
    }
  }

  // La riga indicata deve essere quella giusta, o l'elenco non serve a trovare
  // niente. ⚠️ Provata su TUTTE le forme: la stesura a regex la provava su una
  // sola, e l'altra ha portato un fuori-di-uno fino al primo controllo a mano.
  const righe = [
    { nome: 'await nudo', src: 'async function f(sb) {\n  await sb.from(\'t\').delete();\n}', atteso: 2 },
    { nome: 'destrutturazione', src: 'async function f(sb) {\n  const x = 1;\n  const { data } = await sb.from(\'t\').select();\n  return [x, data];\n}', atteso: 3 },
    { nome: 'error mai letto', src: 'async function f(sb) {\n\n\n  const r = await sb.from(\'t\').select();\n  return r.data;\n}', atteso: 4 },
  ];
  for (const c of righe) {
    eseguite++;
    const p = esamina('prova.ts', c.src);
    if (p.length === 1 && p[0].riga === c.atteso) {
      console.log(`    ${G}✓${X} la riga indicata è quella del punto (${c.nome}) ${DIM}→ ${c.atteso}${X}`);
    } else {
      falliti++;
      console.error(`    ${R}✗${X} riga sbagliata (${c.nome}): attesa ${c.atteso}, ${JSON.stringify(p)}`);
    }
  }

  console.log(`\n  ${DIM}⚠️ Limite noto e dichiarato: il client si riconosce dai NOMI`);
  console.log(`  (${[...CLIENT].join(', ')}). Un client battezzato altrimenti non verrebbe contato.${X}\n`);
  if (falliti) { console.error(`  ${R}${falliti} casi falliti${X}\n`); process.exit(1); }
  console.log(`  ${G}Tutte le regole si comportano come devono${X} ${DIM}(${eseguite} prove)${X}\n`);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// La misura.
// ---------------------------------------------------------------------------
const file = tuttiIFile(PERIMETRO);
const perFile = new Map();
const perForma = new Map(Object.keys(FORME).map((k) => [k, 0]));
let totale = 0;

for (const f of file) {
  // ⚠️ Si legge il BUFFER e si decodifica qui: nessuno strumento intermedio
  // decide per noi che cosa sia testo. È tutta la differenza con grep.
  const punti = esamina(relative(ROOT, f), readFileSync(f).toString('utf8'));
  if (!punti.length) continue;
  perFile.set(relative(ROOT, f), punti);
  for (const p of punti) perForma.set(p.forma, perForma.get(p.forma) + 1);
  totale += punti.length;
}

const report = process.argv.includes('--report');

console.log(`\n  ${B}Fallback silenziosi nelle Edge Function${X}`);
console.log(`  ${DIM}${file.length} file .ts letti byte per byte e analizzati col parser TypeScript${X}\n`);

for (const [id, f] of Object.entries(FORME)) {
  console.log(`    ${String(perForma.get(id)).padStart(4)}  ${f.titolo} ${DIM}(${id})${X}`);
}
console.log(`    ${B}${String(totale).padStart(4)}  in ${perFile.size} file${X}\n`);

for (const [nome, punti] of [...perFile.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`    ${String(punti.length).padStart(3)}  ${nome}`);
  if (report) for (const p of punti) console.log(`         ${DIM}:${p.riga}  ${p.forma}${X}`);
}
if (!report) console.log(`\n  ${DIM}Riga per riga: npm run fallback:scan -- --report${X}`);

console.log('');
if (totale === ATTESI.totale) {
  console.log(`  ${G}${totale} punti, quanti ne sono dichiarati${X} ${DIM}(misurati il ${ATTESI.quando})${X}`);
  console.log(`  ${DIM}⚠️ Fuori da questo numero, dichiarati in testa al file: 12 punti in cui l'errore è`);
  console.log(`  LETTO e poi collassato su un valore plausibile. Per deciderli serve una lettura.${X}\n`);
  process.exit(0);
}
if (totale > ATTESI.totale) {
  console.error(`  ${R}${totale} punti, ${totale - ATTESI.totale} PIÙ dei ${ATTESI.totale} dichiarati.${X}`);
  console.error(`  ${Y}È stato aggiunto un fallback silenzioso. Se è voluto, va discusso, non solo contato.${X}\n`);
  process.exit(1);
}
console.error(`  ${Y}${totale} punti, ${ATTESI.totale - totale} MENO dei ${ATTESI.totale} dichiarati — sono stati corretti.${X}`);
console.error(`  Aggiorna \`ATTESI.totale\` a ${B}${totale}${X} in scripts/fallback-scan.mjs, e con esso la tabella di`);
console.error(`  docs/product-status.md, ${B}nello stesso commit che li corregge${X}: è così che il numero`);
console.error(`  scritto non invecchia.\n`);
process.exit(1);
