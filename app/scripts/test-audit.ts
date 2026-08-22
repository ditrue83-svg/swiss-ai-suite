// ============================================================================
// AI-Swisse — Registro attività: test sul DATABASE REALE.
//   npm run test:audit
//
// Richiede la migrazione 0039 applicata e `.env.test` valorizzato.
//
// ⚠️ Un registro si prova SOLO così. Le sue garanzie non sono nel codice della
// pagina — sono permessi, policy e trigger, cioè le tre cose che si possono
// dichiarare a parole per mesi senza che siano vere. La 0014 lo ha già
// insegnato una volta: i permessi di colonna dichiarati nei commenti non
// restringevano niente, e il difetto è uscito solo ESEGUENDO.
//
// LE GARANZIE PROVATE
//   1. La tabella c'è. Se non c'è, questo test ESCE 2 e lo dice: non è verde.
//   2. Registrazione — ognuno degli eventi previsti produce una riga, con
//      l'autore giusto, e nasce dal DATABASE anche quando il client non fa
//      nulla per registrarla.
//   3. NESSUN UTENTE MODIFICA O CANCELLA — il negativo esplicito, provato per
//      titolare, per membro e con la sola chiave anon.
//   4. Nemmeno il SERVICE ROLE modifica: il divieto di UPDATE è in un trigger.
//   5. Lettura riservata — un membro non amministratore legge ZERO righe.
//   6. Isolamento — l'azienda A non vede nulla di B.
//   7. Niente contenuto di documenti né segreti nel payload.
//   8. Un aggiornamento che non tocca campi sorvegliati NON scrive una riga.
//   9. CASCATA — cancellare un'azienda con documenti, attività e persone
//      RIESCE e non lascia residui. È la trappola della 0023: un trigger che
//      scrive durante la cascata renderebbe l'azienda indistruttibile.
//
// ⚠️ LA PULIZIA CONTROLLA IL PROPRIO ESITO: supabase-js non solleva, restituisce
// `{ error }`. Ignorarlo ha già lasciato aziende di prova in PRODUZIONE.
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

const G = '\x1b[32m', R = '\x1b[31m', Y = '\x1b[33m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
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
  const email = `audit-${label}-${stamp}@swissai-suite.ch`;
  const { data: u, error: ue } = await withRetry(() =>
    admin.auth.admin.createUser({ email, password: PW, email_confirm: true }));
  if (ue || !u?.user) throw new Error(`utente ${label}: ${msg(ue)}`);
  created.users.push(u.user.id);
  const client = anonClient();
  const { error: se } = await client.auth.signInWithPassword({ email, password: PW });
  if (se) throw new Error(`login ${label}: ${msg(se)}`);
  return { id: u.user.id, client, email };
}

async function makeTenant(label: string) {
  const owner = await makeUser(label);
  const { data: cid, error: ce } = await owner.client.rpc('create_company_with_owner', {
    p_legal_name: `Audit ${label} ${stamp}`,
  });
  if (ce || !cid) throw new Error(`azienda ${label}: ${msg(ce)}`);
  created.companies.push(cid as string);
  return { ...owner, companyId: cid as string };
}

/** Le righe di registro dell'azienda, lette col service role (bypassa la RLS). */
async function auditRows(companyId: string) {
  const { data, error } = await admin
    .from('audit_logs')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`lettura registro: ${msg(error)} ${code(error)}`);
  return (data ?? []) as {
    id: string; action: string; entity_type: string; entity_id: string;
    actor_user_id: string | null; correlation_id: string; changes: Record<string, { before: unknown; after: unknown }>;
  }[];
}

const has = <T extends { action: string }>(rows: T[], action: string): T[] =>
  rows.filter((r) => r.action === action);

