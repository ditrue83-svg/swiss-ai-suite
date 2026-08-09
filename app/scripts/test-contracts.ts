// ============================================================================
// AI-Swisse — Contract Manager: test d'integrazione sul DATABASE REALE.
//   npm run test:contracts
//
// Richiede la migrazione 0024 applicata e `.env.test` valorizzato.
//
// Non prova che il codice sia scritto bene: prova che le GARANZIE siano in
// vigore. Sono dodici, e stanno tutte nel DATABASE, perché un servizio ben
// educato non è una garanzia — è la lezione della 0014, dove i permessi di
// colonna dichiarati nei commenti non restringevano nulla e il difetto è emerso
// solo ESEGUENDO:
//
//    1. ISOLAMENTO — l'azienda A non vede nulla di B, tabella per tabella.
//    2. CROSS-TENANT DOCUMENTI — un contratto di A non può puntare a un
//       documento di B (§104).
//    3. CROSS-TENANT ATTIVITÀ — un'attività di A non può puntare a un
//       contratto di B (§105).
//    4. RESPONSABILE — non può essere una persona esterna all'azienda (§102).
//    5. PERMESSI — che cosa un membro NON può scrivere, verificato rileggendo.
//    6. IMMUTABILITÀ — una versione verificata dei termini non si modifica.
//    7. CORREZIONI — append-only, la bozza si ricalcola, l'estrazione resta.
//    8. ARITMETICA DELLE DATE — i casi limite, contro Postgres (§48).
//    9. CANDIDATA ≠ VERIFICATA — e una candidata non emette eventi (§87).
//   10. AMENDMENT — non sovrascrive: apre una revisione (§26/§28).
//   11. AUTOMAZIONI — l'outbox scrive solo se qualcuno ascolta.
//   12. CASCATA — cancellata l'azienda non resta niente, tabella per tabella.
//
// ⚠️ LA PULIZIA CONTROLLA IL PROPRIO ESITO. supabase-js non solleva: restituisce
// `{ error }`. Ignorarlo ha già lasciato due aziende di test nel database di
// PRODUZIONE (lezione di `test-inbox`), e sette con la 0023.
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

async function makeTenant(label: string) {
  const email = `contracts.${label}.${stamp}@swissai-suite.ch`;
  const { data: u, error: ue } = await withRetry(() =>
    admin.auth.admin.createUser({ email, password: PW, email_confirm: true }));
  if (ue || !u?.user) throw new Error(`utente ${label}: ${msg(ue)}`);
  created.users.push(u.user.id);

  const user = anonClient();
  const { error: se } = await user.auth.signInWithPassword({ email, password: PW });
  if (se) throw new Error(`login ${label}: ${msg(se)}`);

  const { data: cid, error: ce } = await user.rpc('create_company_with_owner', {
    p_legal_name: `Contracts ${label} ${stamp}`,
  });
  if (ce || !cid) throw new Error(`azienda ${label}: ${msg(ce)}`);
  created.companies.push(cid as string);

  return { userId: u.user.id, companyId: cid as string, client: user, email };
}

/** Un documento vero: serve a collegare e a provare il cross-tenant. */
async function makeDocument(companyId: string, title: string): Promise<string> {
  const { data, error } = await admin.from('documents')
    .insert({ company_id: companyId, title, source_type: 'upload', status: 'completed' })
    .select('id').single();
  if (error) throw new Error(`documento: ${msg(error)}`);
  return (data as { id: string }).id;
}

