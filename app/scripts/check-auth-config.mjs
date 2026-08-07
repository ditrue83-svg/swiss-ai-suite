// ============================================================================
// Verifica la configurazione Auth del progetto REALE.
//   npm run check:auth -- https://app.ai-swisse.com    ← il dominio va INDICATO
//   npm run check:auth -- --local                      ← la macchina di sviluppo
//   npm run check:auth -- --self-test                  ← prova il controllo stesso
//
// Perché esiste: i link di conferma registrazione e di reimpostazione password
// sono costruiti dall'app, ma Supabase li accetta solo se l'URL è nella
// allowlist "Redirect URLs" del progetto. Se non lo è, il link nell'email punta
// al Site URL — e l'utente non completa mai registrazione o reset. Nessun test
// esercitava questo percorso, perché tutti gli script creano gli utenti con
// `email_confirm: true`, saltando del tutto le email.
//
// Come funziona: si genera un link con l'admin API chiedendo un `redirect_to`
// specifico e si controlla che il link RESTITUITO lo rispetti davvero.
// Non invia email e non lascia utenti in giro.
//
// ⚠️⚠️ SENZA ARGOMENTO NON SI RIPIEGA PIÙ SU LOCALHOST, ed è il motivo per cui
// questo blocco è stato riscritto il 2026-08-01. Fino a ieri, invocato nudo,
// questo controllo verificava `http://localhost:5174` e usciva ZERO stampando
// «i link inviati per email porteranno a http://localhost:5174». Vero — e
// completamente inutile: chi lo lanciava pensava alla produzione. Il 2026-07-31
// è successo davvero, e il primo esito è stato letto come una conferma.
//
// La regola generale, la stessa del runner delle suite: **uno strumento a cui
// viene posta una domanda a cui non può rispondere deve fallire, non rispondere
// a una domanda diversa.** Qui la domanda è «i link porteranno al dominio
// giusto?»: senza sapere quale sia il dominio giusto, non c'è risposta, c'è
// solo un'altra domanda. Un bersaglio su localhost resta possibile, ma va
// chiesto — `--local` — così chi lo usa sa che cosa sta verificando.
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
// ⚠️ La regola «è la macchina di sviluppo?» sta in UN posto solo: qui c'era una
// seconda copia, e divergeva già da quella di `run-test-suite.mjs`.
import { LOCALE_RE } from './local-host.mjs';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';

const LOCAL_DEFAULT = 'http://localhost:5174';

/**
 * Che cosa verificare, e da dove viene la decisione. Funzione PURA: è la parte
 * che ha mentito, quindi è la parte che si può provare senza toccare la rete.
 *
 * Ritorna `{ target, fonte }` oppure `{ errore, dettaglio }`. Non stampa e non
 * esce: decidere e uscire sono due cose, e mescolarle rende il difetto
 * impossibile da provare.
 */
export function scegliBersaglio(argv, env = {}) {
  const esplicito = argv.find((a) => a.startsWith('http'));
  const local = argv.includes('--local');
  const daEnv = env.VITE_PUBLIC_SITE_URL || null;

  const normalizza = (u) => u.replace(/\/+$/, '');
  const host = (u) => { try { return new URL(u).hostname; } catch { return null; } };

  if (esplicito) {
    const h = host(esplicito);
    if (!h) return { errore: 'URL_MALFORMATO', dettaglio: esplicito };
    // ⚠️ Un localhost passato a mano è comunque localhost: se qualcuno lo
    // indica per sbaglio (copiando una riga vecchia) deve incontrare lo stesso
    // muro di chi non indica niente. `--local` è l'unico modo di dire «sì, so
    // che sto verificando la mia macchina».
    if (LOCALE_RE.test(h) && !local) return { errore: 'LOCALE_NON_DICHIARATO', dettaglio: esplicito };
    return { target: normalizza(esplicito), fonte: 'argomento' };
  }

  if (local) return { target: LOCAL_DEFAULT, fonte: '--local' };

  if (daEnv) {
    const h = host(daEnv);
    if (!h) return { errore: 'URL_MALFORMATO', dettaglio: daEnv };
    // Anche una variabile d'ambiente che punta alla macchina di sviluppo è la
    // stessa trappola, solo scritta altrove: va dichiarata.
    if (LOCALE_RE.test(h) && !local) return { errore: 'LOCALE_NON_DICHIARATO', dettaglio: daEnv };
    return { target: normalizza(daEnv), fonte: 'VITE_PUBLIC_SITE_URL' };
  }

  return { errore: 'NESSUN_DOMINIO' };
}

