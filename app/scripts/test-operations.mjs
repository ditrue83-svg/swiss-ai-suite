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
//   5. MIGRAZIONE   ogni job dell'inventario è creato da una MIGRAZIONE, non
//                   soltanto descritto in un documento. Un blocco SQL dentro
//                   un `.md` è un'istruzione per una persona: nessun database
//                   lo esegue. Le eccezioni note stanno in CRON_SOLO_A_MANO,
//                   ciascuna con la data in cui è stata creata a mano.
//   6. ORIGINE      una migrazione non porta l'URL del progetto scritto dentro:
//                   finirebbe in `full-setup.sql` e ogni installazione nuova
//                   chiamerebbe periodicamente la NOSTRA produzione.
//   7. DUPLICATI    due migrazioni non creano lo stesso job: quale definizione
//                   sopravviva dipenderebbe dall'ordine di applicazione.
//   8. TYPECHECK    ogni modulo PORTABILE di `supabase/functions/` è raggiunto
//                   dal typecheck, cioè importato da qualcosa in `src/` o
//                   `scripts/`. È la stessa domanda dell'invocante — «qualcuno
//                   lo guarda?» — e la sua assenza ha lasciato per settimane un
//                   `notify.ts` che mandava ogni promemoria a `to: [null]`.
//                   I file che usano `Deno.` o `npm:` sono esenti PER
//                   COSTRUZIONE; il debito noto sta in TYPECHECK_SCOPERTI.
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

