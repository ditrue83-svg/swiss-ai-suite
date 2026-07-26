// ============================================================================
// Edge Function: email-webhook — notifiche push da Google e Microsoft.
//
// QUESTO ENDPOINT È PUBBLICO. Chiunque conosca l'URL può chiamarlo, e l'URL
// finisce nella configurazione di due servizi esterni: «è difficile da
// indovinare» non è una misura di sicurezza (§25). Ogni notifica viene quindi
// AUTENTICATA prima di produrre qualunque effetto:
//
//   Google    il messaggio Pub/Sub arriva con un token OIDC firmato da Google
//             nell'intestazione Authorization. Si verifica la FIRMA contro le
//             chiavi pubbliche di Google, l'emittente, la scadenza, il
//             destinatario e l'indirizzo del service account autorizzato.
//             In più, un segreto nella query fa da primo filtro.
//   Microsoft ogni notifica riporta il `clientState` concordato alla creazione
//             della sottoscrizione. È un segreto per connessione, confrontato a
//             tempo costante. Il primo scambio è la validazione documentata:
//             si rispedisce il `validationToken` in testo semplice.
//
// Il contenuto della notifica NON è mai fonte di verità sul contenuto della
// posta: dice soltanto «qualcosa è cambiato su questa casella». Cosa sia
// cambiato lo si va a leggere dal provider, autenticati. Una notifica falsa,
// nel peggiore dei casi, provoca una sincronizzazione a vuoto.
// ============================================================================
import { timingSafeEqual, fromBase64, sha256Hex } from '../_shared/email/crypto.ts';
import {
  adminClient, CORS, env, failure, getEncryptionKey, json, logEvent,
} from '../_shared/email/runtime.ts';
import { claimWebhookEvent, closeWebhookEvent, readSecrets, type ServerClient } from '../_shared/email/store.ts';

/** Oltre questa dimensione non è una notifica: non la si legge nemmeno. */
const MAX_BODY_BYTES = 64 * 1024;
/** Quante notifiche al massimo per richiesta: oltre, si accetta e si ignora il resto. */
const MAX_NOTIFICATIONS = 25;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  const url = new URL(req.url);
  const provider = url.pathname.split('/').filter(Boolean).pop();

  // Microsoft valida la sottoscrizione con una richiesta che porta
  // `validationToken` e si aspetta il token in TESTO SEMPLICE entro pochi
  // secondi. Va gestita prima di ogni altro controllo, perché in quel momento la
  // sottoscrizione non esiste ancora e non c'è nessun `clientState` da
  // confrontare. Non produce alcun effetto: si limita a restituire ciò che ha
  // ricevuto, con un limite di lunghezza per non fare da specchio a payload
  // arbitrari.
  const validationToken = url.searchParams.get('validationToken');
  if (validationToken) {
    return new Response(validationToken.slice(0, 2048), {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    });
  }

  if (req.method !== 'POST') return failure('METHOD_NOT_ALLOWED', 405);

  const declaredLength = Number(req.headers.get('content-length') ?? '0');
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return failure('PAYLOAD_TOO_LARGE', 413);
  }
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) return failure('PAYLOAD_TOO_LARGE', 413);

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return failure('BAD_REQUEST', 400);
  }

  try {
    if (provider === 'google') return await handleGoogle(req, url, payload);
    if (provider === 'microsoft') return await handleMicrosoft(payload);
    return failure('NOT_FOUND', 404);
  } catch (error) {
    // Nessuno stack trace al chiamante: solo un codice. Il dettaglio resta qui.
    logEvent('email-webhook', { provider: provider ?? '-', code: 'HANDLER_ERROR' });
    void error;
    return failure('UNKNOWN', 500);
  }
});

// ---- Google -----------------------------------------------------------------

interface GoogleJwks { keys: { kid?: string; n?: string; e?: string; alg?: string; kty?: string }[] }

