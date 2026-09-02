// ============================================================================
// SwissAI Suite — Test d'integrazione Fase 1 (TEST 1–7).
// Gira contro un progetto Supabase REALE (migrazioni già applicate).
//
//   1) copia .env.test.example in .env.test e valorizza le chiavi
//   2) npm run test:phase1
//
// Usa la service_role SOLO per creare/cancellare utenti di test (server-side).
// Le verifiche RLS usano client "anon" autenticati come i singoli utenti,
// esattamente come farebbe il frontend.
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket; // Node < 22

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!URL || !ANON || !SERVICE) {
  console.error('Mancano SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.test');
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

const created = { users: [], companies: [], storagePaths: [] };
let pass = 0, fail = 0;
const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', X = '\x1b[0m';

function check(name, ok, detail = '') {
  if (ok) { pass++; console.log(`${G}✓${X} ${name}`); }
  else { fail++; console.log(`${R}✗ ${name}${X}${detail ? `\n   ${DIM}${detail}${X}` : ''}`); }
}

const PW = 'Test1234!';
async function makeUser(tag) {
  const email = `phase1+${tag}.${Date.now()}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PW, email_confirm: true,
    user_metadata: { first_name: 'Test', last_name: tag },
  });
  if (error) throw error;
  created.users.push(data.user.id);
  const client = anonClient();
  const { error: sErr } = await client.auth.signInWithPassword({ email, password: PW });
  if (sErr) throw sErr;
  return { client, id: data.user.id, email };
}

async function main() {
  console.log(`\n${DIM}SwissAI Suite — Fase 1 · test d'integrazione${X}\n`);

  // ----- TEST 1: registrazione → onboarding → azienda -----
  const A = await makeUser('A');
  const { data: companyIdA, error: rpcErr } = await A.client.rpc('create_company_with_owner', {
    p_legal_name: 'Azienda A SA', p_uid_che: 'CHE-111.111.111', p_canton: 'Ticino',
    p_municipality: 'Lugano', p_legal_form: 'SA', p_sector: 'ict', p_employee_count: 10, p_revenue_band: null,
  });
  if (companyIdA) created.companies.push(companyIdA);
  check('TEST 1 · onboarding crea azienda (RPC)', !rpcErr && !!companyIdA, rpcErr?.message);

  const { data: profileA } = await A.client.from('profiles').select('*').eq('id', A.id).maybeSingle();
  check('TEST 1 · profilo utente creato al signup (trigger)', !!profileA && profileA.last_name === 'A');
  const { data: memberA } = await A.client.from('company_members').select('role').eq('company_id', companyIdA).eq('user_id', A.id).maybeSingle();
  check('TEST 1 · membership owner creata', memberA?.role === 'owner');
  const { data: cprofA } = await A.client.from('company_profiles').select('*').eq('company_id', companyIdA).maybeSingle();
  check('TEST 1 · company_profile creato', !!cprofA && cprofA.sector === 'ict');

  // ----- TEST 2: documento → Storage + documents + analisi -----
  const { data: docA, error: docErr } = await A.client.from('documents').insert({
    company_id: companyIdA, uploaded_by: A.id, title: 'Lettera AVS', original_filename: 'avs.txt',
    mime_type: 'text/plain', source_type: 'upload', status: 'uploaded',
  }).select('*').single();
  check('TEST 2 · record documento inserito', !docErr && !!docA, docErr?.message);

  const pathA = `${companyIdA}/${docA.id}/avs.txt`;
  created.storagePaths.push(pathA);
  const { error: upErr } = await A.client.storage.from('company-documents').upload(pathA, Buffer.from('Contenuto della lettera AVS…'), { contentType: 'text/plain', upsert: true });
  check('TEST 2 · file caricato in Storage privato', !upErr, upErr?.message);
  await A.client.from('documents').update({ storage_path: pathA, file_size: 30 }).eq('id', docA.id);

  const { error: anErr, data: analysisA } = await A.client.from('document_analyses').insert({
    document_id: docA.id, company_id: companyIdA, language: 'it', document_type: 'richiesta_documenti',
    confidence: 'alta', summary: 'Richiesta documenti AVS', actions: [{ id: 0, text: 'Inviare documenti', done: false, sourceType: 'suggested', evidence: null }],
  }).select('*').single();
  check('TEST 2 · analisi persistita in document_analyses', !anErr && !!analysisA, anErr?.message);

  await A.client.from('documents').update({ status: 'analyzed' }).eq('id', docA.id);
  const { data: listDocsA } = await A.client.from('documents').select('id').eq('company_id', companyIdA);
  check('TEST 2 · documento visibile in archivio', (listDocsA ?? []).some((d) => d.id === docA.id));
  const { data: dl } = await A.client.storage.from('company-documents').download(pathA);
  check('TEST 2 · file scaricabile dal proprietario', !!dl);

  // ----- TEST 3: attività / scadenza -----
  const { data: taskA, error: tErr } = await A.client.from('tasks').insert({
    company_id: companyIdA, created_by: A.id, title: 'Inviare conteggio AVS', authority: 'Cassa AVS',
    due_date: '2026-08-15', priority: 'high', source: 'manual',
  }).select('*').single();
  check('TEST 3 · attività creata', !tErr && !!taskA, tErr?.message);
  // Ricarica con una sessione fresca (simula refresh/rientro).
  const A2 = anonClient();
  await A2.auth.signInWithPassword({ email: A.email, password: PW });
  const { data: tasksAfter } = await A2.from('tasks').select('id').eq('company_id', companyIdA);
  check('TEST 3 · attività ancora presente dopo re-login', (tasksAfter ?? []).some((t) => t.id === taskA.id));

  // ----- TEST 5: RLS cross-tenant (utente B non vede i dati di A) -----
  await A.client.auth.signOut();
  const A3 = anonClient();
  await A3.auth.signInWithPassword({ email: A.email, password: PW });
  const B = await makeUser('B');
  const { data: companyIdB } = await B.client.rpc('create_company_with_owner', { p_legal_name: 'Azienda B Sagl', p_canton: 'Zurigo' });
  if (companyIdB) created.companies.push(companyIdB);

  const deniedRead = async (table, id) => {
    const { data } = await B.client.from(table).select('id').eq('id', id);
    return (data ?? []).length === 0;
  };
  check('TEST 5 · B NON legge il documento di A', await deniedRead('documents', docA.id));
  check('TEST 5 · B NON legge l’analisi di A', await deniedRead('document_analyses', analysisA.id));
  check('TEST 5 · B NON legge il task di A', await deniedRead('tasks', taskA.id));
  check('TEST 5 · B NON legge la company di A', await deniedRead('companies', companyIdA));
  const { data: dlB, error: dlBerr } = await B.client.storage.from('company-documents').download(pathA);
  check('TEST 5 · B NON scarica il file di A (Storage RLS)', !dlB || !!dlBerr);
  const { error: insBErr } = await B.client.from('documents').insert({ company_id: companyIdA, uploaded_by: B.id, title: 'intrusione', source_type: 'upload' }).select();
  check('TEST 5 · B NON può inserire documenti nella company di A', !!insBErr);

  // ----- TEST 6: eliminazione documento (file + record + analisi cascade) -----
  const { error: rmFileErr } = await A3.storage.from('company-documents').remove([pathA]);
  const { error: rmDocErr } = await A3.from('documents').delete().eq('id', docA.id);
  check('TEST 6 · file + record eliminati', !rmFileErr && !rmDocErr, rmFileErr?.message || rmDocErr?.message);
  const { data: goneDoc } = await A3.from('documents').select('id').eq('id', docA.id);
  check('TEST 6 · record documento rimosso', (goneDoc ?? []).length === 0);
  const { data: goneAn } = await A3.from('document_analyses').select('id').eq('id', analysisA.id);
  check('TEST 6 · analisi collegata rimossa (cascade)', (goneAn ?? []).length === 0);
  const { data: goneFile } = await A3.storage.from('company-documents').download(pathA);
  check('TEST 6 · file non più scaricabile', !goneFile);

  // ----- TEST 7: nessuna sessione → nessun accesso ai dati protetti -----
  const anon = anonClient();
  const { data: anonDocs } = await anon.from('documents').select('id').eq('company_id', companyIdA);
  check('TEST 7 · client non autenticato non legge dati protetti', (anonDocs ?? []).length === 0);
}

async function cleanup() {
  console.log(`\n${DIM}Pulizia dati di test…${X}`);
  for (const path of created.storagePaths) { try { await admin.storage.from('company-documents').remove([path]); } catch { /* già rimosso */ } }
  for (const id of created.companies) { try { await admin.from('companies').delete().eq('id', id); } catch { /* ignore */ } }
  for (const id of created.users) { try { await admin.auth.admin.deleteUser(id); } catch { /* ignore */ } }
}

main()
  .catch((e) => { console.error(`${R}Errore fatale:${X}`, e?.message ?? e); fail++; })
  .finally(async () => {
    await cleanup();
    console.log(`\n${pass} passati, ${fail} falliti\n`);
    process.exit(fail ? 1 : 0);
  });
