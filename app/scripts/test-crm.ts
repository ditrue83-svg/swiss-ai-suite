// ============================================================================
// AI-Swisse — CRM Light: test d'integrazione sul DATABASE REALE.
//   npm run test:crm
//
// Richiede le migrazioni 0026, 0028 e 0030 applicate, e `.env.test` valorizzato.
// ⚠️ La 0028 non è un dettaglio: senza di essa la sezione 14 FALLISCE, perché lo
// storico del CRM impedisce la cancellazione di un'azienda. È il difetto che
// questo file ha trovato alla prima esecuzione.
// ⚠️ Senza la 0030 fallisce la sezione 13: `crm_scan_link_suggestions` non
// esiste ancora e la RPC risponde `PGRST202`.
//
// Non prova che il codice sia scritto bene: prova che le GARANZIE siano in
// vigore. Sono dodici, e stanno tutte nel DATABASE, perché un servizio ben
// educato non è una garanzia — è la lezione della 0014, dove i permessi di
// colonna dichiarati nei commenti non restringevano nulla e il difetto è emerso
// solo ESEGUENDO.
//
//    1. ISOLAMENTO — l'azienda A non vede nulla di B, tabella per tabella, e
//       NEMMENO chiamando la funzione di elenco col `p_company_id` di A.
//    2. CROSS-TENANT — nessun collegamento fra entità di aziende diverse, e
//       nemmeno il service role può crearne uno.
//    3. RESPONSABILI — non possono essere persone esterne all'azienda.
//    4. REFERENTE — una persona di un'altra organizzazione viene rifiutata.
//    5. PERMESSI — che cosa un membro NON può scrivere, verificato RILEGGENDO.
//    6. STORICO — append-only, scritto dai trigger, autore non falsificabile.
//    7. IDENTITÀ — l'IDI valido è unico, quello non valido non blocca nessuno.
//    8. FASI — i timbri li scrive il database, riaprire lascia la storia.
//    9. ULTIMO CONTATTO — calcolato, non scrivibile, e una nota non conta.
//   10. IL NOME ESTRATTO SOPRAVVIVE allo scollegamento (§188, §189).
//   11. FUSIONE — solo amministratori, transazionale, senza duplicare.
//   12. CASCATA — cancellata l'azienda non resta niente, tabella per tabella.
//
// ⚠️ LA PULIZIA CONTROLLA IL PROPRIO ESITO, e l'ORDINE non è indifferente:
// PRIMA l'azienda, POI l'utente. Al contrario, cancellare l'utente porta via a
// cascata la riga di `company_members` e lascia un'azienda ORFANA — invisibile
// nell'app, perché la RLS filtra per appartenenza. supabase-js non solleva:
// restituisce `{ error }`, e ignorarlo ha già lasciato aziende di test nel
// database di PRODUZIONE due volte.
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

/**
 * ⚠️ Si chiama `Bt` e non `B` nel chiamante: `B` è già la costante ANSI del
 * grassetto, e ribattezzarla romperebbe la stampa in silenzio.
 */
async function makeTenant(label: string) {
  const email = `crm-${label}-${stamp}@swissai-suite.ch`;
  const { data: u, error: ue } = await withRetry(() =>
    admin.auth.admin.createUser({ email, password: PW, email_confirm: true }));
  if (ue || !u?.user) throw new Error(`utente ${label}: ${msg(ue)}`);
  created.users.push(u.user.id);

  const user = anonClient();
  const { error: se } = await user.auth.signInWithPassword({ email, password: PW });
  if (se) throw new Error(`login ${label}: ${msg(se)}`);

  const { data: cid, error: ce } = await user.rpc('create_company_with_owner', {
    p_legal_name: `CRM ${label} ${stamp}`,
  });
  if (ce || !cid) throw new Error(`azienda ${label}: ${msg(ce)}`);
  created.companies.push(cid as string);

  return { userId: u.user.id, companyId: cid as string, client: user, email };
}

/** Un membro NON proprietario, per provare i permessi da amministratore. */
async function addPlainMember(companyId: string, label: string) {
  const email = `crm-member-${label}-${stamp}@swissai-suite.ch`;
  const { data: u, error: ue } = await withRetry(() =>
    admin.auth.admin.createUser({ email, password: PW, email_confirm: true }));
  if (ue || !u?.user) throw new Error(`membro ${label}: ${msg(ue)}`);
  created.users.push(u.user.id);
  const { error } = await admin.from('company_members')
    .insert({ company_id: companyId, user_id: u.user.id, role: 'member' });
  if (error) throw new Error(`membership ${label}: ${msg(error)}`);
  const client = anonClient();
  const { error: se } = await client.auth.signInWithPassword({ email, password: PW });
  if (se) throw new Error(`login membro ${label}: ${msg(se)}`);
  return { userId: u.user.id, client };
}

