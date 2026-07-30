#!/usr/bin/env node
// ============================================================================
// test:operations — ciò che deve ESSERE ACCESO perché il codice serva a qualcosa.
//
// ⚠️ PERCHÉ ESISTE. Una Edge Function scritta, provata da sessanta asserzioni e
// deployata può non fare NIENTE, per sempre, senza che un solo test diventi
// rosso: basta che nessuno la chiami. È successo — `notifications-worker` è in
// esercizio dal 2026-07-27, ha 58 asserzioni verdi sul database, e nessuno
// scheduler la invoca: i promemoria non sono mai stati generati. Nessun
// typecheck vede un cron mancante, e nessun test unitario vede un worker che
// non viene chiamato.
//
// Questo controllo copre la parte OFFLINE del problema — ciò che il repository
// può sapere di sé stesso:
//
//   1. INVOCANTI    ogni Edge Function ha almeno un invocante DICHIARATO:
//                   uno scheduler nel repository, una chiamata dal frontend,
//                   un'altra funzione, oppure un invocante esterno scritto
//                   nell'inventario con la sua ragione.
//   2. INVENTARIO   ogni `cron.schedule` scritto nel repository è nell'elenco
//                   qui sotto, e ogni voce dell'elenco è scritta nel
//                   repository. Nei DUE sensi: un elenco che si limita a
//                   contenere ciò che trova non fallisce mai.
//   3. TIMEOUT      ogni cron che chiama `net.http_post` dichiara
//                   `timeout_milliseconds`. È la trappola dei 5 secondi di
//                   `pg_net`, già pagata una volta: senza, la connessione
//                   viene chiusa a un lavoro che ne dura ottanta e OGNI
//                   esecuzione risulta fallita.
//   4. BERSAGLIO    un cron che punta a `functions/v1/<x>` punta a una
//                   funzione che esiste davvero in questo repository.
//
// ⚠️ COSA QUESTO CONTROLLO NON PUÒ SAPERE, e non finge di sapere: se quei cron
// esistano DAVVERO nel progetto Supabase. Un file non può interrogare un
// database. Quella metà è `npm run verify:deploy`, che richiede un token e
// FALLISCE se non ce l'ha, invece di tacere.
//
//   node scripts/test-operations.mjs [--self-test]
// ============================================================================
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

// ---------------------------------------------------------------------------
// L'INVENTARIO — la parte che una persona deve aggiornare a mano, e l'unica.
//
// ⚠️ È scritto qui e non dedotto dal repository di proposito: un inventario
// che si costruisce da ciò che trova non può accorgersi di ciò che manca. È
// la stessa ragione per cui il test delle notifiche legge l'enum DALLE
// MIGRAZIONI invece di enumerare a mano — solo rovesciata: là la verità sta
// nel database, qui sta in una decisione umana.
//
// `funzione: null` = il job esegue SQL diretta, non chiama una Edge Function.
// ---------------------------------------------------------------------------
export const CRON_ATTESI = {
  'inbox-maintenance':    { funzione: 'email-maintenance',    cadenza: '*/15 * * * *' },
  'automation-worker':    { funzione: 'automation-worker',    cadenza: '*/5 * * * *' },
  'finance-worker':       { funzione: 'finance-worker',       cadenza: '*/5 * * * *' },
  'contract-worker':      { funzione: 'contract-worker',      cadenza: '*/5 * * * *' },
  'subsidy-worker':       { funzione: 'subsidy-worker',       cadenza: '*/15 * * * *' },
  'assistant-purge':      { funzione: null,                   cadenza: '0 4 * * *' },
  'calendar-sync-drain':  { funzione: 'calendar-sync',        cadenza: '*/10 * * * *' },
  'notifications-worker': { funzione: 'notifications-worker', cadenza: '*/15 * * * *' },
};

/**
 * Le funzioni che NON possono avere un invocante dentro il repository, con la
 * ragione accanto. Una riga qui è un'eccezione consapevole; un'assenza è un
 * difetto.
 */
