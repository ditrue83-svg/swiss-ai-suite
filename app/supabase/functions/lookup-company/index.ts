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
//
// ⚠️ STATO AL 2026-07-27: gli endpoint qui sotto sono stati allineati al
// documento OpenAPI ufficiale (`/ZefixPublicREST/v3/api-docs`, versione
// 2.7.2.3), che dichiara Basic Auth su tutte le rotte. La versione precedente
// chiamava `/api/v1/firm/search` e `/api/v1/firm/{uid}`: **rotte che non
// esistono**, quindi la ricerca avrebbe risposto 404 anche con credenziali
// valide. Erano sbagliati anche due campi della risposta — `canton`, che nella
// ricerca per nome l'API non restituisce affatto, e `legalFormId`, che è
// annidato in `legalForm.id`.
//
// ✅ **PROVATO CONTRO L'API VIVA il 2026-07-28** (credenziali rilasciate
// dall'UFRC il 27.07, account attivo dal 28.07). Le tre cose che il commento
// precedente dichiarava non verificate, ora misurate su risposte reali:
//  - **corpo accettato**: `{name, activeOnly}` → 200. ⚠️ I campi che NON
//    esistono in `CompanySearchQuery` (`maxEntries`, `offset`, `languageKey`)
//    non vengono rifiutati: sono **ignorati in silenzio**, e la risposta è
//    byte-identica. Il vecchio codice credeva quindi di limitare i risultati e
//    li riceveva tutti. Non esiste alcun modo di paginare lato server.
//  - **campi**: `canton` assente in TUTTI i risultati della ricerca per nome
//    (c'è solo nel dettaglio per IDI), `legalForm` è un oggetto con `id`
//    numerico, `status` arriva MAIUSCOLO (`ACTIVE`, `BEING_CANCELLED`).
//    ⚠️ `activeOnly: true` non significa «solo ACTIVE»: restituisce anche le
//    società in cancellazione.
//  - **numero di risultati senza paginazione**: 95 per «Rossi» (7,9 KB).
//    Arriva tutto; il taglio a MAX_RESULTS è nostro e resta necessario.
// `GET /company/uid/{id}` risponde con un **array di uno**, come già gestito.
// ⚠️ L'UFRC sconsiglia le interrogazioni di massa regolari: chi disturba viene
// bloccato. La ricerca è legata a un gesto dell'utente in onboarding, non a un
// processo automatico, e così deve restare.
// (Attenzione a non confondere Zefix con **Regix**, che è il servizio dell'UFRC
// per la verifica dei NOMI di nuove ditte: altro servizio, altre credenziali,
// nessuna API pubblica.)
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

/** Forma giuridica: nella risposta è un OGGETTO, non un identificativo sciolto. */
interface ZefixLegalForm { id?: number; uid?: string }

/**
 * Campi che leggiamo dalla risposta di Zefix. Rispecchiano `CompanyShort`
 * (ricerca per nome) e `CompanyFull` (ricerca per IDI) del documento OpenAPI.
 *
 * ⚠️ `canton` esiste **solo** in `CompanyFull`: cercando per nome l'API non lo
 * restituisce. Resta null e lo compila la persona — dedurlo dal comune sarebbe
 * inventare un dato che il registro non ha dato.
 */
interface ZefixCompany {
  name?: string; uid?: string; chid?: string; legalSeat?: string; canton?: string;
  legalForm?: ZefixLegalForm; status?: string; deletionDate?: string | null;
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
  legalFormId: typeof c?.legalForm?.id === 'number' ? c.legalForm.id : null,
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
      // Ricerca per IDI/UID esatto → `CompanyFull`, che porta anche il cantone.
      const r = await fetch(`${ZEFIX_BASE}/company/uid/${uid}`, { headers: zHeaders });
      if (r.status === 404) companies = [];
      else if (!r.ok) throw new UpstreamError(r.status, (await r.text().catch(() => '')).slice(0, 200));
      else {
        const data = await r.json();
        const arr = Array.isArray(data) ? data : [data];
        companies = arr.filter(Boolean).map(normalize);
      }
    } else {
      // Ricerca per nome → array di `CompanyShort`.
      //
      // Il corpo contiene SOLO i campi che lo schema `CompanySearchQuery`
      // dichiara: `name` (obbligatorio) e `activeOnly`. `maxEntries`, `offset` e
      // `languageKey` non esistono in quello schema — c'erano, e mandare campi
      // che l'API non conosce è un modo di scoprire tardi che non funzionano.
      // Il numero di risultati lo limitiamo qui, dove è una nostra decisione.
      const r = await fetch(`${ZEFIX_BASE}/company/search`, {
        method: 'POST', headers: zHeaders,
        body: JSON.stringify({ name: query, activeOnly: true }),
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
