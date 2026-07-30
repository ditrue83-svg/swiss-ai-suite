// ============================================================================
// AI-Swisse — Automazioni: test d'integrazione sul DATABASE REALE.
//   npm run test:workflows
//
// Richiede la migrazione 0020 applicata e `.env.test` valorizzato.
//
// ⚠️ NON SIMULA IL MOTORE: LO ESEGUE.
// `processEvent` è lo STESSO codice che gira dentro la Edge Function — riceve
// il client per parametro e non conosce `Deno.env`, proprio per poter essere
// provato qui contro il database vero. Un test che riscrivesse la logica per
// «provarla» proverebbe la riscrittura.
//
// Non prova che il codice sia scritto bene: prova che le GARANZIE siano in
// vigore. Sono nove, e stanno tutte nel database o nel motore, perché un
// servizio ben educato non è una garanzia — è la lezione della 0014, dove i
// permessi di colonna dichiarati nei commenti non restringevano nulla e il
// difetto è emerso solo ESEGUENDO:
//
//   1. ISOLAMENTO FRA AZIENDE — A non vede regole, esecuzioni ed eventi di B.
//   2. NESSUNA SCRITTURA DAL CLIENT — su nessuna delle cinque tabelle.
//   3. EVENTI NON FABBRICABILI — il browser non può dichiarare un fatto.
//   4. L'OUTBOX — i trigger emettono, e solo quando qualcuno ascolta.
//   5. IDEMPOTENZA — lo stesso evento due volte fa UNA attività.
//   6. CICLI E PROFONDITÀ — «quando nasce un'attività, crea un'attività».
//   7. ATTIVARE NON PROCESSA IL PASSATO.
//   8. LE GUARDIE — autore membro, attivazione senza azioni, tetto attive.
//   9. LE COSTANTI — quelle del database e quelle di TypeScript coincidono.
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import {
  AUTOMATION_LIMITS, EVENT_LOCK_SECONDS, MAX_RUNS_PER_COMPANY_PER_PASS,
} from '../supabase/functions/_shared/automation/contract.ts';
import { processEvent } from '../supabase/functions/_shared/automation/engine.ts';
import { claimEvents, eventDone, type ClaimedEvent, type ServerClient } from '../supabase/functions/_shared/automation/store.ts';

if (!globalThis.WebSocket) (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;   // Node < 22

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error('Mancano SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.test');
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
const sb = admin as unknown as ServerClient;

const created: { users: string[]; companies: string[] } = { users: [], companies: [] };
let pass = 0, fail = 0;
const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);

const PW = 'Test1234!';
const isJwtTransient = (msg = '') => /invalid JWT|unverifiable|unrecognized JWT kid/i.test(msg);
async function withRetry<T>(label: string, fn: () => Promise<{ data: T; error: unknown }>, tries = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await fn();
    if (!error) return data;
    last = error;
    if (!isJwtTransient((error as { message?: string }).message)) break;
    await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
  throw new Error(`${label}: ${(last as { message?: string })?.message ?? 'errore'}`);
}

async function makeUser(tag: string) {
  const email = `wf+${tag}.${Date.now()}@example.com`;
  const data = await withRetry('createUser', () => admin.auth.admin.createUser({
    email, password: PW, email_confirm: true, user_metadata: { first_name: 'Prova', last_name: tag },
  }) as never);
  const user = (data as { user: { id: string } }).user;
  created.users.push(user.id);
  return { id: user.id, email };
}

async function makeCompany(name: string, ownerId: string): Promise<string> {
  const { data, error } = await admin.from('companies')
    .insert({ legal_name: name, canton: 'Ticino' }).select('id').single();
  if (error) throw new Error(`company: ${error.message}`);
  created.companies.push(data.id);
  const { error: mErr } = await admin.from('company_members')
    .insert({ company_id: data.id, user_id: ownerId, role: 'owner' });
  if (mErr) throw new Error(`membership: ${mErr.message}`);
  return data.id;
}

async function signIn(email: string) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return client;
}

/** Una regola, scritta con il service role come farebbe la Edge Function. */
async function makeWorkflow(companyId: string, userId: string, over: Record<string, unknown> = {}) {
  const { data, error } = await admin.from('workflow_definitions').insert({
    company_id: companyId,
    name: 'Regola di prova',
    trigger_type: 'document_analysis_completed',
    condition_match: 'all',
    conditions: [],
    actions: [{ key: 'create_task', config: { titleTemplate: 'Verifica {{document.title}}', priority: 'high', dueDate: 'none' } }],
    status: 'active',
    created_by: userId,
    updated_by: userId,
    ...over,
  }).select('id, version, status, activated_at').single();
  if (error) throw new Error(`workflow: ${error.message}`);
  return data as { id: string; version: number; status: string; activated_at: string | null };
}

