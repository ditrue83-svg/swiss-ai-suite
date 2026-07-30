#!/usr/bin/env node
// ============================================================================
// run-test-suite — un solo modo di eseguire la suite, e un solo posto dove è
// scritto che cosa serve a ciascun test.
//
// ⚠️ PERCHÉ ESISTE. Fino a oggi i trenta comandi di `package.json` erano
// l'unico elenco, e l'elenco non diceva la cosa che conta di più: **che cosa
// serve per eseguirli**. Tre test spendono credito Anthropic vero, quattordici
// scrivono nel database di produzione, tredici non hanno bisogno di niente.
// Chi non lo sapeva a memoria aveva due sole scelte: eseguire tutto (e pagare),
// o eseguire a caso (e non sapere che cosa aveva provato).
//
// LA REGOLA DI QUESTO FILE. Un gruppo che non si può eseguire non è verde e non
// è rosso: è **SALTATO, con la ragione scritta**. Un runner che tace su ciò che
// non ha eseguito è la stessa bugia di un controllo che dà un verde falso — e
// questo repository l'ha già pagata due volte, con `i18n:coverage` e con i
// permessi della 0013.
//
//   node scripts/run-test-suite.mjs <gruppo…> [opzioni]
//
//   gruppi        quality · unit · db · integration · eval   (oppure `all`)
//   --list        mostra i gruppi, i passi e ciò che richiedono. Non esegue.
//   --continue-on-error   prosegue dopo un fallimento (uso locale).
//                 Senza questa, ci si ferma al primo rosso: è la modalità CI.
//   --allow-ai    autorizza i gruppi che SPENDONO CREDITO ANTHROPIC.
//                 Senza, vengono saltati e dichiarati. Nessuna esecuzione
//                 accidentale: la spesa si chiede, non si eredita.
//   --no-skip     un gruppo saltato diventa un FALLIMENTO. Da usare dove
//                 l'ambiente deve essere completo (il job database della CI).
//
// COSA NON FA
//   · non stampa mai il VALORE di una variabile d'ambiente: legge i NOMI
//     presenti in `.env.test` e si ferma lì;
//   · non inventa credenziali e non ne scrive;
//   · non cambia il significato di nessun test: esegue gli stessi
//     `npm run …` che esistevano prima, nello stesso ordine deterministico.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

// ---------------------------------------------------------------------------
// I REQUISITI — dichiarati una volta, non ripetuti su ogni passo.
//
// `env` non verifica che le credenziali FUNZIONINO: verifica che i nomi
// attesi esistano in `.env.test`. Se una chiave è sbagliata lo dirà il test,
// con il suo errore, che è più informativo di qualunque cosa possa dire qui.
// ---------------------------------------------------------------------------
const REQUIREMENTS = {
  env: {
    label: '.env.test con le credenziali Supabase',
    check: () => {
      const path = join(APP, '.env.test');
      if (!existsSync(path)) return { ok: false, why: '.env.test non esiste' };
      // Solo i NOMI. Il valore non entra mai in questo processo se non
      // attraverso `--env-file` di Node, che lo passa al figlio.
      const names = new Set(
        readFileSync(path, 'utf8')
          .split('\n')
          .map((l) => /^([A-Z0-9_]+)=/.exec(l.trim())?.[1])
          .filter(Boolean),
      );
      const missing = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'].filter((k) => !names.has(k));
      return missing.length
        ? { ok: false, why: `in .env.test mancano: ${missing.join(', ')}` }
        : { ok: true };
    },
  },
  ai: {
    label: 'autorizzazione a spendere credito Anthropic',
    check: (opts) => (opts.allowAi
      ? { ok: true }
      : { ok: false, why: 'spende credito Anthropic vero: serve --allow-ai (o AISWISSE_ALLOW_AI=1)' }),
  },
};

