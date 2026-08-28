// ============================================================================
// Seed del CATALOGO 2.0 — fonti ufficiali, versioni, criteri tipizzati, call.
//   node --env-file=.env.test scripts/seed-subsidy-catalog.mjs           (anteprima)
//   node --env-file=.env.test scripts/seed-subsidy-catalog.mjs --write   (scrive)
//
// ⚠️ NON SOSTITUISCE `seed-subsidy-programs.mjs`, lo COMPLETA. Quello scrive
// l'identità dei programmi (nome, autorità, geografia, fonte); questo scrive
// ciò che il modulo 1.0 non aveva: la FONTE come record controllabile, la
// VERSIONE dei requisiti, i CRITERI come struttura tipizzata e le CALL.
//
// ⚠️ I CRITERI NON SONO INVENTATI: derivano uno per uno dai `requirements` e
// dalle `exclusions` già a catalogo, verificati contro le fonti ufficiali il
// 2026-07-25 e ricontrollati il 2026-07-30. Ciò che cambia è la FORMA — da
// domanda in testo a struttura con fatto, operatore e valore atteso — e la
// conseguenza è che alcuni criteri diventano valutabili senza chiedere niente
// a nessuno.
//
// ⚠️ DOVE UN CRITERIO NON È RIDUCIBILE A UN FATTO, RESTA UNA DOMANDA. Non si
// forza un `fact_key` per far sembrare automatico ciò che non lo è: un criterio
// valutato su un fatto che non lo esprime davvero è peggio di un criterio che
// chiede.
// ============================================================================
import WebSocket from 'ws';
import { createClient } from '@supabase/supabase-js';
if (!globalThis.WebSocket) globalThis.WebSocket = WebSocket;

const CHECKED = '2026-07-30';

// ---------------------------------------------------------------------------
// Le fonti ufficiali
//
// ⚠️ `allowed_host` è il perimetro della guardia: la richiesta non esce da lì,
//    nemmeno dopo un redirect. Ogni host è anche nell'allowlist di
//    `_shared/subsidy/fetchGuard.ts`, e senza quella riga la fonte viene
//    bloccata — due elenchi di proposito, perché il primo dice «questa fonte
//    sta qui» e il secondo «questo dominio è di un'autorità».
// ---------------------------------------------------------------------------
const SOURCES = [
  {
    key: 'innosuisse-impl',
    authority: 'Innosuisse',
    source_type: 'official_program_page',
    canonical_url: 'https://www.innosuisse.admin.ch/en/innovation-project-with-implementation-partner',
    allowed_host: 'admin.ch',
    locale: 'en', jurisdiction: 'CH', adapter_key: 'ch-official-html',
    check_frequency_days: 14, criticality: 'high',
    program_id: 'innosuisse',
  },
  {
    key: 'programma-edifici',
    authority: 'Confederazione e Cantoni',
    source_type: 'official_program_page',
    canonical_url: 'https://www.ilprogrammaedifici.ch/it/il-programma-edifici/incentivi/',
    allowed_host: 'ilprogrammaedifici.ch',
    locale: 'it', jurisdiction: 'CH', adapter_key: 'ch-official-html',
    check_frequency_days: 30, criticality: 'normal',
    program_id: 'programma-edifici',
  },
  {
    key: 'prokilowatt',
    authority: 'Ufficio federale dell’energia (UFE)',
    source_type: 'official_call_page',
    canonical_url: 'https://www.prokw.ch/it/',
    allowed_host: 'prokw.ch',
    locale: 'it', jurisdiction: 'CH', adapter_key: 'ch-official-html',
    // ⚠️ Sette giorni: qui si candida a BANDI, e un bando aperto e non visto
    //    è una candidatura persa. È la frequenza più alta del catalogo.
    check_frequency_days: 7, criticality: 'critical',
    program_id: 'prokilowatt',
  },
  {
    key: 'pronovo-ru',
    authority: 'Pronovo AG',
    source_type: 'official_program_page',
    canonical_url: 'https://pronovo.ch/it/incentivazione/rimunerazione-unica-ru/',
    allowed_host: 'pronovo.ch',
    locale: 'it', jurisdiction: 'CH', adapter_key: 'ch-official-html',
    check_frequency_days: 30, criticality: 'high',
    program_id: 'pronovo',
  },
  {
    key: 'ti-linn',
    authority: 'Cantone Ticino — Ufficio per lo sviluppo economico',
    source_type: 'official_program_page',
    canonical_url: 'https://www4.ti.ch/dfe/de/use/misure-di-sostegno/legge-per-linnovazione-economica/legge-per-linnovazione-economica',
    allowed_host: 'ti.ch',
    locale: 'it', jurisdiction: 'TI', adapter_key: 'ch-official-html',
    check_frequency_days: 30, criticality: 'high',
    program_id: 'ti-linn',
  },
  {
    key: 'ti-fer',
    authority: 'Cantone Ticino',
    source_type: 'official_program_page',
    canonical_url: 'https://www4.ti.ch/generale/fer/fondo-energie-rinnovabili-fer',
    allowed_host: 'ti.ch',
    locale: 'it', jurisdiction: 'TI', adapter_key: 'ch-official-html',
    check_frequency_days: 30, criticality: 'normal',
    program_id: 'ti-fer',
  },
  {
    key: 'ti-lrilocc',
    authority: 'Cantone Ticino — Sezione del lavoro',
    // ⚠️ È una LEGGE: cambia di rado, e la sua disponibilità dipende da una
    //    statistica annuale — che si controlla altrove, sulla pagina delle
    //    misure di sostegno.
    source_type: 'official_law',
    canonical_url: 'https://m3.ti.ch/CAN/RLeggi/public/index.php/raccolta-leggi/legge/num/576',
    allowed_host: 'ti.ch',
    locale: 'it', jurisdiction: 'TI', adapter_key: 'ch-official-html',
    check_frequency_days: 180, criticality: 'normal',
    program_id: 'ti-lrilocc',
  },
];

