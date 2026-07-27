// ============================================================================
// AI-Swisse — Calendario e notifiche: test d'integrazione sul DATABASE REALE.
//   npm run test:calendar
//
// Richiede la migrazione 0018 applicata e `.env.test` valorizzato.
//
// Non prova che il codice sia scritto bene: prova che le GARANZIE siano in
// vigore. Sono sei, e tutte e sei stanno nel database proprio perché un
// servizio ben educato non è una garanzia — è la lezione della 0014, dove i
// permessi di colonna dichiarati nei commenti non restringevano nulla e il
// difetto è emerso solo ESEGUENDO:
//
//   1. ISOLAMENTO FRA AZIENDE — l'azienda A non vede né tocca connessioni,
//      collegamenti o notifiche di B.
//   2. ISOLAMENTO FRA PERSONE — e questa è nuova rispetto a tutti i moduli
//      precedenti: due colleghi della STESSA azienda non si leggono le
//      notifiche, non si vedono le connessioni e non si toccano le preferenze.
//   3. TOKEN IRRAGGIUNGIBILI — nessun permesso, per nessuno, in nessun modo.
//   4. NOTIFICHE NON FABBRICABILI — il client non ha alcuna scrittura.
//   5. CODA DEL SOLO SERVER — non si legge e non si scrive dal browser.
//   6. I TRIGGER fanno quello che dicono: accodano, avvisano, e coalescono.
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;   // Node < 22

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
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${name}`); }
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
  const email = `cal+${tag}.${Date.now()}@example.com`;
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

async function addMember(companyId, userId, role = 'member') {
  const { error } = await admin.from('company_members').insert({ company_id: companyId, user_id: userId, role });
  if (error) throw new Error(`membership: ${error.message}`);
}

async function signIn(email) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return client;
}

/** Una connessione di calendario finta: metadati soltanto, nessun token vero. */
async function makeConnection(companyId, userId, provider = 'google') {
  const { data, error } = await admin.from('calendar_connections').insert({
    company_id: companyId, user_id: userId, provider,
    provider_account_id: `acct-${userId.slice(0, 8)}-${provider}`,
    email_address: `${userId.slice(0, 8)}@example.test`,
    provider_calendar_id: `cal-${userId.slice(0, 8)}`,
    calendar_name: 'AI-Swisse — Prova',
    status: 'active', sync_enabled: true,
  }).select('id').single();
  if (error) throw new Error(`connection: ${error.message}`);
  return data.id;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`${B}AI-Swisse — Calendario e notifiche: test sul database reale${X}`);

  // ---- prerequisito: la 0018 è applicata? ---------------------------------
  const { error: probe } = await admin.from('calendar_connections').select('id').limit(1);
  if (probe && /does not exist|schema cache/i.test(probe.message ?? '')) {
    console.error(`\n${R}La migrazione 0018 non risulta applicata.${X}`);
    console.error(`${DIM}Applica supabase/migrations/0018_calendar_notifications.sql dal SQL editor, poi riesegui.${X}\n`);
    process.exit(2);
  }

  const andrea = await makeUser('andrea');
  const marco = await makeUser('marco');
  const estraneo = await makeUser('estraneo');
  const companyA = await makeCompany(`Alpha ${Date.now()}`, andrea.id);
  const companyB = await makeCompany(`Beta ${Date.now()}`, estraneo.id);
  await addMember(companyA, marco.id, 'member');

  const cA = await signIn(andrea.email);          // Andrea, titolare di A
  const cM = await signIn(marco.email);           // Marco, collaboratore di A
  const cE = await signIn(estraneo.email);        // titolare di B, estraneo ad A

  // =========================================================================
  section('1 · Il modello di lettura del calendario');
  // =========================================================================
  const oggi = new Date();
  const giorno = (offset) => new Date(oggi.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

  const { data: tAndrea } = await admin.from('tasks').insert({
    company_id: companyA, created_by: andrea.id, title: 'Rendiconto IVA',
    due_date: giorno(5), priority: 'high', status: 'open', source: 'manual', assignee_user_id: andrea.id,
  }).select('id').single();
  const { data: tMarco } = await admin.from('tasks').insert({
    company_id: companyA, created_by: andrea.id, title: 'Contratto fornitore',
    due_date: giorno(10), priority: 'medium', status: 'open', source: 'manual', assignee_user_id: marco.id,
  }).select('id').single();
  const { data: tScaduta } = await admin.from('tasks').insert({
    company_id: companyA, created_by: andrea.id, title: 'Sollecito arretrato',
    due_date: giorno(-40), priority: 'high', status: 'open', source: 'manual', assignee_user_id: andrea.id,
  }).select('id').single();
  await admin.from('tasks').insert({
    company_id: companyA, created_by: andrea.id, title: 'Senza scadenza',
    due_date: null, priority: 'low', status: 'open', source: 'manual', assignee_user_id: andrea.id,
  });

  const { data: mie, error: mieErr } = await cA.rpc('calendar_tasks', {
    p_company_id: companyA, p_from: giorno(0), p_to: giorno(30), p_mine: true,
  });
  check('«Le mie» mostra solo le attività di cui sono responsabile',
    !mieErr && (mie ?? []).some((r) => r.id === tAndrea.id) && !(mie ?? []).some((r) => r.id === tMarco.id),
    mieErr?.message);

  const { data: tutte } = await cA.rpc('calendar_tasks', {
    p_company_id: companyA, p_from: giorno(0), p_to: giorno(30), p_mine: false,
  });
  check('«Tutte» mostra anche quelle dei colleghi',
    (tutte ?? []).some((r) => r.id === tMarco.id));

  check('⚠️ una scaduta di quaranta giorni fa compare ANCHE se è fuori dall’intervallo richiesto: '
    + 'in ritardo non smette di esserlo perché si è girata pagina al mese',
    (mie ?? []).some((r) => r.id === tScaduta.id));

  const { data: senzaScadute } = await cA.rpc('calendar_tasks', {
    p_company_id: companyA, p_from: giorno(0), p_to: giorno(30), p_mine: true, p_include_overdue: false,
  });
  check('…e sparisce se lo si chiede esplicitamente',
    !(senzaScadute ?? []).some((r) => r.id === tScaduta.id));

  check('nessuna attività senza scadenza entra nel calendario: una data non si inventa',
    (tutte ?? []).every((r) => r.due_date));

  const { data: nDate } = await cA.rpc('calendar_undated_count', { p_company_id: companyA, p_mine: true });
  check('le attività senza scadenza si CONTANO, per poterle dichiarare', Number(nDate) === 1, `ottenuto: ${nDate}`);

  const { data: nessuna } = await cE.rpc('calendar_tasks', {
    p_company_id: companyA, p_from: giorno(0), p_to: giorno(30), p_mine: false,
  });
  check('⚠️ un estraneo non ottiene nulla: la funzione filtra per azienda E la RLS di `tasks` resta attiva',
    (nessuna ?? []).length === 0);

  const { data: leggero } = await cA.rpc('calendar_tasks', {
    p_company_id: companyA, p_from: giorno(0), p_to: giorno(30), p_mine: true,
  });
  const colonne = Object.keys((leggero ?? [])[0] ?? {});
  check('il modello di lettura è POVERO: niente descrizione, checklist, commenti o analisi (§22)',
    !colonne.includes('description') && !colonne.includes('checklist') && colonne.length <= 10,
    `colonne: ${colonne.join(', ')}`);

  // =========================================================================
  section('2 · Il trigger che riempie la coda');
  // =========================================================================
  // Senza alcuna connessione attiva non si accoda niente: sarebbero righe che
  // il worker prende solo per scoprire che non c'è nulla da fare.
  const { data: codaPrima } = await admin.from('calendar_sync_queue').select('task_id').eq('company_id', companyA);
  check('senza calendari collegati la coda resta vuota', (codaPrima ?? []).length === 0,
    `righe: ${(codaPrima ?? []).length}`);

  const connAndrea = await makeConnection(companyA, andrea.id, 'google');

  const { data: tNuova } = await admin.from('tasks').insert({
    company_id: companyA, created_by: andrea.id, title: 'Nata con il calendario collegato',
    due_date: giorno(3), priority: 'medium', status: 'open', source: 'manual', assignee_user_id: andrea.id,
  }).select('id').single();

  const { data: coda1 } = await admin.from('calendar_sync_queue').select('task_id').eq('task_id', tNuova.id);
  check('con un calendario attivo, un’attività nuova finisce in coda', (coda1 ?? []).length === 1);

  // ⚠️ Coalescenza: otto modifiche rapide non sono otto chiamate all'API.
  for (let i = 0; i < 8; i++) {
    await admin.from('tasks').update({ title: `Modifica ${i}` }).eq('id', tNuova.id);
  }
  const { data: coda2 } = await admin.from('calendar_sync_queue').select('task_id, attempts').eq('task_id', tNuova.id);
  check('⚠️ otto modifiche rapide producono UNA sola riga in coda: la chiave primaria è l’attività',
    (coda2 ?? []).length === 1, `righe: ${(coda2 ?? []).length}`);

  // Un campo che il calendario non mostra non accoda niente.
  await admin.from('calendar_sync_queue').delete().eq('task_id', tNuova.id);
  await admin.from('tasks').update({ description: 'una descrizione qualsiasi' }).eq('id', tNuova.id);
  const { data: coda3 } = await admin.from('calendar_sync_queue').select('task_id').eq('task_id', tNuova.id);
  check('modificare la DESCRIZIONE non accoda: nell’evento esterno non ci finisce (§95)',
    (coda3 ?? []).length === 0);

  await admin.from('tasks').update({ due_date: giorno(7) }).eq('id', tNuova.id);
  const { data: coda4 } = await admin.from('calendar_sync_queue').select('task_id').eq('task_id', tNuova.id);
  check('cambiare la SCADENZA accoda', (coda4 ?? []).length === 1);

  await admin.from('calendar_sync_queue').delete().eq('task_id', tNuova.id);
  await admin.from('tasks').update({ assignee_user_id: marco.id }).eq('id', tNuova.id);
  const { data: coda5 } = await admin.from('calendar_sync_queue').select('task_id').eq('task_id', tNuova.id);
  check('⚠️ cambiare il RESPONSABILE accoda UNA riga, non due: il worker guarda tutti i collegamenti '
    + 'dell’attività e sposta l’evento in un passaggio solo', (coda5 ?? []).length === 1);

  // =========================================================================
  section('3 · Il trigger che avvisa chi riceve un’attività');
  // =========================================================================
  const { data: avvisiMarco } = await admin.from('notifications')
    .select('id, type, user_id, payload').eq('user_id', marco.id).eq('type', 'task_assigned');
  check('assegnando un’attività a Marco, Marco riceve una notifica',
    (avvisiMarco ?? []).length >= 1, `notifiche: ${(avvisiMarco ?? []).length}`);
  check('e il payload porta SOLO metadati: titolo, scadenza, priorità (§28)',
    (avvisiMarco ?? []).every((n) => {
      const k = Object.keys(n.payload ?? {});
      return k.every((x) => ['title', 'dueDate', 'priority', 'kind'].includes(x));
    }));

  // Assegnarsi qualcosa da soli non produce una notifica: si sa già di averlo
  // fatto, e un avviso per una cosa appena fatta insegna a ignorare la campanella.
  const { data: prima } = await admin.from('notifications').select('id').eq('user_id', andrea.id);
  const { data: tSelf } = await cA.from('tasks').insert({
    company_id: companyA, created_by: andrea.id, title: 'Me la prendo io',
    due_date: giorno(4), priority: 'low', status: 'open', source: 'manual', assignee_user_id: andrea.id,
  }).select('id').single();
  const { data: dopo } = await admin.from('notifications').select('id').eq('user_id', andrea.id);
  check('⚠️ chi si assegna un’attività da sé NON riceve una notifica',
    (dopo ?? []).length === (prima ?? []).length,
    `prima: ${(prima ?? []).length}, dopo: ${(dopo ?? []).length}`);

  // Il destinatario dev'essere membro: il payload contiene il titolo di
  // un'attività, ed è esattamente il dato che un estraneo non deve leggere.
  const { error: estraneoErr } = await admin.from('notifications').insert({
    company_id: companyA, user_id: estraneo.id, type: 'task_due_soon',
    entity_type: 'task', entity_id: tAndrea.id, payload: {},
  });
  check('⚠️ una notifica non può essere indirizzata a chi non è membro dell’azienda',
    !!estraneoErr && /not_member/i.test(`${estraneoErr.message} ${estraneoErr.hint ?? ''}`),
    estraneoErr?.message ?? 'inserimento riuscito');

  // =========================================================================
  section('4 · Isolamento fra PERSONE della stessa azienda (§117)');
  // =========================================================================
  const { data: notificheDiMarco } = await cA.from('notifications')
    .select('id').eq('company_id', companyA).eq('user_id', marco.id);
  check('⚠️ Andrea NON legge le notifiche di Marco, benché siano nella stessa azienda',
    (notificheDiMarco ?? []).length === 0, `viste: ${(notificheDiMarco ?? []).length}`);

  const { data: connDiAndrea } = await cM.from('calendar_connections')
    .select('id, email_address, provider').eq('company_id', companyA);
  check('⚠️ Marco NON vede la connessione di calendario di Andrea',
    (connDiAndrea ?? []).length === 0, `viste: ${(connDiAndrea ?? []).length}`);

  const { data: mieConn } = await cA.from('calendar_connections')
    .select('id, email_address, provider, status, calendar_name').eq('company_id', companyA);
  check('…ma Andrea vede la propria', (mieConn ?? []).length === 1);

  // §85 — le colonne interne non sono nemmeno leggibili: `select('*')` fallisce.
  const { error: stellaErr } = await cA.from('calendar_connections').select('*').eq('company_id', companyA);
  check('⚠️ `select(*)` sulle connessioni FALLISCE: sono concesse solo le colonne che una schermata mostra',
    !!stellaErr, stellaErr ? '' : 'la select è passata');

  // Preferenze: solo le proprie. Un amministratore non accende le email a un
  // collega — il consenso a essere contattati non è delegabile.
  const { error: prefAltruiErr } = await cA.from('notification_preferences')
    .insert({ company_id: companyA, user_id: marco.id, email_enabled: true });
  check('⚠️ Andrea (titolare) NON può creare né modificare le preferenze di Marco',
    !!prefAltruiErr, prefAltruiErr ? '' : 'inserimento riuscito');

  const { error: prefMieErr } = await cA.from('notification_preferences')
    .upsert({ company_id: companyA, user_id: andrea.id, remind_7_days: false, timezone: 'Europe/Zurich' },
      { onConflict: 'company_id,user_id' });
  check('…ma può impostare le proprie', !prefMieErr, prefMieErr?.message);

  await admin.from('notification_preferences')
    .upsert({ company_id: companyA, user_id: marco.id, email_enabled: true },
      { onConflict: 'company_id,user_id' });
  const { data: prefViste } = await cA.from('notification_preferences')
    .select('user_id').eq('company_id', companyA);
  check('e non legge quelle di nessun altro',
    (prefViste ?? []).length === 1 && prefViste[0].user_id === andrea.id);

  // Il fuso si VALIDA: una stringa plausibile ma inesistente non entra.
  const { error: tzErr } = await cA.from('notification_preferences')
    .upsert({ company_id: companyA, user_id: andrea.id, timezone: 'Europa/Zurigo' },
      { onConflict: 'company_id,user_id' });
  check('⚠️ un fuso orario inesistente viene RIFIUTATO dal database, non accettato per scoprirlo poi',
    !!tzErr && /invalid_timezone|timezone/i.test(`${tzErr.message} ${tzErr.hint ?? ''}`),
    tzErr?.message ?? 'accettato');

  // =========================================================================
  section('5 · Isolamento fra AZIENDE (§116)');
  // =========================================================================
  const connEstraneo = await makeConnection(companyB, estraneo.id, 'google');

  const { data: connCrossA } = await cA.from('calendar_connections').select('id').eq('company_id', companyB);
  check('l’azienda A non vede le connessioni di B', (connCrossA ?? []).length === 0);

  const { data: taskCross } = await cE.rpc('calendar_tasks', {
    p_company_id: companyA, p_from: giorno(-60), p_to: giorno(60), p_mine: false,
  });
  check('e non può nemmeno interrogarne il calendario', (taskCross ?? []).length === 0);

  await admin.from('notifications').insert({
    company_id: companyB, user_id: estraneo.id, type: 'task_overdue',
    entity_type: 'task', entity_id: tAndrea.id, payload: { title: 'Riservato' },
  });
  const { data: notifCross } = await cA.from('notifications').select('id').eq('company_id', companyB);
  check('né leggerne le notifiche', (notifCross ?? []).length === 0);

  // Un collegamento evento non può essere agganciato a una connessione altrui.
  const { error: linkFurbo } = await admin.from('calendar_event_links').insert({
    company_id: companyA, user_id: andrea.id, connection_id: connEstraneo,
    task_id: tAndrea.id, provider_event_id: 'evt', provider_calendar_id: 'cal',
  });
  check('⚠️ un collegamento evento non si aggancia alla connessione di un’altra azienda: '
    + 'lo impedisce il trigger, non una policy scritta altrove',
    !!linkFurbo && /mismatch/i.test(`${linkFurbo.message} ${linkFurbo.hint ?? ''}`),
    linkFurbo?.message ?? 'inserimento riuscito');

  const { error: linkAltraTask } = await admin.from('calendar_event_links').insert({
    company_id: companyA, user_id: andrea.id, connection_id: connAndrea,
    task_id: tAndrea.id, provider_event_id: 'evt', provider_calendar_id: 'cal',
  });
  check('…mentre un collegamento coerente entra', !linkAltraTask, linkAltraTask?.message);

  const { error: dupLink } = await admin.from('calendar_event_links').insert({
    company_id: companyA, user_id: andrea.id, connection_id: connAndrea,
    task_id: tAndrea.id, provider_event_id: 'evt-2', provider_calendar_id: 'cal',
  });
  check('⚠️ la stessa attività non può avere DUE eventi sullo stesso calendario: '
    + 'l’idempotenza è un vincolo del database, non una condizione nel worker (§59)',
    !!dupLink && dupLink.code === '23505', dupLink?.message ?? 'duplicato accettato');

  const { data: linkVistiDaMarco } = await cM.from('calendar_event_links').select('id').eq('company_id', companyA);
  check('e i collegamenti di Andrea non li vede Marco', (linkVistiDaMarco ?? []).length === 0);

  // =========================================================================
  section('6 · Ciò che il client non può toccare, in nessun modo');
  // =========================================================================
  for (const [tabella, etichetta] of [
    ['calendar_connection_secrets', 'i token del calendario'],
    ['calendar_oauth_states', 'gli stati OAuth'],
    ['calendar_sync_queue', 'la coda di sincronizzazione'],
    ['calendar_sync_runs', 'il registro delle esecuzioni'],
    ['notification_deliveries', 'le consegne email'],
  ]) {
    const { error } = await cA.from(tabella).select('*').limit(1);
    check(`⚠️ ${etichetta}: il client autenticato non li legge`, !!error,
      error ? '' : 'la select è passata');
  }

  const { error: notifInsert } = await cA.from('notifications').insert({
    company_id: companyA, user_id: andrea.id, type: 'task_overdue',
    entity_type: 'task', entity_id: tAndrea.id, payload: { title: 'Fabbricata' },
  });
  check('⚠️ nessuno si fabbrica una notifica: il client non ha alcuna scrittura', !!notifInsert,
    notifInsert ? '' : 'inserimento riuscito');

  const { error: notifUpdate } = await cA.from('notifications')
    .update({ payload: { title: 'Riscritta' } }).eq('user_id', andrea.id);
  check('e non ne riscrive il contenuto', !!notifUpdate, notifUpdate ? '' : 'update riuscito');

  const { error: connInsert } = await cA.from('calendar_connections').insert({
    company_id: companyA, user_id: andrea.id, provider: 'google',
    provider_account_id: 'finta', email_address: 'x@y.z',
  });
  check('⚠️ una connessione non si crea dal browser: collegare significa maneggiare token',
    !!connInsert, connInsert ? '' : 'inserimento riuscito');

  const { error: codaInsert } = await cA.from('calendar_sync_queue')
    .insert({ task_id: tAndrea.id, company_id: companyA });
  check('e la coda non si riempie dal browser (§136)', !!codaInsert, codaInsert ? '' : 'inserimento riuscito');

  const { error: claimErr } = await cA.rpc('calendar_queue_claim', { p_limit: 5, p_lock_seconds: 60 });
  check('⚠️ nemmeno la funzione che prenota la coda è eseguibile dal client', !!claimErr,
    claimErr ? '' : 'esecuzione riuscita');

  // =========================================================================
  section('7 · Segna come letta');
  // =========================================================================
  const { data: mieNotifiche } = await admin.from('notifications')
    .select('id').eq('company_id', companyA).eq('user_id', marco.id).limit(1);
  const idMarco = (mieNotifiche ?? [])[0]?.id;

  const { data: contoPrima } = await cM.rpc('notifications_unread_count', { p_company_id: companyA });
  check('il conteggio non letto lo calcola il database', Number(contoPrima) >= 1, `ottenuto: ${contoPrima}`);

  // ⚠️ QUI SI CONTROLLA ANCHE L'ERRORE, non solo il risultato.
  //
  // La prima versione di questi controlli scriveva `const { data } = await …`,
  // scartando `error`. Con la 0018 la funzione falliva con 42501 e restituiva
  // `null`: `Number(null)` è ZERO, quindi «Andrea non può segnare» passava — per
  // il motivo sbagliato. Un test che guarda solo il risultato non distingue
  // «zero righe segnate» da «non ho potuto nemmeno provarci», e proprio quella
  // differenza era il difetto.
  const marca = async (client, args) => {
    const { data, error } = await client.rpc('notifications_mark_read', args);
    return { n: data, error };
  };

  const daAndrea = await marca(cA, { p_ids: [idMarco] });
  check('⚠️ Andrea NON può segnare come letta una notifica di Marco',
    !daAndrea.error && daAndrea.n === 0,
    daAndrea.error ? `la chiamata è FALLITA (${daAndrea.error.code}): non è una difesa, è un guasto` : `segnate: ${daAndrea.n}`);

  const daMarco = await marca(cM, { p_ids: [idMarco] });
  check('…mentre Marco può segnare le proprie',
    !daMarco.error && daMarco.n === 1,
    daMarco.error ? `${daMarco.error.code}: ${daMarco.error.message}` : `segnate: ${daMarco.n}`);

  const { data: contoDopo } = await cM.rpc('notifications_unread_count', { p_company_id: companyA });
  check('e il conteggio scende', Number(contoDopo) === Number(contoPrima) - 1,
    `prima: ${contoPrima}, dopo: ${contoDopo}`);

  const riSegnate = await marca(cM, { p_ids: [idMarco] });
  check('segnare due volte la stessa notifica non conta due volte',
    !riSegnate.error && riSegnate.n === 0, `segnate: ${riSegnate.n}`);

  await admin.from('notifications').insert({
    company_id: companyA, user_id: marco.id, type: 'task_due_today',
    entity_type: 'task', entity_id: tMarco.id, payload: {}, dedupe_key: `task:${tMarco.id}:d0`,
  });
  const { error: dupNotif } = await admin.from('notifications').insert({
    company_id: companyA, user_id: marco.id, type: 'task_due_today',
    entity_type: 'task', entity_id: tMarco.id, payload: {}, dedupe_key: `task:${tMarco.id}:d0`,
  });
  check('⚠️ un worker eseguito due volte NON crea due promemoria: lo impedisce il vincolo unico (§29/§111)',
    !!dupNotif && dupNotif.code === '23505', dupNotif?.message ?? 'duplicato accettato');

  await admin.from('notifications').insert({
    company_id: companyA, user_id: marco.id, type: 'task_assigned',
    entity_type: 'task', entity_id: tMarco.id, payload: {}, dedupe_key: null,
  });
  const { error: dupSenzaChiave } = await admin.from('notifications').insert({
    company_id: companyA, user_id: marco.id, type: 'task_assigned',
    entity_type: 'task', entity_id: tMarco.id, payload: {}, dedupe_key: null,
  });
  check('…mentre due assegnazioni successive SONO due fatti distinti e due notifiche',
    !dupSenzaChiave, dupSenzaChiave?.message);

  const tutteLette = await cM.rpc('notifications_mark_all_read', { p_company_id: companyA });
  check('«segna tutte come lette» funziona ed è limitato all’azienda e alla persona',
    !tutteLette.error && Number(tutteLette.data) >= 1,
    tutteLette.error ? `${tutteLette.error.code}: ${tutteLette.error.message}` : `segnate: ${tutteLette.data}`);

  // Controprova dell'isolamento: dopo «segna tutte», le notifiche di Andrea
  // devono essere ancora NON lette. Senza questo controllo, una funzione che
  // segnasse tutto quanto passerebbe il test precedente senza far rumore.
  const { data: andreaAncoraNonLette } = await admin.from('notifications')
    .select('id').eq('user_id', andrea.id).is('read_at', null);
  check('⚠️ …e non ha toccato le notifiche di Andrea',
    (andreaAncoraNonLette ?? []).length > 0,
    `non lette di Andrea rimaste: ${(andreaAncoraNonLette ?? []).length}`);

  // =========================================================================
  section('8 · La coda si prenota una volta sola');
  // =========================================================================
  await admin.from('calendar_sync_queue').delete().eq('company_id', companyA);
  await admin.from('calendar_sync_queue').insert([
    { task_id: tAndrea.id, company_id: companyA },
    { task_id: tScaduta.id, company_id: companyA },
  ]);

  const { data: presa1 } = await admin.rpc('calendar_queue_claim', { p_limit: 10, p_lock_seconds: 120 });
  const { data: presa2 } = await admin.rpc('calendar_queue_claim', { p_limit: 10, p_lock_seconds: 120 });
  check('⚠️ due esecuzioni sovrapposte non prendono le stesse righe: la seconda trova la coda già prenotata',
    (presa1 ?? []).length === 2 && (presa2 ?? []).length === 0,
    `prima: ${(presa1 ?? []).length}, seconda: ${(presa2 ?? []).length}`);
  check('e ogni riga porta il proprio lucchetto',
    (presa1 ?? []).every((r) => r.lock_id) && new Set((presa1 ?? []).map((r) => r.lock_id)).size === 2);

  await admin.from('calendar_sync_queue')
    .update({ locked_until: new Date(Date.now() - 1000).toISOString() })
    .eq('company_id', companyA);
  const { data: presa3 } = await admin.rpc('calendar_queue_claim', { p_limit: 10, p_lock_seconds: 120 });
  check('⚠️ un lucchetto SCADUTO si può riprendere: un worker morto non blocca la coda per sempre',
    (presa3 ?? []).length === 2, `riprese: ${(presa3 ?? []).length}`);

  // =========================================================================
  section('9 · Le attività continuano a funzionare come prima');
  // =========================================================================
  const { error: completaErr } = await cA.from('tasks')
    .update({ status: 'completed' }).eq('id', tAndrea.id);
  check('completare un’attività riesce anche con un calendario collegato: '
    + 'un guasto dell’integrazione non deve mai toccare il lavoro (§72)', !completaErr, completaErr?.message);

  const { data: dopoCompletamento } = await admin.from('tasks')
    .select('completed_at, completed_by').eq('id', tAndrea.id).single();
  check('e le garanzie della 0016 restano intatte: il completamento lo timbra il database',
    !!dopoCompletamento?.completed_at && dopoCompletamento.completed_by === andrea.id);

  const { data: listaOk, error: listaErr } = await cA.rpc('list_tasks', {
    p_company_id: companyA, p_view: 'todo',
  });
  check('la lista delle attività funziona come prima della 0018', !listaErr && Array.isArray(listaOk),
    listaErr?.message);
}

/**
 * Pulizia.
 *
 * ⚠️ L'ESITO DELLE CANCELLAZIONI SI CONTROLLA. supabase-js non solleva: torna
 * `{ error }`. Ignorarlo è già costato due aziende di prova rimaste nel
 * database di PRODUZIONE dopo `test:inbox`, viste solo settimane dopo con la
 * diagnostica. Una pulizia incompleta fa FALLIRE il test.
 */
async function cleanup() {
  const problemi = [];
  for (const id of created.companies) {
    const { error } = await admin.from('companies').delete().eq('id', id);
    if (error) problemi.push(`azienda ${id}: ${error.message}`);
  }
  for (const id of created.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) problemi.push(`utente ${id}: ${error.message}`);
  }
  if (problemi.length) {
    console.log(`\n${R}Pulizia INCOMPLETA — restano dati di prova nel database:${X}`);
    for (const p of problemi) console.log(`  ${R}·${X} ${p}`);
    fail += problemi.length;
  }
}

try {
  await main();
} catch (e) {
  fail++;
  console.error(`\n${R}Interrotto:${X} ${e.message}`);
} finally {
  await cleanup();
  console.log(`\n${B}Riepilogo${X}  ${G}${pass} superati${X}${fail ? `  ${R}${fail} falliti${X}` : ''}\n`);
  process.exit(fail ? 1 : 0);
}
