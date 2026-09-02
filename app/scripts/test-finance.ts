// ============================================================================
// AI-Swisse — Finance Operations: test d'integrazione sul DATABASE REALE.
//   npm run test:finance
//
// Richiede la migrazione 0021 applicata e `.env.test` valorizzato.
//
// ⚠️ NON SIMULA LA LETTURA FINANZIARIA: LA ESEGUE.
// `processFinanceItem` e `saveFinanceExtraction` sono lo STESSO codice che gira
// dentro la Edge Function — ricevono il client per parametro e non conoscono
// `Deno.env`, proprio per poter essere provati qui contro il database vero. Un
// test che riscrivesse la logica per «provarla» proverebbe la riscrittura.
//
// ⚠️ IL MODULO NON MUOVE DENARO, E NEMMENO QUESTO TEST LO FA. Qui si scrivono e
// si rileggono IBAN e riferimenti di pagamento: non esiste, e non deve esistere,
// alcuna riga che li trasformi in un ordine.
//
// Non prova che il codice sia scritto bene: prova che le GARANZIE siano in
// vigore. Sono quattordici, e stanno tutte nel database o nel codice condiviso,
// perché un servizio ben educato non è una garanzia — è la lezione della 0014,
// dove i permessi di colonna dichiarati nei commenti non restringevano nulla e
// il difetto è emerso solo ESEGUENDO:
//
//    1. I DUE VALORI ENUM esistono davvero dopo l'applicazione della 0021.
//    2. ISOLAMENTO — una parola rara di A non compare in nessuna via di B.
//    3. PERMESSI — che cosa un membro NON può scrivere, verificato rileggendo.
//    4. IMMUTABILITÀ — la versione 2 affianca la 1, non la sostituisce.
//    5. CORREZIONI — la correzione umana vince, l'estrazione resta intatta.
//    6. LA PROIEZIONE — si ricalcola, e il guardiano non la annulla.
//    7. DUPLICATI — si sospetta, non si fonde; e il sospetto si calcola.
//    8. VALUTE — due righe separate, nessun totale che le somma.
//    9. NOTE DI CREDITO — fuori dai totali «in scadenza» e «scadute».
//   10. CREAZIONE AUTOMATICA — nasce solo dove il classificatore è certo.
//   11. EVENTI DI AUTOMAZIONE — l'outbox scrive solo se qualcuno ascolta.
//   12. CASCATA — cancellato il documento non resta niente, tabella per tabella.
//   13. IL DOPPIONE DELL'IBAN — SQL e TypeScript dicono la stessa cosa.
//   14. IL CODICE CONDIVISO — eseguito davvero, senza AI e senza spesa.
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
import { checkIban } from '../supabase/functions/_shared/finance/checksums.ts';
import { processFinanceItem } from '../supabase/functions/_shared/finance/process.ts';
import {
  saveFinanceExtraction,
  type FinanceExtractionRow, type FinanceItemRow, type ServerClient,
} from '../supabase/functions/_shared/finance/store.ts';

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
// Il codice condiviso vuole il client per parametro: è la forma minima che
// `store.ts` dichiara, ed è la stessa in Deno e in Node.
const sb = admin as unknown as ServerClient;

const created: { users: string[]; companies: string[] } = { users: [], companies: [] };
// Le fatture emesse della sezione 15: la pulizia rilegge ANCHE le tre tabelle
// della 0053, non solo aziende e utenti — una cascata mancata resterebbe muta.
const createdInvoices: string[] = [];
const createdInvoiceDocs: string[] = [];
let pass = 0, fail = 0;
const G = '\x1b[32m', R = '\x1b[31m', DIM = '\x1b[2m', B = '\x1b[1m', X = '\x1b[0m';
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) { pass++; console.log(`  ${G}✓${X} ${name}`); }
  else { fail++; console.log(`  ${R}✗ ${name}${X}${detail ? `\n     ${DIM}${detail}${X}` : ''}`); }
};
const section = (title: string) => console.log(`\n${B}${title}${X}`);
const msg = (e: unknown) => (e as { message?: string } | null)?.message ?? '';

const PW = 'Test1234!';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Una data ISO a N giorni da oggi. Si sta larghi di due giorni per non far
 *  dipendere l'esito dal fuso: `current_date` è del database, `Date` è di qui. */
const isoDay = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

const isJwtTransient = (m = '') => /invalid JWT|unverifiable|unrecognized JWT kid/i.test(m);
async function withRetry<T>(label: string, fn: () => Promise<{ data: T; error: unknown }>, tries = 5): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    const { data, error } = await fn();
    if (!error) return data;
    last = error;
    if (!isJwtTransient(msg(error))) break;
    await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
  throw new Error(`${label}: ${msg(last) || 'errore'}`);
}

async function makeUser(tag: string) {
  const email = `finance+${tag}.${Date.now()}@example.com`;
  const data = await withRetry('createUser', () => admin.auth.admin.createUser({
    email, password: PW, email_confirm: true, user_metadata: { first_name: 'Prova', last_name: tag },
  }) as never);
  const user = (data as { user: { id: string } }).user;
  created.users.push(user.id);
  return { id: user.id, email };
}

async function makeCompany(name: string, ownerId: string): Promise<string> {
  const { data, error } = await admin.from('companies')
    .insert({ legal_name: `${name} ${Date.now()}`, canton: 'Ticino' }).select('id').single();
  if (error) throw new Error(`company: ${error.message}`);
  created.companies.push(data.id);
  const { error: mErr } = await admin.from('company_members')
    .insert({ company_id: data.id, user_id: ownerId, role: 'owner' });
  if (mErr) throw new Error(`membership: ${mErr.message}`);
  return data.id as string;
}

async function addMember(companyId: string, userId: string) {
  const { error } = await admin.from('company_members')
    .insert({ company_id: companyId, user_id: userId, role: 'member' });
  if (error) throw new Error(`membro semplice: ${error.message}`);
}

async function signIn(email: string) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return client;
}

async function makeDocument(companyId: string, title: string): Promise<string> {
  const { data, error } = await admin.from('documents').insert({
    company_id: companyId, title, source_type: 'upload', status: 'completed',
  }).select('id').single();
  if (error) throw new Error(`document: ${error.message}`);
  return data.id as string;
}

/** Il testo già estratto: è ciò che il worker rilegge, e non lo riproduce. */
async function makeDocumentText(companyId: string, documentId: string, text: string) {
  const { error } = await admin.from('document_extractions').insert({
    company_id: companyId, document_id: documentId, extraction_method: 'text',
    full_text: text, pages: [{ pageNumber: 1, text }],
    page_count: 1, char_count: text.length,
  });
  if (error) throw new Error(`document_extraction: ${error.message}`);
}

async function makeAnalysis(companyId: string, documentId: string, over: Record<string, unknown> = {}) {
  const { data, error } = await admin.from('document_analyses').insert({
    company_id: companyId, document_id: documentId,
    analysis_status: 'completed', engine: 'deterministic-test',
    document_type: 'information', sender_authority_type: 'private',
    confidence: 'alta', overall_confidence: 0.9,
    ...over,
  }).select('id').single();
  if (error) throw new Error(`analysis: ${error.message}`);
  return data.id as string;
}

const ITEM_COLUMNS =
  'id, company_id, document_id, type, processing_status, extraction_attempts, updated_at';

/** L'elemento finanziario, scritto con il service role come farebbe il trigger. */
async function makeItem(
  companyId: string, documentId: string, type: FinanceItemRow['type'] = 'supplier_invoice',
): Promise<FinanceItemRow> {
  const { data, error } = await admin.from('finance_items')
    .insert({ company_id: companyId, document_id: documentId, type })
    .select(ITEM_COLUMNS).single();
  if (error) throw new Error(`finance_item: ${error.message}`);
  return data as FinanceItemRow;
}

/** Il verbale, scritto dal codice condiviso: la versione la decide `store.ts`. */
async function makeExtraction(item: FinanceItemRow, over: Partial<FinanceExtractionRow> = {}) {
  return saveFinanceExtraction(sb, {
    companyId: item.company_id,
    financeItemId: item.id,
    documentId: item.document_id,
    status: 'completed',
    method: 'deterministic',
    provider: null,
    model: null,
    promptVersion: null,
    ...over,
  });
}

/** Un documento completo di elemento e verbale, in una riga sola. */
async function makeInvoice(
  companyId: string, title: string,
  facts: Partial<FinanceExtractionRow>,
  type: FinanceItemRow['type'] = 'supplier_invoice',
) {
  const documentId = await makeDocument(companyId, title);
  const item = await makeItem(companyId, documentId, type);
  const extraction = await makeExtraction(item, facts);
  return { documentId, item, extraction };
}

/** La riga di `finance_items` così come sta sul database, per rileggerla. */
interface ItemRowFull {
  id: string;
  type: string;
  review_status: string;
  processing_status: string;
  origin: string;
  archived_at: string | null;
  quality_flags: string[];
  eff_supplier_name: string | null;
  eff_supplier_norm: string | null;
  eff_invoice_number: string | null;
  eff_due_date: string | null;
  eff_currency: string | null;
  eff_gross_amount: number | null;
  eff_iban: string | null;
  dup_key: string | null;
  current_extraction_id: string | null;
  reviewed_by: string | null;
}
const ITEM_FULL =
  'id, type, review_status, processing_status, origin, archived_at, quality_flags, '
  + 'eff_supplier_name, eff_supplier_norm, eff_invoice_number, eff_due_date, eff_currency, '
  + 'eff_gross_amount, eff_iban, dup_key, current_extraction_id, reviewed_by';

async function readItem(id: string): Promise<ItemRowFull | null> {
  const { data, error } = await admin.from('finance_items').select(ITEM_FULL).eq('id', id).maybeSingle();
  if (error) throw new Error(`rilettura elemento: ${error.message}`);
  return (data ?? null) as ItemRowFull | null;
}

async function countRows(table: string, column: string, value: string): Promise<number> {
  const { count, error } = await admin.from(table)
    .select('id', { count: 'exact', head: true }).eq(column, value);
  if (error) throw new Error(`conteggio ${table}: ${error.message}`);
  return count ?? 0;
}

/** Una riga della lista, limitata a ciò che questo test guarda. */
interface ListRow {
  id: string;
  document_id: string;
  type: string;
  review_status: string;
  quality_flags: string[];
  duplicate_suspected: boolean;
  duplicate_count: number;
  supplier_name: string | null;
  invoice_number: string | null;
  currency: string | null;
  gross_amount: number | null;
  iban: string | null;
  corrected_fields: string[];
  extraction_version: number | null;
  total_count: number;
}
interface SummaryRow { bucket: string; currency: string | null; n: number; total: number | null }

type Sb = ReturnType<typeof anonClient>;

async function listItems(client: Sb, args: Record<string, unknown>) {
  const { data, error } = await client.rpc('list_finance_items', args as never);
  return { rows: (data ?? []) as ListRow[], error };
}

async function summaryOf(client: Sb, companyId: string) {
  const { data, error } = await client.rpc('finance_summary', { p_company_id: companyId } as never);
  return { rows: (data ?? []) as SummaryRow[], error };
}