async function makeDocument(companyId: string, title: string): Promise<string> {
  const { data, error } = await admin.from('documents')
    .insert({ company_id: companyId, title, source_type: 'upload', status: 'completed' })
    .select('id').single();
  if (error) throw new Error(`documento: ${msg(error)}`);
  return (data as { id: string }).id;
}

async function makeOrg(client: ReturnType<typeof anonClient>, companyId: string, name: string,
  extra: Record<string, unknown> = {}): Promise<string> {
  const { data, error } = await client.from('crm_organizations')
    .insert({ company_id: companyId, display_name: name, ...extra }).select('id').single();
  if (error) throw new Error(`organizzazione «${name}»: ${msg(error)}`);
  return (data as { id: string }).id;
}

// ===========================================================================
async function main() {
  console.log(`${B}CRM Light — test sul database reale${X}  ${DIM}${URL}${X}`);

  const A = await makeTenant('a');
  const Bt = await makeTenant('b');

  // -------------------------------------------------------------------------
  section('1. Isolamento — A non vede nulla di B');

  const orgA = await makeOrg(A.client, A.companyId, 'Rossi SA', {
    legal_name: 'Rossi SA', uid_che: 'CHE-107.721.785', website: 'https://www.rossi-test.ch',
    city: 'Lugano', canton: 'TI',
  });
  const orgB = await makeOrg(Bt.client, Bt.companyId, 'Bianchi SA');

  const { data: leak } = await Bt.client.from('crm_organizations').select('id').eq('id', orgA);
  check('B non vede l’organizzazione di A leggendo la tabella per id',
    ((leak ?? []) as unknown[]).length === 0);

  // ⚠️ IL CONTROLLO CHE CONTA DI PIÙ: `list_crm_organizations` è `security
  // invoker` E filtra per appartenenza. Due strati, e questo prova il secondo:
  // B chiama la funzione passando il `p_company_id` DI A.
  const { data: rpcLeak } = await Bt.client.rpc('list_crm_organizations', {
    p_company_id: A.companyId,
  });
  check('B non ottiene le righe di A nemmeno passando il p_company_id di A',
    ((rpcLeak ?? []) as unknown[]).length === 0,
    `righe: ${((rpcLeak ?? []) as unknown[]).length}`);

  const { data: sumLeak } = await Bt.client.rpc('crm_home_summary', { p_company_id: A.companyId });
  check('le misure della pagina iniziale non si leggono per un’altra azienda',
    ((sumLeak ?? []) as unknown[]).length === 0);

  // §179 — la ricerca per indirizzo non deve diventare un modo per scoprire se
  // un'altra azienda usa una certa email.
  await A.client.from('crm_contact_methods').insert({
    company_id: A.companyId, organization_id: orgA, type: 'email',
    value: `segreto.${stamp}@rossi-test.ch`, is_primary: true,
  });
  const { data: matchLeak } = await Bt.client.rpc('crm_match_email', {
    p_company_id: A.companyId, p_email: `segreto.${stamp}@rossi-test.ch`,
  });
  check('l’abbinamento per indirizzo non risponde fuori dalla propria azienda',
    ((matchLeak ?? []) as unknown[]).length === 0);

  // §180 — e nemmeno i duplicati attraversano il confine.
  const { data: dupLeak } = await Bt.client.rpc('crm_duplicate_candidates', {
    p_company_id: A.companyId,
  });
  check('i duplicati si cercano solo dentro la propria azienda',
    ((dupLeak ?? []) as unknown[]).length === 0);

  const oppA = await A.client.from('crm_opportunities').insert({
    company_id: A.companyId, organization_id: orgA, title: 'Impianto capannone',
    stage: 'proposal', value_amount: 18000, value_currency: 'CHF',
    next_step: 'Richiamare Laura', next_step_due_date: '2026-08-15',
  }).select('id').single();
  check('A crea un’opportunità', !oppA.error, msg(oppA.error));
  const oppAId = (oppA.data as { id: string } | null)?.id ?? '';

  const { data: oppLeak } = await Bt.client.from('crm_opportunities').select('id').eq('id', oppAId);
  check('B non vede l’opportunità di A', ((oppLeak ?? []) as unknown[]).length === 0);

  const { data: tlLeak } = await Bt.client.rpc('crm_timeline', {
    p_company_id: A.companyId, p_organization_id: orgA,
  });
  check('B non vede la timeline di A', ((tlLeak ?? []) as unknown[]).length === 0);

  const { data: evLeak } = await Bt.client.from('crm_events').select('id').eq('organization_id', orgA);
  check('B non vede lo storico di A', ((evLeak ?? []) as unknown[]).length === 0);

  // -------------------------------------------------------------------------
  section('2. Cross-tenant — nessun collegamento fra aziende diverse');

  const docB = await makeDocument(Bt.companyId, 'Fattura di B');

  // A dichiara la PROPRIA azienda e aggancia un documento di B: la RLS lascia
  // passare questo caso, e a fermarlo è il guardiano.
  const wrongDoc = await A.client.from('crm_organization_documents').insert({
    company_id: A.companyId, organization_id: orgA, document_id: docB,
  });
  check('A non può collegare un documento di B alla propria controparte',
    Boolean(wrongDoc.error), `atteso un rifiuto, ottenuto: ${msg(wrongDoc.error) || 'nessun errore'}`);

  // ⚠️ E NEMMENO IL SERVICE ROLE: il guardiano è `security definer` e si difende
  // da sé, senza contare su una policy scritta altrove.
  const wrongDocAdmin = await admin.from('crm_organization_documents').insert({
    company_id: A.companyId, organization_id: orgA, document_id: docB,
  });
  check('nemmeno il service role può collegare un documento di un’altra azienda',
    Boolean(wrongDocAdmin.error), msg(wrongDocAdmin.error) || 'nessun errore');

  const wrongOpp = await A.client.from('crm_opportunities').insert({
    company_id: A.companyId, organization_id: orgB, title: 'Trattativa impossibile',
  });
  check('A non può aprire un’opportunità su una controparte di B',
    Boolean(wrongOpp.error), msg(wrongOpp.error) || 'nessun errore');

  const taskA = await A.client.from('tasks').insert({
    company_id: A.companyId, created_by: A.userId, title: 'Attività di A',
    crm_organization_id: orgB,
  });
  check('un’attività di A non può puntare a una controparte di B',
    Boolean(taskA.error), msg(taskA.error) || 'nessun errore');

  const wrongMethod = await A.client.from('crm_contact_methods').insert({
    company_id: A.companyId, organization_id: orgB, type: 'email', value: 'x@y.ch',
  });
  check('un recapito di A non può essere intestato a una controparte di B',
    Boolean(wrongMethod.error), msg(wrongMethod.error) || 'nessun errore');

  // -------------------------------------------------------------------------
  section('3. Responsabili — solo persone di questa azienda');

  const badOwner = await A.client.from('crm_organizations')
    .update({ account_owner_user_id: Bt.userId }).eq('id', orgA);
  check('il responsabile della relazione non può essere una persona esterna',
    Boolean(badOwner.error), msg(badOwner.error) || 'nessun errore');
  check('e il rifiuto porta il codice previsto (crm_owner_not_member)',
    /crm_owner_not_member/.test(msg(badOwner.error)), msg(badOwner.error));

  const badOppOwner = await A.client.from('crm_opportunities')
    .update({ owner_user_id: Bt.userId }).eq('id', oppAId);
  check('il responsabile della trattativa non può essere una persona esterna',
    Boolean(badOppOwner.error), msg(badOppOwner.error) || 'nessun errore');

  const goodOwner = await A.client.from('crm_organizations')
    .update({ account_owner_user_id: A.userId }).eq('id', orgA);
  check('un membro dell’azienda può essere responsabile', !goodOwner.error, msg(goodOwner.error));

  // -------------------------------------------------------------------------
  section('4. Referente — deve lavorare per QUESTA organizzazione');

  const contactA = await A.client.from('crm_contacts')
    .insert({ company_id: A.companyId, display_name: 'Laura Bianchi' }).select('id').single();
  check('A crea una persona di contatto', !contactA.error, msg(contactA.error));
  const contactAId = (contactA.data as { id: string } | null)?.id ?? '';

  // Non ancora collegata a nessuna organizzazione: il guardiano deve rifiutare.
  const orphanContact = await A.client.from('crm_opportunities')
    .update({ primary_contact_id: contactAId }).eq('id', oppAId);
  check('una persona non collegata all’organizzazione non può esserne il referente',
    Boolean(orphanContact.error), msg(orphanContact.error) || 'nessun errore');
  check('e il rifiuto lo dice (crm_opportunity_contact_not_in_organization)',
    /contact_not_in_organization/.test(msg(orphanContact.error)), msg(orphanContact.error));

  await A.client.from('crm_contact_organizations').insert({
    company_id: A.companyId, contact_id: contactAId, organization_id: orgA,
    job_title: 'Direttrice', is_primary: true,
  });
  const okContact = await A.client.from('crm_opportunities')
    .update({ primary_contact_id: contactAId }).eq('id', oppAId);
  check('collegata all’organizzazione, la stessa persona è accettata',
    !okContact.error, msg(okContact.error));

  // -------------------------------------------------------------------------
  section('5. Permessi — che cosa un membro NON può scrivere');

  // ⚠️ Si verifica RILEGGENDO, non guardando l'esito dell'update: su Postgres un
  // permesso di colonna mancante può produrre un errore, ma un guardiano che
  // ripristina il valore produce un update «riuscito» che non cambia niente. La
  // domanda giusta è «il valore è cambiato?», non «l'update è andato a buon fine?».
  await A.client.from('crm_organizations').update({ uid_che: 'CHE-116.281.710' }).eq('id', orgA);
  const { data: normRow } = await admin.from('crm_organizations')
    .select('uid_che, uid_norm, website_domain, created_by, last_contact_at, source')
    .eq('id', orgA).single();
  const n = (normRow ?? {}) as Record<string, unknown>;
  check('uid_norm lo calcola il database dalla cifra di controllo',
    n.uid_norm === 'CHE116281710', String(n.uid_norm));
  check('website_domain lo calcola il database, senza schema e senza www',
    n.website_domain === 'rossi-test.ch', String(n.website_domain));
  check('created_by lo scrive il database', n.created_by === A.userId, String(n.created_by));
  check('la provenienza di una riga creata dal client è «manual»',
    n.source === 'manual', String(n.source));

  const fakeLastContact = await A.client.from('crm_organizations')
    .update({ last_contact_at: '2020-01-01T00:00:00Z' } as never).eq('id', orgA);
  const { data: afterFake } = await admin.from('crm_organizations')
    .select('last_contact_at').eq('id', orgA).single();
  check('l’ultimo contatto NON è scrivibile dal client',
    (afterFake as { last_contact_at: string | null }).last_contact_at === null,
    `errore: ${msg(fakeLastContact.error) || 'nessuno'}, valore: ${(afterFake as { last_contact_at: unknown }).last_contact_at}`);

  const writeEvent = await A.client.from('crm_events').insert({
    company_id: A.companyId, organization_id: orgA, kind: 'organization_updated',
  } as never);
  check('lo storico NON è scrivibile dal client', Boolean(writeEvent.error),
    msg(writeEvent.error) || 'nessun errore');

  const deleteOrg = await A.client.from('crm_organizations').delete().eq('id', orgA);
  const { data: stillThere } = await admin.from('crm_organizations').select('id').eq('id', orgA);
  check('un’anagrafica non si cancella: si archivia',
    ((stillThere ?? []) as unknown[]).length === 1,
    `errore: ${msg(deleteOrg.error) || 'nessuno'}`);

  // -------------------------------------------------------------------------
  section('6. Storico — append-only, e l’autore non si falsifica');

  const { data: events } = await admin.from('crm_events')
    .select('kind, actor_user_id, detail').eq('organization_id', orgA)
    .order('occurred_at', { ascending: true });
  const kinds = ((events ?? []) as Record<string, unknown>[]).map((e) => e.kind as string);
  check('la creazione è registrata dai trigger', kinds.includes('organization_created'));
  check('il cambio di responsabile è registrato', kinds.includes('owner_changed'), kinds.join(','));
  check('l’attore registrato è l’utente vero',
    ((events ?? []) as Record<string, unknown>[])
      .filter((e) => e.kind === 'organization_created')
      .every((e) => e.actor_user_id === A.userId));

  // §110 — nel detail entrano identificativi e valori di enum, MAI ragioni
  // sociali: uno storico che contenesse i nomi sarebbe una seconda anagrafica.
  const detailText = JSON.stringify(((events ?? []) as Record<string, unknown>[]).map((e) => e.detail));
  check('lo storico non contiene ragioni sociali né nomi di persone',
    !detailText.includes('Rossi SA') && !detailText.includes('Laura'), detailText.slice(0, 160));

  // ⚠️ L'autore di un'interazione è chi la registra, e il tentativo di firmare
  // come un collega viene RIFIUTATO — non riscritto in silenzio. È la
  // correzione della 0016 sui commenti delle attività.
  const member = await addPlainMember(A.companyId, 'plain');
  const fakeAuthor = await member.client.from('crm_interactions').insert({
    company_id: A.companyId, organization_id: orgA, type: 'call',
    created_by: A.userId, subject: 'Firma falsa',
  } as never);
  check('non si può firmare un’interazione a nome di un collega',
    Boolean(fakeAuthor.error), msg(fakeAuthor.error) || 'nessun errore');

  // -------------------------------------------------------------------------
  section('7. Identità — l’IDI valido è unico, quello non valido non blocca');

  const dupUid = await A.client.from('crm_organizations').insert({
    company_id: A.companyId, display_name: 'Doppione SA', uid_che: 'CHE116281710',
  });
  check('due controparti non possono avere lo stesso IDI valido',
    Boolean(dupUid.error) && code(dupUid.error) === '23505',
    `${code(dupUid.error)} ${msg(dupUid.error)}`);

  // ⚠️ Un IDI con la cifra di controllo sbagliata NON identifica nessuno,
  // quindi non deve impedire alcun inserimento: `uid_norm` resta null e
  // l'indice unico è parziale.
  const bad1 = await A.client.from('crm_organizations').insert({
    company_id: A.companyId, display_name: 'Non valida 1', uid_che: 'CHE-107.721.786',
  });
  const bad2 = await A.client.from('crm_organizations').insert({
    company_id: A.companyId, display_name: 'Non valida 2', uid_che: 'CHE-107.721.786',
  });
  check('due IDI con la cifra di controllo errata non collidono fra loro',
    !bad1.error && !bad2.error, `${msg(bad1.error)} / ${msg(bad2.error)}`);

  // §127 — un indirizzo email appartiene a UN solo soggetto dentro l'azienda.
  const dupEmail = await A.client.from('crm_contact_methods').insert({
    company_id: A.companyId, contact_id: contactAId, type: 'email',
    value: `SEGRETO.${stamp}@ROSSI-TEST.CH`,
  });
  check('lo stesso indirizzo non si registra due volte nella stessa azienda',
    Boolean(dupEmail.error) && code(dupEmail.error) === '23505',
    `${code(dupEmail.error)} ${msg(dupEmail.error)}`);
  // ⚠️ E il confronto è insensibile alle maiuscole: se non lo fosse, lo stesso
  // indirizzo scritto in maiuscolo passerebbe come un secondo soggetto.

  // -------------------------------------------------------------------------
  section('8. Fasi — i timbri li scrive il database');

  const fakeWon = await A.client.from('crm_opportunities')
    .update({ stage: 'proposal', won_at: '2020-01-01T00:00:00Z' } as never).eq('id', oppAId);
  const { data: afterFakeWon } = await admin.from('crm_opportunities')
    .select('stage, won_at').eq('id', oppAId).single();
  check('won_at non si scrive a mano su una trattativa non vinta',
    (afterFakeWon as { won_at: string | null }).won_at === null,
    `errore: ${msg(fakeWon.error) || 'nessuno'}`);

  await A.client.from('crm_opportunities').update({ stage: 'won' }).eq('id', oppAId);
  const { data: won } = await admin.from('crm_opportunities')
    .select('stage, won_at, lost_at').eq('id', oppAId).single();
  const w = won as { stage: string; won_at: string | null; lost_at: string | null };
  check('passando a «vinta» il database mette il timbro', w.stage === 'won' && w.won_at !== null);
  check('e non mette quello della perdita', w.lost_at === null);

  // §42 — vinta AGGIUNGE il ruolo cliente e non toglie niente.
  const { data: rolesAfterWon } = await admin.from('crm_organization_roles')
    .select('role').eq('organization_id', orgA);
  const roleSet = new Set(((rolesAfterWon ?? []) as Record<string, unknown>[]).map((r) => r.role));
  check('una trattativa vinta aggiunge il ruolo «cliente»', roleSet.has('customer'),
    [...roleSet].join(','));

  // §175 — riaprire azzera il timbro ma NON cancella la storia.
  await A.client.from('crm_opportunities').update({ stage: 'negotiation' }).eq('id', oppAId);
  const { data: reopened } = await admin.from('crm_opportunities')
    .select('stage, won_at').eq('id', oppAId).single();
  check('riaprendo, il timbro di vittoria si azzera',
    (reopened as { won_at: string | null }).won_at === null);
  const { data: stageEvents } = await admin.from('crm_events')
    .select('kind, detail').eq('opportunity_id', oppAId).eq('kind', 'opportunity_stage_changed');
  check('ma i passaggi di fase restano nello storico, con da e verso',
    ((stageEvents ?? []) as unknown[]).length >= 2
    && JSON.stringify(stageEvents).includes('"from"'),
    `passaggi: ${((stageEvents ?? []) as unknown[]).length}`);
  check('e il ruolo «cliente» NON viene toltoriaprendo (§42)',
    roleSet.has('customer'));

  // -------------------------------------------------------------------------
  section('9. Ultimo contatto — calcolato, e una nota non conta');

  await A.client.from('crm_interactions').insert({
    company_id: A.companyId, organization_id: orgA, type: 'note',
    occurred_at: '2026-07-01T10:00:00Z', subject: 'Solo una nota',
  });
  const { data: afterNote } = await admin.from('crm_organizations')
    .select('last_contact_at').eq('id', orgA).single();
  check('una NOTA non conta come contatto (§67)',
    (afterNote as { last_contact_at: string | null }).last_contact_at === null,
    String((afterNote as { last_contact_at: unknown }).last_contact_at));

  await A.client.from('crm_interactions').insert({
    company_id: A.companyId, organization_id: orgA, type: 'call',
    occurred_at: '2026-07-20T10:00:00Z', subject: 'Telefonata',
  });
  const { data: afterCall } = await admin.from('crm_organizations')
    .select('last_contact_at').eq('id', orgA).single();
  check('una TELEFONATA aggiorna l’ultimo contatto',
    (afterCall as { last_contact_at: string | null }).last_contact_at !== null,
    String((afterCall as { last_contact_at: unknown }).last_contact_at));

  // -------------------------------------------------------------------------
  section('10. Il nome estratto sopravvive allo scollegamento');

  const docA = await makeDocument(A.companyId, 'Fattura Rossi SA');
  const { error: linkErr } = await A.client.from('crm_organization_documents')
    .insert({ company_id: A.companyId, organization_id: orgA, document_id: docA });
  check('A collega un proprio documento alla propria controparte', !linkErr, msg(linkErr));

  const { error: unlinkErr } = await A.client.from('crm_organization_documents')
    .delete().eq('organization_id', orgA).eq('document_id', docA);
  const { data: docStill } = await admin.from('documents').select('id, title').eq('id', docA);
  check('scollegare non cancella il documento',
    ((docStill ?? []) as unknown[]).length === 1 && !unlinkErr,
    msg(unlinkErr));
  check('e non ne cambia il titolo',
    ((docStill ?? []) as Record<string, unknown>[])[0]?.title === 'Fattura Rossi SA');

  // -------------------------------------------------------------------------
  section('11. Fusione — solo amministratori, e senza duplicare');

  const orgDup = await makeOrg(A.client, A.companyId, 'Rossi SA (doppione)', {
    website: 'https://rossi-test.ch',
  });
  await A.client.from('crm_organization_roles')
    .insert({ company_id: A.companyId, organization_id: orgDup, role: 'customer' });
  await A.client.from('crm_organization_roles')
    .insert({ company_id: A.companyId, organization_id: orgDup, role: 'supplier' });

  // §29 — i duplicati si MOSTRANO. Lo stesso dominio è un segnale.
  const { data: dups } = await A.client.rpc('crm_duplicate_candidates', {
    p_company_id: A.companyId, p_organization_id: orgA,
  });
  check('il duplicato per dominio viene proposto, non risolto',
    ((dups ?? []) as unknown[]).length >= 1,
    `candidati: ${((dups ?? []) as unknown[]).length}`);

  // §118 — un membro semplice non fonde.
  const mergeAsMember = await member.client.rpc('crm_merge_organizations', {
    p_target_id: orgA, p_source_id: orgDup,
  });
  check('un membro semplice non può unire due anagrafiche',
    Boolean(mergeAsMember.error), msg(mergeAsMember.error) || 'nessun errore');

  const mergeSelf = await A.client.rpc('crm_merge_organizations', {
    p_target_id: orgA, p_source_id: orgA,
  });
  check('un’anagrafica non si fonde con sé stessa', Boolean(mergeSelf.error));

  const mergeCross = await A.client.rpc('crm_merge_organizations', {
    p_target_id: orgA, p_source_id: orgB,
  });
  check('non si fondono anagrafiche di aziende diverse', Boolean(mergeCross.error));

  const merge = await A.client.rpc('crm_merge_organizations', {
    p_target_id: orgA, p_source_id: orgDup,
  });
  check('il proprietario dell’azienda unisce le due schede', !merge.error, msg(merge.error));

  const { data: mergedRoles } = await admin.from('crm_organization_roles')
    .select('role').eq('organization_id', orgA);
  const merged = ((mergedRoles ?? []) as Record<string, unknown>[]).map((r) => r.role as string);
  check('i ruoli si sommano sulla scheda principale',
    merged.includes('supplier') && merged.includes('customer'), merged.join(','));
  // ⚠️ Nessuna relazione duplicata: `customer` c'era già su A (dalla trattativa
  // vinta) e non deve comparire due volte.
  check('e non si duplicano',
    merged.filter((r) => r === 'customer').length === 1, merged.join(','));

  const { data: sourceAfter } = await admin.from('crm_organizations')
    .select('archived_at, merged_into_id, relationship_status').eq('id', orgDup).single();
  const sa = sourceAfter as Record<string, unknown>;
  check('la scheda secondaria resta archiviata con un rimando',
    sa.archived_at !== null && sa.merged_into_id === orgA,
    JSON.stringify(sa));
  const { data: mergeEvent } = await admin.from('crm_events')
    .select('kind').eq('organization_id', orgA).eq('kind', 'merged');
  check('la fusione è registrata nello storico', ((mergeEvent ?? []) as unknown[]).length >= 1);

  // -------------------------------------------------------------------------
  section('12. Automazioni — l’entità CRM è ammessa dal motore');

  // ⚠️ Il vincolo `entity_type` è un elenco CHIUSO che si allarga a ogni modulo:
  // dimenticarne uno fa fallire l'azione «notifica» con un 23514, cioè con un
  // guasto tecnico al posto di una funzione.
  const entityOk = await admin.from('automation_events').insert({
    company_id: A.companyId, event_type: 'crm_opportunity_created',
    entity_type: 'crm_opportunity', entity_id: oppAId, payload: {},
  });
  check('«crm_opportunity» è un’entità ammessa da automation_events',
    !entityOk.error, msg(entityOk.error));
  const notifOk = await admin.from('notifications').insert({
    company_id: A.companyId, user_id: A.userId, type: 'crm_opportunity_assigned',
    entity_type: 'crm_opportunity', entity_id: oppAId, payload: {},
  });
  check('«crm_opportunity» è un’entità ammessa da notifications',
    !notifOk.error, msg(notifOk.error));

  // -------------------------------------------------------------------------
  section('13. Il candidato automatico — PROPONE, non crea (0030)');

  // Il nome della controparte scritto sul contratto coincide, normalizzato, con
  // una controparte che il CRM ha già: il candidato deve proporre di collegarli.
  const orgScan = await makeOrg(A.client, A.companyId, `Elettro Scan ${stamp} SA`);
  const { data: cMatch, error: cMatchErr } = await admin.from('contracts').insert({
    company_id: A.companyId, display_name: `Contratto con match ${stamp}`,
    counterparty_name: `elettro   scan ${stamp}   sa`,
  }).select('id').single();
  check('contratto di prova con una controparte riconoscibile', !cMatchErr, msg(cMatchErr));
  const { data: cNew } = await admin.from('contracts').insert({
    company_id: A.companyId, display_name: `Contratto senza match ${stamp}`,
    counterparty_name: `Sconosciuta ${stamp} Sagl`,
  }).select('id').single();

  // ⚠️ Il conteggio si misura PRIMA e DOPO, invece di confrontarlo con un
  // numero fisso: le sezioni precedenti hanno già creato controparti in questa
  // azienda, e «devono essere una» sarebbe un'asserzione sul test, non sulla
  // scansione. Prima stesura rossa proprio per questo — un test che fallisce
  // non prova sempre che il codice sia sbagliato.
  const orgsBefore = ((await admin.from('crm_organizations')
    .select('id').eq('company_id', A.companyId)).data ?? []).length;

  const scan1 = await admin.rpc('crm_scan_link_suggestions', { p_limit: 200 });
  check('la scansione gira e dice quanti suggerimenti ha creato',
    !scan1.error && typeof scan1.data === 'number', `${msg(scan1.error)} ${code(scan1.error)}`);

  const { data: sugg1 } = await admin.from('crm_link_suggestions')
    .select('source_entity_id, suggested_organization_id, suggested_name, reason, status, dedupe_key')
    .eq('company_id', A.companyId);
  const rowsS = (sugg1 ?? []) as Array<Record<string, unknown>>;
  const matchRow = rowsS.find((r) => r.source_entity_id === (cMatch as { id: string } | null)?.id);
  const newRow = rowsS.find((r) => r.source_entity_id === (cNew as { id: string } | null)?.id);

  check('la controparte già presente diventa un suggerimento di COLLEGAMENTO',
    matchRow?.reason === 'name_normalized' && matchRow?.suggested_organization_id === orgScan,
    JSON.stringify(matchRow));
  check('il nome che il CRM non conosce diventa un suggerimento di CREAZIONE',
    newRow?.reason === 'extracted_name' && newRow?.suggested_organization_id === null,
    JSON.stringify(newRow));
  check('il nome proposto è quello letto sul documento, non una versione normalizzata',
    newRow?.suggested_name === `Sconosciuta ${stamp} Sagl`, String(newRow?.suggested_name));
  const orgsAfter = ((await admin.from('crm_organizations')
    .select('id').eq('company_id', A.companyId)).data ?? []).length;
  check('nessuna organizzazione è nata dalla scansione: PROPONE, non crea (§21)',
    orgsAfter === orgsBefore, `prima ${orgsBefore}, dopo ${orgsAfter}`);
  check('nessun contratto è stato collegato dalla scansione',
    ((await admin.from('contracts').select('id').eq('company_id', A.companyId)
      .not('counterparty_organization_id', 'is', null)).data ?? []).length === 0);

  // ⚠️ IDEMPOTENZA: è la proprietà che rende utilizzabile un lavoro che gira
  // ogni cinque minuti. Senza, l'elenco «da verificare» si riempirebbe di copie.
  const scan2 = await admin.rpc('crm_scan_link_suggestions', { p_limit: 200 });
  const { data: sugg2 } = await admin.from('crm_link_suggestions')
    .select('id').eq('company_id', A.companyId);
  check('la seconda passata non crea nessun doppione',
    scan2.data === 0 && ((sugg2 ?? []) as unknown[]).length === rowsS.length,
    `creati ${String(scan2.data)}, totale ${((sugg2 ?? []) as unknown[]).length}`);

  // ⚠️ Un «no» resta un no: risolto un suggerimento, la scansione non lo
  // ripropone — è il vincolo unico sulla chiave, non un controllo nel codice.
  await admin.from('crm_link_suggestions').update({ status: 'rejected' })
    .eq('company_id', A.companyId).eq('source_entity_id', (cNew as { id: string }).id);
  await admin.rpc('crm_scan_link_suggestions', { p_limit: 200 });
  const { data: afterReject } = await admin.from('crm_link_suggestions')
    .select('status').eq('company_id', A.companyId).eq('source_entity_id', (cNew as { id: string }).id);
  check('un suggerimento rifiutato non torna in sospeso',
    ((afterReject ?? []) as Array<{ status: string }>).every((r) => r.status === 'rejected')
    && ((afterReject ?? []) as unknown[]).length === 1,
    JSON.stringify(afterReject));

  // ⚠️ La chiamata è LAVORO DI SISTEMA: un utente autenticato deve essere
  // respinto. `security definer` senza questo controllo scriverebbe per conto
  // di tutte le aziende — è la lezione della 0029.
  const asUser = await A.client.rpc('crm_scan_link_suggestions', { p_limit: 10 });
  check('un utente autenticato NON può eseguire la scansione',
    Boolean(asUser.error), `${msg(asUser.error)} ${code(asUser.error)}`);

  // Origine sparita: il pending che nessuno potrebbe più risolvere se ne va.
  await admin.from('contracts').delete().eq('id', (cMatch as { id: string }).id);
  await admin.rpc('crm_scan_link_suggestions', { p_limit: 200 });
  const { data: orphan } = await admin.from('crm_link_suggestions')
    .select('id').eq('company_id', A.companyId).eq('source_entity_id', (cMatch as { id: string }).id);
  check('cancellato il contratto, il suggerimento in sospeso non resta orfano',
    ((orphan ?? []) as unknown[]).length === 0);

  // -------------------------------------------------------------------------
  section('14. Cascata — cancellata l’azienda non resta niente');

  const tables: Array<[string, string]> = [
    ['crm_organizations', 'company_id'],
    ['crm_organization_roles', 'company_id'],
    ['crm_contacts', 'company_id'],
    ['crm_contact_methods', 'company_id'],
    ['crm_contact_organizations', 'company_id'],
    ['crm_opportunities', 'company_id'],
    ['crm_interactions', 'company_id'],
    ['crm_events', 'company_id'],
    ['crm_organization_documents', 'company_id'],
    ['crm_organization_emails', 'company_id'],
    ['crm_contact_emails', 'company_id'],
    ['crm_opportunity_documents', 'company_id'],
    ['crm_link_suggestions', 'company_id'],
  ];

  await cleanup();

  // ⚠️ DOPO la pulizia, non prima: è il test della cascata E la prova che la
  // pulizia ha davvero pulito.
  for (const [table, column] of tables) {
    const { data } = await admin.from(table).select('id').eq(column, A.companyId);
    check(`cancellata l’azienda, ${table} non ha residui`,
      ((data ?? []) as unknown[]).length === 0);
  }

  console.log(`\n${B}Risultato${X}: ${G}${pass} superati${X}${fail ? `, ${R}${fail} falliti${X}` : ''}`);
  process.exit(fail ? 1 : 0);
}

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
