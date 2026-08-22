// ============================================================================
// AI-Swisse — Company Assistant: test d'integrazione sul DATABASE REALE.
//   npm run test:assistant
//
// Richiede la migrazione 0027 applicata e `.env.test` valorizzato.
//
// ⚠️ QUI NON SI PROVA L'INTELLIGENZA: si provano le GARANZIE, e stanno tutte nel
// database. Un servizio ben educato non è una garanzia — è la lezione della
// 0014, dove i permessi dichiarati nei commenti non restringevano nulla e il
// difetto è emerso solo ESEGUENDO. Le nove garanzie:
//
//    1. ISOLAMENTO FRA AZIENDE — l'azienda B non vede nulla di A (§157).
//    2. PRIVATEZZA — un collega della STESSA azienda non legge la mia
//       conversazione, perché una domanda dice di chi la scrive.
//    3. REVOCA — tolta la membership, i thread non sono più apribili (§35).
//    4. NESSUNA RISPOSTA FABBRICATA — il client non può inserire un messaggio
//       con ruolo `assistant`, e quindi non può inventarsi fonti (§60).
//    5. IMMUTABILITÀ — un messaggio non si riscrive: una risposta storica è il
//       testo su cui una persona ha deciso (§93).
//    6. AZIENDA IMMUTABILE — un thread non cambia impresa dopo la creazione (§34).
//    7. QUOTA — il tetto per persona esiste davvero, e a un non membro la
//       funzione NEGA invece di rispondere zero (§141).
//    8. ELIMINAZIONE — sparisce la conversazione, NON spariscono i documenti (§95).
//    9. CASCATA — cancellata l'azienda non resta niente, tabella per tabella.
//
// ⚠️ LA PULIZIA CONTROLLA IL PROPRIO ESITO. supabase-js non solleva: restituisce
// `{ error }`. Ignorarlo ha già lasciato aziende di test in PRODUZIONE, due volte.
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

if (!globalThis.WebSocket) (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error('Mancano SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.test');
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);
const msg = (e: unknown) => (e as { message?: string } | null)?.message ?? '';
const code = (e: unknown) => (e as { code?: string } | null)?.code ?? '';

const PW = 'Test1234!';
const created: { users: string[]; companies: string[] } = { users: [], companies: [] };
const stamp = Date.now();

/** `admin.auth.admin.createUser` fallisce ~10% con «unrecognized JWT kid». */
async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      last = e;
      if (!/invalid JWT|unverifiable|unrecognized JWT kid/i.test(msg(e))) throw e;
      await new Promise((r) => setTimeout(r, 400 * (i + 1)));
    }
  }
  throw last;
}

async function makeUser(label: string) {
  const email = `assistant-${label}-${stamp}@swissai-suite.ch`;
  const { data: u, error: ue } = await withRetry(() =>
    admin.auth.admin.createUser({ email, password: PW, email_confirm: true }));
  if (ue || !u?.user) throw new Error(`utente ${label}: ${msg(ue)}`);
  created.users.push(u.user.id);
  const client = anonClient();
  const { error: se } = await client.auth.signInWithPassword({ email, password: PW });
  if (se) throw new Error(`login ${label}: ${msg(se)}`);
  return { userId: u.user.id, client, email };
}

async function makeTenant(label: string) {
  const u = await makeUser(label);
  const { data: cid, error: ce } = await u.client.rpc('create_company_with_owner', {
    p_legal_name: `Assistant ${label} ${stamp}`,
  });
  if (ce || !cid) throw new Error(`azienda ${label}: ${msg(ce)}`);
  created.companies.push(cid as string);
  return { ...u, companyId: cid as string };
}

