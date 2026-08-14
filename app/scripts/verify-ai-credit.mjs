#!/usr/bin/env node
// ============================================================================
// verify:ai — «i percorsi AI possono funzionare ADESSO?»
//
// ⚠️ PERCHÉ ESISTE. Il credito Anthropic è l'unica dipendenza del prodotto il
// cui stato non era misurabile con un comando. Gli scheduler li dice
// `verify:deploy`, le migrazioni `supabase migration list --linked`, i permessi
// `test:audit`, i documenti `docs:check` — il credito lo si scopriva **quando
// mordeva**: un worker che rimette in coda, tre messaggi fermi nella posta, una
// sezione di questo repository che dice il contrario di ieri. Tre esaurimenti in
// due settimane, e ogni volta la scoperta è arrivata dopo il guasto.
//
// Il codice si comporta bene: `contract-worker` classifica l'esaurimento come
// guasto d'AMBIENTE (`QUOTA_EXCEEDED`), rimette in coda e non scrive verbali
// falsi; `drainPendingClassifications` ripesca i messaggi da solo quando il
// credito torna. Non è lì il problema, e questo comando non tocca niente di
// tutto ciò. Il problema è che per sapere se il prodotto può funzionare
// bisognava aspettare che non funzionasse.
//
//   npm run verify:ai              → la risposta, con la storia accanto
//   npm run verify:ai -- --json    → una riga JSON, per chi la consuma
//   npm run verify:ai -- --self-test   → prova le decisioni, senza rete
//   npm run verify:ai -- --model=claude-opus-4-8   → sonda un altro modello
//
// LA SONDA, e perché costa praticamente nulla. Una `POST /v1/messages` con
// `max_tokens: 1` sul modello più economico: è la stessa misura che
// `product-status.md` usa dal 2026-08-01 per dire «esaurito», e serve solo a
// distinguere un 200 da un 400. Su credito esaurito l'API rifiuta **prima** di
// far ragionare il modello: zero token, come già misurato sul ciclo dell'Inbox.
//
// I QUATTRO GUASTI SONO QUATTRO, e «l'AI non va» non è una diagnosi: hanno
// quattro rimedi diversi, e tre dei quattro non li può eseguire chi legge.
//
//   exit 0  i percorsi AI possono funzionare
//   exit 1  CREDITO ESAURITO           → ricaricare il conto (decisione di chi
//                                        conduce il prodotto, non di un comando)
//   exit 2  CHIAVE ASSENTE             → manca `ANTHROPIC_API_KEY` nell'ambiente
//   exit 3  CHIAVE RIFIUTATA           → la chiave esiste e l'API la respinge:
//                                        va rigenerata, e riallineato il secret
//   exit 4  SERVIZIO IRRAGGIUNGIBILE   → rete, timeout, 5xx: non è colpa nostra
//                                        e non si rimedia ricaricando
//   exit 5  RIFIUTO NON CLASSIFICATO   → l'API dice no per una ragione che
//                                        questo comando non conosce. NON è un
//                                        verde: il testo dell'API viene stampato
//   exit 6  LE DUE CHIAVI DIVERGONO    → qui funziona, in produzione no (§sotto)
//
// ⚠️⚠️ LA CHIAVE GIUSTA, E LA TRAPPOLA GIÀ PAGATA. La chiave di `.env.test` e
// quella dei secret delle Edge Function devono essere la STESSA: se divergono,
// questo comando direbbe «si può lavorare» mentre in produzione ogni analisi
// prende 401. Il confronto corretto è `sha256(chiave) === value` del secret —
// `GET /v1/projects/<ref>/secrets` **non restituisce il valore**, restituisce il
// suo SHA-256 (64 caratteri esadecimali, per tutti e 21). Il 2026-07-31
// confrontare quel campo con la chiave ha prodotto la diagnosi di un guasto
// inesistente, per due giri interi.
//
// ⚠️ Senza `SUPABASE_ACCESS_TOKEN` quel confronto non si può fare: la riga lo
// DICE («non verificato»), e la frase finale dichiara che la risposta vale per
// la chiave locale. Non si deduce «coincidono» dal fatto di non aver guardato.
//
// ⚠️ E SI LEGGE `ai_request_log`, perché la sonda da sola non dice QUANDO.
// L'ultima richiesta riuscita e l'ultimo codice d'errore raccontano se il
// prodotto ha smesso di funzionare un'ora fa o tredici giorni fa — e su un
// sistema in cui l'assenza di traffico è normale, quella differenza è tutto.
//
// COSA QUESTO COMANDO NON DICE — dichiarato qui perché nessuno lo deduca:
//   · **un 200 su una richiesta da un token non promette una lettura da 50 000.**
//     Dice che l'account non è a zero e che la chiave è accettata, non che il
//     credito basti per un contratto intero o per un giro di `eval:assistant`;
//   · sonda UN modello (per difetto il più economico). Il prodotto gira su
//     `claude-opus-4-8` e `claude-opus-5`: un divieto per modello non si vede da
//     qui, e per guardarlo si passa `--model=`;
//   · non dice niente sulla velocità né sui limiti al minuto;
//   · non guarda i secret delle Edge Function oltre a `ANTHROPIC_API_KEY`;
//   · e **non ricarica niente**. Il piano di ricarica è una decisione: questo
//     comando esiste perché si sappia PRIMA, non per decidere al posto di
//     qualcuno.
//
// CON CHE FREQUENZA. Prima di ogni giro che spende (ci pensa il runner: i
// gruppi `integration` ed `eval` lo chiamano da soli), e quando si rimisura lo
// stato (`npm run status` lo esegue e ne scrive la riga). Non è un cruscotto e
// non gira da solo: nessuno scheduler lo invoca, di proposito — sorvegliare il
// credito con un cron significherebbe decidere che qualcuno guardi quel log.
// ============================================================================
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