// ---------------------------------------------------------------------------
// I criteri, per programma.
//
// LEGENDA
//   hardness      hard = obbligatorio · soft = non bloccante · exclusion = esclude
//                 informative = limite dichiarato, non valutabile
//   evaluability  auto = dai fatti · question = serve una risposta · manual = si
//                 verifica sulla fonte
//
// ⚠️ I criteri `auto` sono quelli che il modulo 1.0 chiedeva e che ora non
//    servono più: il cantone, la dimensione, lo stadio del progetto sono già
//    nel prodotto. È qui che «verifica i criteri» smette di essere un
//    questionario e diventa una risposta.
// ---------------------------------------------------------------------------
const r = (rule_key, label, over = {}) => ({
  rule_key, label, fact_key: null, operator: null, expected_value: null,
  hardness: 'hard', evaluability: 'question', question: null,
  source_evidence: null, notes: null, ...over,
});

const evidence = (url, quote, language = 'it') => ({
  quote, url, language, section: null, page: null, checkedAt: CHECKED, snapshotId: null,
});

const RULES = {
  innosuisse: [
    r('partner', 'Collaborazione con un partner di ricerca svizzero indipendente', {
      fact_key: 'project.has_research_partner', operator: 'equals', expected_value: true,
      evaluability: 'auto',
      question: 'Il progetto prevede una collaborazione con un istituto di ricerca svizzero?',
      source_evidence: evidence(SOURCES[0].canonical_url,
        'The research partner must be based at a Swiss research institution', 'en'),
    }),
    r('before', 'Domanda approvata prima dell’avvio del progetto', {
      fact_key: 'project.not_started', operator: 'equals', expected_value: true,
      evaluability: 'auto',
      question: 'Il progetto NON è ancora iniziato?',
      source_evidence: evidence(SOURCES[0].canonical_url,
        'the project must start within 3 months of the funding agreement coming into force', 'en'),
    }),
    r('vas', 'Il progetto crea valore aggiunto in Svizzera', {
      question: 'Il progetto genera valore aggiunto in Svizzera?',
      source_evidence: evidence(SOURCES[0].canonical_url,
        'The implementation organisation must create added value in Switzerland', 'en'),
    }),
    r('innov', 'Contenuto innovativo con potenziale di mercato', {
      question: 'Il progetto sviluppa un prodotto, servizio o processo nuovo per il mercato?',
      source_evidence: evidence(SOURCES[0].canonical_url,
        'Innovation projects with implementation partners', 'en'),
    }),
    r('fin', 'L’impresa copre il 40–60% dei costi totali, di cui almeno il 5% in contanti', {
      hardness: 'soft',
      question: 'L’azienda può coprire la propria quota (40–60%) dei costi di progetto?',
      source_evidence: evidence(SOURCES[0].canonical_url,
        'the project costs incurred by your company in the amount of 40–60% of total project costs', 'en'),
    }),
    r('routine', 'Attività di routine senza reale contenuto innovativo', {
      hardness: 'exclusion',
      question: 'Si tratta di un’attività di routine senza reale contenuto innovativo?',
    }),
  ],
  'programma-edifici': [
    r('owner', 'Immobile in Svizzera di proprietà o in diritto di superficie', {
      fact_key: 'company.owns_property', operator: 'equals', expected_value: true,
      evaluability: 'auto',
      question: 'L’azienda è proprietaria dell’immobile da risanare?',
    }),
    r('before', 'Domanda presentata al Cantone PRIMA dell’inizio dei lavori', {
      fact_key: 'project.not_started', operator: 'equals', expected_value: true,
      evaluability: 'auto',
      question: 'I lavori NON sono ancora iniziati?',
      source_evidence: evidence(SOURCES[1].canonical_url,
        'La domanda va presentata prima dell’inizio dei lavori'),
    }),
    r('measure', 'Intervento ammissibile: isolamento dell’involucro, sostituzione del riscaldamento, risanamento completo o nuova costruzione Minergie-P', {
      question: 'L’intervento rientra fra quelli ammessi (isolamento, sostituzione del riscaldamento, risanamento completo o nuova costruzione Minergie-P)?',
    }),
    r('amounts', 'Gli importi variano per Cantone e si leggono sul programma cantonale in vigore', {
      hardness: 'informative', evaluability: 'manual',
    }),
    // ⚠️ L'esclusione NON è «edificio nuovo» in assoluto: dal confronto manuale
    //    del 2026-08-28 la pagina ufficiale ammette le nuove costruzioni in
    //    standard Minergie-P. Escluso è ciò che è nuovo E fuori standard.
    r('newbuild', 'Nuove costruzioni: ammesse solo nello standard Minergie-P', {
      hardness: 'exclusion',
      question: 'Si tratta di una nuova costruzione fuori dallo standard Minergie-P?',
      source_evidence: evidence(SOURCES[1].canonical_url,
        'Sono sostenuti isolamento dell’involucro, sostituzione dei riscaldamenti fossili o elettrici, risanamenti completi o in fasi e nuove costruzioni in standard Minergie-P'),
    }),
  ],
  prokilowatt: [
    r('save', 'Misure che riducono in modo misurabile il consumo di energia elettrica', {
      question: 'Il progetto riduce il consumo di energia elettrica in modo misurabile?',
    }),
    r('before', 'Impegno d’acquisto solo DOPO la conferma del contributo', {
      fact_key: 'project.not_started', operator: 'equals', expected_value: true,
      evaluability: 'auto',
      question: 'L’investimento NON è ancora stato ordinato o pagato?',
    }),
    r('size', 'Impresa con almeno un dipendente', {
      fact_key: 'company.employee_count', operator: 'greater_or_equal', expected_value: 1,
      evaluability: 'auto', hardness: 'soft',
    }),
    r('notprofitable', 'Misura non redditizia senza il contributo', {
      hardness: 'soft',
      question: 'La misura non sarebbe economicamente sostenibile senza il contributo?',
    }),
    r('mandatory', 'Misure già obbligatorie per legge', {
      hardness: 'exclusion',
      question: 'Le misure previste sono già obbligatorie per legge?',
    }),
  ],
  pronovo: [
    r('pv', 'Impianto fotovoltaico nuovo collegato alla rete in Svizzera', {
      question: 'Si tratta di un impianto fotovoltaico nuovo collegato alla rete?',
    }),
    r('procedure', 'Notifica e domanda secondo la procedura Pronovo dopo la messa in servizio', {
      question: 'L’impianto è (o sarà) messo in servizio e notificato secondo la procedura Pronovo?',
    }),
    // ⚠️ CRITERIO INFORMATIVO E NON VALUTABILE. La divergenza del 2026-07-30
    //    sulla soglia della RUE (2–149,99 kW contro ≥150 kW) è stata verificata
    //    a mano il 2026-08-28: ERANO VERE TUTTE E DUE, perché la RUE esiste in
    //    due forme — senz'aste (2–149,99 kW) e tramite aste (≥150 kW, fino al
    //    60% dei costi di riferimento). Resta `manual` perché la potenza
    //    dell'impianto non è un fatto del fascicolo: la categoria si legge
    //    sulla fonte, non si deduce.
    r('categoria', 'La categoria dipende dalla potenza: RUP <100 kW, RUG >100 kW, RUE senza consumo proprio (senz’aste 2–149,99 kW, tramite aste da 150 kW)', {
      hardness: 'informative', evaluability: 'manual',
      notes: 'Soglie verificate a mano il 2026-08-28 sulla pagina RU e sulla pagina delle aste di Pronovo: la RUE esiste senz’aste (2–149,99 kW) e tramite aste (da 150 kW).',
    }),
  ],
  'ti-linn': [
    r('sede', 'Sede o attività economica in Ticino', {
      fact_key: 'company.canton', operator: 'equals', expected_value: 'Ticino',
      evaluability: 'auto',
      question: 'L’azienda ha sede o attività economica in Ticino?',
    }),
    r('fte', 'Almeno 5 ETP (procedura ordinaria) o 3 ETP (procedura agevolata), soglie in vigore dal 1º gennaio 2024', {
      fact_key: 'company.employee_count', operator: 'greater_or_equal', expected_value: 3,
      evaluability: 'auto',
      question: 'L’azienda ha almeno 3–5 dipendenti a tempo pieno (ETP) secondo la procedura?',
    }),
    r('before', 'Domanda prima dell’esecuzione o della deliberazione degli investimenti', {
      fact_key: 'project.not_started', operator: 'equals', expected_value: true,
      evaluability: 'auto',
      question: 'Il progetto o investimento NON è ancora stato avviato o deliberato?',
    }),
    r('salary', 'Almeno il 60% dei dipendenti in ETP con salario orario di base ≥ CHF 32.00 (CHF 24.00 per primario e industria)', {
      question: 'Almeno il 60% dei dipendenti percepisce il salario orario minimo previsto per il proprio settore?',
    }),
    r('residenti', 'Almeno il 60% del personale in ETP residente in Svizzera', {
      question: 'Almeno il 60% del personale (apprendisti inclusi) è residente in Svizzera?',
    }),
    r('parita', 'Parità salariale verificata con lo strumento LOGIB della Confederazione', {
      question: 'L’azienda rispetta la parità salariale secondo metodi conformi al diritto (LOGIB)?',
    }),
    r('innov', 'Progetto di innovazione di prodotto o processo, oppure internazionalizzazione', {
      question: 'Il progetto introduce un’innovazione di prodotto/processo o un’internazionalizzazione?',
    }),
    r('impegno', 'Impegno pluriennale: i criteri vanno rispettati per 5 anni (2 per la procedura agevolata), pena la restituzione integrale', {
      hardness: 'soft',
      question: 'L’azienda può garantire il rispetto dei criteri per i 5 anni successivi?',
    }),
    r('pure-commercial', 'Attività puramente commerciali senza componente innovativa', {
      hardness: 'exclusion',
      question: 'Si tratta di un’attività puramente commerciale, senza componente innovativa?',
    }),
  ],
  'ti-fer': [
    r('territory', 'Impianto realizzato in Ticino', {
      fact_key: 'project.canton', operator: 'equals', expected_value: 'Ticino',
      evaluability: 'auto',
      question: 'L’impianto è realizzato in Ticino?',
    }),
    r('eligible', 'Produzione di energia elettrica da fonte rinnovabile, oppure studi e consulenze in ambito energetico', {
      question: 'L’intervento produce energia elettrica da fonte rinnovabile (o è uno studio/consulenza)?',
    }),
    r('notifica', 'Per le tecnologie diverse dal fotovoltaico la notifica preliminare prima dei lavori resta obbligatoria', {
      hardness: 'soft',
      question: 'Se l’impianto NON è fotovoltaico: la notifica preliminare è stata inoltrata prima dell’inizio dei lavori?',
    }),
    r('calore', 'Interventi sul calore: rientrano nel Programma Edifici, non nel FER', {
      hardness: 'exclusion',
      question: 'L’intervento riguarda il riscaldamento o l’isolamento anziché la produzione di energia elettrica?',
    }),
  ],
  'ti-lrilocc': [
    r('urc', 'Assunzione di una persona disoccupata iscritta a un URC', {
      question: 'La persona da assumere è iscritta a un URC?',
    }),
    r('before', 'Richiesta inoltrata prima dell’inizio del rapporto di lavoro', {
      fact_key: 'project.not_started', operator: 'equals', expected_value: true,
      evaluability: 'auto',
      question: 'Il rapporto di lavoro NON è ancora iniziato?',
    }),
    r('nolayoff', 'Nessun licenziamento economico nei 12 mesi precedenti e rispetto dei CCL', {
      question: 'L’azienda non ha operato licenziamenti economici negli ultimi 12 mesi e rispetta i CCL/CNL?',
    }),
    r('durata', 'Il rapporto deve durare almeno il doppio del periodo sussidiato', {
      hardness: 'soft',
      question: 'Il rapporto di lavoro è previsto per una durata pari ad almeno il doppio del periodo sussidiato?',
    }),
    r('tasso', 'La misura si attiva solo se il tasso di disoccupazione raggiunge il tasso di riferimento (art. 3 L-rilocc)', {
      hardness: 'informative', evaluability: 'manual',
      notes: 'Condizione di SISTEMA, non dell’impresa: vive in `availability` (0011) e non va chiesta a chi compila.',
    }),
    r('replace', 'Il posto sostituisce personale licenziato di recente', {
      hardness: 'exclusion',
      question: 'Il posto sostituisce personale licenziato di recente?',
    }),
    r('lavoro-ridotto', 'Azienda in periodo di lavoro ridotto', {
      hardness: 'exclusion',
      question: 'L’azienda è attualmente in regime di lavoro ridotto?',
    }),
  ],
};

