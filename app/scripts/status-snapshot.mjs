#!/usr/bin/env node
// ============================================================================
// status — lo stato del prodotto, MISURATO adesso e scritto in un file solo.
//   npm run status                    → scrive ./stato-attuale.md
//   npm run status -- --out X.md      → scrive dove dici tu
//   npm run status -- --stdout        → lo stampa e basta
//
// ⚠️ PERCHÉ ESISTE. `docs/product-status.md` dice benissimo che cosa il SOFTWARE
// fa e non fa, ma non può dire quanto viene USATO: quel numero vive solo nel
// database, e chi legge il repository non lo vede. Questo comando lo va a
// prendere, insieme allo stato di git e delle PR, e produce un foglio unico da
// dare a chi non ha accesso a questa macchina.
//
// ⚠️⚠️ NON È UN CRUSCOTTO E NON SI AGGIORNA DA SÉ. Ogni riga porta l'istante in
// cui è stata misurata, perché un foglio senza data invecchia in silenzio ed è
// esattamente la bugia contro cui è costruito il resto del progetto: chi lo
// rilegge fra una settimana deve vedere QUANDO è stato misurato, non credere
// che sia di adesso.
//
// ⚠️ NESSUN RIPIEGO. Se una misura non si può prendere, la riga lo DICE e il
// comando esce 3: un foglio con «0 aziende» perché la connessione è caduta
// sarebbe peggio di nessun foglio.
//
// Non stampa MAI una chiave: dell'ambiente verifica che i nomi esistano.
// ============================================================================
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

const args = process.argv.slice(2);
const outArg = args.indexOf('--out');
const OUT = outArg >= 0 ? args[outArg + 1] : join(APP, 'stato-attuale.md');
const TO_STDOUT = args.includes('--stdout');

// ---------------------------------------------------------------------------
// LE FRASI CONDIZIONALI DEL FOGLIO, come funzioni pure.
//
// ⚠️ PERCHÉ. Fino al 2026-08-10 l'avviso «main non contiene il lavoro recente»
// era una riga fissa del modello: stampata anche il giorno in cui la misura
// diceva ramo `main` e zero commit non uniti — una frase falsa in un foglio
// costruito per dire solo cose misurate. Stessa malattia per «Le PR aperte»:
// con l'elenco vuoto ([] è truthy) restava l'intestazione orfana, e una
// sezione vuota non dice «nessuna», dice «boh». Le frasi che dipendono da una
// misura si calcolano DALLA misura, e da funzioni pure: così i casi che devono
// farle tacere si possono provare senza rompere il progetto vero.
// ---------------------------------------------------------------------------

/** L'avviso di coda: esiste solo se ESISTE lavoro che main non contiene.
 *  `sopraMain` è l'output di `git log --oneline origin/main..HEAD`:
 *  '' = allineato, null = non misurato — in entrambi i casi l'affermazione
 *  non è provata, e una frase non provata non si stampa. */
export function rigaAvvisoMain(sopraMain) {
  if (!sopraMain) return '';
  return '\n⚠️ `main` non contiene il lavoro recente: il ramo aggiornato è quello indicato qui sopra.\n';
}

/** La sezione delle PR: con l'elenco misurato e vuoto lo DICE («Nessuna»),
 *  senza misura tace — il blocco ⛔ in testata ha già dichiarato il perché. */
export function sezionePrAperte(pr) {
  if (pr === null) return '';
  if (!pr.length) return '### Le PR aperte\n\nNessuna.\n';
  return `### Le PR aperte\n\n${pr.map((p) => `- **#${p.number}** ${p.title} → \`${p.baseRefName}\``).join('\n')}\n`;
}

/** Le misure git che NON si sono potute prendere — CONTATE, non solo scritte.
 *
 *  ⚠️ PERCHÉ. Fino al 2026-08-12 il contatore cresceva SOLO se mancava la
 *  cartella del monorepo: con la cartella presente e un comando git fallito
 *  (origin/main non risolto, ref mai fetchato) le righe del foglio dicevano
 *  «non misurato» ma l'intestazione diceva «Tutte le misure sono state prese»
 *  e l'uscita era 0. È la bugia che l'intestazione di questo file dichiara di
 *  impedire, e sta nel codice di uscita — l'unica cosa che un'automazione
 *  legge. `null` = il comando è fallito; `''` è una MISURA (albero allineato
 *  per i commit, HEAD staccato per il ramo), non un guasto. */
