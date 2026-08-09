// ============================================================================
// Collante fra i moduli portabili del motore e il runtime Deno delle Edge
// Function delle automazioni.
//
// Tutto ciò che legge l'ambiente e costruisce client vive QUI e solo qui:
// registro, valutatore, modelli e motore restano puri e provabili in Node
// proprio perché non conoscono `Deno.env`.
//
// ⚠️ Questo file NON va importato dai test: userebbe API che in Node non
// esistono.
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';
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
 * UI nella lingua dell'utente; il dettaglio tecnico resta nei log del server.
 */
export const failure = (code: string, status: number, extra: Record<string, unknown> = {}) =>
  json({ error: code, code, ...extra }, status);

export function env(name: string): string | null {
  const value = Deno.env.get(name);
  return value && value.trim() ? value.trim() : null;
}

export function requireEnv(name: string): string {
  const value = env(name);
  if (!value) throw new Error(`CONFIG_MISSING:${name}`);
  return value;
}

/**
 * Client con service role: scrive ciò che il client autenticato non può scrivere.
 *
 * ⚠️ IL TIPO È QUELLO VERO, NON `ServerClient`, e fino al 2026-08-04 era il
 * contrario: `… as unknown as ServerClient` costruiva il client completo e poi
 * ne buttava via il tipo. Restringere la forma di un oggetto che si è appena
 * costruiti non protegge nessuno — chi riceve `ServerClient` continua a
 * riceverlo, perché il client vero lo soddisfa — e costava: `subsidy-worker`
 * passa questo client a `runMatching`, che chiede il `SupabaseClient` concreto,
 * e il typecheck lo rifiutava pur essendo a runtime esattamente quell'oggetto.
 * Un cast che nasconde la verità si paga dove la verità serviva.
 */
export function adminClient() {
  return createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}

/** Client con il JWT dell'utente: è la RLS a decidere cosa può leggere. */
export function userClient(authHeader: string) {
  return createClient(
    requireEnv('SUPABASE_URL'),
    requireEnv('SUPABASE_ANON_KEY'),
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
}

export interface AuthedRequest {
  userId: string;
  sbUser: ReturnType<typeof userClient>;
}

export async function authenticate(req: Request): Promise<AuthedRequest | null> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return null;
  const sbUser = userClient(authHeader);
  const { data, error } = await sbUser.auth.getUser();
  if (error || !data?.user) return null;
  return { userId: data.user.id, sbUser };
}

/**
 * Solo chi guida l'azienda governa le automazioni (§5/§111).
 *
 * ⚠️ IL RUOLO SI CHIEDE AL DATABASE CON IL JWT DELL'UTENTE, non al service
 * role. Con il service role la risposta arriverebbe anche per aziende che
 * quell'utente non può vedere, e il controllo si sposterebbe dalla RLS al
 * nostro `if` — cioè da una garanzia a una convenzione. Qui si legge
 * `company_members` come l'utente: se non è amministratore di quell'azienda,
 * la riga non c'è.
 */
export async function assertAdmin(auth: AuthedRequest, companyId: string): Promise<boolean> {
  const { data } = await auth.sbUser
    .from('company_members')
    .select('role')
    .eq('company_id', companyId)
    .eq('user_id', auth.userId)
    .maybeSingle();
  const role = (data as { role?: string } | null)?.role;
  return role === 'owner' || role === 'admin';
}

/** Log tecnico senza dati personali: mai titoli, indirizzi o testi (§168). */
export function logEvent(scope: string, fields: Record<string, string | number | boolean | null>): void {
  const safe = Object.entries(fields).map(([k, v]) => `${k}=${v ?? '-'}`).join(' ');
  console.log(`[${scope}] ${safe}`);
}
