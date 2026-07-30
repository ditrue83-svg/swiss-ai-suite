#!/usr/bin/env node
// ============================================================================
// verify:deploy — ciò che il repository NON può sapere di sé stesso.
//
// `npm run test:operations` verifica che gli scheduler siano DICHIARATI, che
// ogni funzione abbia un invocante e che nessun cron dimentichi il timeout.
// Sono controlli su file, e un file non può sapere se quel cron esista davvero
// nel progetto Supabase. Questo comando chiude l'altra metà:
//
//   1. ogni job dell'inventario esiste in `cron.job` ED È ATTIVO;
//   2. ogni job presente nel progetto è nell'inventario (deriva dall'altro lato);
//   3. ogni Edge Function del repository è ACTIVE nel progetto;
//   4. ogni funzione deployata esiste ancora nel repository.
//
// ⚠️ PERCHÉ NON FA PARTE DI `test:all`. Questo comando non giudica il CODICE,
// giudica l'AMBIENTE: può essere rosso su un albero perfetto, e verde su un
// albero rotto. Metterlo fra i test lo renderebbe un cancello che blocca chi
// non ha causato il problema.
//
// ⚠️ SENZA TOKEN QUESTO COMANDO FALLISCE, e non è una svista. Un controllo che
// esce 0 dicendo «non ho potuto verificare» è indistinguibile da un controllo
// che ha verificato: è il difetto che questo repository ha già pagato due volte.
// Chi lo invoca vuole una risposta, non un'assenza di risposta.
//
//   export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w)
//   npm run verify:deploy
// ============================================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CRON_ATTESI } from './test-operations.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error(`${R}✗ Manca SUPABASE_ACCESS_TOKEN.${X}`);
  console.error(`${DIM}  Questo comando interroga il progetto reale: senza token non può`);
  console.error(`  rispondere, e un'assenza di risposta non è un verde.\n`);
  console.error(`  export SUPABASE_ACCESS_TOKEN=$(security find-generic-password -s "Supabase CLI" -w)${X}`);
  process.exit(1);
}

// Il ref si ricava dal sottodominio di SUPABASE_URL, come già documentato.
function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const envTest = join(APP, '.env.test');
  if (existsSync(envTest)) {
    const m = /^SUPABASE_URL=https:\/\/([a-z0-9]+)\.supabase\.co/m.exec(readFileSync(envTest, 'utf8'));
    if (m) return m[1];
  }
  return null;
}

const ref = projectRef();
if (!ref) {
  console.error(`${R}✗ Nessun riferimento di progetto.${X}`);
  console.error(`${DIM}  Imposta SUPABASE_PROJECT_REF, oppure fai in modo che .env.test`);
  console.error(`  contenga SUPABASE_URL.${X}`);
  process.exit(1);
}

// ⚠️ La Management API rifiuta certi User-Agent (urllib prende 403, curl passa).
// Dichiararne uno esplicito evita di dipendere dal default del runtime.
const API = 'https://api.supabase.com/v1';
const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'User-Agent': 'ai-swisse-verify-deploy/1',
};

async function query(sql) {
  const r = await fetch(`${API}/projects/${ref}/database/query`, {
    method: 'POST', headers, body: JSON.stringify({ query: sql }),
  });
  if (!r.ok) throw new Error(`database/query ha risposto ${r.status}`);
  return r.json();
}

async function edgeFunctions() {
  const r = await fetch(`${API}/projects/${ref}/functions`, { headers });
  if (!r.ok) throw new Error(`functions ha risposto ${r.status}`);
  return r.json();
}

const problemi = [];
const add = (what, hint) => problemi.push({ what, hint });

console.log(`\n${B}Verifica del deployment${X} ${DIM}— progetto ${ref}${X}\n`);

let jobs;
let funzioniRemote;
try {
  jobs = await query('select jobname, schedule, active from cron.job order by jobname');
  funzioniRemote = await edgeFunctions();
} catch (e) {
  console.error(`${R}✗ Non è stato possibile interrogare il progetto: ${e.message}${X}`);
  console.error(`${DIM}  Il risultato non sarebbe attendibile: non viene prodotto.${X}`);
  process.exit(1);
}

// --- 1 e 2. Gli scheduler ---------------------------------------------------
const perNome = new Map(jobs.map((j) => [j.jobname, j]));