// Il modello della sonda: il più economico. Non è quello del prodotto, ed è
// dichiarato sopra fra le cose che questo comando non dice.
export const MODELLO_SONDA = 'claude-haiku-4-5';

// ---------------------------------------------------------------------------
// LE DECISIONI, COME FUNZIONI PURE.
//
// ⚠️ Stanno fuori dal flusso di rete perché altrimenti non sarebbero provabili:
// per vedere questo comando reagire a un credito esaurito bisognerebbe
// esaurirlo. Prendendo in ingresso la risposta dell'API si possono invece
// passare i casi che DEVONO produrre ciascuna diagnosi — che è la sola cosa che
// dimostra che una diagnosi funzioni. `verify:deploy` fa già così, e
// `i18n:coverage` è nato senza e ha dato due verdi falsi.
// ---------------------------------------------------------------------------

/** I sei esiti della sonda, con il rimedio di ciascuno. */
export const CASI = {
  ok: { code: 0, titolo: 'i percorsi AI possono funzionare', rimedio: null },
  credito: {
    code: 1,
    titolo: 'CREDITO ESAURITO',
    rimedio: 'ricaricare il conto Anthropic. Nessun comando lo fa: è una decisione. '
      + 'Nel frattempo i worker rimettono in coda e non scrivono verbali falsi.',
  },
  chiaveAssente: {
    code: 2,
    titolo: 'CHIAVE ASSENTE',
    rimedio: "ANTHROPIC_API_KEY non è nell'ambiente: in locale arriva da .env.test "
      + '(node --env-file=.env.test), nelle Edge Function dai secret del progetto.',
  },
  chiaveRifiutata: {
    code: 3,
    titolo: 'CHIAVE RIFIUTATA',
    rimedio: "la chiave c'è e l'API la respinge: è scaduta, revocata o di un altro account. "
      + 'Va rigenerata E riallineata al secret ANTHROPIC_API_KEY del progetto Supabase, '
      + 'altrimenti metà prodotto continua a usare quella vecchia.',
  },
  irraggiungibile: {
    code: 4,
    titolo: 'SERVIZIO IRRAGGIUNGIBILE',
    rimedio: 'rete, timeout o guasto del servizio: ricaricare il conto non cambierebbe niente. '
      + 'Si riprova; se dura, è un guasto di Anthropic, non nostro.',
  },
  nonClassificato: {
    code: 5,
    titolo: 'RIFIUTO NON CLASSIFICATO',
    rimedio: "l'API rifiuta per una ragione che questo comando non conosce. Il suo testo è "
      + 'stampato qui sopra: va letto, non interpretato. Non è un verde.',
  },
  chiaviDivergenti: {
    code: 6,
    titolo: 'LE DUE CHIAVI DIVERGONO',
    rimedio: 'la chiave locale funziona, ma NON è quella che usano le Edge Function: '
      + 'in produzione ogni percorso AI prende 401 mentre qui tutto sembra a posto. '
      + 'Si allinea il secret ANTHROPIC_API_KEY del progetto.',
  },
};

