// ============================================================================
// Collante fra i moduli portabili e il runtime Deno delle Edge Function.
//
// Tutto ciò che legge l'ambiente, costruisce client e decide le origini
// ammesse vive QUI e solo qui. I moduli di dominio (adapter, sync, store)
// restano puri e testabili proprio perché non conoscono `Deno.env`.
//
// ⚠️ Questo file NON va importato dai test: userebbe API che in Node non
// esistono. I test costruiscono gli adapter passando la configurazione a mano.
// ============================================================================
import Anthropic from 'npm:@anthropic-ai/sdk';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { createGoogleAdapter } from './google.ts';
import { createMicrosoftAdapter } from './microsoft.ts';
import { importKey } from './crypto.ts';
import { EmailProviderError } from './types.ts';
import type { EmailProviderAdapter, ProviderConfig } from './types.ts';
import type { ConnectionRow, ServerClient } from './store.ts';
import type { CreateMessage, ModelMessage } from '../pipeline.ts';

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
  if (!value) throw new EmailProviderError('CONFIG_MISSING', `${name} non configurato`);
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

export async function getEncryptionKey(): Promise<CryptoKey> {
  return await importKey(requireEnv('EMAIL_TOKEN_KEY'));
}

// ---- Origini ammesse (§92/§93) ----------------------------------------------

/**
 * Origine canonica dell'applicazione. NON si deduce da `Origin` o `Referer` né
 * da un parametro della richiesta: sono valori che decide il chiamante, e
 * usarli per costruire un redirect è la definizione di open redirect.
 */
export function appOrigin(): string {
  return requireEnv('APP_PUBLIC_URL').replace(/\/$/, '');
}

/**
 * Percorso di ritorno dopo il collegamento. Si accetta SOLO un percorso
 * relativo che comincia con una sola barra: `//evil.example` è un URL
 * protocol-relative e verrebbe seguito dal browser come dominio esterno.
 */
export function safeReturnPath(raw: string | null | undefined): string {
  const value = (raw ?? '').trim();
  if (!value.startsWith('/') || value.startsWith('//')) return '/inbox';
  if (value.includes('\\') || value.includes('://')) return '/inbox';
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
  return `${requireEnv('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/email-oauth/callback`;
}

export function webhookUrl(provider: 'google' | 'microsoft'): string {
  return `${requireEnv('SUPABASE_URL').replace(/\/$/, '')}/functions/v1/email-webhook/${provider}`;
}

export function providerConfig(provider: 'google' | 'microsoft'): ProviderConfig {
  if (provider === 'google') {
    return {
      clientId: requireEnv('GOOGLE_CLIENT_ID'),
      clientSecret: requireEnv('GOOGLE_CLIENT_SECRET'),
      redirectUri: oauthRedirectUri(),
      pubsubTopic: env('GOOGLE_PUBSUB_TOPIC') ?? undefined,
    };
  }
  return {
    clientId: requireEnv('MICROSOFT_CLIENT_ID'),
    clientSecret: requireEnv('MICROSOFT_CLIENT_SECRET'),
    redirectUri: oauthRedirectUri(),
    tenant: env('MICROSOFT_TENANT') ?? 'common',
  };
}

export function adapterForProvider(provider: 'google' | 'microsoft'): EmailProviderAdapter {
  return provider === 'google'
    ? createGoogleAdapter(providerConfig('google'))
    : createMicrosoftAdapter(providerConfig('microsoft'));
}

export function adapterForConnection(connection: ConnectionRow): EmailProviderAdapter {
  return adapterForProvider(connection.provider);
}

/** Quali provider sono davvero configurati: la UI mostra lo stato REALE (§140). */
export function configuredProviders(): ('google' | 'microsoft')[] {
  const out: ('google' | 'microsoft')[] = [];
  if (env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')) out.push('google');
  if (env('MICROSOFT_CLIENT_ID') && env('MICROSOFT_CLIENT_SECRET')) out.push('microsoft');
  return out;
}

/**
 * Client AI. Restituisce null se la chiave non c'è: la posta si sincronizza
 * lo stesso e i messaggi restano «da verificare» — l'acquisizione è
 * infrastruttura, la classificazione è un livello sopra (§103).
 */
export function aiCreateMessage(): CreateMessage | null {
  const apiKey = env('ANTHROPIC_API_KEY');
  if (!apiKey) return null;
  const anthropic = new Anthropic({ apiKey });
  return ((request: unknown) => anthropic.messages.create(request as never) as Promise<ModelMessage>) as CreateMessage;
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
 * dell'utente. Se non è membro la select non torna nulla. Non si interroga
 * `company_members` con il service role, perché quello risponderebbe anche per
 * aziende che l'utente non può vedere e sposterebbe il controllo dal database
 * al nostro `if`.
 */
export async function assertMember(auth: AuthedRequest, companyId: string): Promise<boolean> {
  const { data } = await auth.sbUser.from('companies').select('id').eq('id', companyId).maybeSingle();
  return !!data;
}

/** Collegare e scollegare una casella è un'azione da titolare o amministratore (§51). */
export async function assertAdmin(auth: AuthedRequest, companyId: string): Promise<boolean> {
  const { data } = await auth.sbUser.from('company_members')
    .select('role').eq('company_id', companyId).eq('user_id', auth.userId).maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === 'owner' || role === 'admin';
}

/** Lingua dell'interfaccia dichiarata dal client; l'italiano è il ripiego. */
export function outputLanguage(value: unknown): 'it' | 'de' | 'fr' {
  return value === 'de' ? 'de' : value === 'fr' ? 'fr' : 'it';
}

/**
 * Log tecnico senza dati personali: mai oggetto, mittente o token (§47).
 *
 * ⚠️ `boolean` È NELL'ELENCO, e fino al 2026-08-04 solo qui non c'era. Di questa
 * funzione esistono TRE copie identiche — `calendar/runtime.ts`,
 * `automation/runtime.ts` e questa — e le altre due accettavano `boolean` da
 * sempre. Il chiamante (`email-maintenance`) passa `timeBudgetReached`, che è un
 * booleano: a runtime funzionava, perché il corpo interpola e basta, ma la firma
 * era divergente. Tre copie della stessa funzione divergono senza che nulla
 * diventi rosso — qui l'ha reso rosso il fatto che il chiamante sia finalmente
 * entrato nel typecheck.
 */
export function logEvent(scope: string, fields: Record<string, string | number | boolean | null>): void {
  const safe = Object.entries(fields)
    .map(([k, v]) => `${k}=${v ?? '-'}`)
    .join(' ');
  console.log(`[${scope}] ${safe}`);
}
