// ============================================================================
// SUBSIDY AI — dataset demo dei programmi + normalizzazione al modello.
// (In questa fase i programmi restano lato client; le ATTIVITÀ dell'utente
// —match e pratiche— sono invece persistite nel DB.)
// ============================================================================

export interface Settore { id: string; label: string }
export const SETTORI: Settore[] = [
  { id: 'industria', label: 'Industria / manifattura' },
  { id: 'costruzioni', label: 'Costruzioni / impiantistica' },
  { id: 'commercio', label: 'Commercio' },
  { id: 'servizi', label: 'Servizi / consulenza' },
  { id: 'ict', label: 'ICT / software' },
  { id: 'turismo', label: 'Turismo / ristorazione' },
  { id: 'sanita', label: 'Sanità / sociale' },
  { id: 'trasporti', label: 'Trasporti / logistica' },
];

export interface TipoProgetto { id: string; label: string }
export const TIPI_PROGETTO: TipoProgetto[] = [
  { id: 'innovazione', label: 'Innovazione / R&S' },
  { id: 'energia', label: 'Energia / efficienza energetica' },
  { id: 'digitalizzazione', label: 'Digitalizzazione' },
  { id: 'formazione', label: 'Formazione del personale' },
  { id: 'mobilita', label: 'Mobilità / veicoli' },
  { id: 'assunzioni', label: 'Assunzioni / occupazione' },
  { id: 'export', label: 'Export / internazionalizzazione' },
  { id: 'edilizia', label: 'Immobili / risanamento' },
];

export const CANTONI = ['Ticino', 'Zurigo', 'Berna', 'Ginevra', 'Vaud', 'Grigioni', 'Altro'];
export const FORME_GIURIDICHE = ['SA', 'Sagl', 'Ditta individuale', 'Società in nome collettivo', 'Associazione / altro'];
export const FASCE_FATTURATO = ["< CHF 500'000", "CHF 500'000 – 2 mio", 'CHF 2 – 10 mio', '> CHF 10 mio', 'Preferisco non indicare'];

const PROJECT_KEYWORDS: Record<string, string[]> = {
  innovazione: ['innovazione', 'ricerca', 'sviluppo', 'r&s', 'prototipo', 'brevetto', 'nuovo prodotto', 'startup', 'tecnologia'],
  energia: ['energia', 'energetic', 'fotovoltaico', 'solare', 'pompa di calore', 'riscaldamento', 'isolamento', 'efficienza', 'led', 'elettrico'],
  digitalizzazione: ['digital', 'software', 'gestionale', 'erp', 'e-commerce', 'sito web', 'automazione', 'cloud', 'informatic'],
  formazione: ['formazione', 'corso', 'apprendist', 'qualifica', 'riqualifica', 'competenze'],
  mobilita: ['veicolo', 'furgone', 'auto elettrica', 'mobilità', 'flotta', 'ricarica', 'colonnina', 'bici'],
  assunzioni: ['assunzione', 'assumere', 'personale', 'disoccupat', 'collocamento', 'posto di lavoro'],
  export: ['export', 'estero', 'internazional', 'fiera', 'mercati esteri'],
  edilizia: ['risanamento', 'ristrutturazione', 'immobile', 'stabile', 'capannone', 'edificio', 'tetto', 'facciata'],
};

export function interpretProjectDescription(text: string | null | undefined): string[] {
  if (!text) return [];
  const t = text.toLowerCase();
  const matches: { tipo: string; hits: number }[] = [];
  for (const [tipo, keywords] of Object.entries(PROJECT_KEYWORDS)) {
    const hits = keywords.filter((k) => t.includes(k)).length;
    if (hits > 0) matches.push({ tipo, hits });
  }
  return matches.sort((a, b) => b.hits - a.hits).map((m) => m.tipo);
}

export function labelTipo(id: string): string {
  const t = TIPI_PROGETTO.find((x) => x.id === id);
  return t ? t.label : id;
}
export function labelSettore(id: string | null): string {
  if (!id) return '';
  const s = SETTORI.find((x) => x.id === id);
  return s ? s.label : id;
}