export function misureGitMancanti({ hasMono, ramo, sopraMain }) {
  if (!hasMono) return ['stato del monorepo (cartella non trovata)'];
  const mancanti = [];
  if (ramo === null) mancanti.push('ramo di lavoro nel monorepo (git non ha risposto)');
  if (sopraMain === null) mancanti.push('commit sopra origin/main (git non ha risposto: origin/main non risolto o mai fetchato?)');
  return mancanti;
}

// Ogni caso porta l'esito atteso; i negativi (la frase che DEVE tacere) sono
// il motivo per cui queste funzioni esistono — l'avviso fisso li sbagliava
// tutti, ed è il caso su cui questa autoverifica è stata vista fallire.
const SELF_TEST_CASES = [
  { name: 'commit non uniti: l\'avviso c\'è', run: () => rigaAvvisoMain('abc123 improve: x\ndef456 fix: y').includes('⚠️') },
  { name: 'albero allineato: l\'avviso tace', run: () => rigaAvvisoMain('') === '' },
  { name: 'monorepo non misurato: l\'avviso tace', run: () => rigaAvvisoMain(null) === '' },
  { name: 'una PR aperta: compare col suo numero', run: () => sezionePrAperte([{ number: 23, title: 't', baseRefName: 'main' }]).includes('**#23**') },
  { name: 'elenco misurato e vuoto: «Nessuna», non un\'intestazione orfana', run: () => sezionePrAperte([]).includes('Nessuna.') },
  { name: 'PR non misurate: la sezione tace', run: () => sezionePrAperte(null) === '' },
  // --- il contatore delle misure git: il caso che usciva 0 mentendo ---------
  { name: 'cartella del monorepo assente: UNA voce, la cartella', run: () => { const m = misureGitMancanti({ hasMono: false, ramo: null, sopraMain: null }); return m.length === 1 && m[0].includes('cartella'); } },
  { name: '⚠️ IL CASO REALE: cartella presente, origin/main non risolto → la misura mancante si CONTA', run: () => misureGitMancanti({ hasMono: true, ramo: 'main', sopraMain: null }).some((m) => m.includes('origin/main')) },
  { name: 'ramo non letto da git: si conta anche quello', run: () => misureGitMancanti({ hasMono: true, ramo: null, sopraMain: '' }).some((m) => m.includes('ramo')) },
  { name: 'tutto misurato (albero allineato): zero voci — \'\' è una misura, non un guasto', run: () => misureGitMancanti({ hasMono: true, ramo: 'main', sopraMain: '' }).length === 0 },
];
const selfTestFailures = SELF_TEST_CASES.filter((c) => !c.run());

// ⚠️ PRIMA del controllo sull'ambiente: l'autoverifica non ha bisogno di
// credenziali (come check:auth:self-test), e gira comunque a ogni esecuzione —
// se le frasi sono rotte, il foglio non va nemmeno scritto.
if (args.includes('--self-test')) {
  console.log('\nAutoverifica delle frasi condizionali\n');
  for (const c of SELF_TEST_CASES) console.log(`  ${selfTestFailures.includes(c) ? '✗' : '✓'} ${c.name}`);
  if (selfTestFailures.length) {
    console.error(`\n  ${selfTestFailures.length} casi non superati: il foglio mentirebbe.\n`);
    process.exit(1);
  }
  console.log('\n  Tutti i casi superati.\n');
  process.exit(0);
}
if (selfTestFailures.length) {
  console.error(`${R}Le frasi condizionali non superano l'autoverifica: niente foglio.${X}`);
  console.error(`  Esegui: npm run status:self-test`);
  process.exit(1);
}

const URL = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !SERVICE) {
  console.error(`${R}Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY: eseguire con --env-file=.env.test${X}`);
  process.exit(2);
}

/** Le cose che non si sono potute misurare. Se ce n'è una, il comando esce 3. */
const nonMisurato = [];