/**
 * La diagnosi, dalla risposta dell'API.
 *
 * ⚠️ IL DISCRIMINE DEL CREDITO È IL TESTO, e va detto perché è l'unica parte
 * fragile di questo file: l'esaurimento arriva come **400 invalid_request_error**
 * con «Your credit balance is too low…», cioè con lo stesso codice HTTP di una
 * richiesta malformata. Un 400 che non parla di credito NON diventa «credito
 * esaurito»: diventa `nonClassificato`, che esce non-zero e stampa il testo
 * vero. Preferire un rifiuto senza nome a una diagnosi inventata è la regola di
 * casa: un guasto è un errore esplicito, mai un risultato plausibile.
 */
export function classificaSonda({ chiaveAssente = false, erroreRete = null, status = null, tipo = null, messaggio = '' } = {}) {
  if (chiaveAssente) return { caso: 'chiaveAssente', ...CASI.chiaveAssente };
  if (erroreRete) return { caso: 'irraggiungibile', ...CASI.irraggiungibile, dettaglio: erroreRete };
  if (status === 200) return { caso: 'ok', ...CASI.ok };

  const testo = String(messaggio ?? '');
  const parlaDiCredito = /credit balance is too low|insufficient (credit|balance)|billing/i.test(testo);

  if (status === 400 && parlaDiCredito) return { caso: 'credito', ...CASI.credito, dettaglio: testo };
  if (status === 401 || status === 403 || tipo === 'authentication_error' || tipo === 'permission_error') {
    return { caso: 'chiaveRifiutata', ...CASI.chiaveRifiutata, dettaglio: testo };
  }
  // 429 e 5xx: il servizio c'è e non risponde. Il rimedio è aspettare, non
  // ricaricare — e confonderli manderebbe a spendere per un guasto altrui.
  if (status === 429 || (typeof status === 'number' && status >= 500)) {
    return { caso: 'irraggiungibile', ...CASI.irraggiungibile, dettaglio: `HTTP ${status} · ${testo}` };
  }
  return { caso: 'nonClassificato', ...CASI.nonClassificato, dettaglio: `HTTP ${status} · ${tipo ?? '—'} · ${testo}` };
}

/**
 * Il confronto fra la chiave locale e il secret delle Edge Function.
 *
 * `secretValue` è ciò che restituisce la Management API: **lo SHA-256 della
 * chiave**, non la chiave. `null` = non abbiamo potuto guardare, ed è un terzo
 * stato distinto da «diverse»: la frase finale lo dichiara invece di dedurne
 * una coincidenza.
 */
export function confrontaChiavi({ chiave, secretValue }) {
  if (!chiave) return { stato: 'ignoto', perche: 'nessuna chiave locale da confrontare' };
  if (!secretValue) return { stato: 'ignoto', perche: 'secret non letto (serve SUPABASE_ACCESS_TOKEN)' };
  const impronta = createHash('sha256').update(chiave, 'utf8').digest('hex');
  return { stato: impronta === String(secretValue).toLowerCase() ? 'coincidono' : 'divergono' };
}

/**
 * L'esito del comando: la sonda decide, il confronto delle chiavi può solo
 * PEGGIORARLO.
 *
 * ⚠️ L'ordine non è arbitrario. Un credito esaurito rende irrilevante quale
 * chiave usi la produzione: sarebbe ferma comunque. Ma una sonda verde con le
 * chiavi divergenti è il caso peggiore di tutti — l'unico in cui questo comando,
 * senza il confronto, direbbe «si può lavorare» mentre nessun utente può.
 */
export function giudizioFinale({ sonda, chiavi }) {
  if (sonda.caso !== 'ok') return { code: sonda.code, caso: sonda.caso, titolo: sonda.titolo, rimedio: sonda.rimedio };
  if (chiavi?.stato === 'divergono') {
    return { code: CASI.chiaviDivergenti.code, caso: 'chiaviDivergenti', ...CASI.chiaviDivergenti };
  }
  return { code: 0, caso: 'ok', titolo: CASI.ok.titolo, rimedio: null };
}