export const INVOCANTI_ESTERNI = {
  'email-webhook': 'la chiama il provider (Google Pub/Sub o Microsoft Graph), '
    + 'non un nostro codice: è un endpoint pubblico autenticato nel corpo',
};

/** Le cartelle di `supabase/functions/` che non sono funzioni deployabili. */
const NON_FUNZIONI = new Set(['_shared']);

// ---------------------------------------------------------------------------

class Report {
  constructor() { this.problems = []; }
  add(area, what, where, hint) { this.problems.push({ area, what, where, hint }); }
  get ok() { return this.problems.length === 0; }
}

// ---------------------------------------------------------------------------
// I QUATTRO CONTROLLI — funzioni pure su elenchi, così l'autoverifica può
// passargli casi costruiti apposta senza scrivere file finti sul disco.
// ---------------------------------------------------------------------------

/** 1. Ogni funzione ha un invocante dichiarato. */
export function checkInvocanti(report, { funzioni, invocate, esterni }) {
  for (const f of funzioni) {
    if (invocate.has(f)) continue;
    if (esterni[f]) continue;
    report.add('invocanti',
      `la Edge Function «${f}» non ha nessun invocante nel repository`,
      `supabase/functions/${f}/`,
      'una funzione che nessuno chiama è codice deployato che non fa niente, '
      + 'e nessun test diventa rosso quando succede. Dichiara il suo scheduler '
      + 'nella documentazione del modulo, oppure — se la chiama qualcosa di '
      + 'esterno — aggiungila a INVOCANTI_ESTERNI con la ragione');
  }
}

/** 2. L'inventario dei cron, nei DUE sensi. */
export function checkInventarioCron(report, { dichiarati, attesi }) {
  const perNome = new Map(dichiarati.map((d) => [d.nome, d]));

  for (const d of dichiarati) {
    if (!attesi[d.nome]) {
      report.add('inventario',
        `il repository dichiara il job «${d.nome}», che non è nell'inventario`,
        `${d.file} → scripts/test-operations.mjs → CRON_ATTESI`,
        'aggiungilo all\'inventario, oppure toglilo dalla documentazione: '
        + 'uno scheduler che nessun elenco conosce non verrà ricreato quando '
        + 'il progetto Supabase andrà rifatto');
    } else if (attesi[d.nome].cadenza !== d.cadenza) {
      report.add('inventario',
        `il job «${d.nome}» è dichiarato con cadenza «${d.cadenza}», l'inventario dice «${attesi[d.nome].cadenza}»`,
        d.file,
        'una delle due è stata cambiata senza l\'altra');
    }
  }

  for (const nome of Object.keys(attesi)) {
    if (!perNome.has(nome)) {
      report.add('inventario',
        `l'inventario prevede il job «${nome}», che nessun file del repository dichiara`,
        'docs/ del modulo che lo usa',
        'lo scheduler esiste solo nella testa di chi l\'ha creato o nel '
        + 'progetto Supabase: se il database va rifatto, non tornerà');
    }
  }
}

/** 3. La trappola dei 5 secondi di `pg_net`. */
export function checkTimeoutCron(report, { dichiarati }) {
  for (const d of dichiarati) {
    if (!d.chiamaHttp) continue;   // SQL diretta: nessuna connessione da tenere aperta
    if (d.timeout) continue;
    report.add('timeout',
      `il job «${d.nome}» chiama net.http_post senza timeout_milliseconds`,
      d.file,
      'pg_net chiude la connessione dopo 5 secondi predefiniti: su un lavoro '
      + 'che ne dura ottanta OGNI esecuzione risulta fallita. Serve '
      + '`timeout_milliseconds := 150000`');
  }
}