async function makeDocument(companyId: string, title: string): Promise<string> {
  const { data, error } = await admin.from('documents').insert({
    company_id: companyId, title, source_type: 'upload', status: 'completed',
  }).select('id').single();
  if (error) throw new Error(`document: ${error.message}`);
  return data.id;
}

/** Un'analisi valida: è ciò che fa nascere l'evento documentale. */
async function makeAnalysis(companyId: string, documentId: string, over: Record<string, unknown> = {}) {
  const { data, error } = await admin.from('document_analyses').insert({
    company_id: companyId, document_id: documentId,
    analysis_status: 'completed', engine: 'deterministic-test',
    document_type: 'reminder', sender: 'Amministrazione federale delle contribuzioni',
    sender_authority_type: 'federal', deadline: '2026-12-31',
    amount: 6000, amount_currency: 'CHF', confidence: 'alta', overall_confidence: 0.9,
    ...over,
  }).select('id').single();
  if (error) throw new Error(`analysis: ${error.message}`);
  return data.id as string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Prenota ed elabora tutta la coda di un'azienda, come farebbe il worker. */
async function drain(companyId: string): Promise<{ processed: number; runs: number }> {
  let processed = 0, runs = 0;
  for (let round = 0; round < 12; round++) {
    const events = await claimEvents(sb, 20, EVENT_LOCK_SECONDS, MAX_RUNS_PER_COMPANY_PER_PASS);
    const mine = events.filter((e) => e.company_id === companyId);
    // Gli eventi di altre aziende (test paralleli) si rilasciano subito.
    for (const e of events.filter((x) => x.company_id !== companyId)) {
      await admin.from('automation_events')
        .update({ processing_status: 'pending', locked_until: null, lock_id: null, attempts: 0 })
        .eq('id', e.id);
    }
    if (!mine.length) break;
    for (const event of mine) {
      const outcome = await processEvent(sb, event as ClaimedEvent);
      runs += outcome.report.runs;
      await eventDone(sb, event.id, event.lock_id);
      processed++;
    }
  }
  return { processed, runs };
}

async function eventsOf(companyId: string, type?: string) {
  let q = admin.from('automation_events').select('id, event_type, chain_depth, correlation_id, dedupe_key, processing_status, attempts')
    .eq('company_id', companyId);
  if (type) q = q.eq('event_type', type);
  const { data } = await q;
  return (data ?? []) as { id: string; event_type: string; chain_depth: number; correlation_id: string; dedupe_key: string | null; processing_status: string; attempts: number }[];
}

async function main() {
  console.log(`${B}AI-Swisse — Automazioni: test sul database reale${X}`);

  // ---- prerequisito: la 0020 è applicata? ---------------------------------
  const { error: probe } = await admin.from('workflow_definitions').select('id').limit(1);
  if (probe && /does not exist|schema cache/i.test(probe.message ?? '')) {
    console.error(`\n${R}La migrazione 0020 non risulta applicata.${X}`);
    console.error(`${DIM}Applica supabase/migrations/0020_workflow_automation.sql dal SQL editor, poi riesegui.${X}\n`);
    process.exit(2);
  }

  const andrea = await makeUser('andrea');
  const marco = await makeUser('marco');
  const companyA = await makeCompany(`Prova Automazioni A ${Date.now()}`, andrea.id);
  const companyB = await makeCompany(`Prova Automazioni B ${Date.now()}`, marco.id);
  const clientA = await signIn(andrea.email);
  const clientB = await signIn(marco.email);

  // =========================================================================
  section('1 · I limiti del database e quelli di TypeScript coincidono');
  // =========================================================================
  {
    const { data, error } = await admin.rpc('automation_limits');
    check('automation_limits() risponde', !error, (error as { message?: string })?.message);
    const db = (data ?? {}) as Record<string, number>;
    const differences = Object.entries(AUTOMATION_LIMITS)
      .filter(([k, v]) => Number(db[k]) !== Number(v))
      .map(([k, v]) => `${k}: db=${db[k]} ts=${v}`);
    check('ogni limite dichiarato dal contratto coincide con quello applicato dal database',
      differences.length === 0, differences.join(', '));
  }

  // =========================================================================
  section('2 · Nessuna scrittura dal client, su nessuna tabella (§189)');
  // =========================================================================
  {
    const wf = await makeWorkflow(companyA, andrea.id, { status: 'draft' });

    const ins = await clientA.from('workflow_definitions').insert({
      company_id: companyA, name: 'Abusiva', trigger_type: 'task_created',
      conditions: [], actions: [], status: 'active',
    } as never);
    check('un membro NON può creare una regola dal browser', !!ins.error, JSON.stringify(ins.error));

    const upd = await clientA.from('workflow_definitions')
      .update({ status: 'active' } as never).eq('id', wf.id);
    // ⚠️ Senza GRANT la scrittura viene rifiutata; si verifica comunque che la
    // riga NON sia cambiata, perché un update che non tocca righe non è un
    // errore e sembrerebbe riuscito.
    const { data: after } = await admin.from('workflow_definitions')
      .select('status').eq('id', wf.id).single();
    check('un membro NON può attivare una regola dal browser',
      !!upd.error || after?.status === 'draft', JSON.stringify(upd.error));

    const del = await clientA.from('workflow_definitions').delete().eq('id', wf.id);
    const { count } = await admin.from('workflow_definitions')
      .select('id', { count: 'exact', head: true }).eq('id', wf.id);
    check('un membro NON può cancellare una regola', !!del.error || count === 1);

    for (const table of ['workflow_runs', 'workflow_action_runs', 'workflow_events']) {
      const r = await clientA.from(table).insert({ company_id: companyA } as never);
      check(`nessun inserimento dal client su ${table}`, !!r.error);
    }
  }

  // =========================================================================
  section('3 · La coda non è nemmeno leggibile dal client (§12/§151)');
  // =========================================================================
  {
    const read = await clientA.from('automation_events').select('id').limit(1);
    check('un membro NON può leggere la coda degli eventi', !!read.error, JSON.stringify(read.error));

    const forge = await clientA.from('automation_events').insert({
      company_id: companyA, event_type: 'document_analysis_completed',
      entity_type: 'document', entity_id: '00000000-0000-0000-0000-000000000001',
    } as never);
    check('un membro NON può fabbricare un evento (§151)', !!forge.error);

    const emit = await clientA.rpc('automation_emit', {
      p_company_id: companyA, p_event_type: 'task_created',
      p_entity_type: 'task', p_entity_id: '00000000-0000-0000-0000-000000000001',
    } as never);
    check('un membro NON può chiamare automation_emit', !!emit.error);

    const claim = await clientA.rpc('automation_events_claim', { p_limit: 1 } as never);
    check('un membro NON può prenotare eventi dalla coda', !!claim.error);
  }

  // =========================================================================
  section('4 · Isolamento fra aziende (§110/§113)');
  // =========================================================================
  {
    const wfA = await makeWorkflow(companyA, andrea.id, { status: 'draft', name: 'Solo di A' });
    const { data: seenByB } = await clientB.from('workflow_definitions').select('id').eq('id', wfA.id);
    check('l’azienda B non vede le regole di A', (seenByB ?? []).length === 0);

    const { data: allB } = await clientB.from('workflow_definitions').select('id, company_id');
    check('l’azienda B vede solo le proprie regole',
      (allB ?? []).every((w: { company_id: string }) => w.company_id === companyB));

    // Una run che dichiara l'azienda sbagliata viene RIFIUTATA dal guardiano,
    // anche scrivendo con il service role.
    const badRun = await admin.from('workflow_runs').insert({
      company_id: companyB, workflow_id: wfA.id, workflow_version: 1, config_snapshot: {},
    } as never);
    check('un’esecuzione non può dichiarare un’azienda diversa da quella della regola',
      !!badRun.error && /company_mismatch/.test(badRun.error.message ?? ''), badRun.error?.message);
  }

  // =========================================================================
  section('5 · L’outbox: i trigger emettono, e solo quando qualcuno ascolta (§152)');
  // =========================================================================
  {
    // (a) Senza regole attive NON si scrive niente: sarebbero righe che il
    //     worker prende solo per scoprire che non c'è nulla da fare.
    const docSilent = await makeDocument(companyB, 'Documento senza regole');
    await makeAnalysis(companyB, docSilent);
    await sleep(200);
    const silent = await eventsOf(companyB, 'document_analysis_completed');
    check('senza regole attive nessun evento viene scritto (§152)', silent.length === 0,
      `trovati ${silent.length}`);

    // (b) Con una regola attiva l'evento nasce, nella stessa transazione.
    await makeWorkflow(companyA, andrea.id);
    const doc = await makeDocument(companyA, 'Sollecito IVA Q2');
    await makeAnalysis(companyA, doc);
    await sleep(200);
    const emitted = await eventsOf(companyA, 'document_analysis_completed');
    check('con una regola attiva l’evento viene scritto', emitted.length === 1,
      `trovati ${emitted.length}`);

    // (c) Un'analisi FALLITA non descrive niente: non emette.
    const docFailed = await makeDocument(companyA, 'Analisi fallita');
    await makeAnalysis(companyA, docFailed, { analysis_status: 'failed', error_code: 'X' });
    await sleep(200);
    const afterFailed = await eventsOf(companyA, 'document_analysis_completed');
    check('un’analisi fallita NON fa scattare le regole (§140)', afterFailed.length === 1,
      `trovati ${afterFailed.length}`);
  }

  // =========================================================================
  section('6 · Il motore vero: condizioni, azioni, idempotenza (§141)');
  // =========================================================================
  {
    const first = await drain(companyA);
    check('l’evento viene elaborato e produce un’esecuzione', first.runs === 1, JSON.stringify(first));

    const { data: tasks } = await admin.from('tasks')
      .select('id, title, priority, source, workflow_run_id').eq('company_id', companyA);
    const made = (tasks ?? []).filter((t: { source: string }) => t.source === 'workflow');
    check('l’azione ha creato UNA attività', made.length === 1, `create ${made.length}`);
    check('l’attività porta il titolo composto dal modello',
      made[0]?.title === 'Verifica Sollecito IVA Q2', made[0]?.title);
    check('l’attività porta la provenienza «automazione» e l’esecuzione che l’ha creata (§42)',
      made[0]?.source === 'workflow' && !!made[0]?.workflow_run_id);

    // ⚠️ IL TEST PIÙ IMPORTANTE: lo stesso evento consegnato due volte.
    // Si rimette in coda l'evento già trattato e si rielabora: il vincolo unico
    // (regola, evento) fa ritrovare l'esecuzione di prima, e le azioni già
    // riuscite non si rifanno.
    const events = await eventsOf(companyA, 'document_analysis_completed');
    await admin.from('automation_events').update({
      processing_status: 'pending', locked_until: null, lock_id: null, attempts: 0,
    }).eq('id', events[0].id);
    await drain(companyA);

    const { data: tasksAgain } = await admin.from('tasks')
      .select('id, source').eq('company_id', companyA);
    const madeAgain = (tasksAgain ?? []).filter((t: { source: string }) => t.source === 'workflow');
    check('lo stesso evento elaborato DUE volte crea UNA sola attività (§43/§141)',
      madeAgain.length === 1, `create ${madeAgain.length}`);

    const { count: runCount } = await admin.from('workflow_runs')
      .select('id', { count: 'exact', head: true }).eq('company_id', companyA);
    check('e una sola esecuzione', runCount === 1, `esecuzioni ${runCount}`);
  }

  // =========================================================================
  section('7 · Condizioni non determinabili: NON si esegue (§26/§140)');
  // =========================================================================
  {
    const companyC = await makeCompany(`Prova Automazioni C ${Date.now()}`, andrea.id);
    await makeWorkflow(companyC, andrea.id, {
      name: 'Solo se il mittente è certo',
      conditions: [{ field: 'analysis.sender', operator: 'equals', value: 'AFC' }],
    });
    const doc = await makeDocument(companyC, 'Mittente incerto');
    // Affidabilità sotto soglia e nessuna correzione umana: il mittente c'è ma
    // non è un fatto (§25).
    await makeAnalysis(companyC, doc, { sender: 'AFC', overall_confidence: 0.2, confidence: 'bassa' });
    await sleep(200);
    await drain(companyC);

    const { data: runs } = await admin.from('workflow_runs')
      .select('status, error_code').eq('company_id', companyC);
    const skipped = (runs ?? [])[0] as { status: string; error_code: string | null } | undefined;
    check('una condizione non determinabile produce un’esecuzione SALTATA e dichiarata',
      skipped?.status === 'skipped' && skipped?.error_code === 'condition_not_evaluable',
      JSON.stringify(runs));

    const { count } = await admin.from('tasks')
      .select('id', { count: 'exact', head: true }).eq('company_id', companyC);
    check('e nessuna attività viene creata', count === 0, `attività ${count}`);
  }

  // =========================================================================
  section('8 · Cicli e profondità della catena (§67–§72/§144/§145)');
  // =========================================================================
  {
    const companyD = await makeCompany(`Prova Automazioni D ${Date.now()}`, andrea.id);
    // «Quando nasce un'attività, crea un'attività»: la forma più diretta del
    // ciclo infinito.
    await makeWorkflow(companyD, andrea.id, {
      name: 'Ciclo',
      trigger_type: 'task_created',
      conditions: [],
      actions: [{ key: 'create_task', config: { titleTemplate: 'Derivata da {{task.title}}', priority: 'low', dueDate: 'none' } }],
    });

    const { error: seedError } = await admin.from('tasks').insert({
      company_id: companyD, title: 'Attività iniziale', priority: 'medium', status: 'open', source: 'manual',
    });
    check('l’attività iniziale si crea', !seedError, seedError?.message);
    await sleep(200);
    await drain(companyD);

    const { data: allTasks } = await admin.from('tasks').select('id, title').eq('company_id', companyD);
    check('la catena si ferma: NON si creano attività all’infinito (§144)',
      (allTasks ?? []).length <= 2, `attività ${(allTasks ?? []).length}`);

    const chain = await eventsOf(companyD, 'task_created');
    const depths = chain.map((e) => e.chain_depth);
    check('la catena resta entro la profondità massima (§70)',
      depths.every((d) => d <= AUTOMATION_LIMITS.maxChainDepth), depths.join(','));
    check('tutti gli eventi della catena condividono la stessa correlazione (§69)',
      new Set(chain.map((e) => e.correlation_id)).size <= 1,
      String(new Set(chain.map((e) => e.correlation_id)).size));
  }

  // =========================================================================
  section('9 · Attivare non processa il passato (§163)');
  // =========================================================================
  {
    const companyE = await makeCompany(`Prova Automazioni E ${Date.now()}`, andrea.id);
    // Una regola attiva serve a far NASCERE l'evento (senza ascoltatori non se
    // ne scrive nessuno).
    const early = await makeWorkflow(companyE, andrea.id, { name: 'Attivata prima' });
    const doc = await makeDocument(companyE, 'Documento di ieri');
    await makeAnalysis(companyE, doc);
    await sleep(200);

    const [event] = await eventsOf(companyE, 'document_analysis_completed');
    check('l’evento esiste', !!event);

    // ⚠️ La prova va fatta NEI DUE VERSI: che la regola tardiva sia esclusa
    // dice poco se anche quella giusta lo fosse. Una versione precedente di
    // questo test guardava solo la prima metà e sarebbe passata anche con
    // `workflows_for_event` che non restituisce mai niente.
    const late = await makeWorkflow(companyE, andrea.id, { name: 'Attivata dopo' });
    const { data: full } = await admin.from('automation_events')
      .select('occurred_at').eq('id', event.id).single();
    const { data: matching } = await admin.rpc('workflows_for_event', {
      p_company_id: companyE,
      p_event_type: 'document_analysis_completed',
      p_occurred_at: (full as { occurred_at: string }).occurred_at,
      p_correlation_id: event.correlation_id,
    } as never);
    const ids = ((matching ?? []) as { id: string }[]).map((w) => w.id);
    check('una regola attivata PRIMA dell’evento lo processa', ids.includes(early.id), ids.join(','));
    check('una regola attivata DOPO l’evento non lo processa (§163)',
      !ids.includes(late.id), ids.join(','));
  }

  // =========================================================================
  section('10 · Le guardie delle regole (§54/§55/§108/§166)');
  // =========================================================================
  {
    const notMember = await admin.from('workflow_definitions').insert({
      company_id: companyA, name: 'Autore estraneo', trigger_type: 'task_created',
      conditions: [], actions: [], status: 'draft', created_by: marco.id,
    } as never);
    check('l’autore deve essere membro dell’azienda (§108)',
      !!notMember.error && /author_not_member/.test(notMember.error.message ?? ''),
      notMember.error?.message);

    const noActions = await admin.from('workflow_definitions').insert({
      company_id: companyA, name: 'Attiva e vuota', trigger_type: 'task_created',
      conditions: [], actions: [], status: 'active', created_by: andrea.id,
    } as never);
    check('una regola ATTIVA senza azioni viene rifiutata (§54)',
      !!noActions.error && /no_actions/.test(noActions.error.message ?? ''),
      noActions.error?.message);

    // La versione cresce SOLO quando cambia ciò che il motore esegue.
    const wf = await makeWorkflow(companyA, andrea.id, { status: 'draft', name: 'Versioni' });
    await admin.from('workflow_definitions').update({ name: 'Versioni (rinominata)' }).eq('id', wf.id);
    const { data: renamed } = await admin.from('workflow_definitions')
      .select('version').eq('id', wf.id).single();
    check('rinominare NON incrementa la versione', renamed?.version === wf.version,
      `${wf.version} → ${renamed?.version}`);

    await admin.from('workflow_definitions')
      .update({ conditions: [{ field: 'document.title', operator: 'contains', value: 'x' }] })
      .eq('id', wf.id);
    const { data: changed } = await admin.from('workflow_definitions')
      .select('version').eq('id', wf.id).single();
    check('cambiare le condizioni incrementa la versione (§47)',
      changed?.version === wf.version + 1, `${wf.version} → ${changed?.version}`);

    // Il tetto delle regole attive.
    const companyF = await makeCompany(`Prova Automazioni F ${Date.now()}`, andrea.id);
    let blocked = false, blockedMessage = '';
    for (let i = 0; i < AUTOMATION_LIMITS.maxActiveWorkflows + 1; i++) {
      try {
        await makeWorkflow(companyF, andrea.id, { name: `Attiva ${i}` });
      } catch (e) {
        blocked = true;
        blockedMessage = (e as Error).message;
        break;
      }
    }
    check(`oltre ${AUTOMATION_LIMITS.maxActiveWorkflows} regole attive il database rifiuta (§166)`,
      blocked && /too_many_active/.test(blockedMessage), blockedMessage);
  }

  // =========================================================================
  section('11 · Lo storico lo scrivono i trigger, e lo leggono gli amministratori');
  // =========================================================================
  {
    const wf = await makeWorkflow(companyA, andrea.id, { status: 'draft', name: 'Con storico' });
    await admin.from('workflow_definitions')
      .update({ status: 'active', updated_by: andrea.id }).eq('id', wf.id);

    const { data: history } = await admin.from('workflow_events')
      .select('kind, actor_user_id').eq('workflow_id', wf.id).order('created_at');
    const kinds = ((history ?? []) as { kind: string }[]).map((h) => h.kind);
    check('lo storico registra creazione e attivazione',
      kinds.includes('created') && kinds.includes('activated'), kinds.join(','));
    check('e l’attore è la persona, non il «sistema»',
      ((history ?? []) as { actor_user_id: string | null }[]).every((h) => h.actor_user_id === andrea.id));

    // Marco è owner di B, non di A: non deve vedere lo storico di A.
    const { data: seen } = await clientB.from('workflow_events').select('id').eq('workflow_id', wf.id);
    check('lo storico di un’altra azienda non è leggibile', (seen ?? []).length === 0);
  }

  // =========================================================================
  section('12 · «È diventata scaduta»: idempotente per costruzione');
  // =========================================================================
  {
    const companyG = await makeCompany(`Prova Automazioni G ${Date.now()}`, andrea.id);
    await makeWorkflow(companyG, andrea.id, {
      name: 'Scadute',
      trigger_type: 'task_became_overdue',
      conditions: [],
      actions: [{ key: 'create_notification', config: { recipient: 'admins', messageTemplate: 'In ritardo: {{task.title}}' } }],
    });

    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await admin.from('tasks').insert({
      company_id: companyG, title: 'Scaduta ieri', priority: 'high', status: 'open',
      source: 'manual', due_date: yesterday,
    });

    const { data: n1 } = await admin.rpc('automation_emit_overdue', { p_lookback_days: 3, p_limit: 50 } as never);
    const { data: n2 } = await admin.rpc('automation_emit_overdue', { p_lookback_days: 3, p_limit: 50 } as never);
    const overdue = await eventsOf(companyG, 'task_became_overdue');
    check('la scansione emette l’evento una volta sola, anche eseguita due volte',
      overdue.length === 1, `n1=${n1} n2=${n2} eventi=${overdue.length}`);
    check('e l’evento porta una chiave di deduplicazione', !!overdue[0]?.dedupe_key);

    await drain(companyG);
    const { data: notifications } = await admin.from('notifications')
      .select('id, type, entity_type, payload').eq('company_id', companyG);
    check('l’azione ha prodotto una notifica di tipo «automazione»',
      (notifications ?? []).length === 1
      && (notifications ?? [])[0].type === 'workflow_alert',
      JSON.stringify(notifications));
    check('e il testo è quello scritto nella regola',
      ((notifications ?? [])[0]?.payload as { text?: string })?.text === 'In ritardo: Scaduta ieri',
      JSON.stringify((notifications ?? [])[0]?.payload));
  }

  // =========================================================================
  section('13 · La coda: prenotazione, lease e conteggio dei tentativi (§61)');
  // =========================================================================
  {
    const companyH = await makeCompany(`Prova Automazioni H ${Date.now()}`, andrea.id);
    await makeWorkflow(companyH, andrea.id, { name: 'Per la coda' });
    const doc = await makeDocument(companyH, 'Per la coda');
    await makeAnalysis(companyH, doc);
    await sleep(200);

    const before = await eventsOf(companyH, 'document_analysis_completed');
    check('c’è un evento in coda', before.length === 1);
    check('con zero tentativi', before[0]?.attempts === 0, String(before[0]?.attempts));

    const claimed = await claimEvents(sb, 20, 120, 50);
    const mine = claimed.filter((e) => e.company_id === companyH);
    check('la prenotazione restituisce l’evento', mine.length === 1);
    check('e il tentativo viene contato al momento della PRESA, non del fallimento',
      mine[0]?.attempts === 1, String(mine[0]?.attempts));

    // Una seconda prenotazione immediata non deve riprendere la stessa riga:
    // il lease è ancora valido.
    const again = await claimEvents(sb, 20, 120, 50);
    check('una seconda prenotazione non riprende una riga già prenotata',
      !again.some((e) => e.id === mine[0].id));

    // Si rilascia ciò che è stato preso, per non lasciare righe appese.
    for (const e of claimed) {
      await admin.from('automation_events')
        .update({ processing_status: 'pending', locked_until: null, lock_id: null, attempts: 0 })
        .eq('id', e.id);
    }
  }

  // =========================================================================
  section('14 · La categoria scelta da una persona non si sovrascrive (§89/§143)');
  // =========================================================================
  {
    const companyI = await makeCompany(`Prova Automazioni I ${Date.now()}`, andrea.id);
    await makeWorkflow(companyI, andrea.id, {
      name: 'Classifica',
      conditions: [],
      actions: [{ key: 'set_document_category', config: { category: 'taxes' } }],
    });

    const doc = await makeDocument(companyI, 'Già classificato a mano');
    // Una scelta MANUALE: la scrive il client autenticato, così il guardiano
    // della 0017 la marca come tale.
    const { error: catError } = await clientA.from('documents')
      .update({ category: 'contracts' } as never).eq('id', doc);
    // Andrea è owner di companyI: la RLS lo autorizza.
    check('la categoria manuale si imposta dal browser', !catError, catError?.message);

    await makeAnalysis(companyI, doc);
    await sleep(200);
    await drain(companyI);

    const { data: after } = await admin.from('documents')
      .select('category, category_source').eq('id', doc).single();
    check('una categoria scelta da una persona NON viene sovrascritta da una regola',
      after?.category === 'contracts' && after?.category_source === 'manual',
      JSON.stringify(after));

    const { data: actionRuns } = await admin.from('workflow_action_runs')
      .select('status, error_code').eq('company_id', companyI);
    check('e lo storico lo DICHIARA invece di tacere',
      (actionRuns ?? []).some((a: { error_code: string | null }) => a.error_code === 'manual_category'),
      JSON.stringify(actionRuns));
  }

  // =========================================================================
  section('15 · La regola classifica davvero, e la catena eredita (§68/§89)');
  // =========================================================================
  {
    // ⚠️ La sezione 14 prova il caso in cui la regola si FERMA. Questa prova il
    // caso in cui AGISCE — ed è l'unico posto in cui il valore `workflow` di
    // `document_category_source` viene davvero scritto: senza, avremmo aggiunto
    // un'etichetta a un enum e dato per buono che funzionasse.
    const companyL = await makeCompany(`Prova Automazioni L ${Date.now()}`, andrea.id);
    await makeWorkflow(companyL, andrea.id, {
      name: 'Classifica come imposte',
      conditions: [],
      actions: [{ key: 'set_document_category', config: { category: 'taxes' } }],
    });
    // Una seconda regola, sull'evento DERIVATO: serve sia a far nascere quel
    // secondo evento (senza ascoltatori non se ne scrive nessuno) sia a
    // verificare che la catena venga ereditata invece di ripartire da capo.
    await makeWorkflow(companyL, andrea.id, {
      name: 'Reagisce al cambio di categoria',
      trigger_type: 'document_category_changed',
      conditions: [],
      actions: [{ key: 'create_task', config: { titleTemplate: 'Rivedere {{document.title}}', priority: 'low', dueDate: 'none' } }],
    });

    const doc = await makeDocument(companyL, 'Rendiconto IVA Q2');
    // Un'analisi che la regola deterministica della 0017 NON sa classificare
    // (`information` + `private`): così la categoria la mette la REGOLA, e non
    // la classificazione automatica del prodotto.
    await makeAnalysis(companyL, doc, {
      document_type: 'information', sender_authority_type: 'private', deadline: null, amount: null,
    });
    await sleep(200);
    await drain(companyL);

    const { data: after } = await admin.from('documents')
      .select('category, category_source, category_workflow_run_id').eq('id', doc).single();
    const row = after as { category: string; category_source: string; category_workflow_run_id: string | null };
    check('la regola ha impostato la categoria', row?.category === 'taxes', JSON.stringify(after));
    check('l’origine dichiara «automazione aziendale», non «regola del prodotto» (§89)',
      row?.category_source === 'workflow', String(row?.category_source));
    check('e dice QUALE esecuzione l’ha messa (§42)', !!row?.category_workflow_run_id);

    const changed = await eventsOf(companyL, 'document_category_changed');
    check('il cambio di categoria ha prodotto un evento', changed.length === 1,
      `trovati ${changed.length}`);
    const analysed = await eventsOf(companyL, 'document_analysis_completed');
    check('che EREDITA la catena invece di ripartire da capo (§68)',
      changed[0]?.correlation_id === analysed[0]?.correlation_id,
      `${changed[0]?.correlation_id} vs ${analysed[0]?.correlation_id}`);
    check('e ne eredita la profondità', changed[0]?.chain_depth === 1,
      String(changed[0]?.chain_depth));

    const { data: tasksL } = await admin.from('tasks').select('title, source').eq('company_id', companyL);
    check('la seconda regola ha agito sull’evento derivato: le catene utili funzionano (§71)',
      (tasksL ?? []).length === 1 && (tasksL ?? [])[0].title === 'Rivedere Rendiconto IVA Q2',
      JSON.stringify(tasksL));
  }

  // =========================================================================
  section('16 · Una regola CRM crea un’attività COLLEGATA alla controparte (0026)');
  // =========================================================================
  {
    // ⚠️ IL DIFETTO CHE QUESTA SEZIONE SORVEGLIA: fino al 2026-07-30
    // `create_task` non scriveva `crm_organization_id` né `crm_opportunity_id`.
    // L'attività nasceva, compariva nel Work Hub, e sulla scheda del cliente non
    // c'era — cioè mancava proprio dove il CRM esiste per farla comparire. La
    // casella «collega l'entità» del generatore era spuntata e non faceva nulla:
    // nessun test poteva vederlo, perché nessuno guardava quelle due colonne.
    const companyM = await makeCompany(`Prova Automazioni M ${Date.now()}`, andrea.id);
    await makeWorkflow(companyM, andrea.id, {
      name: 'Nuova trattativa senza responsabile',
      trigger_type: 'crm_opportunity_created',
      conditions: [{ field: 'opportunity.owner', operator: 'not_exists' }],
      actions: [{
        key: 'create_task',
        config: {
          titleTemplate: '{{organization.name}} — {{opportunity.title}}',
          priority: 'medium', dueDate: 'in_days', dueDateDays: 0, linkEntity: true,
        },
      }],
    });

    const { data: orgM, error: orgErr } = await admin.from('crm_organizations')
      .insert({ company_id: companyM, display_name: 'Bernasconi Prova SA' })
      .select('id').single();
    check('la controparte di prova esiste', !orgErr, orgErr?.message ?? '');
    const { data: oppM, error: oppErr } = await admin.from('crm_opportunities').insert({
      company_id: companyM, organization_id: (orgM as { id: string }).id,
      title: 'Impianto di riscaldamento', stage: 'lead',
    }).select('id').single();
    check('la trattativa di prova esiste', !oppErr, oppErr?.message ?? '');

    await sleep(200);
    await drain(companyM);

    const { data: tasksM } = await admin.from('tasks')
      .select('title, source, due_date, crm_organization_id, crm_opportunity_id')
      .eq('company_id', companyM);
    const taskM = ((tasksM ?? []) as Array<Record<string, unknown>>)[0];
    check('la regola CRM ha creato l’attività',
      (tasksM ?? []).length === 1 && taskM?.source === 'workflow', JSON.stringify(tasksM));
    check('il titolo compone i due nomi propri, senza testo in una lingua sola',
      taskM?.title === 'Bernasconi Prova SA — Impianto di riscaldamento', String(taskM?.title));
    check('⚠️ l’attività è COLLEGATA alla controparte',
      taskM?.crm_organization_id === (orgM as { id: string }).id,
      `${String(taskM?.crm_organization_id)} vs ${(orgM as { id: string }).id}`);
    check('⚠️ e alla trattativa che l’ha fatta nascere',
      taskM?.crm_opportunity_id === (oppM as { id: string }).id,
      `${String(taskM?.crm_opportunity_id)} vs ${(oppM as { id: string }).id}`);
    check('la scadenza «fra 0 giorni» è oggi, non «nessuna scadenza»',
      taskM?.due_date === new Date().toISOString().slice(0, 10), String(taskM?.due_date));

    // CONTROPROVA sul percorso opposto: senza «collega», nessun collegamento —
    // altrimenti il caso qui sopra proverebbe solo che le colonne si scrivono
    // sempre, il che è un'altra cosa.
    await makeWorkflow(companyM, andrea.id, {
      name: 'Trattativa vinta, attività scollegata',
      trigger_type: 'crm_opportunity_won',
      conditions: [],
      actions: [{
        key: 'create_task',
        config: { titleTemplate: '{{opportunity.title}}', priority: 'low', dueDate: 'none', linkEntity: false },
      }],
    });
    await admin.from('crm_opportunities').update({ stage: 'won' })
      .eq('id', (oppM as { id: string }).id);
    await sleep(200);
    await drain(companyM);
    const { data: tasksM2 } = await admin.from('tasks')
      .select('title, crm_organization_id').eq('company_id', companyM)
      .eq('title', 'Impianto di riscaldamento');
    const unlinkedTask = ((tasksM2 ?? []) as Array<Record<string, unknown>>)[0];
    check('senza «collega» l’attività nasce SENZA controparte',
      (tasksM2 ?? []).length === 1 && unlinkedTask?.crm_organization_id === null,
      JSON.stringify(tasksM2));
  }

  // ---- pulizia -------------------------------------------------------------
  // ⚠️ Una pulizia incompleta FA FALLIRE il test. Lezione del 2026-07-27:
  // `cleanup()` dell'Inbox ignorava l'esito delle delete e due aziende di prova
  // sono rimaste nel database di produzione, viste solo grazie a
  // `inbox:diagnose`.
  section('Pulizia');
  {
    const problems: string[] = [];
    for (const id of created.companies) {
      const { error } = await admin.from('companies').delete().eq('id', id);
      if (error) problems.push(`azienda ${id}: ${error.message}`);
    }
    for (const id of created.users) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) problems.push(`utente ${id}: ${error.message}`);
    }
    // Si verifica che siano DAVVERO sparite, non che le delete non abbiano
    // sollevato: supabase-js non solleva, restituisce `{ error }`.
    const { count } = await admin.from('companies')
      .select('id', { count: 'exact', head: true }).in('id', created.companies);
    check('tutte le aziende di prova sono state rimosse',
      problems.length === 0 && (count ?? 0) === 0, problems.join(' | ') || `rimaste ${count}`);
  }

  console.log(`\n${B}Risultato${X}  ${pass} superati, ${fail} falliti\n`);
  process.exit(fail ? 1 : 0);
}

main().catch((e) => {
  console.error(`\n${R}Errore:${X}`, e);
  process.exit(1);
});