/**
 * La storia, da `ai_request_log`: l'ultima riga riuscita e l'ultima fallita.
 *
 * ⚠️ Le due date NON sono la stessa domanda, e tenerle separate è il punto:
 * «l'ultima volta che un percorso AI è arrivato in fondo» e «l'ultima volta che
 * ci ha provato» distinguono un prodotto fermo da un prodotto inattivo. Il
 * 2026-08-02 l'Inbox era a zero `failed` e non spendeva chiamate: nessun errore
 * recente NON significava che il credito ci fosse.
 */
export function riassumiLog(righe, adesso = new Date()) {
  if (!Array.isArray(righe)) return null;
  const per = (f) => righe.filter(f).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0] ?? null;
  const ok = per((r) => r.status === 'ok');
  const err = per((r) => r.status === 'error');
  const ore = (r) => (r ? Math.round((adesso.getTime() - new Date(r.created_at).getTime()) / 3_600_000) : null);
  return {
    righe: righe.length,
    ultimaOk: ok ? { quando: ok.created_at, oreFa: ore(ok), kind: ok.kind ?? null, model: ok.model ?? null } : null,
    ultimoErrore: err
      ? { quando: err.created_at, oreFa: ore(err), codice: err.error_code ?? null, kind: err.kind ?? null }
      : null,
  };
}