let jwksCache: { fetchedAt: number; keys: GoogleJwks['keys'] } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function googleJwks(): Promise<GoogleJwks['keys']> {
  if (jwksCache && Date.now() - jwksCache.fetchedAt < JWKS_TTL_MS) return jwksCache.keys;
  const response = await fetch('https://www.googleapis.com/oauth2/v3/certs', {
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('jwks non disponibile');
  const body = await response.json() as GoogleJwks;
  jwksCache = { fetchedAt: Date.now(), keys: body.keys ?? [] };
  return jwksCache.keys;
}

/**
 * Verifica il token OIDC con cui Google firma le consegne Pub/Sub.
 *
 * Si controlla la firma (RS256 contro le chiavi pubbliche di Google),
 * l'emittente, la scadenza e — se configurato — l'indirizzo del service account
 * che Pub/Sub usa per la consegna. Senza la verifica della firma, chiunque
 * potrebbe inviare un JWT costruito a mano: leggerne i campi senza verificarlo
 * equivale a non controllare nulla.
 */
async function verifyGoogleOidc(req: Request): Promise<boolean> {
  const header = req.headers.get('Authorization') ?? '';
  const token = header.replace(/^Bearer\s+/i, '').trim();
  if (!token) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;

  let head: { kid?: string; alg?: string };
  let claims: { iss?: string; aud?: string; exp?: number; email?: string; email_verified?: boolean };
  try {
    head = JSON.parse(new TextDecoder().decode(fromBase64(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(fromBase64(parts[1])));
  } catch {
    return false;
  }
  if (head.alg !== 'RS256') return false;                       // niente `alg: none`, niente HS256

  const key = (await googleJwks()).find((k) => k.kid === head.kid && k.kty === 'RSA');
  if (!key?.n || !key.e) return false;

  const cryptoKey = await crypto.subtle.importKey(
    'jwk',
    { kty: 'RSA', n: key.n, e: key.e, alg: 'RS256', ext: true },
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    fromBase64(parts[2]) as BufferSource,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`) as BufferSource,
  );
  if (!valid) return false;

  if (claims.iss !== 'https://accounts.google.com' && claims.iss !== 'accounts.google.com') return false;
  if (!claims.exp || claims.exp * 1000 < Date.now()) return false;

  // L'indirizzo del service account che Pub/Sub usa per la consegna: è il
  // vincolo che impedisce a un QUALSIASI account Google di firmare un token
  // valido per questo endpoint.
  const expected = env('GOOGLE_PUBSUB_SERVICE_ACCOUNT');
  if (expected && !(claims.email && timingSafeEqual(claims.email.toLowerCase(), expected.toLowerCase()))) {
    return false;
  }
  return true;
}

async function handleGoogle(req: Request, url: URL, payload: unknown): Promise<Response> {
  // Primo filtro, economico: un segreto nell'URL configurato su Pub/Sub. Non
  // sostituisce la verifica della firma, la precede.
  const expectedToken = env('GOOGLE_PUBSUB_VERIFICATION_TOKEN');
  if (expectedToken) {
    const provided = url.searchParams.get('token') ?? '';
    if (!timingSafeEqual(provided, expectedToken)) {
      logEvent('email-webhook', { provider: 'google', code: 'BAD_TOKEN' });
      return failure('FORBIDDEN', 403);
    }
  }

  if (!(await verifyGoogleOidc(req))) {
    logEvent('email-webhook', { provider: 'google', code: 'BAD_SIGNATURE' });
    return failure('FORBIDDEN', 403);
  }

  const envelope = payload as { message?: { data?: string; messageId?: string }; subscription?: string };
  const data = envelope.message?.data;
  if (!data) return json({ status: 'ignored' });

  let notification: { emailAddress?: string; historyId?: string | number };
  try {
    notification = JSON.parse(new TextDecoder().decode(fromBase64(data)));
  } catch {
    return failure('BAD_REQUEST', 400);
  }
  const emailAddress = (notification.emailAddress ?? '').toLowerCase();
  if (!emailAddress) return json({ status: 'ignored' });

  const sb = adminClient();
  // Una casella può essere collegata a più aziende (fiduciarie): la notifica
  // riguarda TUTTE le connessioni con quell'indirizzo, e fermarsi alla prima
  // lascerebbe indietro le altre senza che nessuno se ne accorga.
  const { data: connections } = await sb.from('email_connections')
    .select('id, company_id')
    .eq('provider', 'google').eq('email_address', emailAddress).eq('status', 'active').eq('sync_enabled', true);

  const list = (connections ?? []) as { id: string; company_id: string }[];
  if (!list.length) return json({ status: 'no_connection' });

  // §26 — l'impronta include l'identificativo del messaggio Pub/Sub: una
  // riconsegna dello stesso evento non fa lavorare due volte.
  const messageId = envelope.message?.messageId ?? String(notification.historyId ?? '');
  let triggered = 0;
  for (const connection of list.slice(0, MAX_NOTIFICATIONS)) {
    const fingerprint = await sha256Hex(`google:${connection.id}:${messageId}`);
    if (!(await claimWebhookEvent(sb, { provider: 'google', connectionId: connection.id, fingerprint }))) continue;
    const ok = await triggerSync(connection.id, 'incremental', 'webhook');
    await closeWebhookEvent(sb, fingerprint, ok ? 'processed' : 'failed', ok ? null : 'SYNC_TRIGGER_FAILED');
    if (ok) triggered++;
  }

  logEvent('email-webhook', { provider: 'google', connections: list.length, triggered });
  // Pub/Sub riconsegna finché non riceve un 2xx: si conferma la RICEZIONE, che
  // è ciò che l'evento garantisce. La sincronizzazione ha vita propria e, se
  // fallisce, è la riconciliazione periodica a recuperare.
  return json({ status: 'accepted', triggered });
}

// ---- Microsoft --------------------------------------------------------------

interface GraphNotification {
  subscriptionId?: string;
  clientState?: string;
  changeType?: string;
  lifecycleEvent?: string;
  resourceData?: { id?: string };
}

async function handleMicrosoft(payload: unknown): Promise<Response> {
  const notifications = ((payload as { value?: GraphNotification[] }).value ?? []).slice(0, MAX_NOTIFICATIONS);
  if (!notifications.length) return json({ status: 'ignored' });

  const sb = adminClient();
  const key = await getEncryptionKey();
  let triggered = 0;
  let rejected = 0;

  for (const notification of notifications) {
    const subscriptionId = notification.subscriptionId;
    if (!subscriptionId) { rejected++; continue; }

    const { data: connection } = await sb.from('email_connections')
      .select('id, company_id, status, sync_enabled')
      .eq('provider', 'microsoft').eq('watch_resource_id', subscriptionId).maybeSingle();
    if (!connection) { rejected++; continue; }

    // Il segreto concordato alla creazione della sottoscrizione. Confronto a
    // tempo costante: è l'unica cosa che distingue una notifica di Microsoft da
    // una richiesta costruita da chiunque conosca l'URL.
    const secrets = await readSecrets(sb, key, connection.id as string);
    if (!secrets.webhookState || !timingSafeEqual(notification.clientState ?? '', secrets.webhookState)) {
      rejected++;
      logEvent('email-webhook', { provider: 'microsoft', code: 'BAD_CLIENT_STATE' });
      continue;
    }

    // ---- Notifiche di ciclo di vita ----
    // Microsoft le documenta esplicitamente e NON sono casi limite: sono il modo
    // in cui si scopre che la sottoscrizione è morta prima che la casella smetta
    // silenziosamente di aggiornarsi.
    if (notification.lifecycleEvent) {
      const handled = await handleLifecycle(sb, connection.id as string, notification.lifecycleEvent);
      if (handled) triggered++;
      continue;
    }

    if (connection.status !== 'active' || !connection.sync_enabled) continue;

    const fingerprint = await sha256Hex(
      `microsoft:${connection.id}:${notification.resourceData?.id ?? ''}:${notification.changeType ?? ''}`,
    );
    if (!(await claimWebhookEvent(sb, { provider: 'microsoft', connectionId: connection.id as string, fingerprint }))) continue;
    const ok = await triggerSync(connection.id as string, 'incremental', 'webhook');
    await closeWebhookEvent(sb, fingerprint, ok ? 'processed' : 'failed', ok ? null : 'SYNC_TRIGGER_FAILED');
    if (ok) triggered++;
  }

  logEvent('email-webhook', { provider: 'microsoft', received: notifications.length, triggered, rejected });
  // Graph si aspetta un 202 rapido: il lavoro non si fa dentro la risposta.
  return new Response(null, { status: 202, headers: CORS });
}

/**
 * `subscriptionRemoved` e `reauthorizationRequired` non si risolvono con una
 * sincronizzazione: la prima richiede una sottoscrizione nuova, la seconda un
 * consenso nuovo dell'utente. `missed` dice che delle notifiche sono andate
 * perse, ed è esattamente il caso per cui esiste la riconciliazione.
 */
async function handleLifecycle(sb: ServerClient, connectionId: string, event: string): Promise<boolean> {
  switch (event) {
    case 'missed':
      return await triggerSync(connectionId, 'reconciliation', 'lifecycle_missed');
    case 'subscriptionRemoved':
      await sb.from('email_connections').update({
        watch_resource_id: null,
        watch_expires_at: null,
        watch_last_error_code: 'SUBSCRIPTION_GONE',
      }).eq('id', connectionId);
      // Il rinnovo lo farà il job periodico, che ha i token e sa ricrearla.
      return false;
    case 'reauthorizationRequired':
      await sb.from('email_connections').update({
        watch_last_error_code: 'REAUTHORIZATION_REQUIRED',
      }).eq('id', connectionId);
      // Un rinnovo del token può bastare: lo tenta la sincronizzazione, che
      // rinnova prima di lavorare. Se il consenso è davvero saltato, sarà lei a
      // portare la connessione in `reauth_required`.
      return await triggerSync(connectionId, 'incremental', 'lifecycle_reauth');
    default:
      return false;
  }
}

// ---- Innesco della sincronizzazione -----------------------------------------

/**
 * Il webhook non sincronizza: chiede a `email-sync` di farlo. Così la
 * sincronizzazione ha un solo posto in cui è definita, e la risposta al provider
 * non aspetta il download della posta.
 */
async function triggerSync(connectionId: string, syncType: string, triggeredBy: string): Promise<boolean> {
  try {
    const url = `${env('SUPABASE_URL')?.replace(/\/$/, '')}/functions/v1/email-sync`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${env('SUPABASE_SERVICE_ROLE_KEY') ?? ''}`,
        'x-inbox-internal': '1',
      },
      body: JSON.stringify({ action: 'sync', connectionId, syncType, triggeredBy }),
      signal: AbortSignal.timeout(25_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