async function duplicatesOf(client: Sb, itemId: string) {
  const { data, error } = await client.rpc('finance_duplicates', { p_item_id: itemId } as never);
  return { rows: (data ?? []) as { id: string }[], error };
}

/**
 * Le etichette di un tipo enum, lette dal catalogo.
 *
 * ⚠️ PERCHÉ NON UNA `select` SU `pg_enum`. PostgREST espone soltanto gli schemi
 * dichiarati (`public`), e `pg_catalog` non è fra questi: da qui `pg_enum` non è
 * interrogabile né direttamente né con una funzione, perché la 0021 non ne
 * fornisce una. L'UNICO canale che riporta le etichette è lo schema OpenAPI, che
 * PostgREST genera leggendo esattamente `pg_enum` per ogni colonna di tipo enum.
 * Si verifica anche il `format`, altrimenti si starebbe leggendo le etichette di
 * un altro tipo e non lo si saprebbe.
 */
async function enumLabels(table: string, column: string, expectedFormat: string): Promise<string[]> {
  const response = await fetch(`${URL}/rest/v1/`, {
    headers: { apikey: SERVICE as string, Authorization: `Bearer ${SERVICE}`, Accept: 'application/openapi+json' },
  });
  if (!response.ok) throw new Error(`schema OpenAPI non leggibile: HTTP ${response.status}`);
  const spec = await response.json() as {
    definitions?: Record<string, { properties?: Record<string, { enum?: string[]; format?: string }> }>;
  };
  const property = spec.definitions?.[table]?.properties?.[column];
  if (!property) throw new Error(`lo schema non descrive ${table}.${column}`);
  if (property.format !== expectedFormat) {
    throw new Error(`${table}.${column} non è di tipo ${expectedFormat} ma ${property.format}`);
  }
  if (!Array.isArray(property.enum)) throw new Error(`${table}.${column} non riporta le etichette del tipo`);
  return property.enum;
}

