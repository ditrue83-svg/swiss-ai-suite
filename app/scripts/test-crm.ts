// ============================================================================
// AI-Swisse — CRM Light: test d'integrazione sul DATABASE REALE.
//   npm run test:crm
//
// Richiede le migrazioni 0026, 0028, 0030, 0047, 0048 e 0049 applicate, e `.env.test`
// valorizzato.
// ⚠️ La 0028 non è un dettaglio: senza di essa la sezione 16 FALLISCE, perché
// lo storico del CRM impedisce la cancellazione di un'azienda. È il difetto
// che questo file ha trovato alla prima esecuzione.
// ⚠️ Senza la 0030 fallisce la sezione 13: `crm_scan_link_suggestions` non
// esiste ancora e la RPC risponde `PGRST202`.
// ⚠️ Senza la 0047 fallisce la sezione 15: `crm_field_definitions` e
// `crm_field_values` non esistono ancora, e PostgREST risponde che la
// relazione manca.
//
// Non prova che il codice sia scritto bene: prova che le GARANZIE siano in
// vigore. Sono sedici, e stanno tutte nel DATABASE, perché un servizio ben
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
//   12. AUTOMAZIONI — l'entità CRM è ammessa dal motore.
//   13. CANDIDATO — la scansione PROPONE e non crea, e un no resta un no.
//   14. IMPORT CSV — la riga entra intera e dichiara la provenienza; il
//       doppione duro si ferma sul vincolo, non sulla fiducia nel client.
//   15. CAMPI PERSONALIZZATI — le definizioni le scrive chi amministra, i
//       valori ogni membro; il tipo lo pretende il database, un campo
//       archiviato è congelato, la fusione trasferisce i valori.
//   16. EMAIL CRM — esiti idempotenti e fuori ordine; solo delivered è contatto.
//   17. PREVENTIVI — decimali, sequenze, RLS, invio e versioni immutabili.
//   18. CASCATA — cancellata l'azienda non resta niente, tabella per tabella.
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
  section('14. Import CSV — la riga entra intera, il doppione duro si ferma');

  // Il percorso è quello del wizard (ClientImportPage.importRow), passo per
  // passo: organizzazione con la PROVENIENZA dichiarata, poi ruoli, persona,
  // recapiti. Le colonne `source`/`source_detail` devono essere scrivibili
  // dall'utente: se un grant mancasse lo direbbe questa asserzione, non un
  // riepilogo a schermo.
  const impOrg = await A.client.from('crm_organizations').insert({
    company_id: A.companyId, display_name: `Importata ${stamp} Sagl`,
    uid_che: 'CHE-432.187.666', city: 'Bellinzona', canton: 'TI',
    source: 'import', source_detail: 'contatti-prova.csv',
  }).select('id, source, source_detail').single();
  check('la riga importata si inserisce con la provenienza dichiarata',
    !impOrg.error
    && (impOrg.data as { source?: string } | null)?.source === 'import'
    && (impOrg.data as { source_detail?: string } | null)?.source_detail === 'contatti-prova.csv',
    msg(impOrg.error));
  const impOrgId = (impOrg.data as { id: string } | null)?.id ?? '';

  const impRole = await A.client.from('crm_organization_roles').insert({
    company_id: A.companyId, organization_id: impOrgId, role: 'customer',
  });
  check('i ruoli della riga si salvano', !impRole.error, msg(impRole.error));

  const impContact = await A.client.from('crm_contacts')
    .insert({
      company_id: A.companyId, display_name: 'Mario Fontana',
      first_name: 'Mario', last_name: 'Fontana',
    }).select('id').single();
  check('la persona della riga si crea', !impContact.error, msg(impContact.error));
  const impContactId = (impContact.data as { id: string } | null)?.id ?? '';
  const impLink = await A.client.from('crm_contact_organizations').insert({
    company_id: A.companyId, contact_id: impContactId, organization_id: impOrgId,
    job_title: 'Amministratore', is_primary: true,
  });
  check('e si collega all’organizzazione importata', !impLink.error, msg(impLink.error));

  const impMail = await A.client.from('crm_contact_methods').insert({
    company_id: A.companyId, contact_id: impContactId, type: 'email',
    value: `mario.fontana.${stamp}@import-test.ch`, is_primary: true,
  });
  check('il recapito della persona si registra', !impMail.error, msg(impMail.error));

  // ⚠️ IL DOPPIONE DURO. L'anteprima dichiara l'IDI già presente e salta la
  // riga, ma l'ultima parola resta al vincolo: se un giorno il client
  // sbagliasse, il database — non la fiducia — impedirebbe la scheda doppia.
  const impDup = await A.client.from('crm_organizations').insert({
    company_id: A.companyId, display_name: 'Importata di nuovo',
    uid_che: 'CHE432187666', source: 'import', source_detail: 'contatti-prova.csv',
  });
  check('reimportare lo stesso IDI valido è un 23505, non una scheda doppia',
    Boolean(impDup.error) && code(impDup.error) === '23505',
    `${code(impDup.error)} ${msg(impDup.error)}`);

  // La stessa prova per l'email: è il vincolo per cui il client omette
  // l'indirizzo già registrato invece di tentarlo e mostrare un errore atteso.
  const impMailDup = await A.client.from('crm_contact_methods').insert({
    company_id: A.companyId, contact_id: impContactId, type: 'email',
    value: `MARIO.FONTANA.${stamp}@IMPORT-TEST.CH`, is_primary: false,
  });
  check('reimportare la stessa email è un 23505: il client la omette e lo dichiara',
    Boolean(impMailDup.error) && code(impMailDup.error) === '23505',
    `${code(impMailDup.error)} ${msg(impMailDup.error)}`);

  // ⚠️ L'IDI con la cifra errata ENTRA due volte: non identifica nessuno,
  // quindi non collide (uid_norm resta null, sezione 7). La riga si importa
  // e l'anteprima lo ha già detto con l'errore di riga.
  const impBad1 = await A.client.from('crm_organizations').insert({
    company_id: A.companyId, display_name: 'IDI errato 1',
    uid_che: 'CHE-432.187.667', source: 'import',
  });
  const impBad2 = await A.client.from('crm_organizations').insert({
    company_id: A.companyId, display_name: 'IDI errato 2',
    uid_che: 'CHE-432.187.667', source: 'import',
  });
  check('un IDI con la cifra errata si importa due volte senza collidere',
    !impBad1.error && !impBad2.error, `${msg(impBad1.error)} / ${msg(impBad2.error)}`);

  // ⚠️ IL CONFINE. Lo stesso IDI valido importato da B non collide con la
  // scheda di A: l'indice unico è per company_id, e l'import di un tenant non
  // deve sapere che cosa l'altro ha già.
  const impB = await Bt.client.from('crm_organizations').insert({
    company_id: Bt.companyId, display_name: 'Importata da B',
    uid_che: 'CHE-432.187.666', source: 'import',
  });
  check('lo stesso IDI valido si importa in un’altra azienda senza collidere',
    !impB.error, msg(impB.error));

  // -------------------------------------------------------------------------
  section('15. Campi personalizzati — definizioni e valori (0047)');

  // ⚠️ LE DUE METÀ DEL MODELLO. Le definizioni le scrive CHI AMMINISTRA (la
  // forma dei dati è di tutta l'azienda, come la fusione); i valori li scrive
  // OGNI MEMBRO (sono dati come gli altri). E il tipo non lo decide il client:
  // ogni rifiuto qui sotto arriva dal database, col suo sentinella.
  const NIL = '00000000-0000-0000-0000-000000000000';

  const defText = await A.client.from('crm_field_definitions').insert({
    company_id: A.companyId, entity: 'organization', name: 'Numero cliente', field_type: 'text',
  }).select('id, created_by').single();
  check('chi amministra crea un campo testo sulle controparti', !defText.error, msg(defText.error));
  const defTextId = (defText.data as { id: string } | null)?.id ?? NIL;
  check('e l’autore lo timbra il database',
    (defText.data as { created_by: string | null } | null)?.created_by === A.userId);

  const defSelect = await A.client.from('crm_field_definitions').insert({
    company_id: A.companyId, entity: 'organization', name: 'Fascia fatturato',
    field_type: 'select', options: [' Piccola ', 'Media', 'Grande'],
  }).select('id, options').single();
  check('un campo a lista nasce con le sue opzioni', !defSelect.error, msg(defSelect.error));
  const defSelectId = (defSelect.data as { id: string } | null)?.id ?? NIL;
  check('e le opzioni si conservano normalizzate: spazi tolti, ordine tenuto',
    JSON.stringify((defSelect.data as { options: unknown } | null)?.options)
      === JSON.stringify(['Piccola', 'Media', 'Grande']),
    JSON.stringify((defSelect.data as { options: unknown } | null)?.options));

  const defDate = await A.client.from('crm_field_definitions').insert({
    company_id: A.companyId, entity: 'opportunity', name: 'Data rinnovo', field_type: 'date',
  }).select('id').single();
  check('un campo data nasce sulle trattative', !defDate.error, msg(defDate.error));
  const defDateId = (defDate.data as { id: string } | null)?.id ?? NIL;

  const defNum = await A.client.from('crm_field_definitions').insert({
    company_id: A.companyId, entity: 'organization', name: 'Dipendenti', field_type: 'number',
  }).select('id').single();
  check('un campo numero nasce sulle controparti', !defNum.error, msg(defNum.error));
  const defNumId = (defNum.data as { id: string } | null)?.id ?? NIL;

  const defByMember = await member.client.from('crm_field_definitions').insert({
    company_id: A.companyId, entity: 'organization', name: 'Campo vietato', field_type: 'text',
  });
  check('un membro semplice NON crea definizioni: cambiano la forma dei dati',
    Boolean(defByMember.error), msg(defByMember.error) || 'nessun errore');

  const defCross = await A.client.from('crm_field_definitions').insert({
    company_id: Bt.companyId, entity: 'organization', name: 'Campo altrui', field_type: 'text',
  });
  check('e nessuno dichiara un campo per un’altra azienda',
    Boolean(defCross.error), msg(defCross.error) || 'nessun errore');

  const { data: defsLeak } = await Bt.client.from('crm_field_definitions')
    .select('id').eq('company_id', A.companyId);
  check('B non vede le definizioni di A', ((defsLeak ?? []) as unknown[]).length === 0);

  // ⚠️ Il nome è unico per azienda e scheda FRA I CAMPI ATTIVI, insensibile
  // alle maiuscole: due «Cliente dal» sulla stessa scheda sarebbero
  // indistinguibili a schermo. Archiviato il campo, il nome si libera.
  const defDup = await A.client.from('crm_field_definitions').insert({
    company_id: A.companyId, entity: 'organization', name: 'numero CLIENTE', field_type: 'text',
  });
  check('due campi attivi con lo stesso nome sulla stessa scheda non esistono (23505)',
    Boolean(defDup.error) && code(defDup.error) === '23505',
    `${code(defDup.error)} ${msg(defDup.error)}`);

  const defOtherEntity = await A.client.from('crm_field_definitions').insert({
    company_id: A.companyId, entity: 'opportunity', name: 'Numero cliente', field_type: 'text',
  }).select('id').single();
  check('lo stesso nome è libero sull’altra scheda', !defOtherEntity.error, msg(defOtherEntity.error));
  const defOtherEntityId = (defOtherEntity.data as { id: string } | null)?.id ?? NIL;

  await A.client.from('crm_field_definitions')
    .update({ archived_at: new Date().toISOString() }).eq('id', defOtherEntityId);
  const defReused = await A.client.from('crm_field_definitions').insert({
    company_id: A.companyId, entity: 'opportunity', name: 'Numero cliente', field_type: 'text',
  });
  check('archiviato il campo, il suo nome si libera', !defReused.error, msg(defReused.error));

  const defDupOptions = await A.client.from('crm_field_definitions').insert({
    company_id: A.companyId, entity: 'organization', name: 'Lista doppia',
    field_type: 'select', options: ['una', 'una'],
  });
  check('due voci uguali nella stessa lista sono rifiutate, e il rifiuto lo dice',
    Boolean(defDupOptions.error) && /crm_field_options_duplicate/.test(msg(defDupOptions.error)),
    `${code(defDupOptions.error)} ${msg(defDupOptions.error)}`);

  const defMisplaced = await A.client.from('crm_field_definitions').insert({
    company_id: A.companyId, entity: 'organization', name: 'Opzioni fuori posto',
    field_type: 'text', options: ['x'],
  }).select('options').single();
  check('le opzioni dichiarate su un campo testo spariscono: non gli appartengono',
    !defMisplaced.error && (defMisplaced.data as { options: unknown } | null)?.options === null,
    `${msg(defMisplaced.error)} ${JSON.stringify((defMisplaced.data as { options: unknown } | null)?.options)}`);

  // ⚠️ TIPO ED ENTITÀ SONO CONGELATI ALLA NASCITA: cambiare «numero» in
  // «testo» con i valori già scritti renderebbe quelle righe false. Il primo
  // argine è il permesso di colonna (42501); il guardiano ripristinerebbe il
  // valore, ma il client non arriva nemmeno a parlarci.
  const moveEntity = await A.client.from('crm_field_definitions')
    .update({ entity: 'opportunity' }).eq('id', defTextId);
  check('l’entità di un campo non si riscrive',
    Boolean(moveEntity.error) && code(moveEntity.error) === '42501',
    `${code(moveEntity.error)} ${msg(moveEntity.error)}`);
  const changeType = await A.client.from('crm_field_definitions')
    .update({ field_type: 'number' }).eq('id', defTextId);
  check('e nemmeno il tipo: un campo diverso è un campo nuovo',
    Boolean(changeType.error) && code(changeType.error) === '42501',
    `${code(changeType.error)} ${msg(changeType.error)}`);

  const valText = await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defTextId, organization_id: orgA, value_text: 'CLI-0042',
  }).select('id').single();
  check('un valore di testo si scrive sulla controparte', !valText.error, msg(valText.error));
  const valTextId = (valText.data as { id: string } | null)?.id ?? NIL;

  const valTwice = await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defTextId, organization_id: orgA, value_text: 'CLI-9999',
  });
  check('una seconda risposta alla stessa domanda è un 23505, non una doppia riga',
    Boolean(valTwice.error) && code(valTwice.error) === '23505',
    `${code(valTwice.error)} ${msg(valTwice.error)}`);

  const valWrongColumn = await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defTextId, organization_id: orgScan, value_number: 5,
  });
  check('un numero dentro un campo testo è rifiutato, con il suo sentinella',
    Boolean(valWrongColumn.error) && /crm_field_type_mismatch/.test(msg(valWrongColumn.error)),
    `${code(valWrongColumn.error)} ${msg(valWrongColumn.error)}`);

  const valBlank = await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defTextId, organization_id: orgScan, value_text: '   ',
  });
  check('un testo di soli spazi NON è un valore',
    Boolean(valBlank.error) && /crm_field_value_empty/.test(msg(valBlank.error)),
    `${code(valBlank.error)} ${msg(valBlank.error)}`);

  const valOffList = await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defSelectId, organization_id: orgA, value_text: 'Enorme',
  });
  check('una voce fuori lista è rifiutata',
    Boolean(valOffList.error) && /crm_field_option_not_allowed/.test(msg(valOffList.error)),
    `${code(valOffList.error)} ${msg(valOffList.error)}`);

  const valSelect = await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defSelectId, organization_id: orgA, value_text: 'Grande',
  });
  check('una voce della lista è accettata', !valSelect.error, msg(valSelect.error));

  const valDate = await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defDateId, opportunity_id: oppAId, value_date: '2027-03-31',
  }).select('id, value_date').single();
  check('una data si scrive sulla trattativa',
    !valDate.error && (valDate.data as { value_date: string | null } | null)?.value_date === '2027-03-31',
    msg(valDate.error));

  // ⚠️ TRE company_id A CONFRONTO: riga, definizione, entità. A dichiara la
  // PROPRIA azienda e aggancia la scheda di B — la RLS lascia passare (il
  // company_id dichiarato è il suo), e a fermarla è il guardiano…
  const valCross = await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defTextId, organization_id: orgB, value_text: 'intrusione',
  });
  check('A non scrive valori su una scheda di B',
    Boolean(valCross.error) && /crm_field_value_company_mismatch/.test(msg(valCross.error)),
    `${code(valCross.error)} ${msg(valCross.error)}`);

  // …e il guardiano si difende da sé: nemmeno il service role lo scavalca.
  const valCrossAdmin = await admin.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defTextId, organization_id: orgB, value_text: 'intrusione',
  });
  check('e il rifiuto tiene ANCHE col service role: è il guardiano, non la policy',
    Boolean(valCrossAdmin.error) && /crm_field_value_company_mismatch/.test(msg(valCrossAdmin.error)),
    `${code(valCrossAdmin.error)} ${msg(valCrossAdmin.error)}`);

  const valWrongEntity = await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defDateId, organization_id: orgA, value_date: '2027-01-01',
  });
  check('un campo delle trattative non accetta una controparte',
    Boolean(valWrongEntity.error) && /crm_field_entity_mismatch/.test(msg(valWrongEntity.error)),
    `${code(valWrongEntity.error)} ${msg(valWrongEntity.error)}`);

  const valUnknown = await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: NIL, organization_id: orgA, value_text: 'orfano',
  });
  check('scrivere su un campo che non esiste è rifiutato',
    Boolean(valUnknown.error) && /crm_field_unknown/.test(msg(valUnknown.error)),
    `${code(valUnknown.error)} ${msg(valUnknown.error)}`);

  const valUpdate = await A.client.from('crm_field_values')
    .update({ value_text: 'CLI-0043' }).eq('id', valTextId);
  const { data: valAfterUpdate } = await admin.from('crm_field_values')
    .select('value_text').eq('id', valTextId).maybeSingle();
  check('il valore si riscrive',
    !valUpdate.error && (valAfterUpdate as { value_text: string | null } | null)?.value_text === 'CLI-0043',
    msg(valUpdate.error));

  const valMove = await A.client.from('crm_field_values')
    .update({ field_id: defNumId }).eq('id', valTextId);
  check('ma un valore non cambia campo: l’appartenenza è congelata',
    Boolean(valMove.error) && code(valMove.error) === '42501',
    `${code(valMove.error)} ${msg(valMove.error)}`);

  const { data: valsLeak } = await Bt.client.from('crm_field_values')
    .select('id').eq('organization_id', orgA);
  check('B non vede i valori di A', ((valsLeak ?? []) as unknown[]).length === 0);

  // I valori li scrive OGNI membro, e svuotare un campo CANCELLA la riga: un
  // valore vuoto e l'assenza del valore direbbero la stessa cosa in due modi.
  const valByMember = await member.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defNumId, organization_id: orgScan, value_number: 7,
  }).select('id').single();
  check('un membro semplice SCRIVE i valori: sono dati come gli altri',
    !valByMember.error, msg(valByMember.error));
  const valByMemberId = (valByMember.data as { id: string } | null)?.id ?? NIL;
  const valDelByMember = await member.client.from('crm_field_values')
    .delete().eq('id', valByMemberId).select('id');
  check('e li cancella: svuotare un campo cancella la riga',
    !valDelByMember.error && ((valDelByMember.data ?? []) as unknown[]).length === 1,
    msg(valDelByMember.error));

  // ⚠️ UN CAMPO ARCHIVIATO È CONGELATO: i valori esistenti restano leggibili
  // e si possono cancellare, ma nessuno se ne aggiunge e nessuno si riscrive.
  await A.client.from('crm_field_definitions')
    .update({ archived_at: new Date().toISOString() }).eq('id', defTextId);
  const { data: defArchived } = await admin.from('crm_field_definitions')
    .select('archived_at, archived_by').eq('id', defTextId).single();
  const darch = (defArchived ?? {}) as { archived_at: string | null; archived_by: string | null };
  check('archiviare un campo lo timbra: quando e chi',
    darch.archived_at !== null && darch.archived_by === A.userId, JSON.stringify(darch));

  const valOnArchived = await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defTextId, organization_id: orgScan, value_text: 'tardi',
  });
  check('su un campo archiviato non si scrive più',
    Boolean(valOnArchived.error) && /crm_field_archived/.test(msg(valOnArchived.error)),
    `${code(valOnArchived.error)} ${msg(valOnArchived.error)}`);

  const valRewriteArchived = await A.client.from('crm_field_values')
    .update({ value_text: 'tardi' }).eq('id', valTextId);
  check('e non si riscrive ciò che c’è già',
    Boolean(valRewriteArchived.error) && /crm_field_archived/.test(msg(valRewriteArchived.error)),
    `${code(valRewriteArchived.error)} ${msg(valRewriteArchived.error)}`);

  const { data: valsArchived } = await admin.from('crm_field_values')
    .select('id, value_text').eq('field_id', defTextId);
  check('ma i valori di un campo archiviato RESTANO: leggibili, intatti',
    ((valsArchived ?? []) as unknown[]).length === 1
    && ((valsArchived ?? []) as Array<{ value_text: string }>)[0]?.value_text === 'CLI-0043',
    JSON.stringify(valsArchived));

  const rename = await A.client.from('crm_field_definitions')
    .update({ name: 'Codice cliente' }).eq('id', defTextId);
  const { data: valsAfterRename } = await admin.from('crm_field_values')
    .select('id').eq('field_id', defTextId);
  check('rinominare il campo non stacca i valori: puntano all’id, non al nome',
    !rename.error && ((valsAfterRename ?? []) as unknown[]).length === 1, msg(rename.error));

  await A.client.from('crm_field_definitions').update({ archived_at: null }).eq('id', defTextId);
  const { data: defRestored } = await admin.from('crm_field_definitions')
    .select('archived_at, archived_by').eq('id', defTextId).single();
  const drest = (defRestored ?? {}) as { archived_at: string | null; archived_by: string | null };
  check('ripristinato, il timbro si cancella',
    drest.archived_at === null && drest.archived_by === null, JSON.stringify(drest));
  const valAfterRestore = await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defTextId, organization_id: orgScan, value_text: 'CLI-1000',
  });
  check('e si torna a scrivere', !valAfterRestore.error, msg(valAfterRestore.error));

  // ⚠️ LA FUSIONE TRASFERISCE I VALORI: lasciarli sul secondario li
  // seppellirebbe dentro una scheda archiviata. Dove il principale ha già un
  // valore per lo stesso campo vince il principale, come per ruoli e recapiti.
  const orgMergeFields = await makeOrg(A.client, A.companyId, `Fusa Campi ${stamp} Sagl`);
  await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defSelectId, organization_id: orgMergeFields, value_text: 'Media',
  });
  await A.client.from('crm_field_values').insert({
    company_id: A.companyId, field_id: defNumId, organization_id: orgMergeFields, value_number: 42,
  });
  // Il campo numero viene ARCHIVIATO prima della fusione: i valori devono
  // passare lo stesso — la fusione sposta la storia, non la riscrive, e il
  // guardiano la riconosce dal sentinella interno `ai_swisse.crm_internal`.
  await A.client.from('crm_field_definitions')
    .update({ archived_at: new Date().toISOString() }).eq('id', defNumId);

  const mergeFields = await A.client.rpc('crm_merge_organizations', {
    p_target_id: orgA, p_source_id: orgMergeFields,
  });
  check('la fusione con i campi personalizzati riesce', !mergeFields.error, msg(mergeFields.error));

  const { data: valNumMerged } = await admin.from('crm_field_values')
    .select('value_number').eq('field_id', defNumId).eq('organization_id', orgA);
  check('il valore che mancava al principale passa, ANCHE da un campo archiviato',
    ((valNumMerged ?? []) as Array<{ value_number: number | string }>).length === 1
    && Number(((valNumMerged ?? []) as Array<{ value_number: number | string }>)[0]?.value_number) === 42,
    JSON.stringify(valNumMerged));

  const { data: valSelectMerged } = await admin.from('crm_field_values')
    .select('value_text').eq('field_id', defSelectId).eq('organization_id', orgA);
  check('dove il principale ha già un valore vince il principale',
    ((valSelectMerged ?? []) as Array<{ value_text: string }>).length === 1
    && ((valSelectMerged ?? []) as Array<{ value_text: string }>)[0]?.value_text === 'Grande',
    JSON.stringify(valSelectMerged));

  const { data: valsSource } = await admin.from('crm_field_values')
    .select('id').eq('organization_id', orgMergeFields);
  check('sulla scheda fusa non resta nessun valore',
    ((valsSource ?? []) as unknown[]).length === 0);

  await A.client.from('crm_field_definitions').update({ archived_at: null }).eq('id', defNumId);

  // -------------------------------------------------------------------------
  section('16. Email CRM — esiti firmati applicati una volta e contatto solo alla consegna');

  const orgDelivery = await makeOrg(A.client, A.companyId, `Consegna ${stamp} SA`);
  const outgoing = await admin.from('email_messages').insert({
    company_id: A.companyId, connection_id: null, provider_message_id: `crm:${stamp}`,
    provider_thread_id: `crm:${stamp}`, subject: 'Offerta', sender_name: 'AI-Swisse',
    sender_email: 'crm@example.ch', to_recipients: [{ email: `cliente-${stamp}@example.ch` }],
    received_at: '2026-08-30T10:00:00.000Z', sent_at: '2026-08-30T10:00:00.000Z',
    body_text: 'contenuto che non deve entrare negli eventi', body_preview: 'contenuto',
    direction: 'out', delivery_status: 'sent', delivery_provider_id: `resend-${stamp}`,
    send_idempotency_key: crypto.randomUUID(), sent_by: A.userId,
  }).select('id').single();
  const outgoingId = (outgoing.data as { id?: string } | null)?.id ?? NIL;
  check('il service role registra una uscente senza connessione OAuth', !outgoing.error, msg(outgoing.error));
  const orgEmail = await admin.from('crm_organization_emails').insert({
    company_id: A.companyId, organization_id: orgDelivery,
    email_message_id: outgoingId, match_reason: 'manual', confirmed_by: A.userId,
  });
  check('l’email uscente si collega alla scheda senza copiare il contenuto', !orgEmail.error, msg(orgEmail.error));

  const browserStatus = await A.client.from('email_messages')
    .update({ delivery_status: 'delivered' } as never).eq('id', outgoingId);
  check('il browser non può falsificare lo stato di consegna', Boolean(browserStatus.error), msg(browserStatus.error));
  const browserRpc = await A.client.rpc('crm_apply_email_delivery_event' as never, {
    p_event_id: `browser-${stamp}`, p_provider_email_id: `resend-${stamp}`,
    p_event_type: 'email.delivered', p_occurred_at: '2026-08-30T10:02:00.000Z', p_error_safe: null,
  } as never);
  check('il browser non può chiamare la funzione che applica il webhook', Boolean(browserRpc.error), msg(browserRpc.error));

  const sentEvent = await admin.rpc('crm_apply_email_delivery_event', {
    p_event_id: `sent-${stamp}`, p_provider_email_id: `resend-${stamp}`,
    p_event_type: 'email.sent', p_occurred_at: '2026-08-30T10:01:00.000Z', p_error_safe: null,
  });
  const { data: beforeDelivery } = await admin.from('crm_organizations')
    .select('last_contact_at').eq('id', orgDelivery).single();
  check('accettata dal provider non è ancora un contatto', !sentEvent.error
    && (beforeDelivery as { last_contact_at: string | null } | null)?.last_contact_at === null, msg(sentEvent.error));

  const deliveredEvent = await admin.rpc('crm_apply_email_delivery_event', {
    p_event_id: `delivered-${stamp}`, p_provider_email_id: `resend-${stamp}`,
    p_event_type: 'email.delivered', p_occurred_at: '2026-08-30T10:02:00.000Z', p_error_safe: null,
  });
  const duplicateEvent = await admin.rpc('crm_apply_email_delivery_event', {
    p_event_id: `delivered-${stamp}`, p_provider_email_id: `resend-${stamp}`,
    p_event_type: 'email.delivered', p_occurred_at: '2026-08-30T10:02:00.000Z', p_error_safe: null,
  });
  const { data: afterDelivery } = await admin.from('crm_organizations')
    .select('last_contact_at').eq('id', orgDelivery).single();
  check('la consegna riuscita aggiorna l’ultimo contatto', !deliveredEvent.error
    && Boolean((afterDelivery as { last_contact_at: string | null } | null)?.last_contact_at), msg(deliveredEvent.error));
  check('lo stesso svix-id viene applicato una volta sola', duplicateEvent.data === false, msg(duplicateEvent.error));

  await admin.rpc('crm_apply_email_delivery_event', {
    p_event_id: `old-failure-${stamp}`, p_provider_email_id: `resend-${stamp}`,
    p_event_type: 'email.bounced', p_occurred_at: '2026-08-30T10:01:30.000Z',
    p_error_safe: 'Il server del destinatario ha rifiutato il messaggio.',
  });
  const { data: afterOldEvent } = await admin.from('email_messages')
    .select('delivery_status').eq('id', outgoingId).single();
  check('un evento più vecchio arrivato dopo non regredisce la consegna',
    (afterOldEvent as { delivery_status: string } | null)?.delivery_status === 'delivered');

  const { data: contentEvents } = await admin.from('crm_events')
    .select('detail').eq('organization_id', orgDelivery);
  check('il corpo inviato non entra in crm_events',
    !JSON.stringify(contentEvents ?? []).includes('contenuto che non deve entrare'));

  // -------------------------------------------------------------------------
  section('17. Preventivi — decimali, sequenze, RLS, invio e versioni immutabili (0049)');

  const validUntil = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
  const { data: rates, error: ratesError } = await admin.from('finance_vat_rates')
    .select('id, kind, rate').eq('country_code', 'CH').is('valid_to', null);
  const rateRows = (rates ?? []) as Array<{ id: string; kind: string; rate: string | number }>;
  const standardRate = rateRows.find((rate) => rate.kind === 'standard');
  const reducedRate = rateRows.find((rate) => rate.kind === 'reduced');
  check('le aliquote svizzere con fonte sono disponibili come dati', !ratesError
    && Number(standardRate?.rate) === 8.1 && Number(reducedRate?.rate) === 2.6, msg(ratesError));

  const quoteItems = [
    { description: 'Consulenza', quantity: '2.000', unitPrice: '100.00', vatRateId: standardRate?.id },
    { description: 'Materiale', quantity: '1.000', unitPrice: '50.00', vatRateId: reducedRate?.id },
  ];
  const savedA = await A.client.rpc('crm_save_quote_draft', {
    p_company_id: A.companyId, p_opportunity_id: oppAId, p_quote_id: null,
    p_language: 'it', p_valid_until: validUntil, p_currency: 'CHF',
    p_title: 'Preventivo impianto', p_introduction: 'Introduzione', p_notes: 'Note',
    p_items: quoteItems,
  });
  const quoteVersionA = savedA.data as string | null;
  check('un membro crea una bozza collegata alla trattativa', !savedA.error && Boolean(quoteVersionA), msg(savedA.error));

  const { data: versionA } = await admin.from('crm_quote_versions')
    .select('id, quote_id, currency, subtotal_amount, vat_amount, total_amount, status')
    .eq('id', quoteVersionA ?? NIL).single();
  const quoteIdA = (versionA as { quote_id?: string } | null)?.quote_id ?? NIL;
  const { data: rootA } = await admin.from('crm_quotes')
    .select('quote_number, sequence_number').eq('id', quoteIdA).single();
  check('il primo numero dell’azienda è P-000001',
    (rootA as { quote_number?: string } | null)?.quote_number === 'P-000001'
    && Number((rootA as { sequence_number?: number } | null)?.sequence_number) === 1,
    JSON.stringify(rootA));
  check('PostgreSQL calcola CHF 250.00 + IVA 17.50 = CHF 267.50',
    Number((versionA as { subtotal_amount?: number } | null)?.subtotal_amount) === 250
    && Number((versionA as { vat_amount?: number } | null)?.vat_amount) === 17.5
    && Number((versionA as { total_amount?: number } | null)?.total_amount) === 267.5
    && (versionA as { currency?: string } | null)?.currency === 'CHF', JSON.stringify(versionA));

  const directWrite = await A.client.from('crm_quote_versions')
    .update({ title: 'Tentativo diretto' } as never).eq('id', quoteVersionA ?? NIL);
  check('il browser non scrive direttamente le tabelle preventivi', Boolean(directWrite.error), msg(directWrite.error));
  const { data: quoteLeak } = await Bt.client.from('crm_quote_versions')
    .select('id').eq('id', quoteVersionA ?? NIL);
  check('B non vede la versione di A', ((quoteLeak ?? []) as unknown[]).length === 0);

  const crossRoot = await admin.from('crm_quotes').insert({
    company_id: A.companyId, opportunity_id: NIL, organization_id: orgB,
    sequence_number: 999, quote_number: 'P-000999',
  });
  check('nemmeno il service role può creare un preventivo cross-tenant', Boolean(crossRoot.error), msg(crossRoot.error));

  const invalidVat = await A.client.rpc('crm_save_quote_draft', {
    p_company_id: A.companyId, p_opportunity_id: oppAId, p_quote_id: null,
    p_language: 'it', p_valid_until: validUntil, p_currency: 'CHF', p_title: 'IVA non valida',
    p_introduction: null, p_notes: null,
    p_items: [{ description: 'Voce', quantity: '1', unitPrice: '1', vatRateId: NIL }],
  });
  check('una aliquota non presente nel catalogo verificato viene rifiutata', Boolean(invalidVat.error), msg(invalidVat.error));

  const secondA = await A.client.rpc('crm_save_quote_draft', {
    p_company_id: A.companyId, p_opportunity_id: oppAId, p_quote_id: null,
    p_language: 'de', p_valid_until: validUntil, p_currency: 'EUR', p_title: 'Zweite Offerte',
    p_introduction: null, p_notes: null, p_items: [quoteItems[0]],
  });
  const { data: secondRoot } = await admin.from('crm_quote_versions')
    .select('crm_quotes(quote_number, sequence_number)').eq('id', (secondA.data as string | null) ?? NIL).single();
  const secondRootValue = (secondRoot as { crm_quotes?: { quote_number?: string; sequence_number?: number } | Array<{ quote_number?: string; sequence_number?: number }> } | null)?.crm_quotes;
  const secondRootRow = Array.isArray(secondRootValue) ? secondRootValue[0] : secondRootValue;
  check('la sequenza di A prosegue senza dipendere dalla valuta', !secondA.error
    && secondRootRow?.quote_number === 'P-000002' && Number(secondRootRow.sequence_number) === 2,
    msg(secondA.error) || JSON.stringify(secondRoot));

  const oppB = await Bt.client.from('crm_opportunities').insert({
    company_id: Bt.companyId, organization_id: orgB, title: 'Trattativa B', stage: 'proposal',
  }).select('id').single();
  const quoteB = await Bt.client.rpc('crm_save_quote_draft', {
    p_company_id: Bt.companyId,
    p_opportunity_id: (oppB.data as { id?: string } | null)?.id ?? NIL,
    p_quote_id: null, p_language: 'fr', p_valid_until: validUntil, p_currency: 'CHF',
    p_title: 'Devis B', p_introduction: null, p_notes: null, p_items: [quoteItems[0]],
  });
  const { data: rootB } = await admin.from('crm_quote_versions')
    .select('crm_quotes(quote_number)').eq('id', (quoteB.data as string | null) ?? NIL).single();
  const rootBValue = (rootB as { crm_quotes?: { quote_number?: string } | Array<{ quote_number?: string }> } | null)?.crm_quotes;
  const rootBRow = Array.isArray(rootBValue) ? rootBValue[0] : rootBValue;
  check('la numerazione riparte da P-000001 nell’azienda B', !oppB.error && !quoteB.error
    && rootBRow?.quote_number === 'P-000001', msg(oppB.error) || msg(quoteB.error) || JSON.stringify(rootB));

  const generatedDocument = await admin.from('documents').insert({
    company_id: A.companyId, uploaded_by: A.userId, title: 'Preventivo P-000001 · v1',
    original_filename: 'P-000001-v1.pdf', mime_type: 'application/pdf', file_size: 5000,
    storage_path: `${A.companyId}/${crypto.randomUUID()}/P-000001-v1.pdf`,
    source_type: 'generated', status: 'uploaded',
  }).select('id').single();
  const generatedDocumentId = (generatedDocument.data as { id?: string } | null)?.id ?? NIL;
  const registered = await admin.rpc('crm_register_quote_pdf', {
    p_company_id: A.companyId, p_quote_version_id: quoteVersionA ?? NIL,
    p_document_id: generatedDocumentId,
  });
  check('il PDF generato entra nei Documenti con provenienza e legami CRM',
    !generatedDocument.error && !registered.error, msg(generatedDocument.error) || msg(registered.error));

  const quoteEmail = await admin.from('email_messages').insert({
    company_id: A.companyId, connection_id: null, provider_message_id: `crm:quote-${stamp}`,
    provider_thread_id: `crm:quote-${stamp}`, subject: 'Preventivo P-000001',
    sender_name: 'Ai-Swisse', sender_email: 'crm@example.ch',
    to_recipients: [{ email: `preventivo-${stamp}@example.ch` }],
    received_at: new Date().toISOString(), sent_at: new Date().toISOString(), body_text: 'In allegato.',
    body_preview: 'In allegato.', direction: 'out', delivery_status: null,
    send_idempotency_key: crypto.randomUUID(), sent_by: A.userId,
  }).select('id').single();
  const quoteEmailId = (quoteEmail.data as { id?: string } | null)?.id ?? NIL;
  const quoteAttachment = await admin.from('crm_outgoing_email_attachments').insert({
    company_id: A.companyId, email_message_id: quoteEmailId, document_id: generatedDocumentId,
  });
  const prematureSend = await admin.rpc('crm_mark_attached_quotes_sent', {
    p_company_id: A.companyId, p_email_message_id: quoteEmailId,
  });
  const { data: stillDraft } = await admin.from('crm_quote_versions')
    .select('status').eq('id', quoteVersionA ?? NIL).single();
  check('un tentativo senza risposta del provider non marca il preventivo inviato',
    !quoteEmail.error && !quoteAttachment.error && Boolean(prematureSend.error)
    && (stillDraft as { status?: string } | null)?.status === 'draft',
    msg(quoteEmail.error) || msg(quoteAttachment.error) || msg(prematureSend.error));

  const providerAccepted = await admin.from('email_messages')
    .update({ delivery_status: 'sent', delivery_provider_id: `resend-quote-${stamp}` })
    .eq('id', quoteEmailId);
  const markedSent = await admin.rpc('crm_mark_attached_quotes_sent', {
    p_company_id: A.companyId, p_email_message_id: quoteEmailId,
  });
  const { data: sentVersion } = await admin.from('crm_quote_versions')
    .select('status, sent_at, sent_email_id').eq('id', quoteVersionA ?? NIL).single();
  check('solo la risposta positiva del provider porta il preventivo a inviato',
    !providerAccepted.error && !markedSent.error && markedSent.data === 1
    && (sentVersion as { status?: string } | null)?.status === 'sent'
    && (sentVersion as { sent_email_id?: string } | null)?.sent_email_id === quoteEmailId,
    msg(providerAccepted.error) || msg(markedSent.error) || JSON.stringify(sentVersion));

  const mutateSent = await admin.from('crm_quote_versions')
    .update({ title: 'Non deve cambiare' }).eq('id', quoteVersionA ?? NIL);
  const { data: firstItem } = await admin.from('crm_quote_items')
    .select('id').eq('quote_version_id', quoteVersionA ?? NIL).limit(1).single();
  const mutateSentItem = await admin.from('crm_quote_items')
    .update({ description: 'Non deve cambiare' }).eq('id', (firstItem as { id?: string } | null)?.id ?? NIL);
  check('dopo l’invio né la versione né le voci si sovrascrivono',
    Boolean(mutateSent.error) && Boolean(mutateSentItem.error),
    `${msg(mutateSent.error)} · ${msg(mutateSentItem.error)}`);

  const overwriteSent = await A.client.rpc('crm_save_quote_draft', {
    p_company_id: A.companyId, p_opportunity_id: oppAId, p_quote_id: quoteIdA,
    p_language: 'it', p_valid_until: validUntil, p_currency: 'CHF', p_title: 'Riscrittura',
    p_introduction: null, p_notes: null, p_items: quoteItems,
  });
  check('la RPC rifiuta la sovrascrittura di un preventivo inviato', Boolean(overwriteSent.error), msg(overwriteSent.error));

  const accepted = await A.client.rpc('crm_set_quote_status', {
    p_company_id: A.companyId, p_quote_version_id: quoteVersionA ?? NIL, p_status: 'accepted',
  });
  const { data: opportunityAfterAccept } = await admin.from('crm_opportunities')
    .select('stage').eq('id', oppAId).single();
  check('accettare il preventivo non vince automaticamente la trattativa', !accepted.error
    && (opportunityAfterAccept as { stage?: string } | null)?.stage !== 'won', msg(accepted.error));
  const explicitWon = await A.client.from('crm_opportunities').update({ stage: 'won' }).eq('id', oppAId);
  check('la trattativa passa a vinta soltanto con la conferma esplicita', !explicitWon.error, msg(explicitWon.error));

  const newVersion = await A.client.rpc('crm_new_quote_version', {
    p_company_id: A.companyId, p_quote_id: quoteIdA,
  });
  const { data: versionsAfterCopy } = await admin.from('crm_quote_versions')
    .select('id, version, status, based_on_version_id').eq('quote_id', quoteIdA).order('version');
  const versionRows = (versionsAfterCopy ?? []) as Array<{ id: string; version: number; status: string; based_on_version_id: string | null }>;
  const { count: copiedItems } = await admin.from('crm_quote_items')
    .select('id', { count: 'exact', head: true }).eq('quote_version_id', (newVersion.data as string | null) ?? NIL);
  check('una modifica successiva crea v2 in bozza e conserva v1 accettata', !newVersion.error
    && versionRows.length === 2 && versionRows[0]?.status === 'accepted'
    && versionRows[1]?.version === 2 && versionRows[1]?.status === 'draft'
    && versionRows[1]?.based_on_version_id === quoteVersionA && copiedItems === 2,
    msg(newVersion.error) || JSON.stringify({ versionRows, copiedItems }));

  // -------------------------------------------------------------------------
  section('18. Cascata — cancellata l’azienda non resta niente');

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
    ['crm_field_definitions', 'company_id'],
    ['crm_field_values', 'company_id'],
    ['crm_opportunity_emails', 'company_id'],
    ['crm_outgoing_email_recipients', 'company_id'],
    ['crm_outgoing_email_attachments', 'company_id'],
    ['crm_email_templates', 'company_id'],
    ['crm_email_template_translations', 'company_id'],
    ['crm_user_email_signatures', 'company_id'],
    ['crm_quotes', 'company_id'],
    ['crm_quote_versions', 'company_id'],
    ['crm_quote_items', 'company_id'],
    ['crm_quote_documents', 'company_id'],
  ];

  await cleanup();

  // ⚠️ DOPO la pulizia, non prima: è il test della cascata E la prova che la
  // pulizia ha davvero pulito. Si esige `!error`: una tabella mancante (per
  // esempio la migrazione non applicata) deve dare ROSSO, non zero righe.
  for (const [table, column] of tables) {
    const { data, error } = await admin.from(table).select('id').eq(column, A.companyId);
    check(`cancellata l’azienda, ${table} non ha residui`,
      !error && ((data ?? []) as unknown[]).length === 0, msg(error));
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