/** Una conversazione con una domanda e una risposta scritta dal ruolo di servizio. */
async function seedThread(companyId: string, userId: string, title: string) {
  const { data: th, error: te } = await admin.from('assistant_threads')
    .insert({ company_id: companyId, created_by: userId, title, locale: 'it' })
    .select('id').single();
  if (te) throw new Error(`thread: ${msg(te)}`);
  const threadId = (th as { id: string }).id;

  const { error: qe } = await admin.from('assistant_messages').insert({
    thread_id: threadId, company_id: companyId, role: 'user',
    content: 'Quali fatture scadono questa settimana?', created_by: userId,
  });
  if (qe) throw new Error(`domanda: ${msg(qe)}`);

  const { data: ans, error: ae } = await admin.from('assistant_messages').insert({
    thread_id: threadId, company_id: companyId, role: 'assistant',
    content: 'Hai 2 fatture in scadenza.', answer_status: 'answered',
    model: 'claude-opus-5', prompt_version: 'test',
  }).select('id').single();
  if (ae) throw new Error(`risposta: ${msg(ae)}`);
  const messageId = (ans as { id: string }).id;

  const { error: ce } = await admin.from('assistant_citations').insert({
    message_id: messageId, company_id: companyId, citation_index: 0,
    source_type: 'finance_item', source_id: null, source_ids: [], group_size: 2,
    route: '/finanze', title: 'Voci finanziarie trovate',
  });
  if (ce) throw new Error(`citazione: ${msg(ce)}`);

  return { threadId, messageId };
}