// ---------------------------------------------------------------------------
// Le call
//
// ⚠️ SOLO QUELLE CHE UNA FONTE UFFICIALE DICHIARA. Dove la fonte non dice
//    niente, lo stato è `unknown` — non `open`. Presentare come aperta una
//    finestra che nessuno ha verificato è la bugia più costosa di questo
//    modulo, perché porta qualcuno a preparare una domanda per una call chiusa.
// ---------------------------------------------------------------------------
const CALLS = [
  // ⚠️ VERIFICATE CONTRO LA PAGINA VIVA IL 2026-07-30: l'Innovation Council ha
  //    quattro riunioni per settore tematico, e la candidatura va inoltrata
  //    almeno sei settimane prima. Le date sono quelle dichiarate dalla fonte
  //    per «Energy & Environment»; le altre aree hanno il proprio calendario e
  //    NON sono state trascritte, perché non le ho lette una per una.
  {
    program_id: 'innosuisse', external_reference: 'IC-2026-09',
    title: 'Innovation Council — riunione dell’11.09.2026 (Energy & Environment)',
    status: 'open', opens_on: null, deadline_on: '2026-07-31', deadline_at: null,
    continuous: false, checked_at: CHECKED,
    notes: 'Termine calcolato dalla regola delle sei settimane dichiarata dalla fonte. ⚠️ La data è DERIVATA, non trascritta: va confermata sul calendario ufficiale prima di candidarsi.',
  },
  {
    program_id: 'innosuisse', external_reference: 'IC-2026-10',
    title: 'Innovation Council — riunione del 30.10.2026 (Energy & Environment)',
    status: 'upcoming', opens_on: null, deadline_on: '2026-09-18', deadline_at: null,
    continuous: false, checked_at: CHECKED,
    notes: 'Termine derivato dalla regola delle sei settimane. Da confermare sul calendario ufficiale.',
  },
  {
    program_id: 'innosuisse', external_reference: 'IC-2026-11',
    title: 'Innovation Council — riunione del 27.11.2026 (Energy & Environment)',
    status: 'upcoming', opens_on: null, deadline_on: '2026-10-16', deadline_at: null,
    continuous: false, checked_at: CHECKED,
    notes: 'Termine derivato dalla regola delle sei settimane. Da confermare sul calendario ufficiale.',
  },
  // Finestre permanenti: la fonte dice esplicitamente «in ogni momento».
  {
    program_id: 'programma-edifici', external_reference: 'continuous',
    title: 'Domanda in ogni momento, sempre prima dell’inizio dei lavori',
    status: 'continuous', opens_on: null, deadline_on: null, deadline_at: null,
    continuous: true, checked_at: CHECKED, notes: null,
  },
  {
    program_id: 'ti-linn', external_reference: 'continuous',
    title: 'Domanda in ogni momento, prima dell’avvio del progetto',
    status: 'continuous', opens_on: null, deadline_on: null, deadline_at: null,
    continuous: true, checked_at: CHECKED, notes: null,
  },
  {
    program_id: 'pronovo', external_reference: 'continuous',
    title: 'Domanda dopo la messa in servizio, secondo la procedura Pronovo',
    status: 'continuous', opens_on: null, deadline_on: null, deadline_at: null,
    continuous: true, checked_at: CHECKED, notes: null,
  },
  {
    program_id: 'ti-fer', external_reference: 'continuous',
    title: 'Fotovoltaico: domanda dopo la messa in esercizio. Altre tecnologie: notifica preliminare',
    status: 'continuous', opens_on: null, deadline_on: null, deadline_at: null,
    continuous: true, checked_at: CHECKED, notes: null,
  },
  {
    program_id: 'ti-lrilocc', external_reference: 'suspended',
    title: 'Misura sospesa: il tasso di disoccupazione è sotto la soglia di attivazione',
    status: 'suspended', opens_on: null, deadline_on: null, deadline_at: null,
    continuous: false, checked_at: CHECKED,
    notes: 'La sospensione è dichiarata in `subsidy_programs.availability` dalla 0011, con motivo e fonte.',
  },
  // ⚠️ ProKilowatt lavora a BANDI e la pagina non ne dichiara uno aperto al
  //    2026-07-30. Stato `unknown` e non `closed`: «non lo sappiamo» e «non ce
  //    n'è» sono due cose diverse, e la seconda sarebbe un'affermazione che
  //    nessuno ha verificato.
  {
    program_id: 'prokilowatt', external_reference: 'unknown-2026',
    title: 'Bandi periodici: la finestra aperta va verificata sulla fonte ufficiale',
    status: 'unknown', opens_on: null, deadline_on: null, deadline_at: null,
    continuous: false, checked_at: CHECKED,
    notes: 'La pagina non dichiarava un bando aperto al 2026-07-30. Stato `unknown`, non `closed`.',
  },
];

