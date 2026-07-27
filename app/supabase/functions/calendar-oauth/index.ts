// ============================================================================
// Edge Function: calendar-oauth — consenso e callback per il calendario.
//
// Tre percorsi, tre livelli di fiducia:
//
//   POST /calendar-oauth/providers  richiesta AUTENTICATA. Dice quali provider
//                                   il SERVER può davvero usare, così la UI non
//                                   offre un pulsante che porta a un errore.
//   POST /calendar-oauth/start      richiesta AUTENTICATA. Qui si sa chi è
//                                   l'utente e per quale azienda agisce.
//   GET  /calendar-oauth/callback   richiesta ANONIMA dal browser. Non si può
//                                   credere a nulla di ciò che porta: né
//                                   all'azienda, né all'utente, né al provider.
//
// ⚠️ LA DIFFERENZA CON L'INBOX, ED È SOSTANZIALE
// Là il callback deve stabilire per quale AZIENDA vale il consenso. Qui deve
// stabilire anche per quale PERSONA: un calendario è personale, e un
// `user_id` letto dalla query string sarebbe il modo più diretto per far
// finire le scadenze di qualcuno sul calendario di qualcun altro. Entrambi
// vengono SOLO dalla riga di `calendar_oauth_states`, ritrovata per SHA-256
// di uno state opaco, monouso e a scadenza breve.
//
// ⚠️ COLLEGARE IL PROPRIO CALENDARIO NON RICHIEDE DI ESSERE AMMINISTRATORE
// Diversamente dalla posta aziendale, che un amministratore collega per tutti,
// qui il gesto è personale: chiedere il ruolo significherebbe che un
// collaboratore non può vedere le proprie scadenze sul proprio telefono.
// Si verifica l'appartenenza all'azienda, e basta.
// ============================================================================
import { createPkcePair, randomToken, seal, sha256Hex, open as openSealed } from '../_shared/email/crypto.ts';
import {
  adapterFor, adminClient, appOrigin, assertMember, authenticate, configuredProviders,
  CORS, failure, getEncryptionKey, json, logEvent, redirectToApp, resolveEmailProvider,
  safeReturnPath,
} from '../_shared/calendar/runtime.ts';
import { findConnectionByAccount, writeSecrets } from '../_shared/calendar/store.ts';
import { enqueueInitialSync } from '../_shared/calendar/sync.ts';
import { CalendarProviderError } from '../_shared/calendar/types.ts';
import { asServerLocale } from '../_shared/calendar/i18n.ts';

/** Lo stato OAuth vive pochi minuti: è il tempo di un consenso, non di una sessione. */
const STATE_TTL_SECONDS = 600;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const action = url.pathname.split('/').filter(Boolean).pop();

  try {
    if (action === 'providers' && req.method === 'POST') return await handleProviders(req);
    if (action === 'start' && req.method === 'POST') return await handleStart(req);
    if (action === 'callback' && req.method === 'GET') return await handleCallback(url);
    return failure('NOT_FOUND', 404);
  } catch (error) {
    const code = error instanceof CalendarProviderError ? error.code : 'UNKNOWN';
    logEvent('calendar-oauth', { action: action ?? '-', code });
    // Sul callback l'utente è davanti a un browser: si torna nell'applicazione
    // con un codice, non con una pagina di errore tecnica. Il redirect ha però
    // bisogno di APP_PUBLIC_URL, che su un ambiente non configurato è proprio
    // ciò che manca: senza questa protezione il gestore d'errore fallirebbe a
    // sua volta e la risposta sarebbe un 500 muto.
    if (action === 'callback') {
      try {
        return redirectToApp('/calendario/impostazioni', { calendar: 'error', code });
      } catch {
        return failure('CONFIG_MISSING', 503);
      }
    }
    return failure(code, code === 'CONFIG_MISSING' ? 503 : 500);
  }
});

async function handleProviders(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return failure('UNAUTHENTICATED', 401);
  const providers = configuredProviders();
  return json({
    providers,
    // La UI mostra i permessi REALI, non quelli che suonerebbero meglio (§53).
    // Vengono dagli adapter, cioè dagli stessi array che finiscono nell'URL del
    // consenso: se un domani uno scope cambiasse, la schermata lo direbbe da sé.
    scopes: Object.fromEntries(providers.map((p) => [p, adapterFor(p).scopes])),
    // §79 — se non c'è un servizio di invio configurato, la schermata deve
    // dichiarare le email NON DISPONIBILI invece di offrire un interruttore che
    // non farebbe partire niente. È un booleano e non la chiave: il client deve
    // sapere SE, non COSA.
    emailConfigured: !!resolveEmailProvider(),
  });
}

