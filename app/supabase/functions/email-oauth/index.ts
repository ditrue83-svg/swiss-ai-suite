// ============================================================================
// Edge Function: email-oauth — avvio del consenso e callback del provider.
//
// Due percorsi, due livelli di fiducia opposti:
//
//   POST /email-oauth/start     richiesta AUTENTICATA della nostra applicazione.
//                               Qui si sa chi è l'utente e per quale azienda
//                               agisce, e lo si verifica con la RLS.
//
//   GET  /email-oauth/callback  richiesta ANONIMA, che arriva dal browser dopo
//                               il consenso. Non si può credere a nulla di ciò
//                               che porta: né all'azienda, né all'utente, né al
//                               provider. L'unica cosa che la lega alla
//                               richiesta di partenza è lo `state`, che è
//                               opaco, monouso, a scadenza breve e ritrovato
//                               nel database per confronto dello SHA-256.
//
// Un `company_id` letto dalla query string sarebbe la via più diretta per
// collegare la propria casella all'azienda di qualcun altro — o l'inverso.
// Qui il company_id viene SOLO dalla riga di `email_oauth_states`.
// ============================================================================
import { createPkcePair, randomToken, seal, sha256Hex, open as openSealed } from '../_shared/email/crypto.ts';
import {
  adapterForProvider, adminClient, assertAdmin, authenticate, configuredProviders,
  CORS, failure, getEncryptionKey, json, logEvent, redirectToApp, safeReturnPath, webhookUrl,
} from '../_shared/email/runtime.ts';
import { recordAudit, writeSecrets, findConnectionByAccount } from '../_shared/email/store.ts';
import { EmailProviderError } from '../_shared/email/types.ts';

/** Lo stato OAuth vive pochi minuti: è il tempo di un consenso, non di una sessione. */
const STATE_TTL_SECONDS = 600;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const action = url.pathname.split('/').filter(Boolean).pop();

  try {
    if (action === 'start' && req.method === 'POST') return await handleStart(req);
    if (action === 'callback' && req.method === 'GET') return await handleCallback(url);
    if (action === 'providers' && req.method === 'POST') return await handleProviders(req);
    return failure('NOT_FOUND', 404);
  } catch (error) {
    const code = error instanceof EmailProviderError ? error.code : 'UNKNOWN';
    logEvent('email-oauth', { action: action ?? '-', code });
    // Sul callback l'utente è davanti a un browser: si torna nell'applicazione
    // con un codice, non con una pagina di errore tecnica.
    //
    // Il redirect ha però bisogno di APP_PUBLIC_URL, che su un ambiente non
    // ancora configurato è proprio ciò che manca: senza questa protezione il
    // gestore d'errore fallirebbe a sua volta e la risposta sarebbe un 500
    // muto. Un guasto di configurazione deve dirsi, non nascondersi dietro un
    // errore generico.
    if (action === 'callback') {
      try {
        return redirectToApp('/inbox', { connect: 'error', code });
      } catch {
        return failure('CONFIG_MISSING', 503);
      }
    }
    return failure(code, code === 'CONFIG_MISSING' ? 503 : 500);
  }
});

/**
 * Quali provider sono realmente configurati sul server. La UI non deve offrire
 * «Collega Microsoft» se non esiste un client Microsoft: sarebbe un pulsante
 * che porta a un errore, cioè una funzione finta (§140).
 */
async function handleProviders(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return failure('UNAUTHENTICATED', 401);
  return json({ providers: configuredProviders() });
}

