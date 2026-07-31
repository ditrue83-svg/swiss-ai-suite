// ============================================================================
// AI-Swisse — Incentivi / Subsidy AI 2.0: test d'integrazione sul DATABASE REALE.
//   npm run test:subsidy
//
// Richiede le migrazioni 0032, 0033 e 0034 applicate, e `.env.test` valorizzato.
//
// ⚠️ PERCHÉ ESISTE. Incentivi era l'unico modulo in esercizio **senza** una
// suite su database: 277 asserzioni offline, e un end-to-end fatto a mano una
// volta sola dall'interfaccia. `docs/product-status.md` lo dichiarava come
// «Testato: parziale», e quella parola era esatta.
//
// ⚠️⚠️ E c'è un difetto preciso che nessun test poteva vedere, perché nessun
// test cancellava un'azienda che avesse risposto a un criterio: la guardia
// append-only di `subsidy_answers` sollevava dentro la CASCATA, e **una sola
// riga in `subsidy_answers` rendeva l'azienda indistruttibile** (23514). L'ha
// trovato una persona che ripuliva i dati di prova. La 0033 e la 0034 lo
// chiudono; la sezione 5 e la sezione 11 di questo file sono il motivo per cui
// non potrà tornare senza che qualcosa diventi rosso.
//
// Non prova che il codice sia scritto bene: prova che le GARANZIE siano in
// vigore, e stanno tutte nel DATABASE — un servizio ben educato non è una
// garanzia (0013 → 0014).
//
//    1. ISOLAMENTO  — A non vede nulla di B, tabella per tabella, e NEMMENO
//                     chiamando le quattro funzioni di lettura col
//                     `p_company_id` di A.
//    2. CROSS-TENANT— nessun legame fra entità di aziende diverse, e nemmeno
//                     il service role può crearne uno.
//    3. CATALOGO    — sola lettura per il client, e ciò che non deve leggere
//                     non lo legge. È il difetto della 0007, vivo dal 25 luglio
//                     e chiuso dalla 0032: qui resta sorvegliato.
//    4. RISPOSTE    — append-only, firmate dal database, in DUE strati: il
//                     permesso di colonna e il trigger.
//    5. CASCATA     — 0034: cancellato il PROGETTO le risposte se ne vanno;
//                     e la cancellazione diretta resta vietata. I due lati
//                     insieme, perché provarne uno solo non dice niente.
//    6. VALIDAZIONE — le sei guardie che rifiutano un dato che si contraddice.
//    7. TIMBRI      — invio, archiviazione e istantanea li scrive il database.
//    8. STORICO     — lo scrivono i trigger; il client non può firmare.
//    9. VISTE       — le sette viste dell'elenco filtrano DAVVERO.
//   10. PANORAMICA  — `subsidy_home_summary` conta la stessa cosa delle tabelle.
//   11. CASCATA AZIENDA — 0033: cancellata l'azienda non resta niente, e
//                     l'elenco delle tabelle si LEGGE DALLE MIGRAZIONI.
//
// ⚠️ Il database di `.env.test` è la PRODUZIONE. Si creano aziende usa-e-getta
// e si rimuovono; l'ORDINE non è indifferente (PRIMA l'azienda, POI l'utente:
// al contrario resta un'azienda orfana, invisibile perché la RLS filtra per
// appartenenza), e **una pulizia incompleta fa fallire il test** — supabase-js
// non solleva, restituisce `{ error }`, e ignorarlo ha già lasciato aziende di
// prova in produzione due volte.
//
// ⚠️ IL CATALOGO NON SI SCRIVE. Le versioni dei programmi sono globali, non per
// azienda: crearne una qui sporcherebbe il catalogo di tutti. Si LEGGE una
// versione pubblicata esistente, e se non ce n'è il test **fallisce
// dichiarandolo** invece di saltare in silenzio.
// ============================================================================
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

if (!globalThis.WebSocket) (globalThis as { WebSocket?: unknown }).WebSocket = WebSocket;

const HERE = dirname(fileURLToPath(import.meta.url));
const APP = resolve(HERE, '..');

const URL = process.env.SUPABASE_URL;
const ANON = process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON || !SERVICE) {
  console.error('Mancano SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY in .env.test');
  process.exit(2);
}

const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
const anonClient = () => createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
type Client = ReturnType<typeof anonClient>;

const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
let pass = 0, fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);
const msg = (e: unknown) => (e as { message?: string } | null)?.message ?? '';
const code = (e: unknown) => (e as { code?: string } | null)?.code ?? '';
/** Il testo su cui asserire: messaggio + codice, perché i due si completano. */
const why = (e: unknown) => `${msg(e)} ${code(e)}`.trim();

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