const SPIEGAZIONI = {
  NESSUN_DOMINIO: [
    'Nessun dominio indicato: non c\'è niente da verificare.',
    'Questo controllo risponde a «i link inviati per email porteranno al dominio giusto?».',
    'Senza sapere QUALE sia il dominio giusto, la domanda non ha risposta — e rispondere',
    'su localhost sarebbe rispondere a una domanda diversa (è successo il 2026-07-31).',
    '',
    `  ${B}npm run check:auth -- https://app.ai-swisse.com${X}   la produzione`,
    `  ${B}npm run check:auth -- --local${X}                     la macchina di sviluppo (${LOCAL_DEFAULT})`,
  ],
  LOCALE_NON_DICHIARATO: [
    'Il bersaglio è la macchina di sviluppo, ma non è stato dichiarato.',
    'Verificare localhost è legittimo; farlo senza saperlo no.',
    '',
    `  ${B}npm run check:auth -- --local${X}   se è quello che vuoi`,
  ],
  URL_MALFORMATO: ['L\'URL indicato non si legge come URL.'],
};

// ---- Autoverifica: i casi che questo controllo DEVE riconoscere come rossi ---
// ⚠️ Il primo è il difetto vero, rimesso a mano. Se smettesse di fallire, il
// controllo sarebbe tornato a rispondere alla domanda sbagliata.
const CASI = [
  {
    name: 'NESSUN ARGOMENTO → rifiuto (il difetto del 2026-07-31)',
    argv: [], env: {}, attesoErrore: 'NESSUN_DOMINIO',
  },
  {
    name: 'nessun argomento ma VITE_PUBLIC_SITE_URL su localhost → rifiuto lo stesso',
    argv: [], env: { VITE_PUBLIC_SITE_URL: 'http://localhost:5174' },
    attesoErrore: 'LOCALE_NON_DICHIARATO',
  },
  {
    name: 'localhost passato a mano senza --local → rifiuto',
    argv: ['http://localhost:5174'], env: {}, attesoErrore: 'LOCALE_NON_DICHIARATO',
  },
  {
    name: '127.0.0.1 senza --local → rifiuto (stesso posto, altro nome)',
    argv: ['http://127.0.0.1:5174'], env: {}, attesoErrore: 'LOCALE_NON_DICHIARATO',
  },
  {
    name: '--local → accettato, ed è dichiarato',
    argv: ['--local'], env: {}, attesoTarget: LOCAL_DEFAULT, attesaFonte: '--local',
  },
  {
    name: 'dominio di produzione → accettato',
    argv: ['https://app.ai-swisse.com'], env: {},
    attesoTarget: 'https://app.ai-swisse.com', attesaFonte: 'argomento',
  },
  {
    name: 'la barra finale non cambia il bersaglio',
    argv: ['https://app.ai-swisse.com/'], env: {}, attesoTarget: 'https://app.ai-swisse.com',
  },
  {
    name: 'VITE_PUBLIC_SITE_URL di produzione → accettato, e si dice da dove viene',
    argv: [], env: { VITE_PUBLIC_SITE_URL: 'https://app.ai-swisse.com' },
    attesoTarget: 'https://app.ai-swisse.com', attesaFonte: 'VITE_PUBLIC_SITE_URL',
  },
  {
    name: 'l\'argomento esplicito vince sulla variabile d\'ambiente',
    argv: ['https://staging.ai-swisse.com'], env: { VITE_PUBLIC_SITE_URL: 'https://app.ai-swisse.com' },
    attesoTarget: 'https://staging.ai-swisse.com',
  },
];