async function handleStart(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return failure('UNAUTHENTICATED', 401);

  const body = await req.json().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : null;
  const provider = body?.provider === 'google' ? 'google' : body?.provider === 'microsoft' ? 'microsoft' : null;
  if (!companyId || !provider) return failure('BAD_REQUEST', 400);

  if (!(await assertMember(auth, companyId))) return failure('FORBIDDEN', 403);
  if (!configuredProviders().includes(provider)) return failure('PROVIDER_NOT_CONFIGURED', 503);

  const sb = adminClient();
  const key = await getEncryptionKey();

  const stateValue = randomToken(32);
  const stateHash = await sha256Hex(stateValue);
  const pkce = await createPkcePair();
  // Il verifier è un segreto di sessione: si conserva cifrato come i token.
  // L'AAD è lo hash dello state, così il record non è utilizzabile altrove.
  const sealedVerifier = await seal(key, pkce.verifier, stateHash);

  const toHex = (bytes: Uint8Array) => {
    let out = '\\x';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
  };

  const { error } = await sb.from('calendar_oauth_states').insert({
    state_hash: stateHash,
    company_id: companyId,
    user_id: auth.userId,
    provider,
    code_verifier_ct: toHex(sealedVerifier.ciphertext),
    code_verifier_iv: toHex(sealedVerifier.iv),
    redirect_path: safeReturnPath(typeof body?.returnPath === 'string' ? body.returnPath : '/calendario/impostazioni'),
    expires_at: new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) return failure('UNKNOWN', 500);

  // La lingua dell'interfaccia diventa quella in cui il server scriverà eventi
  // ed email. Si registra ORA, mentre la persona è davanti allo schermo: al
  // momento in cui servirà — un worker alle otto del mattino — non ci sarà
  // nessuna sessione da cui dedurla.
  const locale = asServerLocale(body?.locale);
  await sb.from('notification_preferences').upsert(
    { company_id: companyId, user_id: auth.userId, locale },
    { onConflict: 'company_id,user_id', ignoreDuplicates: true },
  );

  const adapter = adapterFor(provider);
  const authorizationUrl = adapter.buildAuthorizationUrl({
    state: stateValue,
    codeChallenge: pkce.challenge,
    loginHint: typeof body?.loginHint === 'string' ? body.loginHint.slice(0, 200) : null,
  });

  logEvent('calendar-oauth', { action: 'start', provider, company: companyId.slice(0, 8) });
  return json({ authorizationUrl });
}

async function handleCallback(url: URL): Promise<Response> {
  const providerError = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const stateValue = url.searchParams.get('state');
  const RETURN = '/calendario/impostazioni';

  // L'utente ha annullato dalla schermata del provider: non è un guasto.
  if (providerError) {
    return redirectToApp(RETURN, { calendar: providerError === 'access_denied' ? 'cancelled' : 'error' });
  }
  if (!code || !stateValue) return redirectToApp(RETURN, { calendar: 'error', code: 'BAD_REQUEST' });

  const sb = adminClient();
  const key = await getEncryptionKey();
  const stateHash = await sha256Hex(stateValue);

  // Consumo ATOMICO dello state: l'update condizionale è l'unico modo per
  // garantire che due callback con lo stesso state non passino entrambi.
  const { data: consumed } = await sb.from('calendar_oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('state_hash', stateHash)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id, company_id, user_id, provider, code_verifier_ct, code_verifier_iv, redirect_path');

  const state = Array.isArray(consumed) ? consumed[0] : null;
  if (!state) {
    logEvent('calendar-oauth', { action: 'callback', code: 'STATE_INVALID' });
    return redirectToApp(RETURN, { calendar: 'error', code: 'STATE_INVALID' });
  }

  const provider = state.provider as 'google' | 'microsoft';
  const companyId = state.company_id as string;
  const userId = state.user_id as string;
  const returnPath = safeReturnPath(state.redirect_path as string);

  const hexToBytes = (value: unknown): Uint8Array => {
    const s = String(value ?? '');
    const hex = s.startsWith('\\x') ? s.slice(2) : s;
    const out = new Uint8Array(hex.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    return out;
  };
  const codeVerifier = await openSealed(
    key,
    { ciphertext: hexToBytes(state.code_verifier_ct), iv: hexToBytes(state.code_verifier_iv) },
    stateHash,
  );

  const adapter = adapterFor(provider);
  const tokens = await adapter.exchangeCode({ code, codeVerifier });

  // ⚠️ Su Google il permesso è mostrato come una CASELLA DA SPUNTARE. Chi preme
  // «Continua» senza spuntarla completa il consenso e riceve un token
  // perfettamente valido — ma senza lo scope. La prima scrittura risponderebbe
  // 403, che tradotto diventa «permesso insufficiente»: sembra un guasto del
  // server, mentre è una spunta che solo l'utente può rimettere.
  // È già successo con l'Inbox, e si verifica QUI perché è l'ultimo momento in
  // cui lo si può dire con precisione invece di dedurlo da un codice HTTP a
  // valle. Se il provider non dichiara gli scope non si conclude nulla: meglio
  // proseguire e fallire più avanti che inventare una diagnosi.
  const requiredScope = provider === 'google' ? 'auth/calendar.app.created' : 'calendars.readwrite';
  const granted = tokens.scopes.map((s) => s.toLowerCase());
  if (granted.length > 0 && !granted.some((s) => s.endsWith(requiredScope))) {
    logEvent('calendar-oauth', { action: 'callback', provider, code: 'SCOPE_NOT_GRANTED' });
    return redirectToApp(returnPath, { calendar: 'error', code: 'SCOPE_NOT_GRANTED' });
  }

  const identity = await adapter.getAccountIdentity(tokens.accessToken);

  // Lo stesso utente che ricollega lo stesso provider: si AGGIORNA, non si
  // duplica. Il vincolo unico lo impedirebbe comunque; farlo qui rende una
  // riconnessione un'operazione normale invece di un errore da interpretare.
  const existing = await findConnectionByAccount(sb, companyId, userId, provider);

  let connectionId: string;
  if (existing) {
    await sb.from('calendar_connections').update({
      provider_account_id: identity.accountId,
      email_address: identity.emailAddress,
      status: 'active',
      scopes: tokens.scopes,
      sync_enabled: true,
      last_error_code: null,
      last_error_at: null,
    }).eq('id', existing.id);
    connectionId = existing.id;
  } else {
    const { data: inserted, error } = await sb.from('calendar_connections').insert({
      company_id: companyId,
      user_id: userId,
      provider,
      provider_account_id: identity.accountId,
      email_address: identity.emailAddress,
      status: 'active',
      scopes: tokens.scopes,
    }).select('id').maybeSingle();
    if (error || !inserted?.id) {
      logEvent('calendar-oauth', { action: 'callback', code: 'CONNECTION_INSERT_FAILED' });
      return redirectToApp(returnPath, { calendar: 'error', code: 'UNKNOWN' });
    }
    connectionId = inserted.id as string;
  }

  await writeSecrets(sb, key, {
    connectionId,
    companyId,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiresAt,
    refreshToken: tokens.refreshToken,
  });

  // Il collegamento è tornato buono: si tolgono gli avvisi che dicevano il
  // contrario. Senza questo passaggio la loro chiave di deduplicazione
  // resterebbe occupata per sempre, e un guasto futuro non riuscirebbe più a
  // farsi sentire — un avviso che si può dare una volta sola nella vita di una
  // connessione non è un avviso.
  await sb.from('notifications')
    .delete()
    .eq('user_id', userId)
    .eq('entity_type', 'calendar_connection')
    .eq('entity_id', connectionId);

  // La sincronizzazione iniziale non SCRIVE: accoda. Il lavoro lo fa il worker,
  // con lo stesso codice di tutti i giorni, e l'utente non resta davanti a una
  // schermata bianca mentre si creano trenta eventi (§75).
  try {
    const connection = await findConnectionByAccount(sb, companyId, userId, provider);
    if (connection) {
      await enqueueInitialSync({
        sb,
        encryptionKey: key,
        adapterFor,
        appOrigin: appOrigin(),
        companyNames: new Map(),
      }, connection);
    }
  } catch {
    // Una sincronizzazione iniziale non partita NON è una perdita: la
    // riconciliazione periodica trova comunque le attività senza evento.
  }

  logEvent('calendar-oauth', { action: 'callback', provider, code: 'OK' });
  // Mai token nell'URL di ritorno: solo l'esito.
  return redirectToApp(returnPath, { calendar: 'ok' });
}
