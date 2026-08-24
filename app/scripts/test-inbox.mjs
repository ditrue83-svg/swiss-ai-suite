// ============================================================================
// AI-Swisse — Test d'integrazione INBOX sul database reale.
//
//   npm run test:inbox
//
// Richiede: migrazioni 0013 E 0014 applicate, e `.env.test` valorizzato
// (SUPABASE_URL + SUPABASE_ANON_KEY + SUPABASE_SERVICE_ROLE_KEY).
//
// Non tocca provider esterni, non spende crediti AI, non chiama Edge Function:
// verifica i PERMESSI VERI del database, che sono l'unica cosa che separa i
// dati di un'azienda da quelli di un'altra. Le regole scritte in una migrazione
// valgono quanto la prova che siano davvero in vigore — è la lezione della
// 0010, dove l'immutabilità era un'affermazione del README finché non è stata
// messa alla prova.
//
// Quattro blocchi:
//   1. ISOLAMENTO — l'azienda A non vede e non tocca nulla di B.
//   2. SEGRETI — il client autenticato non raggiunge i token in nessun modo.
//   3. PERMESSI DI COLONNA — dal client si può cambiare solo lo stato umano.
//   4. VINCOLI — l'idempotenza è imposta dal database, non dal codice.
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
const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
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
  const email = `inbox+${tag}.${Date.now()}@example.com`;
  const data = await withRetry('createUser', () => admin.auth.admin.createUser({
    email, password: PW, email_confirm: true, user_metadata: { first_name: 'Test', last_name: tag },
  }));
  created.users.push(data.user.id);
  const client = anonClient();
  await withRetry('signIn', () => client.auth.signInWithPassword({ email, password: PW }));
  return { client, id: data.user.id, email };
}

async function makeCompany(user, name) {
  const { data, error } = await user.client.rpc('create_company_with_owner', { p_legal_name: name });
  if (error) throw new Error(`create_company_with_owner: ${error.message}`);
  created.companies.push(data);
  return data;
}

async function addMember(companyId, userId, role) {
  const { error } = await admin.from('company_members').insert({ company_id: companyId, user_id: userId, role });
  if (error) throw new Error(`addMember: ${error.message}`);
}

/** Connessione + messaggio + allegato, scritti con service role come farebbe la sync. */
async function seedInbox(companyId, ownerId, suffix) {
  const { data: connection, error: connErr } = await admin.from('email_connections').insert({
    company_id: companyId,
    connected_by: ownerId,
    provider: 'google',
    provider_account_id: `acct-${suffix}`,
    email_address: `casella-${suffix}@example.test`,
    status: 'active',
    scopes: ['https://www.googleapis.com/auth/gmail.readonly'],
    sync_cursor: 'history-1',
  }).select('id').single();
  if (connErr) throw new Error(`seed connection: ${connErr.message}`);

  const { error: secretErr } = await admin.from('email_connection_secrets').insert({
    connection_id: connection.id,
    company_id: companyId,
    access_token_ct: '\\xdeadbeef',
    access_token_iv: '\\x0102030405060708090a0b0c',
  });
  if (secretErr) throw new Error(`seed secret: ${secretErr.message}`);

  const { data: message, error: msgErr } = await admin.from('email_messages').insert({
    company_id: companyId,
    connection_id: connection.id,
    provider_message_id: `msg-${suffix}`,
    provider_thread_id: `thread-${suffix}`,
    subject: `Rendiconto IVA ${suffix}`,
    sender_name: 'AFC',
    sender_email: 'noreply@estv.admin.ch',
    received_at: new Date().toISOString(),
    body_text: 'Testo della comunicazione.',
    body_preview: 'Testo della comunicazione.',
    has_attachments: true,
    attachment_count: 1,
    relevance: 'likely_actionable',
    attention_status: 'needs_attention',
    processing_status: 'done',
  }).select('id').single();
  if (msgErr) throw new Error(`seed message: ${msgErr.message}`);

  const { data: attachment, error: attErr } = await admin.from('email_attachments').insert({
    company_id: companyId,
    email_message_id: message.id,
    provider_attachment_id: `att-${suffix}`,
    filename: 'rendiconto.pdf',
    mime_type: 'application/pdf',
    declared_mime_type: 'application/pdf',
    size_bytes: 12345,
    import_status: 'pending',
  }).select('id').single();
  if (attErr) throw new Error(`seed attachment: ${attErr.message}`);

  const { data: document, error: docErr } = await admin.from('documents').insert({
    company_id: companyId,
    uploaded_by: null,
    title: `Documento da email ${suffix}`,
    source_type: 'email',
    status: 'uploaded',
    file_hash: `hash-${suffix}`,
  }).select('id').single();
  if (docErr) throw new Error(`seed document: ${docErr.message}`);

  const { error: linkErr } = await admin.from('email_message_documents').insert({
    company_id: companyId,
    email_message_id: message.id,
    document_id: document.id,
    relation: 'attachment',
    attachment_id: attachment.id,
  });
  if (linkErr) throw new Error(`seed link: ${linkErr.message}`);

  const { error: runErr } = await admin.from('email_sync_runs').insert({
    company_id: companyId,
    connection_id: connection.id,
    sync_type: 'initial',
    status: 'ok',
    triggered_by: 'test',
  });
  if (runErr) throw new Error(`seed sync run: ${runErr.message}`);

  return { connectionId: connection.id, messageId: message.id, attachmentId: attachment.id, documentId: document.id };
}