async function makeTenant(label: string) {
  const email = `subsidy.${label}.${stamp}@swissai-suite.ch`;
  const { data: u, error: ue } = await withRetry(() =>
    admin.auth.admin.createUser({ email, password: PW, email_confirm: true }));
  if (ue || !u?.user) throw new Error(`utente ${label}: ${msg(ue)}`);
  created.users.push(u.user.id);

  const client = anonClient();
  const { error: se } = await client.auth.signInWithPassword({ email, password: PW });
  if (se) throw new Error(`login ${label}: ${msg(se)}`);

  const { data: cid, error: ce } = await client.rpc('create_company_with_owner', {
    p_legal_name: `Subsidy ${label} ${stamp}`,
  });
  if (ce || !cid) throw new Error(`azienda ${label}: ${msg(ce)}`);
  created.companies.push(cid as string);

  return { userId: u.user.id, companyId: cid as string, client };
}

/** Un progetto creato DAL CLIENT, cioè per la strada che percorre l'interfaccia. */
async function makeProject(client: Client, companyId: string, title: string,
  extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await client.from('subsidy_projects')
    .insert({ company_id: companyId, title, ...extra }).select('id').single();
  if (error) throw new Error(`progetto «${title}»: ${why(error)}`);
  return (data as { id: string }).id;
}

/**
 * Le opportunità le scrive IL MOTORE, non il client: qui si usa il ruolo di
 * servizio perché è il ruolo che le scriverebbe davvero. Farlo dal client
 * proverebbe una strada che in produzione non esiste.
 */
async function makeOpportunity(companyId: string, projectId: string | null,
  version: { id: string; program_id: string }, extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin.from('subsidy_opportunities').insert({
    company_id: companyId, project_id: projectId, program_id: version.program_id,
    program_version_id: version.id, ...extra,
  }).select('id').single();
  if (error) throw new Error(`opportunità: ${why(error)}`);
  return (data as { id: string }).id;
}

async function makeCase(companyId: string, version: { program_id: string },
  extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await admin.from('subsidy_cases').insert({
    company_id: companyId, program_id: version.program_id, ...extra,
  }).select('id').single();
  if (error) throw new Error(`pratica: ${why(error)}`);
  return (data as { id: string }).id;
}

async function makeDocument(companyId: string, title: string): Promise<string> {
  const { data, error } = await admin.from('documents')
    .insert({ company_id: companyId, title, source_type: 'upload', status: 'completed' })
    .select('id').single();
  if (error) throw new Error(`documento: ${why(error)}`);
  return (data as { id: string }).id;
}

/** Quante righe di questa tabella appartengono a questa azienda. */
async function countFor(table: string, companyId: string): Promise<number> {
  const { data } = await admin.from(table).select('id').eq('company_id', companyId);
  return ((data ?? []) as unknown[]).length;
}

/**
 * Le tabelle del dominio incentivi che hanno una `company_id`, LETTE DALLE
 * MIGRAZIONI e non elencate a mano.
 *
 * ⚠️ È la lezione del test delle notifiche, che enumerava sette tipi mentre il
 * database ne ammetteva tredici: **una lista scritta a mano non fallisce
 * quando l'insieme cresce — smette di guardare e resta verde.** Qui una
 * tabella aggiunta domani entra da sé nella verifica della cascata.
 */
function subsidyTablesWithCompany(): string[] {
  const dir = join(APP, 'supabase', 'migrations');
  const trovate = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, file), 'utf8');
    const re = /create table (?:if not exists )?public\.(subsidy_\w+)\s*\(([\s\S]*?)\n\);/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sql)) !== null) {
      if (/^\s*company_id\s/m.test(m[2])) trovate.add(m[1]);
    }
  }
  return [...trovate].sort();
}

