// ============================================================================
// AI-Swisse — Documenti (Smart Document Hub): test sul DATABASE REALE.
//   npm run test:documents
//
// Richiede la migrazione 0017 applicata e `.env.test` valorizzato.
//
// Non prova che il codice sia scritto bene: prova che le GARANZIE siano in
// vigore, e la più importante riguarda la RICERCA. Una funzione di ricerca è il
// posto più facile del mondo in cui l'isolamento fra aziende salta senza che
// nessuno se ne accorga: nessun messaggio d'errore, nessun comportamento
// strano, solo un documento di un'altra impresa che compare fra i risultati.
// Per questo la prova centrale è una parola rara scritta in un solo documento
// di una sola azienda.
//
// Le altre garanzie:
//   · categoria — la regola classifica solo dove ha elementi, e una scelta
//     fatta a mano non viene mai sovrascritta da una rianalisi;
//   · correzioni — il Hub mostra il valore corretto, l'analisi resta intatta;
//   · archiviazione — non perde niente e chi archivia lo scrive il server;
//   · cancellazione — la può fare solo chi di dovere;
//   · azioni di gruppo — o tutte o nessuna.
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
const RARE = 'ALPHATESTSECRET';
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
  const email = `docs+${tag}.${Date.now()}@example.com`;
  const data = await withRetry('createUser', () => admin.auth.admin.createUser({
    email, password: PW, email_confirm: true, user_metadata: { first_name: 'Prova', last_name: tag },
  }));
  created.users.push(data.user.id);
  return { id: data.user.id, email };
}

async function makeCompany(name, ownerId, role = 'owner') {
  const { data, error } = await admin.from('companies')
    .insert({ legal_name: name, canton: 'Ticino' }).select('id').single();
  if (error) throw new Error(`company: ${error.message}`);
  created.companies.push(data.id);
  const { error: mErr } = await admin.from('company_members')
    .insert({ company_id: data.id, user_id: ownerId, role });
  if (mErr) throw new Error(`membership: ${mErr.message}`);
  return data.id;
}

async function addMember(companyId, userId, role) {
  const { error } = await admin.from('company_members').insert({ company_id: companyId, user_id: userId, role });
  if (error) throw new Error(`membership ${role}: ${error.message}`);
}

async function signIn(email) {
  const client = anonClient();
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`login ${email}: ${error.message}`);
  return client;
}

/** Un documento completo: record, testo estratto, analisi. Come lo crea la pipeline. */
async function makeDocument(companyId, opts = {}) {
  const { data: doc, error } = await admin.from('documents').insert({
    company_id: companyId,
    uploaded_by: opts.uploadedBy ?? null,
    title: opts.title ?? 'Documento di prova',
    original_filename: opts.filename ?? 'prova.pdf',
    mime_type: 'application/pdf',
    source_type: opts.sourceType ?? 'upload',
    status: opts.status ?? 'completed',
    file_hash: opts.fileHash ?? null,
    page_count: 1,
  }).select('*').single();
  if (error) throw new Error(`documento: ${error.message}`);

  if (opts.fullText) {
    const { error: eErr } = await admin.from('document_extractions').insert({
      document_id: doc.id, company_id: companyId, extraction_method: 'text',
      full_text: opts.fullText, pages: [{ pageNumber: 1, text: opts.fullText }],
      page_count: 1, char_count: opts.fullText.length, truncated: false,
    });
    if (eErr) throw new Error(`estrazione: ${eErr.message}`);
  }

  let analysis = null;
  if (opts.analysis !== false) {
    const { data: an, error: aErr } = await admin.from('document_analyses').insert({
      document_id: doc.id, company_id: companyId,
      analysis_status: opts.analysisStatus ?? 'completed',
      engine: 'test', document_type: opts.documentType ?? null,
      sender: opts.sender ?? null, sender_authority_type: opts.authorityType ?? null,
      deadline: opts.deadline ?? null, document_date: opts.documentDate ?? null,
      amount: opts.amount ?? null, amount_currency: opts.amount ? 'CHF' : null,
      confidence: 'alta', summary: opts.summary ?? null,
      actions: [], requested_documents: [], uncertainties: [],
      error_message_safe: opts.errorMessage ?? null,
    }).select('*').single();
    if (aErr) throw new Error(`analisi: ${aErr.message}`);
    analysis = an;
  }
  return { doc, analysis };
}

