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
//   9. FUNZIONI     ogni funzione ESPORTATA da quei moduli è importata per
//                   nome da qualcuno. Il debito noto sta in FUNZIONI_SCOPERTE.
//  10. DIPENDENZE   le versioni chiuse da un `npm audit fix` non tornano
//                   indietro, e le vulnerabilità RIMANDATE restano dichiarate
//                   finché lo sono davvero. `npm audit` legge la rete e cambia
//                   giudizio da un giorno all'altro: qui si guarda il
//                   lockfile, che è un fatto di questo albero.
//
// ⚠️ PERCHÉ IL 9 ESISTE, E PERCHÉ IL 8 NON BASTAVA. Il controllo 8 ragiona per
// FILE, e un file ha più porte. `test:calendar-unit` importa `deliverEmails` da
// `_shared/calendar/notify.ts`: da quel momento il file risulta «raggiunto», e
// `generateReminders` — l'altra funzione esportata dallo STESSO file, quella che
// decide se un'attività merita un promemoria — è diventata invisibile al
// controllo nato per vederla. Il 2026-08-11 non la eseguiva nessuno: né un test
// né la produzione, dove `notifications` è a zero righe dal 2026-07-27.
//
// Il 8 è nato da `notify.ts` e non poteva più vedere metà di `notify.ts`. È la
// forma esatta del difetto che questo file combatte: non un rosso nascosto, ma
// un verde che ha misurato la cosa accanto. Misurato il 2026-08-11 passando alla
// granularità di funzione: 337 funzioni esportate nei 67 moduli portabili
// raggiunti, di cui **48 che nessuno importa per nome**, nemmeno per via
// transitiva.
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
};

/**
 * Le funzioni che NON possono avere un invocante dentro il repository, con la
 * ragione accanto. Una riga qui è un'eccezione consapevole; un'assenza è un
 * difetto.
 */
