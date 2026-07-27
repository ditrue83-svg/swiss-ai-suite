// ============================================================================
// Collante fra i moduli portabili e il runtime Deno delle Edge Function del
// calendario.
//
// Tutto ciò che legge l'ambiente, costruisce client e decide le origini ammesse
// vive QUI e solo qui. Adapter, stato desiderato e motore dei promemoria
// restano puri e testabili proprio perché non conoscono `Deno.env`.
//
// ⚠️ Questo file NON va importato dai test: userebbe API che in Node non
// esistono.
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
import { importKey } from '../email/crypto.ts';
import { createGoogleCalendarAdapter } from './google.ts';
import { createMicrosoftCalendarAdapter } from './microsoft.ts';
import { createResendProvider, type NotificationEmailProvider } from './email.ts';
import { CalendarProviderError, type CalendarProviderAdapter, type CalendarProviderConfig } from './types.ts';
import type { ServerClient } from './store.ts';

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

/**
 * Errore verso il client: SOLO un codice. Il messaggio leggibile lo compone la
 * UI nella lingua dell'utente (§108); il dettaglio tecnico resta nei log del
 * server. Un `invalid_grant` non deve mai comparire in una schermata.
 */
export const failure = (code: string, status: number) => json({ error: code, code }, status);

export function env(name: string): string | null {
  const value = Deno.env.get(name);
  return value && value.trim() ? value.trim() : null;
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new CalendarProviderError('CONFIG_MISSING', `${name} non configurato`);
  return value;
}

/** Client con service role: scrive ciò che il client autenticato non può scrivere. */
export function adminClient(): ServerClient {
  return createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  ) as unknown as ServerClient;
}

/** Client con il JWT dell'utente: è la RLS a decidere cosa può leggere. */
export function userClient(authHeader: string) {
  return createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_ANON_KEY'),
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
}

/**
 * La chiave di cifratura dei token del calendario.
 *
 * ⚠️ È LA STESSA dell'Inbox (`EMAIL_TOKEN_KEY`) e la scelta è deliberata.
 * Una chiave separata sembrerebbe più prudente e non lo sarebbe: raddoppierebbe
 * il numero di segreti da ruotare, da conservare e da non perdere, per
 * proteggere da uno scenario — «chi ha una chiave non deve avere l'altra» — che
 * non esiste, perché entrambe vivono nello stesso posto e chi le legge le legge
 * tutte e due. L'isolamento fra i due domini lo dà l'AAD, che è l'id della
 * connessione: un token del calendario non si decifra come token di posta,
 * nemmeno con la chiave giusta.
 * Se un domani servisse separarle, `CALENDAR_TOKEN_KEY` viene letta per prima.
 */
export async function getEncryptionKey(): Promise<CryptoKey> {
  return await importKey(env('CALENDAR_TOKEN_KEY') ?? requireEnv('EMAIL_TOKEN_KEY'));
}

// ---- Origini ammesse --------------------------------------------------------

/**
 * Origine canonica dell'applicazione (§88). NON si deduce da `Origin`,
 * `Referer` o da un parametro della richiesta: sono valori che decide il
 * chiamante, e usarli per costruire un collegamento che finisce in un'email è
 * il modo più diretto per mandare i propri utenti su un dominio altrui.
 */
export function appOrigin(): string {
  return requireEnv('APP_PUBLIC_URL').replace(/\/$/, '');
}

/**
 * Percorso di ritorno dopo il collegamento. Si accetta SOLO un percorso
 * relativo che comincia con UNA sola barra: `//evil.example` è un URL
 * protocol-relative e il browser lo seguirebbe come dominio esterno.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value.startsWith('/') || value.startsWith('//')) return '/calendario';
  if (value.includes('\\') || value.includes('://')) return '/calendario';
  return value.slice(0, 200);
}

export function redirectToApp(path: string, params: Record<string, string> = {}): Response {
  const url = new URL(appOrigin() + safeReturnPath(path));
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { Location: url.toString() } });
}

// ---- Provider ---------------------------------------------------------------

/** URL di callback OAuth: costruito dal server, mai ricevuto dal client. */
export function oauthRedirectUri(): string {
  return `${requireEnv('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/calendar-oauth/callback`;
}

