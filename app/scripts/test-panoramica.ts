// ============================================================================
// AI-Swisse — LA PANORAMICA CONTRO IL DATABASE VERO.
//   npm run test:panoramica     (richiede .env.test · NON spende credito AI)
//
// ⚠️ PERCHÉ ESISTE, ED È LA GUARDIA R1. I conteggi della Home escono da tre
// metodi che leggono DUE POPOLAZIONI ciascuno — `stateTotals`,
// `ownershipOverview`, `dateDeiDocumenti`: attivi e archiviati, due
// interrogazioni, una somma. Se uno smettesse di sommarle, la Panoramica
// mostrerebbe numeri sbagliati e nessuna suite se ne accorgerebbe: fino al
// 2026-08-20 nessun test le esercitava, e la prova esisteva solo come script
// una-tantum in `.temp/`. Questo file è quello script messo dove morde.
//
// ⚠️⚠️ LA FIXTURE È ASIMMETRICA DI PROPOSITO — per ogni stato attivi ≠
// archiviati. Con 1 e 1 uno scambio fra le due popolazioni, o una somma fatta
// due volte sulla stessa, resterebbe verde: il numero uscirebbe giusto per
// caso. Ogni coppia qui sotto ha due numeri diversi, e nessuna coppia è uguale
// a un'altra.
//
// ⚠️ E NON SI PUÒ CHIAMARE IL SERVIZIO TYPESCRIPT. `documentHubService` importa
// il client Supabase, che nasce da `import.meta.env`: da Node non si carica
// (provato). Perciò qui si chiamano le RPC VERE con gli STESSI argomenti dei
// servizi, e il confronto è a tre — RPC vera, replica diretta sulle tabelle,
// valore atteso scritto a mano — che è ciò che il servizio può sbagliare a
// leggere. Che il servizio le chiami entrambe resta guardato dal SORGENTE, in
// `test:shell-unit` §18: i due controlli si coprono a vicenda, e nessuno dei
// due da solo basta. È un limite DICHIARATO, non una svista.
//
// COME. Il pattern sanzionato dei test su un database che è la produzione: un
// utente e un'azienda usa-e-getta, una fixture NOTA, tre letture che devono
// coincidere numero per numero:
//   (a) le RPC vere, chiamate da utente MEMBRO con gli argomenti dei servizi;
//   (b) la replica diretta sulle tabelle (service_role, sola lettura);
//   (c) i valori attesi, scritti A MANO dalla fixture.
// Nessuna AI viene chiamata: le analisi sono righe inserite, come in
// test-documents.mjs. La pulizia RILEGGE le tabelle ed esce 1 se resta una
// riga: una pulizia incompleta è un fallimento, non un avviso.
// ============================================================================
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  contoDate, decidiBlocchi, rigaNature, splitOpenTasks, termini,
} from '../src/features/dashboard/overviewBlocks';
import { serieSettimanale } from '../src/features/dashboard/overviewKpi';

(globalThis as Record<string, unknown>).WebSocket ??= class {};

const URL_ = process.env.SUPABASE_URL!;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const ANON = process.env.SUPABASE_ANON_KEY!;
if (!URL_ || !SERVICE || !ANON) { console.error('variabili mancanti'); process.exit(1); }

const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const PW = 'Test1234!';