// ---------------------------------------------------------------------------
const { SUPABASE_URL: U, SUPABASE_SERVICE_ROLE_KEY: S } = process.env;
if (!U || !S) { console.error('Mancano SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (usa --env-file=.env.test).'); process.exit(2); }
const admin = createClient(U, S, { auth: { persistSession: false, autoRefreshToken: false } });
const WRITE = process.argv.includes('--write');

const totalRules = Object.values(RULES).reduce((n, list) => n + list.length, 0);
console.log(`\nCatalogo 2.0 — ${SOURCES.length} fonti · ${Object.keys(RULES).length} versioni · ${totalRules} criteri · ${CALLS.length} call`);
console.log(`${WRITE ? 'SCRITTURA' : 'ANTEPRIMA (dry-run)'}\n`);

for (const [programId, rules] of Object.entries(RULES)) {
  const auto = rules.filter((x) => x.evaluability === 'auto').length;
  const hard = rules.filter((x) => x.hardness === 'hard').length;
  const excl = rules.filter((x) => x.hardness === 'exclusion').length;
  const info = rules.filter((x) => x.hardness === 'informative').length;
  console.log(`  ${programId.padEnd(20)} ${String(rules.length).padStart(2)} criteri  `
    + `(${auto} automatici · ${hard} obbligatori · ${excl} esclusioni · ${info} informativi)`);
}