/** 4. Il bersaglio di un cron esiste. */
export function checkBersaglioCron(report, { dichiarati, funzioni }) {
  for (const d of dichiarati) {
    if (!d.funzione) continue;
    if (funzioni.includes(d.funzione)) continue;
    report.add('bersaglio',
      `il job «${d.nome}» chiama functions/v1/${d.funzione}, che in supabase/functions/ non esiste`,
      d.file,
      'o la funzione è stata rinominata, o lo scheduler punta nel vuoto');
  }
}

// ---------------------------------------------------------------------------
// LA RACCOLTA DEI FATTI
// ---------------------------------------------------------------------------

function listaFile(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => f.endsWith(ext)).map((f) => join(dir, f));
}

function tuttiIFile(dir, exts, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) tuttiIFile(p, exts, acc);
    else if (exts.some((x) => e.name.endsWith(x))) acc.push(p);
  }
  return acc;
}

/**
 * Estrae i `cron.schedule` da SQL e da blocchi di codice nei documenti.
 * Il nome e la cadenza sono i primi due argomenti; il resto del blocco serve
 * a sapere se chiama HTTP e se dichiara il timeout.
 */
export function estraiCron(testo, file) {
  const out = [];
  const re = /cron\.schedule\(\s*'([a-z0-9-]+)'\s*,\s*'([^']+)'/g;
  for (const m of testo.matchAll(re)) {
    // Il blocco del job finisce al `);` che chiude la schedule, o dopo 1500
    // caratteri: abbastanza per contenere headers, body e timeout.
    const coda = testo.slice(m.index, m.index + 1500);
    const url = /functions\/v1\/([a-z-]+)/.exec(coda);
    out.push({
      nome: m[1],
      cadenza: m[2].trim(),
      funzione: url ? url[1] : null,
      chiamaHttp: /net\.http_post/.test(coda),
      timeout: /timeout_milliseconds/.test(coda),
      file,
    });
  }
  return out;
}