async function main() {
  console.log(`${B}AI-Swisse — Documenti: test sul database reale${X}`);

  // ---- prerequisito: la 0017 è applicata? --------------------------------
  const { error: probe } = await admin.from('document_tags').select('id').limit(1);
  if (probe && /does not exist|schema cache/i.test(probe.message ?? '')) {
    console.error(`\n${R}La migrazione 0017 non risulta applicata.${X}`);
    console.error(`${DIM}Applica supabase/migrations/0017_document_hub.sql dal SQL editor, poi riesegui.${X}\n`);
    process.exit(2);
  }

  const userA = await makeUser('a');
  const userB = await makeUser('b');
  const userM = await makeUser('m');          // membro semplice dell'azienda A
  const companyA = await makeCompany(`Alpha ${Date.now()}`, userA.id);
  const companyB = await makeCompany(`Beta ${Date.now()}`, userB.id);
  await addMember(companyA, userM.id, 'member');
  const clientA = await signIn(userA.email);
  const clientB = await signIn(userB.email);
  const clientM = await signIn(userM.email);

  // ---- 1. Classificazione deterministica ---------------------------------
  section('1 · La categoria si deduce solo dove ci sono elementi');
  const fiscale = await makeDocument(companyA, {
    title: 'Rendiconto IVA', documentType: 'tax_document', authorityType: 'federal',
    sender: 'Amministrazione federale delle contribuzioni', deadline: '2026-08-31', amount: 4820,
    fullText: 'Rendiconto IVA quarto trimestre. Termine di pagamento 31.08.2026.',
  });
  const generico = await makeDocument(companyA, {
    title: 'Comunicazione generica', documentType: 'information', authorityType: 'unknown',
    fullText: `Comunicazione senza elementi. Parola rara: ${RARE}.`,
  });
  const fattura = await makeDocument(companyA, {
    title: 'Fattura fornitore', documentType: 'reminder', authorityType: 'private',
    sender: 'Swisscom SA', fullText: 'Sollecito di pagamento fattura telefonia.',
  });

  const { data: fiscaleRow } = await admin.from('documents')
    .select('category, category_source, category_set_by').eq('id', fiscale.doc.id).single();
  check('un documento fiscale finisce fra le imposte', fiscaleRow.category === 'taxes',
    `categoria: ${fiscaleRow.category}`);
  check('e risulta classificato dalla REGOLA, non da una persona',
    fiscaleRow.category_source === 'rule' && fiscaleRow.category_set_by === null,
    `origine: ${fiscaleRow.category_source}, autore: ${fiscaleRow.category_set_by}`);

  const { data: genericoRow } = await admin.from('documents')
    .select('category, category_source').eq('id', generico.doc.id).single();
  check('una comunicazione senza elementi NON riceve una categoria inventata',
    genericoRow.category === null && genericoRow.category_source === null,
    `categoria: ${genericoRow.category}`);

  const { data: fatturaRow } = await admin.from('documents').select('category').eq('id', fattura.doc.id).single();
  check('un sollecito da un privato finisce fra le fatture', fatturaRow.category === 'invoices',
    `categoria: ${fatturaRow.category}`);

  // ---- 2. Scelta manuale: vince e resta ----------------------------------
  section('2 · Una scelta fatta a mano non viene sovrascritta');
  await clientA.from('documents').update({ category: 'contracts' }).eq('id', fiscale.doc.id);
  const { data: manual } = await admin.from('documents')
    .select('category, category_source, category_set_by').eq('id', fiscale.doc.id).single();
  check('la categoria scelta a mano viene salvata', manual.category === 'contracts');
  check('l\'origine diventa «manuale» e porta il nome di chi ha scelto',
    manual.category_source === 'manual' && manual.category_set_by === userA.id,
    `origine: ${manual.category_source}, autore: ${manual.category_set_by}`);

  // Un client che prova a spacciare la propria scelta per una classificazione
  // automatica: il database non gli crede.
  await clientA.from('documents')
    .update({ category: 'banking', category_source: 'rule', category_set_by: null }).eq('id', fiscale.doc.id);
  const { data: spoofed } = await admin.from('documents')
    .select('category, category_source, category_set_by').eq('id', fiscale.doc.id).single();
  check('un client NON può dichiarare «automatico» ciò che ha scelto lui',
    spoofed.category_source === 'manual' && spoofed.category_set_by === userA.id,
    `origine: ${spoofed.category_source}`);

  // Una nuova analisi non deve riportare la categoria a quella dedotta.
  await admin.from('document_analyses').insert({
    document_id: fiscale.doc.id, company_id: companyA, analysis_status: 'completed',
    engine: 'test', document_type: 'tax_document', sender_authority_type: 'federal',
    actions: [], requested_documents: [], uncertainties: [],
  });
  const { data: afterReanalysis } = await admin.from('documents')
    .select('category').eq('id', fiscale.doc.id).single();
  check('una nuova analisi non riscrive la categoria decisa da una persona',
    afterReanalysis.category === 'banking', `categoria: ${afterReanalysis.category}`);

  // La categoria è ORGANIZZAZIONE: non produce correzioni dell'analisi.
  const { count: corrCount } = await admin.from('analysis_corrections')
    .select('id', { count: 'exact', head: true }).eq('document_id', fiscale.doc.id);
  check('cambiare categoria NON produce una correzione dell\'analisi', (corrCount ?? 0) === 0,
    `correzioni trovate: ${corrCount}`);

  // ---- 3. Ricerca: isolamento fra aziende --------------------------------
  section('3 · La ricerca non è una scorciatoia per uscire dalla propria azienda');
  await makeDocument(companyB, {
    title: 'Documento riservato di Beta', documentType: 'information',
    fullText: `Documento di Beta contenente la parola ${RARE} una volta sola.`,
  });

  const { data: bSearch, error: bErr } = await clientB.rpc('list_documents', {
    p_company_id: companyB, p_query: RARE,
  });
  check('B trova la propria parola rara nel testo del documento',
    !bErr && (bSearch ?? []).length === 1, `${bErr?.message ?? `righe: ${(bSearch ?? []).length}`}`);

  const { data: aSearch } = await clientA.rpc('list_documents', { p_company_id: companyA, p_query: RARE });
  check('A cercando la STESSA parola trova solo il proprio documento',
    (aSearch ?? []).length === 1 && (aSearch ?? [])[0].id === generico.doc.id,
    `righe: ${(aSearch ?? []).length}`);

  const { data: crossSearch, error: crossErr } = await clientA.rpc('list_documents', {
    p_company_id: companyB, p_query: RARE,
  });
  check('A NON trova nulla chiedendo esplicitamente l\'azienda di B',
    (crossSearch ?? []).length === 0,
    `righe: ${(crossSearch ?? []).length} · err=${crossErr?.message ?? 'nessuno'}`);

  const { data: crossAll } = await clientA.rpc('list_documents', { p_company_id: companyB });
  check('né elencando i documenti di B senza cercare niente', (crossAll ?? []).length === 0);

  // Il documento di B non deve essere raggiungibile nemmeno per id diretto.
  const { data: bDocs } = await admin.from('documents').select('id').eq('company_id', companyB).limit(1);
  const { data: directB } = await clientA.rpc('list_documents', {
    p_company_id: companyA, p_document_id: bDocs[0].id,
  });
  check('e nemmeno aprendo per id diretto un documento di B', (directB ?? []).length === 0);
  const { data: directRow } = await clientA.from('documents').select('id').eq('id', bDocs[0].id);
  check('la lettura diretta della riga di B resta vuota', (directRow ?? []).length === 0);

  // Scrittura in casa d'altri: A dichiara la PROPRIA azienda ma aggancia
  // l'analisi a un documento di B. Prima della 0017 la policy non lo vietava, e
  // la classificazione automatica avrebbe scritto una categoria su un documento
  // di B — una funzione `security definer` che scavalca la RLS.
  const { error: forgedAnalysis } = await clientA.from('document_analyses').insert({
    document_id: bDocs[0].id, company_id: companyA, engine: 'deterministic-test',
    analysis_status: 'completed', document_type: 'tax_document', sender_authority_type: 'federal',
    actions: [], requested_documents: [], uncertainties: [],
  });
  check('A non può agganciare un\'analisi a un documento di B', !!forgedAnalysis,
    'inserimento accettato!');
  const { data: bUntouched } = await admin.from('documents')
    .select('category').eq('id', bDocs[0].id).single();
  check('e nessuna categoria è finita sul documento di B',
    bUntouched.category === null || bUntouched.category === undefined,
    `categoria: ${bUntouched.category}`);

  // ---- 4. Ricerca nelle tre lingue e sui metadati ------------------------
  section('4 · Ricerca in italiano, tedesco e francese');
  await makeDocument(companyA, {
    title: 'Mahnung Mehrwertsteuer', documentType: 'reminder', authorityType: 'federal',
    sender: 'Eidgenössische Steuerverwaltung',
    fullText: 'Mahnung: die Mehrwertsteuer für das vierte Quartal ist fällig. Referenz 42-123-9.',
  });
  await makeDocument(companyA, {
    title: 'Rappel TVA', documentType: 'reminder', authorityType: 'federal',
    sender: 'Administration fédérale des contributions',
    fullText: "Rappel: la TVA du quatrième trimestre n'a pas été payée. Référence 42-124-0.",
  });

  const de = await clientA.rpc('list_documents', { p_company_id: companyA, p_query: 'Mehrwertsteuer' });
  check('una parola tedesca si trova nel testo', (de.data ?? []).length === 1, `righe: ${(de.data ?? []).length}`);
  const fr = await clientA.rpc('list_documents', { p_company_id: companyA, p_query: 'trimestre' });
  check('una parola francese si trova nel testo', (fr.data ?? []).length >= 1, `righe: ${(fr.data ?? []).length}`);
  const apostrofo = await clientA.rpc('list_documents', { p_company_id: companyA, p_query: "n'a pas été payée" });
  check('una frase con apostrofo e accenti non fa fallire la ricerca', !apostrofo.error,
    apostrofo.error?.message);
  const riferimento = await clientA.rpc('list_documents', { p_company_id: companyA, p_query: '42-123-9' });
  check('un numero di riferimento si trova', (riferimento.data ?? []).length === 1,
    `righe: ${(riferimento.data ?? []).length}`);
  const mittente = await clientA.rpc('list_documents', { p_company_id: companyA, p_query: 'Steuerverwaltung' });
  check('si cerca anche nel mittente, che sta sull\'analisi', (mittente.data ?? []).length === 1);

  // I caratteri jolly digitati da una persona devono cercare sé stessi.
  const jolly = await clientA.rpc('list_documents', { p_company_id: companyA, p_query: '%' });
  check('un « % » cerca un per cento, non «qualsiasi cosa»', (jolly.data ?? []).length === 0,
    `righe: ${(jolly.data ?? []).length}`);
  const vuota = await clientA.rpc('list_documents', { p_company_id: companyA, p_query: '   ' });
  check('una ricerca di soli spazi non è un errore e non filtra', !vuota.error && (vuota.data ?? []).length > 0);

  // ---- 5. Paginazione stabile --------------------------------------------
  section('5 · Paginazione: nessun duplicato, nessuna perdita');
  const bulkIds = [];
  for (let i = 0; i < 7; i++) {
    const { doc } = await makeDocument(companyA, { title: `Serie ${String(i).padStart(2, '0')}`, documentType: 'information' });
    bulkIds.push(doc.id);
  }
  const p1 = await clientA.rpc('list_documents', { p_company_id: companyA, p_limit: 4, p_offset: 0 });
  const p2 = await clientA.rpc('list_documents', { p_company_id: companyA, p_limit: 4, p_offset: 4 });
  const ids1 = (p1.data ?? []).map((r) => r.id);
  const ids2 = (p2.data ?? []).map((r) => r.id);
  check('nessun documento compare in entrambe le pagine',
    ids1.every((id) => !ids2.includes(id)), `pagina 1: ${ids1.length}, pagina 2: ${ids2.length}`);
  check('il totale è quello vero, non il numero di righe consegnate',
    Number((p1.data ?? [])[0]?.total_count ?? 0) > ids1.length,
    `total_count: ${(p1.data ?? [])[0]?.total_count}`);
  const p1bis = await clientA.rpc('list_documents', { p_company_id: companyA, p_limit: 4, p_offset: 0 });
  check('la stessa pagina chiesta due volte torna nello stesso ordine',
    JSON.stringify(ids1) === JSON.stringify((p1bis.data ?? []).map((r) => r.id)));

  // ---- 6. Correzioni umane -----------------------------------------------
  section('6 · Il valore corretto da una persona ha la precedenza');
  const errato = await makeDocument(companyA, {
    title: 'Decisione comunale', documentType: 'official_decision', authorityType: 'municipal',
    sender: 'Comune di Lugamo', deadline: '2026-09-15',
  });
  await clientA.from('analysis_corrections').insert({
    analysis_id: errato.analysis.id, document_id: errato.doc.id, company_id: companyA,
    field: 'sender', original_ai_value: 'Comune di Lugamo', corrected_value: 'Comune di Lugano',
    corrected_by: userA.id,
  });
  const corretto = await clientA.rpc('list_documents', {
    p_company_id: companyA, p_document_id: errato.doc.id,
  });
  const row = (corretto.data ?? [])[0];
  check('il Hub mostra il mittente corretto', row?.sender === 'Comune di Lugano', `mittente: ${row?.sender}`);
  check('e dichiara che è stato corretto da una persona', row?.sender_corrected === true);
  const { data: analysisRow } = await admin.from('document_analyses')
    .select('sender').eq('id', errato.analysis.id).single();
  check('l\'analisi originale resta INTATTA: il valore dell\'AI non si perde',
    analysisRow.sender === 'Comune di Lugamo', `analisi: ${analysisRow.sender}`);

  // Una correzione malformata non deve far fallire l'intera ricerca.
  await clientA.from('analysis_corrections').insert({
    analysis_id: errato.analysis.id, document_id: errato.doc.id, company_id: companyA,
    field: 'deadline', original_ai_value: '2026-09-15', corrected_value: 'non è una data',
    corrected_by: userA.id,
  });
  const dopoMalformata = await clientA.rpc('list_documents', {
    p_company_id: companyA, p_document_id: errato.doc.id,
  });
  check('una correzione non convertibile non fa fallire la lista', !dopoMalformata.error,
    dopoMalformata.error?.message);
  check('e si torna al valore dell\'analisi invece di mostrare spazzatura',
    (dopoMalformata.data ?? [])[0]?.deadline === '2026-09-15',
    `scadenza: ${(dopoMalformata.data ?? [])[0]?.deadline}`);

  // ---- 7. Analisi fallita e documento mai analizzato ---------------------
  section('7 · Un fallimento non si racconta come un risultato');
  const fallita = await makeDocument(companyA, {
    title: 'Scansione illeggibile', analysisStatus: 'failed', status: 'failed',
    errorMessage: 'Testo non estraibile', documentType: null,
  });
  const fallitaRow = (await clientA.rpc('list_documents', {
    p_company_id: companyA, p_document_id: fallita.doc.id,
  })).data?.[0];
  check('un\'analisi fallita resta «failed» nella lista', fallitaRow?.analysis_status === 'failed',
    `stato: ${fallitaRow?.analysis_status}`);
  check('e non porta con sé mittente o tipo inventati',
    !fallitaRow?.sender && !fallitaRow?.document_type,
    `mittente: ${fallitaRow?.sender}, tipo: ${fallitaRow?.document_type}`);
  const failedFilter = await clientA.rpc('list_documents', { p_company_id: companyA, p_state: 'failed' });
  check('il filtro «analisi non riuscita» la trova', (failedFilter.data ?? []).some((r) => r.id === fallita.doc.id));

  const mai = await makeDocument(companyA, { title: 'Mai analizzato', analysis: false, status: 'uploaded' });
  const maiRow = (await clientA.rpc('list_documents', {
    p_company_id: companyA, p_document_id: mai.doc.id,
  })).data?.[0];
  check('un documento senza analisi compare comunque, senza far cadere la lista', !!maiRow);
  check('e non ha uno stato d\'analisi inventato', maiRow?.analysis_status === null,
    `stato: ${maiRow?.analysis_status}`);
  const noneFilter = await clientA.rpc('list_documents', { p_company_id: companyA, p_state: 'none' });
  check('il filtro «non ancora analizzato» lo trova', (noneFilter.data ?? []).some((r) => r.id === mai.doc.id));

  // Un'analisi valida PRECEDENTE non deve sparire per colpa di un tentativo fallito.
  await admin.from('document_analyses').insert({
    document_id: errato.doc.id, company_id: companyA, analysis_status: 'failed',
    engine: 'test', error_message_safe: 'quota esaurita',
    actions: [], requested_documents: [], uncertainties: [],
  });
  const dopoFallimento = (await clientA.rpc('list_documents', {
    p_company_id: companyA, p_document_id: errato.doc.id,
  })).data?.[0];
  check('l\'ultimo tentativo fallito viene dichiarato', dopoFallimento?.last_attempt_failed === true);
  check('ma l\'analisi valida precedente resta visibile',
    dopoFallimento?.sender === 'Comune di Lugano', `mittente: ${dopoFallimento?.sender}`);

  // ---- 8. Etichette -------------------------------------------------------
  section('8 · Etichette: della propria azienda, e una sola volta');
  const { data: tagA, error: tagErr } = await clientA.from('document_tags')
    .insert({ company_id: companyA, name: 'IVA' }).select('*').single();
  check('un membro crea un\'etichetta della propria azienda', !tagErr && !!tagA, tagErr?.message);
  check('e l\'autore lo scrive il database', tagA?.created_by === userA.id);

  const { error: dupErr } = await clientA.from('document_tags')
    .insert({ company_id: companyA, name: ' iva ' });
  check('«iva» non crea una gemella di «IVA»', !!dupErr, 'inserimento accettato!');

  const { error: linkErr } = await clientA.from('document_tag_links')
    .insert({ company_id: companyA, document_id: fiscale.doc.id, tag_id: tagA.id });
  check('l\'etichetta si applica a un documento', !linkErr, linkErr?.message);

  const { data: tagged } = await clientA.rpc('list_documents', {
    p_company_id: companyA, p_tag_ids: [tagA.id],
  });
  check('e il filtro per etichetta lo trova', (tagged ?? []).length === 1 && tagged[0].id === fiscale.doc.id);
  check('l\'etichetta arriva nella riga già composta',
    Array.isArray(tagged?.[0]?.tags) && tagged[0].tags[0]?.name === 'IVA',
    `etichette: ${JSON.stringify(tagged?.[0]?.tags)}`);

  const { data: tagB } = await admin.from('document_tags')
    .insert({ company_id: companyB, name: 'Riservata' }).select('*').single();
  const { data: seesB } = await clientA.from('document_tags').select('id').eq('id', tagB.id);
  check('A non vede le etichette di B', (seesB ?? []).length === 0);

  // Il caso obliquo: A dichiara la PROPRIA azienda ma usa l'etichetta di B.
  const { error: sneakyTag } = await clientA.from('document_tag_links')
    .insert({ company_id: companyA, document_id: fiscale.doc.id, tag_id: tagB.id });
  check('A non applica al proprio documento un\'etichetta di B', !!sneakyTag, 'inserimento accettato!');

  const { error: sneakyDoc } = await clientA.from('document_tag_links')
    .insert({ company_id: companyA, document_id: bDocs[0].id, tag_id: tagA.id });
  check('né applica una propria etichetta a un documento di B', !!sneakyDoc, 'inserimento accettato!');

  // ---- 9. Provenienza dalla posta ----------------------------------------
  section('9 · Un documento può essere arrivato da PIÙ comunicazioni');
  const { data: conn } = await admin.from('email_connections').insert({
    company_id: companyA, provider: 'google', provider_account_id: `acct-${Date.now()}`,
    email_address: 'amministrazione@example.ch', status: 'active', scopes: ['gmail.readonly'],
  }).select('*').single();
  const allegato = await makeDocument(companyA, {
    title: 'Allegato ricevuto', sourceType: 'email', documentType: 'invoice',
    fileHash: `hash-${Date.now()}`,
  });
  const messages = [];
  for (let i = 0; i < 2; i++) {
    const { data: msg } = await admin.from('email_messages').insert({
      company_id: companyA, connection_id: conn.id,
      provider_message_id: `msg-${Date.now()}-${i}`, subject: `Invio numero ${i + 1}`,
      sender_name: 'Fornitore SA', sender_email: 'fornitore@example.ch',
      received_at: new Date().toISOString(), processing_status: 'done', attention_status: 'to_verify',
    }).select('*').single();
    messages.push(msg);
    const { error: relErr } = await admin.from('email_message_documents').insert({
      company_id: companyA, email_message_id: msg.id, document_id: allegato.doc.id, relation: 'body',
    });
    if (relErr) throw new Error(`relazione email: ${relErr.message}`);
  }
  const allegatoRow = (await clientA.rpc('list_documents', {
    p_company_id: companyA, p_document_id: allegato.doc.id,
  })).data?.[0];
  check('lo stesso documento resta UNO solo', !!allegatoRow);
  check('e dichiara due comunicazioni di provenienza', Number(allegatoRow?.email_count) === 2,
    `comunicazioni: ${allegatoRow?.email_count}`);
  const { data: rel } = await clientA.from('email_message_documents')
    .select('email_message_id').eq('document_id', allegato.doc.id);
  check('entrambe restano leggibili dal dettaglio', (rel ?? []).length === 2);

  const sourceFilter = await clientA.rpc('list_documents', { p_company_id: companyA, p_source: 'email' });
  check('il filtro per origine «email» lo trova',
    (sourceFilter.data ?? []).some((r) => r.id === allegato.doc.id));

  // ---- 10. Attività collegate --------------------------------------------
  section('10 · Attività collegate');
  const { data: task1 } = await admin.from('tasks').insert({
    company_id: companyA, created_by: userA.id, document_id: fiscale.doc.id,
    title: 'Trasmettere rendiconto IVA', status: 'open', priority: 'high', source: 'admin_ai',
  }).select('*').single();
  await admin.from('tasks').insert({
    company_id: companyA, created_by: userA.id, document_id: fiscale.doc.id,
    title: 'Attività conclusa', status: 'completed', priority: 'low', source: 'manual',
  });
  const conTask = (await clientA.rpc('list_documents', {
    p_company_id: companyA, p_document_id: fiscale.doc.id,
  })).data?.[0];
  check('il documento porta il conteggio delle attività collegate',
    Number(conTask?.task_count) === 2, `attività: ${conTask?.task_count}`);
  check('e distingue quelle ancora aperte', Number(conTask?.open_task_count) === 1,
    `aperte: ${conTask?.open_task_count}`);
  const senzaTask = (await clientA.rpc('list_documents', {
    p_company_id: companyA, p_document_id: mai.doc.id,
  })).data?.[0];
  check('un documento senza attività dichiara zero, non nulla', Number(senzaTask?.open_task_count) === 0);
  const { data: taskCross } = await clientB.from('tasks').select('id').eq('id', task1.id);
  check('B non vede le attività collegate ai documenti di A', (taskCross ?? []).length === 0);

  // ---- 11. Archiviazione --------------------------------------------------
  section('11 · Archiviare non perde niente');
  // Il conteggio PRIMA. L'asserzione giusta è che archiviando cali di uno, non
  // che arrivi a zero: in questa azienda esistono altre fatture attive (un
  // allegato di tipo `invoice`, sezione 9), e pretendere lo zero misurava il
  // contenuto del test invece del comportamento del prodotto.
  const contaFatture = async (archived) => {
    const { data } = await clientA.rpc('document_category_counts', {
      p_company_id: companyA, p_archived: archived,
    });
    return Number((data ?? []).find((c) => c.category === 'invoices')?.n ?? 0);
  };
  const fattureAttivePrima = await contaFatture(false);
  const fattureArchiviatePrima = await contaFatture(true);

  await clientA.from('documents').update({ archived_at: new Date().toISOString() }).eq('id', fattura.doc.id);
  const { data: archivedRow } = await admin.from('documents')
    .select('archived_at, archived_by').eq('id', fattura.doc.id).single();
  check('chi ha archiviato lo scrive il server', archivedRow.archived_by === userA.id,
    `autore: ${archivedRow.archived_by}`);

  const attivi = await clientA.rpc('list_documents', { p_company_id: companyA });
  check('l\'archiviato sparisce dalla vista corrente',
    !(attivi.data ?? []).some((r) => r.id === fattura.doc.id));
  const archiviati = await clientA.rpc('list_documents', { p_company_id: companyA, p_archived: true });
  check('e compare fra gli archiviati', (archiviati.data ?? []).some((r) => r.id === fattura.doc.id));
  const perId = await clientA.rpc('list_documents', {
    p_company_id: companyA, p_document_id: fattura.doc.id,
  });
  check('il suo indirizzo diretto continua a funzionare', (perId.data ?? []).length === 1);

  const { error: countsErr } = await clientA
    .rpc('document_category_counts', { p_company_id: companyA, p_archived: false });
  check('i conteggi per categoria si leggono', !countsErr, countsErr?.message);

  const fattureAttiveDopo = await contaFatture(false);
  const fattureArchiviateDopo = await contaFatture(true);
  check('archiviando, la categoria conta una fattura attiva in meno',
    fattureAttiveDopo === fattureAttivePrima - 1,
    `prima ${fattureAttivePrima}, dopo ${fattureAttiveDopo}`);
  check('e una in più fra gli archiviati: il documento si sposta, non sparisce',
    fattureArchiviateDopo === fattureArchiviatePrima + 1,
    `prima ${fattureArchiviatePrima}, dopo ${fattureArchiviateDopo}`);

  await clientA.from('documents').update({ archived_at: null }).eq('id', fattura.doc.id);
  const { data: restored } = await admin.from('documents')
    .select('archived_at, archived_by, category').eq('id', fattura.doc.id).single();
  check('ripristinando torna nelle viste correnti', restored.archived_at === null && restored.archived_by === null);
  check('e la sua organizzazione è rimasta intatta', restored.category === 'invoices');

  const { data: countsB } = await clientA.rpc('document_category_counts', { p_company_id: companyB });
  check('A non ottiene i conteggi di B', (countsB ?? []).length === 0, `righe: ${(countsB ?? []).length}`);

  // ---- 12. Azioni di gruppo -----------------------------------------------
  section('12 · Azioni di gruppo: o tutte o nessuna');
  const { data: bulkOk, error: bulkErr } = await clientA.rpc('documents_bulk_set_category', {
    p_company_id: companyA, p_ids: bulkIds.slice(0, 3), p_category: 'banking',
  });
  check('assegnare una categoria a tre documenti funziona', !bulkErr && Number(bulkOk) === 3,
    bulkErr?.message ?? `aggiornati: ${bulkOk}`);

  const misti = [...bulkIds.slice(3, 5), bDocs[0].id];
  const { error: mixedErr } = await clientA.rpc('documents_bulk_set_category', {
    p_company_id: companyA, p_ids: misti, p_category: 'clients',
  });
  check('una selezione che contiene un documento di un\'altra azienda viene RIFIUTATA', !!mixedErr,
    'operazione accettata!');
  const { data: notTouched } = await admin.from('documents')
    .select('id, category').in('id', bulkIds.slice(3, 5));
  check('e non ne modifica nemmeno uno: niente lavoro a metà',
    (notTouched ?? []).every((r) => r.category === null),
    `categorie: ${JSON.stringify((notTouched ?? []).map((r) => r.category))}`);

  const { error: emptyErr } = await clientA.rpc('documents_bulk_archive', {
    p_company_id: companyA, p_ids: [], p_archived: true,
  });
  check('una selezione vuota è un errore dichiarato, non un successo silenzioso', !!emptyErr);

  // ---- 13. Cancellazione definitiva ---------------------------------------
  section('13 · Cancellare per sempre: solo chi di dovere');
  const { doc: altrui } = await makeDocument(companyA, {
    title: 'Caricato dal titolare', uploadedBy: userA.id,
  });
  const { doc: propri } = await makeDocument(companyA, {
    title: 'Caricato dal membro', uploadedBy: userM.id,
  });
  const { doc: daEmail } = await makeDocument(companyA, {
    title: 'Arrivato via email', sourceType: 'email', uploadedBy: null,
  });

  await clientM.from('documents').delete().eq('id', altrui.id);
  const { data: stillThere } = await admin.from('documents').select('id').eq('id', altrui.id);
  check('un membro semplice NON cancella un documento caricato da altri',
    (stillThere ?? []).length === 1);

  await clientM.from('documents').delete().eq('id', daEmail.id);
  const { data: emailStill } = await admin.from('documents').select('id').eq('id', daEmail.id);
  check('né un documento arrivato dalla posta', (emailStill ?? []).length === 1);

  await clientM.from('documents').delete().eq('id', propri.id);
  const { data: ownGone } = await admin.from('documents').select('id').eq('id', propri.id);
  check('ma cancella ciò che ha caricato lui', (ownGone ?? []).length === 0);

  await clientA.from('documents').delete().eq('id', altrui.id);
  const { data: adminGone } = await admin.from('documents').select('id').eq('id', altrui.id);
  check('chi amministra l\'azienda cancella qualunque documento', (adminGone ?? []).length === 0);

  // Cosa si porta via davvero: lo si verifica invece di dichiararlo.
  const { doc: conTutto, analysis: anTutto } = await makeDocument(companyA, {
    title: 'Con analisi ed estrazione', uploadedBy: userA.id, documentType: 'invoice',
    fullText: 'Testo di prova per la cancellazione.',
  });
  await admin.from('analysis_corrections').insert({
    analysis_id: anTutto.id, document_id: conTutto.id, company_id: companyA,
    field: 'sender', original_ai_value: 'X', corrected_value: 'Y', corrected_by: userA.id,
  });
  const { data: tagTutto } = await admin.from('document_tags')
    .insert({ company_id: companyA, name: `Tmp ${Date.now()}` }).select('*').single();
  await admin.from('document_tag_links')
    .insert({ company_id: companyA, document_id: conTutto.id, tag_id: tagTutto.id });
  const { data: taskTutto } = await admin.from('tasks').insert({
    company_id: companyA, created_by: userA.id, document_id: conTutto.id,
    title: 'Attività che resta', status: 'open', priority: 'low', source: 'manual',
  }).select('*').single();

  await clientA.from('documents').delete().eq('id', conTutto.id);
  const gone = async (table, column, value) => {
    const { count } = await admin.from(table).select('*', { count: 'exact', head: true }).eq(column, value);
    return (count ?? 0) === 0;
  };
  check('cancellando spariscono le analisi', await gone('document_analyses', 'document_id', conTutto.id));
  check('e il testo estratto', await gone('document_extractions', 'document_id', conTutto.id));
  check('e le correzioni umane', await gone('analysis_corrections', 'document_id', conTutto.id));
  check('e i collegamenti alle etichette', await gone('document_tag_links', 'document_id', conTutto.id));
  const { data: taskAfter } = await admin.from('tasks')
    .select('id, document_id').eq('id', taskTutto.id).maybeSingle();
  check('l\'attività collegata RESTA, senza più il documento',
    !!taskAfter && taskAfter.document_id === null,
    `attività: ${taskAfter ? `document_id=${taskAfter.document_id}` : 'sparita'}`);
  const { data: tagAfter } = await admin.from('document_tags').select('id').eq('id', tagTutto.id);
  check('l\'etichetta dell\'azienda resta: è di tutti, non di quel documento',
    (tagAfter ?? []).length === 1);

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
  // Una pulizia incompleta fa fallire il test: è già successo che due aziende
  // di prova restassero nel database di PRODUZIONE, viste solo giorni dopo.
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