// ---------------------------------------------------------------------------
// IL DEBITO — gli scheduler che vivono SOLO in un blocco SQL dentro un
// documento, e che quindi qualcuno ha incollato a mano una volta.
//
// ⚠️ PERCHÉ QUESTA LISTA ESISTE. L'inventario qui sopra accetta una
// dichiarazione scritta in un `.md`, e per quattro mesi è bastato. Non basta:
// un blocco di codice dentro un documento non lo esegue NESSUNO. Un progetto
// Supabase rifatto, un ambiente di prova, un cliente installato da zero con
// `full-setup.sql` ottengono lo schema completo e nessuno di questi job —
// senza che un solo test diventi rosso, perché non si può vedere l'assenza di
// una cosa che non è mai stata scritta da nessuna parte se non in prosa.
//
// Dalla 0035 i due job del calendario e delle notifiche sono in una
// MIGRAZIONE. Gli altri cinque no, e questa lista li tiene VISIBILI invece di
// lasciarli sembrare a posto: ognuno con la data in cui è stato creato a mano.
// Togliere una riga da qui è il gesto che accompagna la migrazione che lo
// sostituisce; aggiungerne una nuova dovrebbe costare una discussione.
// ---------------------------------------------------------------------------
export const CRON_SOLO_A_MANO = {
  'inbox-maintenance': 'creato a mano il 2026-07-26 (docs/ai-inbox.md §…): non ancora in una migrazione',
  'automation-worker': 'creato a mano il 2026-07-27 (docs/workflow-automation.md): non ancora in una migrazione',
  'finance-worker':    'creato a mano il 2026-07-28 (docs/finance-operations.md): non ancora in una migrazione',
  'contract-worker':   'creato a mano il 2026-07-28 (docs/contract-manager.md): non ancora in una migrazione',
  'subsidy-worker':    'creato a mano il 2026-07-30 (docs/incentivi.md): non ancora in una migrazione',
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
// IL DEBITO DEL TYPECHECK — i moduli PORTABILI che nessun file di `src/` o
// `scripts/` importa, e che quindi il typecheck non guarda.
//
// ⚠️ Questa lista ha la stessa forma e la stessa ragione di `CRON_SOLO_A_MANO`:
// tiene VISIBILE ciò che manca, invece di lasciarlo sembrare a posto. Una riga
// qui è debito dichiarato; un modulo nuovo che non compare qui e che nessuno
// importa fa FALLIRE il controllo — che è il punto.
//
// Come si toglie una riga: si importa il modulo da un test che lo ESEGUE. Non
// basta importarlo per far contento il typechecker — un import senza esecuzione
// copre le firme e non il comportamento, ed è metà del difetto delle email
// (là la firma sbagliata c'era, ma nessuno guardava nemmeno quella).
// ---------------------------------------------------------------------------
export const TYPECHECK_SCOPERTI = {
  '_shared/calendar/sync.ts':
    'la sincronizzazione del calendario: 451 righe che nessun test esegue. '
    + 'È lo stesso modulo che dovrà essere provato quando esisterà una '
    + 'connessione OAuth reale — oggi non ne esiste nessuna (2026-08-03)',
  '_shared/assistant/store.ts':
    'lo store dell\'assistente: `test:assistant` lo esercita attraverso la '
    + 'funzione DEPLOYATA via HTTP, non importandolo, quindi il typecheck non '
    + 'lo vede (2026-08-03)',
};

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

/**
 * 5. Uno scheduler che chiama una Edge Function è scritto in una MIGRAZIONE.
 *
 * ⚠️ È il controllo che mancava, ed è la ragione per cui `calendar-sync-drain`
 * e `notifications-worker` sono rimasti sei giorni «dichiarati» e mai creati:
 * l'inventario li trovava in `docs/calendar-notifications.md` e si dichiarava
 * soddisfatto. Un blocco SQL dentro un documento è una ISTRUZIONE PER UNA
 * PERSONA, non un artefatto che qualcosa esegue.
 *
 * `assistant-purge` non ha bisogno di eccezioni: è già in una migrazione (0031).
 */
export function checkCronInMigrazione(report, { dichiarati, attesi, soloAMano }) {
  const inMigrazione = new Set(
    dichiarati.filter((d) => d.file.startsWith('supabase/migrations/')).map((d) => d.nome),
  );

  for (const [nome, atteso] of Object.entries(attesi)) {
    if (inMigrazione.has(nome)) continue;
    if (soloAMano[nome]) continue;
    report.add('migrazione',
      `il job «${nome}» non è creato da nessuna migrazione`,
      'supabase/migrations/',
      atteso.funzione
        ? `esiste solo come blocco SQL da incollare a mano: un database rifatto avrebbe «${atteso.funzione}» `
          + 'deployata e mai chiamata. Scrivilo in una migrazione, oppure — se la scelta è consapevole — '
          + 'aggiungilo a CRON_SOLO_A_MANO con la data in cui è stato creato'
        : 'esiste solo come blocco SQL da incollare a mano: un database rifatto non lo avrebbe. '
          + 'Scrivilo in una migrazione, oppure aggiungilo a CRON_SOLO_A_MANO con la ragione');
  }

  // ⚠️ Nei DUE sensi, come l'inventario: una riga di debito che non corrisponde
  // più a niente fa credere che ci sia un problema aperto quando non c'è, e —
  // peggio — nasconderebbe il caso in cui il job venga migrato ma la riga resti,
  // rendendo l'eccezione permanente.
  for (const nome of Object.keys(soloAMano)) {
    if (!attesi[nome]) {
      report.add('migrazione',
        `CRON_SOLO_A_MANO elenca «${nome}», che non è nell'inventario`,
        'scripts/test-operations.mjs → CRON_SOLO_A_MANO',
        'il job è stato rimosso: togli anche la riga del debito');
    } else if (inMigrazione.has(nome)) {
      report.add('migrazione',
        `«${nome}» è ormai creato da una migrazione, ma è ancora elencato fra quelli creati a mano`,
        'scripts/test-operations.mjs → CRON_SOLO_A_MANO',
        'togli la riga: un\'eccezione che non serve più diventa un permesso permanente');
    }
  }
}

/**
 * 6. Una migrazione non porta l'origine del progetto scritta dentro.
 *
 * ⚠️ Un documento PUÒ: è un'istruzione per una persona, che la incolla su un
 * progetto preciso. Una migrazione no — finisce in `supabase/full-setup.sql`,
 * che la CI applica a un database effimero e che il README dà a chi installa
 * da zero. Con l'origine scritta dentro, ogni installazione nuova
 * programmerebbe chiamate periodiche verso la NOSTRA produzione.
 */
export function checkOrigineCron(report, { dichiarati }) {
  for (const d of dichiarati) {
    if (!d.file.startsWith('supabase/migrations/')) continue;
    if (!d.urlInChiaro) continue;
    report.add('origine',
      `il job «${d.nome}» porta un URL scritto in chiaro dentro una migrazione`,
      d.file,
      'l\'origine va risolta a ogni esecuzione — `current_setting(\'app.settings.functions_base_url\')` — '
      + 'come il segreto si legge dal Vault: altrimenti ogni database che applica questa migrazione '
      + 'chiama il progetto di chi l\'ha scritta');
  }
}

/**
 * 7. Due migrazioni non creano lo stesso job.
 *
 * `cron.schedule` con un nome già esistente aggiorna o solleva a seconda della
 * versione di pg_cron: in entrambi i casi, quale delle due definizioni resti in
 * `cron.job` dipende dall'ordine di applicazione, ed è la classe di problema che
 * non si vede finché il database non viene rifatto.
 */
export function checkDuplicatiCron(report, { dichiarati }) {
  const perNome = new Map();
  for (const d of dichiarati) {
    if (!d.file.startsWith('supabase/migrations/')) continue;
    if (!perNome.has(d.nome)) perNome.set(d.nome, new Set());
    perNome.get(d.nome).add(d.file);
  }
  for (const [nome, files] of perNome) {
    if (files.size < 2) continue;
    report.add('duplicati',
      `il job «${nome}» è creato da ${files.size} migrazioni diverse`,
      [...files].sort().join(' · '),
      'quale definizione sopravviva dipende dall\'ordine di applicazione: ne resti una sola');
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
    // Il blocco del job finisce dove comincia il job SEGUENTE, o dopo 1500
    // caratteri: abbastanza per contenere headers, body e timeout.
    //
    // ⚠️ Il limite al job seguente non c'era, e con due `cron.schedule` nello
    // stesso file la coda del primo si mangiava il secondo: il primo risultava
    // con timeout anche senza averlo, perché lo dichiarava il secondo. Un
    // controllo che eredita la prova dal vicino non è un controllo.
    const dopo = testo.slice(m.index + m[0].length);
    const prossimo = dopo.indexOf('cron.schedule(');
    const fine = m.index + m[0].length + (prossimo === -1 ? 1500 : Math.min(prossimo, 1500));
    const coda = testo.slice(m.index, fine);

    // ⚠️ I commenti SQL si tolgono prima di guardare: dentro questi blocchi si
    // spiega spesso ciò che NON si è fatto («il segreto non è scritto qui»,
    // «l'origine non è in chiaro»), e cercare `https://` in mezzo alla prosa
    // che dice di non usarlo darebbe un rosso a chi ha fatto la cosa giusta.
    const codice = coda.replace(/--[^\n]*/g, '');

    const url = /functions\/v1\/([a-z-]+)/.exec(codice);
    out.push({
      nome: m[1],
      cadenza: m[2].trim(),
      funzione: url ? url[1] : null,
      chiamaHttp: /net\.http_post/.test(codice),
      timeout: /timeout_milliseconds/.test(codice),
      urlInChiaro: /https?:\/\//.test(codice),
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

// ---------------------------------------------------------------------------
// 8. TYPECHECK — un modulo che nessuno typechecka è dead code che compila
//
// ⚠️⚠️ PERCHÉ ESISTE, e la data conta: il 2026-08-03 si è scoperto che
// `_shared/calendar/notify.ts` dichiarava di restituire `{ to, subject, text }`
// e restituiva `{ subject, text }`. Ogni promemoria sarebbe partito verso
// `to: [null]`. Il typecheck non l'ha mai visto perché `tsconfig.json` include
// `src` e `scripts`: un file di `supabase/functions/` entra nel programma SOLO
// se qualcosa là dentro lo importa, e `notify.ts` non era importato da niente.
// È bastato che un test lo importasse perché il difetto diventasse rosso in due
// posti nello stesso minuto.
//
// La domanda è la stessa che questo file pone alle Edge Function — «qualcuno lo
// chiama?» — applicata al typecheck: **qualcuno lo guarda?**
//
// ⚠️ NON tutti i file POSSONO essere typecheckati qui, e la distinzione è
// tecnica, non un'opinione: chi usa `Deno.` o importa `npm:`/`jsr:` non si
// risolve in Node. Quelli sono ESENTI PER COSTRUZIONE e il controllo lo verifica
// invece di crederci. Tutti gli altri sono PORTABILI, e un portabile che nessun
// file di `src/` o `scripts/` raggiunge non è coperto da niente.
// ---------------------------------------------------------------------------

/** Un file che usa API Deno o specificatori `npm:`/`jsr:` non è typecheckabile qui. */
export function nonPortabile(sorgente) {
  return /\bDeno\.\w/.test(sorgente) || /from\s+['"](npm|jsr):/.test(sorgente);
}

export function checkTypecheck(report, { portabili, raggiunti, scoperti = {} }) {
  for (const file of portabili) {
    if (raggiunti.has(file)) continue;
    if (file in scoperti) continue;          // debito dichiarato: vedi TYPECHECK_SCOPERTI
    report.add('typecheck',
      `«${file}» è portabile ma nessun file di src/ o scripts/ lo importa`,
      'tsconfig.json → include: ["src", "scripts"]',
      'il typecheck NON lo guarda: una firma sbagliata lì dentro non diventa mai '
      + 'rossa. Importalo da un test che lo ESEGUE — è così che si è scoperto il '
      + 'destinatario mancante delle email');
  }
}

/**
 * I file di `supabase/functions/` raggiunti dal typecheck, seguendo gli import
 * relativi a partire da `src/` e `scripts/`.
 *
 * ⚠️ Si segue il grafo invece di chiedere a `tsc --listFiles` perché quel comando
 * ricompila tutto e costa quanto il typecheck stesso: il controllo verrebbe
 * tolto dal gruppo veloce, cioè da dove serve.
 */
function raggiuntiDalTypecheck() {
  const radici = [
    ...listaFileRicorsiva(join(APP, 'src'), '.ts'),
    ...listaFileRicorsiva(join(APP, 'src'), '.tsx'),
    ...listaFileRicorsiva(join(APP, 'scripts'), '.ts'),
  ];
  const visti = new Set();
  const coda = [...radici];

  while (coda.length) {
    const file = coda.pop();
    if (visti.has(file)) continue;
    visti.add(file);
    let sorgente;
    try { sorgente = readFileSync(file, 'utf8'); } catch { continue; }
    for (const m of sorgente.matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)) {
      const risolto = risolviImport(dirname(file), m[1]);
      if (risolto && !visti.has(risolto)) coda.push(risolto);
    }
  }

  const prefisso = join(APP, 'supabase', 'functions') + '/';
  return new Set([...visti]
    .filter((f) => f.startsWith(prefisso))
    .map((f) => f.slice(prefisso.length)));
}

function risolviImport(base, specificatore) {
  const grezzo = resolve(base, specificatore);
  for (const candidato of [grezzo, `${grezzo}.ts`, `${grezzo}.tsx`,
    join(grezzo, 'index.ts'), join(grezzo, 'index.tsx')]) {
    if (existsSync(candidato) && !candidato.endsWith('/')) {
      try { if (readFileSync(candidato)) return candidato; } catch { /* directory */ }
    }
  }
  return null;
}

/** Elenco RICORSIVO dei file con una certa estensione. (`listaFile` non scende.) */
function listaFileRicorsiva(radice, ext) {
  if (!existsSync(radice)) return [];
  const out = [];
  for (const voce of readdirSync(radice, { withFileTypes: true })) {
    const percorso = join(radice, voce.name);
    if (voce.isDirectory()) out.push(...listaFileRicorsiva(percorso, ext));
    else if (voce.name.endsWith(ext)) out.push(percorso);
  }
  return out;
}

function scan() {
  const report = new Report();
  const { funzioni, dichiarati, invocate } = raccogli();

  checkInvocanti(report, { funzioni, invocate, esterni: INVOCANTI_ESTERNI });
  checkInventarioCron(report, { dichiarati, attesi: CRON_ATTESI });
  checkTimeoutCron(report, { dichiarati });
  checkBersaglioCron(report, { dichiarati, funzioni });
  checkCronInMigrazione(report, { dichiarati, attesi: CRON_ATTESI, soloAMano: CRON_SOLO_A_MANO });
  checkOrigineCron(report, { dichiarati });
  checkDuplicatiCron(report, { dichiarati });

  const tuttiTs = listaFileRicorsiva(join(APP, 'supabase', 'functions'), '.ts')
    .map((f) => f.slice((join(APP, 'supabase', 'functions') + '/').length));
  const portabili = tuttiTs.filter((rel) => {
    try {
      return !nonPortabile(readFileSync(join(APP, 'supabase', 'functions', rel), 'utf8'));
    } catch { return false; }
  });
  checkTypecheck(report, { portabili, raggiunti: raggiuntiDalTypecheck(), scoperti: TYPECHECK_SCOPERTI });

  return { report, funzioni, dichiarati, portabili, tuttiTs };
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
  // --- 5. MIGRAZIONE — il controllo che mancava ------------------------------
  {
    name: 'un job dell’inventario che vive solo in un documento → problema (il caso 0035)',
    run: (r) => checkCronInMigrazione(r, {
      dichiarati: [{ nome: 'calendar-sync-drain', file: 'docs/calendar-notifications.md' }],
      attesi: { 'calendar-sync-drain': { funzione: 'calendar-sync', cadenza: '*/10 * * * *' } },
      soloAMano: {},
    }),
    expect: 1,
  },
  {
    name: 'lo stesso job scritto in una migrazione → nessun problema',
    run: (r) => checkCronInMigrazione(r, {
      dichiarati: [
        { nome: 'calendar-sync-drain', file: 'docs/calendar-notifications.md' },
        { nome: 'calendar-sync-drain', file: 'supabase/migrations/0035_calendar_notification_schedulers.sql' },
      ],
      attesi: { 'calendar-sync-drain': { funzione: 'calendar-sync', cadenza: '*/10 * * * *' } },
      soloAMano: {},
    }),
    expect: 0,
  },
  {
    name: 'un debito dichiarato in CRON_SOLO_A_MANO → nessun problema',
    run: (r) => checkCronInMigrazione(r, {
      dichiarati: [{ nome: 'finance-worker', file: 'docs/finance-operations.md' }],
      attesi: { 'finance-worker': { funzione: 'finance-worker', cadenza: '*/5 * * * *' } },
      soloAMano: { 'finance-worker': 'creato a mano il 2026-07-28' },
    }),
    expect: 0,
  },
  {
    name: 'un debito ormai migrato e non tolto dalla lista → problema',
    run: (r) => checkCronInMigrazione(r, {
      dichiarati: [{ nome: 'finance-worker', file: 'supabase/migrations/0040_x.sql' }],
      attesi: { 'finance-worker': { funzione: 'finance-worker', cadenza: '*/5 * * * *' } },
      soloAMano: { 'finance-worker': 'creato a mano il 2026-07-28' },
    }),
    expect: 1,
  },
  {
    name: 'un debito che non è più nell’inventario → problema',
    run: (r) => checkCronInMigrazione(r, {
      dichiarati: [], attesi: {}, soloAMano: { 'job-sparito': 'creato a mano chissà quando' },
    }),
    expect: 1,
  },

  // --- 6. ORIGINE ------------------------------------------------------------
  {
    name: 'una migrazione con l’URL del progetto scritto dentro → problema',
    run: (r) => checkOrigineCron(r, {
      dichiarati: [{ nome: 'x', urlInChiaro: true, file: 'supabase/migrations/0035_x.sql' }],
    }),
    expect: 1,
  },
  {
    name: 'lo stesso URL dentro un DOCUMENTO → nessun problema (è un’istruzione per una persona)',
    run: (r) => checkOrigineCron(r, {
      dichiarati: [{ nome: 'x', urlInChiaro: true, file: 'docs/ai-inbox.md' }],
    }),
    expect: 0,
  },
  {
    name: 'una migrazione che risolve l’origine a ogni esecuzione → nessun problema',
    run: (r) => checkOrigineCron(r, {
      dichiarati: [{ nome: 'x', urlInChiaro: false, file: 'supabase/migrations/0035_x.sql' }],
    }),
    expect: 0,
  },

  // --- 7. DUPLICATI ----------------------------------------------------------
  {
    name: 'lo stesso job creato da due migrazioni → problema',
    run: (r) => checkDuplicatiCron(r, {
      dichiarati: [
        { nome: 'x', file: 'supabase/migrations/0035_a.sql' },
        { nome: 'x', file: 'supabase/migrations/0036_b.sql' },
      ],
    }),
    expect: 1,
  },
  {
    name: 'lo stesso job in una migrazione E in un documento → nessun problema (il documento lo descrive)',
    run: (r) => checkDuplicatiCron(r, {
      dichiarati: [
        { nome: 'x', file: 'supabase/migrations/0035_a.sql' },
        { nome: 'x', file: 'docs/calendar-notifications.md' },
      ],
    }),
    expect: 0,
  },

  // --- IL TYPECHECK ----------------------------------------------------------
  {
    name: '⚠️ un modulo portabile che nessuno importa → problema (il caso di notify.ts)',
    run: (r) => checkTypecheck(r, {
      portabili: ['_shared/calendar/notify.ts'], raggiunti: new Set(), scoperti: {},
    }),
    expect: 1,
  },
  {
    name: 'lo stesso modulo, importato da un test → nessun problema',
    run: (r) => checkTypecheck(r, {
      portabili: ['_shared/calendar/notify.ts'],
      raggiunti: new Set(['_shared/calendar/notify.ts']), scoperti: {},
    }),
    expect: 0,
  },
  {
    name: 'un modulo nel debito DICHIARATO → nessun problema, ma resta scritto',
    run: (r) => checkTypecheck(r, {
      portabili: ['_shared/calendar/sync.ts'], raggiunti: new Set(),
      scoperti: { '_shared/calendar/sync.ts': 'debito noto' },
    }),
    expect: 0,
  },
  {
    name: '⚠️ `Deno.env` rende un file NON portabile: è esente per costruzione',
    run: (r) => { if (!nonPortabile('const x = Deno.env.get("A");')) r.add('x', 'y', 'z'); },
    expect: 0,
  },
  {
    name: '⚠️ un import `npm:` rende un file NON portabile',
    run: (r) => { if (!nonPortabile("import { createClient } from 'npm:@supabase/supabase-js@2';")) r.add('x', 'y', 'z'); },
    expect: 0,
  },
  {
    name: 'un modulo puro NON è esente: il typecheck deve guardarlo',
    run: (r) => { if (nonPortabile("export const somma = (a, b) => a + b;")) r.add('x', 'y', 'z'); },
    expect: 0,
  },

  // --- L'ESTRATTORE ----------------------------------------------------------
  {
    name: 'due job nello stesso file: il primo NON eredita il timeout del secondo',
    run: (r) => {
      const testo = "select cron.schedule('primo', '*/5 * * * *', $$select net.http_post("
        + "url := 'https://x/functions/v1/a');$$);\n"
        + "select cron.schedule('secondo', '*/9 * * * *', $$select net.http_post("
        + "url := 'https://x/functions/v1/b', timeout_milliseconds := 150000);$$);";
      const [primo, secondo] = estraiCron(testo, 'finto.sql');
      if (!primo || primo.timeout) r.add('autoverifica', 'il primo job ha ereditato il timeout del secondo', 'estraiCron');
      if (!secondo || !secondo.timeout) r.add('autoverifica', 'il secondo job ha perso il proprio timeout', 'estraiCron');
      if (primo?.funzione !== 'a' || secondo?.funzione !== 'b') {
        r.add('autoverifica', 'i bersagli si sono mescolati fra i due job', 'estraiCron');
      }
    },
    expect: 0,
  },
  {
    name: 'un commento che PARLA di https:// non è un URL in chiaro',
    run: (r) => {
      const [c] = estraiCron(
        "select cron.schedule('x', '*/5 * * * *', $$\n"
        + "  -- l'origine NON è scritta qui, niente https://esempio.supabase.co\n"
        + "  select net.http_post(url := current_setting('app.settings.functions_base_url')"
        + " || '/functions/v1/calendar-sync', timeout_milliseconds := 150000);$$);",
        'supabase/migrations/0035_x.sql',
      );
      if (!c) r.add('autoverifica', 'l’estrattore non ha trovato il job', 'estraiCron');
      else if (c.urlInChiaro) r.add('autoverifica', 'un commento è stato scambiato per un URL in chiaro', 'estraiCron');
      else if (c.funzione !== 'calendar-sync') r.add('autoverifica', 'bersaglio non letto', 'estraiCron');
    },
    expect: 0,
  },
  {
    name: 'un URL vero nel comando viene invece riconosciuto',
    run: (r) => {
      const [c] = estraiCron(
        "select cron.schedule('x', '*/5 * * * *', $$select net.http_post("
        + "url := 'https://abc.supabase.co/functions/v1/calendar-sync', timeout_milliseconds := 150000);$$);",
        'supabase/migrations/0035_x.sql',
      );
      if (!c?.urlInChiaro) r.add('autoverifica', 'un URL in chiaro non è stato riconosciuto', 'estraiCron');
    },
    expect: 0,
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
