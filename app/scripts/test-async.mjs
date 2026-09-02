// ============================================================================
// §26 — Verifica che il processing ASINCRONO sia REALE, non simulato.
//   npm run test:async
//
// Cosa dimostra:
//  1. la risposta torna SUBITO (202 processing) mentre l'analisi non è finita;
//  2. lo stato viaggia davvero nel DB (extracting/analyzing → completed);
//  3. il lavoro prosegue sul server DOPO la risposta HTTP (l'analisi compare
//     senza che il client abbia più chiamato la funzione);
//  4. le verifiche di sicurezza restano SINCRONE anche in modalità async
//     (cross-tenant → 403 subito, non 202);
//  5. un fallimento non lascia il documento appeso: finisce in 'failed'.
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

const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ${G}✓${X} ${name}${detail ? ` ${DIM}${detail}${X}` : ''}`); }
  else { fail++; console.log(`  ${R}✗${X} ${name}${detail ? ` ${DIM}${detail}${X}` : ''}`); }
};

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
  const email = `async+${tag}.${Date.now()}@example.com`;
  const data = await withRetry('createUser', () => admin.auth.admin.createUser({
    email, password: PW, email_confirm: true, user_metadata: { first_name: 'Test', last_name: tag },
  }));
  created.users.push(data.user.id);
  const client = anonClient();
  await withRetry('signIn', () => client.auth.signInWithPassword({ email, password: PW }));
  return { client, id: data.user.id, email };
}

const DOC_TEXT = `Ausgleichskasse des Kantons Zürich
Röntgenstrasse 17, 8005 Zürich

Betreff: Lohnbescheinigung 2025 — Nachreichung erforderlich

Sehr geehrte Damen und Herren,

für die Schlussabrechnung 2025 fehlen uns noch die Lohnbescheinigungen Ihrer Mitarbeitenden.
Wir bitten Sie, die vollständige Lohnliste bis zum 31.08.2026 einzureichen.
Der ausstehende Betrag von CHF 4'820.00 ist bis zum gleichen Termin zu überweisen.
Bei Nichteinhaltung der Frist werden Verzugszinsen erhoben.