// Un criterio `auto` senza fatto o senza operatore non è automatico: è rotto.
const broken = [];
for (const [programId, rules] of Object.entries(RULES)) {
  for (const rule of rules) {
    if (rule.evaluability === 'auto' && (!rule.fact_key || !rule.operator)) {
      broken.push(`${programId}/${rule.rule_key}: dichiarato automatico senza fatto o operatore`);
    }
    if (rule.hardness === 'exclusion' && rule.evaluability === 'question' && !rule.question) {
      broken.push(`${programId}/${rule.rule_key}: esclusione valutabile senza domanda`);
    }
  }
}
if (broken.length) {
  console.error(`\nCriteri incoerenti:\n${broken.map((b) => `  ✗ ${b}`).join('\n')}\n`);
  process.exit(2);
}

// ⚠️ USCITA 3, NON ZERO. Il dry-run è la modalità PREDEFINITA: `npm run
// subsidy:seed` non scrive niente, e fino al 2026-08-01 usciva ZERO. La CI ci
// è già cascata una volta — i due seed giravano senza `--write`, il passo
// risultava superato dopo non aver scritto nulla, e a diventare rossa era la
// migrazione dopo, con una chiave esterna che sembrava un difetto dello schema.
// Un no-op che esce 0 è un fallback silenzioso: 3 significa «non eseguito»
// in tutto questo repository, e distingue «non ho scritto» da «ho scritto bene».
if (!WRITE) {
  console.log('\n(dry-run: NON è stato scritto niente — rilancia con --write per scrivere sul DB)\n');
  process.exit(3);
}