// ---- Tipi del modello -------------------------------------------------------
export type SupportType = 'grant' | 'tax_relief' | 'guarantee' | 'loan' | 'reimbursement' | 'advisory' | 'other';
export const SUPPORT_TYPE_LABEL: Record<SupportType, string> = {
  grant: 'Contributo a fondo perso', tax_relief: 'Sgravio fiscale', guarantee: 'Fideiussione',
  loan: 'Prestito agevolato', reimbursement: 'Rimborso', advisory: 'Consulenza', other: 'Altro',
};

export interface Requirement { id: string; text: string; question: string; mustBe: 'si'; hard: boolean }
export interface Exclusion { id: string; text: string; question: string | null; triggeringAnswer: string | null; evaluable: boolean }

export interface ProgramModel {
  id: string;
  name: string;
  authority: string;
  supportType: SupportType;
  geography: string[];
  targetSectors: string[];
  companySize: { min: number; max: number };
  projectTypes: string[];
  requirements: Requirement[];
  hardRequirements: Requirement[];
  softRequirements: Requirement[];
  exclusions: Exclusion[];
  evaluableExclusions: Exclusion[];
  informativeExclusions: Exclusion[];
  contributionDescription: string;
  applicationWindow: string;
  mustApplyBeforeStart: boolean;
  mustApplyBeforeStartText: string | null;
  documentsRequired: string[];
  officialSourceUrl: string;
  sourceTitle: string;
  lastCheckedAt: string | null;
  dataStatus: 'verified' | 'recheck' | 'demo';
}

// ---- Dataset grezzo (demo) --------------------------------------------------
interface RawQuestion { id: string; testo: string; peso: number; requisito: string; hard?: boolean }
interface RawExclusion { text: string; question: string; triggeringAnswer: string }
interface RawProgram {
  id: string; programma: string; ente: string;
  area: string[]; settori: string[]; minDipendenti: number; maxDipendenti: number; tipiProgetto: string[];
  requisiti: string[]; esclusioni: string[]; esclusioniEval?: RawExclusion[];
  contributo: string; scadenza: string; avvisoPrima: boolean; avvisoTesto: string | null;
  documenti: string[]; fonte: string; dataVerifica: string;
  domande: RawQuestion[];
}