async function main() {
  console.log(`${B}Contract Manager — test sul database reale${X}`);

  const A = await makeTenant('a');
  const Bt = await makeTenant('b');

  // -------------------------------------------------------------------------
  section('1 · Il contratto nasce, e nasce DA VERIFICARE');
  // -------------------------------------------------------------------------
  const { data: cA, error: cAe } = await A.client.from('contracts').insert({
    company_id: A.companyId, display_name: 'Contratto A', contract_type: 'telecom',
    counterparty_name: 'Controparte A',
  }).select('id, review_status, origin, current_term_version_id').single();
  check('un membro può creare un contratto', !cAe, msg(cAe));
  if (cAe) { await cleanup(); process.exit(1); }
  const contractA = (cA as { id: string }).id;
  check('nasce «da verificare»', (cA as { review_status: string }).review_status === 'needs_review');
  // ⚠️ `origin` non è scrivibile dal client: lo decide il guardiano.
  check('la provenienza è «manuale», scritta dal database',
    (cA as { origin: string }).origin === 'manual');
  check('nessuna versione dei termini è ancora IN VIGORE',
    (cA as { current_term_version_id: string | null }).current_term_version_id === null);

  const { data: drafts } = await A.client.from('contract_term_versions')
    .select('id, version, status').eq('contract_id', contractA);
  const draftA = (drafts ?? [])[0] as { id: string; version: number; status: string } | undefined;
  // §132 — la bozza nasce con il contratto: si può compilare a mano subito.
  check('una BOZZA dei termini nasce insieme al contratto', !!draftA && draftA.status === 'draft',
    JSON.stringify(drafts));

  // -------------------------------------------------------------------------
  section('2 · Isolamento fra aziende');
  // -------------------------------------------------------------------------
  const { data: seenByB } = await Bt.client.from('contracts').select('id').eq('id', contractA);
  check('B non vede il contratto di A', (seenByB ?? []).length === 0);

  const { data: listB } = await Bt.client.rpc('list_contracts', {
    p_company_id: A.companyId, p_limit: 25,
  });
  // ⚠️ La funzione è `security invoker` E filtra per appartenenza: due strati.
  check('B non ottiene le righe di A nemmeno chiedendo la sua azienda',
    ((listB ?? []) as unknown[]).length === 0);

  const { data: versionsB } = await Bt.client.from('contract_term_versions')
    .select('id').eq('contract_id', contractA);
  check('B non vede i TERMINI di A', (versionsB ?? []).length === 0);

  const { data: eventsB } = await Bt.client.from('contract_events')
    .select('id').eq('contract_id', contractA);
  check('B non vede lo STORICO di A', (eventsB ?? []).length === 0);

  // -------------------------------------------------------------------------
  section('3 · Cross-tenant: documenti e attività (§104/§105)');
  // -------------------------------------------------------------------------
  const docA = await makeDocument(A.companyId, 'Accordo A');
  const docB = await makeDocument(Bt.companyId, 'Accordo B');

  const { error: linkOk } = await A.client.from('contract_documents').insert({
    company_id: A.companyId, contract_id: contractA, document_id: docA, relation: 'main_agreement',
  });
  check('A può collegare un PROPRIO documento', !linkOk, msg(linkOk));

  const { error: linkBad } = await A.client.from('contract_documents').insert({
    company_id: A.companyId, contract_id: contractA, document_id: docB, relation: 'annex',
  });
  check('A NON può collegare un documento di B', !!linkBad, 'nessun errore: la difesa non c\'è');

  // ⚠️ Anche con il SERVICE ROLE, che scavalca la RLS: il trigger si difende da
  // solo, ed è la disciplina della 0017.
  const { error: linkBadAdmin } = await admin.from('contract_documents').insert({
    company_id: A.companyId, contract_id: contractA, document_id: docB, relation: 'annex',
  });
  check('nemmeno il service role può: il trigger si difende da solo', !!linkBadAdmin);

  const { data: taskA, error: taskAe } = await A.client.from('tasks').insert({
    company_id: A.companyId, title: 'Attività A', created_by: A.userId, contract_id: contractA,
  }).select('id').single();
  check('A può collegare un\'attività al proprio contratto', !taskAe, msg(taskAe));

  const { error: taskBad } = await Bt.client.from('tasks').insert({
    company_id: Bt.companyId, title: 'Attività B', created_by: Bt.userId, contract_id: contractA,
  });
  check('B NON può collegare un\'attività al contratto di A', !!taskBad);

  // -------------------------------------------------------------------------
  section('4 · Il responsabile deve essere membro (§102)');
  // -------------------------------------------------------------------------
  const { error: ownerBad } = await A.client.from('contracts')
    .update({ owner_user_id: Bt.userId }).eq('id', contractA);
  check('una persona ESTERNA non può essere responsabile', !!ownerBad);

  const { error: ownerOk } = await A.client.from('contracts')
    .update({ owner_user_id: A.userId }).eq('id', contractA);
  check('un membro sì', !ownerOk, msg(ownerOk));

  // -------------------------------------------------------------------------
  section('5 · Che cosa un membro NON può scrivere');
  // -------------------------------------------------------------------------
  // ⚠️ Si verifica RILEGGENDO: un update che non solleva ma non cambia nulla
  // sarebbe indistinguibile da un successo, ed è il difetto della 0013.
  const { error: revBad } = await A.client.from('contracts')
    .update({ review_status: 'verified' } as never).eq('id', contractA);
  const { data: afterRev } = await admin.from('contracts')
    .select('review_status').eq('id', contractA).single();
  check('non può dichiararsi «verificato» da sé',
    !!revBad || (afterRev as { review_status: string }).review_status === 'needs_review',
    `stato dopo: ${(afterRev as { review_status: string })?.review_status}`);

  const { error: exBad } = await A.client.from('contract_extractions').insert({
    company_id: A.companyId, contract_id: contractA, document_id: docA,
  } as never);
  check('non può scrivere un VERBALE', !!exBad);

  const { error: verBad } = await A.client.from('contract_term_versions').insert({
    company_id: A.companyId, contract_id: contractA, version: 99,
  } as never);
  check('non può scrivere una versione dei TERMINI', !!verBad);

  const { error: evBad } = await A.client.from('contract_events').insert({
    company_id: A.companyId, contract_id: contractA, kind: 'verified',
  } as never);
  check('non può fabbricare lo STORICO', !!evBad);

  const { error: delBad } = await A.client.from('contracts').delete().eq('id', contractA);
  const { data: stillThere } = await admin.from('contracts').select('id').eq('id', contractA);
  check('non può CANCELLARE un contratto: si archivia (§109)',
    !!delBad || (stillThere ?? []).length === 1);

  // -------------------------------------------------------------------------
  section('6 · Correzioni e ricalcolo della bozza');
  // -------------------------------------------------------------------------
  const put = async (field: string, value: unknown) => {
    const { error } = await A.client.from('contract_corrections').insert({
      company_id: A.companyId, contract_id: contractA, term_version_id: draftA!.id,
      field, corrected_value: value as never,
    });
    return error;
  };

  check('una correzione con un campo IGNOTO viene rifiutata',
    !!(await put('campo_inventato', 'x')));
  check('una data malformata viene rifiutata all\'INGRESSO',
    !!(await put('end_date', 'domani')));
  check('un periodo negativo viene rifiutato', !!(await put('notice_period_value', -3)));
  check('un\'unità di periodo inventata viene rifiutata',
    !!(await put('notice_period_unit', 'lune')));
  check('un rinnovo fuori elenco viene rifiutato', !!(await put('auto_renewal', 'forse')));

  const errs = [
    await put('end_date', '2026-12-31'), await put('end_date_kind', 'explicit'),
    await put('auto_renewal', 'yes'), await put('notice_period_value', 3),
    await put('notice_period_unit', 'months'), await put('notice_anchor', 'before_fixed_end'),
    await put('cost_amount', 250), await put('cost_currency', 'CHF'),
    await put('cost_frequency', 'monthly'),
  ].filter(Boolean);
  check('le correzioni valide passano', errs.length === 0, JSON.stringify(errs.map(msg)));

  const { data: draftAfter } = await admin.from('contract_term_versions')
    .select('end_date, auto_renewal, notice_period_value, notice_anchor, cost_amount')
    .eq('id', draftA!.id).single();
  const d = draftAfter as Record<string, unknown>;
  check('la BOZZA si è ricalcolata da sola',
    d.end_date === '2026-12-31' && d.auto_renewal === 'yes'
    && Number(d.notice_period_value) === 3 && d.notice_anchor === 'before_fixed_end',
    JSON.stringify(d));

  const { error: corrUpd } = await A.client.from('contract_corrections')
    .update({ corrected_value: 'altro' as never }).eq('term_version_id', draftA!.id);
  check('una correzione non si MODIFICA: append-only', !!corrUpd);

  // -------------------------------------------------------------------------
  section('7 · Le date derivate (§41–§46)');
  // -------------------------------------------------------------------------
  const { data: ms } = await admin.from('contract_milestones')
    .select('kind, due_date, source, status, calculation, calculation_version')
    .eq('contract_id', contractA);
  const rows = (ms ?? []) as Record<string, string>[];
  const notice = rows.find((m) => m.kind === 'notice_deadline');
  const renewal = rows.find((m) => m.kind === 'renewal_date');

  check('il termine di disdetta è stato DERIVATO: 31.12.2026 − 3 mesi = 30.09.2026',
    notice?.due_date === '2026-09-30', JSON.stringify(rows));
  check('e dichiara il calcolo da cui viene (§42)',
    notice?.source === 'derived' && !!notice?.calculation && !!notice?.calculation_version);
  // ⚠️ Con rinnovo automatico quel giorno il contratto NON finisce: si rinnova.
  check('la data di fine è un RINNOVO, non una scadenza (rinnovo automatico)',
    !!renewal && !rows.some((m) => m.kind === 'contract_end'));
  check('NESSUNA data nasce verificata: sono tutte proposte (§43)',
    rows.every((m) => m.status === 'candidate'));

  // Aritmetica: i casi limite, contro Postgres.
  const dateCase = async (v: number, u: string, anchor: string, ref: string | null) => {
    const { data } = await admin.rpc('contract_notice_deadline', {
      p_notice_value: v, p_notice_unit: u, p_anchor: anchor, p_reference_date: ref,
    });
    return data as string | null;
  };
  check('31.03.2024 − 1 mese = 29.02.2024 (bisestile)',
    await dateCase(1, 'months', 'before_fixed_end', '2024-03-31') === '2024-02-29');
  check('31.03.2026 − 1 mese = 28.02.2026',
    await dateCase(1, 'months', 'before_fixed_end', '2026-03-31') === '2026-02-28');
  check('31.01.2026 − 1 mese = 31.12.2025 (cambio d\'anno)',
    await dateCase(1, 'months', 'before_fixed_end', '2026-01-31') === '2025-12-31');
  check('29.02.2024 − 1 anno = 28.02.2023',
    await dateCase(1, 'years', 'before_fixed_end', '2024-02-29') === '2023-02-28');
  check('15.01.2026 − 30 giorni = 16.12.2025',
    await dateCase(30, 'days', 'before_fixed_end', '2026-01-15') === '2025-12-16');
  // ⚠️ IL CASO CHE CONTA DI PIÙ: se un giorno qualcuno aggiungesse «per fine
  // mese» agli ancoraggi calcolabili, questa riga fallirebbe PRIMA che una
  // scadenza sbagliata raggiunga un cliente.
  check('«per fine mese» NON produce alcuna data (§46)',
    await dateCase(3, 'months', 'to_month_end', '2026-12-31') === null);
  check('«in qualsiasi momento» NON produce alcuna data',
    await dateCase(3, 'months', 'anytime', '2026-12-31') === null);
  check('senza data di riferimento non si deriva niente',
    await dateCase(3, 'months', 'before_fixed_end', null) === null);

  // -------------------------------------------------------------------------
  section('8 · La verifica dei termini, e la loro immutabilità');
  // -------------------------------------------------------------------------
  const { error: verifyErr } = await A.client.rpc('contract_verify_terms', {
    p_version_id: draftA!.id,
  });
  check('un membro può verificare la versione in preparazione', !verifyErr, msg(verifyErr));

  const { data: cAfter } = await admin.from('contracts')
    .select('review_status, current_term_version_id, verified_by').eq('id', contractA).single();
  const ca = cAfter as Record<string, unknown>;
  check('il contratto risulta verificato e punta a QUELLA versione',
    ca.review_status === 'verified' && ca.current_term_version_id === draftA!.id);
  check('e il timbro dice CHI ha verificato', ca.verified_by === A.userId);

  const { error: immutable } = await admin.from('contract_term_versions')
    .update({ notice_period_value: 6 }).eq('id', draftA!.id);
  check('una versione VERIFICATA non si modifica, nemmeno dal service role', !!immutable);

  const { error: verifyTwice } = await A.client.rpc('contract_verify_terms', {
    p_version_id: draftA!.id,
  });
  check('e non si verifica due volte', !!verifyTwice);

  const { error: verifyOther } = await Bt.client.rpc('contract_verify_terms', {
    p_version_id: draftA!.id,
  });
  check('B non può verificare i termini di A', !!verifyOther);

  // §87 — solo una data VERIFICATA può diventare lavoro. Il divieto non è nel
  // database (una data è una data): è nel servizio e nell'interfaccia. Qui si
  // verifica il fatto su cui quel divieto si regge.
  const { data: msAfter } = await admin.from('contract_milestones')
    .select('status').eq('contract_id', contractA);
  check('verificare i TERMINI non verifica le DATE: restano proposte (§44)',
    ((msAfter ?? []) as { status: string }[]).every((m) => m.status === 'candidate'));

  // -------------------------------------------------------------------------
  section('9 · L\'amendment non sovrascrive: apre una revisione (§26/§28)');
  // -------------------------------------------------------------------------
  const docAmend = await makeDocument(A.companyId, 'Modifica A');
  await A.client.from('contract_documents').insert({
    company_id: A.companyId, contract_id: contractA, document_id: docAmend, relation: 'amendment',
  });
  // Il verbale lo scrive il worker: qui lo scrive il service role, che è ciò
  // che il worker è. Preavviso 6 mesi al posto di 3.
  const { error: exErr } = await admin.from('contract_extractions').insert({
    company_id: A.companyId, contract_id: contractA, document_id: docAmend,
    extraction_version: 1, status: 'completed',
    notice_period_value: 6, notice_period_unit: 'months', notice_anchor: 'before_fixed_end',
  } as never);
  check('il worker può scrivere un verbale', !exErr, msg(exErr));

  const { data: cAmend } = await admin.from('contracts')
    .select('review_status, current_term_version_id, verified_at').eq('id', contractA).single();
  const cam = cAmend as Record<string, unknown>;
  check('il contratto chiede una NUOVA verifica', cam.review_status === 'review_required_again',
    String(cam.review_status));
  // ⚠️ LA RIGA PIÙ IMPORTANTE DEL FILE.
  check('i TERMINI IN VIGORE non sono cambiati', cam.current_term_version_id === draftA!.id);
  check('e il timbro della verifica precedente NON è stato cancellato (§84)',
    cam.verified_at !== null);

  const { data: newDraft } = await admin.from('contract_term_versions')
    .select('id, version, status, notice_period_value')
    .eq('contract_id', contractA).eq('status', 'draft').maybeSingle();
  const nd = newDraft as Record<string, unknown> | null;
  check('una NUOVA bozza propone il preavviso a 6 mesi',
    !!nd && Number(nd.notice_period_value) === 6, JSON.stringify(nd));
  const { data: oldVersion } = await admin.from('contract_term_versions')
    .select('notice_period_value').eq('id', draftA!.id).single();
  check('la versione verificata continua a dire 3 mesi',
    Number((oldVersion as { notice_period_value: number }).notice_period_value) === 3);

  // -------------------------------------------------------------------------
  section('10 · L\'outbox delle automazioni scrive solo se qualcuno ascolta');
  // -------------------------------------------------------------------------
  const { data: evNone } = await admin.from('automation_events')
    .select('id').eq('company_id', A.companyId).eq('entity_type', 'contract');
  check('senza regole attive, nessun evento è stato accodato',
    ((evNone ?? []) as unknown[]).length === 0);

  // ⚠️ `contract` deve essere un valore AMMESSO dal vincolo: se la 0024 non
  // avesse allargato il check, questo insert fallirebbe.
  const { error: entityErr } = await admin.from('automation_events').insert({
    company_id: A.companyId, event_type: 'contract_verified',
    entity_type: 'contract', entity_id: contractA, payload: {},
  } as never);
  check('«contract» è un\'entità ammessa dal motore', !entityErr, msg(entityErr));

  // -------------------------------------------------------------------------
  section('11 · Cascata');
  // -------------------------------------------------------------------------
  const { error: delDoc } = await admin.from('documents').delete().eq('id', docAmend);
  check('un documento si può cancellare anche se è collegato a un contratto',
    !delDoc, msg(delDoc));
  const { data: linkGone } = await admin.from('contract_documents')
    .select('id').eq('document_id', docAmend);
  check('e il collegamento sparisce con lui', ((linkGone ?? []) as unknown[]).length === 0);

  // =========================================================================
  section('12 · Il nome dell\'azienda arriva davvero al modello');
  // =========================================================================
  // ⚠️⚠️ QUESTO CONTROLLO NASCE DA UN DIFETTO CHE HA VISSUTO DAL PRIMO GIORNO.
  // `loadCompanyName` interrogava `companies.name`, colonna che non esiste: la
  // select tornava 42703, un `if (error) return null` se lo mangiava, e il nome
  // dell'azienda non arrivava MAI al prompt. Nessuna suite se ne accorgeva,
  // perché nessuna eseguiva quella funzione contro lo schema vero — e il typecheck
  // non vede una stringa dentro `.select()`.
  //
  // Il costo non era estetico: senza quel nome il modello non sa quale delle due
  // parti sia il cliente, abbassa la fiducia sotto la soglia del validatore, e la
  // scheda del contratto esce SENZA CONTROPARTE. Misurato il 2026-08-03 con
  // `npm run eval:contracts`: fiducia 0,4–0,6 su `company_party` e `counterparty`
  // contro 0,98 quando il nome c'è.
  //
  // ⚠️ Si esegue la FUNZIONE VERA, non una sua imitazione: è l'unico modo per cui
  // il nome di una colonna sbagliato diventi rosso.
  {
    const { loadCompanyName } = await import(
      '../supabase/functions/_shared/contracts/store.ts'
    );
    const letto = await loadCompanyName(
      admin as unknown as Parameters<typeof loadCompanyName>[0], A.companyId,
    );
    check('loadCompanyName restituisce il nome dell\'azienda, non null',
      typeof letto === 'string' && letto.length > 0, `ottenuto ${JSON.stringify(letto)}`);
    // La ragione sociale si RILEGGE dal database invece di riscriverla qui: due
    // copie della stessa stringa divergono, e a divergere sarebbe il test.
    const { data: reg } = await admin.from('companies')
      .select('legal_name').eq('id', A.companyId).maybeSingle();
    const registrata = (reg as { legal_name?: string } | null)?.legal_name ?? null;
    check('ed è esattamente la ragione sociale registrata',
      letto === registrata, `ottenuto ${JSON.stringify(letto)}, registrata ${JSON.stringify(registrata)}`);

    // ⚠️ La controprova: su un'azienda che non c'è la funzione deve tornare
    // `null` — «non l'ho trovata» — e NON sollevare. Distinguere questo caso da
    // un errore di lettura è tutto il punto della correzione.
    const assente = await loadCompanyName(
      admin as unknown as Parameters<typeof loadCompanyName>[0],
      '00000000-0000-0000-0000-000000000000',
    );
    check('un\'azienda inesistente dà null, non un errore', assente === null,
      `ottenuto ${JSON.stringify(assente)}`);
  }

  await cleanup();

  for (const [table, column] of [
    ['contracts', 'company_id'], ['contract_documents', 'company_id'],
    ['contract_extractions', 'company_id'], ['contract_term_versions', 'company_id'],
    ['contract_corrections', 'company_id'], ['contract_milestones', 'company_id'],
    ['contract_events', 'company_id'],
  ] as const) {
    const { data } = await admin.from(table).select('id').eq(column, A.companyId);
    check(`cancellata l'azienda, ${table} non ha residui`, ((data ?? []) as unknown[]).length === 0);
  }

  console.log(`\n${B}Risultato${X}: ${G}${pass} superati${X}${fail ? `, ${R}${fail} falliti${X}` : ''}`);
  process.exit(fail ? 1 : 0);
}

/**
 * ⚠️ LA PULIZIA CONTROLLA IL PROPRIO ESITO.
 * supabase-js non solleva: restituisce `{ error }`. Ignorarlo ha già lasciato
 * aziende di test nel database di PRODUZIONE, due volte.
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