/**
 * ⚠️ NESSUN RIPIEGO SULLE CREDENZIALI DELL'INBOX, e la ragione è la sola che
 * conta: il server non può sostenere quell'affermazione.
 *
 * La prima versione leggeva `GOOGLE_CALENDAR_CLIENT_ID` e ripiegava su
 * `GOOGLE_CLIENT_ID`, per non far configurare due volte la stessa app. Il
 * risultato, visto in produzione: `GOOGLE_CLIENT_ID` esiste già per la posta,
 * quindi la schermata dichiarava Google «configurato» e offriva il pulsante —
 * ma quell'app OAuth ha registrato SOLO lo scope di Gmail. Premendolo, Google
 * avrebbe rifiutato `calendar.app.created`, e il nostro messaggio («il permesso
 * non è stato concesso, spunta la casella») avrebbe mandato a cercare nel posto
 * sbagliato: la casella non c'è, manca la registrazione dello scope.
 *
 * Che una schermata di consenso abbia quello scope il server NON può saperlo.
 * Quindi non lo deduce: chiede una variabile dedicata. Riusare la stessa app
 * dell'Inbox resta possibilissimo — si imposta `GOOGLE_CALENDAR_CLIENT_ID` con
 * lo stesso valore — e quel gesto significa «ho preparato questa app anche per
 * il calendario». Una variabile in più, ma lo stato mostrato è VERO (§79).
 */
export function providerConfig(provider: 'google' | 'microsoft'): CalendarProviderConfig {
  if (provider === 'google') {
    return {
      clientId: requireEnv('GOOGLE_CALENDAR_CLIENT_ID'),
      clientSecret: requireEnv('GOOGLE_CALENDAR_CLIENT_SECRET'),
      redirectUri: oauthRedirectUri(),
    };
  }
  return {
    clientId: requireEnv('MICROSOFT_CALENDAR_CLIENT_ID'),
    clientSecret: requireEnv('MICROSOFT_CALENDAR_CLIENT_SECRET'),
    redirectUri: oauthRedirectUri(),
    tenant: env('MICROSOFT_TENANT') ?? 'common',
  };
}

export function adapterFor(provider: 'google' | 'microsoft'): CalendarProviderAdapter {
  return provider === 'google'
    ? createGoogleCalendarAdapter(providerConfig('google'))
    : createMicrosoftCalendarAdapter(providerConfig('microsoft'));
}

/**
 * Quali provider sono davvero configurati PER IL CALENDARIO: la UI mostra lo
 * stato REALE (§79).
 *
 * Le variabili sono dedicate e non si ripiega su quelle dell'Inbox: vedi il
 * commento di `providerConfig`. Dichiarare configurato ciò che non lo è
 * significa offrire un pulsante che porta a un errore, cioè una funzione finta.
 */
export function configuredProviders(): ('google' | 'microsoft')[] {
  const out: ('google' | 'microsoft')[] = [];
  if (env('GOOGLE_CALENDAR_CLIENT_ID') && env('GOOGLE_CALENDAR_CLIENT_SECRET')) out.push('google');
  if (env('MICROSOFT_CALENDAR_CLIENT_ID') && env('MICROSOFT_CALENDAR_CLIENT_SECRET')) out.push('microsoft');
  return out;
}

/**
 * Il provider di email transazionali, oppure `null`.
 *
 * `null` non è un guasto: è la configurazione normale finché nessuno ha deciso
 * di attivare le email. La schermata delle impostazioni legge questo stato e
 * dice «non disponibile» invece di mostrare un interruttore che non farebbe
 * partire niente (§79).
 */
export function resolveEmailProvider(): NotificationEmailProvider | null {
  const apiKey = env('NOTIFICATION_EMAIL_API_KEY');
  const from = env('NOTIFICATION_EMAIL_FROM');
  if (!apiKey || !from) return null;
  return createResendProvider({ apiKey, from });
}

// ---- Autenticazione e autorizzazione ----------------------------------------

export interface AuthedRequest {
  userId: string;
  sbUser: ReturnType<typeof userClient>;
  authHeader: string;
}

export async function authenticate(req: Request): Promise<AuthedRequest | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const sbUser = userClient(authHeader);
  const { data, error } = await sbUser.auth.getUser();
  if (error || !data?.user) return null;
  return { userId: data.user.id, sbUser, authHeader };
}

/**
 * Appartenenza verificata TRAMITE RLS: si legge la riga con il client
 * dell'utente. Se non è membro, la select non torna nulla. Non si interroga
 * `company_members` con il service role, perché quello risponderebbe anche per
 * aziende che l'utente non può vedere e sposterebbe il controllo dal database
 * al nostro `if`.
 *
 * ⚠️ A differenza dell'Inbox NON serve essere amministratori: collegare il
 * PROPRIO calendario è un gesto personale, e chiedere il ruolo di
 * amministratore significherebbe che un collaboratore non può vedere le proprie
 * scadenze sul proprio telefono.
 */
export async function assertMember(auth: AuthedRequest, companyId: string): Promise<boolean> {
  const { data } = await auth.sbUser.from('companies').select('id').eq('id', companyId).maybeSingle();
  return !!data;
}

/** Log tecnico senza dati personali: mai titoli, indirizzi o token (§128). */
export function logEvent(scope: string, fields: Record<string, string | number | boolean | null>): void {
  const safe = Object.entries(fields).map(([k, v]) => `${k}=${v ?? '-'}`).join(' ');
  console.log(`[${scope}] ${safe}`);
}
