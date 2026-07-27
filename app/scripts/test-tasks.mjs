// ============================================================================
// AI-Swisse — Attività (Work Hub): test d'integrazione sul DATABASE REALE.
//   npm run test:tasks
//
// Richiede la migrazione 0016 applicata e `.env.test` valorizzato.
//
// Non prova che il codice sia scritto bene: prova che le GARANZIE siano in
// vigore. Sono quattro, e tutte e quattro sono state scritte come regole del
// database proprio perché un servizio ben educato non è una garanzia:
//
//   1. ISOLAMENTO — l'azienda A non vede né tocca attività, checklist,
//      commenti o storico di B.
//   2. ASSEGNAZIONE — non si assegna lavoro a chi non è dell'azienda.
//   3. AUTORE — nessuno firma un commento a nome di un collega.
//   4. COMPLETAMENTO — chi ha completato e quando li scrive il server.
//
// Più una quinta cosa che non è una garanzia ma una promessa fatta a chi usa
// già il prodotto: le attività esistenti prima della 0016 continuano a
// funzionare senza essere toccate.
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

const created = { users: [], companies: [] };
let pass = 0, fail = 0;
const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title) => console.log(`\n${B}${title}${X}`);

const PW = 'Test1234!';
const isJwtTransient = (msg = '') => /invalid JWT|unverifiable|unrecognized JWT kid/i.test(msg);
async function withRetry(label, fn, tries = 5) {
  let last;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await fn();
    if (!error) return data;
    last = error;
    if (!isJwtTransient(error.message)) break;
    await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
  throw new Error(`${label}: ${last?.message ?? 'errore'}`);
}

async function makeUser(tag) {
  const email = `tasks+${tag}.${Date.now()}@example.com`;
  const data = await withRetry('createUser', () => admin.auth.admin.createUser({
    email, password: PW, email_confirm: true, user_metadata: { first_name: 'Prova', last_name: tag },
  }));
  created.users.push(data.user.id);
  return { id: data.user.id, email };
}

async function makeCompany(name, ownerId) {
  const { data, error } = await admin.from('companies')
    .insert({ legal_name: name, canton: 'Ticino' }).select('id').single();
  if (error) throw new Error(`company: ${error.message}`);
  created.companies.push(data.id);
  const { error: mErr } = await admin.from('company_members')
    .insert({ company_id: data.id, user_id: ownerId, role: 'owner' });
  if (mErr) throw new Error(`membership: ${mErr.message}`);
  return data.id;
}

async function signIn(email) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return client;
}

