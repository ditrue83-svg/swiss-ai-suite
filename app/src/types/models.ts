// ============================================================================
// Tipi di dominio (application layer). Più ricchi delle Row DB dove serve:
// la mappatura Row <-> dominio avviene nei service.
// ============================================================================
import type {
  MemberRole, DocumentSourceType, DocumentStatus, TaskPriority, TaskStatus, TaskSource,
  EligibilityStatus, SubsidyCaseStatus,
} from './database';

export type {
  MemberRole, DocumentSourceType, DocumentStatus, TaskPriority, TaskStatus, TaskSource,
  EligibilityStatus, SubsidyCaseStatus,
};

// ---- Utente / azienda -------------------------------------------------------
export interface UserProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
}

export interface Company {
  id: string;
  legalName: string;
  uidChe: string | null;
  canton: string | null;
  municipality: string | null;
  legalForm: string | null;
  createdAt?: string;
}

export interface CompanyMember {
  id: string;
  companyId: string;
  userId: string;
  role: MemberRole;
}

/** Azienda + ruolo dell'utente corrente (per il CompanyContext / switch azienda). */
export interface CompanyMembership {
  company: Company;
  role: MemberRole;
}

export interface CompanyProfile {
  companyId: string;
  sector: string | null;
  employeeCount: number | null;
  revenueBand: string | null;
  ownsProperty: boolean;
  vehicleCount: number;
  currentProjects: string[];
}

// ---- Admin AI ---------------------------------------------------------------
export interface Evidence {
  quote: string;
  start: number;
  end: number;
  /** Pagina di provenienza (§31), quando nota. */
  pageNumber?: number | null;
}

export type ActionSource = 'extracted' | 'suggested';

export interface ChecklistAction {
  id: number;
  text: string;
  done: boolean;
  sourceType: ActionSource;
  evidence: Evidence | null;
}

export interface RequestedDocument {
  label: string;
  evidence: Evidence | null;
}

export type RiskLevel = 'explicit' | 'possible' | 'unknown';

export interface Risk {
  text: string;
  level: RiskLevel;
  evidence: Evidence | null;
}

export type Urgency = 'alta' | 'media' | 'bassa';
export type Confidence = 'alta' | 'media' | 'bassa';
export type DeadlineLevel = 'scaduta' | 'urgente' | 'prossima' | 'nessuna' | 'none';
export type DocLanguage = 'it' | 'de' | 'fr';

export interface DocumentRecord {
  id: string;
  companyId: string;
  uploadedBy: string | null;
  title: string;
  originalFilename: string | null;
  mimeType: string | null;
  fileSize: number | null;
  storagePath: string | null;
  sourceType: DocumentSourceType;
  status: DocumentStatus;
  createdAt: string;
  updatedAt: string;
}

/** Importo rilevato (§12): la pipeline può estrarne più di uno, con tipo e citazione. */
export interface AnalysisAmount {
  amount: number;
  currency: string;
  type: string;            // due | fine | fee | contribution | other
  description: string;
  display: string;         // già formattato per la UI
  evidence: Evidence | null;
}

export interface ReferenceNumber {
  label: string;
  value: string;
  evidence: Evidence | null;
}

export interface LegalReference {
  text: string;
  evidence: Evidence | null;
}

/** Incertezza dichiarata dall'analisi (§17), con la sua gravità. */
export interface AnalysisUncertainty {
  field: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
}

/** Esito tecnico dell'analisi (§25). 'failed' = NON è un risultato, è un errore. */
export type AnalysisStatus = 'pending' | 'completed' | 'needs_review' | 'failed';

/** Risultato d'analisi arricchito usato dalla UI (etichette e livelli derivati). */
export interface DocumentAnalysis {
  id: string;
  documentId: string;
  companyId: string;
  analysisVersion: number;
  engine: string;
  language: DocLanguage | string | null;
  languageLabel: string;
  sender: string | null;
  senderUncertain: boolean;
  senderEvidence: Evidence | null;
  documentType: string | null;
  documentTypeLabel: string;
  urgency: Urgency;
  deadline: string | null;
  deadlineLevel: DeadlineLevel;
  daysToDeadline: number | null;
  deadlineEvidence: Evidence | null;
  amount: number | null;
  amountCurrency: string | null;
  amountDisplay: string | null;
  /** Tipo dell'importo principale (§12): due | fine | fee | contribution | other. */
  amountType: string | null;
  amountEvidence: Evidence | null;
  summary: string | null;
  actions: ChecklistAction[];
  primaryAction: string | null;
  primaryActionSource: ActionSource;
  requestedDocuments: RequestedDocument[];
  /** Rischio principale (espliciti prima degli inferiti). Compat con la UI storica. */
  risk: Risk;
  /** TUTTI i rischi rilevati (§16), non solo il primo. */
  risks: Risk[];
  uncertainties: string[];
  /** Incertezze con gravità (§17); `uncertainties` resta la versione testuale. */
  uncertaintyItems: AnalysisUncertainty[];
  confidence: Confidence;
  replyDraft: string;
  replyLanguage: DocLanguage | string;
  replyTone: string;
  // ---- Campi ricchi (§30-34) ----
  recipient: string | null;
  subject: string | null;
  documentDate: string | null;
  senderAuthorityType: string | null;
  amounts: AnalysisAmount[];
  referenceNumbers: ReferenceNumber[];
  legalReferences: LegalReference[];
  deadlineType: string | null;
  deadlineRequiresVerification: boolean;
  deadlineSourceText: string | null;
  overallConfidence: number | null;
  // ---- Esito tecnico (§25/§46): un fallimento NON va mai reso come risultato ----
  analysisStatus: AnalysisStatus;
  errorCode: string | null;
  errorMessageSafe: string | null;
  /** true quando l'ULTIMO tentativo è fallito ma resta disponibile un'analisi valida precedente. */
  lastAttemptFailed?: boolean;
  lastAttemptError?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Testo originale ricostruito da Storage on-demand (NON persistito nel DB). */
  originalText?: string | null;
  /** Pagine del testo estratto (§31), caricate on-demand per il viewer. */
  pages?: { pageNumber: number; text: string }[] | null;
}

