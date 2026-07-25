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
      req('fte', 'Almeno 5 ETP (procedura ordinaria) o 3 ETP (procedura agevolata: mandati ricerca, progetti Innosuisse, internazionalizzazione, fiere, coaching start-up). Soglie in vigore dal 1° gennaio 2024', 'L’azienda ha almeno 3-5 dipendenti a tempo pieno (ETP) secondo la procedura?', true),
      req('salary', 'Almeno il 60% dei dipendenti in ETP (esclusi apprendisti) con salario orario di base ≥ CHF 32.00. Soglia ridotta a CHF 24.00 per le aziende del settore primario e per quelle industriali assoggettate alla legge federale sul lavoro; per le aziende agricole vale il minimo della legge cantonale sul salario minimo', 'Almeno il 60% dei dipendenti percepisce il salario orario di base minimo previsto per il proprio settore (CHF 32.00, oppure CHF 24.00 per primario e industria)?', true),
      // Decreto esecutivo distinto da quello salariale: è un requisito di
      // accesso a sé stante, non un dettaglio del criterio salariale.
      req('residenti', 'Almeno il 60% del personale in ETP (apprendisti inclusi) residente in Svizzera. I dipendenti assoggettati all’imposta alla fonte non residenti al 31 dicembre contano come non residenti per tutto l’anno', 'Almeno il 60% del personale (apprendisti inclusi) è residente in Svizzera?', true),
      req('parita', 'Parità salariale verificata con lo strumento LOGIB della Confederazione (modulo 1 da 50 dipendenti, modulo 2 sotto i 50)', 'L’azienda rispetta la parità salariale secondo metodi conformi al diritto (LOGIB)?', true),
      req('innov', 'Progetto di innovazione di prodotto/processo, o internazionalizzazione', 'Il progetto introduce un’innovazione di prodotto/processo o un’internazionalizzazione?', true),
      req('before', 'Domanda prima dell’esecuzione/deliberazione degli investimenti', 'Il progetto/investimento NON è ancora stato avviato o deliberato?', true),
      // Non è una condizione per ottenere il sussidio ma per non doverlo
      // restituire: va detto prima, non dopo.
      req('impegno', 'Impegno pluriennale: i criteri salariali e di occupazione residente vanno rispettati per 5 anni dalla decisione (2 anni per la procedura agevolata), con autocertificazione annuale all’UAC. L’inosservanza comporta la revoca e la restituzione integrale dei sussidi', 'L’azienda può garantire il rispetto dei criteri per i 5 anni successivi (2 per la procedura agevolata)?', false),
    ],
    exclusions: [exc('pure-commercial', 'Attività puramente commerciali senza componente innovativa', 'Si tratta di un’attività puramente commerciale, senza componente innovativa?', 'si')],
    contribution_description: 'Contributo a fondo perso sull’investimento ammissibile; entità e aliquote definite dai decreti esecutivi del Consiglio di Stato in vigore. Ambiti sostenuti: coaching start-up, mandati a centri di ricerca, progetti Innosuisse, programmi di ricerca internazionali, investimenti immateriali (R&S, consulenza per l’innovazione), investimenti materiali (macchinari innovativi, digitalizzazione), sgravi fiscali, internazionalizzazione e fiere.',
    application_window: 'Domanda in ogni momento, prima dell’avvio del progetto/investimento.',
    must_apply_before_start: true,
    must_apply_before_start_text: 'La richiesta va presentata PRIMA di ordini, contratti, inizio lavori o altri atti che creano obblighi.',
    documents_required: ['Business plan / descrizione progetto', 'Ultimi due bilanci', 'Preventivi', 'Estratto del registro di commercio', 'Analisi LOGIB sulla parità salariale', 'Calcolo ETP per i criteri di salario e residenza'],
    official_source_url: 'https://www4.ti.ch/dfe/de/use/misure-di-sostegno/legge-per-linnovazione-economica/legge-per-linnovazione-economica',
    source_title: 'Ticino — LInn (RL 900.100), decreti esecutivi su criteri salariali e occupazione residente (ultima modifica 6 febbraio 2026, BU 25/2026)',
    last_checked_at: CHECKED, data_status: 'verified',
  },
  {
    id: 'ti-fer',
    name: 'Ticino — Fondo per le energie rinnovabili (FER)',
    authority: 'Cantone Ticino',
    support_type: 'grant',
    geography: ['Ticino'], target_sectors: ['ALL'], company_size_min: 0, company_size_max: 100000,
    // NB: il FER finanzia la PRODUZIONE DI ENERGIA ELETTRICA da fonti
    // rinnovabili. Il calore (pompe di calore, isolamento) NON rientra qui ma
    // nel Programma Edifici, già a catalogo: 'edilizia' e 'mobilita' sono stati
    // rimossi perché portavano l'utente sul programma sbagliato.
    project_types: ['energia'],
    requirements: [
      req('territory', 'Impianto realizzato in Ticino', 'L’impianto è realizzato in Ticino?', true),
      req('eligible', 'Produzione di energia elettrica da fonte rinnovabile: fotovoltaico (principale), idroelettrico, eolico, geotermia, biomassa. Il FER sostiene inoltre studi, consulenze e progetti di ricerca sull’efficienza energetica', 'L’intervento produce energia elettrica da fonte rinnovabile (o è uno studio/consulenza in ambito energetico)?', true),
      // La regola cambia per tecnologia: dirlo come requisito, non nasconderlo
      // in una nota, perché sbagliarlo fa perdere il contributo.
      req('notifica', 'Per le tecnologie diverse dal fotovoltaico (idroelettrico, eolico, geotermia, biomassa) la notifica preliminare PRIMA dell’inizio dei lavori resta obbligatoria. Per il fotovoltaico entrato in esercizio dal 1° gennaio 2024 la notifica preliminare è stata abolita', 'Se l’impianto NON è fotovoltaico: la notifica preliminare è stata inoltrata prima dell’inizio dei lavori?', false),
    ],
    exclusions: [exc('calore', 'Interventi sul calore (pompe di calore, isolamento termico, sostituzione del riscaldamento): rientrano nel Programma Edifici, non nel FER', 'L’intervento riguarda il riscaldamento o l’isolamento dell’edificio anziché la produzione di energia elettrica?', 'si')],
    contribution_description: 'Contributo unico all’investimento (CU-FER) secondo il Regolamento FER (RL 741.260) e i decreti in vigore. Dal 1° gennaio 2026 il RFER prevede inoltre una rimunerazione minima per l’energia immessa in rete dagli impianti fotovoltaici incentivati (4.0 ct./kWh sotto i 30 kW; 5.0 ct./kWh fra 30 e 150 kW senza autoconsumo; fra 30 e 150 kW con autoconsumo il valore segue il prezzo medio di mercato trimestrale) e la possibilità di aderire a una Comunità locale di energia (CLE). Gli importi del contributo variano per potenza e tecnologia: verificare il decreto in vigore.',
    application_window: 'Fotovoltaico dal 1° gennaio 2024: nessuna notifica preliminare, domanda dopo la messa in esercizio. Altre tecnologie: notifica preliminare obbligatoria prima dell’inizio dei lavori.',
    must_apply_before_start: false,
    must_apply_before_start_text: 'Dipende dalla tecnologia: per il fotovoltaico dal 2024 non serve più la notifica preliminare; per idroelettrico, eolico, geotermia e biomassa resta obbligatoria prima dell’inizio dei lavori.',
    documents_required: ['Formulario FER (sportello online)', 'Fattura finale e documentazione tecnica dell’impianto', 'Notifica preliminare, per le tecnologie che la richiedono'],
    official_source_url: 'https://www4.ti.ch/generale/fer/fondo-energie-rinnovabili-fer',
    source_title: 'Ticino — Fondo per le energie rinnovabili (FER), Regolamento RFER RL 741.260, modifiche in vigore dal 1° gennaio 2026',
    last_checked_at: CHECKED, data_status: 'verified',
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
      // La condizione sul tasso NON è più un requisito da porre all'utente:
      // non riguarda la sua azienda e non può conoscerla. È una condizione di
      // sistema, e vive in `availability` (0011).
      req('nolayoff', 'Nessun licenziamento/soppressione di posti per motivi economici nei 12 mesi precedenti; rispetto dei CCL', 'L’azienda non ha operato licenziamenti economici negli ultimi 12 mesi e rispetta i CCL/CNL?', true),
      req('durata', 'Il rapporto di lavoro deve durare almeno il doppio del periodo sussidiato: l’aiuto viene erogato solo a quel punto', 'Il rapporto di lavoro è previsto per una durata pari ad almeno il doppio del periodo sussidiato?', false),
    ],
    exclusions: [
      exc('replace', 'Sostituzione di personale licenziato per creare il posto sussidiato', 'Il posto sostituisce personale licenziato di recente?', 'si'),
      exc('lavoro-ridotto', 'Aziende in periodo di lavoro ridotto', 'L’azienda è attualmente in regime di lavoro ridotto?', 'si'),
    ],
    contribution_description: 'Aiuto finanziario pari al 100% degli oneri sociali a carico del datore (AVS/AI/IPG/AD/LPP obbligatoria), calcolato al massimo sul guadagno assicurato massimo LADI, per la durata effettiva del rapporto e al massimo 12 mesi. Erogato dopo che il rapporto è durato almeno il doppio del periodo sussidiato.',
    application_window: 'Prima dell’inizio del rapporto di lavoro.',
    must_apply_before_start: true,
    must_apply_before_start_text: 'La richiesta va inoltrata PRIMA dell’assunzione: contratti già iniziati non sono incentivabili.',
    documents_required: ['Formulario di richiesta', 'Bozza del contratto di lavoro', 'Profilo del candidato / iscrizione URC'],
    official_source_url: 'https://m3.ti.ch/CAN/RLeggi/public/index.php/raccolta-leggi/legge/num/576',
    source_title: 'Ticino — Legge sul rilancio dell’occupazione e sul sostegno ai disoccupati (L-rilocc, RL 857.100), art. 3',
    last_checked_at: CHECKED, data_status: 'verified',
    // 0011 — esiste ed è documentato, ma oggi non è concedibile.
    availability: 'suspended',
    availability_note: 'L’art. 3 L-rilocc subordina la misura a un tasso di disoccupazione medio dell’anno civile precedente pari almeno al tasso di riferimento fissato dal Consiglio di Stato, con massimale del 4%. Il tasso ticinese è sotto tale soglia, quindi l’incentivo non viene concesso. Tornerà disponibile se la disoccupazione risalirà: vale la pena riverificarlo a inizio anno.',
    availability_source_url: 'https://www4.ti.ch/dfe/de/sdl/personein-cerca-dimpiego/panoramica-delle-misure-di-sostegno',
    availability_checked_at: CHECKED,
  },
];

