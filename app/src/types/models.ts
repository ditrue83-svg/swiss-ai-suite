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
  amountEvidence: Evidence | null;
  summary: string | null;
  actions: ChecklistAction[];
  primaryAction: string | null;
  primaryActionSource: ActionSource;
  requestedDocuments: RequestedDocument[];
  risk: Risk;
  uncertainties: string[];
  confidence: Confidence;
  replyDraft: string;
  replyLanguage: DocLanguage | string;
  replyTone: string;
  createdAt: string;
  updatedAt: string;
  /** Testo originale ricostruito da Storage on-demand (NON persistito nel DB). */
  originalText?: string | null;
}

/** Documento + eventuale analisi (per Archivio / vista Admin). */
export interface DocumentWithAnalysis {
  document: DocumentRecord;
  analysis: DocumentAnalysis | null;
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