let errors = 0;
const fail = (what, e) => { errors++; console.log(`  ✗ ${what}: ${e?.message ?? e}`); };

// ---- 1. Le fonti ----
const sourceIdByProgram = new Map();
for (const s of SOURCES) {
  const { data, error } = await admin.from('subsidy_sources').upsert({
    authority: s.authority, source_type: s.source_type, canonical_url: s.canonical_url,
    allowed_host: s.allowed_host, locale: s.locale, jurisdiction: s.jurisdiction,
    adapter_key: s.adapter_key, check_frequency_days: s.check_frequency_days,
    criticality: s.criticality, enabled: true,
  }, { onConflict: 'canonical_url' }).select('id').single();
  if (error || !data) { fail(`fonte ${s.key}`, error); continue; }
  sourceIdByProgram.set(s.program_id, data.id);
  const { error: pErr } = await admin.from('subsidy_programs')
    .update({ primary_source_id: data.id }).eq('id', s.program_id);
  if (pErr) fail(`collegamento fonte → ${s.program_id}`, pErr);
}
console.log(`\n  fonti: ${sourceIdByProgram.size}/${SOURCES.length}`);

// ---- 2. Le versioni + i criteri ----
// ⚠️ La versione nasce in BOZZA, si riempie di criteri, e solo dopo si
//    pubblica: una versione pubblicata è immutabile e i suoi criteri non si
//    possono più scrivere. L'ordine non è una comodità, è l'unico possibile.
let versions = 0, rulesWritten = 0;
for (const [programId, rules] of Object.entries(RULES)) {
  const { data: existing } = await admin.from('subsidy_program_versions')
    .select('id, status').eq('program_id', programId).eq('version_number', 1).maybeSingle();

  let versionId = existing?.id ?? null;
  if (existing && existing.status !== 'draft') {
    console.log(`  · ${programId}: versione 1 già pubblicata, non si tocca (immutabile)`);
    continue;
  }
  if (!versionId) {
    const { data, error } = await admin.from('subsidy_program_versions').insert({
      program_id: programId, version_number: 1, status: 'draft',
      effective_from: CHECKED, content_hash: `seed-${programId}-v1-${CHECKED}`,
      source_snapshot_id: null,
      normalized_content: {
        seededFrom: 'seed-subsidy-catalog.mjs',
        checkedAt: CHECKED,
        requiresResearchPartner: programId === 'innosuisse',
      },
    }).select('id').single();
    if (error || !data) { fail(`versione ${programId}`, error); continue; }
    versionId = data.id;
  }

  await admin.from('subsidy_program_rules').delete().eq('program_version_id', versionId);
  const { error: rErr } = await admin.from('subsidy_program_rules').insert(
    rules.map((rule, i) => ({ ...rule, program_version_id: versionId, sort_order: i })),
  );
  if (rErr) { fail(`criteri ${programId}`, rErr); continue; }
  rulesWritten += rules.length;

  const { error: pErr } = await admin.from('subsidy_program_versions')
    .update({ status: 'published', reviewed_at: new Date().toISOString() }).eq('id', versionId);
  if (pErr) { fail(`pubblicazione ${programId}`, pErr); continue; }
  versions++;
}
console.log(`  versioni pubblicate: ${versions} · criteri: ${rulesWritten}`);

