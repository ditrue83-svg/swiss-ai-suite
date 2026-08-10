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
// ⚠️⚠️ E DICHIARARE IL SALTO NON BASTAVA. Fino al 2026-08-01 un gruppo saltato
// usciva **ZERO**, stampando `ESITO: verde sui gruppi eseguiti · 1 SALTATI`. Il
// salto era scritto, ma le due cose che un lettore guarda davvero — il codice di
// uscita e la parola «verde» — dicevano entrambe «a posto». Il 2026-07-31
// `npm run test:integration` è uscito 0 in un millisecondo senza eseguire un
// passo, e il risultato è stato scritto in `product-status.md` come se le 71
// asserzioni fossero passate. Una misura inesistente è entrata nella tabella
// autorevole del prodotto: il difetto non era la mancanza di una dichiarazione,
// era che la dichiarazione conviveva con un verde.
//
// Da oggi: **un salto è un'uscita NON-ZERO** (codice 3, distinto dall'1 di un
// test rosso), e la parola «verde» non compare mai su una riga che parla di un
// salto. Chi vuole davvero un esito verde su ciò che è stato eseguito lo chiede
// con `--allow-skip`, e nemmeno allora la riga finale dice «verde».
//
// ⚠️ NON si è invertito il default di `--allow-ai`, che era l'altra strada
// possibile. Eseguire per difetto e chiedere un flag per NON spendere avrebbe
// reso `npm run test:all` una spesa involontaria: la regola «la spesa si chiede,
// non si eredita» vale più della comodità di non digitare un flag. Ciò che era
// rotto non era il salto — era il verde che lo accompagnava.
//
//   node scripts/run-test-suite.mjs <gruppo…> [opzioni]
//
//   gruppi        quality · unit · db · integration · eval   (oppure `all`)
//   --list        mostra i gruppi, i passi e ciò che richiedono. Non esegue.
//   --self-test   prova la funzione che decide l'esito sui casi che DEVONO
//                 farla fallire, «gruppo saltato» compreso. Non esegue le suite.
//   --continue-on-error   prosegue dopo un fallimento (uso locale).
//                 Senza questa, ci si ferma al primo rosso: è la modalità CI.
//   --allow-ai    autorizza i gruppi che SPENDONO CREDITO ANTHROPIC.
//                 Senza, vengono saltati e dichiarati. Nessuna esecuzione
//                 accidentale: la spesa si chiede, non si eredita.
//   --allow-skip  accetta che un gruppo non eseguito non faccia uscire non-zero.
//                 Per chi sa cosa NON ha provato e lo vuole lo stesso.
//   --no-skip     conservato: oggi è il comportamento PREDEFINITO. Resta accettato
//                 perché la CI lo passa esplicitamente in tre job, e un flag che
//                 sparisce trasforma un cancello in un errore di sintassi.
//
// COSA NON FA
//   · non stampa mai una CHIAVE, senza eccezioni: di `.env.test` legge i NOMI.
//     ⚠️ L'unica eccezione, dichiarata, è l'HOST di `SUPABASE_URL`, che segreto
//     non è — sta dentro il bundle pubblicato come `VITE_SUPABASE_URL`. Viene
//     stampato prima di ogni gruppo che scrive, perché «ho lanciato test:db» e
//     «ho lanciato test:db contro la produzione» sono due frasi diverse;
//   · non inventa credenziali e non ne scrive;
//   · non cambia il significato di nessun test: esegue gli stessi
//     `npm run …` che esistevano prima, nello stesso ordine deterministico.
// ============================================================================
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// ⚠️ La regola «è la macchina di sviluppo?» sta in UN posto solo: qui c'era una
// seconda copia, priva dell'ancora finale, e nessuno poteva vedere la differenza.
import { LOCALE_RE } from './local-host.mjs';

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
  // ⚠️ Il gruppo `production` non prova il PRODOTTO: prova QUEL progetto —
  // la configurazione di autenticazione, il contenuto del catalogo, le Edge
  // Function deployate. Eseguirlo contro un database effimero darebbe un verde
  // che non significa niente, e un verde che non significa niente è peggio di
  // un rosso: è la lezione di `i18n:coverage`, due volte.
  realProject: {
    label: 'il progetto Supabase REALE (non un database effimero)',
    check: () => {
      const host = supabaseHost();
      if (!host) return { ok: false, why: 'SUPABASE_URL non è leggibile da .env.test' };
      return LOCALE_RE.test(host)
        ? { ok: false, why: `SUPABASE_URL punta a ${host}: queste suite provano il progetto reale, non un database qualunque` }
        : { ok: true };
    },
  },
  // ⚠️ NUOVO il 2026-08-01, e nasce da un difetto misurato: `check:auth`
  // invocato nudo verificava `http://localhost:5174` e usciva 0 dicendo che i
  // link porteranno lì. Ora quello script si rifiuta di indovinare, quindi il
  // dominio deve arrivare da qui — dichiarato una volta, in `.env.test`, come
  // ogni altro requisito di questo file.
  //
  // Se manca, il gruppo non viene eseguito e lo DICE (e da oggi un salto esce
  // non-zero): è l'esito onesto. Prima l'alternativa era eseguire e mentire.
  siteUrl: {
    label: 'VITE_PUBLIC_SITE_URL in .env.test (il dominio a cui devono portare i link email)',
    check: () => {
      const valore = envValue('VITE_PUBLIC_SITE_URL');
      if (!valore) {
        return {
          ok: false,
          why: 'in .env.test manca VITE_PUBLIC_SITE_URL: check:auth non può sapere quale dominio verificare '
            + '(es. VITE_PUBLIC_SITE_URL=https://app.ai-swisse.com)',
        };
      }
      let host;
      try { host = new URL(valore).hostname; } catch { return { ok: false, why: `VITE_PUBLIC_SITE_URL non è un URL: ${valore}` }; }
      return LOCALE_RE.test(host)
        ? { ok: false, why: `VITE_PUBLIC_SITE_URL punta a ${host}: per verificare la macchina di sviluppo si usa 'npm run check:auth -- --local', che lo dichiara` }
        : { ok: true };
    },
  },
};

