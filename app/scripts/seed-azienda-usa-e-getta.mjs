// ============================================================================
// UN'AZIENDA USA-E-GETTA CON DENTRO DEI DATI, per poter GUARDARE le schermate.
//
//   node --env-file=.env.test scripts/seed-azienda-usa-e-getta.mjs
//   node --env-file=.env.test scripts/seed-azienda-usa-e-getta.mjs --pulisci <id>
//   node --env-file=.env.test scripts/seed-azienda-usa-e-getta.mjs --elenca
//
// PERCHÉ ESISTE. Il 2026-08-14, entrando in produzione con la sessione vera per
// verificare le pastiglie migrate a `Tag`, quattro moduli su cinque erano
// VUOTI: CRM, Contratti, Automazioni e Incentivi non avevano una riga. Le
// etichette erano in esercizio e non le rendeva nulla. Una suite verde non
// copre quel divario e nemmeno lo vede: si chiude solo mettendo dei dati
// davanti agli occhi.
//
// ⚠️⚠️ SCRIVE NELLA PRODUZIONE. `.env.test` punta al database vero — non esiste
// un ambiente di prova. Perciò:
//   · ogni riga nasce legata a UNA azienda nuova, e nient'altro viene toccato;
//   · la ragione sociale porta il marcatore `ZZ-USA-E-GETTA`, così un residuo
//     si trova con una ricerca sola (`--elenca`);
//   · `--pulisci` cancella l'azienda e poi RILEGGE tabella per tabella: se
//     qualcosa sopravvive, esce 1. Una pulizia che non controlla il proprio
//     esito ha già lasciato aziende di prova in produzione due volte
//     (vedi la testata di `test-crm.ts`).
//
// ⚠️ L'AZIENDA È INTESTATA ALL'UTENTE VERO che la deve guardare, non a un utente
// di prova: le schermate stanno dietro autenticazione, e nessuno può digitare
// la password di qualcun altro. Conseguenza: nel selettore in alto a sinistra
// compare una seconda azienda finché non si esegue `--pulisci`.
//
// ⚠️ CHE COSA NON SEMINA, e non è una dimenticanza: le OPPORTUNITÀ degli
// incentivi. Non sono dati che si scrivono — le produce il motore di
// abbinamento a partire da un progetto e dal catalogo. Qui si seminano i
// progetti e una pratica; le opportunità e i punteggi di pertinenza restano da
// generare, e finché non esistono la scheda con RILEVANZA non si può guardare.
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';

// Node 20 non ha WebSocket nativo e supabase-js lo pretende: senza questa riga
// `createClient` solleva prima ancora di fare una richiesta.
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

const G = '\x1b[32m', R = '\x1b[31m', B = '\x1b[1m', DIM = '\x1b[2m', X = '\x1b[0m';
const MARCA = 'ZZ-USA-E-GETTA';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) {
  console.error(`${R}Mancano SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.${X} Serve --env-file=.env.test`);
  process.exit(3);
}
const admin = createClient(URL, KEY, { auth: { persistSession: false } });

/** Le tabelle che la cancellazione dell'azienda deve svuotare, riga per riga. */
const TABELLE = [
  'company_members', 'company_profiles', 'crm_organizations', 'crm_organization_roles',
  'crm_opportunities', 'contracts', 'workflow_definitions', 'subsidy_projects', 'subsidy_cases',
];

const ok = (e, dove) => { if (e) throw new Error(`${dove}: ${e.message}`); };

async function elenca() {
  const { data, error } = await admin.from('companies').select('id, legal_name, created_at').like('legal_name', `${MARCA}%`);
  ok(error, 'elenco');
  if (!data.length) { console.log(`\n  ${G}Nessuna azienda usa-e-getta nel database.${X}\n`); return; }
  console.log(`\n  ${R}${data.length} azienda/e usa-e-getta ancora presenti:${X}`);
  for (const a of data) console.log(`    ${a.id}  ${a.legal_name}  ${DIM}(${a.created_at})${X}`);
  console.log(`\n  Si rimuovono con --pulisci <id>\n`);
}