async function handleStart(req: Request): Promise<Response> {
  const auth = await authenticate(req);
  if (!auth) return failure('UNAUTHENTICATED', 401);

  const body = await req.json().catch(() => null);
  const companyId = typeof body?.companyId === 'string' ? body.companyId : null;
  const provider = body?.provider === 'google' ? 'google' : body?.provider === 'microsoft' ? 'microsoft' : null;
  if (!companyId || !provider) return failure('BAD_REQUEST', 400);

  // §51 — collegare una casella aziendale non è un'azione da semplice membro.
  if (!(await assertAdmin(auth, companyId))) return failure('FORBIDDEN', 403);
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

  const { error } = await sb.from('email_oauth_states').insert({
    state_hash: stateHash,
    company_id: companyId,
    user_id: auth.userId,
    provider,
    code_verifier_ct: toHex(sealedVerifier.ciphertext),
    code_verifier_iv: toHex(sealedVerifier.iv),
    redirect_path: safeReturnPath(typeof body?.returnPath === 'string' ? body.returnPath : '/inbox'),
    expires_at: new Date(Date.now() + STATE_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) return failure('UNKNOWN', 500);

  const adapter = adapterForProvider(provider);
  const authorizationUrl = adapter.buildAuthorizationUrl({
    state: stateValue,
    codeChallenge: pkce.challenge,
    loginHint: typeof body?.loginHint === 'string' ? body.loginHint.slice(0, 200) : null,
  });

  logEvent('email-oauth', { action: 'start', provider, company: companyId.slice(0, 8) });
  return json({ authorizationUrl });
}

async function handleCallback(url: URL): Promise<Response> {
  const providerError = url.searchParams.get('error');
  const code = url.searchParams.get('code');
  const stateValue = url.searchParams.get('state');

  // L'utente ha annullato dalla schermata del provider: non è un guasto.
  if (providerError) {
    return redirectToApp('/inbox', { connect: providerError === 'access_denied' ? 'cancelled' : 'error' });
  }
  if (!code || !stateValue) return redirectToApp('/inbox', { connect: 'error', code: 'BAD_REQUEST' });

  const sb = adminClient();
  const key = await getEncryptionKey();
  const stateHash = await sha256Hex(stateValue);

  // Consumo ATOMICO dello state: l'update condizionale è l'unico modo per
  // garantire che due callback con lo stesso state non passino entrambi.
  const { data: consumed } = await sb.from('email_oauth_states')
    .update({ consumed_at: new Date().toISOString() })
    .eq('state_hash', stateHash)
    .is('consumed_at', null)
    .gt('expires_at', new Date().toISOString())
    .select('id, company_id, user_id, provider, code_verifier_ct, code_verifier_iv, redirect_path');

  const state = Array.isArray(consumed) ? consumed[0] : null;
  if (!state) {
    logEvent('email-oauth', { action: 'callback', code: 'STATE_INVALID' });
    return redirectToApp('/inbox', { connect: 'error', code: 'STATE_INVALID' });
  }

  const provider = state.provider as 'google' | 'microsoft';
  const companyId = state.company_id as string;
  const userId = state.user_id as string;

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

  const adapter = adapterForProvider(provider);
  const tokens = await adapter.exchangeCode({ code, codeVerifier });

  // Il permesso di lettura della posta è mostrato da Google come una CASELLA DA
  // SPUNTARE. Chi preme «Continua» senza spuntarla completa il consenso e
  // riceve un token perfettamente valido — ma senza quello scope. La prima
  // chiamata a Gmail risponde 403, che tradotto diventa «permesso
  // insufficiente»: sembra un guasto di configurazione del server, mentre è una
  // spunta mancante che solo l'utente può rimettere.
  //
  // Si verifica QUI, sul campo `scope` della risposta del provider, perché è
  // l'ultimo momento in cui si può dirlo con precisione invece di dedurlo da un
  // codice HTTP a valle. Se il provider non dichiara gli scope non si conclude
  // nulla: meglio proseguire e fallire più avanti che inventare una diagnosi.
  const requiredScope = provider === 'google' ? 'auth/gmail.readonly' : 'mail.read';
  const granted = tokens.scopes.map((s) => s.toLowerCase());
  if (granted.length > 0 && !granted.some((s) => s.endsWith(requiredScope))) {
    logEvent('email-oauth', { action: 'callback', provider, code: 'SCOPE_NOT_GRANTED' });
    return redirectToApp(state.redirect_path as string, { connect: 'error', code: 'SCOPE_NOT_GRANTED' });
  }

  const identity = await adapter.getAccountIdentity(tokens.accessToken);

  // §74 — stesso account già collegato a questa azienda: si AGGIORNA, non si
  // duplica. Il vincolo unico lo impedirebbe comunque; farlo qui rende una
  // riconnessione un'operazione normale invece di un errore da interpretare.
  const existing = await findConnectionByAccount(sb, companyId, provider, identity.accountId);

  let connectionId: string;
  if (existing) {
    await sb.from('email_connections').update({
      email_address: identity.emailAddress,
      display_name: identity.displayName,
      status: 'active',
      scopes: tokens.scopes,
      sync_enabled: true,
      connected_by: userId,
      last_error_code: null,
      last_error_at: null,
    }).eq('id', existing.id);
    connectionId = existing.id;
  } else {
    const { data: inserted, error } = await sb.from('email_connections').insert({
      company_id: companyId,
      connected_by: userId,
      provider,
      provider_account_id: identity.accountId,
      email_address: identity.emailAddress,
      display_name: identity.displayName,
      status: 'active',
      scopes: tokens.scopes,
    }).select('id').maybeSingle();
    if (error || !inserted?.id) {
      logEvent('email-oauth', { action: 'callback', code: 'CONNECTION_INSERT_FAILED' });
      return redirectToApp(state.redirect_path as string, { connect: 'error', code: 'UNKNOWN' });
    }
    connectionId = inserted.id as string;
  }

  const webhookState = randomToken(32);
  await writeSecrets(sb, key, {
    connectionId,
    companyId,
    accessToken: tokens.accessToken,
    accessTokenExpiresAt: tokens.expiresAt,
    refreshToken: tokens.refreshToken,
    webhookState,
  });

  await recordAudit(sb, {
    companyId, connectionId, actorUserId: userId,
    action: existing ? 'reconnected' : 'connected',
    detail: { provider },
  });

  // La sottoscrizione push si prova subito, ma un fallimento NON annulla il
  // collegamento: senza push la casella si aggiorna con la riconciliazione
  // periodica, più lenta ma funzionante. Lo stato lo dice.
  try {
    const watch = await adapter.createWatch({
      accessToken: tokens.accessToken,
      notificationUrl: webhookUrl(provider),
      clientState: webhookState,
    });
    await sb.from('email_connections').update({
      watch_resource_id: watch.resourceId,
      watch_expires_at: watch.expiresAt,
      watch_last_renewed_at: new Date().toISOString(),
      watch_last_error_code: null,
    }).eq('id', connectionId);
  } catch (error) {
    const errCode = error instanceof EmailProviderError ? error.code : 'UNKNOWN';
    await sb.from('email_connections').update({ watch_last_error_code: errCode }).eq('id', connectionId);
    logEvent('email-oauth', { action: 'watch', code: errCode });
  }

  // L'import iniziale parte in background: l'utente non deve restare davanti a
  // una schermata bianca mentre si scaricano ottanta messaggi (§43).
  const waitUntil = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime?.waitUntil;
  const initialSync = triggerInitialSync(connectionId);
  if (typeof waitUntil === 'function') waitUntil(initialSync);

  logEvent('email-oauth', { action: 'callback', provider, code: 'OK' });
  // Mai token nell'URL di ritorno (§73): solo l'esito.
  return redirectToApp(state.redirect_path as string, { connect: 'ok' });
}

/**
 * Avvia l'import iniziale invocando `email-sync` come servizio interno. Si passa
 * dalla funzione dedicata invece di duplicare qui l'orchestrazione: un solo
 * punto in cui la sincronizzazione è definita.
 */
async function triggerInitialSync(connectionId: string): Promise<void> {
  try {
    const url = `${Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '')}/functions/v1/email-sync`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
        'x-inbox-internal': '1',
      },
      body: JSON.stringify({ action: 'sync', connectionId, syncType: 'initial', triggeredBy: 'oauth_callback' }),
    });
  } catch {
    // Un import iniziale non partito NON è una perdita: la riconciliazione
    // periodica recupera comunque la finestra recente.
  }
}