// ---------------------------------------------------------------------------
// AUTOVERIFICA — ogni caso è costruito per far sbagliare una diagnosi precisa.
// ---------------------------------------------------------------------------
function selfTest() {
  const casi = [
    // --- la sonda ---
    ['⚠️ IL CASO REALE: 400 «credit balance is too low» → credito esaurito, exit 1',
      () => classificaSonda({ status: 400, tipo: 'invalid_request_error', messaggio: 'Your credit balance is too low to access the Anthropic API.' }).code === 1],
    ['⚠️ un 400 che NON parla di credito non diventa «credito esaurito»',
      () => classificaSonda({ status: 400, tipo: 'invalid_request_error', messaggio: 'max_tokens: must be >= 1' }).caso === 'nonClassificato'],
    ['⚠️ e quel 400 senza nome NON esce zero',
      () => classificaSonda({ status: 400, messaggio: 'qualcosa di nuovo' }).code !== 0],
    ['200 → si può lavorare', () => classificaSonda({ status: 200 }).code === 0],
    ['401 → chiave rifiutata, non credito',
      () => classificaSonda({ status: 401, tipo: 'authentication_error', messaggio: 'invalid x-api-key' }).caso === 'chiaveRifiutata'],
    ['403 → chiave rifiutata', () => classificaSonda({ status: 403 }).caso === 'chiaveRifiutata'],
    ['chiave assente → exit 2, e la rete non viene nemmeno toccata',
      () => classificaSonda({ chiaveAssente: true }).code === 2],
    ['errore di rete → servizio irraggiungibile',
      () => classificaSonda({ erroreRete: 'fetch failed' }).code === 4],
    ['⚠️ un 429 non è credito esaurito: si aspetta, non si ricarica',
      () => classificaSonda({ status: 429, messaggio: 'rate limit' }).caso === 'irraggiungibile'],
    ['un 500 è del servizio, non nostro', () => classificaSonda({ status: 503 }).caso === 'irraggiungibile'],
    ['⚠️ i quattro guasti hanno quattro codici diversi',
      () => new Set([CASI.credito.code, CASI.chiaveAssente.code, CASI.chiaveRifiutata.code, CASI.irraggiungibile.code]).size === 4],
    ['⚠️ ogni caso non-verde porta un rimedio scritto',
      () => Object.entries(CASI).every(([k, v]) => (k === 'ok') === (v.rimedio === null))],

    // --- le due chiavi ---
    ['la stessa chiave del secret → coincidono', () => confrontaChiavi({
      chiave: 'sk-test-123',
      secretValue: createHash('sha256').update('sk-test-123', 'utf8').digest('hex'),
    }).stato === 'coincidono'],
    ['⚠️⚠️ una chiave DIVERSA da quella delle Edge Function → divergono', () => confrontaChiavi({
      chiave: 'sk-locale',
      secretValue: createHash('sha256').update('sk-di-produzione', 'utf8').digest('hex'),
    }).stato === 'divergono'],
    ['⚠️⚠️ LA TRAPPOLA DEL 2026-07-31: confrontare la CHIAVE col campo `value` dà divergono',
      // Il campo `value` è già lo SHA-256. Chi lo scambia per la chiave
      // confronta un'impronta con un'impronta di impronta: sempre «diverse».
      () => confrontaChiavi({ chiave: 'sk-vera', secretValue: 'sk-vera' }).stato === 'divergono'],
    ['secret non letto → «ignoto», che NON è «coincidono»',
      () => confrontaChiavi({ chiave: 'sk-vera', secretValue: null }).stato === 'ignoto'],

    // --- il giudizio finale ---
    ['⚠️⚠️ sonda verde + chiavi divergenti → NON è un verde (exit 6)', () => giudizioFinale({
      sonda: classificaSonda({ status: 200 }), chiavi: { stato: 'divergono' },
    }).code === 6],
    ['sonda verde + chiavi ignote → resta verde, e la frase lo dichiara altrove', () => giudizioFinale({
      sonda: classificaSonda({ status: 200 }), chiavi: { stato: 'ignoto' },
    }).code === 0],
    ['credito esaurito + chiavi divergenti → vince il credito: senza, sarebbe ferma comunque', () => giudizioFinale({
      sonda: classificaSonda({ status: 400, messaggio: 'credit balance is too low' }), chiavi: { stato: 'divergono' },
    }).code === 1],
    ['sonda verde e nessun confronto → verde', () => giudizioFinale({
      sonda: classificaSonda({ status: 200 }), chiavi: null,
    }).code === 0],

    // --- la storia ---
    ['l\'ultima riuscita è la più recente fra le riuscite', () => {
      const r = riassumiLog([
        { status: 'ok', created_at: '2026-08-02T18:15:00Z', kind: 'inbox_classification' },
        { status: 'ok', created_at: '2026-08-01T10:00:00Z', kind: 'analysis' },
        { status: 'error', created_at: '2026-08-07T09:00:00Z', error_code: 'AI_CREDIT_EXHAUSTED' },
      ], new Date('2026-08-08T18:15:00Z'));
      return r.ultimaOk.quando.startsWith('2026-08-02') && r.ultimoErrore.codice === 'AI_CREDIT_EXHAUSTED';
    }],
    ['⚠️ un log con SOLI errori non produce un\'ultima riuscita inventata', () => {
      const r = riassumiLog([{ status: 'error', created_at: '2026-08-07T09:00:00Z', error_code: 'X' }]);
      return r.ultimaOk === null;
    }],
    ['⚠️ un log VUOTO non è un guasto, ed è distinto da «non letto»', () => {
      const r = riassumiLog([]);
      return r !== null && r.righe === 0 && r.ultimaOk === null;
    }],
    ['un log NON letto resta null, e la frase finale lo dice',
      () => riassumiLog(null) === null],
    ['le ore si contano dall\'istante passato, non da adesso', () => {
      const r = riassumiLog([{ status: 'ok', created_at: '2026-08-08T12:00:00Z' }], new Date('2026-08-08T18:00:00Z'));
      return r.ultimaOk.oreFa === 6;
    }],
  ];

  console.log(`\n${B}Autoverifica di verify:ai${X} ${DIM}(le diagnosi, su risposte costruite — nessuna rete)${X}\n`);
  let falliti = 0;
  for (const [nome, fn] of casi) {
    let esito = false;
    try { esito = fn(); } catch { esito = false; }
    if (esito) console.log(`  ${G}✓${X} ${nome}`);
    else { falliti++; console.log(`  ${R}✗${X} ${nome}`); }
  }
  if (falliti) {
    console.error(`\n${R}${falliti} casi falliti: le diagnosi NON sono affidabili.${X}\n`);
    return false;
  }
  console.log(`\n${G}Tutti i ${casi.length} casi superati.${X}\n`);
  return true;
}

// ---------------------------------------------------------------------------
// LA MISURA VERA.
// ---------------------------------------------------------------------------