const PROGRAMS: RawProgram[] = [
  {
    id: 'innosuisse', programma: 'Innosuisse — Progetti di innovazione con partner di ricerca', ente: 'Confederazione (Innosuisse)',
    area: ['ALL'], settori: ['ALL'], minDipendenti: 1, maxDipendenti: 250, tipiProgetto: ['innovazione', 'digitalizzazione'],
    requisiti: ['Collaborazione con un partner di ricerca svizzero (università, SUPSI, ecc.)', 'Progetto con contenuto innovativo e potenziale di mercato', 'Capacità di finanziare la propria parte dei costi (cash + in kind)'],
    esclusioni: ['Attività di routine senza contenuto innovativo'],
    contributo: 'Fino al 50% dei costi di progetto (quota del partner di ricerca)',
    scadenza: "Presentazione possibile tutto l'anno", avvisoPrima: true,
    avvisoTesto: "La domanda deve essere approvata PRIMA dell'inizio del progetto: i costi già sostenuti non sono riconosciuti.",
    documenti: ['Descrizione del progetto', 'Piano dei costi', 'Accordo con il partner di ricerca', 'Dati aziendali'],
    fonte: 'https://www.innosuisse.admin.ch', dataVerifica: '2026-07-01',
    domande: [
      { id: 'q1', testo: 'Il progetto prevede una collaborazione con un istituto di ricerca svizzero?', peso: 3, requisito: 'Partner di ricerca' },
      { id: 'q2', testo: 'Il progetto sviluppa un prodotto, servizio o processo nuovo per il mercato?', peso: 3, requisito: 'Contenuto innovativo' },
      { id: 'q3', testo: "L'azienda può coprire la propria parte dei costi di progetto?", peso: 2, requisito: 'Capacità finanziaria' },
      { id: 'q4', testo: 'Il progetto NON è ancora iniziato?', peso: 3, requisito: 'Progetto non avviato' },
    ],
  },
  {
    id: 'programma-edifici', programma: 'Il Programma Edifici — risanamento energetico', ente: 'Confederazione + Cantoni',
    area: ['ALL'], settori: ['ALL'], minDipendenti: 0, maxDipendenti: 100000, tipiProgetto: ['energia', 'edilizia'],
    requisiti: ['Immobile situato in Svizzera di proprietà o in diritto di superficie', 'Intervento ammissibile: isolamento termico, sostituzione riscaldamento fossile, ecc.', 'Rispetto dei requisiti tecnici minimi del programma cantonale'],
    esclusioni: ['Edifici nuovi (solo risanamenti)', 'Lavori già iniziati prima della domanda'],
    esclusioniEval: [{ text: 'Edifici nuovi (solo risanamenti)', question: 'Si tratta di un edificio nuovo (e non di un risanamento)?', triggeringAnswer: 'si' }],
    contributo: 'Contributo per m² di superficie isolata o forfait per impianto (varia per Cantone)',
    scadenza: "Domanda in ogni momento, prima dell'inizio dei lavori", avvisoPrima: true,
    avvisoTesto: "La domanda va presentata e approvata PRIMA dell'inizio dei lavori, pena la perdita del contributo.",
    documenti: ['Formulario cantonale', 'Preventivi dei lavori', 'Certificato CECE (se richiesto)', 'Estratto del registro fondiario'],
    fonte: 'https://www.ilprogrammaedifici.ch', dataVerifica: '2026-06-15',
    domande: [
      { id: 'q1', testo: "L'azienda è proprietaria dell'immobile da risanare?", peso: 3, requisito: 'Proprietà immobile' },
      { id: 'q2', testo: 'I lavori NON sono ancora iniziati?', peso: 3, requisito: 'Lavori non iniziati' },
      { id: 'q3', testo: "L'intervento riguarda isolamento o sostituzione di un riscaldamento fossile?", peso: 2, requisito: 'Intervento ammissibile' },
    ],
  },
  {
    id: 'prokilowatt', programma: 'ProKilowatt — efficienza elettrica nelle imprese', ente: 'Confederazione (UFE)',
    area: ['ALL'], settori: ['industria', 'commercio', 'servizi', 'trasporti', 'turismo', 'costruzioni'], minDipendenti: 1, maxDipendenti: 100000, tipiProgetto: ['energia'],
    requisiti: ['Misure che riducono il consumo elettrico (illuminazione LED, motori efficienti, refrigerazione…)', 'Le misure non sarebbero economicamente sostenibili senza contributo', 'Domanda tramite bando o programma di sostegno attivo'],
    esclusioni: ['Misure già obbligatorie per legge', 'Progetti già avviati'],
    esclusioniEval: [{ text: 'Misure già obbligatorie per legge', question: 'Le misure previste sono già obbligatorie per legge?', triggeringAnswer: 'si' }],
    contributo: "Fino al 30% dei costi d'investimento",
    scadenza: "Bandi periodici durante l'anno", avvisoPrima: true,
    avvisoTesto: "L'impegno d'acquisto deve avvenire solo DOPO la conferma del contributo.",
    documenti: ['Descrizione delle misure', 'Calcolo del risparmio elettrico', 'Preventivi'],
    fonte: 'https://www.prokw.ch', dataVerifica: '2026-05-20',
    domande: [
      { id: 'q1', testo: 'Il progetto riduce il consumo di energia elettrica in modo misurabile?', peso: 3, hard: true, requisito: 'Risparmio elettrico' },
      { id: 'q2', testo: "L'investimento NON è ancora stato ordinato o pagato?", peso: 3, hard: true, requisito: 'Investimento non avviato' },
    ],
  },
  {
    id: 'ti-linn', programma: "Ticino — Legge per l'innovazione economica (LInn)", ente: 'Cantone Ticino (DFE)',
    area: ['Ticino'], settori: ['industria', 'ict', 'servizi'], minDipendenti: 1, maxDipendenti: 500, tipiProgetto: ['innovazione', 'digitalizzazione', 'export'],
    requisiti: ['Sede o attività economica in Ticino', 'Progetto di innovazione di prodotto o processo, o partecipazione a fiere internazionali', "Sostenibilità finanziaria dell'azienda"],
    esclusioni: ['Attività commerciali pure senza componente innovativa'],
    esclusioniEval: [{ text: 'Attività commerciali pure senza componente innovativa', question: "Si tratta di un'attività puramente commerciale, senza componente innovativa?", triggeringAnswer: 'si' }],
    contributo: "Contributo a fondo perso fino al 25% dell'investimento ammissibile",
    scadenza: "Domanda in ogni momento, prima dell'avvio del progetto", avvisoPrima: true,
    avvisoTesto: 'Il progetto non deve essere avviato prima della decisione di sostegno.',
    documenti: ['Business plan / descrizione progetto', 'Ultimi due bilanci', 'Preventivi', 'Estratto registro di commercio'],
    fonte: 'https://www4.ti.ch/dfe/de/use/sostegno', dataVerifica: '2026-07-10',
    domande: [
      { id: 'q1', testo: "L'azienda ha sede operativa in Ticino?", peso: 3, requisito: 'Sede in Ticino' },
      { id: 'q2', testo: 'Il progetto introduce un prodotto o processo nuovo o migliorato?', peso: 3, requisito: 'Innovazione' },
      { id: 'q3', testo: 'Gli ultimi bilanci mostrano una situazione finanziaria sostenibile?', peso: 2, requisito: 'Solidità finanziaria' },
      { id: 'q4', testo: 'Il progetto NON è ancora stato avviato?', peso: 3, requisito: 'Progetto non avviato' },
    ],
  },
  {
    id: 'ti-energia', programma: 'Ticino — Incentivi cantonali efficienza energetica (FER)', ente: 'Cantone Ticino',
    area: ['Ticino'], settori: ['ALL'], minDipendenti: 0, maxDipendenti: 100000, tipiProgetto: ['energia', 'edilizia', 'mobilita'],
    requisiti: ['Intervento realizzato in Ticino', 'Tipologie sostenute: fotovoltaico, pompe di calore, risanamenti, mobilità elettrica (secondo decreti annuali)', "Domanda prima dell'inizio dei lavori"],
    esclusioni: ['Interventi già eseguiti'],
    contributo: 'Incentivi cantonali secondo il decreto in vigore (importi per kW / m² / veicolo)',
    scadenza: 'Fino ad esaurimento dei fondi annuali', avvisoPrima: true,
    avvisoTesto: 'Fondi limitati ed esauribili: presentare la domanda PRIMA dei lavori e verificare la disponibilità residua.',
    documenti: ['Formulario cantonale', 'Preventivi', "Documentazione tecnica dell'impianto"],
    fonte: 'https://www4.ti.ch/dfe/de/se/sportello', dataVerifica: '2026-06-30',
    domande: [
      { id: 'q1', testo: "L'intervento si trova in Ticino?", peso: 3, requisito: 'Territorio' },
      { id: 'q2', testo: 'I lavori NON sono ancora iniziati?', peso: 3, requisito: 'Lavori non iniziati' },
      { id: 'q3', testo: "L'intervento rientra nelle tipologie sostenute dal decreto in vigore?", peso: 2, requisito: 'Tipologia ammissibile' },
    ],
  },
  {
    id: 'ti-lrilocc', programma: "Ticino — Incentivi all'assunzione (L-Rilocc)", ente: 'Cantone Ticino (Sezione del lavoro)',
    area: ['Ticino'], settori: ['ALL'], minDipendenti: 1, maxDipendenti: 100000, tipiProgetto: ['assunzioni'],
    requisiti: ['Assunzione di una persona iscritta a un Ufficio regionale di collocamento (URC) del Ticino', 'Contratto di lavoro di durata indeterminata o determinata significativa', "Richiesta presentata prima dell'inizio del rapporto di lavoro"],
    esclusioni: ['Sostituzione di personale licenziato per creare il posto sussidiato'],
    contributo: 'Incentivo finanziario temporaneo sul salario (percentuale decrescente)',
    scadenza: "Prima dell'inizio del rapporto di lavoro", avvisoPrima: true,
    avvisoTesto: "La richiesta va inoltrata PRIMA dell'assunzione: contratti già firmati e iniziati non sono incentivabili.",
    documenti: ['Formulario di richiesta', 'Bozza del contratto di lavoro', 'Profilo del candidato'],
    fonte: 'https://www4.ti.ch/dfe/de/sdl', dataVerifica: '2026-07-05',
    domande: [
      { id: 'q1', testo: 'La persona da assumere è iscritta a un URC ticinese?', peso: 3, requisito: 'Candidato iscritto URC' },
      { id: 'q2', testo: 'Il rapporto di lavoro NON è ancora iniziato?', peso: 3, requisito: 'Assunzione non avviata' },
      { id: 'q3', testo: 'Il posto non sostituisce personale licenziato di recente?', peso: 2, requisito: 'Nessuna sostituzione abusiva' },
    ],
  },
  {
    id: 'pronovo', programma: 'Pronovo — Rimunerazione unica per impianti fotovoltaici', ente: 'Confederazione (Pronovo AG)',
    area: ['ALL'], settori: ['ALL'], minDipendenti: 0, maxDipendenti: 100000, tipiProgetto: ['energia', 'edilizia'],
    requisiti: ['Impianto fotovoltaico nuovo collegato alla rete', 'Notifica e domanda secondo la procedura Pronovo'],
    esclusioni: [],
    contributo: 'Rimunerazione unica: contributo base + contributo per kW installato (circa 20-30% dei costi)',
    scadenza: 'Domanda dopo la messa in servizio, secondo procedura', avvisoPrima: false, avvisoTesto: null,
    documenti: ['Certificato di collaudo', "Dati dell'impianto", 'Coordinate bancarie'],
    fonte: 'https://pronovo.ch', dataVerifica: '2026-06-01',
    domande: [
      { id: 'q1', testo: "L'impianto fotovoltaico è nuovo e collegato alla rete elettrica?", peso: 3, requisito: 'Impianto ammissibile' },
      { id: 'q2', testo: 'La potenza installata è di almeno 2 kW?', peso: 2, requisito: 'Potenza minima' },
    ],
  },
  {
    id: 'formazione-continua', programma: 'Assegni e sostegno alla formazione continua', ente: 'Confederazione + Cantone',
    area: ['ALL'], settori: ['ALL'], minDipendenti: 1, maxDipendenti: 100000, tipiProgetto: ['formazione'],
    requisiti: ['Corsi riconosciuti (federali o cantonali) o preparazione a esami federali', 'Per i corsi con esame federale: contributo diretto ai partecipanti (fino al 50%)'],
    esclusioni: ['Formazione interna non certificata'],
    contributo: 'Fino al 50% dei costi dei corsi di preparazione agli esami federali',
    scadenza: "Domanda dopo l'esame (contributo federale) o secondo bando cantonale", avvisoPrima: false, avvisoTesto: null,
    documenti: ['Fattura del corso', 'Attestato di partecipazione', "Decisione d'esame"],
    fonte: 'https://www.sbfi.admin.ch', dataVerifica: '2026-05-10',
    domande: [
      { id: 'q1', testo: 'Il corso prepara a un esame federale (APF/EPS) o è riconosciuto dal Cantone?', peso: 3, requisito: 'Corso riconosciuto' },
      { id: 'q2', testo: 'I costi del corso sono documentabili con fatture?', peso: 2, requisito: 'Costi documentati' },
    ],
  },
  {
    id: 'fondo-tecnologico', programma: 'Fondo per le tecnologie — fideiussioni cleantech', ente: 'Confederazione (UFAM)',
    area: ['ALL'], settori: ['industria', 'ict', 'costruzioni', 'trasporti'], minDipendenti: 1, maxDipendenti: 500, tipiProgetto: ['innovazione', 'energia'],
    requisiti: ['Prodotto o processo che riduce le emissioni o il consumo di risorse', 'Modello di business promettente e necessità di finanziamento tramite prestito'],
    esclusioni: ['Aziende senza prospettiva di rimborso del prestito'],
    contributo: 'Fideiussione su prestiti fino a CHF 3 mio (non è un contributo a fondo perso)',
    scadenza: 'Domanda in ogni momento', avvisoPrima: false, avvisoTesto: null,
    documenti: ['Business plan', 'Piano finanziario', 'Descrizione della tecnologia'],
    fonte: 'https://www.fondo-per-le-tecnologie.ch', dataVerifica: '2026-04-15',
    domande: [
      { id: 'q1', testo: 'Il prodotto/processo riduce emissioni di gas serra o consumo di risorse?', peso: 3, requisito: 'Impatto climatico' },
      { id: 'q2', testo: "L'azienda cerca un prestito bancario (non un contributo a fondo perso)?", peso: 3, requisito: 'Finanziamento tramite prestito' },
    ],
  },
  {
    id: 'sge-export', programma: "Switzerland Global Enterprise — sostegno all'export", ente: 'Confederazione (S-GE)',
    area: ['ALL'], settori: ['industria', 'ict', 'servizi', 'commercio'], minDipendenti: 1, maxDipendenti: 250, tipiProgetto: ['export'],
    requisiti: ['Prodotto o servizio con potenziale di export', 'Interesse per consulenza paese, fiere o ricerche di mercato'],
    esclusioni: [],
    contributo: 'Consulenza di base gratuita, servizi e padiglioni fieristici a tariffa agevolata',
    scadenza: 'Nessuna scadenza — servizio continuo', avvisoPrima: false, avvisoTesto: null,
    documenti: ['Profilo aziendale', 'Descrizione del prodotto/servizio'],
    fonte: 'https://www.s-ge.com', dataVerifica: '2026-06-20',
    domande: [
      { id: 'q1', testo: "L'azienda ha un prodotto/servizio già vendibile sul mercato svizzero?", peso: 2, requisito: 'Prodotto maturo' },
      { id: 'q2', testo: 'Esiste un mercato estero target identificato?', peso: 2, requisito: 'Mercato target' },
    ],
  },
  {
    id: 'ti-mobilita', programma: 'Ticino — Incentivi mobilità elettrica aziendale', ente: 'Cantone Ticino + Comuni',
    area: ['Ticino'], settori: ['ALL'], minDipendenti: 0, maxDipendenti: 100000, tipiProgetto: ['mobilita', 'energia'],
    requisiti: ['Veicolo elettrico nuovo immatricolato in Ticino o infrastruttura di ricarica in Ticino', 'Rispetto delle condizioni del decreto in vigore (categorie e massimali)', "Domanda prima dell'acquisto, secondo la procedura cantonale"],
    esclusioni: ['Veicoli già acquistati o immatricolati prima della domanda'],
    contributo: 'Contributo forfettario per veicolo e per stazione di ricarica (secondo decreto)',
    scadenza: 'Fino ad esaurimento dei fondi', avvisoPrima: true,
    avvisoTesto: "Verificare la procedura: di norma la domanda va presentata PRIMA dell'acquisto del veicolo.",
    documenti: ['Formulario cantonale', 'Offerta del concessionario', 'Carta grigia (dopo immatricolazione)'],
    fonte: 'https://www4.ti.ch/dt/da/sm', dataVerifica: '2026-07-12',
    domande: [
      { id: 'q1', testo: 'Il veicolo o la colonnina saranno in Ticino?', peso: 3, requisito: 'Territorio' },
      { id: 'q2', testo: "L'acquisto NON è ancora stato effettuato?", peso: 3, requisito: 'Acquisto non effettuato' },
    ],
  },
  {
    id: 'digitalizzazione-pmi', programma: 'Sostegno alla digitalizzazione delle PMI (programmi regionali NPR)', ente: 'Confederazione + Cantoni (Nuova politica regionale)',
    area: ['Ticino', 'Grigioni', 'Altro'], settori: ['industria', 'turismo', 'commercio', 'servizi', 'ict'], minDipendenti: 1, maxDipendenti: 250, tipiProgetto: ['digitalizzazione', 'innovazione'],
    requisiti: ['Sede in una regione beneficiaria della Nuova politica regionale', 'Progetto che aumenta la competitività (digitalizzazione di processi, nuovi canali)', 'Cofinanziamento aziendale'],
    esclusioni: ['Semplice acquisto di hardware senza progetto'],
    contributo: 'Contributi o prestiti agevolati secondo il programma cantonale',
    scadenza: 'Secondo bandi cantonali', avvisoPrima: true,
    avvisoTesto: "Molti bandi NPR richiedono la domanda prima dell'avvio del progetto.",
    documenti: ['Descrizione del progetto', 'Piano dei costi', 'Dati aziendali'],
    fonte: 'https://regiosuisse.ch', dataVerifica: '2026-05-28',
    domande: [
      { id: 'q1', testo: 'Il progetto digitalizza processi o canali di vendita (non solo hardware)?', peso: 3, requisito: 'Progetto strutturato' },
      { id: 'q2', testo: "L'azienda può cofinanziare almeno il 50% dei costi?", peso: 2, requisito: 'Cofinanziamento' },
    ],
  },
];