// ============================================================================
async function main() {
  console.log(`${B}AI-Swisse — Finance Operations: test sul database reale${X}`);

  // ---- prerequisito: la 0021 è applicata? ---------------------------------
  const { error: probe } = await admin.from('finance_items').select('id').limit(1);
  if (probe && /does not exist|schema cache/i.test(msg(probe))) {
    console.error(`\n${R}La migrazione 0021 non risulta applicata.${X}`);
    console.error(`${DIM}Applica supabase/migrations/0021_finance_operations.sql dal SQL editor, poi riesegui.${X}\n`);
    process.exit(2);
  }
  if (probe) {
    console.error(`\n${R}finance_items non è leggibile:${X} ${msg(probe)}\n`);
    process.exit(2);
  }
  // La sezione 15 prova le fatture emesse: senza la 0053/0054 fallirebbe con
  // errori di funzione inesistente, che direbbero poco. Si dichiara subito.
  const { error: probe53 } = await admin.from('finance_issued_invoices').select('id').limit(1);
  if (probe53 && /does not exist|schema cache/i.test(msg(probe53))) {
    console.error(`\n${R}La migrazione 0053 non risulta applicata.${X}`);
    console.error(`${DIM}Applica supabase/migrations/0053_finance_issued_invoices.sql e 0054_issued_invoice_entity_type.sql dal SQL editor, poi riesegui.${X}\n`);
    process.exit(2);
  }

  try {
    const andrea = await makeUser('andrea');      // titolare di A
    const bruno = await makeUser('bruno');        // titolare di B, azienda estranea
    const marta = await makeUser('marta');        // membro semplice di A
    const companyA = await makeCompany('Prova Finance A', andrea.id);
    const companyB = await makeCompany('Prova Finance B', bruno.id);
    await addMember(companyA, marta.id);
    const clientA = await signIn(andrea.email);
    const clientB = await signIn(bruno.email);
    const clientM = await signIn(marta.email);

    // =======================================================================
    section('1 · I due valori nuovi di automation_event_type esistono davvero');
    // =======================================================================
    // È la verifica che la migrazione NON poteva fare su sé stessa: un
    // `alter type … add value` non è valutabile nella stessa transazione che lo
    // esegue (55P04), e il blocco di autoverifica della 0021 evita di proposito
    // di nominare queste due etichette. Che ci siano lo si può sapere solo DOPO
    // il commit, cioè qui.
    {
      const labels = await enumLabels('automation_events', 'event_type', 'public.automation_event_type');
      check('automation_event_type contiene «finance_item_ready»',
        labels.includes('finance_item_ready'), labels.join(','));
      check('automation_event_type contiene «finance_item_needs_review»',
        labels.includes('finance_item_needs_review'), labels.join(','));
      // Le etichette preesistenti servono da controprova: se l'elenco letto
      // fosse vuoto o di un altro tipo, i due controlli sopra fallirebbero per
      // la ragione sbagliata e nessuno lo saprebbe.
      check('e continua a contenere quelle della 0020',
        labels.includes('document_analysis_completed') && labels.includes('task_created'),
        labels.join(','));
    }

    // ---- il fornitore di A, con una parola che non esiste altrove ----------
    // Serve all'isolamento: una parola rara è l'unica prova che una riga NON è
    // stata vista, perché una parola comune tornerebbe da qualunque azienda.
    const rara = `Zwitschermolch${Date.now()}`;
    const fatturaA = await makeInvoice(companyA, 'Fattura elettricità', {
      supplierName: `${rara} Elektro SA`,
      invoiceNumber: 'F-2026-118',
      invoiceDate: '2026-09-01',
      dueDate: '2026-09-30',
      currency: 'CHF',
      grossAmount: '1234.50',
      creditorIban: 'CH9300762011623852957',
      referenceType: 'non',
    });

    // =======================================================================
    section('2 · Isolamento: la parola rara di A non compare in nessuna via di B');
    // =======================================================================
    {
      const perQuery = await listItems(clientB, { p_company_id: companyB, p_query: rara });
      check('la lista di B non trova il fornitore di A',
        !perQuery.error && perQuery.rows.length === 0, msg(perQuery.error) || `righe ${perQuery.rows.length}`);

      const impersonando = await listItems(clientB, { p_company_id: companyA, p_query: rara });
      check('e nemmeno dichiarando l’azienda di A nella chiamata',
        !impersonando.error && impersonando.rows.length === 0,
        msg(impersonando.error) || `righe ${impersonando.rows.length}`);

      const dettaglio = await listItems(clientB, { p_company_id: companyA, p_item_id: fatturaA.item.id });
      check('il dettaglio per id non restituisce l’elemento di A',
        !dettaglio.error && dettaglio.rows.length === 0,
        msg(dettaglio.error) || `righe ${dettaglio.rows.length}`);

      const dettaglioB = await listItems(clientB, { p_company_id: companyB, p_item_id: fatturaA.item.id });
      check('e nemmeno chiedendolo dentro la propria azienda',
        !dettaglioB.error && dettaglioB.rows.length === 0,
        msg(dettaglioB.error) || `righe ${dettaglioB.rows.length}`);

      const doppioni = await duplicatesOf(clientB, fatturaA.item.id);
      check('i duplicati di un elemento di A non sono deducibili da B (§124)',
        !doppioni.error && doppioni.rows.length === 0,
        msg(doppioni.error) || `righe ${doppioni.rows.length}`);

      // ⚠️ `finance_summary` restituisce SEMPRE la riga dei conteggi, anche a
      // chi non è membro: il controllo giusto non è «nessuna riga» ma «nessun
      // numero». Cercare l'assenza di righe darebbe verde per la ragione
      // sbagliata il giorno in cui la funzione smettesse di filtrare.
      const cruscotto = await summaryOf(clientB, companyA);
      check('il cruscotto di A visto da B non riporta alcun numero',
        !cruscotto.error && cruscotto.rows.every((r) => Number(r.n) === 0),
        msg(cruscotto.error) || JSON.stringify(cruscotto.rows));

      const riga = await clientB.from('finance_items').select('id').eq('id', fatturaA.item.id);
      check('la riga dell’elemento non è leggibile dal client di B',
        !riga.error && (riga.data ?? []).length === 0, msg(riga.error));

      const verbale = await clientB.from('finance_extractions')
        .select('id').ilike('supplier_name', `%${rara}%`);
      check('né il verbale che contiene il nome del fornitore',
        !verbale.error && (verbale.data ?? []).length === 0, msg(verbale.error));

      const storico = await clientB.from('finance_events')
        .select('id').eq('finance_item_id', fatturaA.item.id);
      check('né lo storico dell’elemento',
        !storico.error && (storico.data ?? []).length === 0, msg(storico.error));
    }

    // =======================================================================
    section('3 · Che cosa un membro NON può scrivere (§189 della 0020, §23 della 0021)');
    // =======================================================================
    // ⚠️ PER OGNUNA: si accetta l'errore MA SI RILEGGE con il service role. Un
    // update che non tocca righe non è un errore e sembrerebbe riuscito; e un
    // `delete` filtrato dalla RLS restituisce zero righe cancellate senza
    // lamentarsi. Solo la rilettura distingue «rifiutato» da «non arrivato».
    {
      const primaVerbali = await countRows('finance_extractions', 'finance_item_id', fatturaA.item.id);

      const ins = await clientM.from('finance_extractions').insert({
        company_id: companyA, finance_item_id: fatturaA.item.id, document_id: fatturaA.documentId,
        extraction_version: 99, status: 'completed', method: 'ai', supplier_name: 'Abusiva',
      } as never);
      const dopoInsert = await countRows('finance_extractions', 'finance_item_id', fatturaA.item.id);
      check('un membro NON può inserire un verbale',
        !!ins.error && dopoInsert === primaVerbali, `${msg(ins.error)} — verbali ${dopoInsert}`);

      const upd = await clientM.from('finance_extractions')
        .update({ supplier_name: 'Riscritto a mano' } as never).eq('id', fatturaA.extraction.id);
      const { data: verbaleDopo } = await admin.from('finance_extractions')
        .select('supplier_name, creditor_iban').eq('id', fatturaA.extraction.id).single();
      check('un membro NON può modificare un verbale, e il verbale è intatto',
        !!upd.error && (verbaleDopo as { supplier_name: string }).supplier_name === `${rara} Elektro SA`,
        `${msg(upd.error)} — ${JSON.stringify(verbaleDopo)}`);

      const del = await clientM.from('finance_extractions').delete().eq('id', fatturaA.extraction.id);
      const dopoDelete = await countRows('finance_extractions', 'finance_item_id', fatturaA.item.id);
      check('un membro NON può cancellare un verbale',
        dopoDelete === primaVerbali, `${msg(del.error)} — verbali ${dopoDelete}`);

      // Una correzione legittima, scritta da chi ne ha diritto: serve come
      // bersaglio ai due tentativi che seguono.
      const { data: corrData, error: corrError } = await clientA.from('finance_corrections').insert({
        company_id: companyA, finance_item_id: fatturaA.item.id,
        field: 'invoice_number', corrected_value: 'F-2026-118-bis',
      } as never).select('id, corrected_value').single();
      check('il titolare può aggiungere una correzione', !corrError && !!corrData, msg(corrError));
      const correzioneId = (corrData as { id: string }).id;

      const updCorr = await clientM.from('finance_corrections')
        .update({ corrected_value: 'F-9999' } as never).eq('id', correzioneId);
      const { data: corrDopo } = await admin.from('finance_corrections')
        .select('corrected_value').eq('id', correzioneId).single();
      check('un membro NON può modificare una correzione, e il valore è intatto',
        !!updCorr.error && (corrDopo as { corrected_value: string }).corrected_value === 'F-2026-118-bis',
        `${msg(updCorr.error)} — ${JSON.stringify(corrDopo)}`);

      const delCorr = await clientM.from('finance_corrections').delete().eq('id', correzioneId);
      const correzioniRimaste = await countRows('finance_corrections', 'id', correzioneId);
      check('un membro NON può cancellare una correzione',
        correzioniRimaste === 1, `${msg(delCorr.error)} — rimaste ${correzioniRimaste}`);

      const delItem = await clientM.from('finance_items').delete().eq('id', fatturaA.item.id);
      const elementiRimasti = await countRows('finance_items', 'id', fatturaA.item.id);
      check('un membro NON può cancellare un elemento finanziario (§91)',
        elementiRimasti === 1, `${msg(delItem.error)} — rimasti ${elementiRimasti}`);

      // ⚠️ LA PROIEZIONE NON È SCRIVIBILE, e non basta che il grant manchi:
      // qui si guarda il valore, perché è il valore che una schermata mostra
      // accanto a un IBAN.
      const primaProiezione = await readItem(fatturaA.item.id);
      const updEff = await clientM.from('finance_items').update({
        eff_gross_amount: 99_999, eff_iban: 'CH5604835012345678009',
      } as never).eq('id', fatturaA.item.id);
      const dopoProiezione = await readItem(fatturaA.item.id);
      check('un membro NON può scrivere le colonne eff_*, e i valori non cambiano',
        !!updEff.error
        && Number(dopoProiezione?.eff_gross_amount) === Number(primaProiezione?.eff_gross_amount)
        && dopoProiezione?.eff_iban === primaProiezione?.eff_iban,
        `${msg(updEff.error)} — ${JSON.stringify(dopoProiezione)}`);
    }

    // =======================================================================
    section('4 · Immutabilità: la versione 2 affianca la 1 (§9)');
    // =======================================================================
    {
      const seconda = await makeExtraction(fatturaA.item, {
        supplierName: `${rara} Elektro SA`,
        invoiceNumber: 'F-2026-118',
        invoiceDate: '2026-09-01',
        dueDate: '2026-09-30',
        currency: 'CHF',
        grossAmount: '1300.00',
        creditorIban: 'CH9300762011623852957',
        referenceType: 'non',
      });
      check('un secondo tentativo produce la VERSIONE 2', seconda.version === 2, `versione ${seconda.version}`);

      const { data: prima, error: primaErr } = await admin.from('finance_extractions')
        .select('id, extraction_version, gross_amount').eq('id', fatturaA.extraction.id).maybeSingle();
      check('e la versione 1 resta leggibile con il suo importo di allora',
        !primaErr && !!prima && Number((prima as { gross_amount: number }).gross_amount) === 1234.5,
        msg(primaErr) || JSON.stringify(prima));

      const dopo = await readItem(fatturaA.item.id);
      check('l’elemento punta ora al verbale nuovo',
        dopo?.current_extraction_id === seconda.id, String(dopo?.current_extraction_id));
      // La proiezione segue il verbale corrente: se non lo facesse, la lista e
      // il dettaglio mostrerebbero un importo che nessuna estrazione dichiara.
      check('e la proiezione segue il verbale corrente',
        Number(dopo?.eff_gross_amount) === 1300, String(dopo?.eff_gross_amount));

      // ⚠️ Il divieto vale ANCHE per il service role: il worker gira proprio
      // con quello, e un verbale che si corregge non è un verbale.
      const updAdmin = await admin.from('finance_extractions')
        .update({ gross_amount: 1 }).eq('id', fatturaA.extraction.id);
      const { data: intatta } = await admin.from('finance_extractions')
        .select('gross_amount').eq('id', fatturaA.extraction.id).single();
      check('nemmeno il service role può modificare un verbale',
        !!updAdmin.error && Number((intatta as { gross_amount: number }).gross_amount) === 1234.5,
        `${msg(updAdmin.error)} — ${JSON.stringify(intatta)}`);

      const delAdmin = await admin.from('finance_extractions').delete().eq('id', fatturaA.extraction.id);
      const verbaliRimasti = await countRows('finance_extractions', 'id', fatturaA.extraction.id);
      check('né cancellarlo', !!delAdmin.error && verbaliRimasti === 1,
        `${msg(delAdmin.error)} — rimasti ${verbaliRimasti}`);
    }

    // =======================================================================
    section('5 · La correzione umana vince, e la firma è di chi scrive (§11/§15)');
    // =======================================================================
    {
      const { error: corrErr } = await clientA.from('finance_corrections').insert({
        company_id: companyA, finance_item_id: fatturaA.item.id,
        field: 'gross_amount', original_value: '1300.00', corrected_value: '1500.00',
      } as never);
      check('la correzione di un importo viene accettata', !corrErr, msg(corrErr));

      const dopo = await readItem(fatturaA.item.id);
      check('il valore EFFETTIVO diventa quello corretto',
        Number(dopo?.eff_gross_amount) === 1500, String(dopo?.eff_gross_amount));

      const { data: verbale } = await admin.from('finance_extractions')
        .select('gross_amount').eq('id', dopo?.current_extraction_id ?? '').single();
      check('e l’estrazione resta INTATTA: la correzione si aggiunge, non riscrive',
        Number((verbale as { gross_amount: number }).gross_amount) === 1300,
        JSON.stringify(verbale));

      const { data: firma } = await admin.from('finance_corrections')
        .select('corrected_by, extraction_id, document_id')
        .eq('finance_item_id', fatturaA.item.id).eq('field', 'gross_amount').single();
      const riga = firma as { corrected_by: string; extraction_id: string; document_id: string };
      check('l’autore lo scrive il database, non il client', riga.corrected_by === andrea.id, riga.corrected_by);
      check('e il verbale in vigore al momento della correzione viene agganciato dal database',
        riga.extraction_id === dopo?.current_extraction_id && riga.document_id === fatturaA.documentId,
        JSON.stringify(riga));

      // ⚠️ FIRMARE COME UN COLLEGA VIENE RIFIUTATO, non riscritto in silenzio:
      // è la lezione dei commenti delle attività (0016), dove l'esito era
      // sicuro ma chi ci provava riceveva una conferma.
      const perContoTerzi = await clientA.from('finance_corrections').insert({
        company_id: companyA, finance_item_id: fatturaA.item.id,
        field: 'supplier_vat_id', corrected_value: 'CHE108888491', corrected_by: marta.id,
      } as never);
      const { count: firmeAltrui } = await admin.from('finance_corrections')
        .select('id', { count: 'exact', head: true })
        .eq('finance_item_id', fatturaA.item.id).eq('corrected_by', marta.id);
      check('firmare una correzione con il nome di un collega viene RIFIUTATO',
        !!perContoTerzi.error && /author_mismatch/.test(msg(perContoTerzi.error)) && (firmeAltrui ?? 0) === 0,
        `${msg(perContoTerzi.error)} — righe altrui ${firmeAltrui}`);

      // Un valore malformato si rifiuta all'ingresso: salvarlo lascerebbe il
      // campo fra i «corretti a mano» e la schermata continuerebbe a mostrare
      // il valore vecchio — una persona convinta di aver corretto un importo.
      const malformata = await clientA.from('finance_corrections').insert({
        company_id: companyA, finance_item_id: fatturaA.item.id,
        field: 'net_amount', corrected_value: 'millecinquecento',
      } as never);
      const netto = await countRows('finance_corrections', 'finance_item_id', fatturaA.item.id);
      check('un importo che non è un numero viene rifiutato, non salvato a metà',
        !!malformata.error && /bad_amount/.test(msg(malformata.error)) && netto === 2,
        `${msg(malformata.error)} — correzioni ${netto}`);

      // Anche l'IBAN corretto a mano deve superare la propria cifra di
      // controllo: è il campo a rischio più alto del modulo (§153).
      const ibanStorto = await clientA.from('finance_corrections').insert({
        company_id: companyA, finance_item_id: fatturaA.item.id,
        field: 'creditor_iban', corrected_value: 'CH9300762011623852958',
      } as never);
      check('un IBAN che non torna non entra nemmeno come correzione',
        !!ibanStorto.error && /bad_iban/.test(msg(ibanStorto.error)), msg(ibanStorto.error));

      const lista = await listItems(clientA, { p_company_id: companyA, p_item_id: fatturaA.item.id });
      check('la lista dichiara QUALI campi ha corretto una persona (§11)',
        !lista.error && lista.rows.length === 1
        && lista.rows[0].corrected_fields.includes('gross_amount')
        && lista.rows[0].corrected_fields.includes('invoice_number'),
        msg(lista.error) || JSON.stringify(lista.rows[0]?.corrected_fields));
    }

    // =======================================================================
    section('6 · La proiezione si ricalcola, e il guardiano non la annulla');
    // =======================================================================
    {
      const { error: corrErr } = await clientA.from('finance_corrections').insert({
        company_id: companyA, finance_item_id: fatturaA.item.id,
        field: 'supplier_name', corrected_value: `${rara} Elettricità SA`,
      } as never);
      check('la correzione del fornitore viene accettata', !corrErr, msg(corrErr));

      const dopo = await readItem(fatturaA.item.id);
      check('le colonne eff_* seguono la correzione',
        dopo?.eff_supplier_name === `${rara} Elettricità SA`, String(dopo?.eff_supplier_name));
      check('e con esse la chiave di confronto normalizzata',
        (dopo?.eff_supplier_norm ?? '').includes('elettricità'), String(dopo?.eff_supplier_norm));

      // ⚠️ NEMMENO IL SERVICE ROLE scrive la proiezione: la ricalcola soltanto
      // `finance_refresh_effective`. Non basta che manchi il grant — il service
      // role ce l'ha — quindi si guarda il valore.
      const forzatura = await admin.from('finance_items')
        .update({ eff_gross_amount: 1, eff_supplier_name: 'Sovrascritto' }).eq('id', fatturaA.item.id);
      const dopoForzatura = await readItem(fatturaA.item.id);
      check('un update che tocca la proiezione viene annullato dal guardiano',
        !forzatura.error
        && Number(dopoForzatura?.eff_gross_amount) === 1500
        && dopoForzatura?.eff_supplier_name === `${rara} Elettricità SA`,
        `${msg(forzatura.error)} — ${JSON.stringify(dopoForzatura)}`);

      // ⚠️ IL DIFETTO CHE LA SENTINELLA ESPLICITA HA CORRETTO.
      // `finance_refresh_effective` è chiamabile DIRETTAMENTE — dal worker o da
      // uno script di ripopolamento — e in quel caso il suo UPDATE fa scattare
      // il guardiano a profondità 1. Con una sentinella basata su
      // `pg_trigger_depth()` la proiezione appena calcolata verrebbe rimessa
      // com'era, riga per riga, senza alcun errore.
      // Per provarlo serve una proiezione INVECCHIATA senza che nessun trigger
      // di Finance sia scattato: la scadenza dell'analisi amministrativa (§47)
      // è esattamente questo — sta su `document_analyses`, che non ricalcola
      // niente, e la 0021 la confronta con la scadenza della fattura.
      await makeAnalysis(companyA, fatturaA.documentId, { deadline: '2026-12-31' });
      await sleep(250);
      const primaDelRicalcolo = await readItem(fatturaA.item.id);
      check('la bandiera che dipende dall’analisi non è ancora accesa: la proiezione è vecchia',
        !(primaDelRicalcolo?.quality_flags ?? []).includes('inconsistent_due_date'),
        JSON.stringify(primaDelRicalcolo?.quality_flags));

      const { error: refreshErr } = await admin.rpc('finance_refresh_effective', {
        p_item_id: fatturaA.item.id,
      } as never);
      const dopoRicalcolo = await readItem(fatturaA.item.id);
      check('chiamato direttamente, il ricalcolo SCRIVE e non viene annullato',
        !refreshErr && (dopoRicalcolo?.quality_flags ?? []).includes('inconsistent_due_date'),
        msg(refreshErr) || JSON.stringify(dopoRicalcolo?.quality_flags));
      check('e non ha perso per strada i valori corretti a mano',
        Number(dopoRicalcolo?.eff_gross_amount) === 1500
        && dopoRicalcolo?.eff_supplier_name === `${rara} Elettricità SA`,
        JSON.stringify(dopoRicalcolo));
    }

    // =======================================================================
    section('7 · Duplicati: si sospetta, non si fonde — e il sospetto si calcola (§70/§72)');
    // =======================================================================
    {
      const companyD = await makeCompany('Prova Finance Duplicati', andrea.id);
      const fatti: Partial<FinanceExtractionRow> = {
        supplierName: 'Cartoleria Bellinzona SA',
        invoiceNumber: '2026-4471',
        invoiceDate: '2026-06-02',
        currency: 'CHF',
        grossAmount: '480.00',
      };
      const uno = await makeInvoice(companyD, 'Fattura cartoleria (PDF)', fatti);
      const due = await makeInvoice(companyD, 'Fattura cartoleria (e-mail)', fatti);

      const rigaUno = await readItem(uno.item.id);
      const rigaDue = await readItem(due.item.id);
      check('due documenti diversi con gli stessi fatti hanno la stessa impronta',
        !!rigaUno?.dup_key && rigaUno?.dup_key === rigaDue?.dup_key, String(rigaUno?.dup_key));

      const lista = await listItems(clientA, { p_company_id: companyD, p_duplicates: true });
      check('entrambi vengono SEGNALATI, e nessuno dei due sparisce',
        !lista.error && lista.rows.length === 2
        && lista.rows.every((r) => r.duplicate_suspected && Number(r.duplicate_count) === 1),
        msg(lista.error) || JSON.stringify(lista.rows.map((r) => [r.id, r.duplicate_count])));
      check('e la bandiera «duplicate_suspected» arriva alla schermata',
        !lista.error && lista.rows.every((r) => r.quality_flags.includes('duplicate_suspected')),
        JSON.stringify(lista.rows.map((r) => r.quality_flags)));

      const confronto = await duplicatesOf(clientA, uno.item.id);
      check('il confronto mostra la controparte, senza fondere niente',
        !confronto.error && confronto.rows.length === 1 && confronto.rows[0].id === due.item.id,
        msg(confronto.error) || JSON.stringify(confronto.rows));

      const { count: elementi } = await admin.from('finance_items')
        .select('id', { count: 'exact', head: true }).eq('company_id', companyD);
      check('i due elementi restano DUE: nessuna fusione', elementi === 2, `elementi ${elementi}`);

      // ⚠️ IL SOSPETTO NON È MEMORIZZATO: archiviare la controparte lo fa
      // sparire senza che la riga superstite venga toccata. Se fosse una
      // bandiera scritta, resterebbe accesa su un duplicato che non esiste più.
      const { error: archErr } = await clientA.from('finance_items')
        .update({ archived_at: new Date().toISOString() } as never).eq('id', due.item.id);
      check('si può archiviare uno dei due', !archErr, msg(archErr));

      const dopoArchivio = await duplicatesOf(clientA, uno.item.id);
      check('archiviato uno, il sospetto SPARISCE dall’altro',
        !dopoArchivio.error && dopoArchivio.rows.length === 0,
        msg(dopoArchivio.error) || JSON.stringify(dopoArchivio.rows));

      const listaDopo = await listItems(clientA, { p_company_id: companyD, p_item_id: uno.item.id });
      check('e la lista non lo dichiara più duplicato',
        !listaDopo.error && listaDopo.rows.length === 1
        && listaDopo.rows[0].duplicate_suspected === false
        && !listaDopo.rows[0].quality_flags.includes('duplicate_suspected'),
        msg(listaDopo.error) || JSON.stringify(listaDopo.rows[0]));
    }

    // =======================================================================
    section('8 · Due valute, due righe: nessun totale che le somma (§22/§113)');
    // =======================================================================
    {
      const companyV = await makeCompany('Prova Finance Valute', andrea.id);
      await makeInvoice(companyV, 'Fattura in franchi', {
        supplierName: 'Swisscom SA', invoiceNumber: 'CH-1',
        invoiceDate: isoDay(-10), dueDate: isoDay(2), currency: 'CHF', grossAmount: '1000.00',
      });
      await makeInvoice(companyV, 'Fattura in euro', {
        supplierName: 'Fornitore Milano Srl', invoiceNumber: 'EU-1',
        invoiceDate: isoDay(-10), dueDate: isoDay(2), currency: 'EUR', grossAmount: '250.00',
      });

      const { rows, error } = await summaryOf(clientA, companyV);
      const inScadenza = rows.filter((r) => r.bucket === 'due_soon');
      check('il cruscotto risponde', !error, msg(error));
      check('«in scadenza» restituisce DUE righe, una per valuta',
        inScadenza.length === 2, JSON.stringify(inScadenza));
      const chf = inScadenza.find((r) => r.currency === 'CHF');
      const eur = inScadenza.find((r) => r.currency === 'EUR');
      check('i franchi stanno con i franchi',
        !!chf && Number(chf.n) === 1 && Number(chf.total) === 1000, JSON.stringify(chf));
      check('e gli euro con gli euro',
        !!eur && Number(eur.n) === 1 && Number(eur.total) === 250, JSON.stringify(eur));
      check('nessuna riga somma valute diverse: 1250 non è un fatto',
        !inScadenza.some((r) => Number(r.total) === 1250) && !inScadenza.some((r) => r.currency === null),
        JSON.stringify(inScadenza));
    }

    // =======================================================================
    section('9 · Le note di credito non gonfiano il «da pagare» (§74)');
    // =======================================================================
    {
      const companyN = await makeCompany('Prova Finance Note di credito', andrea.id);
      await makeInvoice(companyN, 'Fattura in scadenza', {
        supplierName: 'Tipografia Lugano SA', invoiceNumber: 'N-1',
        invoiceDate: isoDay(-10), dueDate: isoDay(2), currency: 'CHF', grossAmount: '100.00',
      });
      await makeInvoice(companyN, 'Fattura scaduta', {
        supplierName: 'Tipografia Lugano SA', invoiceNumber: 'N-2',
        invoiceDate: isoDay(-40), dueDate: isoDay(-2), currency: 'CHF', grossAmount: '200.00',
      });
      // Le due note di credito hanno le stesse scadenze: se entrassero nei
      // totali, i numeri sarebbero 150 e 270 invece di 100 e 200.
      await makeInvoice(companyN, 'Nota di credito in scadenza', {
        supplierName: 'Tipografia Lugano SA', invoiceNumber: 'NC-1',
        invoiceDate: isoDay(-10), dueDate: isoDay(2), currency: 'CHF', grossAmount: '50.00',
      }, 'credit_note');
      await makeInvoice(companyN, 'Nota di credito scaduta', {
        supplierName: 'Tipografia Lugano SA', invoiceNumber: 'NC-2',
        invoiceDate: isoDay(-40), dueDate: isoDay(-2), currency: 'CHF', grossAmount: '70.00',
      }, 'credit_note');

      const { rows, error } = await summaryOf(clientA, companyN);
      const inScadenza = rows.filter((r) => r.bucket === 'due_soon');
      const scadute = rows.filter((r) => r.bucket === 'overdue');
      check('il cruscotto risponde', !error, msg(error));
      check('«in scadenza» conta la sola fattura, non la nota di credito',
        inScadenza.length === 1 && Number(inScadenza[0].n) === 1 && Number(inScadenza[0].total) === 100,
        JSON.stringify(inScadenza));
      check('«scadute» conta la sola fattura, non la nota di credito',
        scadute.length === 1 && Number(scadute[0].n) === 1 && Number(scadute[0].total) === 200,
        JSON.stringify(scadute));
      // Le note di credito esistono e si vedono: sono escluse dai TOTALI, non
      // dal prodotto. Compensarle sottraendole sarebbe peggio (§74).
      const lista = await listItems(clientA, { p_company_id: companyN, p_tab: 'invoices' });
      check('le note di credito restano visibili nella lista',
        !lista.error && lista.rows.filter((r) => r.type === 'credit_note').length === 2,
        msg(lista.error) || JSON.stringify(lista.rows.map((r) => r.type)));
    }

    // =======================================================================
    section('10 · L’ingestione automatica nasce solo dove il segnale basta (§14/§15)');
    // =======================================================================
    {
      const companyI = await makeCompany('Prova Finance Ingestione', andrea.id);

      const docFattura = await makeDocument(companyI, 'Fattura del fornitore');
      await makeAnalysis(companyI, docFattura, { document_type: 'invoice', sender_authority_type: 'private' });
      await sleep(250);
      const { data: nati } = await admin.from('finance_items')
        .select(ITEM_FULL).eq('document_id', docFattura);
      const nato = ((nati ?? []) as unknown as ItemRowFull[])[0];
      check('un’analisi «invoice» fa nascere un elemento finanziario',
        (nati ?? []).length === 1, `elementi ${(nati ?? []).length}`);
      check('e nasce IN CODA e da verificare: nessuno nasce «pronto»',
        nato?.processing_status === 'pending' && nato?.review_status === 'needs_review',
        JSON.stringify(nato));
      check('con la provenienza «regola del prodotto», non «una persona»',
        nato?.origin === 'rule' && nato?.type === 'supplier_invoice', JSON.stringify(nato));

      const docNulla = await makeDocument(companyI, 'Comunicazione informativa');
      await makeAnalysis(companyI, docNulla, { document_type: 'information', sender_authority_type: 'private' });
      await sleep(250);
      const senzaElemento = await countRows('finance_items', 'document_id', docNulla);
      check('un’analisi «information» NON fa nascere niente (§15)',
        senzaElemento === 0, `elementi ${senzaElemento}`);

      // Una RIANALISI non deve creare un secondo elemento né azzerare il lavoro
      // già fatto su quello che c'è.
      await makeAnalysis(companyI, docFattura, { document_type: 'invoice', sender_authority_type: 'private' });
      await sleep(250);
      const dopoRianalisi = await countRows('finance_items', 'document_id', docFattura);
      check('una seconda analisi sullo stesso documento non crea un secondo elemento',
        dopoRianalisi === 1, `elementi ${dopoRianalisi}`);

      const storico = await countRows('finance_events', 'finance_item_id',
        nato?.id ?? '00000000-0000-0000-0000-000000000000');
      check('la nascita è registrata nello storico, che lo scrive il trigger (§87)',
        storico >= 1, `eventi ${storico}`);
    }

    // =======================================================================
    section('11 · L’outbox: l’evento si scrive solo se qualcuno ascolta (§158 della 0020)');
    // =======================================================================
    {
      const companyE = await makeCompany('Prova Finance Eventi', andrea.id);

      // (a) Nessuna regola attiva: portare un elemento a «pronto» non deve
      //     scrivere niente. Sarebbero righe che il worker prende solo per
      //     scoprire che non c'è nulla da fare.
      const muta = await makeInvoice(companyE, 'Fattura senza regole', {
        supplierName: 'Garage Mendrisio SA', invoiceNumber: 'E-1',
        invoiceDate: isoDay(-5), currency: 'CHF', grossAmount: '90.00',
      });
      const { error: readyMuta } = await clientA.from('finance_items')
        .update({ review_status: 'ready' } as never).eq('id', muta.item.id);
      check('un titolare può dichiarare verificata una fattura', !readyMuta, msg(readyMuta));
      await sleep(250);
      const { count: silenzio } = await admin.from('automation_events')
        .select('id', { count: 'exact', head: true }).eq('company_id', companyE);
      check('senza regole attive NON viene scritto alcun evento',
        silenzio === 0, `eventi ${silenzio}`);

      const rigaMuta = await readItem(muta.item.id);
      check('e il timbro di verifica lo mette il database, con la persona che l’ha fatto (§85)',
        rigaMuta?.review_status === 'ready' && rigaMuta?.reviewed_by === andrea.id,
        JSON.stringify(rigaMuta));

      // (b) Con una regola in ascolto l'evento nasce. ⚠️ La regola nomina
      //     l'etichetta nuova dell'enum: se la 0021 non l'avesse davvero
      //     aggiunta, questa riga fallirebbe qui e non a schermo.
      const { error: wfErr } = await admin.from('workflow_definitions').insert({
        company_id: companyE, name: 'Quando una fattura è verificata',
        trigger_type: 'finance_item_ready', condition_match: 'all', conditions: [],
        actions: [{ key: 'create_task', config: { titleTemplate: 'Prepara il pagamento di {{document.title}}', priority: 'high', dueDate: 'none' } }],
        status: 'active', created_by: andrea.id, updated_by: andrea.id,
      } as never);
      check('si può scrivere una regola che ascolta «finance_item_ready»', !wfErr, msg(wfErr));

      const ascoltata = await makeInvoice(companyE, 'Fattura con regola attiva', {
        supplierName: 'Garage Mendrisio SA', invoiceNumber: 'E-2',
        invoiceDate: isoDay(-5), currency: 'CHF', grossAmount: '120.00',
      });
      const { error: readyErr } = await clientA.from('finance_items')
        .update({ review_status: 'ready' } as never).eq('id', ascoltata.item.id);
      check('la seconda fattura si dichiara verificata', !readyErr, msg(readyErr));
      await sleep(250);

      const { data: eventi, error: evErr } = await admin.from('automation_events')
        .select('event_type, entity_type, entity_id, payload').eq('company_id', companyE);
      const righe = (eventi ?? []) as {
        event_type: string; entity_type: string; entity_id: string; payload: { financeItemId?: string };
      }[];
      check('con una regola in ascolto l’evento finisce in automation_events',
        !evErr && righe.length === 1 && righe[0].event_type === 'finance_item_ready',
        msg(evErr) || JSON.stringify(righe));
      check('l’entità è il DOCUMENTO, non l’elemento finanziario',
        righe[0]?.entity_type === 'document' && righe[0]?.entity_id === ascoltata.documentId,
        JSON.stringify(righe[0]));
      check('e il carico dice di quale fattura si tratta',
        righe[0]?.payload?.financeItemId === ascoltata.item.id, JSON.stringify(righe[0]?.payload));
    }

    // =======================================================================
    section('12 · Cancellato il documento non resta niente (§90/§91)');
    // =======================================================================
    {
      const companyC = await makeCompany('Prova Finance Cascata', andrea.id);
      const cascata = await makeInvoice(companyC, 'Fattura da cancellare', {
        supplierName: 'Idraulica Locarno SA', invoiceNumber: 'C-1',
        invoiceDate: isoDay(-20), dueDate: isoDay(5), currency: 'CHF', grossAmount: '640.00',
      });
      await makeExtraction(cascata.item, {
        supplierName: 'Idraulica Locarno SA', invoiceNumber: 'C-1',
        invoiceDate: isoDay(-20), dueDate: isoDay(5), currency: 'CHF', grossAmount: '650.00',
      });
      const { error: corrErr } = await clientA.from('finance_corrections').insert({
        company_id: companyC, finance_item_id: cascata.item.id,
        field: 'gross_amount', corrected_value: '640.00',
      } as never);
      check('la correzione di prova si scrive', !corrErr, msg(corrErr));

      // Prima si CONTA: dichiarare che qualcosa è sparito senza aver verificato
      // che ci fosse è una verifica che passa anche a vuoto.
      const prima = {
        elementi: await countRows('finance_items', 'id', cascata.item.id),
        verbali: await countRows('finance_extractions', 'finance_item_id', cascata.item.id),
        correzioni: await countRows('finance_corrections', 'finance_item_id', cascata.item.id),
        storico: await countRows('finance_events', 'finance_item_id', cascata.item.id),
      };
      check('prima della cancellazione c’è tutto',
        prima.elementi === 1 && prima.verbali === 2 && prima.correzioni === 1 && prima.storico >= 1,
        JSON.stringify(prima));

      const { error: delErr } = await admin.from('documents').delete().eq('id', cascata.documentId);
      check('il documento si cancella', !delErr, msg(delErr));

      check('sparisce l’elemento finanziario',
        await countRows('finance_items', 'id', cascata.item.id) === 0);
      check('spariscono i verbali',
        await countRows('finance_extractions', 'finance_item_id', cascata.item.id) === 0);
      check('spariscono le correzioni',
        await countRows('finance_corrections', 'finance_item_id', cascata.item.id) === 0);
      check('sparisce lo storico',
        await countRows('finance_events', 'finance_item_id', cascata.item.id) === 0);
    }

    // =======================================================================
    section('13 · Il doppione dell’IBAN: SQL e TypeScript dicono la stessa cosa');
    // =======================================================================
    // `public.finance_iban_valid` è un doppione DICHIARATO di `checkIban()`, e
    // serve perché la correzione manuale di un IBAN deve poter ricalcolare la
    // bandiera senza far ripartire il worker — cioè senza una chiamata AI a
    // pagamento. Una copia non si lascia alla buona fede: si confronta.
    {
      const matrice: { iban: string | null; atteso: boolean; perche: string }[] = [
        { iban: 'CH9300762011623852957', atteso: true, perche: 'IBAN svizzero valido' },
        { iban: 'CH4431999123000889012', atteso: true, perche: 'QR-IBAN (istituto 31999)' },
        { iban: 'CH5604835012345678009', atteso: true, perche: 'secondo IBAN svizzero valido' },
        { iban: 'DE89370400440532013000', atteso: true, perche: 'IBAN tedesco valido' },
        { iban: 'LI21088100002324013AA', atteso: true, perche: 'lettere nel BBAN' },
        { iban: 'FR1420041010050500013M02606', atteso: true, perche: 'IBAN francese valido' },
        { iban: 'IT60X0542811101000000123456', atteso: true, perche: 'IBAN italiano valido' },
        { iban: 'GB29NWBK60161331926819', atteso: true, perche: 'paese senza lunghezza dichiarata in SQL' },
        { iban: 'CH93 0076 2011 6238 5295 7', atteso: true, perche: 'scritto a gruppi' },
        { iban: 'CH93-0076-2011-6238-5295-7', atteso: true, perche: 'scritto con trattini' },
        { iban: 'ch9300762011623852957', atteso: true, perche: 'scritto in minuscolo' },
        { iban: 'CH9300762011623852958', atteso: false, perche: 'cifra di controllo sbagliata' },
        { iban: 'CH930076201162385295', atteso: false, perche: 'una cifra in meno' },
        { iban: 'CH9300762011623852957X', atteso: false, perche: 'un carattere in più' },
        { iban: 'DE8937040044053201300', atteso: false, perche: 'lunghezza tedesca sbagliata' },
        { iban: 'XX9300762011623852957', atteso: false, perche: 'paese inesistente' },
        { iban: 'CH93 0076 2011 6238 5295 !', atteso: false, perche: 'carattere non ammesso' },
        { iban: 'ABC', atteso: false, perche: 'troppo corto' },
        { iban: '', atteso: false, perche: 'vuoto' },
        { iban: null, atteso: false, perche: 'assente' },
      ];

      const errori: string[] = [];
      const divergenze: string[] = [];
      const tsSbagliati: string[] = [];
      const sqlSbagliati: string[] = [];

      for (const caso of matrice) {
        const { data, error } = await admin.rpc('finance_iban_valid', { p_iban: caso.iban } as never);
        // ⚠️ Senza `!error` nella condizione, un 42501 diventerebbe `false` e
        // combacerebbe con metà della matrice: verde per la ragione sbagliata.
        if (error) { errori.push(`${caso.iban}: ${msg(error)}`); continue; }
        const sql = data === true;
        const ts = checkIban(caso.iban).valid;
        if (sql !== ts) divergenze.push(`${caso.iban ?? '(null)'} — sql=${sql} ts=${ts} (${caso.perche})`);
        if (ts !== caso.atteso) tsSbagliati.push(`${caso.iban ?? '(null)'} (${caso.perche})`);
        if (sql !== caso.atteso) sqlSbagliati.push(`${caso.iban ?? '(null)'} (${caso.perche})`);
      }

      check('finance_iban_valid risponde su ogni caso della matrice',
        errori.length === 0, errori.join(' | '));
      check(`le due implementazioni concordano su tutti i ${matrice.length} casi`,
        divergenze.length === 0, divergenze.join(' | '));
      // Concordare non basta: due copie possono sbagliare insieme. Ogni caso
      // porta quindi l'esito atteso, e lo si verifica su entrambe.
      check('checkIban() dice ciò che la matrice dichiara', tsSbagliati.length === 0, tsSbagliati.join(', '));
      check('e finance_iban_valid dice la stessa cosa', sqlSbagliati.length === 0, sqlSbagliati.join(', '));
    }

    // =======================================================================
    section('14 · Il codice condiviso, ESEGUITO: lettura deterministica senza AI');
    // =======================================================================
    // ⚠️ Si esegue `processFinanceItem` con `createMessage: null`: la lettura
    // deterministica gira davvero, il modello non viene chiamato e non si spende
    // nulla. Ciò che il codice non sa resta `null` e DICHIARATO.
    //
    // ⚠️ NON si chiama `runFinanceWorker`, e non per pigrizia: quella funzione
    // prende in carico la coda di TUTTE le aziende, e qui si gira contro il
    // database vero — leggerebbe documenti di clienti reali e scriverebbe verbali
    // sulle loro fatture. Si passa quindi l'elemento di prova a mano, che è lo
    // stesso codice un gradino più in basso.
    {
      const companyW = await makeCompany('Prova Finance Worker', andrea.id);
      const documentId = await makeDocument(companyW, 'Fattura elettricità (testo)');
      await makeDocumentText(companyW, documentId, [
        'Fattura',
        'Numero fattura 2026-118',
        'IBAN CH93 0076 2011 6238 5295 7',
        "Totale CHF 1'234.50",
      ].join('\n'));
      const item = await makeItem(companyW, documentId);

      const esito = await processFinanceItem({ sb, createMessage: null }, item);
      check('la lettura si conclude', esito.outcome === 'completed', JSON.stringify(esito));

      const { data: verbale, error: verbErr } = await admin.from('finance_extractions')
        .select('method, creditor_iban, currency, gross_amount, supplier_name, field_sources, provider')
        .eq('finance_item_id', item.id).single();
      const riga = verbale as {
        method: string; creditor_iban: string | null; currency: string | null;
        gross_amount: number | null; supplier_name: string | null;
        field_sources: Record<string, string>; provider: string | null;
      };
      check('l’IBAN esce dalla cifra di controllo, non da un modello',
        !verbErr && riga?.creditor_iban === 'CH9300762011623852957'
        && riga?.field_sources?.creditor_iban === 'deterministic',
        msg(verbErr) || JSON.stringify(riga));
      check('valuta e totale sono letti dall’etichetta esplicita',
        riga?.currency === 'CHF' && Number(riga?.gross_amount) === 1234.5, JSON.stringify(riga));
      check('senza modello configurato il verbale non dichiara un fornitore che non ha letto',
        riga?.supplier_name === null && riga?.provider === null, JSON.stringify(riga));
      check('e il metodo dichiara come è stato ottenuto', riga?.method === 'deterministic', riga?.method);

      const dopo = await readItem(item.id);
      check('il database promuove il verbale e chiude la lavorazione',
        dopo?.processing_status === 'completed' && !!dopo?.current_extraction_id, JSON.stringify(dopo));
      check('la proiezione porta l’IBAN letto',
        dopo?.eff_iban === 'CH9300762011623852957' && Number(dopo?.eff_gross_amount) === 1234.5,
        JSON.stringify(dopo));
      check('e DICHIARA che il fornitore manca invece di inventarlo',
        (dopo?.quality_flags ?? []).includes('missing_supplier'), JSON.stringify(dopo?.quality_flags));
      check('l’elemento resta da verificare: «pronta» è un gesto umano',
        dopo?.review_status === 'needs_review', String(dopo?.review_status));
    }

    // =======================================================================
    section('15 · Fatture emesse (0053): numerazione, guardiani, ciclo di vita');
    // =======================================================================
    // Le fatture verso i CLIENTI: la bozza la scrive solo la RPC, l'emissione
    // esige PDF e IBAN, «inviata» arriva dalla prova di invio, «scaduta» dalla
    // scansione, e dopo l'emissione nulla si modifica — si annulla con nota di
    // credito. I PDF si registrano come farebbe la Edge Function: riga
    // `documents` con source_type 'generated' + RPC di servizio.
    {
      const NIL = '00000000-0000-0000-0000-000000000000';
      const raraF = `Emessine${Date.now()}`;
      const companyFA = await makeCompany('Prova Finance Fatture A', andrea.id);
      const companyFB = await makeCompany('Prova Finance Fatture B', bruno.id);

      // L'IBAN dell'azienda: lo scrive il titolare, lo normalizza e lo verifica
      // il database (trigger della 0053, stessa cifra di controllo della 0021).
      const ibanSet = await clientA.from('companies')
        .update({ bank_iban: 'CH93 0076 2011 6238 5295 7' } as never).eq('id', companyFA);
      const { data: ibanRow } = await admin.from('companies')
        .select('bank_iban').eq('id', companyFA).single();
      check('il titolare registra l’IBAN aziendale, normalizzato dal database',
        !ibanSet.error
        && (ibanRow as { bank_iban?: string } | null)?.bank_iban === 'CH9300762011623852957',
        msg(ibanSet.error) || JSON.stringify(ibanRow));
      const ibanStorto = await clientA.from('companies')
        .update({ bank_iban: 'CH9300762011623852958' } as never).eq('id', companyFA);
      const { data: ibanDopo } = await admin.from('companies')
        .select('bank_iban').eq('id', companyFA).single();
      check('un IBAN che non torna viene rifiutato e il valore resta intatto',
        !!ibanStorto.error && /company_bank_iban_invalid/.test(msg(ibanStorto.error))
        && (ibanDopo as { bank_iban?: string } | null)?.bank_iban === 'CH9300762011623852957',
        `${msg(ibanStorto.error)} — ${JSON.stringify(ibanDopo)}`);

      // I clienti CRM: collegamento, non copia — gli snapshot stanno in testata.
      const { data: orgFaData, error: orgFaErr } = await clientA.from('crm_organizations').insert({
        company_id: companyFA, display_name: `${raraF} Cliente SA`, legal_name: `${raraF} Cliente SA`,
        street: 'Via Cliente 5', postal_code: '6900', city: 'Lugano', country_code: 'CH',
      } as never).select('id').single();
      const orgFA = (orgFaData as { id?: string } | null)?.id ?? NIL;
      const { data: orgFbData, error: orgFbErr } = await clientB.from('crm_organizations').insert({
        company_id: companyFB, display_name: 'Cliente di B SA',
      } as never).select('id').single();
      const orgFB = (orgFbData as { id?: string } | null)?.id ?? NIL;
      check('i clienti CRM delle due aziende si creano',
        !orgFaErr && !orgFbErr && orgFA !== NIL && orgFB !== NIL, msg(orgFaErr) || msg(orgFbErr));

      const { data: rateRows } = await admin.from('finance_vat_rates')
        .select('id, kind').eq('country_code', 'CH').is('valid_to', null);
      const vatRates = (rateRows ?? []) as Array<{ id: string; kind: string }>;
      const vatStandard = vatRates.find((r) => r.kind === 'standard')?.id ?? NIL;
      const vatReduced = vatRates.find((r) => r.kind === 'reduced')?.id ?? NIL;
      check('le aliquote svizzere verificate sono disponibili come dati',
        vatStandard !== NIL && vatReduced !== NIL, JSON.stringify(vatRates));

      const itemsA = [
        { description: 'Consulenza', quantity: '2', unitPrice: '100.00', vatRateId: vatStandard },
        { description: 'Materiale', quantity: '1', unitPrice: '50.00', vatRateId: vatReduced },
      ];
      const saveDraft = (client: Sb, companyId: string, orgId: string, title: string,
        over: Record<string, unknown> = {}) =>
        client.rpc('finance_save_issued_invoice_draft', {
          p_company_id: companyId, p_invoice_id: null, p_organization_id: orgId,
          p_opportunity_id: null, p_quote_version_id: null, p_language: 'it',
          p_currency: 'CHF', p_title: title, p_notes: null,
          p_issued_on: isoDay(-1), p_due_date: isoDay(29), p_items: itemsA, ...over,
        } as never);
      const readInvoice = async (id: string | null, columns: string) => {
        const { data, error } = await admin.from('finance_issued_invoices')
          .select(columns).eq('id', id ?? NIL).single();
        if (error) throw new Error(`rilettura fattura: ${error.message}`);
        return data as unknown as Record<string, unknown>;
      };
      // Il PDF registrato come lo registra la Edge Function: documento generato
      // nello Storage logico, poi la RPC riservata al service role.
      const registerPdf = async (companyId: string, uploaderId: string,
        invoiceId: string | null, kind: string, level: number | null) => {
        const { data: docRow, error: docErr } = await admin.from('documents').insert({
          company_id: companyId, uploaded_by: uploaderId, title: `${kind} di prova`,
          original_filename: `${kind}-${String(invoiceId).slice(0, 8)}.pdf`,
          mime_type: 'application/pdf', file_size: 4000,
          storage_path: `${companyId}/${crypto.randomUUID()}/${kind}.pdf`,
          source_type: 'generated', status: 'uploaded',
        } as never).select('id').single();
        if (docErr) throw new Error(`documento ${kind}: ${docErr.message}`);
        const documentId = (docRow as { id: string }).id;
        createdInvoiceDocs.push(documentId);
        const reg = await admin.rpc('finance_register_issued_invoice_pdf', {
          p_company_id: companyId, p_invoice_id: invoiceId ?? NIL,
          p_kind: kind, p_level: level, p_document_id: documentId,
        } as never);
        return { documentId, error: reg.error as { message?: string } | null };
      };

      const draft1 = await saveDraft(clientA, companyFA, orgFA, `${raraF} consulenza`);
      const inv1 = (draft1.data as string | null) ?? null;
      if (inv1) createdInvoices.push(inv1);
      check('la prima bozza si salva via RPC', !draft1.error && !!inv1, msg(draft1.error));
      const head1 = await readInvoice(inv1,
        'invoice_number, sequence_number, status, subtotal_amount, vat_amount, total_amount, company_bank_iban, customer_display_name');
      check('il primo numero dell’azienda è F-000001',
        head1.invoice_number === 'F-000001' && Number(head1.sequence_number) === 1, JSON.stringify(head1));
      check('PostgreSQL calcola CHF 250.00 + IVA 17.50 = CHF 267.50',
        Number(head1.subtotal_amount) === 250 && Number(head1.vat_amount) === 17.5
        && Number(head1.total_amount) === 267.5, JSON.stringify(head1));
      check('gli snapshot portano IBAN aziendale e nome del cliente (niente riferimenti vivi)',
        head1.company_bank_iban === 'CH9300762011623852957'
        && head1.customer_display_name === `${raraF} Cliente SA`, JSON.stringify(head1));

      const draft2 = await saveDraft(clientA, companyFA, orgFA, `${raraF} materiale`);
      const inv2 = (draft2.data as string | null) ?? null;
      if (inv2) createdInvoices.push(inv2);
      const head2 = await readInvoice(inv2, 'invoice_number, sequence_number');
      check('la seconda bozza prosegue la sequenza: F-000002',
        !draft2.error && head2.invoice_number === 'F-000002', msg(draft2.error) || JSON.stringify(head2));

      const draftB = await saveDraft(clientB, companyFB, orgFB, 'Fattura di B');
      const invB = (draftB.data as string | null) ?? null;
      if (invB) createdInvoices.push(invB);
      const headB = await readInvoice(invB, 'invoice_number');
      check('la numerazione di B riparte da F-000001: il numero è PER AZIENDA',
        !draftB.error && headB.invoice_number === 'F-000001', msg(draftB.error) || JSON.stringify(headB));

      const invalidVat = await saveDraft(clientA, companyFA, orgFA, 'IVA assente', {
        p_items: [{ description: 'Voce', quantity: '1', unitPrice: '1', vatRateId: NIL }],
      });
      check('una aliquota assente dal catalogo verificato viene rifiutata',
        !!invalidVat.error && /finance_issued_invoice_vat_rate_invalid/.test(msg(invalidVat.error)),
        msg(invalidVat.error));

      // ---- permessi e cross-tenant ----------------------------------------
      const directInsert = await clientA.from('finance_issued_invoices').insert({
        company_id: companyFA, organization_id: orgFA, sequence_number: 900,
        invoice_number: 'F-000900', language: 'it', currency: 'CHF', title: 'Abusiva',
        issued_on: isoDay(0), due_date: isoDay(30),
        company_legal_name: 'X', customer_display_name: 'Y', created_by: andrea.id,
      } as never);
      const dopoDiretta = await countRows('finance_issued_invoices', 'invoice_number', 'F-000900');
      check('il browser NON può inserire una fattura direttamente in tabella',
        !!directInsert.error && dopoDiretta === 0, `${msg(directInsert.error)} — righe ${dopoDiretta}`);
      const directUpdate = await clientA.from('finance_issued_invoices')
        .update({ title: 'Tentativo diretto' } as never).eq('id', inv1 ?? NIL);
      const head1dopo = await readInvoice(inv1, 'title');
      check('né modificarla: solo le tre RPC scrivono',
        !!directUpdate.error && head1dopo.title === `${raraF} consulenza`,
        `${msg(directUpdate.error)} — ${JSON.stringify(head1dopo)}`);

      const leak = await clientB.from('finance_issued_invoices')
        .select('id, title').eq('company_id', companyFA);
      check('B non vede le fatture di A',
        !leak.error && (leak.data ?? []).length === 0, msg(leak.error) || `righe ${(leak.data ?? []).length}`);
      const leakItems = await clientB.from('finance_issued_invoice_items')
        .select('id').eq('company_id', companyFA);
      check('né le righe delle fatture di A',
        !leakItems.error && (leakItems.data ?? []).length === 0, msg(leakItems.error));
      const writeOther = await saveDraft(clientB, companyFA, orgFA, 'Scrittura travestita');
      check('la RPC non scrive nell’azienda di un altro',
        !!writeOther.error && /finance_issued_invoice_forbidden/.test(msg(writeOther.error)),
        msg(writeOther.error));
      const crossGuard = await admin.from('finance_issued_invoices').insert({
        company_id: companyFA, organization_id: orgFB, sequence_number: 901,
        invoice_number: 'F-000901', language: 'it', currency: 'CHF', title: 'Cross',
        issued_on: isoDay(0), due_date: isoDay(30),
        company_legal_name: 'X', customer_display_name: 'Y', created_by: andrea.id,
      } as never);
      check('nemmeno il service role può creare una fattura cross-tenant',
        !!crossGuard.error && /finance_issued_invoice_cross_tenant/.test(msg(crossGuard.error)),
        msg(crossGuard.error));

      // ---- emissione: prima il PDF, poi lo stato ---------------------------
      const issueEarly = await clientA.rpc('finance_issue_invoice', {
        p_company_id: companyFA, p_invoice_id: inv1 ?? NIL,
      } as never);
      check('senza PDF registrato l’emissione viene rifiutata',
        !!issueEarly.error && /finance_issued_invoice_pdf_required/.test(msg(issueEarly.error)),
        msg(issueEarly.error));

      const registerAsUser = await clientA.rpc('finance_register_issued_invoice_pdf', {
        p_company_id: companyFA, p_invoice_id: inv1 ?? NIL,
        p_kind: 'invoice', p_level: null, p_document_id: NIL,
      } as never);
      check('la registrazione del PDF è riservata al service role',
        !!registerAsUser.error, msg(registerAsUser.error) || 'chiamata passata dal browser');

      const pdf1 = await registerPdf(companyFA, andrea.id, inv1, 'invoice', null);
      const afterReg = await readInvoice(inv1, 'document_id, pdf_generated_at, status');
      check('la registrazione aggancia il PDF alla bozza con il suo timbro',
        !pdf1.error && afterReg.document_id === pdf1.documentId
        && !!afterReg.pdf_generated_at && afterReg.status === 'draft',
        msg(pdf1.error) || JSON.stringify(afterReg));

      const issue1 = await clientA.rpc('finance_issue_invoice', {
        p_company_id: companyFA, p_invoice_id: inv1 ?? NIL,
      } as never);
      const afterIssue = await readInvoice(inv1, 'status, issued_at, issued_by');
      check('con il PDF la fattura si emette, con istante e persona',
        !issue1.error && afterIssue.status === 'issued' && !!afterIssue.issued_at
        && afterIssue.issued_by === andrea.id, msg(issue1.error) || JSON.stringify(afterIssue));

      // ---- immutabilità ----------------------------------------------------
      const rewriteIssued = await saveDraft(clientA, companyFA, orgFA, 'Riscrittura', { p_invoice_id: inv1 });
      check('la RPC rifiuta la riscrittura di una fattura emessa',
        !!rewriteIssued.error && /finance_issued_invoice_immutable/.test(msg(rewriteIssued.error)),
        msg(rewriteIssued.error));
      const mutateIssued = await admin.from('finance_issued_invoices')
        .update({ title: 'Non deve cambiare' } as never).eq('id', inv1 ?? NIL);
      const titleAfter = await readInvoice(inv1, 'title');
      check('nemmeno il service role modifica i campi commerciali di un’emessa',
        !!mutateIssued.error && /finance_issued_invoice_immutable/.test(msg(mutateIssued.error))
        && titleAfter.title === `${raraF} consulenza`,
        `${msg(mutateIssued.error)} — ${JSON.stringify(titleAfter)}`);
      const { data: itemRow } = await admin.from('finance_issued_invoice_items')
        .select('id').eq('invoice_id', inv1 ?? NIL).limit(1).single();
      const mutateItem = await admin.from('finance_issued_invoice_items')
        .update({ description: 'Non deve cambiare' } as never)
        .eq('id', (itemRow as { id?: string } | null)?.id ?? NIL);
      check('né si toccano le righe di una fattura emessa',
        !!mutateItem.error && /finance_issued_invoice_item_immutable/.test(msg(mutateItem.error)),
        msg(mutateItem.error));

      // ---- B senza IBAN: la bozza si disegna, l'emissione no ----------------
      const pdfB = await registerPdf(companyFB, bruno.id, invB, 'invoice', null);
      const issueB = await clientB.rpc('finance_issue_invoice', {
        p_company_id: companyFB, p_invoice_id: invB ?? NIL,
      } as never);
      check('senza IBAN aziendale la fattura NON si emette',
        !pdfB.error && !!issueB.error && /finance_issued_invoice_iban_required/.test(msg(issueB.error)),
        msg(pdfB.error) || msg(issueB.error));

      // ---- pagata: la data effettiva la dichiara una persona ----------------
      const paid = await clientA.rpc('finance_set_issued_invoice_status', {
        p_company_id: companyFA, p_invoice_id: inv1 ?? NIL,
        p_status: 'paid', p_paid_on: isoDay(-1), p_void_reason: null,
      } as never);
      const afterPaid = await readInvoice(inv1, 'status, paid_at, paid_by, paid_on');
      check('«pagata» registra la data dichiarata, l’istante e la persona',
        !paid.error && afterPaid.status === 'paid' && afterPaid.paid_on === isoDay(-1)
        && !!afterPaid.paid_at && afterPaid.paid_by === andrea.id,
        msg(paid.error) || JSON.stringify(afterPaid));
      const paidToVoid = await clientA.rpc('finance_set_issued_invoice_status', {
        p_company_id: companyFA, p_invoice_id: inv1 ?? NIL,
        p_status: 'voided', p_void_reason: 'Tentativo tardivo',
      } as never);
      check('da «pagata» non si passa più ad altro stato',
        !!paidToVoid.error && /finance_issued_invoice_status_transition_invalid/.test(msg(paidToVoid.error)),
        msg(paidToVoid.error));

      // ---- annullo: la nota di credito ha numerazione propria ----------------
      const pdf2 = await registerPdf(companyFA, andrea.id, inv2, 'invoice', null);
      const issue2 = await clientA.rpc('finance_issue_invoice', {
        p_company_id: companyFA, p_invoice_id: inv2 ?? NIL,
      } as never);
      check('anche la seconda fattura si emette', !pdf2.error && !issue2.error,
        msg(pdf2.error) || msg(issue2.error));
      const voidNoReason = await clientA.rpc('finance_set_issued_invoice_status', {
        p_company_id: companyFA, p_invoice_id: inv2 ?? NIL,
        p_status: 'voided', p_void_reason: '   ',
      } as never);
      check('annullare senza motivo viene rifiutato',
        !!voidNoReason.error && /finance_issued_invoice_void_reason_required/.test(msg(voidNoReason.error)),
        msg(voidNoReason.error));
      const voided = await clientA.rpc('finance_set_issued_invoice_status', {
        p_company_id: companyFA, p_invoice_id: inv2 ?? NIL,
        p_status: 'voided', p_void_reason: 'Importo errato sulle righe',
      } as never);
      const afterVoid = await readInvoice(inv2,
        'status, voided_at, voided_by, void_reason, credit_note_number');
      check('l’annullo produce «annullata» + nota di credito NC-000001, col motivo',
        !voided.error && afterVoid.status === 'voided'
        && afterVoid.credit_note_number === 'NC-000001' && !!afterVoid.voided_at
        && afterVoid.voided_by === andrea.id && afterVoid.void_reason === 'Importo errato sulle righe',
        msg(voided.error) || JSON.stringify(afterVoid));

      // ---- «inviata»: la scrive la prova di invio, non un gesto --------------
      const draft3 = await saveDraft(clientA, companyFA, orgFA, `${raraF} da inviare`);
      const inv3 = (draft3.data as string | null) ?? null;
      if (inv3) createdInvoices.push(inv3);
      const pdf3 = await registerPdf(companyFA, andrea.id, inv3, 'invoice', null);
      const issue3 = await clientA.rpc('finance_issue_invoice', {
        p_company_id: companyFA, p_invoice_id: inv3 ?? NIL,
      } as never);
      check('la terza fattura si emette (F-000003)', !draft3.error && !pdf3.error && !issue3.error,
        msg(draft3.error) || msg(pdf3.error) || msg(issue3.error));
      const stampMail = Date.now();
      const invEmail = await admin.from('email_messages').insert({
        company_id: companyFA, connection_id: null, provider_message_id: `crm:invoice-${stampMail}`,
        provider_thread_id: `crm:invoice-${stampMail}`, subject: 'Fattura F-000003',
        sender_name: 'Ai-Swisse', sender_email: 'crm@example.ch',
        to_recipients: [{ email: `fattura-${stampMail}@example.ch` }],
        received_at: new Date().toISOString(), sent_at: new Date().toISOString(),
        body_text: 'In allegato.', body_preview: 'In allegato.',
        direction: 'out', delivery_status: null,
        send_idempotency_key: crypto.randomUUID(), sent_by: andrea.id,
      } as never).select('id').single();
      const invEmailId = (invEmail.data as { id?: string } | null)?.id ?? NIL;
      const attach = await admin.from('crm_outgoing_email_attachments').insert({
        company_id: companyFA, email_message_id: invEmailId, document_id: pdf3.documentId,
      } as never);
      const premature = await admin.rpc('finance_mark_attached_invoices_sent', {
        p_company_id: companyFA, p_email_message_id: invEmailId,
      } as never);
      const stillIssued = await readInvoice(inv3, 'status, sent_at');
      check('senza l’accettazione del provider la fattura NON diventa inviata',
        !invEmail.error && !attach.error && !!premature.error
        && /finance_issued_invoice_email_not_sent/.test(msg(premature.error))
        && stillIssued.status === 'issued' && stillIssued.sent_at === null,
        msg(premature.error) || JSON.stringify(stillIssued));
      const providerOk = await admin.from('email_messages')
        .update({ delivery_status: 'sent', delivery_provider_id: `resend-invoice-${stampMail}` } as never)
        .eq('id', invEmailId);
      const marked = await admin.rpc('finance_mark_attached_invoices_sent', {
        p_company_id: companyFA, p_email_message_id: invEmailId,
      } as never);
      const afterSent = await readInvoice(inv3, 'status, sent_at, sent_by, sent_email_id');
      check('solo la risposta del provider porta la fattura a «inviata», col legame all’email',
        !providerOk.error && !marked.error && (marked.data as number | null) === 1
        && afterSent.status === 'sent' && !!afterSent.sent_at
        && afterSent.sent_email_id === invEmailId,
        msg(providerOk.error) || msg(marked.error) || JSON.stringify(afterSent));

      // ---- solleciti: un documento per livello, il doppio è un conflitto ------
      const rem1 = await registerPdf(companyFA, andrea.id, inv3, 'reminder', 1);
      const rem2 = await registerPdf(companyFA, andrea.id, inv3, 'reminder', 2);
      const { data: docRows } = await admin.from('finance_issued_invoice_documents')
        .select('kind, level').eq('invoice_id', inv3 ?? NIL);
      const bridge = (docRows ?? []) as Array<{ kind: string; level: number | null }>;
      check('i solleciti di livello 1 e 2 si registrano come documenti di provenienza',
        !rem1.error && !rem2.error
        && bridge.filter((d) => d.kind === 'reminder').length === 2
        && bridge.some((d) => d.kind === 'invoice'),
        msg(rem1.error) || msg(rem2.error) || JSON.stringify(bridge));
      const dupLevel = await registerPdf(companyFA, andrea.id, inv3, 'reminder', 2);
      check('un PDF DIVERSO per lo stesso livello è un conflitto',
        !!dupLevel.error && /finance_issued_invoice_document_conflict/.test(msg(dupLevel.error)),
        msg(dupLevel.error));
      const retrySame = await admin.rpc('finance_register_issued_invoice_pdf', {
        p_company_id: companyFA, p_invoice_id: inv3 ?? NIL,
        p_kind: 'reminder', p_level: 2, p_document_id: rem2.documentId,
      } as never);
      const { count: bridgeCount } = await admin.from('finance_issued_invoice_documents')
        .select('id', { count: 'exact', head: true }).eq('invoice_id', inv3 ?? NIL);
      check('ri-registrare LO STESSO documento è un retry idempotente, non un conflitto',
        !retrySame.error && bridgeCount === 3, msg(retrySame.error) || `ponti ${bridgeCount}`);

      // ---- scaduta: la scansione emette una volta, con la sua chiave -----------
      const draft4 = await saveDraft(clientA, companyFA, orgFA, `${raraF} scaduta`, {
        p_issued_on: isoDay(-32), p_due_date: isoDay(-2),
      });
      const inv4 = (draft4.data as string | null) ?? null;
      if (inv4) createdInvoices.push(inv4);
      const pdf4 = await registerPdf(companyFA, andrea.id, inv4, 'invoice', null);
      const issue4 = await clientA.rpc('finance_issue_invoice', {
        p_company_id: companyFA, p_invoice_id: inv4 ?? NIL,
      } as never);
      check('una fattura con scadenza passata si emette (la scansione è un passo a parte)',
        !draft4.error && !pdf4.error && !issue4.error,
        msg(draft4.error) || msg(pdf4.error) || msg(issue4.error));
      const { error: wfErr } = await admin.from('workflow_definitions').insert({
        company_id: companyFA, name: 'Quando una fattura emessa scade',
        trigger_type: 'finance_issued_invoice_overdue', condition_match: 'all', conditions: [],
        actions: [{ key: 'create_task', config: { titleTemplate: 'Sollecita la fattura', priority: 'high', dueDate: 'none' } }],
        status: 'active', created_by: andrea.id, updated_by: andrea.id,
      } as never);
      check('una regola può ascoltare «finance_issued_invoice_overdue» (0053+0054)', !wfErr, msg(wfErr));

      const scan1 = await admin.rpc('finance_emit_issued_invoice_overdue', {} as never);
      const afterOverdue = await readInvoice(inv4, 'status, overdue_at, due_date');
      const { data: overdueRows } = await admin.from('automation_events')
        .select('event_type, entity_type, entity_id, dedupe_key, payload').eq('company_id', companyFA);
      const events1 = (overdueRows ?? []) as Array<{
        event_type: string; entity_type: string; entity_id: string;
        dedupe_key: string | null; payload: { invoice_number?: string };
      }>;
      check('la scansione porta la fattura a «scaduta» con il suo timbro',
        !scan1.error && (scan1.data as number | null) === 1
        && afterOverdue.status === 'overdue' && !!afterOverdue.overdue_at,
        msg(scan1.error) || JSON.stringify(afterOverdue));
      check('e scrive UN evento sull’entità fattura, con la chiave di deduplicazione',
        events1.length === 1 && events1[0].event_type === 'finance_issued_invoice_overdue'
        && events1[0].entity_type === 'finance_issued_invoice' && events1[0].entity_id === inv4
        && events1[0].dedupe_key === `fininv:${inv4}:overdue:${afterOverdue.due_date}`
        && events1[0].payload?.invoice_number === 'F-000004',
        JSON.stringify(events1));
      const scan2 = await admin.rpc('finance_emit_issued_invoice_overdue', {} as never);
      const { count: events2 } = await admin.from('automation_events')
        .select('id', { count: 'exact', head: true }).eq('company_id', companyFA);
      const overdueDopo = await readInvoice(inv4, 'status');
      check('una seconda scansione non duplica né evento né transizione (idempotenza)',
        !scan2.error && (scan2.data as number | null) === 0 && events2 === 1
        && overdueDopo.status === 'overdue', msg(scan2.error) || `eventi ${events2}`);
    }
  } catch (e) {
    fail++;
    console.error(`\n${R}Errore durante il test:${X}`, e);
  } finally {
    // ⚠️ LA PULIZIA STA NEL `finally` E FA PARTE DEL TEST. Lezione del
    // 2026-07-27: `cleanup()` dell'Inbox ignorava l'esito delle delete e due
    // aziende di prova sono rimaste nel database di PRODUZIONE, viste solo
    // grazie a `inbox:diagnose`.
    await cleanup();
  }

  console.log(`\n${B}Risultato${X}  ${pass} superati, ${fail} falliti\n`);
  process.exit(fail ? 1 : 0);
}