/** La sonda: una richiesta da un token, e la sua diagnosi. */
export async function sonda({ chiave, modello = MODELLO_SONDA, fetchImpl = fetch, timeoutMs = 20_000 }) {
  if (!chiave) return { diagnosi: classificaSonda({ chiaveAssente: true }), status: null, ms: 0 };
  const t0 = Date.now();
  try {
    const r = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': chiave,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'user-agent': 'ai-swisse-verify-ai/1',
      },
      // ⚠️ Un token, e non uno di più. Basta a distinguere 200 da 400, ed è la
      // stessa forma della misura conservata in product-status.md.
      body: JSON.stringify({
        model: modello,
        max_tokens: 1,
        messages: [{ role: 'user', content: '.' }],
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const corpo = await r.json().catch(() => ({}));
    const ms = Date.now() - t0;
    return {
      ms,
      status: r.status,
      diagnosi: classificaSonda({
        status: r.status,
        tipo: corpo?.error?.type ?? null,
        messaggio: corpo?.error?.message ?? '',
      }),
      uso: corpo?.usage ?? null,
    };
  } catch (e) {
    return {
      ms: Date.now() - t0,
      status: null,
      diagnosi: classificaSonda({ erroreRete: e?.message ?? String(e) }),
    };
  }
}

/** Il ref del progetto, dal sottodominio di SUPABASE_URL (come verify:deploy). */
function projectRef() {
  if (process.env.SUPABASE_PROJECT_REF) return process.env.SUPABASE_PROJECT_REF;
  const url = process.env.SUPABASE_URL;
  const daEnv = url && /https?:\/\/([a-z0-9]+)\.supabase\.co/.exec(url)?.[1];
  if (daEnv) return daEnv;
  const envTest = join(APP, '.env.test');
  if (existsSync(envTest)) {
    const m = /^SUPABASE_URL=https:\/\/([a-z0-9]+)\.supabase\.co/m.exec(readFileSync(envTest, 'utf8'));
    if (m) return m[1];
  }
  return null;
}

/** Lo SHA-256 del secret ANTHROPIC_API_KEY del progetto — mai il suo valore. */
async function secretAnthropic() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const ref = projectRef();
  if (!token || !ref) return { value: null, perche: 'serve SUPABASE_ACCESS_TOKEN (e un progetto)' };
  try {
    const r = await fetch(`https://api.supabase.com/v1/projects/${ref}/secrets`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'ai-swisse-verify-ai/1' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!r.ok) return { value: null, perche: `la Management API ha risposto ${r.status}` };
    const righe = await r.json();
    const riga = (Array.isArray(righe) ? righe : []).find((s) => s.name === 'ANTHROPIC_API_KEY');
    if (!riga) return { value: null, perche: 'nessun secret ANTHROPIC_API_KEY nel progetto', assente: true };
    return { value: riga.value ?? null, perche: null };
  } catch (e) {
    return { value: null, perche: `Management API irraggiungibile: ${e?.message ?? e}` };
  }
}