// ===========================================================================
async function main() {
  console.log(`${B}Incentivi / Subsidy AI 2.0 — test sul database reale${X}  ${DIM}${URL}${X}`);

  // ⚠️ Nessun ripiego: senza una versione pubblicata questo test non può
  // provare niente, e dirlo è l'unica risposta onesta.
  const { data: versions, error: ve } = await admin.from('subsidy_program_versions')
    .select('id, program_id, status').eq('status', 'published').limit(2);
  if (ve) throw new Error(`catalogo: ${why(ve)}`);
  const published = (versions ?? []) as Array<{ id: string; program_id: string }>;
  if (published.length === 0) {
    console.error(`\n${R}Nessuna versione di programma PUBBLICATA nel catalogo: il test non può`
      + ` provare niente e non finge di averlo fatto. Eseguire prima npm run subsidy:seed-catalog.${X}`);
    process.exit(2);
  }
  const V = published[0];

  const A = await makeTenant('a');
  const Bt = await makeTenant('b');

  // -------------------------------------------------------------------------
  section('1. Isolamento — A non vede nulla di B, e viceversa');

  const projA = await makeProject(A.client, A.companyId, `Progetto A ${stamp}`, {
    stage: 'planned', location_canton: 'TI', sector: 'ict',
  });
  const projB = await makeProject(Bt.client, Bt.companyId, `Progetto B ${stamp}`);
  const oppA = await makeOpportunity(A.companyId, projA, V, { relevance_level: 'high', relevance_score: 80 });
  const oppB = await makeOpportunity(Bt.companyId, projB, V);
  // ⚠️ L'istantanea si scrive ALLA CREAZIONE e mai più (§109): il permesso di
  // colonna la concede in `insert` e la nega in `update`, e il trigger la
  // ricopia dall'esistente. Passarla qui non è un dettaglio del test — è
  // l'unico momento in cui il prodotto la scrive.
  const caseA = await makeCase(A.companyId, V, {
    project_id: projA, opportunity_id: oppA, created_by: A.userId,
    program_snapshot: { criteri: ['originale'] }, snapshot_hash: 'originale',
  });

  const { data: projLeak } = await Bt.client.from('subsidy_projects').select('id').eq('id', projA);
  check('B non vede il progetto di A leggendo la tabella per id',
    ((projLeak ?? []) as unknown[]).length === 0);

  // ⚠️ IL CONTROLLO CHE CONTA DI PIÙ: le quattro funzioni di lettura sono
  // `security invoker` e ricevono `p_company_id` DAL CLIENT. Se la RLS non
  // reggesse, passare l'id altrui basterebbe.
  const { data: rpcProj } = await Bt.client.rpc('list_subsidy_projects', { p_company_id: A.companyId });
  check('B non ottiene i progetti di A nemmeno passando il p_company_id di A',
    ((rpcProj ?? []) as unknown[]).length === 0, `righe: ${((rpcProj ?? []) as unknown[]).length}`);

  const { data: rpcOpp } = await Bt.client.rpc('list_subsidy_opportunities', { p_company_id: A.companyId });
  check('né le opportunità', ((rpcOpp ?? []) as unknown[]).length === 0);

  const { data: rpcCase } = await Bt.client.rpc('list_subsidy_cases', { p_company_id: A.companyId });
  check('né le pratiche', ((rpcCase ?? []) as unknown[]).length === 0);

  const { data: rpcHome } = await Bt.client.rpc('subsidy_home_summary', { p_company_id: A.companyId });
  const home = (rpcHome ?? {}) as Record<string, number>;
  check('né i conteggi della Panoramica',
    Object.values(home).every((v) => typeof v !== 'number' || v === 0), JSON.stringify(home));

  await A.client.from('subsidy_answers').insert({
    company_id: A.companyId, project_id: projA, program_version_id: V.id,
    rule_key: 'sede_in_ticino', value: 'yes',
  });
  const { data: ansLeak } = await Bt.client.from('subsidy_answers').select('id').eq('company_id', A.companyId);
  check('B non vede le risposte ai criteri di A', ((ansLeak ?? []) as unknown[]).length === 0);

  // ⚠️⚠️ IL LATO POSITIVO, e senza di esso tutta questa sezione sarebbe un
  // verde falso: sei asserzioni «zero righe» sono vere anche se le funzioni
  // sono rotte per TUTTI. Che A veda le proprie cose è ciò che rende
  // informativo il fatto che B non le veda. È la lezione di `i18n:coverage`,
  // che dichiarava «nessuna stringa da tradurre» mentre non ne guardava
  // nessuna.
  const { data: propriProj, error: ppErr } = await A.client
    .rpc('list_subsidy_projects', { p_company_id: A.companyId });
  check('e intanto A vede il PROPRIO progetto: gli zeri qui sopra non sono una funzione rotta',
    !ppErr && ((propriProj ?? []) as unknown[]).length === 1, why(ppErr));

  const { data: proprieOpp } = await A.client
    .rpc('list_subsidy_opportunities', { p_company_id: A.companyId });
  check('e la propria opportunità', ((proprieOpp ?? []) as unknown[]).length === 1);

  const { data: propriePratiche } = await A.client
    .rpc('list_subsidy_cases', { p_company_id: A.companyId });
  check('e la propria pratica', ((propriePratiche ?? []) as unknown[]).length === 1);

  const { data: proprioHome } = await A.client
    .rpc('subsidy_home_summary', { p_company_id: A.companyId });
  check('e i propri conteggi non sono a zero',
    ((proprioHome ?? {}) as Record<string, number>).highRelevance === 1,
    JSON.stringify(proprioHome));

  // -------------------------------------------------------------------------
  section('2. Cross-tenant — nemmeno il service role crea un legame fra aziende');

  const crossCase = await admin.from('subsidy_cases')
    .insert({ company_id: A.companyId, program_id: V.program_id, project_id: projB });
  check('una pratica di A non può puntare a un progetto di B',
    /subsidy_project_cross_tenant/.test(msg(crossCase.error)), why(crossCase.error));

  const crossOpp = await admin.from('subsidy_cases')
    .insert({ company_id: A.companyId, program_id: V.program_id, opportunity_id: oppB });
  check('né a un’opportunità di B',
    /subsidy_opportunity_cross_tenant/.test(msg(crossOpp.error)), why(crossOpp.error));

  const crossAns = await admin.from('subsidy_answers').insert({
    company_id: A.companyId, project_id: projB, program_version_id: V.id,
    rule_key: 'sede_in_ticino', value: 'yes',
  });
  check('una risposta di A non può riferirsi a un progetto di B',
    /subsidy_project_cross_tenant/.test(msg(crossAns.error)), why(crossAns.error));

  const docB = await makeDocument(Bt.companyId, `Documento B ${stamp}`);
  const crossDoc = await admin.from('subsidy_project_documents')
    .insert({ company_id: A.companyId, project_id: projA, document_id: docB });
  check('un documento di B non si collega a un progetto di A',
    Boolean(crossDoc.error), why(crossDoc.error));

  // -------------------------------------------------------------------------
  section('3. Il catalogo è in sola lettura per il client');

  // ⚠️ QUESTA SEZIONE SORVEGLIA IL DIFETTO DELLA 0007, vivo dal 25 luglio: un
  // `grant select` scritto senza un `revoke all` che lo preceda AGGIUNGE una
  // lettura ai privilegi pieni che Supabase concede per default, e
  // `subsidy_programs` era scrivibile da `anon` e `authenticated`. La RLS
  // respingeva comunque — ma il permesso c'era, e sarebbe bastata una policy
  // aggiunta «per comodità» perché un cliente riscrivesse i requisiti che il
  // prodotto presenta a tutti gli altri.
  const catalogoScrittura: Array<[string, Record<string, unknown>]> = [
    ['subsidy_programs', { id: `test-${stamp}`, name: 'Falso programma' }],
    ['subsidy_program_versions', { program_id: V.program_id, version: 999 }],
    ['subsidy_program_rules', { program_version_id: V.id, rule_key: 'falso' }],
    ['subsidy_calls', { program_version_id: V.id }],
    ['subsidy_sources', { url: 'https://example.invalid' }],
  ];
  for (const [table, row] of catalogoScrittura) {
    const { error } = await A.client.from(table).insert(row);
    check(`un membro non può scrivere in ${table}`, Boolean(error), why(error));
  }
  const updProg = await A.client.from('subsidy_programs')
    .update({ name: 'Riscritto' }).eq('id', V.program_id);
  check('né riscrivere un programma esistente', Boolean(updProg.error), why(updProg.error));

  // ⚠️ Due tabelle non si leggono affatto: i controlli tecnici sulle fonti e la
  // coda delle revisioni sono lavoro interno, non contenuto di prodotto.
  for (const table of ['subsidy_source_fetches', 'subsidy_catalog_reviews']) {
    const { error } = await A.client.from(table).select('id').limit(1);
    check(`un membro non può nemmeno LEGGERE ${table}`, Boolean(error), why(error));
  }
  const { data: canRead, error: readErr } = await A.client.from('subsidy_program_rules')
    .select('id').eq('program_version_id', V.id).limit(1);
  check('ma i criteri di una versione pubblicata li legge',
    !readErr && Array.isArray(canRead), why(readErr));

  // -------------------------------------------------------------------------
  section('4. Le risposte sono append-only e firmate dal database');

  const { data: ansRows } = await admin.from('subsidy_answers')
    .select('id, answered_by, answered_at').eq('company_id', A.companyId);
  const ans = ((ansRows ?? []) as Array<{ id: string; answered_by: string; answered_at: string }>)[0];
  check('la risposta scritta dal client esiste', Boolean(ans), `righe: ${(ansRows ?? []).length}`);
  check('e la firma è di chi ha risposto, non di chi l’ha dichiarato',
    ans?.answered_by === A.userId, `${ans?.answered_by} ≠ ${A.userId}`);
  check('con il timbro dell’ora scritto dal database', Boolean(ans?.answered_at));

  // ⚠️ DUE STRATI, e vanno provati separatamente perché rispondono a due
  // domande diverse: il permesso di COLONNA impedisce di nominare `answered_by`
  // (il client non può nemmeno provarci), il TRIGGER impedisce la modifica a
  // chiunque, service role compreso.
  const firmaFalsa = await A.client.from('subsidy_answers').insert({
    company_id: A.companyId, project_id: projA, program_version_id: V.id,
    rule_key: 'firma_falsa', value: 'yes', answered_by: Bt.userId,
  });
  check('il client non può nemmeno NOMINARE answered_by: lo ferma il permesso di colonna',
    Boolean(firmaFalsa.error), why(firmaFalsa.error));

  const updAnsClient = await A.client.from('subsidy_answers').update({ value: 'no' }).eq('id', ans.id);
  check('un membro non può modificare una risposta', Boolean(updAnsClient.error), why(updAnsClient.error));

  const updAnsAdmin = await admin.from('subsidy_answers').update({ value: 'no' }).eq('id', ans.id);
  check('e nemmeno il service role: il trigger la respinge',
    /subsidy_answers_append_only/.test(msg(updAnsAdmin.error)), why(updAnsAdmin.error));

  const delAnsAdmin = await admin.from('subsidy_answers').delete().eq('id', ans.id);
  check('la cancellazione DIRETTA di una risposta resta vietata (§187)',
    /subsidy_answers_append_only/.test(msg(delAnsAdmin.error)), why(delAnsAdmin.error));

  const { data: still } = await admin.from('subsidy_answers').select('value').eq('id', ans.id).single();
  check('dopo i tentativi la risposta è ancora quella di prima',
    (still as { value?: string } | null)?.value === 'yes', JSON.stringify(still));

  // Rispondere di nuovo scrive una riga NUOVA: la storia non si sovrascrive.
  await A.client.from('subsidy_answers').insert({
    company_id: A.companyId, project_id: projA, program_version_id: V.id,
    rule_key: 'sede_in_ticino', value: 'no', note: 'cambiata idea',
  });
  const { data: dueRisposte } = await admin.from('subsidy_answers')
    .select('id, value').eq('company_id', A.companyId).eq('rule_key', 'sede_in_ticino');
  check('rispondere di nuovo AGGIUNGE una riga invece di sovrascrivere',
    ((dueRisposte ?? []) as unknown[]).length === 2, `righe: ${(dueRisposte ?? []).length}`);

  // -------------------------------------------------------------------------
  section('5. La cascata del PROGETTO (0034) — e la cancellazione diretta resta vietata');

  // ⚠️ È il difetto che ha reso un'azienda indistruttibile, nella sua forma
  // «progetto». I DUE LATI insieme: un controllo che provasse solo la cascata
  // non vedrebbe un append-only smontato per sbaglio, e uno che provasse solo
  // il divieto non vedrebbe il progetto tornare indistruttibile.
  const projTemp = await makeProject(A.client, A.companyId, `Progetto usa-e-getta ${stamp}`);
  await A.client.from('subsidy_answers').insert({
    company_id: A.companyId, project_id: projTemp, program_version_id: V.id,
    rule_key: 'criterio_del_progetto_temporaneo', value: 'unknown',
  });
  const ansTemp = await countFor('subsidy_answers', A.companyId);
  check('il progetto usa-e-getta ha una risposta collegata', ansTemp === 3, `risposte: ${ansTemp}`);

  const delTempDirect = await admin.from('subsidy_answers')
    .delete().eq('project_id', projTemp);
  check('finché il progetto esiste, la sua risposta non si cancella',
    /subsidy_answers_append_only/.test(msg(delTempDirect.error)), why(delTempDirect.error));

  const delProj = await admin.from('subsidy_projects').delete().eq('id', projTemp);
  check('cancellato il PROGETTO, la cascata passa: nessun 23514 (0034)',
    !delProj.error, why(delProj.error));

  const { data: orfane } = await admin.from('subsidy_answers').select('id').eq('project_id', projTemp);
  check('e la risposta se n’è andata con lui', ((orfane ?? []) as unknown[]).length === 0);

  const restano = await countFor('subsidy_answers', A.companyId);
  check('mentre le risposte degli ALTRI progetti restano intatte',
    restano === 2, `risposte: ${restano}`);

  // -------------------------------------------------------------------------
  section('6. Le guardie che rifiutano un dato che si contraddice');

  const dateInverse = await A.client.from('subsidy_projects').insert({
    company_id: A.companyId, title: `Date inverse ${stamp}`,
    estimated_start_date: '2026-09-01', estimated_end_date: '2026-08-01',
  });
  check('un progetto che finisce prima di cominciare è rifiutato',
    /subsidy_project_dates_inverted/.test(msg(dateInverse.error)), why(dateInverse.error));

  const senzaValuta = await A.client.from('subsidy_projects').insert({
    company_id: A.companyId, title: `Senza valuta ${stamp}`, budget_amount: 180000,
  });
  check('un budget senza valuta è rifiutato: nessun CHF d’ufficio',
    /subsidy_project_currency_required/.test(msg(senzaValuta.error)), why(senzaValuta.error));

  const ownerEstraneo = await A.client.from('subsidy_projects').insert({
    company_id: A.companyId, title: `Responsabile estraneo ${stamp}`, owner_user_id: Bt.userId,
  });
  check('il responsabile di un progetto è membro dell’azienda',
    /subsidy_project_owner_not_member/.test(msg(ownerEstraneo.error)), why(ownerEstraneo.error));

  const caseOwner = await admin.from('subsidy_cases').insert({
    company_id: A.companyId, program_id: V.program_id, owner_user_id: Bt.userId,
  });
  check('e così il responsabile di una pratica',
    /subsidy_case_owner_not_member/.test(msg(caseOwner.error)), why(caseOwner.error));

  const caseValuta = await admin.from('subsidy_cases').insert({
    company_id: A.companyId, program_id: V.program_id, amount_requested: 50000,
  });
  check('un importo richiesto senza valuta è rifiutato',
    /subsidy_case_currency_required/.test(msg(caseValuta.error)), why(caseValuta.error));

  const esitoSenzaInvio = await admin.from('subsidy_cases')
    .update({ outcome: 'approved' }).eq('id', caseA);
  check('«approvata» su una pratica in bozza è rifiutato',
    /subsidy_case_outcome_without_submission/.test(msg(esitoSenzaInvio.error)), why(esitoSenzaInvio.error));

  // -------------------------------------------------------------------------
  section('7. I timbri li scrive il database, non il client');

  const primaDelloSnapshot = await admin.from('subsidy_cases')
    .select('program_snapshot, snapshot_hash').eq('id', caseA).single();
  check('l’istantanea scritta alla creazione c’è',
    (primaDelloSnapshot.data as { snapshot_hash?: string } | null)?.snapshot_hash === 'originale',
    JSON.stringify(primaDelloSnapshot.data));

  // ⚠️ Il client non può nemmeno provarci: `program_snapshot` non è fra le
  // colonne di `grant update`. Il tentativo che conta è quello del SERVICE
  // ROLE, che i permessi non fermano — lo ferma il trigger, ricopiando il
  // valore precedente.
  const snapDalClient = await A.client.from('subsidy_cases')
    .update({ snapshot_hash: 'riscritto dal client' }).eq('id', caseA);
  check('il client non ha il permesso di colonna sull’istantanea',
    Boolean(snapDalClient.error), why(snapDalClient.error));

  await admin.from('subsidy_cases')
    .update({ program_snapshot: { criteri: ['riscritto'] }, snapshot_hash: 'riscritto' })
    .eq('id', caseA);
  const { data: snapDopo } = await admin.from('subsidy_cases')
    .select('program_snapshot, snapshot_hash').eq('id', caseA).single();
  check('e NON si riscrive: l’istantanea è tutto il valore della pratica (§109)',
    (snapDopo as { snapshot_hash?: string } | null)?.snapshot_hash === 'originale',
    JSON.stringify(snapDopo));

  await admin.from('subsidy_cases').update({ status: 'submitted' }).eq('id', caseA);
  const { data: inviata } = await admin.from('subsidy_cases')
    .select('status, submitted_at, submitted_by').eq('id', caseA).single();
  const inv = inviata as { status: string; submitted_at: string | null } | null;
  check('registrato l’invio, il database timbra submitted_at',
    inv?.status === 'submitted' && Boolean(inv?.submitted_at), JSON.stringify(inviata));

  const esitoDopoInvio = await admin.from('subsidy_cases')
    .update({ outcome: 'approved', amount_awarded: 25000, currency: 'CHF' }).eq('id', caseA);
  check('e ORA l’esito si può registrare', !esitoDopoInvio.error, why(esitoDopoInvio.error));

  await A.client.from('subsidy_projects').update({ status: 'archived' }).eq('id', projA);
  const { data: archiviato } = await admin.from('subsidy_projects')
    .select('status, archived_at, archived_by').eq('id', projA).single();
  const arc = archiviato as { archived_at: string | null; archived_by: string | null } | null;
  check('archiviato un progetto, il timbro e l’autore li scrive il database',
    Boolean(arc?.archived_at) && arc?.archived_by === A.userId, JSON.stringify(archiviato));

  await A.client.from('subsidy_projects').update({ status: 'active' }).eq('id', projA);
  const { data: riattivato } = await admin.from('subsidy_projects')
    .select('archived_at, archived_by').eq('id', projA).single();
  check('riattivandolo il timbro si toglie: non resta una data che non significa più niente',
    (riattivato as { archived_at: string | null } | null)?.archived_at === null,
    JSON.stringify(riattivato));

  // -------------------------------------------------------------------------
  section('8. Lo storico della pratica lo scrivono i trigger');

  const { data: eventi } = await admin.from('subsidy_case_events')
    .select('kind, actor_user_id').eq('subsidy_case_id', caseA);
  check('i passaggi di stato hanno lasciato uno storico',
    ((eventi ?? []) as unknown[]).length > 0, `eventi: ${(eventi ?? []).length}`);

  const eventoFalso = await A.client.from('subsidy_case_events').insert({
    company_id: A.companyId, subsidy_case_id: caseA, kind: 'status_changed',
    actor_user_id: Bt.userId,
  });
  check('un membro non può scrivere nello storico: non può firmare per un collega',
    Boolean(eventoFalso.error), why(eventoFalso.error));

  const eventoUpd = await A.client.from('subsidy_case_events')
    .update({ detail: {} }).eq('subsidy_case_id', caseA);
  check('né riscriverlo', Boolean(eventoUpd.error), why(eventoUpd.error));

  const eventoDel = await A.client.from('subsidy_case_events').delete().eq('subsidy_case_id', caseA);
  check('né cancellarlo', Boolean(eventoDel.error), why(eventoDel.error));

  // ⚠️ Di nuovo il lato positivo: tre rifiuti di fila sarebbero verdi anche se
  // la tabella fosse irraggiungibile. Lo storico si LEGGE, ed è il motivo per
  // cui esiste.
  const { data: storicoLetto, error: slErr } = await A.client.from('subsidy_case_events')
    .select('id, kind').eq('subsidy_case_id', caseA);
  check('ma lo storico un membro lo legge: è fatto per essere letto',
    !slErr && ((storicoLetto ?? []) as unknown[]).length > 0, why(slErr));

  // -------------------------------------------------------------------------
  section('9. Le sette viste dell’elenco filtrano davvero');

  const projSaved = await makeProject(A.client, A.companyId, `Progetto salvato ${stamp}`);
  const oppSaved = await makeOpportunity(A.companyId, projSaved, V, { relevance_level: 'medium' });
  await A.client.from('subsidy_opportunities')
    .update({ saved_at: new Date().toISOString() }).eq('id', oppSaved);

  const projDismissed = await makeProject(A.client, A.companyId, `Progetto messo da parte ${stamp}`);
  const oppDismissed = await makeOpportunity(A.companyId, projDismissed, V);
  // ⚠️ `dismissed_at` lo timbra il trigger quando arriva una ragione: il client
  // scrive la RAGIONE, non la data.
  await A.client.from('subsidy_opportunities')
    .update({ dismissed_reason: 'not_relevant' }).eq('id', oppDismissed);

  const ids = async (view: string): Promise<string[]> => {
    const { data, error } = await A.client.rpc('list_subsidy_opportunities', {
      p_company_id: A.companyId, p_view: view,
    });
    if (error) throw new Error(`vista «${view}»: ${why(error)}`);
    return ((data ?? []) as Array<{ id: string }>).map((r) => r.id);
  };

  // ⚠️ «all» NON significa «tutte»: l'`else` della funzione è
  // `o.dismissed_at is null`, quindi l'elenco predefinito esclude ciò che è
  // stato messo da parte — ed è giusto, perché «da parte» è una decisione
  // dell'utente che l'elenco deve rispettare. Verificato leggendo l'SQL dopo
  // che questa asserzione, scritta come «tutte e tre», è diventata rossa.
  const tutte = await ids('all');
  check('«all» mostra le due NON messe da parte, non tutte e tre',
    tutte.length === 2 && !tutte.includes(oppDismissed), `id: ${tutte.length}`);

  const salvate = await ids('saved');
  check('«saved» mostra solo quella salvata',
    salvate.length === 1 && salvate[0] === oppSaved, `id: ${salvate.length}`);

  const scartate = await ids('dismissed');
  check('«dismissed» solo quella messa da parte',
    scartate.length === 1 && scartate[0] === oppDismissed, `id: ${scartate.length}`);

  const nuove = await ids('new');
  check('«new» esclude sia la salvata sia quella messa da parte',
    nuove.length === 1 && nuove[0] === oppA, `id: ${nuove.join(', ')}`);

  const alte = await ids('high');
  check('«high» mostra solo la rilevanza alta',
    alte.length === 1 && alte[0] === oppA, `id: ${alte.length}`);

  // ⚠️ Un `p_view` sconosciuto NON viene rifiutato: cade nell'`else` e si
  // comporta esattamente come «all». NON è un difetto da correggere qui — è il
  // comportamento che la funzione ha, e scriverlo in un test è il modo di
  // accorgersi se un giorno cambia. La conseguenza da conoscere è che
  // un'etichetta di troppo nell'interfaccia mostrerebbe l'elenco predefinito
  // sotto la promessa di un filtro: per questo `test:subsidy-unit` verifica
  // l'elenco delle viste contro l'SQL. Là si impedisce, qui si documenta.
  const inventata = await ids('vista-che-non-esiste');
  check('una vista sconosciuta non è rifiutata: si comporta come «all»',
    inventata.join('|') === tutte.join('|'), `${inventata.length} vs ${tutte.length}`);
  check('e in particolare non fa ricomparire ciò che era stato messo da parte',
    !inventata.includes(oppDismissed));

  // -------------------------------------------------------------------------
  section('10. La Panoramica conta la stessa cosa delle tabelle');

  const { data: sommario, error: sErr } = await A.client.rpc('subsidy_home_summary', {
    p_company_id: A.companyId,
  });
  check('il sommario si legge senza errori', !sErr, why(sErr));
  const s = (sommario ?? {}) as Record<string, unknown>;

  const { data: nonScartate } = await admin.from('subsidy_opportunities')
    .select('id').eq('company_id', A.companyId).is('dismissed_at', null).is('saved_at', null);
  check('«nuove» coincide con le opportunità né salvate né messe da parte',
    s.newOpportunities === ((nonScartate ?? []) as unknown[]).length,
    `sommario ${String(s.newOpportunities)}, tabella ${(nonScartate ?? []).length}`);

  const { data: alteTab } = await admin.from('subsidy_opportunities')
    .select('id').eq('company_id', A.companyId).is('dismissed_at', null).eq('relevance_level', 'high');
  check('«rilevanza alta» coincide con la tabella',
    s.highRelevance === ((alteTab ?? []) as unknown[]).length,
    `sommario ${String(s.highRelevance)}, tabella ${(alteTab ?? []).length}`);

  // -------------------------------------------------------------------------
  section('11. Cascata dell’azienda (0033) — e l’elenco si legge dalle migrazioni');

  const tabelle = subsidyTablesWithCompany();
  // ⚠️ Un parser che non trova niente passerebbe in silenzio: la soglia esiste
  // perché un elenco vuoto è un guasto del controllo, non una buona notizia.
  check(`le tabelle del dominio con company_id si leggono dalle migrazioni (${tabelle.length})`,
    tabelle.length >= 10, tabelle.join(', '));

  const risposteVive = await countFor('subsidy_answers', A.companyId);
  check('⚠️ l’azienda A ha ancora risposte: è la condizione che la rendeva indistruttibile',
    risposteVive > 0, `risposte: ${risposteVive}`);

  await cleanup();

  // ⚠️ DOPO la pulizia, non prima: è insieme il test della cascata e la prova
  // che la pulizia ha davvero pulito.
  for (const table of tabelle) {
    const { data, error } = await admin.from(table).select('id').eq('company_id', A.companyId);
    check(`cancellata l’azienda, ${table} non ha residui`,
      !error && ((data ?? []) as unknown[]).length === 0, why(error));
  }

  console.log(`\n${B}Risultato${X}: ${G}${pass} superati${X}${fail ? `, ${R}${fail} falliti${X}` : ''}`);
  process.exit(fail ? 1 : 0);
}

async function cleanup() {
  let clean = true;
  for (const id of created.companies) {
    const { error } = await admin.from('companies').delete().eq('id', id);
    if (error) { clean = false; console.log(`  ${R}pulizia azienda ${id}: ${why(error)}${X}`); }
  }
  for (const id of created.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) { clean = false; console.log(`  ${R}pulizia utente ${id}: ${why(error)}${X}`); }
  }
  check('la pulizia è riuscita: nessun residuo nel database di produzione', clean);
}

main().catch(async (e) => {
  console.error(`\n${R}Errore: ${msg(e) || String(e)} ${code(e)}${X}`);
  await cleanup().catch(() => undefined);
  process.exit(1);
});
