// ============================================================================
// Edge Function: lookup-company (Registro IDI / Zefix)
// Proxy server-side dell'API pubblica Zefix (ZefixPublicREST). Server-side per:
//  - tenere le credenziali Basic Auth Zefix come secret (mai nel browser);
//  - aggirare il CORS (Zefix non abilita origini browser);
//  - centralizzare normalizzazione ed errori.
// Ritorna candidati normalizzati per pre-compilare l'onboarding. NON persiste.
//
// Sicurezza: richiede un JWT valido (utente autenticato in onboarding). Dati del
// registro di commercio = pubblici, quindi nessuna autorizzazione per-azienda.
//
// Config: secret ZEFIX_AUTH = "utente:password" (credenziali gratuite Zefix).
//   npx supabase secrets set ZEFIX_AUTH="utente:password" --project-ref <ref>
// Senza secret la funzione risponde 503 (l'onboarding resta manuale).
// ============================================================================
import { createClient } from 'npm:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, 'Content-Type': 'application/json' } });

const ZEFIX_BASE = 'https://www.zefix.admin.ch/ZefixPublicREST/api/v1';
const MAX_RESULTS = 15;
const MIN_QUERY = 2;
const MAX_QUERY = 120;

// Cantoni Zefix (sigla 2 lettere) → etichette usate nell'app (CANTONI).
const CANTON_LABEL: Record<string, string> = {
  TI: 'Ticino', ZH: 'Zurigo', BE: 'Berna', GE: 'Ginevra', VD: 'Vaud', GR: 'Grigioni',
};
const cantonLabel = (code: unknown): string | null => {
  if (typeof code !== 'string' || !code) return null;
  return CANTON_LABEL[code.toUpperCase()] ?? 'Altro';
};

interface ZefixCompany {
  name?: string; uid?: string; chid?: string; legalSeat?: string; canton?: string;
  legalFormId?: number; status?: string; deletionDate?: string | null;
}
interface Candidate {
  uid: string | null; name: string | null; canton: string | null;
  municipality: string | null; status: string | null; legalFormId: number | null;
}
const normalize = (c: ZefixCompany): Candidate => ({
  uid: c?.uid ?? null,
  name: c?.name ?? null,
  canton: cantonLabel(c?.canton),
  municipality: c?.legalSeat ?? null,
  status: c?.status ?? null,
  legalFormId: typeof c?.legalFormId === 'number' ? c.legalFormId : null,
});

// "CHE-123.456.789" / "CHE 123 456 789" → "CHE123456789" (compatto per il path).
const compactUid = (q: string): string | null => {
  const m = q.toUpperCase().replace(/[\s.\-]/g, '').match(/^CHE(\d{9})$/);
  return m ? `CHE${m[1]}` : null;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Metodo non consentito' }, 405);

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Autenticazione richiesta.' }, 401);

  // §49 — solo utenti autenticati (dato pubblico, ma evita abusi della quota Zefix).
  const sb = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_ANON_KEY') ?? '',
    { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } },
  );
  const { data: userData, error: userErr } = await sb.auth.getUser();
  if (userErr || !userData?.user) return json({ error: 'Sessione non valida.', code: 'PROVIDER_ERROR' }, 401);

  // Validazione input PRIMA di controllare la config del servizio.
  const body = await req.json().catch(() => null);
  const query = typeof body?.query === 'string' ? body.query.trim().slice(0, MAX_QUERY) : '';
  if (query.length < MIN_QUERY) return json({ error: 'Inserisci almeno due caratteri.', code: 'QUERY_TOO_SHORT' }, 422);

  const rawAuth = Deno.env.get('ZEFIX_AUTH');
  if (!rawAuth) return json({ error: 'Ricerca Registro IDI non ancora configurata.', code: 'LOOKUP_NOT_CONFIGURED' }, 503);
  // "utente:password" → base64; se non contiene ":" si assume già base64.
  const basic = 'Basic ' + (rawAuth.includes(':') ? btoa(rawAuth) : rawAuth);

  const zHeaders = { Authorization: basic, 'Content-Type': 'application/json', Accept: 'application/json' };

  // Errore upstream: porta lo status HTTP di Zefix (mai le credenziali).
  class UpstreamError extends Error {
    status: number;
    detail: string;
    constructor(status: number, detail: string) { super(`zefix ${status}`); this.status = status; this.detail = detail; }
  }

  try {
    const uid = compactUid(query);
    let companies: Candidate[] = [];

    if (uid) {
      // Ricerca per IDI/UID esatto.
      const r = await fetch(`${ZEFIX_BASE}/firm/${uid}`, { headers: zHeaders });
      if (r.status === 404) companies = [];
      else if (!r.ok) throw new UpstreamError(r.status, (await r.text().catch(() => '')).slice(0, 200));
      else {
        const data = await r.json();
        const arr = Array.isArray(data) ? data : [data];
        companies = arr.filter(Boolean).map(normalize);
      }
    } else {
      // Ricerca per nome.
      const r = await fetch(`${ZEFIX_BASE}/firm/search`, {
        method: 'POST', headers: zHeaders,
        body: JSON.stringify({ name: query, activeOnly: true, languageKey: 'it', maxEntries: MAX_RESULTS, offset: 0 }),
      });
      if (!r.ok) throw new UpstreamError(r.status, (await r.text().catch(() => '')).slice(0, 200));
      const data = await r.json();
      companies = (Array.isArray(data) ? data : []).slice(0, MAX_RESULTS).map(normalize);
    }

    return json({ companies });
  } catch (e) {
    const up = e instanceof UpstreamError ? e : null;
    console.error('lookup-company error:', up ? `zefix ${up.status}: ${up.detail}` : (e as Error)?.message);

    // Credenziali rifiutate da Zefix: è un problema di CONFIGURAZIONE, non
    // dell'utente — va distinto, altrimenti sembra un guasto temporaneo.
    if (up && (up.status === 401 || up.status === 403)) {
      return json({
        error: 'Le credenziali del Registro IDI non sono valide o non abilitate. Inserisci i dati manualmente.',
        code: 'LOOKUP_AUTH_FAILED', upstreamStatus: up.status,
      }, 503);
    }
    return json({
      error: 'Ricerca nel Registro IDI non riuscita. Riprova o inserisci i dati manualmente.',
      code: 'PROVIDER_ERROR', upstreamStatus: up?.status ?? null,
    }, 502);
  }
});