const { SUPABASE_URL: U, SUPABASE_SERVICE_ROLE_KEY: S } = process.env;
const admin = createClient(U, S, { auth: { persistSession: false, autoRefreshToken: false } });
const WRITE = process.argv.includes('--write');

console.log(`\nCatalogo programmi (${PROGRAMS.length}) — ${WRITE ? 'SCRITTURA' : 'ANTEPRIMA (dry-run)'}\n`);
for (const p of PROGRAMS) {
  const susp = p.availability === 'suspended' ? '  ⚠ SOSPESO' : '';
  console.log(`  [${p.data_status.toUpperCase().padEnd(8)}] ${p.id.padEnd(18)} ${p.name}${susp}`);
  console.log(`             ${p.requirements.length} requisiti · ${p.exclusions.length} esclusioni · ${p.official_source_url}`);
  if (susp) console.log(`             ${p.availability_note.slice(0, 100)}…`);
}

// Un programma dichiarato sospeso senza motivo non è verificabile: meglio
// fermarsi che scrivere uno stato che l'utente non può controllare.
const badSuspended = PROGRAMS.filter((p) => p.availability === 'suspended' && !(p.availability_note && p.availability_source_url));
if (badSuspended.length) {
  console.error(`\nSospensione senza motivo o senza fonte: ${badSuspended.map((p) => p.id).join(', ')}\n`);
  process.exit(2);
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
    // 0011 — disponibilità: i programmi senza dichiarazione esplicita sono
    // 'available', e i campi di sospensione vengono azzerati, così un programma
    // che torna disponibile non conserva la vecchia motivazione.
    availability: p.availability ?? 'available',
    availability_note: p.availability_note ?? null,
    availability_source_url: p.availability_source_url ?? null,
    availability_checked_at: p.availability_checked_at ?? null,
  };
  const { error } = await admin.from('subsidy_programs').upsert(row, { onConflict: 'id' });
  if (error) { fail++; console.log(`  ✗ ${p.id}: ${error.message}`); } else { ok++; }
}
console.log(`\n${ok} scritti, ${fail} falliti\n`);
process.exit(fail ? 1 : 0);