async function main() {
  // L'host non è un segreto (sta nel bundle pubblicato); le chiavi non si stampano.
  console.log(`${B}Registro attività — database reale${X} ${DIM}(${URL!.replace(/^https?:\/\//, '').split('/')[0]})${X}`);

  // -------------------------------------------------------------------------
  section('1. La 0039 è applicata?');
  {
    const { error } = await admin.from('audit_logs').select('id').limit(1);
    if (error) {
      console.error(`\n${R}La tabella public.audit_logs non risponde: ${msg(error)} ${code(error)}${X}`);
      console.error(`${Y}La migrazione 0039 non è applicata su questo progetto. Questo test non può`);
      console.error(`dire nulla, e NON esce verde: applicare la 0039 e rieseguire.${X}`);
      process.exit(2);
    }
    check('public.audit_logs esiste ed è interrogabile', true);
  }

  const a = await makeTenant('a');
  const b = await makeTenant('b');
  const member = await makeUser('membro');
  {
    const { error } = await a.client.from('company_members')
      .insert({ company_id: a.companyId, user_id: member.id, role: 'member' });
    if (error) throw new Error(`aggiunta membro: ${msg(error)}`);
  }

  // -------------------------------------------------------------------------
  section('2. Ogni evento previsto produce una riga, con l’autore giusto');

  // (a) Documento caricato — dal CLIENT, che non fa nulla per registrarlo.
  const { data: doc, error: docErr } = await a.client.from('documents').insert({
    company_id: a.companyId, uploaded_by: a.id,
    title: `Fattura di prova ${stamp}`, original_filename: 'fattura.pdf',
    mime_type: 'application/pdf', file_size: 1234, source_type: 'upload',
  }).select('*').single();
  if (docErr || !doc) throw new Error(`documento: ${msg(docErr)}`);

  let rows = await auditRows(a.companyId);
  const uploaded = has(rows, 'document_uploaded');
  check('caricare un documento scrive una riga, senza che il client la chieda', uploaded.length === 1);
  check('l’autore è chi ha caricato', uploaded[0]?.actor_user_id === a.id);
  check('l’entità è il documento e il filo pure',
    uploaded[0]?.entity_type === 'document' && uploaded[0]?.entity_id === doc.id
    && uploaded[0]?.correlation_id === doc.id);
  check('il titolo è nel payload come campo COMPARSO',
    uploaded[0]?.changes?.title?.before === null && uploaded[0]?.changes?.title?.after === `Fattura di prova ${stamp}`,
    JSON.stringify(uploaded[0]?.changes ?? {}));

  // (b) Analisi avviata — la prenotazione di quota è ciò che dà il via.
  const { data: logId, error: slotErr } = await a.client.rpc('try_consume_ai_quota', {
    p_company_id: a.companyId, p_kind: 'analysis', p_limit: 100,
    p_document_id: doc.id, p_provider: 'anthropic', p_model: 'claude-opus-5',
  });
  if (slotErr) throw new Error(`prenotazione slot: ${msg(slotErr)}`);
  rows = await auditRows(a.companyId);
  check('la prenotazione di un’analisi scrive «analisi avviata»', has(rows, 'analysis_started').length === 1);
  check('l’avvio porta l’autore della richiesta', has(rows, 'analysis_started')[0]?.actor_user_id === a.id);
  check('l’avvio punta al documento, non alla riga di log',
    has(rows, 'analysis_started')[0]?.entity_id === doc.id, String(logId));

  // (c) Esito riuscito e (d) esito fallito — li scrive il server.
  const { data: analysis, error: anErr } = await admin.from('document_analyses').insert({
    document_id: doc.id, company_id: a.companyId, analysis_status: 'completed',
    engine: 'claude-opus-5', provider: 'anthropic', model: 'claude-opus-5',
  }).select('*').single();
  if (anErr || !analysis) throw new Error(`analisi: ${msg(anErr)}`);
  const { error: failErr } = await admin.from('document_analyses').insert({
    document_id: doc.id, company_id: a.companyId, analysis_status: 'failed',
    engine: 'claude-opus-5', provider: 'anthropic', error_code: 'AI_TIMEOUT',
  });
  if (failErr) throw new Error(`analisi fallita: ${msg(failErr)}`);

  rows = await auditRows(a.companyId);
  check('un’analisi conclusa e una fallita sono DUE azioni distinte',
    has(rows, 'analysis_completed').length === 1 && has(rows, 'analysis_failed').length === 1);
  check('l’esito scritto dal server non ha autore: è il sistema, e lo dice',
    has(rows, 'analysis_completed')[0]?.actor_user_id === null);
  check('l’esito è legato all’avvio dallo stesso filo',
    has(rows, 'analysis_completed')[0]?.correlation_id === doc.id
    && has(rows, 'analysis_started')[0]?.correlation_id === doc.id);
  check('il codice d’errore c’è, il messaggio no',
    has(rows, 'analysis_failed')[0]?.changes?.error_code?.after === 'AI_TIMEOUT'
    && !('error_message_safe' in (has(rows, 'analysis_failed')[0]?.changes ?? {})));

  // (e) Correzione manuale.
  const { error: corrErr } = await a.client.from('analysis_corrections').insert({
    analysis_id: analysis.id, document_id: doc.id, company_id: a.companyId,
    field: 'deadline', original_ai_value: '2026-01-01', corrected_value: '2026-09-30',
    corrected_by: a.id,
  });
  if (corrErr) throw new Error(`correzione: ${msg(corrErr)}`);
  rows = await auditRows(a.companyId);
  const corr = has(rows, 'correction_saved')[0];
  check('una correzione manuale scrive una riga attribuita', corr?.actor_user_id === a.id);
  check('la riga dice QUALE campo è stato corretto', corr?.changes?.field?.after === 'deadline');
  check('⚠️ i VALORI della correzione NON entrano nel registro',
    !JSON.stringify(corr?.changes ?? {}).includes('2026-09-30')
    && !JSON.stringify(corr?.changes ?? {}).includes('2026-01-01'),
    JSON.stringify(corr?.changes ?? {}));

  // (f) Risposta generata.
  const { error: repErr } = await a.client.from('document_replies').insert({
    document_id: doc.id, company_id: a.companyId, analysis_id: analysis.id,
    created_by: a.id, language: 'it', tone: 'formale',
    content: 'TESTO SEGRETISSIMO DELLA RISPOSTA', provider: 'deterministic-v2',
  });
  if (repErr) throw new Error(`risposta: ${msg(repErr)}`);
  rows = await auditRows(a.companyId);
  const reply = has(rows, 'reply_generated')[0];
  check('generare una risposta scrive una riga', reply?.actor_user_id === a.id);
  check('⚠️ il TESTO della risposta non entra nel registro',
    !JSON.stringify(reply?.changes ?? {}).includes('SEGRETISSIMO'),
    JSON.stringify(reply?.changes ?? {}));

  // (g) Attività creata e (h) modificata.
  const { data: task, error: taskErr } = await a.client.from('tasks').insert({
    company_id: a.companyId, created_by: a.id, title: `Pagare ${stamp}`, priority: 'medium',
  }).select('*').single();
  if (taskErr || !task) throw new Error(`attività: ${msg(taskErr)}`);
  const { error: updErr } = await a.client.from('tasks')
    .update({ status: 'completed', priority: 'high' }).eq('id', task.id);
  if (updErr) throw new Error(`modifica attività: ${msg(updErr)}`);

  rows = await auditRows(a.companyId);
  check('creare un’attività scrive una riga', has(rows, 'task_created').length === 1);
  check('modificarla ne scrive un’altra', has(rows, 'task_updated').length === 1);
  const upd = has(rows, 'task_updated')[0];
  check('la modifica porta il PRIMA e il DOPO dei campi cambiati',
    upd?.changes?.status?.before === 'open' && upd?.changes?.status?.after === 'completed'
    && upd?.changes?.priority?.after === 'high',
    JSON.stringify(upd?.changes ?? {}));
  check('i campi NON cambiati non compaiono', !('title' in (upd?.changes ?? {})));

  // (i) Membership e ruolo.
  const { error: roleErr } = await a.client.from('company_members')
    .update({ role: 'admin' }).eq('company_id', a.companyId).eq('user_id', member.id);
  if (roleErr) throw new Error(`cambio ruolo: ${msg(roleErr)}`);
  rows = await auditRows(a.companyId);
  // ⚠️ Le righe sono DUE, e la seconda non è un errore: anche la membership che
  // `create_company_with_owner` crea all'onboarding è un ingresso in azienda, e
  // il registro la scrive. Averlo scoperto qui vale più della riga: un trigger
  // che copre l'onboarding è un trigger che copre ANCHE i percorsi a cui nessuno
  // ha pensato — che è tutta la ragione per cui il registro sta nel database e
  // non in un servizio.
  const added = has(rows, 'member_added');
  check('aggiungere una persona scrive una riga, e l’onboarding ne scrive una per il titolare',
    added.length === 2
    && added.some((r) => r.correlation_id === a.id && r.changes?.role?.after === 'owner')
    && added.some((r) => r.correlation_id === member.id && r.changes?.role?.after === 'member'),
    `member_added: ${added.length} — ${JSON.stringify(added.map((r) => ({ filo: r.correlation_id, ruolo: r.changes?.role?.after })))}`);
  const roleRow = has(rows, 'member_role_changed')[0];
  check('il cambio di ruolo dice da che cosa a che cosa',
    roleRow?.changes?.role?.before === 'member' && roleRow?.changes?.role?.after === 'admin');
  check('il filo di una membership è la PERSONA', roleRow?.correlation_id === member.id);

  // -------------------------------------------------------------------------
  section('3. Un aggiornamento che non tocca niente di sorvegliato non scrive');
  {
    const prima = (await auditRows(a.companyId)).length;
    const { error } = await a.client.from('tasks')
      .update({ description: 'una descrizione qualunque' }).eq('id', task.id);
    if (error) throw new Error(`modifica descrizione: ${msg(error)}`);
    const dopo = (await auditRows(a.companyId)).length;
    check('cambiare solo la descrizione non produce una riga di registro', dopo === prima,
      `prima ${prima}, dopo ${dopo}`);
  }

  // -------------------------------------------------------------------------
  section('4. NESSUN UTENTE MODIFICA O CANCELLA — il negativo esplicito');
  const target = (await auditRows(a.companyId))[0]!;
  {
    // Titolare: legge, e non deve poter fare altro.
    const { error: uErr } = await a.client.from('audit_logs')
      .update({ action: 'task_created' } as never).eq('id', target.id);
    check('il TITOLARE non può modificare una riga', uErr !== null, `errore atteso, ricevuto: ${msg(uErr) || 'nessuno'}`);
    console.log(`     ${DIM}chi lo ferma: ${code(uErr) || '—'} · ${msg(uErr).slice(0, 70)}${X}`);

    const { error: dErr } = await a.client.from('audit_logs').delete().eq('id', target.id);
    check('il TITOLARE non può cancellare una riga', dErr !== null, `errore atteso, ricevuto: ${msg(dErr) || 'nessuno'}`);
    console.log(`     ${DIM}chi lo ferma: ${code(dErr) || '—'} · ${msg(dErr).slice(0, 70)}${X}`);

    const { error: iErr } = await a.client.from('audit_logs').insert({
      company_id: a.companyId, action: 'document_uploaded', entity_type: 'document',
      entity_id: doc.id, correlation_id: doc.id,
    } as never);
    check('il TITOLARE non può fabbricare una riga', iErr !== null, `errore atteso, ricevuto: ${msg(iErr) || 'nessuno'}`);

    const { error: mErr } = await member.client.from('audit_logs').delete().eq('id', target.id);
    check('il MEMBRO non può cancellare una riga', mErr !== null, `errore atteso, ricevuto: ${msg(mErr) || 'nessuno'}`);

    const { error: anonErr } = await anonClient().from('audit_logs').insert({
      company_id: a.companyId, action: 'document_uploaded', entity_type: 'document',
      entity_id: doc.id, correlation_id: doc.id,
    } as never);
    check('la sola chiave anon non scrive niente', anonErr !== null, `errore atteso, ricevuto: ${msg(anonErr) || 'nessuno'}`);

    // ⚠️ La prova che conta davvero: le righe ci sono ancora. Un errore
    // restituito non dimostra che la scrittura non sia avvenuta.
    const dopo = await auditRows(a.companyId);
    check('dopo tutti i tentativi le righe sono ancora tutte al loro posto',
      dopo.some((r) => r.id === target.id) && dopo.find((r) => r.id === target.id)!.action === target.action);

    // ⚠️⚠️ CONTROPROVA DEL CONTROLLO, e senza di essa i cinque «non può» qui
    // sopra varrebbero poco: un `error` non nullo può arrivare per mille ragioni
    // che non c'entrano con i permessi — una chiamata malformata, una colonna
    // che non esiste, una sessione scaduta. Se lo stesso client, con la stessa
    // forma di chiamata, ottiene `error === null` dove il permesso C'È, allora
    // il non-nullo di prima parla davvero di permessi.
    //   ⚠️ E non basta guardare `error`: su PostgREST un UPDATE che la RLS
    //   nasconde NON dà errore, tocca zero righe e basta. Per questo qui si
    //   rilegge il valore scritto invece di fidarsi dell'assenza di errore.
    const { error: ctrlErr } = await a.client.from('tasks')
      .update({ title: `Controprova ${stamp}` }).eq('id', task.id);
    const { data: riletta } = await a.client.from('tasks').select('title').eq('id', task.id).maybeSingle();
    check('controprova: lo STESSO client, dove il permesso c’è, scrive senza errore',
      ctrlErr === null && riletta?.title === `Controprova ${stamp}`,
      `errore: ${msg(ctrlErr) || 'nessuno'}, titolo riletto: ${riletta?.title ?? '—'}`);
  }

  // -------------------------------------------------------------------------
  section('5. Nemmeno il SERVICE ROLE modifica: il divieto è in un trigger');
  {
    const { error } = await admin.from('audit_logs')
      .update({ action: 'task_created' } as never).eq('id', target.id);
    check('il service role riceve un errore sull’UPDATE', error !== null,
      `errore atteso, ricevuto: ${msg(error) || 'nessuno'}`);
    console.log(`     ${DIM}chi lo ferma: ${code(error) || '—'} · ${msg(error).slice(0, 70)}${X}`);
    const dopo = await auditRows(a.companyId);
    check('e la riga è rimasta quella di prima',
      dopo.find((r) => r.id === target.id)?.action === target.action);
  }

  // -------------------------------------------------------------------------
  section('6. Lettura riservata a titolari e amministratori');
  {
    // Il membro è stato promosso ad admin più sopra: si rimette a «member».
    const { error: dErr } = await a.client.from('company_members')
      .update({ role: 'member' }).eq('company_id', a.companyId).eq('user_id', member.id);
    if (dErr) throw new Error(`ripristino ruolo: ${msg(dErr)}`);

    const { data: asMember, error: mErr } = await member.client.from('audit_logs')
      .select('id').eq('company_id', a.companyId);
    check('un membro non amministratore legge ZERO righe',
      (asMember ?? []).length === 0 && mErr === null,
      `righe: ${(asMember ?? []).length}, errore: ${msg(mErr)}`);

    const { data: asOwner } = await a.client.from('audit_logs').select('id').eq('company_id', a.companyId);
    check('il titolare le legge', (asOwner ?? []).length > 0);

    const { data: crossTenant } = await b.client.from('audit_logs').select('id').eq('company_id', a.companyId);
    check('il titolare di un’ALTRA azienda non vede niente', (crossTenant ?? []).length === 0);
  }

  // -------------------------------------------------------------------------
  section('7. CASCATA — un’azienda con registro resta cancellabile');
  {
    const righePrima = (await auditRows(b.companyId)).length;
    const { data: docB } = await b.client.from('documents').insert({
      company_id: b.companyId, uploaded_by: b.id, title: `Doc B ${stamp}`, source_type: 'upload',
    }).select('id').single();
    await b.client.from('tasks').insert({ company_id: b.companyId, created_by: b.id, title: `Task B ${stamp}` });
    check('l’azienda B ha eventi da cancellare',
      (await auditRows(b.companyId)).length > righePrima, String(docB?.id));

    const { error } = await admin.from('companies').delete().eq('id', b.companyId);
    check('⚠️ cancellare l’azienda RIESCE (la trappola della 0023)', error === null,
      `${msg(error)} ${code(error)}`);
    const residuo = await auditRows(b.companyId);
    check('e non resta una riga di registro', residuo.length === 0, `residue: ${residuo.length}`);
    if (error === null) created.companies = created.companies.filter((id) => id !== b.companyId);
  }

  await cleanup();
  console.log(`\n${B}Risultato:${X} ${fail === 0 ? `${G}${pass} passati${X}` : `${R}${fail} falliti${X} ${DIM}su ${pass + fail}${X}`}`);
  process.exit(fail === 0 ? 0 : 1);
}

async function cleanup() {
  section('Pulizia');
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
