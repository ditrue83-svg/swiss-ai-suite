// ============================================================================
// SUBSIDY AI — tipi, costanti e label condivisi del dominio incentivi.
// Il CATALOGO reale dei programmi vive nel DB (tabella subsidy_programs) ed è
// caricato via programService.listActive(); qui restano solo il modello
// (ProgramModel + Requirement/Exclusion), le liste di scelta (settori, tipi di
// progetto, cantoni…) e le label per la UI. L'interpretazione della descrizione
// libera è ora affidata all'AI reale (interpret-project), non a keyword locali.
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

export const DATA_STATUS_LABEL: Record<ProgramModel['dataStatus'], { label: string; cls: string }> = {
  verified: { label: 'Verificato', cls: 'ds-ok' },
  recheck: { label: 'Da ricontrollare', cls: 'ds-warn' },
  demo: { label: 'Dato demo', cls: 'ds-demo' },
};