function raccogli() {
  const funzioni = existsSync(join(APP, 'supabase', 'functions'))
    ? readdirSync(join(APP, 'supabase', 'functions'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !NON_FUNZIONI.has(e.name))
      .map((e) => e.name).sort()
    : [];

  const sorgentiCron = [
    ...listaFile(join(APP, 'supabase', 'migrations'), '.sql'),
    ...listaFile(join(APP, 'docs'), '.md'),
    join(APP, 'README.md'),
  ].filter(existsSync);

  const dichiarati = [];
  for (const f of sorgentiCron) {
    dichiarati.push(...estraiCron(readFileSync(f, 'utf8'), f.replace(`${APP}/`, '')));
  }

  // Chi invoca che cosa: gli scheduler del repository, il frontend, e le
  // funzioni fra loro.
  const invocate = new Set(dichiarati.map((d) => d.funzione).filter(Boolean));

  const sorgentiApp = [
    ...tuttiIFile(join(APP, 'src'), ['.ts', '.tsx']),
    ...tuttiIFile(join(APP, 'supabase', 'functions'), ['.ts']),
  ];
  for (const f of sorgentiApp) {
    const testo = readFileSync(f, 'utf8');
    for (const nome of funzioni) {
      // ⚠️ Una funzione non conta come invocante di sé stessa: il proprio
      // `index.ts` nomina il proprio slug nei log, e senza questo controllo
      // OGNI funzione risulterebbe invocata e il controllo non fallirebbe mai.
      if (f.includes(`/functions/${nome}/`)) continue;
      if (testo.includes(nome)) invocate.add(nome);
    }
  }

  return { funzioni, dichiarati, invocate };
}

function scan() {
  const report = new Report();
  const { funzioni, dichiarati, invocate } = raccogli();

  checkInvocanti(report, { funzioni, invocate, esterni: INVOCANTI_ESTERNI });
  checkInventarioCron(report, { dichiarati, attesi: CRON_ATTESI });
  checkTimeoutCron(report, { dichiarati });
  checkBersaglioCron(report, { dichiarati, funzioni });

  return { report, funzioni, dichiarati };
}

// ---------------------------------------------------------------------------
// AUTOVERIFICA — ogni caso è costruito per FAR FALLIRE un controllo preciso.
// Un controllo che non sa fallire non è un controllo: in questo repository è
// già successo due volte con `i18n:coverage`.
// ---------------------------------------------------------------------------
const CASES = [
  {
    name: 'una funzione senza invocanti → problema',
    run: (r) => checkInvocanti(r, {
      funzioni: ['notifications-worker'], invocate: new Set(), esterni: {},
    }),
    expect: 1,
  },
  {
    name: 'una funzione con invocante → nessun problema',
    run: (r) => checkInvocanti(r, {
      funzioni: ['finance-worker'], invocate: new Set(['finance-worker']), esterni: {},
    }),
    expect: 0,
  },
  {
    name: 'una funzione con invocante ESTERNO dichiarato → nessun problema',
    run: (r) => checkInvocanti(r, {
      funzioni: ['email-webhook'], invocate: new Set(), esterni: { 'email-webhook': 'il provider' },
    }),
    expect: 0,
  },
  {
    name: 'un cron dichiarato e non inventariato → problema',
    run: (r) => checkInventarioCron(r, {
      dichiarati: [{ nome: 'job-nuovo', cadenza: '*/5 * * * *', file: 'docs/x.md' }],
      attesi: {},
    }),
    expect: 1,
  },
  {
    name: 'un cron inventariato e non dichiarato → problema (il caso notifications-worker)',
    run: (r) => checkInventarioCron(r, {
      dichiarati: [],
      attesi: { 'notifications-worker': { funzione: 'notifications-worker', cadenza: '*/15 * * * *' } },
    }),
    expect: 1,
  },
  {
    name: 'una cadenza cambiata da un lato solo → problema',
    run: (r) => checkInventarioCron(r, {
      dichiarati: [{ nome: 'x', cadenza: '*/5 * * * *', file: 'docs/x.md' }],
      attesi: { x: { funzione: null, cadenza: '*/15 * * * *' } },
    }),
    expect: 1,
  },
  {
    name: 'inventario e dichiarazioni allineati → nessun problema',
    run: (r) => checkInventarioCron(r, {
      dichiarati: [{ nome: 'x', cadenza: '0 4 * * *', file: 'm.sql' }],
      attesi: { x: { funzione: null, cadenza: '0 4 * * *' } },
    }),
    expect: 0,
  },
  {
    name: 'un http_post senza timeout → problema (la trappola dei 5 secondi)',
    run: (r) => checkTimeoutCron(r, {
      dichiarati: [{ nome: 'x', chiamaHttp: true, timeout: false, file: 'docs/x.md' }],
    }),
    expect: 1,
  },
  {
    name: 'SQL diretta senza timeout → nessun problema',
    run: (r) => checkTimeoutCron(r, {
      dichiarati: [{ nome: 'purge', chiamaHttp: false, timeout: false, file: 'm.sql' }],
    }),
    expect: 0,
  },
  {
    name: 'un cron che punta a una funzione inesistente → problema',
    run: (r) => checkBersaglioCron(r, {
      dichiarati: [{ nome: 'x', funzione: 'worker-fantasma', file: 'docs/x.md' }],
      funzioni: ['finance-worker'],
    }),
    expect: 1,
  },
  {
    name: 'l’estrattore legge nome, cadenza, bersaglio e timeout',
    run: (r) => {
      const [c] = estraiCron(
        "select cron.schedule(\n 'pippo',\n '*/7 * * * *',\n $$ select net.http_post("
        + "url := 'https://x.supabase.co/functions/v1/finance-worker', timeout_milliseconds := 150000); $$);",
        'finto.sql',
      );
      if (!c || c.nome !== 'pippo' || c.cadenza !== '*/7 * * * *'
          || c.funzione !== 'finance-worker' || !c.chiamaHttp || !c.timeout) {
        r.add('autoverifica', 'l’estrattore non ha letto ciò che doveva', 'estraiCron');
      }
    },
    expect: 0,
  },
];

function autoverifica(silenziosa = false) {
  const falliti = [];
  for (const c of CASES) {
    const r = new Report();
    c.run(r);
    if (r.problems.length !== c.expect) falliti.push({ c, got: r.problems.length });
    else if (!silenziosa) console.log(`  ${G}✓${X} ${c.name}`);
  }
  return falliti;
}

// ---------------------------------------------------------------------------
// ⚠️ Da qui in giù si esegue SOLO quando questo file è il comando invocato.
// `verify-deploy.mjs` importa `CRON_ATTESI` da qui: senza questa guardia
// l'import faceva partire la scansione e la terminava con `process.exit(0)`,
// e lo script che importava non arrivava mai a eseguire la propria verifica —
// dando un verde che non aveva verificato niente. Trovato eseguendo, non
// rileggendo.
// ---------------------------------------------------------------------------
const invocatoDirettamente = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

function main() {
  if (process.argv.includes('--self-test')) {
    console.log(`${B}Autoverifica del controllo${X} ${DIM}(un controllo che non sa fallire non è un controllo)${X}\n`);
    const falliti = autoverifica();
    for (const f of falliti) {
      console.log(`  ${R}✗${X} ${f.c.name} ${DIM}— attesi ${f.c.expect}, trovati ${f.got}${X}`);
    }
    if (falliti.length) {
      console.error(`\n${R}${falliti.length} casi falliti: il controllo NON è affidabile.${X}`);
      process.exit(1);
    }
    console.log(`\n${G}Tutti i ${CASES.length} casi superati.${X}`);
    process.exit(0);
  }

  // L'autoverifica gira PRIMA di ogni scansione: un verde dato da un controllo
  // rotto è la cosa che questo file esiste per evitare.
  const falliti = autoverifica(true);
  if (falliti.length) {
    console.error(`${R}✗ L'autoverifica è fallita su ${falliti.length} casi:${X}`);
    for (const f of falliti) console.error(`   · ${f.c.name} (attesi ${f.c.expect}, trovati ${f.got})`);
    console.error(`${DIM}   La scansione non viene eseguita: il suo risultato non sarebbe attendibile.${X}`);
    process.exit(1);
  }

  const { report, funzioni, dichiarati } = scan();

  console.log(`\n${B}Operazioni — ciò che deve essere acceso perché il codice serva${X}`);
  console.log(`${DIM}(controllo verificato su ${CASES.length} casi noti)${X}\n`);
  console.log(`  ${DIM}${funzioni.length} Edge Function · ${dichiarati.length} scheduler dichiarati nel repository`
    + ` · ${Object.keys(CRON_ATTESI).length} nell'inventario${X}\n`);

  if (report.ok) {
    console.log(`  ${G}Nessun problema: ogni funzione ha un invocante, ogni scheduler è`);
    console.log(`  inventariato, dichiara il proprio timeout e punta a una funzione che esiste.${X}`);
    console.log(`\n  ${DIM}⚠️ Questo controllo NON sa se quegli scheduler esistano davvero nel`);
    console.log(`  progetto Supabase: quella metà è \`npm run verify:deploy\`.${X}\n`);
    process.exit(0);
  }

  const perArea = new Map();
  for (const p of report.problems) {
    if (!perArea.has(p.area)) perArea.set(p.area, []);
    perArea.get(p.area).push(p);
  }
  console.log(`  ${R}${report.problems.length} problemi:${X}\n`);
  for (const [area, list] of perArea) {
    console.log(`  ${B}${area}${X}`);
    for (const p of list) {
      console.log(`    ${R}✗${X} ${p.what}`);
      console.log(`      ${DIM}dove: ${p.where}${X}`);
      if (p.hint) console.log(`      ${DIM}${p.hint}${X}`);
    }
    console.log('');
  }
  process.exit(1);
}

if (invocatoDirettamente) main();
