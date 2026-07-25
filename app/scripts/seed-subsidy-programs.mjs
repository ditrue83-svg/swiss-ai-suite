// ============================================================================
// Seed del catalogo subsidy_programs (§ dati reali verificati contro le fonti
// ufficiali il 2026-07-25). Dry-run di default; con --write esegue l'upsert.
//   node --env-file=.env.test scripts/seed-subsidy-programs.mjs           (anteprima)
//   node --env-file=.env.test scripts/seed-subsidy-programs.mjs --write   (scrive)
//
// data_status: 'verified' = confermato dalla fonte ufficiale con data;
//              'recheck'   = elementi variabili/da confermare (importi per decreto).
// Ogni riga porta official_source_url + last_checked_at (verificabilità §).
// I match/pratiche esistenti restano compatibili (program_id = slug).
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

const CHECKED = '2026-07-25';
const req = (id, text, question, hard) => ({ id, text, question, hard });
const exc = (id, text, question, triggeringAnswer) => ({ id, text, question, triggeringAnswer, evaluable: !!question });

const PROGRAMS = [
  {
    id: 'innosuisse',
    name: "Innosuisse — Progetti d'innovazione con partner attuatore",
    authority: 'Innosuisse (Agenzia svizzera per la promozione dell’innovazione)',
    support_type: 'grant',
    geography: ['ALL'], target_sectors: ['ALL'], company_size_min: 0, company_size_max: 100000,
    project_types: ['innovazione', 'digitalizzazione'],
    requirements: [
      req('partner', 'Collaborazione con un partner di ricerca svizzero indipendente (università, SUP, PF, istituto)', 'Il progetto prevede una collaborazione con un istituto di ricerca svizzero?', true),
      req('vas', 'Il progetto crea valore aggiunto in Svizzera', 'Il progetto genera valore aggiunto in Svizzera?', true),
      req('innov', 'Contenuto innovativo con potenziale di mercato', 'Il progetto sviluppa un prodotto, servizio o processo nuovo per il mercato?', true),
      req('before', 'Domanda approvata prima dell’avvio del progetto', 'Il progetto NON è ancora iniziato?', true),
      req('fin', 'L’impresa copre il 40–60% dei costi totali (di cui ≥5% in contanti)', 'L’azienda può coprire la propria quota (40–60%) dei costi di progetto?', false),
    ],
    exclusions: [exc('routine', 'Attività di routine senza reale contenuto innovativo', 'Si tratta di un’attività di routine senza reale contenuto innovativo?', 'si')],
    contribution_description: 'Innosuisse finanzia i costi del partner di ricerca; l’impresa (partner attuatore) copre il 40–60% dei costi totali del progetto, di cui almeno il 5% in contanti.',
    application_window: 'Candidature secondo le scadenze trimestrali dell’Innovation Council (almeno 6 settimane prima della riunione).',
    must_apply_before_start: true,
    must_apply_before_start_text: 'L’accordo di finanziamento va concluso PRIMA dell’avvio; il progetto deve iniziare entro 3 mesi dall’entrata in vigore dell’accordo.',
    documents_required: ['Descrizione del progetto e checklist', 'Evidenze del lavoro preliminare (ricerca, analisi di mercato/concorrenza)', 'Accordo con il partner di ricerca', 'Dichiarazione sui diritti di proprietà intellettuale'],
    official_source_url: 'https://www.innosuisse.admin.ch/en/innovation-project-with-implementation-partner',
    source_title: 'Innosuisse — Innovation Projects with Implementation Partner',
    last_checked_at: CHECKED, data_status: 'verified',
  },
  {
    id: 'programma-edifici',
    name: 'Il Programma Edifici — risanamento energetico',
    authority: 'Confederazione + Cantoni',
    support_type: 'grant',
    geography: ['ALL'], target_sectors: ['ALL'], company_size_min: 0, company_size_max: 100000,
    project_types: ['energia', 'edilizia'],
    requirements: [
      req('owner', 'Immobile in Svizzera (di proprietà o in diritto di superficie)', 'L’azienda è proprietaria dell’immobile da risanare (o ne ha il diritto di superficie)?', true),
      req('before', 'Domanda presentata al Cantone PRIMA dell’inizio dei lavori', 'I lavori NON sono ancora iniziati?', true),
      req('measure', 'Intervento ammissibile: isolamento termico dell’involucro o sostituzione del riscaldamento fossile con energie rinnovabili', 'L’intervento riguarda l’isolamento dell’involucro o la sostituzione di un riscaldamento fossile?', true),
    ],
    exclusions: [exc('newbuild', 'Edifici nuovi (sono ammessi solo i risanamenti)', 'Si tratta di un edificio nuovo (e non di un risanamento)?', 'si')],
    contribution_description: 'Contributo per m² di superficie isolata o forfait per impianto. Gli importi variano per Cantone (da confermare sul programma cantonale in vigore).',
    application_window: 'Domanda in ogni momento, sempre prima dell’inizio dei lavori. Consigliato un CECE Plus.',
    must_apply_before_start: true,
    must_apply_before_start_text: 'La domanda va presentata e approvata dal Cantone PRIMA dell’inizio dei lavori, pena la perdita del contributo.',
    documents_required: ['Formulario cantonale', 'Preventivi dei lavori', 'CECE / CECE Plus (se richiesto)', 'Estratto del registro fondiario'],
    official_source_url: 'https://www.ilprogrammaedifici.ch/it/il-programma-edifici/incentivi/',
    source_title: 'Il Programma Edifici — Incentivi',
    last_checked_at: CHECKED, data_status: 'verified',
  },
  {
    id: 'prokilowatt',
    name: 'ProKilowatt — efficienza elettrica nelle imprese',
    authority: 'Confederazione (Ufficio federale dell’energia UFE)',
    support_type: 'grant',
    geography: ['ALL'], target_sectors: ['industria', 'commercio', 'servizi', 'trasporti', 'turismo', 'costruzioni'], company_size_min: 1, company_size_max: 100000,
    project_types: ['energia'],
    requirements: [
      req('save', 'Misure che riducono in modo misurabile il consumo di energia elettrica (LED, motori, refrigerazione, ventilazione…)', 'Il progetto riduce il consumo di energia elettrica in modo misurabile?', true),
      req('before', 'Impegno d’acquisto solo DOPO la conferma del contributo', 'L’investimento NON è ancora stato ordinato o pagato?', true),
      req('notprofitable', 'Misura non redditizia senza il contributo', 'La misura non sarebbe economicamente sostenibile senza il contributo?', false),
    ],
    exclusions: [exc('mandatory', 'Misure già obbligatorie per legge', 'Le misure previste sono già obbligatorie per legge?', 'si')],
    contribution_description: 'Contributo fino al 30% dei costi d’investimento per misure di efficienza elettrica non redditizie, tramite bandi/gare pubbliche periodiche.',
    application_window: 'Bandi (gare competitive) periodici durante l’anno; candidatura al bando aperto.',
    must_apply_before_start: true,
    must_apply_before_start_text: 'L’impegno d’acquisto deve avvenire solo DOPO la conferma del contributo.',
    documents_required: ['Descrizione delle misure', 'Calcolo del risparmio elettrico', 'Preventivi'],
    official_source_url: 'https://www.prokw.ch/it/',
    source_title: 'ProKilowatt (UFE) — programma d’incentivazione',
    last_checked_at: CHECKED, data_status: 'verified',
  },
  {
    id: 'pronovo',
    name: 'Pronovo — Rimunerazione unica per impianti fotovoltaici',
    authority: 'Confederazione (Pronovo AG)',
    support_type: 'reimbursement',
    geography: ['ALL'], target_sectors: ['ALL'], company_size_min: 0, company_size_max: 100000,
    project_types: ['energia', 'edilizia'],
    requirements: [
      req('pv', 'Impianto fotovoltaico nuovo collegato alla rete in Svizzera', 'Si tratta di un impianto fotovoltaico nuovo collegato alla rete?', true),
      req('procedure', 'Notifica e domanda secondo la procedura Pronovo dopo la messa in servizio', 'L’impianto è (o sarà) messo in servizio e notificato secondo la procedura Pronovo?', true),
    ],
    exclusions: [],
    contribution_description: 'Rimunerazione unica: contributo base + contributo per kW installato. Categorie RUP (<100 kW), RUG (>100 kW), RUE elevata (fino al 60% dei costi di riferimento per impianti ≥150 kW senza consumo proprio).',
    application_window: 'Domanda dopo la messa in servizio, secondo la procedura Pronovo (nessuna domanda preventiva obbligatoria).',
    must_apply_before_start: false,
    must_apply_before_start_text: null,
    documents_required: ['Certificato di collaudo', 'Dati dell’impianto', 'Coordinate bancarie'],
    official_source_url: 'https://pronovo.ch/it/incentivazione/rimunerazione-unica-ru/',
    source_title: 'Pronovo — Rimunerazione unica (RU) fotovoltaico',
    last_checked_at: CHECKED, data_status: 'verified',
  },
  {
    id: 'ti-linn',
    name: 'Ticino — Legge per l’innovazione economica (LInn)',
    authority: 'Cantone Ticino (Ufficio per lo sviluppo economico, DFE)',
    support_type: 'grant',
    geography: ['Ticino'], target_sectors: ['industria', 'ict', 'servizi'], company_size_min: 3, company_size_max: 100000,
    project_types: ['innovazione', 'digitalizzazione', 'export'],
    requirements: [
      req('sede', 'Sede o attività economica in Ticino', 'L’azienda ha sede o attività economica in Ticino?', true),
      req('fte', 'Almeno 5 FTE (procedura ordinaria) o 3 FTE (procedura semplificata: mandati ricerca, progetti Innosuisse, internazionalizzazione, fiere, coaching start-up)', 'L’azienda ha almeno 3-5 dipendenti a tempo pieno (FTE) secondo la procedura?', true),
      req('salary', 'Almeno il 60% dei dipendenti (esclusi apprendisti) con salario base ≥ CHF 32/ora e parità salariale', 'Almeno il 60% dei dipendenti percepisce un salario base ≥ CHF 32/ora, con parità salariale?', true),
      req('innov', 'Progetto di innovazione di prodotto/processo, o internazionalizzazione', 'Il progetto introduce un’innovazione di prodotto/processo o un’internazionalizzazione?', true),
      req('before', 'Domanda prima dell’esecuzione/deliberazione degli investimenti', 'Il progetto/investimento NON è ancora stato avviato o deliberato?', true),
    ],
    exclusions: [exc('pure-commercial', 'Attività puramente commerciali senza componente innovativa', 'Si tratta di un’attività puramente commerciale, senza componente innovativa?', 'si')],
    contribution_description: 'Contributo a fondo perso sull’investimento ammissibile; entità e aliquote definite dal decreto esecutivo del Consiglio di Stato in vigore (da confermare).',
    application_window: 'Domanda in ogni momento, prima dell’avvio del progetto/investimento.',
    must_apply_before_start: true,
    must_apply_before_start_text: 'La richiesta va presentata PRIMA di ordini, contratti, inizio lavori o altri atti che creano obblighi.',
    documents_required: ['Business plan / descrizione progetto', 'Ultimi due bilanci', 'Preventivi', 'Estratto del registro di commercio'],
    official_source_url: 'https://www4.ti.ch/dfe/de/use/misure-di-sostegno/legge-per-linnovazione-economica/legge-per-linnovazione-economica',
    source_title: 'Ticino — Legge per l’innovazione economica (USE, DFE)',
    last_checked_at: CHECKED, data_status: 'recheck',
  },
  {
    id: 'ti-fer',
    name: 'Ticino — Fondo per le energie rinnovabili (FER)',
    authority: 'Cantone Ticino',
    support_type: 'grant',
    geography: ['Ticino'], target_sectors: ['ALL'], company_size_min: 0, company_size_max: 100000,
    project_types: ['energia', 'edilizia', 'mobilita'],
    requirements: [
      req('territory', 'Intervento realizzato in Ticino, da ditta/impresa con sede in Svizzera', 'L’intervento è realizzato in Ticino da un’impresa con sede in Svizzera?', true),
      req('eligible', 'Tipologia sostenuta dal FER (fotovoltaico, pompe di calore, ecc.) secondo i decreti in vigore', 'L’intervento rientra nelle tipologie sostenute dal FER in vigore?', true),
    ],
    exclusions: [],
    contribution_description: 'Contributi cantonali secondo il Regolamento FER e i decreti in vigore (importi per kW / impianto). NB: dal 01.01.2024 la notifica preliminare per il fotovoltaico è stata abolita; per le pompe di calore ≥200 kW il formulario va inoltrato entro 2 mesi dalla fattura. Condizioni variabili: da confermare sul decreto attuale.',
    application_window: 'Secondo i decreti in vigore; per alcuni interventi la domanda può avvenire anche dopo (verificare la tipologia specifica).',
    must_apply_before_start: false,
    must_apply_before_start_text: 'Le regole variano per tipologia: per diversi interventi (incl. FV dal 2024) non è più richiesta la domanda preventiva; verificare il decreto per il proprio caso.',
    documents_required: ['Formulario cantonale', 'Preventivi / fattura', 'Documentazione tecnica dell’impianto'],
    official_source_url: 'https://www4.ti.ch/dfe/dr/ue/politica-energetica/incentivi',
    source_title: 'Ticino — Incentivi energetici / Fondo energie rinnovabili (FER)',
    last_checked_at: CHECKED, data_status: 'recheck',
  },
  {
    id: 'ti-lrilocc',
    name: 'Ticino — Incentivo all’assunzione di disoccupati (L-Rilocc)',
    authority: 'Cantone Ticino (Sezione del lavoro / URC)',
    support_type: 'grant',
    geography: ['Ticino'], target_sectors: ['ALL'], company_size_min: 1, company_size_max: 100000,
    project_types: ['assunzioni'],
    requirements: [
      req('urc', 'Assunzione di una persona disoccupata iscritta al servizio pubblico di collocamento (URC)', 'La persona da assumere è iscritta a un URC (servizio pubblico di collocamento)?', true),
      req('rate', 'Tasso di disoccupazione dell’anno precedente ≥ tasso di riferimento fissato dal Consiglio di Stato', 'Il contesto rientra nei criteri (tasso di disoccupazione di riferimento) fissati dal Cantone?', false),
      req('nolayoff', 'Nessun licenziamento/soppressione di posti per motivi economici nei 12 mesi precedenti; rispetto dei CCL', 'L’azienda non ha operato licenziamenti economici negli ultimi 12 mesi e rispetta i CCL/CNL?', true),
    ],
    exclusions: [exc('replace', 'Sostituzione di personale licenziato per creare il posto sussidiato', 'Il posto sostituisce personale licenziato di recente?', 'si')],
    contribution_description: 'Aiuto finanziario pari al 100% degli oneri sociali a carico del datore (AVS/AI/IPG/AD/LPP obbligatoria), per la durata effettiva del rapporto, al massimo 12 mesi. Erogato dopo che il rapporto è durato almeno il doppio del periodo sussidiato.',
    application_window: 'Prima dell’inizio del rapporto di lavoro.',
    must_apply_before_start: true,
    must_apply_before_start_text: 'La richiesta va inoltrata PRIMA dell’assunzione: contratti già iniziati non sono incentivabili.',
    documents_required: ['Formulario di richiesta', 'Bozza del contratto di lavoro', 'Profilo del candidato / iscrizione URC'],
    official_source_url: 'https://www4.ti.ch/dfe/de/sdl/servizio-aziende-urc/',
    source_title: 'Ticino — Servizio aziende URC / L-Rilocc (857.100)',
    last_checked_at: CHECKED, data_status: 'recheck',
  },
];

