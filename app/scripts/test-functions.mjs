// ============================================================================
// Sicurezza e validazione delle Edge Function `generate-reply` e
// `interpret-project` — le uniche due che non avevano alcun test riproducibile.
//   npm run test:functions
//
// NON consuma crediti AI: tutti i casi coperti vengono rifiutati PRIMA della
// chiamata al modello (metodo, autenticazione, input, membership, rate limit).
// Verifica che un utente non possa agire su dati di un'altra azienda (§49) e
// che il limite per azienda regga (§50).
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) { console.error('Mancano le variabili in .env.test'); process.exit(1); }

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const fnUrl = (name) => `${URL.replace(/\/$/, '')}/functions/v1/${name}`;

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
let pass = 0, fail = 0, skipped = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ${G}✓${X} ${name}${detail ? ` ${DIM}${detail}${X}` : ''}`); }
  else { fail++; console.log(`  ${R}✗${X} ${name}${detail ? ` ${DIM}${detail}${X}` : ''}`); }
};
const skip = (name, why) => { skipped++; console.log(`  ${Y}~${X} ${name} ${DIM}(${why})${X}`); };

const PW = 'Test1234!';
const created = { users: [], companies: [] };
const isJwtTransient = (m = '') => /invalid JWT|unverifiable|unrecognized JWT kid/i.test(m);
async function withRetry(label, fn, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await fn();
    if (!error) return data;
    last = error;
    if (!isJwtTransient(error.message)) break;
    await new Promise((r) => setTimeout(r, 400 * (i + 1)));
  }
  throw new Error(`${label}: ${last?.message}`);
}
async function makeUser(tag) {
  const email = `fn+${tag}.${Date.now()}@example.com`;
  const data = await withRetry('createUser', () => admin.auth.admin.createUser({
    email, password: PW, email_confirm: true, user_metadata: { first_name: 'Test', last_name: tag },
  }));
  created.users.push(data.user.id);
  const client = anonClient();
  await withRetry('signIn', () => client.auth.signInWithPassword({ email, password: PW }));
  const { data: s } = await client.auth.getSession();
  return { client, id: data.user.id, token: s.session.access_token };
}

/** Chiamata HTTP grezza: controlla lo status esatto senza passare dall'SDK. */
async function raw(name, { token, body, method = 'POST' }) {
  const headers = { apikey: ANON, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(fnUrl(name), { method, headers, body: body ? JSON.stringify(body) : undefined });
  let payload = null;
  try { payload = await res.json(); } catch { /* non JSON */ }
  return { status: res.status, body: payload };
}

async function main() {
  console.log(`\n${DIM}SwissAI Suite — sicurezza di generate-reply e interpret-project${X}\n`);

  const A = await makeUser('A');
  const { data: companyA } = await A.client.rpc('create_company_with_owner', {
    p_legal_name: 'Funzioni A SA', p_canton: 'Ticino', p_municipality: 'Lugano', p_legal_form: 'SA', p_sector: 'servizi',
  });
  created.companies.push(companyA);
  const { data: docA } = await A.client.from('documents').insert({
    company_id: companyA, uploaded_by: A.id, title: 'Documento A', source_type: 'pasted_text',
    status: 'uploaded', mime_type: 'text/plain', file_hash: `fn-${Date.now()}`,
  }).select('*').single();

  const Bu = await makeUser('B');
  const { data: companyB } = await Bu.client.rpc('create_company_with_owner', {
    p_legal_name: 'Funzioni B SA', p_canton: 'Zurigo', p_municipality: 'Zurigo', p_legal_form: 'SA', p_sector: 'ict',
  });
  created.companies.push(companyB);

  // =========================================================================
  console.log(`${B}generate-reply${X}`);
  {
    const r = await raw('generate-reply', { token: A.token, method: 'GET' });
    check('metodo GET → 405', r.status === 405, `status=${r.status}`);
  }
  {
    const r = await raw('generate-reply', { token: null, body: { documentId: docA.id } });
    check('senza Authorization → 401', r.status === 401, `status=${r.status}`);
  }
  {
    const r = await raw('generate-reply', { token: A.token, body: {} });
    const okStatus = r.status === 400 || r.status === 503;
    check('documentId mancante → 400', r.status === 400, `status=${r.status}`);
    if (r.status === 503) skip('(servizio AI non configurato: il check chiave precede l\'input)', 'AI_NOT_CONFIGURED');
    void okStatus;
  }
  {
    // §49 — B non deve poter generare una risposta sul documento di A.
    const r = await raw('generate-reply', { token: Bu.token, body: { documentId: docA.id, language: 'it', tone: 'formale' } });
    check('§49 · utente B sul documento di A → 403', r.status === 403, `status=${r.status}`);
  }
  {
    // Documento di A senza testo estratto: rifiutato prima di chiamare il modello.
    const r = await raw('generate-reply', { token: A.token, body: { documentId: docA.id, language: 'it', tone: 'formale' } });
    check('documento senza testo → 422 (nessuna chiamata al modello)', r.status === 422, `status=${r.status}`);
  }

  // =========================================================================
  console.log(`\n${B}interpret-project${X}`);
  {
    const r = await raw('interpret-project', { token: A.token, method: 'GET' });
    check('metodo GET → 405', r.status === 405, `status=${r.status}`);
  }
  {
    const r = await raw('interpret-project', { token: null, body: { companyId: companyA, description: 'x'.repeat(50) } });
    check('senza Authorization → 401', r.status === 401, `status=${r.status}`);
  }
  {
    const r = await raw('interpret-project', { token: A.token, body: { description: 'x'.repeat(50) } });
    check('companyId mancante → 400', r.status === 400, `status=${r.status}`);
  }
  {
    const r = await raw('interpret-project', { token: A.token, body: { companyId: companyA, description: 'corta' } });
    check('descrizione troppo corta → 422', r.status === 422, `status=${r.status}, code=${r.body?.code ?? '—'}`);
  }
  {
    // §49 — A non deve poter interpretare per conto dell'azienda B.
    const r = await raw('interpret-project', { token: A.token, body: { companyId: companyB, description: 'Vogliamo installare un impianto fotovoltaico sul tetto del capannone aziendale.' } });
    check('§49 · azienda altrui → 403', r.status === 403, `status=${r.status}`);
  }

  // =========================================================================
  console.log(`\n${B}Rate limit per azienda (§50)${X}`);
  {
    // Si satura la finestra con il service_role (bypassa RLS), poi si verifica
    // che entrambe le funzioni rifiutino PRIMA di spendere crediti.
    const now = Date.now();
    const burst = Array.from({ length: 13 }, (_, i) => ({
      company_id: companyA, user_id: A.id, document_id: null, kind: 'analysis',
      provider: 'anthropic', model: 'test', status: 'ok',
      created_at: new Date(now - i * 500).toISOString(),
    }));
    const { error: seedErr } = await admin.from('ai_request_log').insert(burst);
    if (seedErr) {
      skip('rate limit', `impossibile pre-popolare il log: ${seedErr.message.slice(0, 60)}`);
    } else {
      const r1 = await raw('interpret-project', { token: A.token, body: { companyId: companyA, description: 'Vogliamo digitalizzare la gestione degli ordini con un nuovo software gestionale.' } });
      check('interpret-project oltre il limite → 429', r1.status === 429, `status=${r1.status}`);
      const r2 = await raw('generate-reply', { token: A.token, body: { documentId: docA.id, language: 'it', tone: 'formale' } });
      check('generate-reply oltre il limite → 429', r2.status === 429, `status=${r2.status}`);
      await admin.from('ai_request_log').delete().eq('company_id', companyA);
    }
  }

  console.log(`\n${pass} passati, ${fail} falliti${skipped ? `, ${skipped} saltati` : ''}\n`);
}

async function cleanup() {
  console.log(`${DIM}Pulizia dati di test…${X}`);
  for (const id of created.companies) { try { await admin.from('companies').delete().eq('id', id); } catch { /* ignore */ } }
  for (const id of created.users) { try { await admin.auth.admin.deleteUser(id); } catch { /* ignore */ } }
}

main().catch((e) => { console.error('\nErrore inatteso:', e?.message ?? e); fail++; })
  .finally(async () => { await cleanup(); process.exit(fail ? 1 : 0); });