export const INVOCANTI_ESTERNI = {
  'email-webhook': 'la chiama il provider (Google Pub/Sub o Microsoft Graph), '
    + 'non un nostro codice: è un endpoint pubblico autenticato nel corpo',
  'crm-email-webhook': 'la chiama Resend, non un nostro codice: è un endpoint '
    + 'pubblico autenticato dalla firma Svix sul corpo grezzo',
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
//
// E dal 2026-08-10 la rimozione non è affidata alla memoria: una riga il cui
// modulo è ormai raggiunto (o sparito) fa FALLIRE il controllo 8, come le
// eccezioni di `design:lint`. Così è uscita la riga di `calendar/sync.ts`,
// estinta da `test:calendar-sync-unit`.
// ---------------------------------------------------------------------------
export const TYPECHECK_SCOPERTI = {
  '_shared/assistant/store.ts':
    'lo store dell\'assistente: `test:assistant` lo esercita attraverso la '
    + 'funzione DEPLOYATA via HTTP, non importandolo, quindi il typecheck non '
    + 'lo vede (2026-08-03)',
};

// ---------------------------------------------------------------------------
// IL DEBITO DELLE FUNZIONI — le funzioni ESPORTATE che nessuno importa per
// nome, nei moduli che il controllo 8 considera già raggiunti.
//
// ⚠️ PERCHÉ QUESTA LISTA È NATA. Il controllo 8 guarda i FILE, e un file ha più
// porte: `test:calendar-unit` importa `deliverEmails` da `notify.ts`, e da quel
// momento tutto `notify.ts` risulta coperto — `generateReminders` compresa, che
// nessuno eseguiva. La chiave qui è `file#funzione` proprio per questo: la
// granularità del debito deve essere quella del difetto.
//
// La misura del 2026-08-11, alla nascita della lista: 337 funzioni esportate
// nei 67 moduli portabili raggiunti, 48 senza nessuno che le importi. Sono
// queste. Non è un elenco di colpe: è la superficie che nessun rosso protegge,
// tenuta VISIBILE invece di essere lasciata sembrare a posto.
//
// Come si toglie una riga: si importa la funzione da un test che la ESEGUE.
// Una riga il cui debito è estinto fa FALLIRE il controllo, come le eccezioni
// di `design:lint` e come TYPECHECK_SCOPERTI: un elenco con voci morte smette
// di essere letto, ed è l'elenco che deve restare vivo.
// ---------------------------------------------------------------------------
const RPC_DIRETTA = 'il test del modulo chiama la RPC/SQL corrispondente '
  + 'direttamente: copre il database e NON il codice TypeScript che lo chiama';
const OAUTH_MAI = 'vive nel percorso OAuth, che nessun test esegue — al '
  + '2026-08-11 nessuna connessione OAuth reale è mai stata stabilita';

export const FUNZIONI_SCOPERTE = {
  // --- calendario: i wrapper del percorso di sincronizzazione ---------------
  '_shared/calendar/store.ts#findConnectionByAccount': RPC_DIRETTA,
  '_shared/calendar/store.ts#markConnectionError': `${RPC_DIRETTA}; l'unica menzione nei test è in un COMMENTO di test:calendar-sync-unit`,
  '_shared/calendar/store.ts#readSecrets': OAUTH_MAI,
  '_shared/calendar/store.ts#writeSecrets': OAUTH_MAI,
  '_shared/calendar/store.ts#deleteSecrets': OAUTH_MAI,
  '_shared/calendar/store.ts#markLinkFailed': RPC_DIRETTA,
  '_shared/calendar/store.ts#claimQueue': `${RPC_DIRETTA} (test:calendar chiama calendar_queue_claim)`,
  '_shared/calendar/store.ts#queueDone': RPC_DIRETTA,
  '_shared/calendar/store.ts#queueRetry': RPC_DIRETTA,
  '_shared/calendar/store.ts#startRun': RPC_DIRETTA,
  '_shared/calendar/store.ts#finishRun': RPC_DIRETTA,

  // --- calendario: il resto -------------------------------------------------
  // ⚠️ QUI STAVA `generateReminders`, la riga che ha fatto nascere questa
  // lista: il motore dei promemoria, che al 2026-08-11 non aveva mai eseguito
  // nessuno — né un test né la produzione. È uscita lo stesso giorno, coperta
  // dalla sezione 13 di `test:calendar-unit`, e non l'ha tolta la memoria di
  // qualcuno: il controllo ha detto «la riga è stantia» e ha fatto rosso.
  // Il debito scade da solo, ed è la sola ragione per cui un elenco così
  // continua a dire il vero.
  '_shared/calendar/notify.ts#notifyCalendarProblem': 'la chiama solo calendar-sync nel proprio ramo di errore, che nessun test percorre',
  '_shared/calendar/http.ts#calFetch': 'l\'involucro HTTP verso Google/Microsoft: esce in rete, nessun test lo esegue',

  // --- posta ----------------------------------------------------------------
  '_shared/email/store.ts#findConnectionByAccount': RPC_DIRETTA,
  '_shared/email/store.ts#deleteSecrets': OAUTH_MAI,
  '_shared/email/store.ts#recordAudit': RPC_DIRETTA,
  '_shared/email/store.ts#claimWebhookEvent': 'il percorso del webhook Gmail: nessun test lo esegue',
  '_shared/email/store.ts#closeWebhookEvent': 'il percorso del webhook Gmail: nessun test lo esegue',
  '_shared/email/crypto.ts#randomBytes': OAUTH_MAI,
  '_shared/email/crypto.ts#toBase64Url': OAUTH_MAI,
  '_shared/email/crypto.ts#randomToken': OAUTH_MAI,
  '_shared/email/crypto.ts#createPkcePair': OAUTH_MAI,
  '_shared/email/http.ts#backoffDelay': 'la politica di ritentativo verso il provider: nessun test la esegue',
  '_shared/email/http.ts#codeForStatus': 'la politica di ritentativo verso il provider: nessun test la esegue',

  // --- automazioni ----------------------------------------------------------
  // ⚠️ QUI STAVANO `eventRetry`, `eventFailed` e `eventDeadLetter`, i tre rami
  // di guasto della coda eventi. Sono usciti il 2026-08-11 con la sezione 15 di
  // `test:workflows-unit`, che li esegue contro un client che fallisce le
  // scritture — ed è la prova che serviva, perché il difetto era proprio la
  // scrittura fallita e taciuta. Anche stavolta non le ha tolte la memoria di
  // nessuno: il controllo 9 ha detto «la riga è stantia» e ha fatto rosso.

  // --- denaro, contratti, finanze -------------------------------------------
  '_shared/finance/money.ts#decimal': 'esportata per simmetria dell\'API del denaro; l\'aritmetica in uso è coperta da test:finance-unit',
  '_shared/finance/money.ts#negate': 'esportata per simmetria dell\'API del denaro; l\'aritmetica in uso è coperta da test:finance-unit',
  '_shared/finance/money.ts#toNumber': 'esportata per simmetria dell\'API del denaro; l\'aritmetica in uso è coperta da test:finance-unit',
  // ⚠️ QUI STAVANO `qrbill.ts#buildSwissQrPayload` e `#generatePaymentReference`,
  // entrate il 2026-09-02 perché la generazione QR-fattura era provata solo da
  // un'esecuzione usa-e-getta. Sono uscite lo stesso giorno: le sezioni 1, 2 e 4
  // di `test:finance-invoices-unit` le ESEGUNO — payload riletto, riferimenti
  // ancorati a valori fissi, QR decodificato dai pixel anche dentro il PDF. Non
  // le ha tolte la memoria di nessuno: il controllo 9 ha detto «la riga è
  // stantia» e ha fatto rosso.

  '_shared/finance/prompt.ts#clampDocumentText': 'la costruzione della richiesta AI: spende credito Anthropic, esaurito dal 2026-08-02',
  '_shared/contracts/periods.ts#normalizeUnit': 'helper della normalizzazione dei periodi: nessun test lo importa per nome',
  '_shared/contracts/validate.ts#normalizeCurrency': 'helper della validazione: nessun test lo importa per nome',

  // --- il percorso AI, che oggi non si può eseguire --------------------------
  '_shared/persist.ts#reserveAiSlot': 'il cancello di frequenza delle chiamate AI: spende credito Anthropic, esaurito dal 2026-08-02',
  '_shared/persist.ts#recentRequestCount': 'il cancello di frequenza delle chiamate AI: spende credito Anthropic, esaurito dal 2026-08-02',
  '_shared/extract.ts#bytesToBase64': 'il percorso OCR: spende credito Anthropic, esaurito dal 2026-08-02',
  '_shared/extract.ts#buildOcrRequest': 'il percorso OCR: spende credito Anthropic, esaurito dal 2026-08-02',
  '_shared/assistant/runtime.ts#classifyProviderFailure': 'classifica un guasto del provider AI: nessun test lo importa per nome',
  '_shared/assistant/contract.ts#isAssistantLocale': 'guardia di tipo del contratto dell\'assistente: nessun test la importa per nome',
  '_shared/assistant/contract.ts#isUnverified': 'guardia di tipo del contratto dell\'assistente: nessun test la importa per nome',
  '_shared/assistant/dates.ts#isNamedPeriod': 'interpretazione delle date parlate: nessun test la importa per nome',
  '_shared/assistant/dates.ts#asConcreteDate': 'interpretazione delle date parlate: nessun test la importa per nome',

  // ⚠️ QUI STAVA `fetchGuard.ts#fetchSource`, e la riga è uscita il 2026-08-14:
  // tolta la memoria di nessuno — il controllo 9 ha detto «la riga è stantia» e
  // ha fatto rosso, esattamente come per i tre rami della coda eventi il
  // 2026-08-11. ⚠️ Ciò che resta scoperto è ciò che SCRIVE (`runSourceChecks`)
  // e l'involucro HTTP della Edge Function: leggere una fonte e registrarne
  // l'esito sono due cose, e adesso lo sono anche qui.
};

// ---------------------------------------------------------------------------
// 10. LE DIPENDENZE — il pavimento sotto cui non si torna.
//
// ⚠️ PERCHÉ NON SI CHIAMA `npm audit`. Quel comando interroga il registro: il
// suo esito cambia quando cambia il mondo, non quando cambia questo albero. Un
// controllo così è rosso il martedì per un avviso pubblicato lunedì notte, e
// non dice niente su ciò che ABBIAMO fatto. Qui si legge `package-lock.json`,
// che è un fatto di questo repository, e si risponde a una domanda sola: le
// versioni che una correzione ha già portato dentro, ci sono ancora?
//
// Un `npm install` fatto per un'altra ragione, un `package-lock` rigenerato, un
// merge risolto male: sono i tre modi in cui una correzione di sicurezza torna
// indietro senza che nessuno la disfi apposta.
// ---------------------------------------------------------------------------

/**
 * Chiuse da `npm audit fix` il 2026-08-18. La versione è il PAVIMENTO: sotto,
 * la vulnerabilità è di nuovo aperta.
 */
const DIPENDENZE_MINIME = {
  nanoid: {
    minima: '3.3.18',
    perche: 'GHSA-2v37-7h3g-55p8 (alta) — un generatore su misura può girare '
      + 'all\'infinito quando la dimensione è zero',
  },
  postcss: {
    minima: '8.5.22',
    perche: 'GHSA-fxqj-rqcc-2cmp (media) — un `sourceMappingURL` scelto da chi '
      + 'attacca fa leggere file `.map` arbitrari quando `from` non è indicato',
  },
};

/**
 * Le vulnerabilità che NON si chiudono, ciascuna con il perché e con la
 * versione che le chiuderebbe.
 *
 * ⚠️ SI CONTROLLA CHE SIANO ANCORA VERE. Se l'albero arriva alla versione
 * corretta — perché qualcuno ha aggiornato, o perché una dipendenza l'ha
 * trascinata dentro — la riga qui sotto diventa una bugia, e questo controllo
 * la dichiara. È la stessa disciplina di FUNZIONI_SCOPERTE: un elenco con voci
 * morte smette di essere letto, ed è l'elenco che deve restare vivo.
 */
const VULNERABILITA_RIMANDATE = {
  esbuild: {
    corretta: '0.25.0',
    perche: 'GHSA-67mh-4wv8-2f99 (media) riguarda il SERVER DI SVILUPPO, che in '
      + 'produzione non esiste: `vite build` produce file statici. La chiude '
      + 'vite@8, che è un cambio con rotture e non entra in un ramo di '
      + 'correzioni',
  },
  'react-router': {
    corretta: '7.18.0',
    perche: 'GHSA-wrjc-x8rr-h8h6 e GHSA-337j-9hxr-rhxg (medie). ⚠️ Nessuna '
      + 'versione 6.x le corregge: l\'unica correzione è react-router-dom@7, '
      + 'un cambio con rotture. `npm audit fix` da solo NON la chiude — '
      + 'misurato il 2026-08-18, contro l\'attesa del rapporto che diceva di sì',
  },
};

/**
 * Confronto di versioni, il minimo che serve qui: tre numeri separati da punti.
 * Una `-beta` non si legge e non deve: nel lockfile di questo albero non ce ne
 * sono, e fingere di sapere l'ordine delle prerelease sarebbe una regola in più
 * da sbagliare. Ritorna <0, 0, >0.
 */
export function confrontaVersioni(a, b) {
  const pezzi = (v) => String(v).split('.').map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [pezzi(a), pezzi(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/**
 * 10. Le versioni chiuse non tornano indietro, e i rinvii restano veri.
 *
 * `installate` è `{ nome: ['3.3.18', ...] }` — al plurale perché lo stesso
 * pacchetto può stare nell'albero più volte a versioni diverse (`tsx` porta il
 * suo `esbuild`), e una copia vecchia è vulnerabile quanto una sola.
 */
export function checkDipendenze(report, { installate, minime, rimandate }) {
  for (const [nome, { minima, perche }] of Object.entries(minime)) {
    const versioni = installate[nome] ?? [];
    if (!versioni.length) {
      report.add('dipendenze',
        `«${nome}» non è più nell'albero, ma ha ancora un pavimento dichiarato: la riga è stantia`,
        'scripts/test-operations.mjs → DIPENDENZE_MINIME',
        'togli la riga. Un pavimento sotto una stanza che non c'
        + '\'è più non regge niente e non lo dice a nessuno');
      continue;
    }
    const vecchie = versioni.filter((v) => confrontaVersioni(v, minima) < 0);
    if (vecchie.length) {
      report.add('dipendenze',
        `«${nome}» è tornato a ${vecchie.join(', ')}, sotto il minimo ${minima}`,
        'package-lock.json',
        `${perche}. La correzione era già stata fatta: rifalla con \`npm audit fix\` `
        + 'e guarda che cosa ha rigenerato il lockfile');
    }
  }

  for (const [nome, { corretta, perche }] of Object.entries(rimandate)) {
    const versioni = installate[nome] ?? [];
    if (!versioni.length) {
      report.add('dipendenze',
        `«${nome}» non è più nell'albero: il rinvio dichiarato non ha più oggetto`,
        'scripts/test-operations.mjs → VULNERABILITA_RIMANDATE',
        'togli la riga, e se serve metti un pavimento in DIPENDENZE_MINIME');
      continue;
    }
    if (versioni.every((v) => confrontaVersioni(v, corretta) >= 0)) {
      report.add('dipendenze',
        `«${nome}» è ormai a ${versioni.join(', ')}: la vulnerabilità è chiusa, il rinvio è una bugia`,
        'scripts/test-operations.mjs → VULNERABILITA_RIMANDATE',
        `spostalo in DIPENDENZE_MINIME con ${corretta} come pavimento: da rinvio `
        + 'è diventato un acquisto da non perdere');
    }
  }
}

/** Le versioni di ogni pacchetto nel lockfile, comprese le copie annidate. */
export function versioniDalLock(lock) {
  const out = {};
  for (const [percorso, info] of Object.entries(lock.packages ?? {})) {
    const i = percorso.lastIndexOf('node_modules/');
    if (i < 0 || !info?.version) continue;
    const nome = percorso.slice(i + 'node_modules/'.length);
    (out[nome] ??= []).push(info.version);
  }
  return out;
}

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

  // Il debito scade da solo: una riga il cui modulo è ormai raggiunto — o non è
  // più fra i portabili — non descrive più niente, e un debito estinto che resta
  // scritto insegna a non leggere l'elenco. Stessa regola delle eccezioni di
  // `design:lint`: una riga senza riscontro fa fallire il controllo.
  //
  // ⚠️ L'ORDINE DEI DUE RAMI NON È INDIFFERENTE, ed è stato corretto il
  // 2026-08-10: un file del debito insieme «raggiunto» e non-portabile riceveva
  // la diagnosi «ormai qualcuno lo importa», mentre la verità è che non è più
  // materia di questo controllo — esente per costruzione, non coperto. Il gesto
  // da fare coincide (togliere la riga), la ragione scritta accanto no, e una
  // ragione sbagliata è ciò che fa ripetere il guasto fra sei mesi.
  const vivi = new Set(portabili);
  for (const file of Object.keys(scoperti)) {
    if (!vivi.has(file)) {
      report.add('typecheck',
        `«${file}» è nel debito dichiarato, ma non è più fra i moduli portabili`,
        'scripts/test-operations.mjs → TYPECHECK_SCOPERTI',
        'il file è sparito o è diventato non-portabile — esente per costruzione: '
        + 'la riga non corrisponde più a niente e va tolta');
    } else if (raggiunti.has(file)) {
      report.add('typecheck',
        `«${file}» è nel debito dichiarato, ma ormai QUALCUNO lo importa: la riga è stantia`,
        'scripts/test-operations.mjs → TYPECHECK_SCOPERTI',
        'il debito è estinto: togli la riga. Un elenco con voci morte smette di '
        + 'essere letto, ed è l\'elenco che deve restare vivo');
    }
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
    for (const specificatore of importRelativi(sorgente)) {
      const risolto = risolviImport(dirname(file), specificatore);
      if (risolto && !visti.has(risolto)) coda.push(risolto);
    }
  }

  const prefisso = join(APP, 'supabase', 'functions') + '/';
  return new Set([...visti]
    .filter((f) => f.startsWith(prefisso))
    .map((f) => f.slice(prefisso.length)));
}

/**
 * Come `raggiuntiDalTypecheck`, ma registra i NOMI e non solo i file.
 *
 * ⚠️ La chiusura è TRANSITIVA, e non è un dettaglio: una funzione che nessun
 * test importa direttamente ma che un modulo intermedio importa È eseguita. Una
 * prima misura fatta sui soli import diretti diceva 129 funzioni scoperte; la
 * misura transitiva — la stessa nozione che usa il controllo 8 — ne dice 48.
 * Il numero grande non era più severo, era sbagliato.
 */
function nomiRaggiunti() {
  const radici = [
    ...listaFileRicorsiva(join(APP, 'src'), '.ts'),
    ...listaFileRicorsiva(join(APP, 'src'), '.tsx'),
    ...listaFileRicorsiva(join(APP, 'scripts'), '.ts'),
  ];
  const prefisso = join(APP, 'supabase', 'functions') + '/';
  const raggiunte = {};
  const stella = new Set();
  const visti = new Set();
  const coda = [...radici];

  while (coda.length) {
    const file = coda.pop();
    if (visti.has(file)) continue;
    visti.add(file);
    let sorgente;
    try { sorgente = readFileSync(file, 'utf8'); } catch { continue; }
    for (const { spec, nomi, stella: viaStella } of importConNomi(sorgente)) {
      const risolto = risolviImport(dirname(file), spec);
      if (!risolto) continue;
      if (risolto.startsWith(prefisso)) {
        const rel = risolto.slice(prefisso.length);
        raggiunte[rel] = [...new Set([...(raggiunte[rel] ?? []), ...nomi])];
        if (viaStella) stella.add(rel);
      }
      if (!visti.has(risolto)) coda.push(risolto);
    }
  }
  return { raggiunte, stella };
}

/**
 * Il sorgente senza i commenti.
 *
 * ⚠️⚠️ PERCHÉ ESISTE, e la data conta: il 2026-08-10 una revisione avversaria ha
 * dimostrato con un file di sonda che il rilevatore degli import qui sotto
 * lavora sul testo GREZZO, quindi un import soltanto CITATO in un commento
 * («un tempo si valutò di importare …») bastava a far dichiarare RAGGIUNTO un
 * modulo che nessuno importa.
 *
 * Da solo sarebbe stato un falso raggiunto silenzioso. Insieme al controllo che
 * fa scadere il debito era peggio: la riga VIVA di TYPECHECK_SCOPERTI veniva
 * segnalata come stantia, e obbedire al suggerimento — toglierla — avrebbe
 * lasciato quel modulo senza typecheck e senza rosso, per sempre. Il controllo
 * anti-bugia poteva ordinare la cancellazione che produce la bugia.
 *
 * Non è un parser TypeScript e non deve esserlo: riconosce stringhe, template
 * ed espressioni regolari quanto basta perché un `//` dentro `'https://…'` non
 * apra un commento e una virgoletta dentro `/['"]/` non apra una stringa.
 */
export function senzaCommenti(sorgente) {
  // I caratteri dopo i quali una `/` comincia un'espressione regolare e non è
  // una divisione. Sbagliare qui costa un falso NON raggiunto, che è rumoroso;
  // sbagliare nell'altro senso costerebbe un falso raggiunto, che è muto.
  const PRIMA_DI_REGEX = '(,=:[!&|?{};+-*%<>~^';
  let out = '';
  let precedente = '';                       // ultimo carattere significativo emesso

  for (let i = 0; i < sorgente.length;) {
    const c = sorgente[i], d = sorgente[i + 1];

    if (c === '/' && d === '/') {
      while (i < sorgente.length && sorgente[i] !== '\n') i++;
      continue;                              // il commento sparisce, la riga resta
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < sorgente.length && !(sorgente[i] === '*' && sorgente[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const chiusura = c;
      out += c; i++;
      while (i < sorgente.length) {
        if (sorgente[i] === '\\') { out += sorgente.slice(i, i + 2); i += 2; continue; }
        out += sorgente[i];
        const finita = sorgente[i] === chiusura;
        i++;
        if (finita) break;
      }
      precedente = chiusura;
      continue;
    }
    if (c === '/' && precedente !== '' && PRIMA_DI_REGEX.includes(precedente)) {
      out += c; i++;
      let inClasse = false;
      while (i < sorgente.length) {
        const e = sorgente[i];
        if (e === '\\') { out += sorgente.slice(i, i + 2); i += 2; continue; }
        out += e; i++;
        if (e === '[') inClasse = true;
        else if (e === ']') inClasse = false;
        else if (e === '\n') break;           // non era un'espressione regolare
        else if (e === '/' && !inClasse) break;
      }
      precedente = '/';
      continue;
    }

    out += c;
    if (!/\s/.test(c)) precedente = c;
    i++;
  }
  return out;
}

/** Gli import RELATIVI scritti in un sorgente, i commenti esclusi. */
export function importRelativi(sorgente) {
  return [...senzaCommenti(sorgente).matchAll(/(?:from|import)\s*\(?\s*['"](\.[^'"]+)['"]/g)]
    .map((m) => m[1]);
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

  const esportate = {};
  for (const rel of portabili) {
    try {
      const nomi = funzioniEsportate(readFileSync(join(APP, 'supabase', 'functions', rel), 'utf8'));
      if (nomi.length) esportate[rel] = nomi;
    } catch { /* illeggibile: se ne occupa il controllo 8 */ }
  }
  const { raggiunte, stella } = nomiRaggiunti();
  checkFunzioniProvate(report, { esportate, raggiunte, scoperte: FUNZIONI_SCOPERTE, stella });

  checkDipendenze(report, {
    installate: versioniDalLock(JSON.parse(readFileSync(join(APP, 'package-lock.json'), 'utf8'))),
    minime: DIPENDENZE_MINIME,
    rimandate: VULNERABILITA_RIMANDATE,
  });

  return { report, funzioni, dichiarati, portabili, tuttiTs, esportate, raggiunte };
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
  // --- IL CONTROLLO 9: LE FUNZIONI -------------------------------------------
  // ⚠️ Il primo caso è il difetto vero, in miniatura: il file è raggiunto da
  // UNA delle sue funzioni, e l'altra non la esegue nessuno. È la situazione
  // esatta di notify.ts l'11 agosto 2026, ed è ciò che il controllo 8 — che
  // guarda i file — non poteva vedere.
  {
    name: '⚠️ due funzioni nello stesso file, una sola importata → problema per l\'altra (il caso di generateReminders)',
    run: (r) => checkFunzioniProvate(r, {
      esportate: { '_shared/calendar/notify.ts': ['deliverEmails', 'generateReminders'] },
      raggiunte: { '_shared/calendar/notify.ts': ['deliverEmails'] },
    }),
    expect: 1,
    contiene: '«generateReminders»',
  },
  {
    name: '…e il controllo 8, sugli stessi dati, non vede niente: è la prova che il 9 serve',
    run: (r) => checkTypecheck(r, {
      portabili: ['_shared/calendar/notify.ts'],
      raggiunti: new Set(['_shared/calendar/notify.ts']),
    }),
    expect: 0,
  },
  {
    name: 'entrambe importate → nessun problema',
    run: (r) => checkFunzioniProvate(r, {
      esportate: { '_shared/calendar/notify.ts': ['deliverEmails', 'generateReminders'] },
      raggiunte: { '_shared/calendar/notify.ts': ['deliverEmails', 'generateReminders'] },
    }),
    expect: 0,
  },
  {
    name: 'una funzione nel debito DICHIARATO → nessun problema, ma resta scritta',
    run: (r) => checkFunzioniProvate(r, {
      esportate: { '_shared/calendar/notify.ts': ['deliverEmails', 'generateReminders'] },
      raggiunte: { '_shared/calendar/notify.ts': ['deliverEmails'] },
      scoperte: { '_shared/calendar/notify.ts#generateReminders': 'debito noto' },
    }),
    expect: 0,
  },
  {
    name: '⚠️ una riga di debito la cui funzione è ORMAI importata → problema: la riga è stantia',
    run: (r) => checkFunzioniProvate(r, {
      esportate: { '_shared/calendar/notify.ts': ['generateReminders'] },
      raggiunte: { '_shared/calendar/notify.ts': ['generateReminders'] },
      scoperte: { '_shared/calendar/notify.ts#generateReminders': 'debito estinto che nessuno ha cancellato' },
    }),
    expect: 1,
    contiene: 'la riga è stantia',
  },
  {
    // Il gesto coincide con il caso sopra — togliere la riga — la ragione no.
    name: '⚠️ una riga di debito la cui funzione NON ESISTE PIÙ → problema, e con l\'altra diagnosi',
    run: (r) => checkFunzioniProvate(r, {
      esportate: { '_shared/calendar/notify.ts': ['generateReminders'] },
      raggiunte: { '_shared/calendar/notify.ts': ['generateReminders'] },
      scoperte: { '_shared/calendar/notify.ts#funzioneRinominata': 'riga rimasta dopo un rinomino' },
    }),
    expect: 1,
    contiene: 'non è più una funzione esportata',
  },
  {
    name: 'un file dietro `export *` è ESCLUSO: i nomi non si vedono e non si deducono',
    run: (r) => checkFunzioniProvate(r, {
      esportate: { '_shared/calendar/notify.ts': ['deliverEmails', 'generateReminders'] },
      raggiunte: { '_shared/calendar/notify.ts': [] },
      stella: new Set(['_shared/calendar/notify.ts']),
    }),
    expect: 0,
  },
  {
    name: 'un file NON raggiunto non è materia del 9: lo dice il controllo 8, e una volta sola',
    run: (r) => checkFunzioniProvate(r, {
      esportate: { '_shared/calendar/notify.ts': ['deliverEmails', 'generateReminders'] },
      raggiunte: {},
    }),
    expect: 0,
  },
  // --- I DUE RILEVATORI, provati sui casi che DEVONO farli sbagliare ---------
  {
    name: 'rilevatore: riconosce `export function`, `export async function` e `export const f = () =>`',
    run: (r) => {
      const trovate = funzioniEsportate(
        'export function a() {}\n'
        + 'export async function b() {}\n'
        + 'export const c = (x: number) => x;\n'
        + 'export const d = async () => {};\n'
        + 'export const NON_UNA_FUNZIONE = 3;\n'
        + 'function privata() {}\n',
      ).sort().join(',');
      if (trovate !== 'a,b,c,d') r.add('autoverifica', `funzioniEsportate: «${trovate}»`, '', '');
    },
    expect: 0,
  },
  {
    name: '⚠️ rilevatore: una funzione esportata dentro un COMMENTO non conta',
    run: (r) => {
      const trovate = funzioniEsportate('// export function finta() {}\n/* export function altra() {} */\nexport function vera() {}\n');
      if (trovate.join(',') !== 'vera') r.add('autoverifica', `funzioniEsportate sui commenti: «${trovate.join(',')}»`, '', '');
    },
    expect: 0,
  },
  {
    name: 'rilevatore: `export * from` è marcato stella, `export { a } from` no',
    run: (r) => {
      const s = importConNomi("export * from './x';");
      const n = importConNomi("export { a } from './y';");
      if (!(s.length === 1 && s[0].stella === true)) r.add('autoverifica', 'la stella non è riconosciuta', '', '');
      if (!(n.length === 1 && n[0].stella === false && n[0].nomi[0] === 'a')) {
        r.add('autoverifica', 'il ri-esporto per nome è letto male', '', '');
      }
    },
    expect: 0,
  },
  {
    name: 'rilevatore: `import { type T, a as b }` porta i nomi ORIGINALI',
    run: (r) => {
      const got = importConNomi("import { type T, a as b, c } from './z';")[0];
      if (got.nomi.join(',') !== 'T,a,c') r.add('autoverifica', `nomi letti: «${got.nomi.join(',')}»`, '', '');
    },
    expect: 0,
  },
  {
    // Se questo caso sparisse, la camminata del 9 si fermerebbe agli import per
    // solo effetto e lascerebbe scoperto tutto ciò che sta oltre, senza dirlo.
    name: '⚠️ rilevatore: `import \'./x\'` (per solo effetto) è raccolto, con zero nomi',
    run: (r) => {
      const got = importConNomi("import './effetti.ts';\nimport { a } from './y';");
      const effetti = got.find((x) => x.spec === './effetti.ts');
      if (!effetti) r.add('autoverifica', 'l\'import per solo effetto non è stato visto: la camminata si fermerebbe lì', '', '');
      else if (effetti.nomi.length) r.add('autoverifica', `porta nomi che non ha: «${effetti.nomi.join(',')}»`, '', '');
      if (got.length !== 2) r.add('autoverifica', `import letti: ${got.length}, attesi 2`, '', '');
    },
    expect: 0,
  },
  {
    name: '…e `import x from \'./y\'` NON viene contato due volte',
    run: (r) => {
      const got = importConNomi("import x from './y';");
      if (got.length !== 1) r.add('autoverifica', `import letti: ${got.length}, atteso 1`, '', '');
    },
    expect: 0,
  },
  {
    name: '⚠️ una riga del debito il cui modulo è ORMAI raggiunto → problema: la riga è stantia',
    run: (r) => checkTypecheck(r, {
      portabili: ['_shared/calendar/sync.ts'],
      raggiunti: new Set(['_shared/calendar/sync.ts']),
      scoperti: { '_shared/calendar/sync.ts': 'debito estinto che nessuno ha cancellato' },
    }),
    expect: 1,
    contiene: 'ormai QUALCUNO lo importa',
  },
  {
    name: '⚠️ una riga del debito verso un modulo che non è più fra i portabili → problema',
    run: (r) => checkTypecheck(r, {
      portabili: [], raggiunti: new Set(),
      scoperti: { '_shared/calendar/sparito.ts': 'il file non esiste più' },
    }),
    expect: 1,
    contiene: 'non è più fra i moduli portabili',
  },
  {
    name: '⚠️ raggiunto E non-portabile insieme: la diagnosi è «non più portabile», non «lo importano»',
    run: (r) => checkTypecheck(r, {
      portabili: [], raggiunti: new Set(['_shared/x/deno-only.ts']),
      scoperti: { '_shared/x/deno-only.ts': 'diventato non-portabile: usa Deno.env' },
    }),
    expect: 1,
    contiene: 'non è più fra i moduli portabili',
  },

  // --- IL RILEVATORE DEGLI IMPORT --------------------------------------------
  // ⚠️ Trovato da una revisione avversaria il 2026-08-10, con un file di sonda:
  // un import CITATO in un commento faceva dichiarare raggiunto un modulo che
  // nessuno importa — e il controllo del debito ordinava di togliere la riga
  // viva, cioè di creare il buco che quella riga teneva visibile.
  {
    name: '⚠️⚠️ un import citato in un COMMENTO non rende raggiunto un modulo',
    run: (r) => {
      const sorgente = "// un tempo si valutò\n// import '../supabase/functions/_shared/assistant/store.ts'\nexport {};\n";
      if (importRelativi(sorgente).length !== 0) {
        r.add('autoverifica', 'un import commentato è stato contato come vero', 'importRelativi');
      }
    },
    expect: 0,
  },
  {
    name: 'lo stesso import, NON commentato, viene invece contato',
    run: (r) => {
      const sorgente = "import { x } from '../supabase/functions/_shared/assistant/store.ts';\n";
      if (importRelativi(sorgente).length !== 1) {
        r.add('autoverifica', 'un import vero non è stato trovato', 'importRelativi');
      }
    },
    expect: 0,
  },
  {
    name: '⚠️ un `//` dentro una stringa non apre un commento: l’import che segue si vede',
    run: (r) => {
      const sorgente = "const u = 'https://app.ai-swisse.com';\nimport './vicino.ts';\n";
      if (!importRelativi(sorgente).includes('./vicino.ts')) {
        r.add('autoverifica', 'un URL in una stringa ha mangiato l’import successivo', 'senzaCommenti');
      }
    },
    expect: 0,
  },
  {
    name: '⚠️ una virgoletta dentro un’espressione regolare non apre una stringa',
    run: (r) => {
      const sorgente = "const re = /['\"]x/g;\nimport './dopo-la-regex.ts';\n";
      if (!importRelativi(sorgente).includes('./dopo-la-regex.ts')) {
        r.add('autoverifica', 'una regex con virgolette ha mangiato l’import successivo', 'senzaCommenti');
      }
    },
    expect: 0,
  },
  {
    name: 'un commento a BLOCCHI che cita un import non conta, e non mangia il codice dopo',
    run: (r) => {
      const sorgente = "/* import './finto.ts' */\nimport './vero.ts';\n";
      const trovati = importRelativi(sorgente);
      if (trovati.length !== 1 || trovati[0] !== './vero.ts') {
        r.add('autoverifica', `letti ${JSON.stringify(trovati)}`, 'senzaCommenti');
      }
    },
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
  // --- 10. DIPENDENZE — il pavimento, e il rinvio che invecchia -------------
  {
    name: 'una versione tornata sotto il minimo → problema',
    run: (r) => checkDipendenze(r, {
      installate: { nanoid: ['3.3.7'] },
      minime: { nanoid: { minima: '3.3.18', perche: 'x' } },
      rimandate: {},
    }),
    expect: 1,
    contiene: 'sotto il minimo 3.3.18',
  },
  {
    name: 'la versione corretta → nessun problema',
    run: (r) => checkDipendenze(r, {
      installate: { nanoid: ['3.3.18'] },
      minime: { nanoid: { minima: '3.3.18', perche: 'x' } },
      rimandate: {},
    }),
    expect: 0,
  },
  // ⚠️ UNA COPIA SOLA BASTA. `tsx` porta il suo `esbuild`: un albero con la
  // versione buona in cima e quella bucata annidata è vulnerabile lo stesso, e
  // guardare solo la prima copia sarebbe un verde che ha misurato la cosa
  // accanto — il difetto che questo file combatte in ogni sua riga.
  {
    name: 'una COPIA ANNIDATA sotto il minimo → problema, anche se quella in cima va bene',
    run: (r) => checkDipendenze(r, {
      installate: { postcss: ['8.5.26', '8.4.31'] },
      minime: { postcss: { minima: '8.5.22', perche: 'x' } },
      rimandate: {},
    }),
    expect: 1,
    contiene: '8.4.31',
  },
  {
    name: 'un pavimento su un pacchetto che non c’è più → problema (riga stantia)',
    run: (r) => checkDipendenze(r, {
      installate: {},
      minime: { nanoid: { minima: '3.3.18', perche: 'x' } },
      rimandate: {},
    }),
    expect: 1,
    contiene: 'stantia',
  },
  {
    name: 'un rinvio ancora vero → nessun problema',
    run: (r) => checkDipendenze(r, {
      installate: { esbuild: ['0.21.5', '0.28.1'] },
      minime: {},
      rimandate: { esbuild: { corretta: '0.25.0', perche: 'x' } },
    }),
    expect: 0,
  },
  // ⚠️ È IL CASO CHE FA VIVERE L'ELENCO. Un rinvio che nessuno rilegge diventa
  // il racconto di un problema già risolto, e la volta dopo lo si crede ancora
  // aperto. Qui diventa rosso il giorno in cui smette di essere vero.
  {
    name: 'un rinvio ormai chiuso dall’albero → problema (il rinvio è una bugia)',
    run: (r) => checkDipendenze(r, {
      installate: { esbuild: ['0.25.1'] },
      minime: {},
      rimandate: { esbuild: { corretta: '0.25.0', perche: 'x' } },
    }),
    expect: 1,
    contiene: 'il rinvio è una bugia',
  },
  // ⚠️ NON È UN CONFRONTO DI STRINGHE. `'3.3.7' > '3.3.18'` è vero in
  // JavaScript, e con quello il pavimento avrebbe lasciato passare proprio la
  // versione bucata che esiste per fermare.
  {
    name: 'confronto di versioni: 3.3.7 < 3.3.18 (non è un confronto di stringhe)',
    run: (r) => {
      if (!(confrontaVersioni('3.3.7', '3.3.18') < 0)) {
        r.add('autoverifica', '3.3.7 letta come maggiore di 3.3.18', 'confrontaVersioni');
      }
      if (confrontaVersioni('8.5.26', '8.5.22') < 0) {
        r.add('autoverifica', '8.5.26 letta come minore di 8.5.22', 'confrontaVersioni');
      }
      if (confrontaVersioni('0.21.5', '0.25.0') >= 0) {
        r.add('autoverifica', '0.21.5 letta come maggiore di 0.25.0', 'confrontaVersioni');
      }
    },
    expect: 0,
  },
  {
    name: 'il lockfile: si legge anche la copia annidata, non solo quella in cima',
    run: (r) => {
      const v = versioniDalLock({ packages: {
        '': { version: '1.0.0' },
        'node_modules/esbuild': { version: '0.21.5' },
        'node_modules/tsx/node_modules/esbuild': { version: '0.28.1' },
      } });
      if (JSON.stringify(v) !== JSON.stringify({ esbuild: ['0.21.5', '0.28.1'] })) {
        r.add('autoverifica', `lette ${JSON.stringify(v)}`, 'versioniDalLock');
      }
    },
    expect: 0,
  },
];

/**
 * I nomi ESPORTATI da un sorgente: `export function`, `export async function`
 * e `export const f = (…) =>`.
 *
 * ⚠️ IL PERIMETRO È DICHIARATO, non dimenticato. Restano fuori le classi, i
 * tipi e le costanti che non sono funzioni: la domanda del controllo 9 è «c'è
 * del COMPORTAMENTO che nessuno esegue», e un tipo non ha comportamento. Come
 * per `design:lint`, allargare il perimetro è un intervento a sé, con i suoi
 * numeri prima e dopo — non una riga aggiunta di straforo.
 */
export function funzioniEsportate(sorgente) {
  const puro = senzaCommenti(sorgente);
  const nomi = new Set();
  for (const m of puro.matchAll(/^export\s+(?:async\s+)?function\s+(\w+)/gm)) nomi.add(m[1]);
  for (const m of puro.matchAll(/^export\s+const\s+(\w+)\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|\w+)\s*(?::[^=]+)?=>/gm)) {
    nomi.add(m[1]);
  }
  return [...nomi];
}

/**
 * Gli import RELATIVI con i NOMI che portano: `{ a, b }`, `{ type T }`,
 * `export { a } from`, e la stella — che è il caso interessante.
 *
 * ⚠️ `export * from './x'` non nomina niente: chi importa il ri-esportatore
 * raggiunge il modulo senza che questo controllo possa dire QUALE funzione.
 * Non si finge di saperlo: i moduli dietro una stella vengono ESCLUSI dal
 * controllo 9 e restano affare del controllo 8. Un «coperto» dedotto è
 * esattamente il verde che questo file esiste per impedire.
 */
export function importConNomi(sorgente) {
  const puro = senzaCommenti(sorgente);
  const out = [];
  const named = /import\s+(?:(?:type\s+)?\{([^}]*)\}\s*|[\w*]+(?:\s*,\s*\{([^}]*)\})?\s+)?from\s*['"](\.[^'"]+)['"]/g;
  for (const m of puro.matchAll(named)) {
    out.push({ spec: m[3], nomi: spezzaNomi(m[1] ?? m[2]), stella: false });
  }
  for (const m of puro.matchAll(/export\s+(?:\{([^}]*)\}|\*)\s*from\s*['"](\.[^'"]+)['"]/g)) {
    out.push({ spec: m[2], nomi: spezzaNomi(m[1]), stella: m[1] === undefined });
  }
  // ⚠️ L'IMPORT PER SOLO EFFETTO — `import './x'`, senza `from`. Non nomina
  // niente, ed è proprio per questo che va raccolto: `importRelativi` lo vede
  // (quindi il controllo 8 considera raggiunto ciò che sta oltre), e se qui non
  // lo vedessimo la camminata del controllo 9 si fermerebbe lì, IN SILENZIO,
  // lasciando scoperto un sottoalbero senza dirlo. Oggi nel repository ce ne
  // sono tre e sono tutti fogli di stile: il buco è teorico, e si chiude adesso
  // che costa una riga invece che il giorno in cui qualcuno scrive
  // `import './registrazione.ts'`. Porta `nomi: []`, che è la verità: un import
  // per effetto non esercita nessuna funzione.
  for (const m of puro.matchAll(/(?:^|[;{}\n])\s*import\s*['"](\.[^'"]+)['"]/g)) {
    out.push({ spec: m[1], nomi: [], stella: false });
  }
  return out;
}

function spezzaNomi(grezzo) {
  if (!grezzo) return [];
  return grezzo.split(',')
    .map((r) => r.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

/**
 * 9. Ogni funzione esportata da un modulo portabile è importata per nome.
 *
 * Stessa forma del controllo 8 e stessa disciplina del debito: una riga di
 * `FUNZIONI_SCOPERTE` il cui debito è estinto — la funzione è ormai importata,
 * oppure non esiste più — fa fallire il controllo. Le due diagnosi sono
 * distinte di proposito: il gesto coincide (togliere la riga), la ragione no,
 * e una ragione sbagliata è ciò che fa ripetere il guasto fra sei mesi.
 */
export function checkFunzioniProvate(report, { esportate, raggiunte, scoperte = {}, stella = new Set() }) {
  const vive = new Set();
  for (const [file, nomi] of Object.entries(esportate)) {
    if (stella.has(file)) continue;         // ri-esportato in blocco: vedi importConNomi
    const viste = raggiunte[file];
    if (!viste) continue;                   // file non raggiunto: è il controllo 8 a dirlo
    for (const nome of nomi) {
      const chiave = `${file}#${nome}`;
      vive.add(chiave);
      if (viste.includes(nome)) continue;
      if (chiave in scoperte) continue;     // debito dichiarato
      report.add('funzioni',
        `«${nome}» è esportata da «${file}» e nessuno la importa per nome`,
        `supabase/functions/${file}`,
        'il file risulta coperto perché un\'ALTRA sua funzione è importata: '
        + 'nessun test esegue questa, e nessun rosso protegge ciò che fa. '
        + 'Importala da un test che la ESEGUE, oppure dichiarala in '
        + 'FUNZIONI_SCOPERTE con il motivo');
    }
  }

  for (const chiave of Object.keys(scoperte)) {
    if (!vive.has(chiave)) {
      report.add('funzioni',
        `«${chiave}» è nel debito dichiarato, ma non è più una funzione esportata da un modulo raggiunto`,
        'scripts/test-operations.mjs → FUNZIONI_SCOPERTE',
        'la funzione è stata rinominata, tolta, o il suo file non è più materia '
        + 'di questo controllo: la riga non corrisponde più a niente e va tolta');
      continue;
    }
    const [file, nome] = chiave.split('#');
    if ((raggiunte[file] ?? []).includes(nome)) {
      report.add('funzioni',
        `«${chiave}» è nel debito dichiarato, ma ormai QUALCUNO la importa: la riga è stantia`,
        'scripts/test-operations.mjs → FUNZIONI_SCOPERTE',
        'il debito è estinto: togli la riga. Un elenco con voci morte smette di '
        + 'essere letto, ed è l\'elenco che deve restare vivo');
    }
  }
}

/**
 * ⚠️ `contiene` non è un vezzo: contare i problemi prova che QUALCOSA è
 * scattato, non che sia scattata la diagnosi giusta. Una revisione avversaria
 * l'ha dimostrato il 2026-08-10 fondendo i due rami del debito in un `if` solo
 * con un messaggio generico: tutti i casi restavano verdi, e i due suggerimenti
 * — che guidano gesti diversi — erano diventati uno sbagliato. Dove il ramo
 * conta, il caso dichiara la frase che deve comparire.
 */
function autoverifica(silenziosa = false) {
  const falliti = [];
  for (const c of CASES) {
    const r = new Report();
    c.run(r);
    const detto = r.problems.map((p) => p.what).join(' | ');
    if (r.problems.length !== c.expect) falliti.push({ c, got: r.problems.length });
    else if (c.contiene && !detto.includes(c.contiene)) {
      falliti.push({ c, got: `diagnosi diversa: «${detto}»` });
    } else if (!silenziosa) console.log(`  ${G}✓${X} ${c.name}`);
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