function selfTest() {
  console.log(`\n${B}Autoverifica di check:auth${X} ${DIM}(un controllo che risponde a un'altra domanda non è un controllo)${X}\n`);
  let bad = 0;
  for (const c of CASI) {
    const r = scegliBersaglio(c.argv, c.env);
    const problemi = [];
    if (c.attesoErrore && r.errore !== c.attesoErrore) problemi.push(`atteso errore ${c.attesoErrore}, ottenuto ${r.errore ?? `target ${r.target}`}`);
    if (c.attesoTarget && r.target !== c.attesoTarget) problemi.push(`atteso ${c.attesoTarget}, ottenuto ${r.target ?? `errore ${r.errore}`}`);
    if (c.attesaFonte && r.fonte !== c.attesaFonte) problemi.push(`attesa fonte ${c.attesaFonte}, ottenuta ${r.fonte}`);
    if (problemi.length) bad++;
    console.log(`  ${problemi.length ? R + '✗' : G + '✓'}${X} ${c.name}`);
    for (const p of problemi) console.log(`      ${R}${p}${X}`);
  }
  if (bad) {
    console.error(`\n${R}${bad} casi falliti: questo controllo NON è affidabile.${X}\n`);
    return false;
  }
  console.log(`\n${G}Tutti i ${CASI.length} casi superati.${X}\n`);
  return true;
}

if (process.argv.includes('--self-test')) {
  process.exit(selfTest() ? 0 : 1);
}

// ⚠️ L'autoverifica gira PRIMA della verifica vera, come in `i18n:coverage` e
// `docs:check`: se la scelta del bersaglio fosse rotta, l'esito che segue non
// direbbe niente su niente.
{
  const silenzioso = CASI.every((c) => {
    const r = scegliBersaglio(c.argv, c.env);
    if (c.attesoErrore) return r.errore === c.attesoErrore;
    if (c.attesoTarget && r.target !== c.attesoTarget) return false;
    if (c.attesaFonte && r.fonte !== c.attesaFonte) return false;
    return true;
  });
  if (!silenzioso) {
    console.error(`${R}✗ L'autoverifica di check:auth è fallita: la verifica non viene eseguita.${X}`);
    console.error(`${DIM}  Dettaglio: npm run check:auth -- --self-test${X}`);
    process.exit(1);
  }
}

const scelta = scegliBersaglio(process.argv.slice(2), process.env);
if (scelta.errore) {
  console.error(`\n${R}check:auth non ha eseguito nulla.${X}\n`);
  for (const riga of SPIEGAZIONI[scelta.errore]) console.error(`  ${riga}`);
  if (scelta.dettaglio) console.error(`\n  ${DIM}ricevuto: ${scelta.dettaglio}${X}`);
  console.error('');
  process.exit(2);
}
const target = scelta.target;

const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) { console.error('Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.test'); process.exit(2); }

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

let problems = 0;
const ok = (cond, label, detail = '') => {
  if (cond) console.log(`  ${G}✓${X} ${label}${detail ? ` ${DIM}${detail}${X}` : ''}`);
  else { problems++; console.log(`  ${R}✗${X} ${label}${detail ? ` ${DIM}${detail}${X}` : ''}`); }
};

/** Genera un link di tipo `type` e ritorna il redirect_to effettivamente applicato. */
async function effectiveRedirect(type, email, redirectTo) {
  const payload = { type, email, options: { redirectTo } };
  if (type === 'signup') payload.password = `Probe${Date.now()}!aA`;
  const { data, error } = await admin.auth.admin.generateLink(payload);
  if (error) return { error: error.message };
  const link = data?.properties?.action_link ?? '';
  try {
    const u = new URL(link);
    return { link, redirect: u.searchParams.get('redirect_to') };
  } catch {
    return { link, redirect: null };
  }
}