function deriveSupportType(contributo: string): SupportType {
  const t = (contributo || '').toLowerCase();
  if (t.includes('fideiussione')) return 'guarantee';
  if (t.includes('prestito')) return 'loan';
  if (t.includes('consulenza') || t.includes('gratuita')) return 'advisory';
  if (t.includes('rimborso')) return 'reimbursement';
  if (t.includes('sgravio') || t.includes('deduzione') || t.includes('fiscale')) return 'tax_relief';
  return 'grant';
}

// Adatta i dati demo al modello SENZA inventare importi/condizioni/scadenze.
function toProgramModel(p: RawProgram): ProgramModel {
  const requirements: Requirement[] = (p.domande || []).map((q) => ({
    id: q.id,
    text: q.requisito,
    question: q.testo,
    mustBe: 'si',
    // hard/soft: usa il flag esplicito q.hard quando presente; fallback sul peso
    // (3 = gating) solo per retrocompatibilità del dataset demo.
    hard: q.hard != null ? !!q.hard : q.peso >= 3,
  }));
  const evalTexts = new Set((p.esclusioniEval || []).map((e) => e.text));
  const exclusions: Exclusion[] = [
    ...(p.esclusioniEval || []).map((e, i) => ({ id: 'xe' + i, text: e.text, question: e.question, triggeringAnswer: e.triggeringAnswer, evaluable: true })),
    ...(p.esclusioni || []).filter((t) => !evalTexts.has(t)).map((t, i) => ({ id: 'xi' + i, text: t, question: null, triggeringAnswer: null, evaluable: false })),
  ];
  return {
    id: p.id, name: p.programma, authority: p.ente,
    supportType: deriveSupportType(p.contributo),
    geography: p.area, targetSectors: p.settori, companySize: { min: p.minDipendenti, max: p.maxDipendenti },
    projectTypes: p.tipiProgetto,
    requirements,
    hardRequirements: requirements.filter((r) => r.hard),
    softRequirements: requirements.filter((r) => !r.hard),
    exclusions,
    evaluableExclusions: exclusions.filter((x) => x.evaluable),
    informativeExclusions: exclusions.filter((x) => !x.evaluable),
    contributionDescription: p.contributo,
    applicationWindow: p.scadenza,
    mustApplyBeforeStart: !!p.avvisoPrima,
    mustApplyBeforeStartText: p.avvisoTesto || null,
    documentsRequired: p.documenti || [],
    officialSourceUrl: p.fonte, sourceTitle: p.ente + ' — pagina ufficiale del programma',
    lastCheckedAt: p.dataVerifica || null,
    dataStatus: 'demo',
  };
}

export const PROGRAMS_MODEL: ProgramModel[] = PROGRAMS.map(toProgramModel);
export function getProgram(id: string): ProgramModel | undefined {
  return PROGRAMS_MODEL.find((x) => x.id === id);
}

export const DATA_STATUS_LABEL: Record<ProgramModel['dataStatus'], { label: string; cls: string }> = {
  verified: { label: 'Verificato', cls: 'ds-ok' },
  recheck: { label: 'Da ricontrollare', cls: 'ds-warn' },
  demo: { label: 'Dato demo', cls: 'ds-demo' },
};