// ---------------------------------------------------------------------------
// 1. L'USO REALE — l'unica parte che nessun file del repository contiene.
//
// Le tabelle si contano una per una e non con un giro su `information_schema`:
// l'elenco È la domanda («quanto viene usato ciascun modulo»), e va letto.
// ---------------------------------------------------------------------------
const TABELLE = [
  ['aziende', 'companies'],
  ['utenti con accesso', 'company_members'],
  ['documenti', 'documents'],
  ['analisi documento', 'document_analyses'],
  ['correzioni umane', 'analysis_corrections'],
  ['email sincronizzate', 'email_messages'],
  ['attività', 'tasks'],
  ['contratti', 'contracts'],
  ['letture di contratto', 'contract_extractions'],
  ['organizzazioni CRM', 'crm_organizations'],
  ['progetti incentivi', 'subsidy_projects'],
  ['pratiche incentivi', 'subsidy_cases'],
  ['conversazioni assistente', 'assistant_threads'],
  ['regole di automazione', 'workflow_definitions'],
  ['voci finanziarie', 'finance_items'],
  ['notifiche', 'notifications'],
  ['righe di registro (0039)', 'audit_logs'],
];

async function conta(tabella) {
  const r = await fetch(`${URL}/rest/v1/${tabella}?select=id`, {
    method: 'HEAD',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, Prefer: 'count=exact' },
  });
  if (!r.ok) return null;
  // PostgREST risponde `0-24/148`: il totale è dopo la barra.
  const range = r.headers.get('content-range');
  const n = range?.split('/')?.[1];
  return n && n !== '*' ? Number(n) : null;
}

console.log(`${B}Misuro lo stato…${X} ${DIM}(${URL.replace(/^https?:\/\//, '').split('/')[0]})${X}`);

const uso = [];
for (const [etichetta, tabella] of TABELLE) {
  const n = await conta(tabella);
  if (n === null) nonMisurato.push(`conteggio di ${tabella}`);
  uso.push([etichetta, n]);
}

// ---------------------------------------------------------------------------
// 2. LE MIGRAZIONI — sul disco e sul database, perché le due cose divergono.
// ---------------------------------------------------------------------------
const suDisco = readdirSync(join(APP, 'supabase', 'migrations')).filter((f) => f.endsWith('.sql')).sort();
// ⚠️ `supabase_migrations` NON è fra gli schemi esposti da PostgREST, e non deve
// esserlo: è la contabilità interna del database. Si legge dall'API di gestione,
// che vuole un token DIVERSO dalla service key —
//   SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
// Senza quel token la riga resta «non misurato» e il comando esce 3: dire «39»
// perché sul disco ce ne sono 39 sarebbe dedurre, non misurare, ed è esattamente
// la differenza che questo file esiste per non perdere.
let applicate = null;
const MGMT = process.env.SUPABASE_ACCESS_TOKEN;
const PROJECT = /https?:\/\/([a-z0-9]+)\.supabase\.co/.exec(URL)?.[1] ?? null;
if (MGMT && PROJECT) {
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/database/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MGMT}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: 'select count(*)::int as n from supabase_migrations.schema_migrations' }),
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(String(r.status));
    applicate = (await r.json())[0]?.n ?? null;
    if (applicate === null) throw new Error('risposta vuota');
  } catch {
    nonMisurato.push('migrazioni applicate (API di gestione non ha risposto)');
  }
} else {
  nonMisurato.push('migrazioni applicate (serve SUPABASE_ACCESS_TOKEN: vedi il commento nello script)');
}

// ---------------------------------------------------------------------------
// 3. IL BUNDLE SERVITO — dice se il lavoro è arrivato agli utenti o no.
// ---------------------------------------------------------------------------
let bundle = null;
try {
  const html = await fetch('https://app.ai-swisse.com/', { signal: AbortSignal.timeout(15000) }).then((r) => r.text());
  bundle = /index-[A-Za-z0-9_-]+\.js/.exec(html)?.[0] ?? null;
  if (!bundle) nonMisurato.push('bundle servito dal dominio');
} catch {
  nonMisurato.push('bundle servito dal dominio (dominio non raggiungibile)');
}