const main = async () => {
  console.log(`\n${DIM}Configurazione Auth — progetto reale${X}`);
  // ⚠️ Da DOVE viene il bersaglio, non solo qual è: «ho verificato la
  // produzione» e «ho verificato ciò che c'era nell'ambiente» sono due frasi
  // diverse, e chi legge questo output deve poterle distinguere.
  console.log(`${DIM}URL verificato: ${B}${target}${X}${DIM}   (indicato da: ${scelta.fonte})${X}\n`);

  const probeEmail = `authcheck+${Date.now()}@example.com`;
  let createdId = null;

  // --- 1. Conferma registrazione ------------------------------------------
  console.log(`${B}Link di conferma registrazione${X}`);
  const signup = await effectiveRedirect('signup', probeEmail, `${target}/login`);
  if (signup.error) {
    console.log(`  ${Y}~${X} impossibile generare il link ${DIM}(${signup.error.slice(0, 80)})${X}`);
    problems++;
  } else {
    const { data: found } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
    createdId = found?.users?.find((u) => u.email === probeEmail)?.id ?? null;
    ok(!!signup.redirect, 'il link contiene un redirect_to', signup.redirect ?? '—');
    ok(signup.redirect === `${target}/login`,
      'il redirect richiesto viene RISPETTATO (URL nell\'allowlist)',
      signup.redirect === `${target}/login` ? '' : `ricevuto: ${signup.redirect}`);
  }

  // --- 2. Reimposta password ----------------------------------------------
  console.log(`\n${B}Link di reimpostazione password${X}`);
  const recovery = await effectiveRedirect('recovery', probeEmail, `${target}/reset-password`);
  if (recovery.error) {
    console.log(`  ${Y}~${X} impossibile generare il link ${DIM}(${recovery.error.slice(0, 80)})${X}`);
    problems++;
  } else {
    ok(recovery.redirect === `${target}/reset-password`,
      'il redirect richiesto viene RISPETTATO',
      recovery.redirect === `${target}/reset-password` ? '' : `ricevuto: ${recovery.redirect}`);
  }

  // --- 3. Un URL NON in allowlist deve essere rifiutato --------------------
  console.log(`\n${B}Sicurezza: redirect non autorizzato${X}`);
  const evil = await effectiveRedirect('recovery', probeEmail, 'https://sito-non-autorizzato.example/rubato');
  if (!evil.error) {
    const honored = evil.redirect === 'https://sito-non-autorizzato.example/rubato';
    ok(!honored, 'un URL estraneo NON viene accettato come redirect (niente open redirect)',
      honored ? 'ACCETTATO — allowlist troppo permissiva!' : `ricondotto a ${evil.redirect ?? 'Site URL'}`);
  }

  if (createdId) await admin.auth.admin.deleteUser(createdId).catch(() => {});

  console.log('');
  if (problems === 0) {
    console.log(`${G}Configurazione coerente${X}: i link inviati per email porteranno a ${target}.\n`);
  } else {
    console.log(`${R}${problems} problema/i${X}. Nel dashboard Supabase → Authentication → URL Configuration:`);
    console.log(`  · ${B}Site URL${X}            = ${target}`);
    console.log(`  · ${B}Redirect URLs${X}       aggiungi ${target}/** (e l'URL di sviluppo, es. http://localhost:5174/**)`);
    console.log(`  Poi imposta ${B}VITE_PUBLIC_SITE_URL=${target}${X} nel .env di produzione e rilancia questo controllo.\n`);
  }
  process.exit(problems ? 1 : 0);
};

main().catch((e) => { console.error('Errore inatteso:', e?.message ?? e); process.exit(2); });