/**
 * Pulizia dei dati di test.
 *
 * ⚠️ La versione precedente scriveva `await admin.from('companies').delete()` e
 * NON guardava l'esito: supabase-js non solleva, restituisce `{ error }`. Una
 * cancellazione fallita passava quindi in silenzio, e il 2026-07-26 due aziende
 * di test («Alfa Test», «Beta Test») sono rimaste nel database di PRODUZIONE
 * con le loro connessioni e i loro messaggi finti — scoperte solo perché la
 * diagnostica dell'Inbox le ha mostrate accanto a quelle vere.
 *
 * Un test che sporca il database e non se ne accorge è peggio di un test che
 * non pulisce affatto: chi lo esegue crede che non abbia lasciato nulla.
 * Adesso l'esito viene verificato e, se qualcosa sopravvive, lo si DICHIARA.
 */
async function cleanup() {
  const rimasti = [];
  for (const id of created.companies) {
    const { error } = await admin.from('companies').delete().eq('id', id);
    if (error) { rimasti.push(`${id} (${error.message})`); continue; }
    const { data } = await admin.from('companies').select('id').eq('id', id).maybeSingle();
    if (data) rimasti.push(`${id} (ancora presente dopo la delete)`);
  }
  for (const id of created.users) await admin.auth.admin.deleteUser(id).catch(() => {});

  if (rimasti.length) {
    fail++;
    console.log(`\n  ${R}✗ PULIZIA INCOMPLETA — dati di test rimasti nel database:${X}`);
    for (const r of rimasti) console.log(`     ${DIM}${r}${X}`);
    console.log(`     ${DIM}Vanno rimossi a mano: sono aziende con nome «Alfa Test …» / «Beta Test …».${X}`);
  }
}