async function cleanup() {
  section('Pulizia');
  const problemi: string[] = [];

  for (const id of created.companies) {
    // supabase-js NON solleva: restituisce `{ error }`. Ignorarlo è esattamente
    // il modo in cui i dati di prova sopravvivono a un test verde.
    const { error } = await admin.from('companies').delete().eq('id', id);
    if (error) problemi.push(`azienda ${id}: ${error.message}`);
  }
  for (const id of created.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) problemi.push(`utente ${id}: ${error.message}`);
  }

  // ---- e adesso si RILEGGE: che la delete non abbia protestato non prova che
  //      la riga sia sparita.
  let aziendeRimaste = 0;
  if (created.companies.length) {
    const { count, error } = await admin.from('companies')
      .select('id', { count: 'exact', head: true }).in('id', created.companies);
    if (error) problemi.push(`rilettura aziende: ${error.message}`);
    aziendeRimaste = count ?? 0;
  }
  check('tutte le aziende di prova sono sparite dal database',
    problemi.length === 0 && aziendeRimaste === 0,
    problemi.join(' | ') || `rimaste ${aziendeRimaste}`);

  // ---- i residui della sezione 15: la cancellazione dell'azienda deve aver
  //      portato via fatture, righe, ponti di provenienza e PDF generati.
  if (createdInvoices.length) {
    const { count: fatture } = await admin.from('finance_issued_invoices')
      .select('id', { count: 'exact', head: true }).in('id', createdInvoices);
    const { count: righe } = await admin.from('finance_issued_invoice_items')
      .select('id', { count: 'exact', head: true }).in('invoice_id', createdInvoices);
    const { count: ponti } = await admin.from('finance_issued_invoice_documents')
      .select('id', { count: 'exact', head: true }).in('invoice_id', createdInvoices);
    check('le tre tabelle delle fatture emesse non conservano nulla delle aziende di prova',
      (fatture ?? 0) === 0 && (righe ?? 0) === 0 && (ponti ?? 0) === 0,
      `fatture ${fatture} · righe ${righe} · ponti ${ponti}`);
  }
  if (createdInvoiceDocs.length) {
    const { count: documenti } = await admin.from('documents')
      .select('id', { count: 'exact', head: true }).in('id', createdInvoiceDocs);
    check('né i documenti PDF generati per le prove',
      (documenti ?? 0) === 0, `documenti ${documenti}`);
  }

  const utentiRimasti: string[] = [];
  for (const id of created.users) {
    const { data, error } = await admin.auth.admin.getUserById(id);
    // Un utente cancellato non si legge più: se si legge, è rimasto.
    if (!error && data?.user) utentiRimasti.push(id);
  }
  check('e tutti gli utenti di prova sono stati rimossi',
    utentiRimasti.length === 0, utentiRimasti.join(', '));
}

// ⚠️ Qui NON si richiama `cleanup()`: il `finally` di `main` l'ha già eseguito,
// e ripeterlo su un errore avvenuto DENTRO la pulizia stessa nasconderebbe il
// primo guasto dietro il secondo. Prima del `try` non viene creato nulla.
main().catch((e) => {
  console.error(`\n${R}Errore:${X}`, e);
  process.exit(1);
});