/** Le ultime righe di `ai_request_log`, via PostgREST. `null` = non letto. */
async function ultimeRigheLog(limite = 200) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { righe: null, perche: 'mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' };
  try {
    const r = await fetch(
      `${url}/rest/v1/ai_request_log?select=created_at,status,error_code,kind,model&order=created_at.desc&limit=${limite}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) },
    );
    if (!r.ok) return { righe: null, perche: `PostgREST ha risposto ${r.status}` };
    return { righe: await r.json(), perche: null };
  } catch (e) {
    return { righe: null, perche: `database irraggiungibile: ${e?.message ?? e}` };
  }
}

// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const modelloArg = argv.find((a) => a.startsWith('--model='));
const MODELLO = modelloArg ? modelloArg.split('=')[1] : MODELLO_SONDA;

const invocatoDirettamente = process.argv[1]
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invocatoDirettamente) {
  if (argv.includes('--self-test')) {
    process.exit(selfTest() ? 0 : 1);
  }

  const chiave = process.env.ANTHROPIC_API_KEY || null;

  // ⚠️ Senza chiave NON si chiama niente: la diagnosi è già completa, e una
  // richiesta senza credenziali produrrebbe un 401 che si legge come «chiave
  // sbagliata» invece che «chiave assente». Due guasti diversi, due rimedi.
  const s = await sonda({ chiave, modello: MODELLO });

  // Il confronto con la produzione si fa solo se qui c'è una chiave da
  // confrontare: senza, l'unica cosa da dire è che manca.
  const secret = chiave ? await secretAnthropic() : { value: null, perche: 'nessuna chiave locale' };
  const chiavi = confrontaChiavi({ chiave, secretValue: secret.value });
  // ⚠️ La storia si legge SEMPRE, anche senza chiave: «da quando non funziona»
  // è la domanda che serve di più proprio quando la sonda è rossa.
  const log = await ultimeRigheLog();
  const storia = riassumiLog(log.righe);

  const finale = giudizioFinale({ sonda: s.diagnosi, chiavi });

  if (JSON_OUT) {
    console.log(JSON.stringify({
      code: finale.code,
      caso: finale.caso,
      titolo: finale.titolo,
      rimedio: finale.rimedio,
      modello: MODELLO,
      sonda: { status: s.status, ms: s.ms, dettaglio: s.diagnosi.dettaglio ?? null },
      chiavi: chiavi.stato,
      chiaviPerche: chiavi.perche ?? secret.perche ?? null,
      log: storia,
      logPerche: log.perche ?? null,
      misuratoIl: new Date().toISOString(),
    }));
    process.exit(finale.code);
  }

  const colore = finale.code === 0 ? G : R;
  console.log(`\n${B}I percorsi AI possono funzionare adesso?${X} ${DIM}— sonda: ${MODELLO}, max_tokens 1${X}\n`);

  // 1. La sonda.
  const rigaSonda = s.status === null
    ? `${R}nessuna risposta${X} ${DIM}(${s.diagnosi.dettaglio ?? ''})${X}`
    : `HTTP ${s.status} ${DIM}· ${s.ms} ms${X}`;
  console.log(`  ${s.diagnosi.caso === 'ok' ? `${G}✓${X}` : `${R}✗${X}`} sonda all'API          ${rigaSonda}`);
  if (s.diagnosi.caso !== 'ok' && s.diagnosi.dettaglio && s.status !== null) {
    console.log(`      ${DIM}${String(s.diagnosi.dettaglio).slice(0, 160)}${X}`);
  }

  // 2. Le due chiavi.
  if (chiavi.stato === 'coincidono') {
    console.log(`  ${G}✓${X} chiave = quella delle Edge Function ${DIM}(sha256 del secret: coincide)${X}`);
  } else if (chiavi.stato === 'divergono') {
    console.log(`  ${R}✗${X} chiave ≠ quella delle Edge Function ${R}(in produzione ogni percorso AI prende 401)${X}`);
  } else {
    console.log(`  ${Y}!${X} chiave vs Edge Function          ${Y}non verificato${X} ${DIM}— ${secret.perche ?? chiavi.perche}${X}`);
  }

  // 3. La storia.
  if (!storia) {
    console.log(`  ${Y}!${X} ai_request_log                   ${Y}non letto${X} ${DIM}— ${log.perche}${X}`);
  } else if (storia.righe === 0) {
    console.log(`  ${DIM}·${X} ai_request_log                   ${DIM}nessuna riga: nessun percorso AI è mai partito${X}`);
  } else {
    const ok = storia.ultimaOk;
    const err = storia.ultimoErrore;
    console.log(`  ${DIM}·${X} ultima richiesta RIUSCITA        ${ok ? `${ok.quando.replace('T', ' ').slice(0, 16)} UTC ${DIM}(${ok.oreFa}h fa · ${ok.kind ?? '—'})${X}` : `${Y}nessuna${X}`}`);
    console.log(`  ${DIM}·${X} ultimo errore                    ${err ? `${err.quando.replace('T', ' ').slice(0, 16)} UTC ${DIM}(${err.oreFa}h fa · ${err.codice ?? '—'})${X}` : `${DIM}nessuno${X}`}`);
  }

  console.log(`\n${colore}${finale.titolo}${X} ${DIM}(exit ${finale.code})${X}`);
  if (finale.rimedio) console.log(`${DIM}  ${finale.rimedio}${X}`);

  // ⚠️ La frase che impedisce di leggere questo verde per più di ciò che dice.
  if (finale.code === 0) {
    console.log(`${DIM}  Un 200 su una richiesta da UN token non promette una lettura da 50 000:`);
    console.log(`  dice che l'account non è a zero e che la chiave è accettata.${X}`);
    if (chiavi.stato !== 'coincidono') {
      console.log(`${Y}  ⚠️ E vale per la chiave LOCALE: quella delle Edge Function non è stata confrontata.${X}`);
    }
  }
  console.log('');
  process.exit(finale.code);
}