async function pulisci(id) {
  const { data: az, error: le } = await admin.from('companies').select('id, legal_name').eq('id', id).maybeSingle();
  ok(le, 'lettura azienda');
  if (!az) { console.error(`${R}Nessuna azienda con id ${id}.${X}`); process.exit(1); }
  // ⚠️ Non si cancella un'azienda che non porta il marcatore: questo script non
  // deve poter distruggere l'azienda vera di nessuno per un id incollato male.
  if (!az.legal_name.startsWith(MARCA)) {
    console.error(`${R}RIFIUTO: «${az.legal_name}» non è un'azienda usa-e-getta.${X}`);
    process.exit(1);
  }
  ok((await admin.from('companies').delete().eq('id', id)).error, 'cancellazione');

  let pulito = true;
  for (const t of TABELLE) {
    const { count, error } = await admin.from(t).select('company_id', { count: 'exact', head: true }).eq('company_id', id);
    if (error) { pulito = false; console.log(`  ${R}✗ ${t}: ${error.message}${X}`); continue; }
    if (count) { pulito = false; console.log(`  ${R}✗ ${t}: restano ${count} righe${X}`); }
    else console.log(`  ${G}✓${X} ${t} ${DIM}vuota${X}`);
  }
  const { data: resta } = await admin.from('companies').select('id').eq('id', id).maybeSingle();
  if (resta) { pulito = false; console.log(`  ${R}✗ l'azienda esiste ancora${X}`); }
  console.log(pulito ? `\n  ${G}Pulizia riuscita: non resta niente.${X}\n` : `\n  ${R}PULIZIA INCOMPLETA.${X}\n`);
  process.exit(pulito ? 0 : 1);
}