async function main() {
  console.log(`${B}Company Assistant — test sul database reale${X}`);

  const A = await makeTenant('a');
  const Bt = await makeTenant('b');
  const seedA = await seedThread(A.companyId, A.userId, 'Conversazione di A');

  // -------------------------------------------------------------------------
  section('1 · Isolamento fra aziende (§157)');
  // -------------------------------------------------------------------------
  const mine = await A.client.from('assistant_threads').select('id').eq('id', seedA.threadId);
  check('A legge la propria conversazione', !mine.error && (mine.data?.length ?? 0) === 1, msg(mine.error));

  for (const [table, column] of [
    ['assistant_threads', 'id'], ['assistant_messages', 'thread_id'],
    ['assistant_runs', 'thread_id'], ['assistant_citations', 'message_id'],
  ] as const) {
    const value = column === 'message_id' ? seedA.messageId : seedA.threadId;
    const r = await Bt.client.from(table).select('id').eq(column, value);
    check(`B non vede ${table} di A`, !r.error && (r.data?.length ?? 0) === 0, msg(r.error));
  }

  const bWrites = await Bt.client.from('assistant_threads').insert({
    company_id: A.companyId, created_by: Bt.userId, title: 'Intrusione', locale: 'it',
  }).select('id');
  check('B non può creare una conversazione dentro l’azienda di A', !!bWrites.error, msg(bWrites.error));

  // -------------------------------------------------------------------------
  section('2 · Una domanda è di chi la scrive');
  // -------------------------------------------------------------------------
  // Un secondo membro della STESSA azienda: la conversazione resta privata.
  const colleague = await makeUser('collega');
  const { error: memberErr } = await admin.from('company_members')
    .insert({ company_id: A.companyId, user_id: colleague.userId, role: 'member' });
  check('il collega entra nell’azienda di A', !memberErr, msg(memberErr));

  const colleagueSeesCompany = await colleague.client.from('companies').select('id').eq('id', A.companyId);
  check('il collega vede l’azienda', !colleagueSeesCompany.error && (colleagueSeesCompany.data?.length ?? 0) === 1);

  const colleagueThreads = await colleague.client.from('assistant_threads').select('id').eq('id', seedA.threadId);
  check('ma NON vede la conversazione di un altro membro',
    !colleagueThreads.error && (colleagueThreads.data?.length ?? 0) === 0, msg(colleagueThreads.error));
  const colleagueMessages = await colleague.client.from('assistant_messages').select('id').eq('thread_id', seedA.threadId);
  check('e nemmeno i suoi messaggi', (colleagueMessages.data?.length ?? 0) === 0);
  const colleagueCitations = await colleague.client.from('assistant_citations').select('id').eq('message_id', seedA.messageId);
  check('e nemmeno le sue citazioni', (colleagueCitations.data?.length ?? 0) === 0);

  // -------------------------------------------------------------------------
  section('3 · Revoca dell’accesso (§35)');
  // -------------------------------------------------------------------------
  const revoked = await makeUser('revocato');
  await admin.from('company_members').insert({ company_id: A.companyId, user_id: revoked.userId, role: 'member' });
  const revokedSeed = await seedThread(A.companyId, revoked.userId, 'Conversazione del revocato');
  const before = await revoked.client.from('assistant_threads').select('id').eq('id', revokedSeed.threadId);
  check('finché è membro legge la propria conversazione', (before.data?.length ?? 0) === 1);

  await admin.from('company_members').delete().eq('company_id', A.companyId).eq('user_id', revoked.userId);
  const after = await revoked.client.from('assistant_threads').select('id').eq('id', revokedSeed.threadId);
  check('tolta la membership NON la legge più', (after.data?.length ?? 0) === 0, msg(after.error));
  const afterMsg = await revoked.client.from('assistant_messages').select('id').eq('thread_id', revokedSeed.threadId);
  check('né i messaggi', (afterMsg.data?.length ?? 0) === 0);
  const afterCit = await revoked.client.from('assistant_citations').select('id').eq('message_id', revokedSeed.messageId);
  check('né le citazioni', (afterCit.data?.length ?? 0) === 0);

  // -------------------------------------------------------------------------
  section('4 · Nessuna risposta fabbricata dal client (§60)');
  // -------------------------------------------------------------------------
  const fakeAnswer = await A.client.from('assistant_messages').insert({
    thread_id: seedA.threadId, company_id: A.companyId, role: 'assistant',
    content: 'Hai CHF 1’000’000 sul conto.', answer_status: 'answered',
  } as never).select('id');
  check('un client NON può inserire un messaggio con ruolo assistant', !!fakeAnswer.error, msg(fakeAnswer.error));

  const fakeCitation = await A.client.from('assistant_citations').insert({
    message_id: seedA.messageId, company_id: A.companyId, citation_index: 9,
    source_type: 'finance_item', source_id: null, source_ids: [], group_size: 1,
    route: '/finanze', title: 'Fonte inventata',
  } as never).select('id');
  check('un client NON può inserire una citazione', !!fakeCitation.error, msg(fakeCitation.error));

  const ownQuestion = await A.client.from('assistant_messages').insert({
    thread_id: seedA.threadId, company_id: A.companyId, role: 'user',
    content: 'E i contratti?', created_by: A.userId,
  }).select('id');
  check('ma può scrivere la PROPRIA domanda', !ownQuestion.error, msg(ownQuestion.error));

  const externalRoute = await admin.from('assistant_citations').insert({
    message_id: seedA.messageId, company_id: A.companyId, citation_index: 5,
    source_type: 'document', source_id: null, source_ids: [], group_size: 1,
    route: 'https://esempio.test/fuori', title: 'Fuori',
  }).select('id');
  check('§106 — nemmeno il ruolo di servizio può scrivere una rotta esterna',
    !!externalRoute.error, msg(externalRoute.error));

  // -------------------------------------------------------------------------
  section('5 · Una risposta storica non si riscrive (§93)');
  // -------------------------------------------------------------------------
  const edit = await A.client.from('assistant_messages')
    .update({ content: 'Testo cambiato' } as never).eq('id', seedA.messageId).select('id');
  check('un client non può modificare un messaggio', !!edit.error, msg(edit.error));
  const adminEdit = await admin.from('assistant_messages')
    .update({ content: 'Testo cambiato dal servizio' }).eq('id', seedA.messageId).select('id');
  check('nemmeno il ruolo di servizio: il guardiano solleva', !!adminEdit.error, msg(adminEdit.error));

  // -------------------------------------------------------------------------
  section('6 · Un thread non cambia azienda (§34)');
  // -------------------------------------------------------------------------
  const moved = await admin.from('assistant_threads')
    .update({ company_id: Bt.companyId }).eq('id', seedA.threadId).select('id');
  check('company_id è immutabile, anche per il ruolo di servizio', !!moved.error, msg(moved.error));
  const reauthored = await admin.from('assistant_threads')
    .update({ created_by: Bt.userId }).eq('id', seedA.threadId).select('id');
  check('created_by è immutabile', !!reauthored.error, msg(reauthored.error));

  const renamed = await A.client.from('assistant_threads')
    .update({ title: 'Rinominata' }).eq('id', seedA.threadId).select('title').maybeSingle();
  check('ma il titolo si può cambiare',
    !renamed.error && (renamed.data as { title?: string } | null)?.title === 'Rinominata', msg(renamed.error));

  // -------------------------------------------------------------------------
  section('7 · Quota per azienda e per persona (§141)');
  // -------------------------------------------------------------------------
  const notMember = await Bt.client.rpc('assistant_reserve_slot', { p_company_id: A.companyId });
  check('a un NON membro la funzione nega invece di rispondere zero',
    !!notMember.error && code(notMember.error) === '42501', `${code(notMember.error)} ${msg(notMember.error)}`);

  const first = await A.client.rpc('assistant_reserve_slot', {
    p_company_id: A.companyId, p_company_limit: 5, p_user_limit: 2,
  });
  check('la prima prenotazione riesce', !first.error && typeof first.data === 'string', msg(first.error));
  const second = await A.client.rpc('assistant_reserve_slot', {
    p_company_id: A.companyId, p_company_limit: 5, p_user_limit: 2,
  });
  check('anche la seconda', !second.error && typeof second.data === 'string');
  const third = await A.client.rpc('assistant_reserve_slot', {
    p_company_id: A.companyId, p_company_limit: 5, p_user_limit: 2,
  });
  check('la terza supera il tetto PER PERSONA e ritorna null',
    !third.error && third.data === null, `${msg(third.error)} ${JSON.stringify(third.data)}`);

  const purge = await A.client.rpc('assistant_purge_expired', { p_days: 180 } as never);
  check('la retention NON è invocabile da un utente', !!purge.error, msg(purge.error));

  // -------------------------------------------------------------------------
  section('8 · Eliminare una conversazione non tocca i dati aziendali (§95)');
  // -------------------------------------------------------------------------
  const { data: docRow } = await admin.from('documents')
    .insert({ company_id: A.companyId, title: 'Fattura da non perdere', source_type: 'upload', status: 'completed' })
    .select('id').single();
  const documentId = (docRow as { id: string }).id;

  const doomed = await seedThread(A.companyId, A.userId, 'Da eliminare');
  await admin.from('assistant_citations').insert({
    message_id: doomed.messageId, company_id: A.companyId, citation_index: 1,
    source_type: 'document', source_id: documentId, route: `/documenti/${documentId}`,
    title: 'Fattura da non perdere',
  });

  const del = await A.client.from('assistant_threads').delete().eq('id', doomed.threadId);
  check('l’utente può eliminare la propria conversazione', !del.error, msg(del.error));

  const goneMessages = await admin.from('assistant_messages').select('id').eq('thread_id', doomed.threadId);
  check('i messaggi se ne vanno in cascata', (goneMessages.data?.length ?? 0) === 0);
  const goneCitations = await admin.from('assistant_citations').select('id').eq('message_id', doomed.messageId);
  check('e le citazioni pure', (goneCitations.data?.length ?? 0) === 0);
  const docSurvives = await admin.from('documents').select('id').eq('id', documentId);
  check('⚠️ il DOCUMENTO citato resta dov’era', (docSurvives.data?.length ?? 0) === 1);

  // -------------------------------------------------------------------------
  section('9 · Cascata: cancellata l’azienda non resta niente');
  // -------------------------------------------------------------------------
  const doomedCompany = await makeTenant('cascata');
  const doomedSeed = await seedThread(doomedCompany.companyId, doomedCompany.userId, 'Cascata');
  await admin.from('assistant_runs').insert({
    thread_id: doomedSeed.threadId, company_id: doomedCompany.companyId, user_id: doomedCompany.userId,
    status: 'succeeded', model: 'claude-opus-5', prompt_version: 'test',
    tool_registry_version: 'test', retrieval_version: 'test', citation_strategy: 'application-v1',
  });

  const { error: delCompanyErr } = await admin.from('companies').delete().eq('id', doomedCompany.companyId);
  check('l’azienda si cancella (nessun trigger la blocca)', !delCompanyErr, msg(delCompanyErr));
  if (!delCompanyErr) {
    created.companies = created.companies.filter((c) => c !== doomedCompany.companyId);
  }
  for (const [table, column, value] of [
    ['assistant_threads', 'id', doomedSeed.threadId],
    ['assistant_messages', 'thread_id', doomedSeed.threadId],
    ['assistant_runs', 'thread_id', doomedSeed.threadId],
    ['assistant_citations', 'message_id', doomedSeed.messageId],
  ] as const) {
    const left = await admin.from(table).select('id').eq(column, value);
    check(`nessun residuo in ${table}`, (left.data?.length ?? 0) === 0);
  }

  // -------------------------------------------------------------------------
  section('La citazione di un insieme VUOTO (0036)');
  // -------------------------------------------------------------------------
  // ⚠️ La 0036 si autoverifica leggendo `pg_constraint`, cioè controlla che la
  // DDL sia atterrata. Che il `check` si COMPORTI come deve lo prova solo una
  // riga vera, e serve un messaggio vero a cui agganciarla: è questo il posto.
  // Trovato indagando l'instabilità di `eval:assistant`: la domanda «quali
  // automazioni stanno fallendo?» ha come risposta corretta «nessuna», e finché
  // un insieme vuoto non era citabile quella frase restava senza fonte.
  {
    const base = {
      message_id: seedA.messageId, company_id: A.companyId, citation_index: 90,
      source_type: 'workflow_definition' as const, route: '/automazioni',
      title: 'Automazioni con problemi',
    };

    const vuoto = await admin.from('assistant_citations')
      .insert({ ...base, source_id: null, source_ids: [], group_size: 0 });
    check('un gruppo VUOTO si può scrivere: «ho guardato e non c\'era niente»',
      !vuoto.error, msg(vuoto.error));

    // ⚠️ CONTROPROVA — il vincolo non è stato allentato, è stato PRECISATO.
    // Senza queste tre righe «ammette lo zero» e «non controlla più niente»
    // sarebbero indistinguibili.
    const senzaIds = await admin.from('assistant_citations')
      .insert({ ...base, citation_index: 91, source_id: null, source_ids: null, group_size: 0 });
    check('CONTROPROVA: un gruppo senza source_ids resta VIETATO',
      !!senzaIds.error, 'è passato: il vincolo non distingue più «vuoto» da «non so»');

    const misto = await admin.from('assistant_citations')
      .insert({ ...base, citation_index: 92, source_id: A.companyId, source_ids: [], group_size: 0 });
    check('CONTROPROVA: fonte singola e gruppo insieme restano VIETATI',
      !!misto.error, 'è passato: le due forme si sono confuse');

    const negativo = await admin.from('assistant_citations')
      .insert({ ...base, citation_index: 93, source_id: null, source_ids: [], group_size: -1 });
    check('CONTROPROVA: una dimensione NEGATIVA resta vietata',
      !!negativo.error, 'è passato: >= 0 non è stato scritto come si credeva');

    // E la riga scritta si rilegge per quello che è: zero, non nullo.
    const riletta = await admin.from('assistant_citations')
      .select('group_size, source_ids, source_id')
      .eq('message_id', seedA.messageId).eq('citation_index', 90).maybeSingle();
    const r = riletta.data as { group_size: number | null; source_ids: string[] | null; source_id: string | null } | null;
    check('rileggendola, la dimensione è ZERO e non NULL',
      r?.group_size === 0, `letto: ${JSON.stringify(r)}`);
    check('e l\'elenco degli identificativi è VUOTO, non assente (§ la differenza fra «non c\'era niente» e «non so»)',
      Array.isArray(r?.source_ids) && r?.source_ids.length === 0 && r?.source_id === null);

    await admin.from('assistant_citations').delete()
      .eq('message_id', seedA.messageId).gte('citation_index', 90);
  }

  await cleanup();
  console.log(`\n${B}Risultato${X}: ${G}${pass} superati${X}${fail ? `, ${R}${fail} falliti${X}` : ''}\n`);
  process.exit(fail ? 1 : 0);
}

/**
 * ⚠️ L'ORDINE NON È INDIFFERENTE: prima l'AZIENDA, poi l'utente. Al contrario,
 * la cancellazione dell'utente porta via a cascata la riga di `company_members`
 * e lascia un'azienda ORFANA — invisibile nell'app, perché la RLS filtra per
 * appartenenza, e quindi impossibile da notare.
 */
async function cleanup() {
  let clean = true;
  for (const id of created.companies) {
    const { error } = await admin.from('companies').delete().eq('id', id);
    if (error) { clean = false; console.log(`  ${R}pulizia azienda ${id}: ${msg(error)}${X}`); }
  }
  for (const id of created.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) { clean = false; console.log(`  ${R}pulizia utente ${id}: ${msg(error)}${X}`); }
  }
  check('la pulizia è riuscita: nessun residuo nel database', clean);
}

main().catch(async (e) => {
  console.error(`\n${R}Errore: ${msg(e) || String(e)} ${code(e)}${X}`);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
