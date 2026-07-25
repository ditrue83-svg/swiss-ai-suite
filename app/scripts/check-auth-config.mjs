// ============================================================================
// Verifica la configurazione Auth del progetto REALE.
//   npm run check:auth                      (usa VITE_PUBLIC_SITE_URL o localhost)
//   npm run check:auth -- https://app.esempio.ch
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
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

const URL_ = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !SERVICE) { console.error('Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env.test'); process.exit(2); }

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

// URL da verificare: argomento, oppure VITE_PUBLIC_SITE_URL, oppure il dev server.
const target = (process.argv.find((a) => a.startsWith('http')) ?? process.env.VITE_PUBLIC_SITE_URL ?? 'http://localhost:5174').replace(/\/+$/, '');

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
  console.log(`${DIM}URL verificato: ${target}${X}\n`);

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