console.log(`  ${B}Scheduler${X} ${DIM}(${jobs.length} nel progetto · ${Object.keys(CRON_ATTESI).length} nell'inventario)${X}`);
for (const [nome, atteso] of Object.entries(CRON_ATTESI)) {
  const vivo = perNome.get(nome);
  if (!vivo) {
    console.log(`    ${R}✗${X} ${nome.padEnd(22)} ${DIM}atteso ${atteso.cadenza}${X} — ${R}NON ESISTE nel progetto${X}`);
    add(`lo scheduler «${nome}» è dichiarato nel repository ma non esiste nel progetto`,
      atteso.funzione
        ? `«${atteso.funzione}» è deployata e nessuno la chiama: il suo lavoro non viene fatto, e nessun test diventa rosso`
        : 'il lavoro che dovrebbe eseguire non viene eseguito');
  } else if (!vivo.active) {
    console.log(`    ${R}✗${X} ${nome.padEnd(22)} ${DIM}${vivo.schedule}${X} — ${R}esiste ma è DISATTIVATO${X}`);
    add(`lo scheduler «${nome}» esiste ma non è attivo`, 'select cron.alter_job(…, active => true)');
  } else if (vivo.schedule !== atteso.cadenza) {
    console.log(`    ${Y}!${X} ${nome.padEnd(22)} ${DIM}nel progetto ${vivo.schedule}, nell'inventario ${atteso.cadenza}${X}`);
    add(`la cadenza di «${nome}» diverge: progetto «${vivo.schedule}», inventario «${atteso.cadenza}»`,
      'una delle due è stata cambiata senza l\'altra');
  } else {
    console.log(`    ${G}✓${X} ${nome.padEnd(22)} ${DIM}${vivo.schedule}${X}`);
  }
}
for (const j of jobs) {
  if (!CRON_ATTESI[j.jobname]) {
    console.log(`    ${R}✗${X} ${j.jobname.padEnd(22)} ${DIM}${j.schedule}${X} — ${R}nel progetto, in nessun file${X}`);
    add(`lo scheduler «${j.jobname}» esiste nel progetto e in nessun file del repository`,
      'se il database va rifatto non tornerà: dichiaralo nella documentazione del suo modulo '
      + 'e aggiungilo a CRON_ATTESI');
  }
}

// --- 3 e 4. Le Edge Function ------------------------------------------------
const locali = readdirSync(join(APP, 'supabase', 'functions'), { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== '_shared').map((e) => e.name).sort();
const remote = new Map((funzioniRemote ?? []).map((f) => [f.slug, f]));

console.log(`\n  ${B}Edge Function${X} ${DIM}(${locali.length} nel repository · ${remote.size} nel progetto)${X}`);
for (const nome of locali) {
  const f = remote.get(nome);
  if (!f) {
    console.log(`    ${R}✗${X} ${nome.padEnd(22)} ${R}non deployata${X}`);
    add(`«${nome}» esiste nel repository e non è deployata`, 'npx supabase functions deploy ' + nome);
  } else if (f.status !== 'ACTIVE') {
    console.log(`    ${R}✗${X} ${nome.padEnd(22)} stato ${f.status}`);
    add(`«${nome}» è deployata ma il suo stato è ${f.status}`, '');
  } else {
    console.log(`    ${G}✓${X} ${nome.padEnd(22)} ${DIM}v${f.version} · verify_jwt=${f.verify_jwt}${X}`);
  }
}
for (const [slug] of remote) {
  if (!locali.includes(slug)) {
    console.log(`    ${R}✗${X} ${slug.padEnd(22)} ${R}nel progetto, non nel repository${X}`);
    add(`«${slug}» è deployata e il suo codice non è in questo repository`,
      'nessuno potrà rideployarla quando cambia il codice condiviso che usa');
  }
}

// ---------------------------------------------------------------------------
if (!problemi.length) {
  console.log(`\n${G}Ambiente allineato al repository.${X}\n`);
  process.exit(0);
}

console.log(`\n${R}${problemi.length} divergenze fra il repository e il progetto:${X}\n`);
for (const p of problemi) {
  console.log(`  ${R}✗${X} ${p.what}`);
  if (p.hint) console.log(`    ${DIM}${p.hint}${X}`);
}
console.log(`\n${DIM}  Questo comando non corregge niente: creare uno scheduler o deployare una`);
console.log(`  funzione cambia la produzione, ed è una decisione, non un rimedio automatico.${X}\n`);
process.exit(1);