async function main() {
  console.log(`${B}AI-Swisse — Attività: test sul database reale${X}`);

  // ---- prerequisito: la 0016 è applicata? --------------------------------
  const { error: probe } = await admin.from('task_checklist_items').select('id').limit(1);
  if (probe && /does not exist|schema cache/i.test(probe.message ?? '')) {
    console.error(`\n${R}La migrazione 0016 non risulta applicata.${X}`);
    console.error(`${DIM}Applica supabase/migrations/0016_work_hub.sql dal SQL editor, poi riesegui.${X}\n`);
    process.exit(2);
  }

  const userA = await makeUser('a');
  const userB = await makeUser('b');
  const companyA = await makeCompany(`Alpha ${Date.now()}`, userA.id);
  const companyB = await makeCompany(`Beta ${Date.now()}`, userB.id);
  const clientA = await signIn(userA.email);
  const clientB = await signIn(userB.email);

  // ---- 1. Legacy: un'attività come quelle già esistenti -------------------
  section('1 · Le attività esistenti continuano a funzionare');
  const { data: legacy, error: legacyErr } = await admin.from('tasks').insert({
    company_id: companyA, created_by: userA.id, title: 'Attività legacy',
    status: 'open', priority: 'medium', source: 'manual',
  }).select('*').single();
  check('un\'attività senza assegnatario, checklist e commenti si crea come prima',
    !legacyErr && !!legacy, legacyErr?.message);
  check('i campi nuovi partono vuoti invece di ricevere valori inventati',
    !!legacy && legacy.assignee_user_id === null && legacy.completed_at === null && legacy.archived_at === null);

  const { data: listedLegacy, error: listErr } = await clientA.rpc('list_tasks', {
    p_company_id: companyA, p_view: 'todo',
  });
  check('compare nella nuova lista senza essere stata toccata',
    !listErr && (listedLegacy ?? []).some((r) => r.id === legacy?.id), listErr?.message);

  // ---- 2. Isolamento fra aziende -----------------------------------------
  section('2 · Isolamento fra aziende');
  const { data: taskB } = await admin.from('tasks').insert({
    company_id: companyB, created_by: userB.id, title: 'Riservata a Beta',
    status: 'open', priority: 'high', source: 'manual',
  }).select('*').single();

  const { data: crossList } = await clientA.rpc('list_tasks', { p_company_id: companyB, p_view: 'all' });
  check('A non vede le attività di B nemmeno chiedendole per id azienda',
    (crossList ?? []).length === 0, `righe viste: ${(crossList ?? []).length}`);

  const { data: crossRead } = await clientA.from('tasks').select('id').eq('id', taskB.id);
  check('A non legge l\'attività di B per id diretto', (crossRead ?? []).length === 0);

  const { error: crossWrite } = await clientA.from('tasks').update({ title: 'dirottata' }).eq('id', taskB.id);
  const { data: afterWrite } = await admin.from('tasks').select('title').eq('id', taskB.id).single();
  check('A non riscrive il titolo di un\'attività di B',
    afterWrite.title === 'Riservata a Beta', `titolo ora: ${afterWrite.title} · err=${crossWrite?.message ?? 'nessuno'}`);

  // checklist, commenti ed eventi di B
  await admin.from('task_checklist_items').insert({
    company_id: companyB, task_id: taskB.id, text: 'passo riservato', position: 0,
  });
  await admin.from('task_comments').insert({
    company_id: companyB, task_id: taskB.id, author_user_id: userB.id, body: 'commento riservato',
  });
  const { data: cl } = await clientA.from('task_checklist_items').select('id').eq('task_id', taskB.id);
  check('A non vede la checklist di B', (cl ?? []).length === 0);
  const { data: cm } = await clientA.from('task_comments').select('id').eq('task_id', taskB.id);
  check('A non vede i commenti di B', (cm ?? []).length === 0);
  const { data: ev } = await clientA.from('task_events').select('id').eq('task_id', taskB.id);
  check('A non vede lo storico di B', (ev ?? []).length === 0);

  // Il caso obliquo: A dichiara la PROPRIA azienda ma aggancia la voce a
  // un'attività di B. La policy RLS da sola lo lascerebbe passare — A è davvero
  // membro dell'azienda che dichiara — ed è il motivo per cui esiste il trigger
  // che confronta la company della voce con quella della sua attività.
  const { error: sneaky } = await clientA.from('task_checklist_items').insert({
    company_id: companyA, task_id: taskB.id, text: 'agganciata di traverso', position: 0,
  });
  check('A non aggancia una voce di checklist a un\'attività di B dichiarando la propria azienda',
    !!sneaky, 'inserimento accettato!');
  const { error: sneakyComment } = await clientA.from('task_comments').insert({
    company_id: companyA, task_id: taskB.id, author_user_id: userA.id, body: 'di traverso',
  });
  check('né un commento', !!sneakyComment, 'inserimento accettato!');

  // ---- 3. Assegnazione ----------------------------------------------------
  section('3 · Assegnazione: solo a chi è dell\'azienda');
  const { error: badAssign } = await clientA.from('tasks')
    .update({ assignee_user_id: userB.id }).eq('id', legacy.id);
  const { data: afterAssign } = await admin.from('tasks').select('assignee_user_id').eq('id', legacy.id).single();
  check('A NON può assegnare un\'attività a un utente di un\'altra azienda',
    afterAssign.assignee_user_id === null,
    `assegnatario: ${afterAssign.assignee_user_id} · err=${badAssign?.message ?? 'nessuno'}`);
  check('il rifiuto arriva con un codice riconoscibile, non con un errore generico',
    !!badAssign && /assignee_not_member|23514/.test(`${badAssign.message} ${badAssign.code}`),
    badAssign?.message);

  const { error: goodAssign } = await clientA.from('tasks')
    .update({ assignee_user_id: userA.id }).eq('id', legacy.id);
  check('assegnare a un membro della propria azienda funziona', !goodAssign, goodAssign?.message);

  // ---- 4. Autore dei commenti --------------------------------------------
  section('4 · L\'autore di un commento non si può falsificare');
  const { data: myTask } = await admin.from('tasks').insert({
    company_id: companyA, created_by: userA.id, title: 'Con commenti', status: 'open',
    priority: 'low', source: 'manual',
  }).select('*').single();

  const { data: forgedRow, error: forged } = await clientA.from('task_comments').insert({
    company_id: companyA, task_id: myTask.id, author_user_id: userB.id, body: 'non l\'ho scritto io',
  }).select('author_user_id').maybeSingle();
  check('A non può scrivere un commento firmandolo con l\'identità di B: il tentativo viene RIFIUTATO',
    !!forged, 'inserimento accettato — il rifiuto deve essere esplicito, non una correzione silenziosa');
  // Difesa in profondità: anche se un giorno il rifiuto saltasse, la firma
  // falsa non deve comunque poter finire nel database.
  check('e in nessun caso finisce nel database un commento firmato da un altro',
    !forgedRow || forgedRow.author_user_id === userA.id,
    `autore salvato: ${forgedRow?.author_user_id}`);

  const { data: mine, error: mineErr } = await clientA.from('task_comments').insert({
    company_id: companyA, task_id: myTask.id, author_user_id: userA.id, body: 'questo è mio',
  }).select('*').single();
  check('un commento firmato con la propria identità viene accettato', !mineErr && !!mine, mineErr?.message);

  // ---- 5. Completamento ---------------------------------------------------
  section('5 · Chi ha completato lo scrive il database');
  const fakeDate = '2020-01-01T00:00:00.000Z';
  await clientA.from('tasks').update({ status: 'completed' }).eq('id', myTask.id);
  const { data: done } = await admin.from('tasks')
    .select('completed_at, completed_by, status').eq('id', myTask.id).single();
  check('completando, `completed_by` è chi ha agito davvero', done.completed_by === userA.id,
    `atteso ${userA.id}, ottenuto ${done.completed_by}`);
  check('`completed_at` viene valorizzato dal server', !!done.completed_at);

  // Un client che prova a spacciare una data e un autore diversi.
  const { error: spoof } = await clientA.from('tasks')
    .update({ completed_at: fakeDate, completed_by: userB.id }).eq('id', myTask.id);
  const { data: afterSpoof } = await admin.from('tasks')
    .select('completed_at, completed_by').eq('id', myTask.id).single();
  check('una data di completamento inviata dal client viene ignorata',
    afterSpoof.completed_at !== fakeDate, `valore ora: ${afterSpoof.completed_at} · err=${spoof?.message ?? 'nessuno'}`);
  check('un autore di completamento inviato dal client viene ignorato',
    afterSpoof.completed_by === userA.id, `valore ora: ${afterSpoof.completed_by}`);

  // Riapertura
  await clientA.from('tasks').update({ status: 'open' }).eq('id', myTask.id);
  const { data: reopened } = await admin.from('tasks')
    .select('completed_at, completed_by').eq('id', myTask.id).single();
  check('riaprendo, il completamento smette di essere un fatto (campi svuotati)',
    reopened.completed_at === null && reopened.completed_by === null);

  // ---- 6. Storico ---------------------------------------------------------
  section('6 · Lo storico lo scrive il database, non il client');
  const { data: myEvents } = await clientA.from('task_events')
    .select('kind').eq('task_id', myTask.id).order('created_at', { ascending: true });
  const kinds = (myEvents ?? []).map((e) => e.kind);
  check('la creazione, il completamento e la riapertura sono registrati',
    kinds.includes('created') && kinds.includes('completed') && kinds.includes('reopened'),
    `eventi: ${kinds.join(', ')}`);
  check('il commento aggiunto compare nello storico', kinds.includes('comment_added'), `eventi: ${kinds.join(', ')}`);

  const { error: forgedEvent } = await clientA.from('task_events').insert({
    company_id: companyA, task_id: myTask.id, actor_user_id: userB.id, kind: 'completed', detail: {},
  });
  check('il client NON può inventare un evento nello storico', !!forgedEvent, 'inserimento accettato!');

  // ---- 7. Archiviazione ---------------------------------------------------
  section('7 · Archiviare invece di cancellare');
  await clientA.from('tasks').update({ archived_at: new Date().toISOString() }).eq('id', myTask.id);
  const { data: archived } = await admin.from('tasks')
    .select('archived_at, archived_by').eq('id', myTask.id).single();
  check('archiviando, `archived_by` è chi ha agito', archived.archived_by === userA.id);
  const { data: todoAfter } = await clientA.rpc('list_tasks', { p_company_id: companyA, p_view: 'todo' });
  check('l\'attività archiviata sparisce da «Da fare»',
    !(todoAfter ?? []).some((r) => r.id === myTask.id));
  const { data: archAfter } = await clientA.rpc('list_tasks', { p_company_id: companyA, p_view: 'archived' });
  check('ma resta consultabile fra le archiviate',
    (archAfter ?? []).some((r) => r.id === myTask.id));

  // ---- 8. Rubrica ---------------------------------------------------------
  section('8 · Rubrica dei membri');
  const { data: dirA, error: dirErr } = await clientA.rpc('company_member_directory', { p_company_id: companyA });
  check('A vede i membri della propria azienda', !dirErr && (dirA ?? []).length === 1, dirErr?.message);
  const { data: dirB } = await clientA.rpc('company_member_directory', { p_company_id: companyB });
  check('A NON vede i membri di un\'altra azienda', (dirB ?? []).length === 0,
    `righe: ${(dirB ?? []).length}`);

  await cleanup();
  console.log(`\n${B}Riepilogo${X}  ${G}${pass} superati${X}${fail ? `  ${R}${fail} falliti${X}` : ''}\n`);
  process.exit(fail ? 1 : 0);
}

async function cleanup() {
  console.log(`\n${DIM}Pulizia dati di test…${X}`);
  let incomplete = false;
  for (const id of created.companies) {
    const { error } = await admin.from('companies').delete().eq('id', id);
    if (error) { incomplete = true; console.error(`  azienda ${id}: ${error.message}`); }
  }
  for (const id of created.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) { incomplete = true; console.error(`  utente ${id}: ${error.message}`); }
  }
  // Una pulizia incompleta fa fallire il test: è già successo con l'Inbox che
  // due aziende di prova restassero nel database di produzione, viste solo
  // giorni dopo per caso.
  if (incomplete) {
    fail++;
    console.error(`${R}Pulizia incompleta: dati di test rimasti nel database.${X}`);
  }
}

main().catch(async (e) => {
  console.error(`\n${R}Errore:${X} ${e.message}`);
  await cleanup();
  process.exit(1);
});
