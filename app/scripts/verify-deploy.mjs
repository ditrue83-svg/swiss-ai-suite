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
//   4. ogni funzione deployata esiste ancora nel repository;
//   5. nessun nome di job compare DUE VOLTE nel progetto;
//   6. e ogni job ha DAVVERO ESEGUITO, senza fallire.
//
// ⚠️ IL PUNTO 6 È QUELLO CHE MANCAVA, e la differenza non è accademica. Un job
// può esistere, essere attivo, avere la cadenza giusta e non aver mai eseguito
// nemmeno una volta — oppure fallire a ogni giro. È esattamente ciò che sarebbe
// successo a `calendar-sync-drain`: la funzione bersaglio era deployata con
// `verify_jwt=true`, e lo scheduler avrebbe preso 401 per sempre mentre i primi
// cinque controlli restavano verdi.
//
// ⚠️ `succeeded` in `cron.job_run_details` dice che `net.http_post` ha ACCODATO
// la richiesta, non che il lavoro sia stato fatto. È comunque l'unica cosa che
// il database sappia, e distingue «il cron gira» da «il cron non gira»: il resto
// lo dicono i log della funzione.
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

// ---------------------------------------------------------------------------
// I CONTROLLI 5 e 6, come funzioni PURE.
//
// ⚠️ Stanno fuori dal flusso principale perché altrimenti non sarebbero
// provabili: per far comparire un job duplicato o un'esecuzione fallita nel
// progetto vero bisognerebbe romperlo. Prendendo in ingresso gli elenchi, si
// possono invece passare i casi che DEVONO farli fallire — che è la sola cosa
// che dimostra che un controllo funzioni. `test:operations` fa già così, e
// `i18n:coverage` è nato senza e ha dato due verdi falsi.
// ---------------------------------------------------------------------------

/** Ogni quanti minuti ci si aspetta un'esecuzione, se la cadenza è `*​/N`. */
export function minutiAttesi(cadenza) {
  const m = /^\*\/(\d+) \* \* \* \*$/.exec(cadenza ?? '');
  return m ? Number(m[1]) : null;
}

/** 5. Nessun nome di job compare due volte nel progetto. */
export function trovaDuplicati(jobs) {
  const conteggi = new Map();
  for (const j of jobs) conteggi.set(j.jobname, (conteggi.get(j.jobname) ?? 0) + 1);
  return [...conteggi].filter(([, n]) => n > 1).map(([nome, n]) => ({ nome, n }));
}

/**
 * 6. Esito dell'ultima esecuzione di ogni job dell'inventario.
 * Restituisce una riga per job: `esito` è 'ok' | 'fallita' | 'mai' | 'ignoto'.
 */