/** Documento + eventuale analisi (per Archivio / vista Admin). */
export interface DocumentWithAnalysis {
  document: DocumentRecord;
  analysis: DocumentAnalysis | null;
}

/** Correzione umana di un campo estratto (§34). L'analisi AI resta immutabile. */
export interface AnalysisCorrection {
  id: string;
  analysisId: string;
  documentId: string;
  companyId: string;
  field: string;            // sender | deadline | amount | document_type
  originalAiValue: unknown;
  correctedValue: unknown;
  correctedBy: string | null;
  correctedAt: string;
}

/** Bozza di risposta generata su richiesta (§35), salvata in document_replies. */
export interface DocumentReply {
  id: string;
  documentId: string;
  companyId: string;
  analysisId: string | null;
  language: string;
  tone: string;
  content: string;
  provider: string | null;
  model: string | null;
  isEdited: boolean;
  createdAt: string;
  updatedAt: string;
}

// ---- Tasks ------------------------------------------------------------------
export interface Task {
  id: string;
  companyId: string;
  createdBy: string | null;
  documentId: string | null;
  subsidyCaseId: string | null;
  title: string;
  description: string | null;
  authority: string | null;
  dueDate: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  source: TaskSource;
  createdAt: string;
  updatedAt: string;
}

// ---- Subsidy ----------------------------------------------------------------
export interface SubsidyMatch {
  id: string;
  companyId: string;
  programId: string;
  relevanceScore: number | null;
  eligibilityStatus: EligibilityStatus;
  answers: Record<string, string>;
  satisfiedRequirements: string[];
  unknownRequirements: string[];
  failedRequirements: string[];
  sourceLastCheckedAt: string | null;
  evaluatedAt: string;
}

export interface SubsidyCase {
  id: string;
  companyId: string;
  createdBy: string | null;
  programId: string;
  programName: string | null;
  authority: string | null;
  status: SubsidyCaseStatus;
  eligibilityStatusAtCreation: EligibilityStatus | null;
  relevanceScore: number | null;
  sourceLastCheckedAt: string | null;
  eligibilitySnapshot: unknown;
  createdAt: string;
  updatedAt: string;
  items?: SubsidyCaseItem[];
}

export interface SubsidyCaseItem {
  id: string;
  subsidyCaseId: string;
  title: string;
  completed: boolean;
  sortOrder: number;
}

// ---- Subsidy AI · interpretazione progetto (§S2) ----------------------------
// Mirror lato client di NormalizedInterpretation (supabase/functions/_shared/
// subsidyInterpret.ts). L'AI interpreta e SPIEGA la pertinenza, ma NON dichiara
// idoneità (che resta deterministica e verificabile a valle). Ogni citazione è
// verificata contro il testo (§20): `verified=false` = non trovata alla lettera.
export interface InterpretationEvidence { quote: string; verified: boolean }

export interface InterpretedProjectType {
  type: string;              // uno degli 8 id di TIPI_PROGETTO
  confidence: number;
  evidence: InterpretationEvidence | null;
}

export interface InterpretedRelevantArea {
  area: string;
  reason: string;
  evidence: InterpretationEvidence | null;
}

export interface ProjectInterpretation {
  language: 'it' | 'de' | 'fr';
  summary: string;
  projectTypes: InterpretedProjectType[];
  sector: { value: string | null; confidence: number };
  investment: { amount: number | null; currency: string; evidence: InterpretationEvidence | null };
  timing: { alreadyStarted: boolean | null; evidence: InterpretationEvidence | null };
  relevantAreas: InterpretedRelevantArea[];
  uncertainties: { field: string; description: string; severity: 'low' | 'medium' | 'high' }[];
  overallConfidence: number;
  meta: { droppedEvidence: number; warnings: string[] };
}