// ---------------------------------------------------------------------------
// I GRUPPI
//
// ⚠️ L'ordine dei passi è deterministico e voluto: i controlli che falliscono
// in un secondo vengono prima di quelli che ne impiegano trenta. Chi ha
// dimenticato una traduzione lo scopre subito, non dopo tre minuti.
//
// ⚠️ `db` NON contiene i test che chiamano `analyze-document`: quella funzione
// spende credito lato server anche quando lo script non tocca la chiave.
// «Non costa niente perché la chiave non è nel mio file» è falso, ed è
// esattamente il tipo di ragionamento che questo progetto evita altrove.
// ---------------------------------------------------------------------------
const GROUPS = {
  quality: {
    title: 'Qualità — nessuna credenziale, nessuna rete',
    needs: [],
    steps: [
      { script: 'typecheck' },
      { script: 'i18n:coverage' },
      { script: 'i18n:typography' },
      { script: 'docs:check' },
      { script: 'db:bundle', args: ['--check'] },
      { script: 'build' },
    ],
  },
  unit: {
    title: 'Unità — nessuna credenziale, nessuna rete',
    needs: [],
    steps: [
      { script: 'test:uid' },
      { script: 'test:routing' },
      { script: 'test:validate' },
      { script: 'test:inbox-unit' },
      { script: 'test:tasks-unit' },
      { script: 'test:documents-unit' },
      { script: 'test:calendar-unit' },
      { script: 'test:workflows-unit' },
      { script: 'test:finance-unit' },
      { script: 'test:contracts-unit' },
      { script: 'test:crm-unit' },
      { script: 'test:assistant-unit' },
      { script: 'test:subsidy-unit' },
    ],
  },
  db: {
    title: 'Database — richiede .env.test · NON spende credito AI',
    needs: ['env'],
    steps: [
      { script: 'check:auth' },
      { script: 'subsidy:health' },
      { script: 'test:phase1' },
      { script: 'test:functions' },
      { script: 'test:tasks' },
      { script: 'test:inbox' },
      { script: 'test:calendar' },
      { script: 'test:contracts' },
      { script: 'test:assistant' },
      { script: 'test:documents' },
      { script: 'test:crm' },
      { script: 'test:finance' },
      { script: 'test:workflows' },
    ],
  },
  integration: {
    title: 'Integrazione — richiede .env.test · SPENDE credito AI',
    needs: ['env', 'ai'],
    steps: [
      { script: 'test:phase2' },
      { script: 'test:async' },
      { script: 'test:pipeline' },
    ],
  },
  eval: {
    title: 'Valutazioni AI — richiede .env.test · SPENDE credito AI',
    needs: ['env', 'ai'],
    steps: [
      { script: 'eval:subsidy' },
      { script: 'eval:admin' },
      { script: 'eval:assistant' },
    ],
  },
};

const ALL = ['quality', 'unit', 'db'];

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    list: false,
    continueOnError: false,
    allowAi: process.env.AISWISSE_ALLOW_AI === '1',
    noSkip: false,
    groups: [],
  };
  for (const a of argv) {
    if (a === '--list') opts.list = true;
    else if (a === '--continue-on-error') opts.continueOnError = true;
    else if (a === '--allow-ai') opts.allowAi = true;
    else if (a === '--no-skip') opts.noSkip = true;
    else if (a.startsWith('--')) {
      console.error(`${R}opzione sconosciuta: ${a}${X}`);
      process.exit(2);
    } else if (a === 'all') opts.groups.push(...ALL);
    else if (GROUPS[a]) opts.groups.push(a);
    else {
      console.error(`${R}gruppo sconosciuto: ${a}${X}`);
      console.error(`${DIM}gruppi disponibili: ${Object.keys(GROUPS).join(' · ')} · all${X}`);
      process.exit(2);
    }
  }
  // Un gruppo chiesto due volte si esegue una volta sola, mantenendo l'ordine.
  opts.groups = [...new Set(opts.groups)];
  return opts;
}