// ---- 3. Le call ----
// ⚠️ SELECT + INSERT/UPDATE e non `upsert`. L'indice unico su
//    (program_id, external_reference) è PARZIALE — vale solo dove il
//    riferimento non è nullo, perché una call senza riferimento esterno non
//    deve impedirne un'altra — e PostgREST rifiuta un `on_conflict` che non
//    corrisponda a un vincolo pieno. Rendere l'indice totale sarebbe stato il
//    modo sbagliato di risolverlo: avrebbe permesso una sola call senza
//    riferimento per programma, cioè un vincolo inventato per far funzionare
//    uno script.
let calls = 0;
for (const c of CALLS) {
  const { data: version } = await admin.from('subsidy_program_versions')
    .select('id').eq('program_id', c.program_id).eq('status', 'published').maybeSingle();
  const row = { ...c, program_version_id: version?.id ?? null };

  const { data: existing } = await admin.from('subsidy_calls')
    .select('id').eq('program_id', c.program_id)
    .eq('external_reference', c.external_reference).maybeSingle();

  const { error } = existing
    ? await admin.from('subsidy_calls').update(row).eq('id', existing.id)
    : await admin.from('subsidy_calls').insert(row);
  if (error) fail(`call ${c.program_id}/${c.external_reference}`, error);
  else calls++;
}
console.log(`  call: ${calls}/${CALLS.length}`);

console.log(`\n${errors ? `✗ ${errors} errori` : '✓ catalogo 2.0 scritto'}\n`);
process.exit(errors ? 1 : 0);