async function semina(email) {
  const { data: utenti, error: ue } = await admin.auth.admin.listUsers({ perPage: 200 });
  ok(ue, 'elenco utenti');
  const u = utenti.users.find((x) => x.email === email);
  if (!u) throw new Error(`nessun utente con indirizzo ${email}`);

  const oggi = new Date();
  const giorni = (n) => new Date(oggi.getTime() + n * 86400000).toISOString().slice(0, 10);

  const { data: az, error: ce } = await admin.from('companies')
    .insert({ legal_name: `${MARCA} Verifica Pastiglie SA`, canton: 'Ticino', municipality: 'Lugano', legal_form: 'SA' })
    .select('id').single();
  ok(ce, 'azienda');
  const C = az.id;
  console.log(`\n${B}Azienda creata${X}: ${C}`);

  ok((await admin.from('company_members').insert({ company_id: C, user_id: u.id, role: 'owner' })).error, 'membro');
  ok((await admin.from('company_profiles').insert({ company_id: C, sector: 'Costruzioni', employee_count: 24, revenue_band: '1-5M' })).error, 'profilo');

  // --- CRM. Ruoli e stati DIVERSI di proposito: è l'incoerenza di tono fra
  //     elenco e scheda che si vuole poter guardare.
  const ORG = [
    { nome: 'Bertoli Impianti SA', citta: 'Lugano', cantone: 'TI', ruoli: ['customer'], stato: 'active' },
    { nome: 'Moretti Trasporti Sagl', citta: 'Bellinzona', cantone: 'TI', ruoli: ['supplier'], stato: 'active' },
    { nome: 'Studio Fiduciario Realini', citta: 'Locarno', cantone: 'TI', ruoli: ['partner', 'supplier'], stato: 'active' },
    { nome: 'Comune di Massagno', citta: 'Massagno', cantone: 'TI', ruoli: ['authority'], stato: 'active' },
    { nome: 'Keller Bau AG', citta: 'Zürich', cantone: 'ZH', ruoli: ['lead'], stato: 'inactive' },
  ];
  const org = [];
  for (const o of ORG) {
    const { data, error } = await admin.from('crm_organizations').insert({
      company_id: C, display_name: o.nome, city: o.citta, canton: o.cantone,
      country_code: 'CH', relationship_status: o.stato, source: 'manual',
    }).select('id').single();
    ok(error, `organizzazione ${o.nome}`);
    org.push(data.id);
    for (const r of o.ruoli) {
      ok((await admin.from('crm_organization_roles').insert({ company_id: C, organization_id: data.id, role: r })).error, `ruolo ${r}`);
    }
  }
  // Una col prossimo passo SCADUTO, una SENZA prossimo passo, una vinta: sono i
  // tre casi che nell'elenco clienti portavano tre toni diversi.
  const OPP = [
    { i: 0, titolo: 'Rifacimento impianto elettrico sede', fase: 'negotiation', importo: 48000, passo: 'Inviare offerta rivista', scadenza: giorni(-6), chiusura: giorni(20) },
    { i: 2, titolo: 'Mandato contabile annuale', fase: 'proposal', importo: 12500, passo: null, scadenza: null, chiusura: giorni(45) },
    { i: 1, titolo: 'Contratto trasporti 2027', fase: 'won', importo: 31000, passo: null, scadenza: null, chiusura: giorni(-10) },
  ];
  for (const o of OPP) {
    ok((await admin.from('crm_opportunities').insert({
      company_id: C, organization_id: org[o.i], title: o.titolo, stage: o.fase,
      value_amount: o.importo, value_currency: 'CHF',
      next_step: o.passo, next_step_due_date: o.scadenza, expected_close_date: o.chiusura,
    })).error, `opportunità ${o.titolo}`);
  }

  // --- Contratti: cinque tipi diversi, perché l'etichetta del tipo è una delle
  //     pastiglie migrate.
  const CON = [
    ['Assicurazione responsabilità civile', 'insurance', 'Helvetia Assicurazioni'],
    ['Leasing furgone Iveco', 'leasing', 'Moretti Trasporti Sagl'],
    ['Locazione capannone Via Industria 4', 'rent', 'Immobiliare Ceresio SA'],
    ['Abbonamento gestionale cantiere', 'software_subscription', 'BauSoft AG'],
    ['Accordo di riservatezza Keller Bau', 'nda', 'Keller Bau AG'],
  ];
  for (const [nome, tipo, controparte] of CON) {
    ok((await admin.from('contracts').insert({
      company_id: C, display_name: nome, contract_type: tipo, counterparty_name: controparte,
    })).error, `contratto ${nome}`);
  }

  // --- Automazioni: una ATTIVA e una BOZZA, che sono i due toni diversi.
  // ⚠️ `document_analysis_completed`, non `document_analyzed`: il nome
  // dell'evento è quello dell'enum del database, e il primo tentativo è morto lì.
  const WF = [
    ['Comunicazione amministrativa urgente', 'active', [{ field: 'urgency', op: 'eq', value: 'alta' }]],
    ['Fattura oltre 5000 CHF', 'draft', [{ field: 'amount', op: 'gt', value: 5000 }]],
  ];
  for (const [nome, stato, condizioni] of WF) {
    ok((await admin.from('workflow_definitions').insert({
      company_id: C, name: nome, status: stato, trigger_type: 'document_analysis_completed',
      condition_match: 'all', conditions: condizioni,
      actions: [{ type: 'create_task', priority: stato === 'active' ? 'high' : 'medium' }],
      created_by: u.id, updated_by: u.id,
      activated_at: stato === 'active' ? new Date().toISOString() : null,
    })).error, `automazione ${nome}`);
  }

  // --- Incentivi: i progetti si scrivono, le opportunità no (vedi testata).
  const PRJ = [
    ['Efficienza energetica capannone', 'planned', 180000, ['energy_efficiency']],
    ['Digitalizzazione cantieri', 'idea', 75000, ['digitalisation']],
  ];
  for (const [titolo, fase, budget, tipi] of PRJ) {
    ok((await admin.from('subsidy_projects').insert({
      company_id: C, title: titolo, stage: fase, budget_amount: budget, budget_currency: 'CHF',
      project_types: tipi, location_canton: 'TI', location_country: 'CH', sector: 'Costruzioni',
      owner_user_id: u.id, estimated_start_date: giorni(30), estimated_end_date: giorni(400),
    })).error, `progetto ${titolo}`);
  }
  const { data: prog } = await admin.from('subsidy_programs').select('id, name, authority').limit(1);
  if (prog?.length) {
    ok((await admin.from('subsidy_cases').insert({
      company_id: C, program_id: prog[0].id, program_name: prog[0].name, authority: prog[0].authority,
      status: 'draft', owner_user_id: u.id, created_by: u.id,
      official_deadline: giorni(38), amount_requested: 45000, currency: 'CHF',
    })).error, 'pratica');
  } else {
    console.log(`  ${DIM}nessun programma nel catalogo: la pratica non è stata creata${X}`);
  }

  console.log(`\n  ${G}Seminato.${X} Ora l'azienda compare nel selettore dell'utente ${email}.`);
  console.log(`  ${B}Quando hai finito di guardare${X}: node --env-file=.env.test scripts/seed-azienda-usa-e-getta.mjs --pulisci ${C}\n`);
}

const argv = process.argv.slice(2);
const iPulisci = argv.indexOf('--pulisci');
if (argv.includes('--elenca')) await elenca();
else if (iPulisci >= 0) await pulisci(argv[iPulisci + 1]);
else await semina(argv[0] ?? 'andreacavalieri747@gmail.com');