function durata(ms) {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Esegue `npm run <script>` mostrando l'output così com'è. */
function runStep(step) {
  const args = ['run', '--silent', step.script];
  if (step.args?.length) args.push('--', ...step.args);
  const t0 = Date.now();
  const r = spawnSync('npm', args, { cwd: APP, stdio: 'inherit', env: process.env });
  return { code: r.status ?? 1, ms: Date.now() - t0 };
}

function nomeDelPasso(step) {
  return step.args?.length ? `${step.script} ${step.args.join(' ')}` : step.script;
}

// ---------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));

if (opts.groups.length === 0 && !opts.list) {
  console.error(`${R}Nessun gruppo indicato.${X}`);
  console.error(`${DIM}uso: node scripts/run-test-suite.mjs <${Object.keys(GROUPS).join('|')}|all> [--list] [--allow-ai] [--continue-on-error] [--no-skip]${X}`);
  process.exit(2);
}

if (opts.list) {
  console.log(`\n${B}Gruppi della suite${X}\n`);
  for (const [id, g] of Object.entries(GROUPS)) {
    const req = g.needs.length ? g.needs.map((n) => REQUIREMENTS[n].label).join(' + ') : 'niente';
    console.log(`  ${B}${id}${X} ${DIM}— ${g.title}${X}`);
    console.log(`     ${DIM}richiede: ${req}${X}`);
    console.log(`     ${DIM}${g.steps.length} passi: ${g.steps.map(nomeDelPasso).join(', ')}${X}\n`);
  }
  console.log(`  ${DIM}«all» = ${ALL.join(' + ')} — di proposito NON comprende i gruppi che spendono credito.${X}\n`);
  process.exit(0);
}

console.log(`\n${B}Suite AI-Swisse${X} ${DIM}— gruppi: ${opts.groups.join(', ')}${X}`);
if (!opts.continueOnError) console.log(`${DIM}modalità: ci si ferma al primo fallimento (--continue-on-error per proseguire)${X}`);

const esiti = [];
const t0Totale = Date.now();
let fermato = false;

for (const id of opts.groups) {
  const g = GROUPS[id];

  // I requisiti si verificano PRIMA di stampare il titolo del gruppo, così un
  // gruppo saltato non somiglia mai a un gruppo cominciato.
  const mancanti = g.needs
    .map((n) => ({ n, esito: REQUIREMENTS[n].check(opts) }))
    .filter((x) => !x.esito.ok);

  if (mancanti.length) {
    const why = mancanti.map((x) => x.esito.why).join(' · ');
    console.log(`\n${Y}▸ ${id} — SALTATO${X} ${DIM}(${g.steps.length} passi non eseguiti)${X}`);
    console.log(`  ${Y}ragione:${X} ${why}`);
    esiti.push({ id, stato: 'saltato', why, passi: g.steps.length, ms: 0 });
    continue;
  }

  console.log(`\n${B}▸ ${id}${X} ${DIM}— ${g.title}${X}`);
  const t0 = Date.now();
  let falliti = 0;

  for (const step of g.steps) {
    const nome = nomeDelPasso(step);
    console.log(`\n${DIM}  ── ${nome} ───${X}`);
    const { code, ms } = runStep(step);
    if (code === 0) {
      console.log(`  ${G}✓${X} ${nome} ${DIM}${durata(ms)}${X}`);
    } else {
      falliti++;
      console.log(`  ${R}✗ ${nome}${X} ${DIM}${durata(ms)} — exit ${code}${X}`);
      if (!opts.continueOnError) { fermato = true; break; }
    }
  }

  esiti.push({
    id, stato: falliti ? 'rosso' : 'verde', falliti, passi: g.steps.length, ms: Date.now() - t0,
  });
  if (fermato) break;
}

// ---------------------------------------------------------------------------
// Il riepilogo. Tre colonne e non due: «saltato» non è una sfumatura di verde.
// ---------------------------------------------------------------------------
console.log(`\n${B}Riepilogo${X} ${DIM}(${durata(Date.now() - t0Totale)})${X}\n`);
for (const e of esiti) {
  if (e.stato === 'saltato') {
    console.log(`  ${Y}SALTATO${X}  ${e.id.padEnd(12)} ${DIM}${e.passi} passi — ${e.why}${X}`);
  } else if (e.stato === 'verde') {
    console.log(`  ${G}VERDE  ${X}  ${e.id.padEnd(12)} ${DIM}${e.passi} passi — ${durata(e.ms)}${X}`);
  } else {
    console.log(`  ${R}ROSSO  ${X}  ${e.id.padEnd(12)} ${DIM}${e.falliti} su ${e.passi} falliti — ${durata(e.ms)}${X}`);
  }
}

const rossi = esiti.filter((e) => e.stato === 'rosso');
const saltati = esiti.filter((e) => e.stato === 'saltato');
const nonEseguiti = opts.groups.length - esiti.length;

if (nonEseguiti > 0) {
  console.log(`\n  ${Y}${nonEseguiti} gruppi non sono stati eseguiti:${X} ci si è fermati al primo fallimento.`);
}

if (rossi.length) {
  console.log(`\n${R}ESITO: ROSSO${X} — ${rossi.map((e) => e.id).join(', ')}\n`);
  process.exit(1);
}

if (saltati.length && opts.noSkip) {
  console.log(`\n${R}ESITO: ROSSO${X} — ${saltati.length} gruppi saltati con --no-skip attivo.`);
  console.log(`${DIM}  Questo comando è stato invocato dove l'ambiente doveva essere completo.${X}\n`);
  process.exit(1);
}

if (saltati.length) {
  // ⚠️ Verde su ciò che è stato eseguito. Mai «verde» e basta: la frase deve
  // restare impossibile da leggere come «è tutto a posto».
  console.log(`\n${G}ESITO: verde sui gruppi eseguiti${X}${Y} · ${saltati.length} SALTATI${X}`
    + ` ${DIM}(${saltati.map((e) => e.id).join(', ')})${X}\n`);
  process.exit(0);
}

console.log(`\n${G}ESITO: VERDE${X} — tutti i gruppi richiesti sono stati eseguiti.\n`);
process.exit(0);
