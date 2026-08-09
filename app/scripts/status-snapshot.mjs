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
if (!hasMono) nonMisurato.push('stato del monorepo (cartella non trovata)');

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
| ramo di lavoro nel monorepo | ${ramo ? `\`${ramo}\`` : '**non misurato**'} |
| commit sopra \`origin/main\` non uniti | ${sopraMain === null ? '**non misurato**' : (sopraMain ? sopraMain.split('\n').length : 0)} |

${sopraMain ? `### I commit non ancora su \`main\`\n\n${sopraMain.split('\n').map((l) => `- ${l}`).join('\n')}\n` : ''}
${pr ? `### Le PR aperte\n\n${pr.map((p) => `- **#${p.number}** ${p.title} → \`${p.baseRefName}\``).join('\n')}\n` : ''}
## Dove leggere il resto

- stato dichiarato modulo per modulo: \`docs/product-status.md\` (tabella «I moduli», con le sei parole e la colonna «clienti esterni»)
- limiti di prodotto: \`README.md\` → «Limitazioni attuali (dichiarate, non nascoste)»
- che cosa sta cambiando: le PR aperte su https://github.com/ditrue83-svg/swiss-ai-suite/pulls
- il diario di bordo: i messaggi di commit (non esiste un CHANGELOG: la ragione di ogni riga sta nel suo commit)

⚠️ \`main\` non contiene il lavoro recente: il ramo aggiornato è quello indicato qui sopra.
`;

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