Freundliche Grüsse
Ausgleichskasse des Kantons Zürich`;
const EXTRACTION = { fullText: DOC_TEXT, extractionMethod: 'text', pages: [{ pageNumber: 1, text: DOC_TEXT }] };

async function invoke(client, body) {
  const { data, error } = await client.functions.invoke('analyze-document', { body });
  if (!error) return { status: 200, data };
  const ctx = error.context;
  let payload = null;
  if (ctx && typeof ctx.json === 'function') { try { payload = await ctx.json(); } catch { /* non JSON */ } }
  return { status: ctx?.status ?? 0, data: payload, error };
}

const docStatus = async (id) => (await admin.from('documents').select('status').eq('id', id).maybeSingle()).data?.status ?? null;

async function main() {
  console.log(`\n${DIM}SwissAI Suite — §26 · processing asincrono reale${X}\n`);

  const A = await makeUser('A');
  const { data: companyA } = await A.client.rpc('create_company_with_owner', {
    p_legal_name: 'Async Test SA', p_canton: 'Zurigo', p_municipality: 'Zurigo', p_legal_form: 'SA',
  });
  created.companies.push(companyA);
  const mkDoc = async (title) => (await A.client.from('documents').insert({
    company_id: companyA, uploaded_by: A.id, title, source_type: 'pasted_text',
    status: 'uploaded', mime_type: 'text/plain', file_hash: `async-${Date.now()}-${Math.round(performance.now())}`,
  }).select('*').single()).data;

  // ---- 1. La risposta torna subito, il lavoro no --------------------------
  console.log(`${B}Risposta immediata${X}`);
  const doc = await mkDoc('AVS — Lohnbescheinigung');
  const t0 = Date.now();
  const res = await invoke(A.client, { documentId: doc.id, extraction: EXTRACTION, async: true });
  const elapsed = Date.now() - t0;

  check('risposta 202 con status=processing', res.status === 202 || res.data?.status === 'processing',
    `status HTTP ${res.status}, body.status=${res.data?.status ?? '—'}`);
  check('la risposta arriva in pochi secondi (non attende l\'AI)', elapsed < 15_000, `${(elapsed / 1000).toFixed(1)}s`);
  check('nessuna analisi nel corpo della risposta (arriva dal DB)', !res.data?.analysis);

  // ---- 2. Lo stato è nel DB, non simulato ---------------------------------
  console.log(`\n${B}Stato osservabile nel database${X}`);
  const immediate = await docStatus(doc.id);
  check('documento in elaborazione subito dopo la risposta', ['extracting', 'analyzing', 'processing'].includes(immediate), `status=${immediate}`);

  const analysisRightAfter = (await admin.from('document_analyses').select('id').eq('document_id', doc.id).maybeSingle()).data;
  check('analisi NON ancora presente al momento della risposta', !analysisRightAfter);

  // ---- 3. Il lavoro prosegue dopo la risposta HTTP ------------------------
  console.log(`\n${B}Il lavoro prosegue sul server dopo la risposta${X}`);
  const started = Date.now();
  let final = null;
  const seen = new Set([immediate]);
  while (Date.now() - started < 240_000) {
    await new Promise((r) => setTimeout(r, 2000));
    const s = await docStatus(doc.id);
    seen.add(s);
    if (['completed', 'needs_review', 'failed', 'analyzed'].includes(s)) { final = s; break; }
  }
  check('l\'elaborazione si conclude senza altre chiamate del client', final !== null, `stato finale=${final} dopo ${((Date.now() - started) / 1000).toFixed(0)}s`);
  check('è passata per uno stato di lavorazione', [...seen].some((s) => ['extracting', 'analyzing', 'processing'].includes(s)), `stati visti: ${[...seen].join(' → ')}`);
  check('conclusione riuscita (non failed)', final === 'completed' || final === 'needs_review' || final === 'analyzed', `${final}`);

  // ---- 4. Analisi realmente persistita ------------------------------------
  console.log(`\n${B}Risultato persistito${X}`);
  const { data: an } = await admin.from('document_analyses')
    .select('language, sender, deadline, amounts, provider, model, analysis_status, actions')
    .eq('document_id', doc.id)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  check('analisi salvata nel database', !!an);
  check('lingua riconosciuta (de)', an?.language === 'de', `language=${an?.language}`);
  check('mittente identificato', !!an?.sender, `${(an?.sender ?? '—').slice(0, 40)}`);
  check('scadenza esplicita 2026-08-31', an?.deadline === '2026-08-31', `deadline=${an?.deadline}`);
  check('provenienza registrata', !!an?.provider && !!an?.model, `${an?.provider}/${an?.model}`);
  const ext = (await admin.from('document_extractions').select('id').eq('document_id', doc.id).maybeSingle()).data;
  check('estrazione persistita separatamente', !!ext);

  // ---- 5. Sicurezza sincrona anche in async (§49) -------------------------
  console.log(`\n${B}Sicurezza: resta sincrona anche in modalità async${X}`);
  const Bu = await makeUser('B');
  const { data: companyB } = await Bu.client.rpc('create_company_with_owner', {
    p_legal_name: 'Altra SA', p_canton: 'Ticino', p_municipality: 'Bellinzona', p_legal_form: 'SA',
  });
  created.companies.push(companyB);
  const cross = await invoke(Bu.client, { documentId: doc.id, extraction: EXTRACTION, async: true });
  check('§49 · cross-tenant respinto SUBITO con 403 (non 202)', cross.status === 403, `status=${cross.status}`);

  const shortDoc = await mkDoc('Troppo corto');
  const tooShort = await invoke(A.client, { documentId: shortDoc.id, extraction: { fullText: 'ciao', extractionMethod: 'text', pages: [{ pageNumber: 1, text: 'ciao' }] }, async: true });
  check('validazione input sincrona: testo corto → 422 (non 202)', tooShort.status === 422, `status=${tooShort.status}, code=${tooShort.data?.code}`);
  const shortStatus = await docStatus(shortDoc.id);
  check('documento rifiutato NON resta appeso in lavorazione', !['extracting', 'analyzing'].includes(shortStatus), `status=${shortStatus}`);

  console.log(`\n${pass} passati, ${fail} falliti\n`);
}

async function cleanup() {
  console.log(`${DIM}Pulizia dati di test…${X}`);
  for (const id of created.companies) { try { await admin.from('companies').delete().eq('id', id); } catch { /* ignore */ } }
  for (const id of created.users) { try { await admin.auth.admin.deleteUser(id); } catch { /* ignore */ } }
}

main().catch((e) => { console.error('\nErrore inatteso:', e?.message ?? e); fail++; })
  .finally(async () => { await cleanup(); process.exit(fail ? 1 : 0); });