export function giudicaEsecuzioni({ attesi, presenti, ultime }) {
  const perNome = new Map(ultime.map((e) => [e.jobname, e]));
  const out = [];
  for (const [nome, atteso] of Object.entries(attesi)) {
    if (!presenti.has(nome)) continue;          // l'assenza la segnala il controllo 1
    const e = perNome.get(nome);
    const periodo = minutiAttesi(atteso.cadenza);
    if (!e || !e.status) {
      // Un job a cadenza fissa che non ha MAI eseguito è un problema; uno
      // giornaliero può semplicemente non aver ancora avuto il suo turno, e
      // dirlo «ignoto» è più onesto che dirlo verde o rosso.
      out.push({ nome, esito: periodo ? 'mai' : 'ignoto', periodo, cadenza: atteso.cadenza });
      continue;
    }
    out.push({
      nome,
      esito: e.status === 'succeeded' ? 'ok' : 'fallita',
      status: e.status,
      messaggio: e.return_message ?? null,
      minutiFa: e.start_time ? Math.round((Date.now() - new Date(e.start_time).getTime()) / 60000) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// AUTOVERIFICA — ogni caso è costruito per far fallire un controllo preciso.
// ---------------------------------------------------------------------------
if (process.argv.includes('--self-test')) {
  const CASI = [
    ['due job con lo stesso nome → duplicato',
      () => trovaDuplicati([{ jobname: 'x' }, { jobname: 'x' }, { jobname: 'y' }]).length === 1],
    ['nomi tutti diversi → nessun duplicato',
      () => trovaDuplicati([{ jobname: 'x' }, { jobname: 'y' }]).length === 0],
    ['tre copie dello stesso job vengono contate',
      () => trovaDuplicati([{ jobname: 'x' }, { jobname: 'x' }, { jobname: 'x' }])[0].n === 3],

    ['una cadenza */10 dichiara il proprio periodo', () => minutiAttesi('*/10 * * * *') === 10],
    ['una cadenza giornaliera non ne ha uno', () => minutiAttesi('0 4 * * *') === null],
    ['una cadenza malformata non ne inventa uno', () => minutiAttesi('pippo') === null],

    ['l’ultima esecuzione fallita → fallita', () => giudicaEsecuzioni({
      attesi: { w: { cadenza: '*/10 * * * *' } }, presenti: new Set(['w']),
      ultime: [{ jobname: 'w', status: 'failed', start_time: new Date().toISOString() }],
    })[0].esito === 'fallita'],

    ['⚠️ un job a cadenza fissa che non ha MAI eseguito → mai', () => giudicaEsecuzioni({
      attesi: { w: { cadenza: '*/10 * * * *' } }, presenti: new Set(['w']), ultime: [],
    })[0].esito === 'mai'],

    ['un job giornaliero senza esecuzioni → ignoto, non verde', () => giudicaEsecuzioni({
      attesi: { w: { cadenza: '0 4 * * *' } }, presenti: new Set(['w']), ultime: [],
    })[0].esito === 'ignoto'],

    ['una riga senza status conta come mai eseguito', () => giudicaEsecuzioni({
      attesi: { w: { cadenza: '*/5 * * * *' } }, presenti: new Set(['w']),
      ultime: [{ jobname: 'w', status: null, start_time: null }],
    })[0].esito === 'mai'],

    ['un’esecuzione riuscita → ok', () => giudicaEsecuzioni({
      attesi: { w: { cadenza: '*/10 * * * *' } }, presenti: new Set(['w']),
      ultime: [{ jobname: 'w', status: 'succeeded', start_time: new Date().toISOString() }],
    })[0].esito === 'ok'],

    ['un job assente dal progetto non viene giudicato due volte', () => giudicaEsecuzioni({
      attesi: { w: { cadenza: '*/10 * * * *' } }, presenti: new Set(), ultime: [],
    }).length === 0],
  ];

  console.log(`${B}Autoverifica di verify:deploy${X} ${DIM}(i controlli 5 e 6, su casi costruiti)${X}\n`);
  let falliti = 0;
  for (const [nome, fn] of CASI) {
    let esito = false;
    try { esito = fn(); } catch { esito = false; }
    if (esito) console.log(`  ${G}✓${X} ${nome}`);
    else { falliti++; console.log(`  ${R}✗${X} ${nome}`); }
  }
  if (falliti) {
    console.error(`\n${R}${falliti} casi falliti: il controllo NON è affidabile.${X}`);
    process.exit(1);
  }
  console.log(`\n${G}Tutti i ${CASI.length} casi superati.${X}`);
  process.exit(0);
}

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
let esecuzioni;
let funzioniRemote;
try {
  jobs = await query('select jobname, schedule, active from cron.job order by jobname');
  // L'ULTIMA esecuzione di ciascun job, con il suo esito. `distinct on` prende
  // la riga più recente per nome senza portarsi in memoria l'intero storico.
  esecuzioni = await query(`
    select distinct on (j.jobname) j.jobname, d.status, d.start_time, d.return_message
      from cron.job j
      left join cron.job_run_details d on d.jobid = j.jobid
     order by j.jobname, d.start_time desc nulls last`);
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

// --- 5. Nessun duplicato ----------------------------------------------------
// ⚠️ Senza questo, un duplicato era INVISIBILE: la mappa qui sopra tiene una
// riga sola per nome, quindi due job omonimi — uno buono e uno rimasto da un
// tentativo precedente — davano lo stesso verde di uno solo, mentre il lavoro
// veniva fatto due volte a ogni giro.
for (const { nome, n } of trovaDuplicati(jobs)) {
  console.log(`    ${R}✗${X} ${nome.padEnd(22)} ${R}${n} righe con lo stesso nome${X}`);
  add(`lo scheduler «${nome}» esiste ${n} volte nel progetto`,
    'ogni copia esegue: il lavoro viene fatto più volte a ogni giro. '
    + 'select cron.unschedule(jobid) su quelle di troppo');
}

// --- 6. Hanno DAVVERO eseguito? ---------------------------------------------
console.log(`\n  ${B}Esecuzioni${X} ${DIM}(l'ultima di ciascun job, da cron.job_run_details)${X}`);
for (const r of giudicaEsecuzioni({
  attesi: CRON_ATTESI, presenti: new Set(perNome.keys()), ultime: esecuzioni,
})) {
  if (r.esito === 'ok') {
    console.log(`    ${G}✓${X} ${r.nome.padEnd(22)} ${DIM}${r.status} · ${r.minutiFa} min fa${X}`);
  } else if (r.esito === 'fallita') {
    console.log(`    ${R}✗${X} ${r.nome.padEnd(22)} ${R}${r.status}${X} ${DIM}· ${r.minutiFa} min fa${X}`);
    add(`l'ultima esecuzione di «${r.nome}» è ${r.status}`,
      (r.messaggio ?? '').slice(0, 200) || 'nessun messaggio: guarda cron.job_run_details');
  } else if (r.esito === 'mai') {
    console.log(`    ${R}✗${X} ${r.nome.padEnd(22)} ${R}mai eseguito${X}`);
    add(`lo scheduler «${r.nome}» esiste ed è attivo, ma non ha MAI eseguito`,
      `atteso un giro ogni ${r.periodo} minuti: se il job è stato creato adesso, riprova fra ${r.periodo} minuti; `
      + 'altrimenti pg_cron non lo sta eseguendo');
  } else {
    console.log(`    ${Y}!${X} ${r.nome.padEnd(22)} ${DIM}nessuna esecuzione registrata (cadenza ${r.cadenza})${X}`);
    add(`per «${r.nome}» non risulta alcuna esecuzione`,
      'la cadenza non è al minuto: potrebbe non essere ancora arrivato il suo turno. '
      + 'Va guardato a mano, questo comando non sa dire di più');
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