/**
 * L'HOST di `SUPABASE_URL`, mai la chiave.
 *
 * ⚠️ L'intestazione di questo file dice che non stampa MAI il valore di una
 * variabile d'ambiente, e questa è l'unica eccezione, dichiarata: l'URL del
 * progetto **non è un segreto** — sta dentro il bundle pubblicato su
 * app.ai-swisse.com come `VITE_SUPABASE_URL`, leggibile da chiunque. Sapere
 * CONTRO QUALE database si sta per scrivere vale più della purezza della
 * regola, perché quattordici di queste suite creano e cancellano righe, e
 * «ho lanciato test:db» e «ho lanciato test:db contro la produzione» sono due
 * frasi diverse. Le CHIAVI restano non stampabili, senza eccezioni.
 */
function supabaseHost() {
  const valore = envValue('SUPABASE_URL');
  if (!valore) return null;
  try { return new URL(valore).host; } catch { return null; }
}

/**
 * Il valore di una variabile di `.env.test`.
 *
 * ⚠️ Si legge SOLO per le variabili che segreti non sono — gli URL pubblici.
 * L'intestazione di questo file lo dichiara: delle chiavi si leggono i NOMI, e
 * questa funzione non viene mai chiamata su una di esse.
 */

function envValue(nome) {
  const path = join(APP, '.env.test');
  if (!existsSync(path)) return null;
  const riga = readFileSync(path, 'utf8').split('\n')
    .map((l) => new RegExp(`^${nome}=(.*)$`).exec(l.trim())?.[1])
    .find((v) => v !== undefined && v !== '');
  return riga ? riga.replace(/^["']|["']$/g, '') : null;
}

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
      // Bloccante come i18n:coverage, e per la stessa storia: la regola 1 del
      // sistema di design scritta senza controllo ha prodotto 95 stili inline
      // e ~342 misure a mano in cinque giorni. Un gate che avvisa senza
      // bloccare è un contatore di violazioni, non un argine.
      { script: 'design:lint' },
      // ⚠️ `--root` viene passato SOLO se chi lancia lo ha indicato. Senza, il
      // passo esce 3 («non eseguito») e il gruppo resta INCOMPLETO invece di
      // sembrare rosso: dalla directory di sviluppo due dei cinque controlli
      // non sono eseguibili, e fingere il contrario è ciò che questo file
      // combatte in ogni sua riga.
      { script: 'docs:check', argsFrom: () => (opts.root ? ['--root', opts.root] : []) },
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
      { script: 'test:operations' },
      // ⚠️ SOLO l'autoverifica: `verify:deploy` interroga il progetto reale e
      // non può stare in un gruppo senza credenziali. I suoi due controlli
      // nuovi — duplicati ed esito dell'ultima esecuzione — sono però funzioni
      // pure, e vanno provati sui casi che DEVONO farli fallire: romperli nel
      // progetto vero per vederli reagire non è un'opzione.
      { script: 'verify:deploy', args: ['--self-test'] },
      // ⚠️ I DUE CONTROLLI CHE HANNO DATO UN VERDE FALSO, e che ora si provano
      // sul caso che DEVE farli fallire. `suite --self-test` verifica che un
      // gruppo saltato non esca 0; `check:auth --self-test` che senza dominio
      // ci si rifiuti di rispondere. Entrambi girano senza credenziali, quindi
      // stanno qui e non fra le suite che ne hanno bisogno.
      { script: 'suite', args: ['--self-test'] },
      { script: 'check:auth:self-test' },
      // Le frasi condizionali del foglio di stato: l'avviso «main non
      // contiene il lavoro recente» era fisso, e a lavoro tutto unito
      // mentiva. Funzioni pure, provate sui casi che DEVONO farle tacere.
      { script: 'status:self-test' },
      // La coda di revisione del catalogo: il giudizio è una funzione pura, e
      // provarlo qui evita di dover invecchiare una riga vera per vederlo
      // reagire.
      { script: 'subsidy:health:self-test' },
      { script: 'test:ai-json-parser-unit' },
      { script: 'test:inbox-unit' },
      { script: 'test:tasks-unit' },
      { script: 'test:documents-unit' },
      { script: 'test:calendar-unit' },
      // Il motore di sincronizzazione ESEGUITO contro finzioni: è la suite che
      // ha estinto la riga di `calendar/sync.ts` in TYPECHECK_SCOPERTI.
      { script: 'test:calendar-sync-unit' },
      { script: 'test:workflows-unit' },
      { script: 'test:finance-unit' },
      { script: 'test:contracts-unit' },
      { script: 'test:crm-unit' },
      { script: 'test:assistant-unit' },
      { script: 'test:subsidy-unit' },
      { script: 'test:audit-unit' },
      { script: 'test:print-unit' },
    ],
  },
  // ⚠️ QUESTO GRUPPO NON HA BISOGNO DEL PROGETTO DI PRODUZIONE, e la
  // distinzione è la ragione per cui il cancello può smettere di essere
  // manuale. Gli serve UN database con il nostro schema: in locale è quello di
  // `.env.test` (che è la produzione), nella CI è un Supabase EFFIMERO avviato
  // dal runner e distrutto alla fine. Le suite sono identiche — cambia solo
  // dove puntano, e il runner lo stampa prima di cominciare.
  db: {
    title: 'Database — richiede UN database con il nostro schema · NON spende credito AI',
    needs: ['env'],
    steps: [
      { script: 'test:phase1' },
      { script: 'test:tasks' },
      { script: 'test:inbox' },
      { script: 'test:calendar' },
      { script: 'test:contracts' },
      { script: 'test:assistant' },
      { script: 'test:documents' },
      { script: 'test:crm' },
      { script: 'test:finance' },
      { script: 'test:workflows' },
      { script: 'test:subsidy' },
      { script: 'test:audit' },
    ],
  },
  // ⚠️ NON SPOSTABILI NELL'EFFIMERO, e per tre ragioni diverse:
  //   · `check:auth`      legge la configurazione di autenticazione DI QUEL
  //                       progetto (indirizzi di ritorno dei link email);
  //   · `subsidy:health`  giudica il CONTENUTO del catalogo vero — la sua
  //                       freschezza è una proprietà dei dati reali, e su un
  //                       catalogo appena seminato direbbe sempre di sì;
  //   · `test:functions`  prova la sicurezza delle Edge Function DEPLOYATE.
  // Un database effimero le farebbe passare senza provare niente.
  production: {
    title: 'Progetto reale — prova QUEL progetto, non il prodotto',
    needs: ['env', 'realProject', 'siteUrl'],
    steps: [
      // ⚠️ IL DOMINIO SI PASSA, non si lascia indovinare. Fino al 2026-08-01
      // questo passo era `{ script: 'check:auth' }` nudo, e `check:auth` nudo
      // ripiegava su `http://localhost:5174`: dentro il gruppo che «prova il
      // progetto reale» girava un controllo sulla macchina di sviluppo, e
      // usciva verde. Il valore arriva da `.env.test`, ed è un requisito
      // dichiarato del gruppo: se manca, il gruppo non parte e lo dice.
      { script: 'check:auth', argsFrom: () => [envValue('VITE_PUBLIC_SITE_URL')] },
      { script: 'subsidy:health' },
      { script: 'test:functions' },
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

// ⚠️ `production` è dentro `all` di proposito: in locale `.env.test` PUNTA al
// progetto reale, quindi togliendolo `npm run test:all` avrebbe smesso di
// eseguire tre suite che eseguiva ieri — una perdita di copertura travestita
// da riorganizzazione. Nella CI non viene mai chiamato `all`: il job effimero
// chiede `db`, e `production` resta manuale perché i suoi requisiti non sono
// soddisfatti da un database usa-e-getta (e il gruppo lo DICHIARA, invece di
// passare a vuoto).
const ALL = ['quality', 'unit', 'db', 'production'];

// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const opts = {
    list: false,
    selfTest: false,
    continueOnError: false,
    allowAi: process.env.AISWISSE_ALLOW_AI === '1',
    allowSkip: false,
    // ⚠️ La radice del monorepo, per i passi che non possono rispondere senza.
    // Oggi ce n'è uno: `docs:check` verifica la tabella dei moduli contro il
    // README della RADICE, che dalla directory di sviluppo (`~/swiss-ai-suite-app`)
    // non esiste — è un livello sopra `app/`, nel monorepo. Senza, quel passo
    // esce 3 e il gruppo resta INCOMPLETO; con `--root` il controllo è completo
    // anche da qui. Il percorso si INDICA: dedurlo dal disco significherebbe
    // verificare un file che non si sa quale sia.
    root: null,
    groups: [],
  };
  const resto = [...argv];
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (a === '--root') { opts.root = resto[i + 1] ?? null; i++; continue; }
    if (a === '--list') opts.list = true;
    else if (a === '--self-test') opts.selfTest = true;
    else if (a === '--continue-on-error') opts.continueOnError = true;
    else if (a === '--allow-ai') opts.allowAi = true;
    else if (a === '--allow-skip') opts.allowSkip = true;
    // ⚠️ Oggi è il default. Resta accettato e NON è un errore: la CI lo passa in
    // tre job, e farlo diventare «opzione sconosciuta» renderebbe rosso un
    // cancello per un motivo che non c'entra niente con ciò che prova.
    else if (a === '--no-skip') opts.allowSkip = false;
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

// ---------------------------------------------------------------------------
// L'ESITO — una funzione PURA, perché è la parte che ha mentito.
//
// Sta a parte e non dentro il ciclo per una ragione sola: si può provare sui
// casi che DEVONO farla fallire senza eseguire una suite e senza spendere un
// centesimo. È la stessa disciplina di `i18n:coverage --self-test`,
// `db:bundle --self-test` e `docs:check --self-test`, e nasce dallo stesso
// difetto: un controllo di cui si è visto solo il verde non è stato verificato.
//
// Riceve gli esiti dei gruppi e restituisce il codice di uscita e le righe da
// stampare. Non stampa e non esce da sé: così il self-test può leggere ciò che
// avrebbe detto.
//
// I CODICI, e perché tre e non due:
//   0  tutto ciò che era stato chiesto è stato eseguito, e nessuno è rosso
//   1  almeno un gruppo è ROSSO — un test ha fallito
//   3  nessun rosso, ma qualcosa NON È STATO ESEGUITO. Non è un successo e non
//      è un fallimento del prodotto: è una misura che manca. Distinguerlo
//      dall'1 serve a chi legge un log della CI e vuole sapere se il codice è
//      rotto o se l'ambiente era incompleto.
// ---------------------------------------------------------------------------
export function decidiEsito({ esiti, gruppiChiesti, allowSkip = false }) {
  const righe = [];
  const rossi = esiti.filter((e) => e.stato === 'rosso');
  const saltati = esiti.filter((e) => e.stato === 'saltato');
  // ⚠️ QUARTO STATO, dal 2026-08-03. Un gruppo «incompleto» ha eseguito tutti i
  // passi che POTEVA eseguire e nessuno è fallito: uno o più non erano
  // eseguibili in questo ambiente e sono usciti 3. Non è verde — manca una
  // misura — e non è rosso — non è andato storto niente. Trattarlo come rosso
  // fa cercare un difetto che non c'è; trattarlo come verde fa credere di aver
  // verificato ciò che non si è verificato.
  const incompleti = esiti.filter((e) => e.stato === 'incompleto');
  const nonEseguiti = gruppiChiesti - esiti.length;
  const gruppo = (n) => (n === 1 ? 'gruppo' : 'gruppi');
  const passiNonEseguiti = incompleti.flatMap((e) => (e.nonEseguiti ?? []).map((p) => `${e.id}/${p}`));

  if (nonEseguiti > 0) {
    righe.push(`${nonEseguiti} ${gruppo(nonEseguiti)} ${nonEseguiti === 1 ? 'non è stato eseguito' : 'non sono stati eseguiti'}: ci si è fermati al primo fallimento.`);
  }

  if (rossi.length) {
    righe.push(`ESITO: ROSSO — ${rossi.map((e) => e.id).join(', ')}`);
    // ⚠️ Un rosso NON nasconde un salto: sono due informazioni diverse e chi
    // legge deve avere entrambe. Prima il salto spariva dietro il fallimento.
    if (saltati.length) {
      righe.push(`E ${saltati.length} ${gruppo(saltati.length)} non sono stati eseguiti affatto: ${saltati.map((e) => e.id).join(', ')}`);
    }
    if (passiNonEseguiti.length) {
      righe.push(`E ${passiNonEseguiti.length} passi non erano eseguibili: ${passiNonEseguiti.join(' · ')}`);
    }
    return { code: 1, righe };
  }

  if (saltati.length) {
    const elenco = saltati.map((e) => `${e.id} (${e.why})`).join(' · ');
    if (allowSkip) {
      // ⚠️ Nemmeno qui compare la parola «verde». Chi ha chiesto `--allow-skip`
      // sa di aver rinunciato a una misura: la riga glielo ricorda invece di
      // congratularsi. «INCOMPLETO» è ciò che è successo.
      righe.push(`ESITO: INCOMPLETO — ${esiti.length - saltati.length} ${gruppo(esiti.length - saltati.length)} senza fallimenti, ${saltati.length} ${saltati.length === 1 ? 'NON eseguito' : 'NON eseguiti'} (--allow-skip).`);
      righe.push(`Non provato: ${elenco}`);
      return { code: 0, righe };
    }
    righe.push(`ESITO: NON ESEGUITO — ${saltati.length} ${gruppo(saltati.length)} su ${esiti.length} non ${saltati.length === 1 ? 'è stato eseguito' : 'sono stati eseguiti'}.`);
    righe.push(`Mancano: ${elenco}`);
    righe.push('Nessuno di questi gruppi ha fallito: NON sono stati provati. Se è voluto, --allow-skip lo dichiara.');
    return { code: 3, righe };
  }

  // ⚠️ Nessun gruppo saltato, nessun rosso, ma dei PASSI non eseguibili: non è
  // verde. La parola «verde» qui direbbe che tutti i controlli hanno risposto,
  // e uno non ha nemmeno potuto essere posto.
  if (passiNonEseguiti.length) {
    if (allowSkip) {
      righe.push(`ESITO: INCOMPLETO — nessun fallimento, ${passiNonEseguiti.length} ${passiNonEseguiti.length === 1 ? 'passo NON eseguito' : 'passi NON eseguiti'} (--allow-skip).`);
      righe.push(`Non provato: ${passiNonEseguiti.join(' · ')}`);
      return { code: 0, righe };
    }
    righe.push(`ESITO: INCOMPLETO — nessun controllo ha fallito, ma ${passiNonEseguiti.length} non ${passiNonEseguiti.length === 1 ? 'è stato eseguito' : 'sono stati eseguiti'}.`);
    righe.push(`Non provato: ${passiNonEseguiti.join(' · ')}`);
    righe.push('Da ~/swiss-ai-suite-app il README della radice non esiste: `npm run ci -- --root ~/swiss-ai-suite-repo` esegue il controllo completo.');
    return { code: 3, righe };
  }

  return {
    code: 0,
    righe: [esiti.length === 1
      ? `ESITO: VERDE — l'unico gruppo richiesto (${esiti[0].id}) è stato eseguito.`
      : `ESITO: VERDE — tutti i ${esiti.length} gruppi richiesti sono stati eseguiti.`],
  };
}

// ---------------------------------------------------------------------------
// L'AUTOVERIFICA — i casi che la funzione DEVE saper riconoscere come non-verdi.
//
// ⚠️ Il primo caso è quello REALE: `test:integration` senza `--allow-ai` usciva
// 0. Se quel caso smettesse di pretendere un'uscita non-zero, questo controllo
// sarebbe morto e nessuno se ne accorgerebbe.
// ---------------------------------------------------------------------------
const VERDE_VIETATO = /verde/i;

const CASI = [
  {
    name: 'tutti i gruppi eseguiti e nessun rosso → 0',
    arg: { esiti: [{ id: 'quality', stato: 'verde' }, { id: 'unit', stato: 'verde' }], gruppiChiesti: 2 },
    code: 0,
  },
  {
    // ⚠️ IL CASO REALE del 2026-07-31: `test:integration` senza `--allow-ai`.
    name: 'UN GRUPPO SALTATO → non-zero (il difetto che ha prodotto una misura inesistente)',
    arg: {
      esiti: [{ id: 'integration', stato: 'saltato', why: 'serve --allow-ai' }],
      gruppiChiesti: 1,
    },
    code: 3,
    vietaVerde: true,
  },
  {
    name: 'un gruppo verde e uno saltato → non-zero lo stesso, il verde non salva il salto',
    arg: {
      esiti: [{ id: 'quality', stato: 'verde' }, { id: 'eval', stato: 'saltato', why: 'serve --allow-ai' }],
      gruppiChiesti: 2,
    },
    code: 3,
    vietaVerde: true,
  },
  {
    name: 'un gruppo saltato con --allow-skip → 0, ma la riga NON dice «verde»',
    arg: {
      esiti: [{ id: 'quality', stato: 'verde' }, { id: 'eval', stato: 'saltato', why: 'serve --allow-ai' }],
      gruppiChiesti: 2,
      allowSkip: true,
    },
    code: 0,
    vietaVerde: true,
  },
  {
    name: 'un gruppo rosso → 1, distinto dal 3 di un salto',
    arg: {
      esiti: [{ id: 'unit', stato: 'rosso', falliti: 2, passi: 16 }],
      gruppiChiesti: 1,
    },
    code: 1,
  },
  {
    name: 'rosso E saltato → 1, e il salto viene comunque nominato',
    arg: {
      esiti: [
        { id: 'unit', stato: 'rosso', falliti: 1, passi: 16 },
        { id: 'eval', stato: 'saltato', why: 'serve --allow-ai' },
      ],
      gruppiChiesti: 2,
    },
    code: 1,
    contiene: 'eval',
  },
  {
    name: 'fermata al primo rosso: i gruppi mai cominciati vengono dichiarati',
    arg: { esiti: [{ id: 'quality', stato: 'rosso', falliti: 1, passi: 6 }], gruppiChiesti: 3 },
    code: 1,
    contiene: '2 gruppi non sono stati eseguiti',
  },

  // --- IL QUARTO STATO: un PASSO non eseguibile dentro un gruppo senza rossi --
  // ⚠️ IL CASO REALE del 2026-08-03. `docs:check` da `~/swiss-ai-suite-app` non
  // può verificare la tabella dei moduli — il README della radice sta nel
  // monorepo — ed esce 3. Prima veniva contato fra i FALLITI: il riepilogo
  // diceva «ROSSO quality — 1 su 6 falliti» mentre nessun controllo aveva
  // fallito, e mandava a cercare un difetto inesistente.
  {
    name: '⚠️ un PASSO non eseguibile in un gruppo senza rossi → non-zero, e NON si chiama rosso',
    arg: {
      esiti: [{ id: 'quality', stato: 'incompleto', falliti: 0, nonEseguiti: ['docs:check'], passi: 6 }],
      gruppiChiesti: 1,
    },
    code: 3,
    vietaVerde: true,
    contiene: 'docs:check',
  },
  {
    name: 'lo stesso, con --allow-skip → 0, e la riga NON dice «verde»',
    arg: {
      esiti: [{ id: 'quality', stato: 'incompleto', falliti: 0, nonEseguiti: ['docs:check'], passi: 6 }],
      gruppiChiesti: 1, allowSkip: true,
    },
    code: 0,
    vietaVerde: true,
  },
  {
    name: '⚠️ un rosso NON nasconde il passo non eseguito: restano due informazioni',
    arg: {
      esiti: [
        { id: 'quality', stato: 'incompleto', falliti: 0, nonEseguiti: ['docs:check'], passi: 6 },
        { id: 'unit', stato: 'rosso', falliti: 2, passi: 19 },
      ],
      gruppiChiesti: 2,
    },
    code: 1,
    contiene: 'docs:check',
  },
  {
    name: 'nessun passo non eseguito → resta VERDE: il quarto stato non contagia i verdi',
    arg: {
      esiti: [{ id: 'quality', stato: 'verde', falliti: 0, nonEseguiti: [], passi: 6 }],
      gruppiChiesti: 1,
    },
    code: 0,
  },
];

/** La stessa batteria, senza stampare niente: l'esito e basta. */
function selfTestSilenzioso() {
  for (const c of CASI) {
    const { code, righe } = decidiEsito(c.arg);
    if (code !== c.code) return false;
    if (c.vietaVerde && righe.some((r) => VERDE_VIETATO.test(r))) return false;
    if (c.contiene && !righe.join('\n').includes(c.contiene)) return false;
  }
  return true;
}

function selfTest() {
  console.log(`\n${B}Autoverifica del runner${X} ${DIM}(un runner che esce 0 senza eseguire non è un runner)${X}\n`);
  let bad = 0;
  for (const c of CASI) {
    const { code, righe } = decidiEsito(c.arg);
    const testo = righe.join('\n');
    const problemi = [];
    if (code !== c.code) problemi.push(`atteso exit ${c.code}, ottenuto ${code}`);
    // ⚠️ IL VINCOLO NON NEGOZIABILE: mai «verde» su una riga che parla di un salto.
    if (c.vietaVerde) {
      const colpevole = righe.find((r) => VERDE_VIETATO.test(r));
      if (colpevole) problemi.push(`la parola «verde» compare accanto a un salto: «${colpevole}»`);
    }
    if (c.contiene && !testo.includes(c.contiene)) problemi.push(`manca «${c.contiene}» nel riepilogo`);
    if (problemi.length) bad++;
    console.log(`  ${problemi.length ? R + '✗' : G + '✓'}${X} ${c.name}`);
    for (const p of problemi) console.log(`      ${R}${p}${X}`);
  }
  if (bad) {
    console.error(`\n${R}${bad} casi falliti: la funzione che decide l'esito NON è affidabile.${X}\n`);
    return false;
  }
  console.log(`\n${G}Tutti i ${CASI.length} casi superati.${X}\n`);
  return true;
}

/** Esegue `npm run <script>` mostrando l'output così com'è. */
/**
 * Gli argomenti del passo: fissi (`args`) o calcolati al momento (`argsFrom`).
 *
 * `argsFrom` esiste per un solo caso, ed è quello che conta: il dominio da
 * passare a `check:auth`, che vive in `.env.test` e non può essere scritto qui
 * dentro. Viene valutato DOPO il controllo dei requisiti, quindi quando arriva
 * qui il valore c'è per costruzione.
 */
function argomentiDelPasso(step) {
  const calcolati = step.argsFrom ? step.argsFrom().filter(Boolean) : [];
  return [...(step.args ?? []), ...calcolati];
}

function runStep(step) {
  const args = ['run', '--silent', step.script];
  const propri = argomentiDelPasso(step);
  if (propri.length) args.push('--', ...propri);
  const t0 = Date.now();
  const r = spawnSync('npm', args, { cwd: APP, stdio: 'inherit', env: process.env });
  return { code: r.status ?? 1, ms: Date.now() - t0 };
}

function nomeDelPasso(step) {
  const propri = argomentiDelPasso(step);
  return propri.length ? `${step.script} ${propri.join(' ')}` : step.script;
}

// ---------------------------------------------------------------------------

const opts = parseArgs(process.argv.slice(2));

if (opts.selfTest) {
  process.exit(selfTest() ? 0 : 1);
}

// ⚠️ L'autoverifica gira PRIMA di ogni esecuzione, come in `i18n:coverage` e in
// `docs:check`. Se la funzione che decide l'esito fosse rotta, il riepilogo di
// una suite vera non sarebbe attendibile: meglio non eseguirla affatto che
// eseguirla e non poter credere a ciò che dice alla fine.
if (!opts.list && !selfTestSilenzioso()) {
  console.error(`${R}✗ L'autoverifica del runner è fallita: il suo riepilogo non sarebbe attendibile.${X}`);
  console.error(`${DIM}  Dettaglio: node scripts/run-test-suite.mjs --self-test${X}`);
  process.exit(1);
}

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
  // ⚠️ CONTRO QUALE DATABASE. Quattordici di queste suite creano e cancellano
  // righe: sapere dove le stanno creando non è un dettaglio estetico. L'host
  // non è un segreto (sta nel bundle pubblicato); le chiavi non si stampano.
  if (g.needs.includes('env')) {
    const host = supabaseHost();
    const dove = /^(127\.0\.0\.1|localhost|\[::1\])/.test(host ?? '')
      ? `${host} ${DIM}(database effimero)${X}`
      : `${Y}${host}${X} ${DIM}(progetto reale: le righe di prova nascono e muoiono QUI)${X}`;
    console.log(`  ${DIM}database:${X} ${dove}`);
  }
  const t0 = Date.now();
  let falliti = 0;
  const nonEseguitiQui = [];

  for (const step of g.steps) {
    const nome = nomeDelPasso(step);
    console.log(`\n${DIM}  ── ${nome} ───${X}`);
    const { code, ms } = runStep(step);
    if (code === 0) {
      console.log(`  ${G}✓${X} ${nome} ${DIM}${durata(ms)}${X}`);
    } else if (code === 3) {
      // ⚠️⚠️ 3 = «non eseguito», e dal 2026-08-03 NON viene più contato fra i
      // falliti. Prima sì, e il riepilogo diceva «ROSSO quality — 1 su 6
      // falliti» quando nessun controllo aveva fallito: mandava a cercare un
      // difetto dove c'era un ambiente incompleto, che è lo stesso genere di
      // bugia che questo file esiste per non dire. Il gruppo diventa
      // INCOMPLETO, l'uscita resta non-zero.
      nonEseguitiQui.push(nome);
      console.log(`  ${Y}! ${nome}${X} ${Y}NON ESEGUITO${X} ${DIM}${durata(ms)} — exit 3${X}`);
      // Un passo non eseguito NON ferma il gruppo: gli altri controlli sono
      // eseguibili e la loro risposta serve.
    } else {
      falliti++;
      console.log(`  ${R}✗ ${nome}${X} ${DIM}${durata(ms)} — exit ${code}${X}`);
      if (!opts.continueOnError) { fermato = true; break; }
    }
  }

  esiti.push({
    id,
    stato: falliti ? 'rosso' : nonEseguitiQui.length ? 'incompleto' : 'verde',
    falliti,
    nonEseguiti: nonEseguitiQui,
    passi: g.steps.length,
    ms: Date.now() - t0,
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
  } else if (e.stato === 'incompleto') {
    console.log(`  ${Y}INCOMPL${X}  ${e.id.padEnd(12)} ${DIM}${e.passi} passi, ${(e.nonEseguiti ?? []).length} non eseguibili (${(e.nonEseguiti ?? []).join(', ')}) — ${durata(e.ms)}${X}`);
  } else if (e.stato === 'verde') {
    console.log(`  ${G}VERDE  ${X}  ${e.id.padEnd(12)} ${DIM}${e.passi} passi — ${durata(e.ms)}${X}`);
  } else {
    console.log(`  ${R}ROSSO  ${X}  ${e.id.padEnd(12)} ${DIM}${e.falliti} su ${e.passi} falliti — ${durata(e.ms)}${X}`);
  }
}

// La decisione NON viene presa qui: la prende `decidiEsito`, che è pura ed è
// stata provata sui casi che devono farla fallire. Qui si colora e si stampa.
const { code, righe } = decidiEsito({
  esiti, gruppiChiesti: opts.groups.length, allowSkip: opts.allowSkip,
});

const colore = code === 0 ? G : code === 3 ? Y : R;
console.log('');
for (const riga of righe) {
  console.log(riga.startsWith('ESITO:') ? `${colore}${riga}${X}` : `  ${DIM}${riga}${X}`);
}
console.log('');
process.exit(code);