// ---------------------------------------------------------------------------
async function main() {
  console.log(`${B}Inbox — permessi reali del database${X}`);

  // La migrazione c'è? Se manca si dice CHIARAMENTE cosa fare, invece di far
  // fallire venti asserzioni con errori incomprensibili.
  const { error: schemaErr } = await admin.from('email_connections').select('id').limit(1);
  if (schemaErr) {
    console.error(`\n${R}Le migrazioni dell'Inbox non risultano applicate su questo progetto.${X}`);
    console.error(`${DIM}  ${schemaErr.message}${X}`);
    console.error('  Applica 0013_inbox.sql e 0014_inbox_grants.sql dal SQL editor, poi riesegui.\n');
    process.exit(2);
  }

  const alice = await makeUser('alice');
  const bob = await makeUser('bob');
  const carla = await makeUser('carla');

  const companyA = await makeCompany(alice, `Alfa Test ${Date.now()}`);
  const companyB = await makeCompany(bob, `Beta Test ${Date.now()}`);
  await addMember(companyA, carla.id, 'member');       // Carla è membro semplice di A

  const seedA = await seedInbox(companyA, alice.id, 'a');
  const seedB = await seedInbox(companyB, bob.id, 'b');

  // =========================================================================
  section('1 · Isolamento fra aziende (§2.2/§94)');
  // =========================================================================
  {
    const { data } = await alice.client.from('email_connections').select('id, email_address');
    check('Alice vede solo le connessioni della propria azienda',
      (data ?? []).length === 1 && data[0].id === seedA.connectionId,
      `viste ${(data ?? []).length}`);
  }
  {
    const { data } = await alice.client.from('email_connections').select('id').eq('id', seedB.connectionId);
    check('Alice NON vede la connessione di Beta', (data ?? []).length === 0);
  }
  {
    const { data } = await alice.client.from('email_messages').select('id').eq('id', seedB.messageId);
    check('Alice NON legge i messaggi di Beta', (data ?? []).length === 0);
  }
  {
    const { data } = await alice.client.from('email_attachments').select('id').eq('id', seedB.attachmentId);
    check('Alice NON legge gli allegati di Beta', (data ?? []).length === 0);
  }
  {
    const { data } = await alice.client.from('email_message_documents').select('id').eq('email_message_id', seedB.messageId);
    check('Alice NON legge le relazioni email/documento di Beta', (data ?? []).length === 0);
  }
  {
    const { data } = await alice.client.from('email_sync_runs').select('id').eq('connection_id', seedB.connectionId);
    check('Alice NON legge il registro di sincronizzazione di Beta', (data ?? []).length === 0);
  }
  {
    // Il tentativo più diretto: modificare lo stato di un messaggio altrui.
    const { data, error } = await alice.client.from('email_messages')
      .update({ seen_at: new Date().toISOString() }).eq('id', seedB.messageId).select('id');
    check('Alice NON può modificare un messaggio di Beta',
      (data ?? []).length === 0,
      error ? `errore: ${error.message}` : `righe toccate: ${(data ?? []).length}`);
  }
  {
    const { data } = await bob.client.from('email_messages').select('id');
    check('Bob vede solo i propri messaggi', (data ?? []).length === 1 && data[0].id === seedB.messageId);
  }

  // =========================================================================
  section('2 · I segreti sono irraggiungibili dal client (§18)');
  // =========================================================================
  for (const [name, user] of [['Alice (owner)', alice], ['Carla (member)', carla]]) {
    const { data, error } = await user.client.from('email_connection_secrets').select('*');
    check(`${name} NON può leggere email_connection_secrets`,
      !!error || (data ?? []).length === 0,
      error ? `respinto: ${error.code ?? error.message}` : `righe restituite: ${(data ?? []).length}`);
  }
  {
    const { data, error } = await alice.client.from('email_connection_secrets')
      .select('access_token_ct').eq('connection_id', seedA.connectionId);
    check('Nemmeno indicando la PROPRIA connessione si ottengono i token',
      !!error || (data ?? []).length === 0);
  }
  {
    const { data, error } = await alice.client.from('email_oauth_states').select('*');
    check('email_oauth_states non è leggibile dal client', !!error || (data ?? []).length === 0);
  }
  {
    const { data, error } = await alice.client.from('email_webhook_events').select('*');
    check('email_webhook_events non è leggibile dal client', !!error || (data ?? []).length === 0);
  }
  {
    const { error } = await alice.client.from('email_connection_secrets').insert({
      connection_id: seedA.connectionId, company_id: companyA, access_token_ct: '\\xff',
    });
    check('Il client non può nemmeno SCRIVERE nei segreti', !!error, error ? '' : 'insert riuscito!');
  }

  // =========================================================================
  section('3 · Permessi di colonna: solo lo stato umano (§13/§36/§37)');
  // =========================================================================
  {
    const { error } = await alice.client.from('email_messages')
      .update({ seen_at: new Date().toISOString() }).eq('id', seedA.messageId);
    check('Un membro può segnare un messaggio come visto', !error, error?.message);
  }
  {
    const { error } = await alice.client.from('email_messages')
      .update({ subject: 'Oggetto riscritto' }).eq('id', seedA.messageId);
    check('Un membro NON può riscrivere l’oggetto del messaggio', !!error, error ? '' : 'update riuscito!');
  }
  {
    const { error } = await alice.client.from('email_messages')
      .update({ body_text: 'Testo sostituito' }).eq('id', seedA.messageId);
    check('Un membro NON può riscrivere il corpo del messaggio', !!error, error ? '' : 'update riuscito!');
  }
  {
    const { error } = await alice.client.from('email_messages')
      .update({ relevance: 'clearly_irrelevant' }).eq('id', seedA.messageId);
    check('Un membro NON può riscrivere la classificazione', !!error, error ? '' : 'update riuscito!');
  }
  {
    const { error } = await alice.client.from('email_messages')
      .update({ attention_status: 'handled' }).eq('id', seedA.messageId);
    check('Un membro può mettere via un messaggio', !error, error?.message);
    const { data } = await alice.client.from('email_messages')
      .select('attention_status, handled_at, handled_by').eq('id', seedA.messageId).maybeSingle();
    check('Il database registra CHI e QUANDO ha messo via',
      data?.attention_status === 'handled' && !!data?.handled_at && data?.handled_by === alice.id,
      JSON.stringify(data));
  }
  {
    // Ripristino: lo stato lo RICALCOLA il database dalla classificazione, e il
    // valore inviato dal client viene ignorato.
    //
    // ⚠️⚠️ IL VALORE INVIATO DEVE ESSERE QUELLO SBAGLIATO, o l'asserzione non
    // prova niente. Fino al 2026-08-24 questo caso mandava `to_verify` e
    // pretendeva `needs_attention`: i due differivano, quindi «il valore
    // inviato è stato ignorato» era dimostrabile. Con la 0043 (A2)
    // `likely_actionable` porta a `to_verify`, cioè PROPRIO al valore che il
    // client manda — e il caso sarebbe rimasto verde anche se il trigger
    // avesse smesso di ricalcolare, accettando l'invio del client.
    //
    // Perciò ora si manda `informational`, che il ricalcolo NON può produrre da
    // `likely_actionable`. Se un giorno il trigger accettasse il valore del
    // client, qui si leggerebbe `informational` e questo caso diventerebbe
    // rosso — che è il suo mestiere.
    const { error } = await alice.client.from('email_messages')
      .update({ attention_status: 'informational' }).eq('id', seedA.messageId);
    const { data } = await alice.client.from('email_messages')
      .select('attention_status, handled_at').eq('id', seedA.messageId).maybeSingle();
    check('Il ripristino ricalcola lo stato dalla classificazione, ignorando il valore inviato',
      !error && data?.attention_status === 'to_verify' && data?.handled_at === null,
      `${error?.message ?? ''} stato=${data?.attention_status}`);
  }
  {
    const { error } = await alice.client.from('email_messages')
      .update({ attention_status: 'informational' }).eq('id', seedA.messageId);
    check('Un membro NON può spostare a mano un messaggio in un’altra categoria',
      !!error, error ? '' : 'update riuscito!');
  }
  {
    const { error } = await alice.client.from('email_connections')
      .update({ sync_enabled: false }).eq('id', seedA.connectionId);
    check('Il client NON può modificare la connessione', !!error, error ? '' : 'update riuscito!');
  }
  {
    const { error } = await alice.client.from('email_connections').insert({
      company_id: companyA, provider: 'google', provider_account_id: 'x', email_address: 'x@example.test',
    });
    check('Il client NON può creare una connessione', !!error, error ? '' : 'insert riuscito!');
  }
  {
    const { error } = await alice.client.from('email_connections').delete().eq('id', seedA.connectionId);
    const { data } = await admin.from('email_connections').select('id').eq('id', seedA.connectionId);
    check('Il client NON può cancellare una connessione',
      (data ?? []).length === 1, error ? '' : 'delete riuscita!');
  }
  {
    // Con i permessi di COLONNA, `select('*')` chiede anche ciò che non è
    // concesso e viene respinto dal database. È la prova che la restrizione è
    // reale: prima della 0014 questa riga restituiva tutte le 25 colonne,
    // cursore di sincronizzazione compreso.
    const { error } = await alice.client.from('email_connections').select('*').eq('id', seedA.connectionId);
    check('`select(*)` sulle connessioni è RESPINTO: le colonne operative non sono concesse',
      !!error, error ? '' : 'ha restituito le colonne!');
  }
  {
    const { data, error } = await alice.client.from('email_connections')
      .select('id, email_address, status, last_successful_sync_at').eq('id', seedA.connectionId).maybeSingle();
    check('Le colonne che servono all’interfaccia restano leggibili',
      !error && data?.id === seedA.connectionId, error?.message);
  }
  {
    const { error } = await alice.client.from('email_connections')
      .select('id, sync_cursor').eq('id', seedA.connectionId);
    check('Chiedere esplicitamente il cursore di sincronizzazione è respinto',
      !!error, error ? '' : 'restituito!');
  }
  {
    const { error } = await alice.client.from('email_attachments')
      .update({ import_status: 'imported' }).eq('id', seedA.attachmentId);
    check('Un membro NON può modificare lo stato di importazione di un allegato', !!error);
  }

  {
    // La causa radice del difetto riparato dalla 0014, provata direttamente:
    // su Supabase ogni tabella nuova di `public` nasce con i permessi di
    // TABELLA completi, e un `grant select (colonne)` li AGGIUNGE invece di
    // restringerli. Senza il `revoke all` che li precede, tutto il resto di
    // questa sezione passerebbe silenziosamente.
    const { error: writeErr } = await alice.client.from('email_messages')
      .update({ source_fingerprint: 'manomesso' }).eq('id', seedA.messageId);
    check('Nemmeno l’impronta della fonte è riscrivibile dal client',
      !!writeErr, writeErr ? '' : 'update riuscito!');
  }

  // =========================================================================
  section('4 · Ruoli: il registro tecnico è per chi amministra (§50)');
  // =========================================================================
  {
    const { data } = await alice.client.from('email_sync_runs').select('id');
    check('L’owner vede il registro di sincronizzazione della propria azienda', (data ?? []).length === 1);
  }
  {
    const { data } = await carla.client.from('email_sync_runs').select('id');
    check('Un membro semplice NON vede il registro tecnico', (data ?? []).length === 0);
  }
  {
    const { data } = await carla.client.from('email_messages').select('id');
    check('Un membro semplice vede comunque la posta aziendale', (data ?? []).length === 1);
  }
  {
    const { data } = await carla.client.from('email_audit_log').select('id');
    check('Un membro semplice NON vede il registro delle azioni', (data ?? []).length === 0);
  }

  // =========================================================================
  section('5 · Idempotenza imposta dal database (§26/§97/§124)');
  // =========================================================================
  {
    const { error } = await admin.from('email_messages').insert({
      company_id: companyA,
      connection_id: seedA.connectionId,
      provider_message_id: 'msg-a',                       // stesso identificativo
      received_at: new Date().toISOString(),
    });
    check('Lo stesso messaggio del provider non può essere inserito due volte',
      error?.code === '23505', error ? `codice ${error.code}` : 'insert riuscito!');
  }
  {
    const { error } = await admin.from('email_attachments').insert({
      company_id: companyA, email_message_id: seedA.messageId, provider_attachment_id: 'att-a',
    });
    check('Lo stesso allegato non può essere registrato due volte',
      error?.code === '23505', error ? `codice ${error.code}` : 'insert riuscito!');
  }
  {
    const { data: doc } = await admin.from('documents').insert({
      company_id: companyA, title: 'Corpo email', source_type: 'email', status: 'uploaded',
    }).select('id').single();
    const first = await admin.from('email_message_documents').insert({
      company_id: companyA, email_message_id: seedA.messageId, document_id: doc.id, relation: 'body',
    });
    const { data: doc2 } = await admin.from('documents').insert({
      company_id: companyA, title: 'Altro corpo', source_type: 'email', status: 'uploaded',
    }).select('id').single();
    const second = await admin.from('email_message_documents').insert({
      company_id: companyA, email_message_id: seedA.messageId, document_id: doc2.id, relation: 'body',
    });
    check('Un messaggio non può avere due documenti «corpo»',
      !first.error && second.error?.code === '23505',
      `primo=${first.error?.message ?? 'ok'} secondo=${second.error?.code ?? 'riuscito!'}`);
  }
  {
    const { error } = await admin.from('email_message_documents').insert({
      company_id: companyA, email_message_id: seedA.messageId, document_id: seedA.documentId,
      relation: 'attachment', attachment_id: seedA.attachmentId,
    });
    check('Lo stesso allegato non può generare due collegamenti',
      error?.code === '23505', error ? `codice ${error.code}` : 'insert riuscito!');
  }
  {
    const { error } = await admin.from('email_message_documents').insert({
      company_id: companyA, email_message_id: seedA.messageId, document_id: seedA.documentId,
      relation: 'body', attachment_id: seedA.attachmentId,       // forma incoerente
    });
    check('Una relazione «corpo» con un allegato viene rifiutata dal vincolo di forma',
      !!error, error ? '' : 'insert riuscito!');
  }
  {
    const { error } = await admin.from('email_connections').insert({
      company_id: companyA, provider: 'google', provider_account_id: 'acct-a',
      email_address: 'altro@example.test',
    });
    check('Lo stesso account provider non può essere collegato due volte alla stessa azienda',
      error?.code === '23505', error ? `codice ${error.code}` : 'insert riuscito!');
  }
  {
    // §74 — lo stesso account su DUE aziende diverse resta possibile: è il caso
    // della fiduciaria, e vietarlo qui deciderebbe un modello commerciale.
    const { error } = await admin.from('email_connections').insert({
      company_id: companyB, provider: 'google', provider_account_id: 'acct-a',
      email_address: 'casella-a@example.test',
    });
    check('Lo stesso account può essere collegato a due AZIENDE diverse (caso fiduciaria)',
      !error, error?.message);
  }
  {
    const { error } = await admin.from('email_webhook_events').insert({
      provider: 'google', connection_id: seedA.connectionId, event_fingerprint: 'fp-1',
    });
    const dup = await admin.from('email_webhook_events').insert({
      provider: 'google', connection_id: seedA.connectionId, event_fingerprint: 'fp-1',
    });
    check('Un evento webhook duplicato viene respinto dal vincolo unico',
      !error && dup.error?.code === '23505',
      `primo=${error?.message ?? 'ok'} duplicato=${dup.error?.code ?? 'riuscito!'}`);
  }

  // =========================================================================
  section('6 · Quota AI di sistema (§58)');
  // =========================================================================
  {
    const { data, error } = await admin.rpc('try_consume_ai_quota_system', {
      p_company_id: companyA, p_kind: 'inbox_classification', p_limit: 2,
    });
    check('La quota di sistema prenota uno slot senza utente', !error && !!data, error?.message);
    const second = await admin.rpc('try_consume_ai_quota_system', {
      p_company_id: companyA, p_kind: 'inbox_classification', p_limit: 2,
    });
    const third = await admin.rpc('try_consume_ai_quota_system', {
      p_company_id: companyA, p_kind: 'inbox_classification', p_limit: 2,
    });
    check('Oltre il limite la quota restituisce NULL invece di lasciar passare',
      !second.error && third.data === null,
      `secondo=${second.data ? 'ok' : second.error?.message} terzo=${third.data}`);
    if (data) {
      const { error: finErr } = await admin.rpc('finalize_ai_request_system', { p_id: data, p_status: 'ok' });
      check('La riga di sistema si completa con l’esito', !finErr, finErr?.message);
    }
  }
  {
    const { error } = await alice.client.rpc('try_consume_ai_quota_system', {
      p_company_id: companyA, p_kind: 'inbox_classification', p_limit: 10,
    });
    check('Un client autenticato NON può eseguire la quota di sistema', !!error, error ? '' : 'eseguita!');
  }
  {
    const { data } = await alice.client.from('ai_request_log').select('kind').eq('company_id', companyA);
    const kinds = new Set((data ?? []).map((r) => r.kind));
    check('Il consumo AI dell’Inbox è tracciato con un tipo proprio nel log esistente',
      kinds.has('inbox_classification'), `tipi: ${[...kinds].join(', ') || 'nessuno'}`);
  }

  // =========================================================================
  section('7 · Provenienza dei documenti creati dalla posta (§60/§80)');
  // =========================================================================
  {
    const { data } = await alice.client.from('documents').select('id, source_type, uploaded_by')
      .eq('id', seedA.documentId).maybeSingle();
    check('Il documento nato da un’email è marcato come tale', data?.source_type === 'email');
    check('Nessun utente viene indicato come autore di un caricamento che non ha fatto',
      data?.uploaded_by === null, `uploaded_by=${data?.uploaded_by}`);
  }
  {
    const { data } = await alice.client.from('email_message_documents')
      .select('email_message_id, relation, attachment_id').eq('document_id', seedA.documentId);
    check('Dal documento si risale al messaggio e al ruolo che aveva',
      (data ?? []).length === 1 && data[0].email_message_id === seedA.messageId && data[0].relation === 'attachment');
  }

  // =========================================================================
  console.log(`\n${B}Riepilogo${X}  ${G}${pass} superati${X}${fail ? `  ${R}${fail} falliti${X}` : ''}`);
  if (!fail) console.log(`${DIM}  Nessun accesso trasversale, nessun segreto raggiungibile, nessun duplicato possibile.${X}`);
  console.log();
}

main()
  .catch((e) => { console.error(`\n${R}Errore:${X}`, e.message); fail++; })
  .finally(async () => {
    await cleanup();
    process.exit(fail ? 1 : 0);
  });