let pass = 0, fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}${detail ? `\n     ${detail}` : ''}`); }
};

const created = { users: [] as string[], companies: [] as string[] };

const oggiLocale = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

async function makeDoc(companyId: string, o: {
  title: string; archived?: boolean; analysisStatus?: string | null;
  deadline?: string | null; deadlineKind?: string | null; status?: string;
}) {
  const { data: doc, error } = await admin.from('documents').insert({
    company_id: companyId, title: o.title, original_filename: `${o.title}.pdf`,
    mime_type: 'application/pdf', source_type: 'upload',
    status: o.status ?? 'completed', page_count: 1,
    archived_at: o.archived ? new Date().toISOString() : null,
  }).select('id').single();
  if (error) throw new Error(`documento: ${error.message}`);
  if (o.analysisStatus !== null && o.analysisStatus !== undefined) {
    const { error: aErr } = await admin.from('document_analyses').insert({
      document_id: doc.id, company_id: companyId,
      analysis_status: o.analysisStatus, engine: 'test',
      deadline: o.deadline ?? null, deadline_kind: o.deadlineKind ?? null,
      confidence: 'alta', actions: [], requested_documents: [], uncertainties: [],
    });
    if (aErr) throw new Error(`analisi: ${aErr.message}`);
  }
  return doc.id;
}

async function main() {
  console.log('LA PANORAMICA CONTRO IL DATABASE VERO — RPC vere vs replica diretta');

  // ---- semina -------------------------------------------------------------
  const email = `panoramica-test.${Date.now()}@example.com`;
  const { data: u, error: uErr } = await admin.auth.admin.createUser({
    email, password: PW, email_confirm: true,
    user_metadata: { first_name: 'Prova', last_name: 'Panoramica' },
  });
  if (uErr) throw new Error(`utente: ${uErr.message}`);
  created.users.push(u.user.id);

  const { data: co, error: cErr } = await admin.from('companies')
    .insert({ legal_name: 'ZZ-USA-E-GETTA Test Panoramica SA', canton: 'Ticino' })
    .select('id').single();
  if (cErr) throw new Error(`azienda: ${cErr.message}`);
  created.companies.push(co.id);
  const { error: mErr } = await admin.from('company_members')
    .insert({ company_id: co.id, user_id: u.user.id, role: 'owner' });
  if (mErr) throw new Error(`membership: ${mErr.message}`);

  const oggi = oggiLocale();
  const futuro = '2026-11-30';
  const passato = '2026-07-01';

  // ⚠️⚠️ LA FIXTURE È ASIMMETRICA: per OGNI coppia attivi ≠ archiviati, e nessuna
  // coppia ripete un'altra. Con 1 e 1 uno scambio fra le due popolazioni — o
  // una somma fatta due volte sulla stessa — uscirebbe giusto per caso.
  //   to_verify   2 attivi · 1 archiviato
  //   failed      0 attivi · 2 archiviati   ← una popolazione VUOTA: è il caso
  //                                           in cui una somma sbagliata
  //                                           somiglia di più a quella giusta
  //   none        3 attivi · 1 archiviato
  //   documenti   8 attivi · 6 archiviati
  //   date        3 attive · 2 archiviate
  await makeDoc(co.id, { title: 'attivo-needs-review-1', analysisStatus: 'needs_review' });
  await makeDoc(co.id, { title: 'attivo-needs-review-2', analysisStatus: 'needs_review' });
  await makeDoc(co.id, { title: 'archiviato-needs-review', archived: true, analysisStatus: 'needs_review' });

  await makeDoc(co.id, { title: 'archiviato-fallito-1', archived: true, analysisStatus: 'failed' });
  await makeDoc(co.id, { title: 'archiviato-fallito-2', archived: true, analysisStatus: 'failed' });

  await makeDoc(co.id, { title: 'attivo-mai-analizzato-1', analysisStatus: null });
  await makeDoc(co.id, { title: 'attivo-mai-analizzato-2', analysisStatus: null });
  await makeDoc(co.id, { title: 'attivo-mai-analizzato-3', analysisStatus: null });
  await makeDoc(co.id, { title: 'archiviato-mai-analizzato', archived: true, analysisStatus: null });

  // ⚠️ LE DATE E LE LORO NATURE, e il TERMINE PIÙ VICINO sta fra gli
  // ARCHIVIATI: un termine archiviato resta un obbligo, e deve arrivare in
  // cima all'elenco della Panoramica anche se la sua popolazione è la seconda
  // a essere letta. È il caso che un'unione fatta male perderebbe.
  await makeDoc(co.id, { title: 'attivo-term', analysisStatus: 'completed', deadline: futuro, deadlineKind: 'term' });
  await makeDoc(co.id, { title: 'attivo-event', analysisStatus: 'completed', deadline: futuro, deadlineKind: 'event' });
  await makeDoc(co.id, { title: 'attivo-data-senza-natura', analysisStatus: 'completed', deadline: futuro, deadlineKind: null });
  await makeDoc(co.id, { title: 'archiviato-term-scaduto', archived: true, analysisStatus: 'completed', deadline: passato, deadlineKind: 'term' });
  await makeDoc(co.id, { title: 'archiviato-reference', archived: true, analysisStatus: 'completed', deadline: futuro, deadlineKind: 'reference' });

  // Attività: la vista todo esclude completate e archiviate; il diviso non
  // conta due volte chi ha entrambe le date; una scaduta si vede.
  const task = (t: Record<string, unknown>) => admin.from('tasks').insert({
    company_id: co.id, created_by: u.user.id, ...t,
  });
  for (const [i, t] of [
    { title: 'termine-futuro', due_date: futuro },
    { title: 'termine-scaduto', due_date: passato },
    { title: 'solo-appuntamento', appointment_date: futuro },
    { title: 'entrambe-le-date', due_date: futuro, appointment_date: futuro },
    { title: 'senza-data' },
    { title: 'completata', due_date: futuro, status: 'completed' },
  ].entries()) {
    const { error } = await task(t);
    if (error) throw new Error(`task ${i}: ${error.message}`);
  }
  const { data: tArch, error: taErr } = await admin.from('tasks')
    .insert({ company_id: co.id, created_by: u.user.id, title: 'archiviata', archived_at: new Date().toISOString() })
    .select('id').single();
  if (taErr) throw new Error(`task archiviata: ${taErr.message}`);
  void tArch;

  // ---- (a) le RPC VERE, da utente membro ----------------------------------
  const member: SupabaseClient = createClient(URL_, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error: siErr } = await member.auth.signInWithPassword({ email, password: PW });
  if (siErr) throw new Error(`login: ${siErr.message}`);

  const listDocs = async (extra: Record<string, unknown>) => {
    const { data, error } = await member.rpc('list_documents', {
      p_company_id: co.id, p_query: null, p_category: null, p_uncategorized: false,
      p_source: null, p_state: null, p_tag_ids: null, p_date_from: null, p_date_to: null,
      p_has_deadline: false, p_archived: false, p_sort: 'recent', p_limit: 1, p_offset: 0,
      ...extra,
    });
    if (error) throw new Error(`list_documents: ${error.message}`);
    const rows = (data ?? []) as {
      id: string; title: string; total_count: number;
      deadline: string | null; deadline_kind: string | null;
    }[];
    return { rows, total: rows.length ? Number(rows[0].total_count) : 0 };
  };

  const stati = async (state: string) => ({
    attivi: (await listDocs({ p_state: state })).total,
    archiviati: (await listDocs({ p_state: state, p_archived: true })).total,
  });
  const rpcToVerify = await stati('to_verify');
  const rpcFailed = await stati('failed');
  const rpcNone = await stati('none');

  // ⚠️ UNA POPOLAZIONE ALLA VOLTA, con gli stessi argomenti di
  // `dateDeiDocumenti`: `p_has_deadline` più `p_archived`, tetto 100.
  const dateAtt = await listDocs({ p_has_deadline: true, p_limit: 100 });
  const dateArch = await listDocs({ p_has_deadline: true, p_archived: true, p_limit: 100 });
  const aRighe = (rows: { deadline_kind: string | null; deadline?: string | null; id?: string }[]) =>
    rows.map((r, i) => ({ id: r.id ?? `r${i}`, kind: r.deadline_kind ?? null, deadline: r.deadline ?? null }));
  const rpcDateAtt = contoDate(aRighe(dateAtt.rows), dateAtt.total);
  const rpcDateArch = contoDate(aRighe(dateArch.rows), dateArch.total);

  const { data: tData, error: tErr } = await member.rpc('list_tasks', {
    p_company_id: co.id, p_view: 'todo', p_status: null, p_priority: null,
    p_source: null, p_assignee: null, p_search: null, p_limit: 200, p_offset: 0,
  });
  if (tErr) throw new Error(`list_tasks: ${tErr.message}`);
  const tRows = (tData ?? []) as { title: string; due_date: string | null; appointment_date: string | null; total_count: number }[];
  const rpcSplit = splitOpenTasks(
    tRows.map((r) => ({ title: r.title, dueDate: r.due_date, appointmentDate: r.appointment_date })),
    tRows.length ? Number(tRows[0].total_count) : 0,
    oggi,
  );

  const cat = async (archived: boolean) => {
    const { data, error } = await member.rpc('document_category_counts', { p_company_id: co.id, p_archived: archived });
    if (error) throw new Error(`category_counts: ${error.message}`);
    return ((data ?? []) as { n: number }[]).reduce((a, r) => a + Number(r.n), 0);
  };
  // Le colonne della RPC dei conteggi si scoprono dal primo risultato.
  const { data: catRaw, error: catErr } = await member.rpc('document_category_counts', { p_company_id: co.id, p_archived: false });
  if (catErr) throw new Error(`category_counts: ${catErr.message}`);
  const catCols = catRaw && (catRaw as unknown[]).length ? Object.keys((catRaw as Record<string, unknown>[])[0]) : [];
  void cat;

  const sommaCat = (rows: unknown, colonna: string) =>
    ((rows ?? []) as Record<string, unknown>[]).reduce((a, r) => a + Number(r[colonna] ?? 0), 0);
  const colN = catCols.find((c) => c !== 'category') ?? 'n';
  const { data: catArch } = await member.rpc('document_category_counts', { p_company_id: co.id, p_archived: true });
  const rpcDocs = { attivi: sommaCat(catRaw, colN), archiviati: sommaCat(catArch, colN) };

  // ---- (b) la replica diretta (stessa strada di leggi.ts) ------------------
  const docs = (await admin.from('documents').select('id, status, archived_at').eq('company_id', co.id)).data ?? [];
  const analisi = (await admin.from('document_analyses')
    .select('id, document_id, analysis_status, created_at, deadline, deadline_kind')
    .eq('company_id', co.id)
    .order('created_at', { ascending: false }).order('id', { ascending: false })).data ?? [];
  const lastTry = new Map<string, (typeof analisi)[number]>();
  const good = new Map<string, (typeof analisi)[number]>();
  for (const a of analisi) {
    if (!lastTry.has(a.document_id)) lastTry.set(a.document_id, a);
    if (a.analysis_status !== 'failed' && !good.has(a.document_id)) good.set(a.document_id, a);
  }
  const PROCESSING = new Set(['extracting', 'analyzing', 'processing']);
  const stato = (d: { id: string; status: string }) => {
    const t = lastTry.get(d.id);
    if (t?.analysis_status === 'failed') return 'failed';
    if (t?.analysis_status === 'needs_review') return 'to_verify';
    if (t?.analysis_status === 'completed') return 'analyzed';
    if (!t && !PROCESSING.has(d.status)) return 'none';
    return 'altro';
  };
  const dirStato = (s: string) => ({
    attivi: docs.filter((d) => d.archived_at === null && stato(d) === s).length,
    archiviati: docs.filter((d) => d.archived_at !== null && stato(d) === s).length,
  });
  const dirDate = (archiviati: boolean) => {
    const righe = docs
      .filter((d) => (archiviati ? d.archived_at !== null : d.archived_at === null))
      .filter((d) => (good.get(d.id)?.deadline ?? null) !== null)
      .map((d) => ({
        id: d.id,
        kind: good.get(d.id)?.deadline_kind ?? null,
        deadline: good.get(d.id)?.deadline ?? null,
      }));
    return contoDate(righe, righe.length);
  };
  const dirDateAtt = dirDate(false);
  const dirDateArch = dirDate(true);
  const dirDocs = {
    attivi: docs.filter((d) => d.archived_at === null).length,
    archiviati: docs.filter((d) => d.archived_at !== null).length,
  };
  const tuttiTask = (await admin.from('tasks').select('title, status, archived_at, due_date, appointment_date').eq('company_id', co.id)).data ?? [];
  const todo = tuttiTask.filter((t) => t.status !== 'completed' && t.archived_at === null);
  const dirSplit = splitOpenTasks(
    todo.map((t) => ({ title: t.title, dueDate: t.due_date, appointmentDate: t.appointment_date })),
    todo.length, oggi,
  );

  // ---- il confronto a tre: RPC vera = replica = atteso ---------------------
  const eq = (nome: string, rpc: unknown, dir: unknown, atteso: unknown) => {
    const j = (x: unknown) => JSON.stringify(x);
    check(`${nome}: RPC ${j(rpc)} = diretta ${j(dir)} = atteso ${j(atteso)}`,
      j(rpc) === j(dir) && j(dir) === j(atteso));
  };

  console.log('\nStati per popolazione — R1: attivi e archiviati sono DUE letture');
  eq('to_verify', rpcToVerify, dirStato('to_verify'), { attivi: 2, archiviati: 1 });
  eq('failed', rpcFailed, dirStato('failed'), { attivi: 0, archiviati: 2 });
  eq('none', rpcNone, dirStato('none'), { attivi: 3, archiviati: 1 });
  // ⚠️ LA DOMANDA DI R1 IN UNA RIGA: le due popolazioni sono DIVERSE in ogni
  // stato, quindi nessun numero della Home può uscire giusto per caso da una
  // somma che ne conta una sola o la stessa due volte.
  check('la fixture è asimmetrica in OGNI stato: attivi ≠ archiviati',
    [rpcToVerify, rpcFailed, rpcNone].every((c) => c.attivi !== c.archiviati),
    JSON.stringify([rpcToVerify, rpcFailed, rpcNone]));
  check('e i totali della Home sono la SOMMA delle due, non una delle due',
    rpcToVerify.attivi + rpcToVerify.archiviati === 3
    && rpcFailed.attivi + rpcFailed.archiviati === 2
    && rpcNone.attivi + rpcNone.archiviati === 4);

  console.log('\nDocumenti per popolazione (piè di pagina / stato vuoto)');
  eq('documenti', rpcDocs, dirDocs, { attivi: 8, archiviati: 6 });

  console.log('\nLe date e la loro natura, UNA POPOLAZIONE ALLA VOLTA');
  eq('date attive: totale', rpcDateAtt.totale, dirDateAtt.totale, 3);
  eq('date archiviate: totale', rpcDateArch.totale, dirDateArch.totale, 2);
  eq('non obbliganti (attivi)', rpcDateAtt.nonObbliganti, dirDateAtt.nonObbliganti, 1);
  eq('non obbliganti (archiviati)', rpcDateArch.nonObbliganti, dirDateArch.nonObbliganti, 1);
  eq('natura non registrata (attivi)', rpcDateAtt.nonRegistrate, dirDateAtt.nonRegistrate, 1);
  eq('natura non registrata (archiviati)', rpcDateArch.nonRegistrate, dirDateArch.nonRegistrate, 0);

  console.log('\nI TERMINI sono voci, e attraversano le due popolazioni');
  const voci = termini(rpcDateAtt, rpcDateArch);
  eq('termini trovati', voci.trovati, termini(dirDateAtt, dirDateArch).trovati, 2);
  check('il termine ARCHIVIATO e SCADUTO è il primo dell\'elenco',
    voci.voci[0]?.deadline === passato,
    `primo: ${voci.voci[0]?.deadline} (atteso ${passato})`);
  check('ogni voce porta il suo giorno e la sua identità, non solo un conteggio',
    voci.voci.every((v) => typeof v.id === 'string' && v.id.length > 0 && v.deadline !== null));
  check('l\'elenco non si dichiara parziale: la lettura è sotto il tetto',
    !voci.parziale && voci.lette === 5 && voci.totaleDate === 5);

  console.log('\nLa riga dei limiti: le date di natura non registrata');
  const limiteAtt = rigaNature(rpcDateAtt);
  const limiteArch = rigaNature(rpcDateArch);
  check('fra gli attivi: 1 non registrata su 3, e la destinazione è più ampia',
    limiteAtt !== null && limiteAtt.n === 1 && limiteAtt.totale === 3 && limiteAtt.destinazionePiuAmpia,
    JSON.stringify(limiteAtt));
  check('fra gli archiviati: niente da dire, e la riga NON compare',
    limiteArch === null, JSON.stringify(limiteArch));

  console.log('\nAttività (blocco Da fare)');
  eq('aperte', rpcSplit.aperte, dirSplit.aperte, 5);
  eq('termini', rpcSplit.termini, dirSplit.termini, 3);
  eq('appuntamenti', rpcSplit.appuntamenti, dirSplit.appuntamenti, 1);
  eq('senza data', rpcSplit.senzaData, dirSplit.senzaData, 1);
  eq('scadute', rpcSplit.scadute, dirSplit.scadute, 1);

  console.log('\nVisibilità dei blocchi, coi numeri appena letti');
  const blocchi = decidiBlocchi({
    ownership: 0, aperte: rpcSplit.aperte,
    terminiNeiDocumenti: voci.trovati,
    dateNonRegistrate: rpcDateAtt.nonRegistrate + rpcDateArch.nonRegistrate,
    daVerificare: rpcToVerify.attivi + rpcToVerify.archiviati,
    fallite: rpcFailed.attivi + rpcFailed.archiviati,
    maiAnalizzati: rpcNone.attivi + rpcNone.archiviati,
    programmiInCatalogo: 7, openCases: 0, activeProjects: 0,
  });
  check('col termine vero il blocco «Da fare» è visibile', blocchi.daFare === true);
  check('e il blocco dei limiti anche, per la data senza natura', blocchi.sistema === true);
  check('«Niente in sospeso» non compare: qualcosa da dire c\'è', !blocchi.vuotoOperativo);

  // ---- la serie delle analisi, per il KPI «Documenti analizzati» -----------
  // Nato col restyling 2026-08-26: la sparkline della striscia KPI si costruisce
  // dai `created_at` di `document_analyses` — la stessa interrogazione di
  // `analysisService.timestampAnalisi`. Qui si prova che la strada regge: la
  // colonna `company_id` esiste e filtra, la RLS lascia leggere il MEMBRO, e il
  // numero è quello della fixture — 10 analisi (3 needs_review · 2 failed ·
  // 5 completed; i «mai analizzati» non hanno riga).
  console.log('\nLa serie delle analisi per la sparkline del KPI');
  const sessantaGiorniFa = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data: tsMembro, error: tsErr } = await member.from('document_analyses')
    .select('created_at')
    .eq('company_id', co.id)
    .gte('created_at', sessantaGiorniFa)
    .order('created_at', { ascending: true })
    .limit(1000);
  check('il MEMBRO legge i timestamp delle analisi della sua azienda',
    !tsErr && (tsMembro ?? []).length === 10,
    tsErr ? tsErr.message : `lette ${(tsMembro ?? []).length}, attese 10`);
  // Replica diretta (service_role): stesso numero, stessa finestra.
  const { data: tsAdmin } = await admin.from('document_analyses')
    .select('created_at').eq('company_id', co.id).gte('created_at', sessantaGiorniFa);
  check('e il numero coincide con la replica diretta',
    (tsAdmin ?? []).length === (tsMembro ?? []).length,
    `membro ${(tsMembro ?? []).length} · diretta ${(tsAdmin ?? []).length}`);
  // La serie che la sparkline disegna: tutto nella settimana in corso.
  check('e la serie settimanale le mette tutte nel contenitore in corso',
    (() => { const s = serieSettimanale((tsMembro ?? []).map((r) => r.created_at as string), 8, new Date());
      return s[7] === 10 && s.slice(0, 7).every((n) => n === 0); })(),
    serieSettimanale((tsMembro ?? []).map((r) => r.created_at as string), 8, new Date()).join(','));

  await member.auth.signOut();
}

async function cleanup() {
  console.log('\nPulizia…');
  let incomplete = false;
  for (const id of created.companies) {
    const { error } = await admin.from('companies').delete().eq('id', id);
    if (error) { incomplete = true; console.error(`  azienda ${id}: ${error.message}`); }
    // La pulizia si VERIFICA rileggendo: una riga sopravvissuta è un fallimento.
    for (const tab of ['documents', 'document_analyses', 'tasks', 'company_members', 'companies'] as const) {
      const col = tab === 'companies' ? 'id' : 'company_id';
      const { count } = await admin.from(tab).select('*', { count: 'exact', head: true }).eq(col, id);
      if ((count ?? 0) > 0) { incomplete = true; console.error(`  ${tab}: ${count} righe sopravvissute`); }
    }
  }
  for (const id of created.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) { incomplete = true; console.error(`  utente ${id}: ${error.message}`); }
  }
  if (incomplete) { fail++; console.error('PULIZIA INCOMPLETA: dati di prova rimasti in produzione.'); }
  else console.log('  pulita e verificata (0 righe sopravvissute).');
}

main()
  .then(cleanup, async (e) => { console.error(`\nErrore: ${e.message}`); await cleanup(); })
  .then(() => {
    console.log(`\n${pass} verdi, ${fail} rossi`);
    process.exit(fail ? 1 : 0);
  });