// ---------------------------------------------------------------------------
// 4. GIT E PR — dove sta il lavoro che non è ancora degli utenti.
// ---------------------------------------------------------------------------
const git = (cwd, ...a) => {
  try { return execFileSync('git', a, { cwd, encoding: 'utf8' }).trim(); } catch { return null; }
};
const MONO = resolve(APP, '..', 'swiss-ai-suite-repo');
const hasMono = existsSync(join(MONO, '.git'));
const ramo = hasMono ? git(MONO, 'branch', '--show-current') : null;
const sopraMain = hasMono ? git(MONO, 'log', '--oneline', 'origin/main..HEAD') : null;
// ⚠️ Il conteggio lo fa la funzione pura qui sopra, provata anche sul caso che
// fino al 2026-08-12 usciva 0 mentendo: cartella presente, git muto.
nonMisurato.push(...misureGitMancanti({ hasMono, ramo, sopraMain }));

let pr = null;
try {
  pr = execFileSync('gh', ['pr', 'list', '--state', 'open', '--json', 'number,title,baseRefName'],
    { cwd: MONO, encoding: 'utf8' });
  pr = JSON.parse(pr).sort((a, b) => a.number - b.number);
} catch {
  nonMisurato.push('elenco delle PR aperte (gh non disponibile o non autenticato)');
}

// ---------------------------------------------------------------------------
// 5. IL FOGLIO
// ---------------------------------------------------------------------------
const ora = new Date();
const quando = ora.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
const riga = ([k, v]) => `| ${k} | ${v === null ? '**non misurato**' : v} |`;

const md = `# AI-Swisse — stato misurato il ${quando}

> ⚠️ Questo foglio **non si aggiorna da solo**. Ogni numero qui dentro è stato
> misurato all'istante scritto sopra, interrogando la produzione e leggendo git.
> Per rifarlo: \`npm run status\` nella cartella dell'app.
${nonMisurato.length ? `\n> ⛔ **${nonMisurato.length} misure NON sono state prese** e sono marcate come tali:\n> ${nonMisurato.join('; ')}.\n` : ''}
## Quanto viene usato, davvero

| | |
|---|---|
${uso.map(riga).join('\n')}

## Schema

| | |
|---|---|
| migrazioni sul disco | ${suDisco.length} (ultima: \`${suDisco[suDisco.length - 1] ?? '—'}\`) |
| migrazioni applicate in produzione | ${applicate === null ? '**non misurato**' : applicate} |
| allineate | ${applicate === null ? '**non misurato**' : (applicate === suDisco.length ? 'sì' : `**NO** — ${suDisco.length - applicate} in attesa`)} |

## È arrivato agli utenti?

| | |
|---|---|
| bundle servito da app.ai-swisse.com | ${bundle ? `\`${bundle}\`` : '**non misurato**'} |
| ramo di lavoro nel monorepo | ${ramo === null ? '**non misurato**' : (ramo === '' ? '`HEAD staccato` (nessun ramo)' : `\`${ramo}\``)} |
| commit sopra \`origin/main\` non uniti | ${sopraMain === null ? '**non misurato**' : (sopraMain ? sopraMain.split('\n').length : 0)} |

${sopraMain ? `### I commit non ancora su \`main\`\n\n${sopraMain.split('\n').map((l) => `- ${l}`).join('\n')}\n` : ''}
${sezionePrAperte(pr)}
## Dove leggere il resto

- stato dichiarato modulo per modulo: \`docs/product-status.md\` (tabella «I moduli», con le sei parole e la colonna «clienti esterni»)
- limiti di prodotto: \`README.md\` → «Limitazioni attuali (dichiarate, non nascoste)»
- che cosa sta cambiando: le PR aperte su https://github.com/ditrue83-svg/swiss-ai-suite/pulls
- il diario di bordo: i messaggi di commit (non esiste un CHANGELOG: la ragione di ogni riga sta nel suo commit)
${rigaAvvisoMain(sopraMain)}`;

if (TO_STDOUT) {
  console.log(md);
} else {
  writeFileSync(OUT, md, 'utf8');
  console.log(`\n${G}✓${X} scritto ${B}${OUT}${X} ${DIM}(${md.split('\n').length} righe)${X}`);
}

if (nonMisurato.length > 0) {
  console.log(`\n${Y}INCOMPLETO — ${nonMisurato.length} misure non prese:${X}`);
  for (const m of nonMisurato) console.log(`  · ${m}`);
  console.log(`${DIM}Il foglio le marca «non misurato» invece di scrivere uno zero.${X}`);
  process.exit(3);
}
console.log(`${G}Tutte le misure sono state prese.${X}`);