const { SUPABASE_URL: U, SUPABASE_SERVICE_ROLE_KEY: S } = process.env;
const admin = createClient(U, S, { auth: { persistSession: false, autoRefreshToken: false } });
const WRITE = process.argv.includes('--write');

console.log(`\nCatalogo programmi (${PROGRAMS.length}) — ${WRITE ? 'SCRITTURA' : 'ANTEPRIMA (dry-run)'}\n`);
for (const p of PROGRAMS) {
  console.log(`  [${p.data_status.toUpperCase().padEnd(8)}] ${p.id.padEnd(18)} ${p.name}`);
  console.log(`             ${p.requirements.length} requisiti · ${p.exclusions.length} esclusioni · ${p.official_source_url}`);
}

if (!WRITE) { console.log('\n(dry-run — rilancia con --write per scrivere sul DB)\n'); process.exit(0); }

let ok = 0, fail = 0;
for (const p of PROGRAMS) {
  const row = {
    id: p.id, name: p.name, authority: p.authority, support_type: p.support_type,
    geography: p.geography, target_sectors: p.target_sectors,
    company_size_min: p.company_size_min, company_size_max: p.company_size_max,
    project_types: p.project_types, requirements: p.requirements, exclusions: p.exclusions,
    contribution_description: p.contribution_description, application_window: p.application_window,
    must_apply_before_start: p.must_apply_before_start, must_apply_before_start_text: p.must_apply_before_start_text,
    documents_required: p.documents_required, official_source_url: p.official_source_url,
    source_title: p.source_title, last_checked_at: p.last_checked_at, data_status: p.data_status, active: true,
  };
  const { error } = await admin.from('subsidy_programs').upsert(row, { onConflict: 'id' });
  if (error) { fail++; console.log(`  ✗ ${p.id}: ${error.message}`); } else { ok++; }
}
console.log(`\n${ok} scritti, ${fail} falliti\n`);
process.exit(fail ? 1 : 0);
