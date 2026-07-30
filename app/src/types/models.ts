// ============================================================================
// Tipi di dominio (application layer). Più ricchi delle Row DB dove serve:
// la mappatura Row <-> dominio avviene nei service.
// ============================================================================
import type {
  MemberRole, DocumentSourceType, DocumentStatus, TaskPriority, TaskStatus, TaskSource, TaskEventKind,
  DocumentCategory, DocumentCategorySource,
  EligibilityStatus, SubsidyCaseStatus,
  EmailProvider, EmailConnectionStatus, EmailProcessingStatus, EmailAttentionStatus,
  EmailRelevance, EmailDocumentRelation, EmailAttachmentImportStatus, EmailSyncType, EmailSyncStatus,
  CalendarProvider, CalendarConnectionStatus, CalendarSyncStatus,
  NotificationType, NotificationChannel, NotificationDeliveryStatus,
  AutomationEventType, WorkflowStatus, WorkflowRunStatus, WorkflowActionStatus, WorkflowAuditKind,
  FinanceItemType, FinanceProcessingStatus, FinanceReviewStatus, FinanceOrigin,
  FinanceFieldSource, FinanceReferenceType, FinanceExpenseCategory, FinancePaymentMethod,
  CrmOrganizationRole, CrmRelationshipStatus, CrmSource, CrmContactMethodType,
  CrmOpportunityStage, CrmInteractionType, CrmDocumentRelation, CrmMatchReason,
  CrmLinkStatus, CrmEventKind, CrmLinkedEntity,
  FinanceExtractionStatus, FinanceQualityFlag, FinanceEventKind,
  ContractType, ContractReviewStatus, ContractLifecycleStatus, ContractDocumentRelation,
  ContractOrigin, ContractProcessingStatus, ContractExtractionStatus, ContractTermVersionStatus,
  ContractEndKind, ContractAutoRenewal, ContractPeriodUnit, ContractNoticeAnchor,
  ContractTerminationMethod, ContractCostFrequency, ContractMilestoneKind,
  ContractMilestoneSource, ContractMilestoneStatus, ContractQualityFlag, ContractEventKind,
  ContractAttentionClauseKind,
} from './database';

export type {
  MemberRole, DocumentSourceType, DocumentStatus, TaskPriority, TaskStatus, TaskSource, TaskEventKind,
  DocumentCategory, DocumentCategorySource,
  EligibilityStatus, SubsidyCaseStatus,
  EmailProvider, EmailConnectionStatus, EmailProcessingStatus, EmailAttentionStatus,
  EmailRelevance, EmailDocumentRelation, EmailAttachmentImportStatus, EmailSyncType, EmailSyncStatus,
  CalendarProvider, CalendarConnectionStatus, CalendarSyncStatus,
  NotificationType, NotificationChannel, NotificationDeliveryStatus,
  AutomationEventType, WorkflowStatus, WorkflowRunStatus, WorkflowActionStatus, WorkflowAuditKind,
  FinanceItemType, FinanceProcessingStatus, FinanceReviewStatus, FinanceOrigin,
  FinanceFieldSource, FinanceReferenceType, FinanceExpenseCategory, FinancePaymentMethod,
  CrmOrganizationRole, CrmRelationshipStatus, CrmSource, CrmContactMethodType,
  CrmOpportunityStage, CrmInteractionType, CrmDocumentRelation, CrmMatchReason,
  CrmLinkStatus, CrmEventKind, CrmLinkedEntity,
  FinanceExtractionStatus, FinanceQualityFlag, FinanceEventKind,
  ContractType, ContractReviewStatus, ContractLifecycleStatus, ContractDocumentRelation,
  ContractOrigin, ContractProcessingStatus, ContractExtractionStatus, ContractTermVersionStatus,
  ContractEndKind, ContractAutoRenewal, ContractPeriodUnit, ContractNoticeAnchor,
  ContractTerminationMethod, ContractCostFrequency, ContractMilestoneKind,
  ContractMilestoneSource, ContractMilestoneStatus, ContractQualityFlag, ContractEventKind,
  ContractAttentionClauseKind,
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
  // ---- Organizzazione aziendale (0017) --------------------------------------
  // Modificabile liberamente: NON descrive il documento, descrive dove l'azienda
  // lo tiene. Cambiarla non produce una `analysis_correction` e non tocca
  // l'analisi, che resta il verbale immutabile di ciò che il documento dice.
  category?: DocumentCategory | null;
  categorySource?: DocumentCategorySource | null;
  categorySetBy?: string | null;
  categorySetAt?: string | null;
  archivedAt?: string | null;
  archivedBy?: string | null;
  internalNotes?: string | null;
  notesUpdatedAt?: string | null;
  notesUpdatedBy?: string | null;
  pageCount?: number | null;
  fileHash?: string | null;
}

/** Importo rilevato (§12): la pipeline può estrarne più di uno, con tipo e citazione. */
export interface AnalysisAmount {
  amount: number;
  /** `null` quando il documento non la dichiara: non si presume CHF (§49). */
  currency: string | null;
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
  // 0010 — la bozza NON è più un campo dell'analisi: vive in document_replies
  // (tipo DocumentReply). Lo snapshot descrive il documento, non ciò che
  // l'utente ci scrive sopra.
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

// ---- Documenti (Smart Document Hub, 0017) -----------------------------------
// Il Hub non possiede dati sui documenti: li COMPONE. Mittente, tipo, scadenza
// e importi vengono dall'analisi; la correzione umana, se c'è, ha la
// precedenza; categoria, etichette, archiviazione e note sono l'unica parte che
// appartiene al Hub. Ogni campo «effettivo» porta accanto il flag che dice se a
// dirlo è stata una persona: senza quel flag la schermata mostrerebbe un
// valore corretto a mano come se l'avesse estratto l'AI.

export interface DocumentTag {
  id: string;
  name: string;
}

/** Stato dell'analisi come lo legge una persona, non come lo scrive il motore. */
export type DocumentState = 'analyzed' | 'to_verify' | 'failed' | 'processing' | 'none';

/** Una riga della lista Documenti, già composta dal database (§25). */
export interface DocumentHubItem {
  id: string;
  title: string;
  originalFilename: string | null;
  mimeType: string | null;
  fileSize: number | null;
  storagePath: string | null;
  sourceType: DocumentSourceType;
  status: DocumentStatus;
  pageCount: number | null;
  createdAt: string;
  archivedAt: string | null;
  category: DocumentCategory | null;
  categorySource: DocumentCategorySource | null;
  /** Esito dell'ULTIMO tentativo di analisi: dice lo stato, non il contenuto. */
  state: DocumentState;
  analysisId: string | null;
  /** L'ultimo tentativo è fallito ma resta disponibile un'analisi valida. */
  lastAttemptFailed: boolean;
  errorCode: string | null;
  /** Valori EFFETTIVI: correzione umana se presente, altrimenti dato dell'analisi. */
  documentType: string | null;
  documentTypeCorrected: boolean;
  sender: string | null;
  senderCorrected: boolean;
  senderAuthorityType: string | null;
  documentDate: string | null;
  deadline: string | null;
  deadlineCorrected: boolean;
  /** L'analisi dichiara che la scadenza va verificata: non è un fatto (§36). */
  deadlineRequiresVerification: boolean;
  amount: number | null;
  amountCurrency: string | null;
  amountCorrected: boolean;
  confidence: string | null;
  tags: DocumentTag[];
  openTaskCount: number;
  taskCount: number;
  /** Quante comunicazioni hanno portato questo documento (può essere > 1, §34). */
  emailCount: number;
  /** Estratto del testo dove compare il termine cercato. Testo semplice (§23). */
  snippet: string | null;
}

export interface DocumentPage {
  items: DocumentHubItem[];
  /** Quanti documenti soddisfano il filtro, non quanti ne sono stati consegnati. */
  total: number;
}

/** I filtri della lista. Tipizzati, mai `Record<string, unknown>` (§103). */
export interface DocumentHubFilters {
  query?: string | null;
  category?: DocumentCategory | null;
  /** Solo i documenti che nessuno ha ancora classificato. */
  uncategorized?: boolean;
  source?: DocumentSourceType | null;
  state?: DocumentState | null;
  tagIds?: string[] | null;
  /** Estremi sulla DATA DEL DOCUMENTO, con ripiego sulla data di importazione. */
  dateFrom?: string | null;
  dateTo?: string | null;
  hasDeadline?: boolean;
  archived?: boolean;
  sort?: DocumentSort;
  limit?: number;
  offset?: number;
}

export type DocumentSort = 'recent' | 'oldest' | 'document_date' | 'title' | 'deadline';

/** La comunicazione da cui un documento è arrivato (§33). */
export interface DocumentEmailSource {
  messageId: string;
  relation: EmailDocumentRelation;
  subject: string | null;
  senderName: string | null;
  senderEmail: string | null;
  receivedAt: string;
  accountEmail: string | null;
}

/**
 * Un'attività collegata al documento (§38).
 *
 * Porta l'IDENTIFICATIVO del responsabile, non il suo nome: `profiles` è
 * leggibile solo dal proprietario, e il nome di un collega si risolve dalla
 * rubrica `company_member_directory`. Un tipo che promettesse `assigneeName`
 * prometterebbe un dato che il database non dà.
 */
export interface DocumentLinkedTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assigneeUserId: string | null;
  archivedAt: string | null;
}

/** Informazioni tecniche: servono al supporto e a chi verifica, non in vetrina (§94). */
export interface DocumentTechnicalInfo {
  extractionMethod: string | null;
  charCount: number | null;
  ocrConfidence: number | null;
  truncated: boolean;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  engine: string | null;
  analysisCreatedAt: string | null;
}

/** Tutto ciò che il dettaglio di un documento mette insieme (§99). */
export interface DocumentDetail {
  document: DocumentRecord;
  item: DocumentHubItem;
  analysis: DocumentAnalysis | null;
  corrections: AnalysisCorrection[];
  tags: DocumentTag[];
  emails: DocumentEmailSource[];
  tasks: DocumentLinkedTask[];
  technical: DocumentTechnicalInfo | null;
  /** Altri documenti dell'azienda con lo STESSO contenuto (§46): stessa risorsa. */
  sameContentIds: string[];
}

// ---- Attività (Work Hub) ----------------------------------------------------
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
  /** Chi è responsabile. null = non assegnata, che è uno stato legittimo. */
  assigneeUserId: string | null;
  completedAt: string | null;
  completedBy: string | null;
  /** Archiviata: fuori dalle viste correnti, ancora nello storico. */
  archivedAt: string | null;
  archivedBy: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * L'esecuzione che l'ha creata, quando è nata da una regola (0020).
   * `null` per tutte le altre — la stragrande maggioranza.
   */
  workflowRunId: string | null;
}

/** Un'attività con i nomi già risolti, per non far fare join alla UI. */
export interface TaskWithPeople extends Task {
  assigneeName: string | null;
  /** La comunicazione da cui nasce, se il documento collegato viene da email. */
  emailMessageId: string | null;
}

export interface TaskChecklistItem {
  id: string;
  companyId: string;
  taskId: string;
  text: string;
  position: number;
  done: boolean;
  doneAt: string | null;
  doneBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskComment {
  id: string;
  companyId: string;
  taskId: string;
  authorUserId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  actorUserId: string | null;
  actorName: string | null;
  kind: TaskEventKind;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** Membro dell'azienda utilizzabile come assegnatario. */
export interface AssignableMember {
  userId: string;
  name: string;
  role: MemberRole;
}

// ---- Calendario e notifiche (0018) ------------------------------------------

/**
 * Una riga del calendario interno.
 *
 * ⚠️ È DELIBERATAMENTE POVERA. Non ha descrizione, checklist, commenti, storico
 * né analisi collegata: una griglia mensile con quaranta attività non deve
 * scaricare quaranta analisi documentali per disegnare quaranta righe di testo
 * (§22). Chi vuole il resto apre l'attività, che è a un clic.
 */
export interface CalendarTaskItem {
  id: string;
  title: string;
  /** `YYYY-MM-DD`. Sempre presente: senza scadenza un'attività non entra nel calendario. */
  dueDate: string;
  priority: TaskPriority;
  status: TaskStatus;
  source: TaskSource;
  assigneeUserId: string | null;
  assigneeName: string | null;
  documentId: string | null;
}

export interface CalendarConnection {
  id: string;
  companyId: string;
  userId: string;
  provider: CalendarProvider;
  emailAddress: string;
  /** Il calendario dedicato. `null` finché non è stato creato: stato legittimo. */
  providerCalendarId: string | null;
  calendarName: string | null;
  status: CalendarConnectionStatus;
  scopes: string[];
  syncEnabled: boolean;
  initialSyncCompletedAt: string | null;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  lastErrorCode: string | null;
  lastErrorAt: string | null;
}

export interface AppNotification {
  id: string;
  companyId: string;
  type: NotificationType;
  entityType: string;
  entityId: string;
  /** Solo metadati: titolo, scadenza, priorità. Mai contenuti di documenti o email. */
  payload: {
    title?: string; dueDate?: string | null; priority?: TaskPriority; kind?: string;
    /**
     * 0020 — il testo scritto dall'azienda dentro la regola, già reso. Non
     * passa dai dizionari perché non è testo del prodotto: è una frase che
     * l'azienda ha composto nella propria lingua, e tradurla la falserebbe.
     */
    text?: string; workflowName?: string; workflowId?: string;
    /**
     * 0026 — l'organizzazione di un'opportunità. Serve a `notificationLink`
     * per comporre `/clienti/:org/opportunita/:id`: senza, la campanella
     * porterebbe alla panoramica in silenzio. `stage` è la fase al momento
     * dell'assegnazione, e non si rilegge dopo: la notifica racconta un
     * istante, non lo stato di adesso.
     */
    organizationId?: string; stage?: string;
  };
  readAt: string | null;
  createdAt: string;
}

export interface NotificationPreferences {
  companyId: string;
  userId: string;
  inAppEnabled: boolean;
  emailEnabled: boolean;
  remind7Days: boolean;
  remind1Day: boolean;
  remindDueDay: boolean;
  remindOverdue: boolean;
  /** Fuso IANA. I promemoria si generano al mattino LOCALE di questa zona. */
  timezone: string;
  locale: string;
  /** §96 — quando è falso, il titolo dell'attività non lascia AI-Swisse. */
  showTaskTitle: boolean;
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

// ---- Inbox ------------------------------------------------------------------
// Il dominio parla di «connessione», «messaggio», «allegato»: la UI non vede
// mai una riga snake_case né sa che dietro c'è Gmail o Graph.

export interface EmailConnection {
  id: string;
  companyId: string;
  connectedBy: string | null;
  provider: EmailProvider;
  providerAccountId: string;
  emailAddress: string;
  displayName: string | null;
  status: EmailConnectionStatus;
  scopes: string[];
  syncEnabled: boolean;
  initialSyncCompletedAt: string | null;
  lastSyncAt: string | null;
  lastSuccessfulSyncAt: string | null;
  /** Codice tecnico del provider. Non si mostra: si mappa (§108). */
  lastErrorCode: string | null;
  lastErrorAt: string | null;
  watchExpiresAt: string | null;
  /** Valorizzato quando una sincronizzazione è in corso: è un lease, quindi scade. */
  syncLeaseUntil: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailRecipient {
  name: string | null;
  email: string;
}

/** Collegamento estratto dal corpo: `host` è la destinazione REALE (§56). */
export interface EmailLink {
  url: string;
  label: string;
  host: string;
}

/** Riga della lista: solo ciò che serve a decidere se aprire (§104/§105). */
export interface EmailMessageSummary {
  id: string;
  companyId: string;
  connectionId: string;
  threadId: string | null;
  subject: string | null;
  senderName: string | null;
  senderEmail: string | null;
  receivedAt: string;
  preview: string | null;
  hasAttachments: boolean;
  attachmentCount: number;
  processingStatus: EmailProcessingStatus;
  attentionStatus: EmailAttentionStatus;
  relevance: EmailRelevance | null;
  seenAt: string | null;
  handledAt: string | null;
  errorCode: string | null;
  /**
   * Scadenza rilevata dall'analisi collegata. È una COPIA sulla riga del
   * messaggio, tenuta per poter filtrare e ordinare senza join: la fonte di
   * verità — con citazione, fiducia e tipo — resta l'analisi, che il dettaglio
   * legge per intero.
   */
  deadline: string | null;
  /** Livello derivato dalla scadenza: scaduta · urgente · prossima · nessuna. */
  deadlineLevel: DeadlineLevel;
  daysToDeadline: number | null;
}

export interface EmailAttachment {
  id: string;
  emailMessageId: string;
  providerAttachmentId: string;
  filename: string | null;
  mimeType: string | null;
  declaredMimeType: string | null;
  sizeBytes: number | null;
  isInline: boolean;
  storagePath: string | null;
  importStatus: EmailAttachmentImportStatus;
  /** Perché non è stato importato. Chiave di traduzione, non frase. */
  skipReason: string | null;
  /** Documento AI-Swisse generato da questo allegato, se importato. */
  documentId: string | null;
}

/** Documento generato dal messaggio, con il ruolo che aveva nell'email. */
export interface EmailLinkedDocument {
  documentId: string;
  relation: EmailDocumentRelation;
  attachmentId: string | null;
  title: string;
  status: DocumentStatus;
}

export interface EmailMessageDetail extends EmailMessageSummary {
  toRecipients: EmailRecipient[];
  ccRecipients: EmailRecipient[];
  sentAt: string | null;
  bodyText: string | null;
  bodyLinks: EmailLink[];
  isBulk: boolean;
  importance: string | null;
  /** Motivazione breve del classificatore. Operativa, mai promozionale (§61). */
  relevanceReason: string | null;
  relevanceConfidence: number | null;
  errorMessageSafe: string | null;
  attachments: EmailAttachment[];
  documents: EmailLinkedDocument[];
  connection: { emailAddress: string; provider: EmailProvider } | null;
  /** Messaggi noti nello stesso thread, questo compreso (1 = nessun seguito). */
  threadCount: number;
}

/** Un filtro della Inbox. Il valore è una chiave, mai un'etichetta tradotta. */
export type InboxFilter = 'all' | 'to_handle' | 'urgent' | 'to_verify' | 'handled';

/** Pagina di risultati con cursore keyset (§76): niente offset su dataset grandi. */
export interface InboxPage {
  items: EmailMessageSummary[];
  /** Cursore per la pagina successiva; null = non c'è altro. */
  nextCursor: string | null;
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


// I tipi delle CONFIGURAZIONI vengono dal registro, non riscritti qui: il
// registro è l'unico posto in cui esistono i campi, gli operatori e le azioni
// ammesse, e una seconda dichiarazione diventerebbe la copia che diverge.
import type { WorkflowAction, WorkflowCondition } from '@/features/automations/registry';
export type { WorkflowAction, WorkflowCondition };

// ---------------------------------------------------------------------------
// Automazioni (0020)
//
// QUANDO succede X, SE valgono le condizioni Y, ALLORA esegui Z.
// Le forme applicative delle CONFIGURAZIONI non stanno qui: vivono nel registro
// (`supabase/functions/_shared/automation/registry.ts`), che è l'unico posto in
// cui esistono i campi, gli operatori e le azioni ammesse — e che il browser
// legge attraverso `src/features/automations/registry.ts`. Riscriverli qui
// avrebbe prodotto due elenchi da tenere allineati a mano.
// ---------------------------------------------------------------------------

/** Una regola, come la mostra l'elenco. */
export interface Workflow {
  id: string;
  companyId: string;
  name: string;
  description: string | null;
  status: WorkflowStatus;
  triggerType: AutomationEventType;
  conditionMatch: 'all' | 'any';
  conditions: WorkflowCondition[];
  actions: WorkflowAction[];
  version: number;
  /** Da quando è in vigore. Gli eventi precedenti non la riguardano (§163). */
  activatedAt: string | null;
  /**
   * Configurazione diventata invalida a regola già attiva: il responsabile è
   * uscito, l'etichetta è stata cancellata. È un CODICE — la frase la scrive
   * l'interfaccia nella lingua di chi legge.
   */
  attentionCode: string | null;
  attentionAt: string | null;
  consecutiveFailures: number;
  lastRunAt: string | null;
  lastRunStatus: WorkflowRunStatus | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Un'esecuzione. Immutabile: la scrive il worker. */
export interface WorkflowRun {
  id: string;
  companyId: string;
  workflowId: string;
  workflowVersion: number;
  /** La configurazione USATA: una run di ieri resta interpretabile (§46). */
  configSnapshot: {
    name?: string; version?: number; triggerType?: string;
    conditionMatch?: 'all' | 'any';
    conditions?: WorkflowCondition[]; actions?: WorkflowAction[];
  };
  triggerEventId: string | null;
  entityType: 'document' | 'email_message' | 'task' | null;
  entityId: string | null;
  status: WorkflowRunStatus;
  conditionResults: WorkflowConditionResult[];
  startedAt: string;
  completedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
}

/** L'esito di UNA condizione. `unknown` non è «no»: è «non lo so» (§26). */
export interface WorkflowConditionResult {
  field: string;
  operator: string;
  expected: string | number | boolean | string[] | null;
  currency?: string | null;
  outcome: 'true' | 'false' | 'unknown';
  reason?: 'missing' | 'low_confidence' | 'unverified_quote' | 'currency_mismatch' | 'unknown_field';
}

export interface WorkflowActionRun {
  id: string;
  workflowRunId: string;
  actionKey: string;
  actionPosition: number;
  status: WorkflowActionStatus;
  outputEntityType: string | null;
  outputEntityId: string | null;
  errorCode: string | null;
  completedAt: string | null;
}

export interface WorkflowAuditEntry {
  id: string;
  workflowId: string;
  actorUserId: string | null;
  kind: WorkflowAuditKind;
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface WorkflowMetrics {
  runs: number;
  actionsDone: number;
  actionsFailed: number;
  errors: number;
}

/** Un elemento su cui provare la regola, scelto fra quelli recenti. */
export interface AutomationSample { id: string; label: string | null }


// ---------------------------------------------------------------------------
// Finance Operations (0021)
//
// Il modulo COMPRENDE e PREPARA il denaro: non lo muove. In questi tipi non
// esiste nulla che descriva un pagamento eseguito, un ordine bancario o una
// registrazione contabile — e non è una dimenticanza, è il confine del prodotto
// finché non ci sono approvazioni, integrazione bancaria e riconciliazione.
//
// Come per il Document Hub, i valori sono già quelli EFFETTIVI (correzione
// umana se c'è, altrimenti estrazione) e ogni riga porta l'elenco dei campi che
// una persona ha corretto: senza, la schermata mostrerebbe un valore scritto a
// mano come se l'avesse letto la macchina.
// ---------------------------------------------------------------------------

/** Una riga della lista Finanze, già composta dal database. */
export interface FinanceItem {
  id: string;
  documentId: string;
  type: FinanceItemType;
  processingStatus: FinanceProcessingStatus;
  reviewStatus: FinanceReviewStatus;
  origin: FinanceOrigin;
  errorCode: string | null;
  expenseCategory: FinanceExpenseCategory | null;
  paymentMethod: FinancePaymentMethod | null;
  /** Le ragioni per cui questa fattura va guardata. Chiavi, non frasi. */
  qualityFlags: FinanceQualityFlag[];
  /** Calcolato adesso, non memorizzato: dipende da che cosa c'è intorno (§70). */
  duplicateSuspected: boolean;
  duplicateCount: number;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  expenseDate: string | null;
  merchant: string | null;
  currency: string | null;
  grossAmount: number | null;
  netAmount: number | null;
  vatAmount: number | null;
  /** ⚠️ Si mostra, non si trasforma MAI in un collegamento di pagamento (§41). */
  iban: string | null;
  referenceType: FinanceReferenceType | null;
  paymentReference: string | null;
  /** Quali campi ha corretto una persona: la schermata deve poterlo dire (§11). */
  correctedFields: string[];
  reviewedAt: string | null;
  reviewedBy: string | null;
  archivedAt: string | null;
  createdAt: string;
  extractionId: string | null;
  extractionVersion: number | null;
  documentTitle: string;
  documentSource: DocumentSourceType;
  documentStatus: DocumentStatus;
  storagePath: string | null;
  mimeType: string | null;
  openTaskCount: number;
  taskCount: number;
  emailCount: number;
}

export interface FinancePage {
  items: FinanceItem[];
  /** Quanti soddisfano il filtro, non quanti ne sono stati consegnati. */
  total: number;
}

/** I filtri della lista. Tipizzati, mai `Record<string, unknown>`. */
export interface FinanceFilters {
  tab?: 'invoices' | 'expenses' | null;
  query?: string | null;
  review?: FinanceReviewStatus | null;
  processing?: FinanceProcessingStatus | null;
  supplier?: string | null;
  currency?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  dueFrom?: string | null;
  dueTo?: string | null;
  source?: DocumentSourceType | null;
  category?: FinanceExpenseCategory | null;
  duplicates?: boolean;
  flagged?: boolean;
  archived?: boolean;
  sort?: FinanceSort;
  limit?: number;
  offset?: number;
}

export type FinanceSort = 'default' | 'due_date' | 'amount' | 'recent' | 'supplier';

/** Una riga del dettaglio IVA. Gli importi sono STRINGHE decimali (§48). */
export interface VatLine {
  rate: number;
  taxableBase: string | null;
  taxAmount: string | null;
  source: FinanceFieldSource;
}

/** Citazione di un campo estratto: da dove viene, nel testo del documento (§66). */
export interface FinanceEvidence {
  quote: string;
  start: number | null;
  end: number | null;
  page: number | null;
}

/** Il verbale immutabile della lettura finanziaria. */
export interface FinanceExtraction {
  id: string;
  financeItemId: string;
  documentId: string;
  extractionVersion: number;
  status: FinanceExtractionStatus;
  method: string;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  invoiceNumber: string | null;
  supplierName: string | null;
  supplierAddress: string | null;
  supplierVatId: string | null;
  supplierCountry: string | null;
  invoiceDate: string | null;
  dueDate: string | null;
  currency: string | null;
  grossAmount: number | null;
  netAmount: number | null;
  vatAmount: number | null;
  vatBreakdown: VatLine[];
  creditorIban: string | null;
  ibanIsQr: boolean | null;
  referenceType: FinanceReferenceType | null;
  paymentReference: string | null;
  qrPresent: boolean;
  qrValid: boolean | null;
  qrSpecVersion: string | null;
  qrErrors: string[];
  merchant: string | null;
  expenseDate: string | null;
  /** campo → da dove viene quel campo. È ciò che rende verificabile il verbale. */
  fieldSources: Record<string, FinanceFieldSource>;
  fieldConfidence: Record<string, number>;
  evidence: Record<string, FinanceEvidence>;
  uncertainties: { field: string; description: string; severity: 'low' | 'medium' | 'high' }[];
  qualityFlags: FinanceQualityFlag[];
  documentLanguage: string | null;
  errorCode: string | null;
  createdAt: string;
}

/** Una correzione umana. L'estrazione resta intatta (§10). */
export interface FinanceCorrection {
  id: string;
  financeItemId: string;
  documentId: string;
  extractionId: string | null;
  field: string;
  originalValue: unknown;
  correctedValue: unknown;
  correctedBy: string | null;
  correctedAt: string;
}

export interface FinanceEvent {
  id: string;
  financeItemId: string;
  actorUserId: string | null;
  kind: FinanceEventKind;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** Una controparte di possibile duplicato, per il confronto (§71). */
export interface FinanceDuplicate {
  id: string;
  documentId: string;
  supplierName: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  currency: string | null;
  grossAmount: number | null;
  reviewStatus: FinanceReviewStatus;
  createdAt: string;
}

/**
 * Un totale del cruscotto. ⚠️ SEMPRE per valuta, mai sommato fra valute (§22).
 * `total` è `null` quando la valuta non è nota: quelle fatture si CONTANO ma
 * non si sommano, perché un importo senza valuta non è un importo.
 */
export interface FinanceTotal {
  currency: string | null;
  n: number;
  total: number | null;
}

export interface FinanceSummary {
  needsReview: number;
  dueSoon: FinanceTotal[];
  overdue: FinanceTotal[];
  expensesMonth: FinanceTotal[];
}

/** Tutto ciò che il dettaglio di una fattura mette insieme. */
export interface FinanceDetail {
  item: FinanceItem;
  extraction: FinanceExtraction | null;
  /** Le versioni precedenti: un verbale non si corregge, si affianca (§9). */
  extractionHistory: { id: string; version: number; status: FinanceExtractionStatus; createdAt: string }[];
  corrections: FinanceCorrection[];
  events: FinanceEvent[];
  duplicates: FinanceDuplicate[];
  document: DocumentRecord | null;
  emails: DocumentEmailSource[];
  tasks: DocumentLinkedTask[];
}

// ---------------------------------------------------------------------------
// Contract Manager (0024)
//
// Il modulo RIPORTA che cosa il contratto dice: non dice che cosa il diritto
// impone. In questi tipi non esiste nulla che descriva una disdetta inviata,
// una firma, un rinnovo accettato o un parere — e non è una dimenticanza.
//
// ⚠️ LA DISTINZIONE CHE ATTRAVERSA TUTTI QUESTI TIPI: i termini mostrati sono
// quelli di una VERSIONE, e `termsAreDraft` dice se quella versione è stata
// verificata da una persona o è ancora una proposta del sistema. Senza quel
// booleano l'interfaccia mostrerebbe «Preavviso: 3 mesi» con la stessa faccia
// nei due casi, e la distinzione su cui è costruito il modulo sparirebbe
// proprio nel punto in cui qualcuno guarda.
// ---------------------------------------------------------------------------

/** Una riga della lista Contratti, già composta dal database. */
export interface ContractListItem {
  id: string;
  displayName: string;
  contractType: ContractType;
  counterpartyName: string | null;
  ownerUserId: string | null;
  reviewStatus: ContractReviewStatus;
  lifecycleStatus: ContractLifecycleStatus;
  origin: ContractOrigin;
  /** Le ragioni per cui questo contratto va guardato. Chiavi, non frasi. */
  qualityFlags: ContractQualityFlag[];
  internalNote: string | null;
  archivedAt: string | null;
  verifiedAt: string | null;
  createdAt: string;
  updatedAt: string;

  // ---- I termini effettivi, e la loro natura -------------------------------
  termVersionId: string | null;
  termVersion: number | null;
  /** ⚠️ `true` = ciò che vedi è una PROPOSTA, non un termine verificato. */
  termsAreDraft: boolean;
  startDate: string | null;
  endDate: string | null;
  endDateKind: ContractEndKind;
  autoRenewal: ContractAutoRenewal;
  renewalPeriodValue: number | null;
  renewalPeriodUnit: ContractPeriodUnit | null;
  noticePeriodValue: number | null;
  noticePeriodUnit: ContractPeriodUnit | null;
  noticeAnchor: ContractNoticeAnchor | null;
  /** La clausola COME È SCRITTA: è ciò che si mostra quando non si può calcolare. */
  noticeAnchorText: string | null;
  terminationMethod: ContractTerminationMethod | null;
  costAmount: number | null;
  costCurrency: string | null;
  costFrequency: ContractCostFrequency;
  priceAdjustment: boolean;

  // ---- Le prossime date, con il loro stato ---------------------------------
  // ⚠️ Una data `candidate` NON è una scadenza: è una proposta. La schermata
  // deve poterlo dire, e per questo lo stato viaggia accanto alla data.
  nextRenewalDate: string | null;
  nextRenewalStatus: ContractMilestoneStatus | null;
  nextNoticeDate: string | null;
  nextNoticeStatus: ContractMilestoneStatus | null;

  /** C'è una bozza in attesa mentre i termini in vigore sono altri (§27). */
  pendingDraftId: string | null;
  documentCount: number;
  amendmentCount: number;
  openTaskCount: number;
  processingPendingCount: number;
  processingFailedCount: number;
}

export interface ContractPage {
  items: ContractListItem[];
  /** Quanti soddisfano il filtro, non quanti ne sono stati consegnati. */
  total: number;
}

export type ContractView =
  | 'all' | 'needs_review' | 'active' | 'renewals' | 'notices' | 'archived';
export type ContractSort = 'default' | 'renewal' | 'notice' | 'name' | 'recent';

export interface ContractFilters {
  view?: ContractView | null;
  query?: string | null;
  type?: ContractType | null;
  lifecycle?: ContractLifecycleStatus | null;
  review?: ContractReviewStatus | null;
  owner?: string | null;
  autoRenewal?: ContractAutoRenewal | null;
  withoutOwner?: boolean;
  windowDays?: number | null;
  archived?: boolean;
  sort?: ContractSort;
  limit?: number;
  offset?: number;
}

/** §67 — pochi numeri, e ognuno porta a un'azione. */
export interface ContractSummary {
  needsReview: number;
  renewalsSoon: number;
  noticesSoon: number;
  withoutOwner: number;
  /** Non è un KPI: distingue «non c'è niente» da «non è ancora pronto». */
  processing: number;
}

/** Citazione di un campo estratto: da dove viene, nel testo del documento. */
export interface ContractEvidence {
  quote: string;
  start: number | null;
  end: number | null;
  page: number | null;
}

export interface ContractObligation {
  party: 'company' | 'counterparty' | 'both' | 'unclear';
  text: string;
  cadence: string | null;
  confidence: number;
  evidence: ContractEvidence;
}

/** §60 — una RILEVAZIONE, non un giudizio: «è presente una clausola di esclusiva». */
export interface ContractAttentionClause {
  kind: ContractAttentionClauseKind;
  text: string;
  evidence: ContractEvidence;
}

export interface ContractPenalty {
  text: string;
  amount: string | null;
  currency: string | null;
  evidence: ContractEvidence;
}

export interface ContractReferencedAnnex {
  text: string;
  evidence: ContractEvidence;
}

/** Un documento collegato al contratto, con il ruolo che vi ha. */
export interface ContractDocumentLink {
  id: string;
  documentId: string;
  relation: ContractDocumentRelation;
  origin: ContractOrigin;
  processingStatus: ContractProcessingStatus;
  extractionId: string | null;
  extractionAttempts: number;
  errorCode: string | null;
  suggested: boolean;
  addedAt: string;
  addedBy: string | null;
  title: string;
  storagePath: string | null;
  mimeType: string | null;
  documentCreatedAt: string;
}

/** Il verbale immutabile della lettura contrattuale di UN documento. */
export interface ContractExtraction {
  id: string;
  contractId: string;
  documentId: string;
  extractionVersion: number;
  status: ContractExtractionStatus;
  method: string;
  model: string | null;
  promptVersion: string | null;
  detectedType: ContractType | null;
  /** §3 — «sembra un contratto di lavoro»: si riporta, non si classifica. */
  outOfScopeKind: string | null;
  companyParty: string | null;
  counterparty: string | null;
  counterpartyAddress: string | null;
  documentDate: string | null;
  signatureDate: string | null;
  startDate: string | null;
  endDate: string | null;
  endDateKind: ContractEndKind;
  minimumTermValue: number | null;
  minimumTermUnit: ContractPeriodUnit | null;
  autoRenewal: ContractAutoRenewal;
  renewalPeriodValue: number | null;
  renewalPeriodUnit: ContractPeriodUnit | null;
  noticePeriodValue: number | null;
  noticePeriodUnit: ContractPeriodUnit | null;
  noticeAnchor: ContractNoticeAnchor | null;
  noticeAnchorText: string | null;
  terminationMethod: ContractTerminationMethod | null;
  terminationAddress: string | null;
  costAmount: number | null;
  costCurrency: string | null;
  costFrequency: ContractCostFrequency;
  costVatIncluded: boolean | null;
  priceAdjustment: boolean;
  obligations: ContractObligation[];
  attentionClauses: ContractAttentionClause[];
  penalties: ContractPenalty[];
  referencedAnnexes: ContractReferencedAnnex[];
  governingLaw: string | null;
  jurisdiction: string | null;
  signed: boolean | null;
  /** campo → citazione verificata contro il testo estratto (§17). */
  evidence: Record<string, ContractEvidence>;
  fieldConfidence: Record<string, number>;
  uncertainties: { field: string; description: string; severity: 'low' | 'medium' | 'high' }[];
  qualityFlags: ContractQualityFlag[];
  documentLanguage: string | null;
  /** §113 — il documento non ci stava per intero: una clausola può mancare. */
  truncated: boolean;
  errorCode: string | null;
  createdAt: string;
}

/** §25 — una versione dei termini. Verificata = immutabile e in vigore. */
export interface ContractTermVersion {
  id: string;
  contractId: string;
  version: number;
  status: ContractTermVersionStatus;
  effectiveFrom: string | null;
  counterpartyName: string | null;
  companyParty: string | null;
  startDate: string | null;
  endDate: string | null;
  endDateKind: ContractEndKind;
  minimumTermValue: number | null;
  minimumTermUnit: ContractPeriodUnit | null;
  autoRenewal: ContractAutoRenewal;
  renewalPeriodValue: number | null;
  renewalPeriodUnit: ContractPeriodUnit | null;
  noticePeriodValue: number | null;
  noticePeriodUnit: ContractPeriodUnit | null;
  noticeAnchor: ContractNoticeAnchor | null;
  noticeAnchorText: string | null;
  terminationMethod: ContractTerminationMethod | null;
  terminationAddress: string | null;
  costAmount: number | null;
  costCurrency: string | null;
  costFrequency: ContractCostFrequency;
  costVatIncluded: boolean | null;
  priceAdjustment: boolean;
  sourceExtractionIds: string[];
  basedOnVersionId: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  supersededAt: string | null;
  createdAt: string;
}

/** Una data del contratto. `candidate` non genera lavoro (§87). */
export interface ContractMilestone {
  id: string;
  contractId: string;
  termVersionId: string | null;
  kind: ContractMilestoneKind;
  dueDate: string;
  source: ContractMilestoneSource;
  status: ContractMilestoneStatus;
  /** §42 — da quale calcolo viene, se è stata calcolata. */
  calculation: string | null;
  calculationVersion: number | null;
  calculationInputs: Record<string, unknown>;
  label: string | null;
  windowOpenedAt: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  dismissedAt: string | null;
  dismissedBy: string | null;
  createdAt: string;
  /** Le attività già nate da questa data: serve alla dedup della Home (§93). */
  taskCount: number;
}

export interface ContractCorrection {
  id: string;
  contractId: string;
  termVersionId: string;
  field: string;
  originalValue: unknown;
  correctedValue: unknown;
  correctedBy: string | null;
  correctedAt: string;
}

export interface ContractEvent {
  id: string;
  contractId: string;
  actorUserId: string | null;
  kind: ContractEventKind;
  detail: Record<string, unknown>;
  createdAt: string;
}

/** Un documento che POTREBBE appartenere al contratto (§77). Si suggerisce. */
export interface ContractDocumentSuggestion {
  documentId: string;
  title: string;
  createdAt: string;
  category: DocumentCategory | null;
  reason: 'counterparty_in_title' | 'contract_category';
}

/** Un'attività collegata al contratto o a una sua data (§89/§90). */
export interface ContractLinkedTask {
  id: string;
  title: string;
  status: TaskStatus;
  priority: TaskPriority;
  dueDate: string | null;
  assigneeUserId: string | null;
  milestoneId: string | null;
}

export interface ContractDetail {
  contract: ContractListItem;
  /** I termini in vigore (o la bozza, se nessuno ha ancora verificato). */
  terms: ContractTermVersion | null;
  /** La bozza in attesa, quando i termini in vigore sono un'altra versione. */
  draft: ContractTermVersion | null;
  /** Le versioni precedenti: una verificata non si corregge, si affianca. */
  versionHistory: ContractTermVersion[];
  documents: ContractDocumentLink[];
  extractions: ContractExtraction[];
  milestones: ContractMilestone[];
  corrections: ContractCorrection[];
  events: ContractEvent[];
  tasks: ContractLinkedTask[];
}

// ============================================================================
// CRM Light (0026) — «con chi stiamo lavorando»
//
// ⚠️ Nessuno di questi tipi contiene una COPIA di un fatto di un altro modulo.
// `ContractOfOrganization.counterpartyName` è il nome che i Contratti hanno
// letto, letto DA LORO al momento della lettura; `FinanceOfOrganization.
// supplierName` è quello di Finanze. Il CRM li mostra accanto alla propria
// identità perché la differenza sia visibile — «il documento dice Swisscom
// (Svizzera) SA, e noi lo chiamiamo Swisscom» — non per sostituirli.
// ============================================================================

/**
 * Una controparte, come la vede una lista o una scheda. È il risultato di
 * `list_crm_organizations`: i conteggi arrivano già calcolati dal database.
 *
 * `primaryEmail` e `primaryPhone` sono COMPOSTI IN LETTURA da
 * `crm_contact_methods`, non colonne: due verità sullo stesso recapito
 * finirebbero per divergere.
 */
export interface CrmOrganization {
  id: string;
  displayName: string;
  /** La ragione sociale, quando è diversa da come la chiamiamo noi. */
  legalName: string | null;
  uidChe: string | null;
  vatNumber: string | null;
  website: string | null;
  websiteDomain: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  /** Sigla a due lettere. `null` quando non si sa — il registro non la dà nella ricerca per nome. */
  canton: string | null;
  countryCode: string | null;
  relationshipStatus: CrmRelationshipStatus;
  accountOwnerUserId: string | null;
  source: CrmSource;
  sourceDetail: string | null;
  notes: string | null;
  /**
   * Calcolato dal database dal massimo fra email collegate e interazioni di
   * tipo telefonata/incontro. `null` = mai contattata, che NON è come
   * «contattata molto tempo fa»: è il caso più urgente, non il meno.
   */
  lastContactAt: string | null;
  archivedAt: string | null;
  /** Se questa scheda è stata unita a un'altra, quale. Il rimando resta. */
  mergedIntoId: string | null;
  createdAt: string;
  updatedAt: string;
  roles: CrmOrganizationRole[];
  primaryContactId: string | null;
  primaryContactName: string | null;
  primaryEmail: string | null;
  primaryPhone: string | null;
  contactCount: number;
  openTaskCount: number;
  overdueTaskCount: number;
  openOpportunityCount: number;
  wonOpportunityCount: number;
  contractCount: number;
  documentCount: number;
  emailCount: number;
  financeCount: number;
}

export interface CrmContact {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  preferredLanguage: 'it' | 'de' | 'fr' | null;
  notes: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmContactMethod {
  id: string;
  contactId: string | null;
  organizationId: string | null;
  type: CrmContactMethodType;
  /** Il valore come l'ha scritto una persona. Non si riscrive mai. */
  value: string;
  /** La forma di confronto, scritta dal database. Per le email: minuscolo e spazi tolti, nient'altro. */
  normalizedValue: string | null;
  label: string | null;
  isPrimary: boolean;
}

/** Dove lavora, e dove lavorava: `activeUntil` valorizzato è un rapporto concluso, non cancellato. */
export interface CrmContactOrganization {
  id: string;
  contactId: string;
  organizationId: string;
  organizationName: string | null;
  jobTitle: string | null;
  department: string | null;
  isPrimary: boolean;
  activeFrom: string | null;
  activeUntil: string | null;
}

/** Una persona con i suoi recapiti e il suo ruolo dentro un'organizzazione. */
export interface CrmPerson {
  contact: CrmContact;
  methods: CrmContactMethod[];
  organizations: CrmContactOrganization[];
}

/**
 * Una trattativa.
 *
 * ⚠️ Non c'è `probability`, e non è una dimenticanza: «Offerta = 50%» ha
 * l'aria di una misura e non deriva da niente (§44). `valueAmount` porta
 * SEMPRE la sua valuta e non si somma con le altre (§45).
 */
export interface CrmOpportunity {
  id: string;
  organizationId: string;
  organizationName: string;
  primaryContactId: string | null;
  primaryContactName: string | null;
  title: string;
  stage: CrmOpportunityStage;
  ownerUserId: string | null;
  valueAmount: number | null;
  valueCurrency: string | null;
  expectedCloseDate: string | null;
  /** La sintesi commerciale. Il lavoro è un'attività, e si collega (§50). */
  nextStep: string | null;
  nextStepDueDate: string | null;
  lostReason: string | null;
  wonAt: string | null;
  lostAt: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  openTaskCount: number;
  overdueTaskCount: number;
  documentCount: number;
}

export interface CrmInteraction {
  id: string;
  organizationId: string;
  contactId: string | null;
  opportunityId: string | null;
  type: CrmInteractionType;
  occurredAt: string;
  subject: string | null;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CrmEvent {
  id: string;
  organizationId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  kind: CrmEventKind;
  detail: Record<string, unknown>;
  actorUserId: string | null;
  occurredAt: string;
}

/**
 * Una riga di timeline. COMPONE riferimenti: `title` è un oggetto o un titolo,
 * mai il corpo di una email o il testo di un documento (§61). Per leggere la
 * cosa vera si apre `entityType`/`entityId`.
 */
export interface CrmTimelineEntry {
  id: string;
  kind: 'email' | 'interaction' | 'event' | 'task_created' | 'task_completed' | 'contract';
  occurredAt: string;
  title: string | null;
  detail: Record<string, unknown>;
  entityType: string;
  entityId: string;
  actorUserId: string | null;
  contactId: string | null;
  opportunityId: string | null;
  /**
   * L'identificativo di conversazione del provider, quando c'è. Il
   * raggruppamento («Conversazione email — 4 messaggi») lo fa la schermata: nel
   * dato sarebbe una scelta che vincola anche i messaggi non ancora arrivati.
   */
  threadKey: string | null;
}

/** Un sospetto, non un cliente. Nasce dal codice server-side e attende un sì. */
export interface CrmLinkSuggestion {
  id: string;
  sourceEntityType: CrmLinkedEntity;
  sourceEntityId: string;
  suggestedOrganizationId: string | null;
  suggestedContactId: string | null;
  suggestedName: string | null;
  suggestedEmail: string | null;
  reason: CrmMatchReason;
  /** Il perché in chiaro, non un punteggio: «il dominio coincide con il sito». */
  reasonDetail: string | null;
  status: CrmLinkStatus;
  createdAt: string;
}

export interface CrmDuplicateCandidate {
  organizationId: string;
  displayName: string;
  duplicateId: string;
  duplicateName: string;
  reason: CrmMatchReason;
  reasonDetail: string | null;
}

export interface CrmEmailMatch {
  organizationId: string | null;
  organizationName: string | null;
  contactId: string | null;
  contactName: string | null;
  reason: CrmMatchReason;
  reasonDetail: string | null;
}

export interface CrmOrganizationOption {
  id: string;
  displayName: string;
  city: string | null;
  roles: CrmOrganizationRole[];
}

/** Le quattro misure della pagina iniziale, e nessuna quinta (§100, §101). */
export interface CrmHomeSummary {
  openOpportunities: number;
  withoutNextStep: number;
  overdueFollowUps: number;
  staleRelationships: number;
  pendingSuggestions: number;
}

/** Un totale PER VALUTA. Non esiste un totale unico (§45). */
export interface CrmPipelineCell {
  stage: CrmOpportunityStage;
  currency: string | null;
  opportunityCount: number;
  totalAmount: number | null;
}

/** Un documento collegato alla controparte, con il ruolo che ha nel rapporto. */
export interface CrmDocumentLink {
  id: string;
  documentId: string;
  title: string | null;
  category: DocumentCategory | null;
  /**
   * ⚠️ Quando il documento è stato CARICATO, non la data che porta stampata:
   * `documents` non ha una colonna di data, e la data del documento è un valore
   * EFFETTIVO che vive in `document_analyses` più le correzioni. Comporla qui
   * richiederebbe `list_documents`; chiamare `created_at` «data del documento»
   * sarebbe più comodo e falso. Chi vuole la data vera apre il documento.
   */
  uploadedAt: string | null;
  relation: CrmDocumentRelation;
  matchReason: CrmMatchReason;
  createdAt: string;
}

/** Una comunicazione collegata: solo metadati, mai il corpo. */
export interface CrmEmailLink {
  id: string;
  emailMessageId: string;
  subject: string | null;
  senderName: string | null;
  senderEmail: string | null;
  receivedAt: string | null;
  threadKey: string | null;
  matchReason: CrmMatchReason;
}

/**
 * Un contratto con questa controparte. `counterpartyName` è il nome che i
 * Contratti hanno letto: si mostra accanto, non al posto dell'identità CRM.
 */
export interface CrmContractLink {
  id: string;
  displayName: string;
  contractType: string;
  lifecycleStatus: string;
  reviewStatus: string;
  counterpartyName: string | null;
  ownerUserId: string | null;
}

/**
 * Una fattura fornitore collegata. `supplierName` resta quello estratto dal
 * documento.
 *
 * ⚠️ Non esiste il corrispettivo «fatture cliente»: Finanze gestisce fatture
 * fornitore e spese. Il CRM non mostra ricavi, perché non ne ha (§77).
 */
export interface CrmFinanceLink {
  id: string;
  documentId: string;
  type: string;
  supplierName: string | null;
  grossAmount: number | null;
  currency: string | null;
  dueDate: string | null;
  reviewStatus: string;
}

export interface CrmOrganizationDetail {
  organization: CrmOrganization;
  people: CrmPerson[];
  methods: CrmContactMethod[];
  opportunities: CrmOpportunity[];
  interactions: CrmInteraction[];
  documents: CrmDocumentLink[];
  emails: CrmEmailLink[];
  contracts: CrmContractLink[];
  finance: CrmFinanceLink[];
  duplicates: CrmDuplicateCandidate[];
}

// ============================================================================
// COMPANY ASSISTANT (0027) — «Chiedi ad AI-Swisse»
//
// ⚠️ Nessun tipo qui dentro contiene un dato aziendale copiato. Una citazione è
// un RIFERIMENTO: tipo di fonte, identificativo, rotta interna, titolo, e al
// massimo l'istantanea minima del valore su cui la risposta si basava (§92).
// ============================================================================

export type AssistantAnswerStatus =
  | 'answered'
  | 'partial'
  | 'insufficient_evidence'
  | 'needs_disambiguation'
  | 'out_of_scope';

export type AssistantSourceType =
  | 'document' | 'document_evidence' | 'email_message' | 'task' | 'finance_item'
  | 'contract' | 'contract_milestone' | 'contract_term' | 'crm_organization'
  | 'crm_opportunity' | 'workflow_run' | 'workflow_definition' | 'company_overview';

/**
 * §24 — quanto è affidabile una fonte, in ordine di precedenza.
 *
 * ⚠️ È `null` quando non si può dedurre dall'istantanea conservata: la 0027 non
 * memorizza il livello, perché è una proprietà della LETTURA e non della fonte.
 * Un contratto in bozza oggi può essere verificato domani, e mostrare un
 * giudizio vecchio di un mese sarebbe peggio che non mostrarne nessuno.
 */
export type AssistantVerification =
  | 'human_verified' | 'deterministic' | 'ai_with_evidence' | 'ai_unverified';

export type AssistantFeedbackReason = 'wrong_data' | 'wrong_source' | 'incomplete' | 'misunderstood';

export interface AssistantThread {
  id: string;
  title: string;
  locale: 'it' | 'de' | 'fr';
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface AssistantCitation {
  index: number;
  sourceType: AssistantSourceType;
  /** Nullo per una citazione aggregata: là contano `groupSize` e la rotta. */
  sourceId: string | null;
  groupSize: number | null;
  /** Rotta INTERNA dell'applicazione. Mai un indirizzo esterno (§106). */
  route: string;
  title: string;
  subtitle: string | null;
  pageNumber: number | null;
  fieldName: string | null;
  /** Testo preso dalla fonte, già verificato a monte (§62). */
  citedText: string | null;
  valueSnapshot: Record<string, unknown> | null;
  sourceVersion: string | null;
  verification: AssistantVerification | null;
}

export interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  answerStatus: AssistantAnswerStatus | null;
  uncertainty: string | null;
  followUps: string[];
  createdAt: string;
  citations: AssistantCitation[];
}

/**
 * Gli eventi del flusso (§112).
 *
 * ⚠️ Nessuno di questi trasporta il ragionamento del modello: dicono che cosa
 * il SISTEMA sta facendo. La differenza fra «cerco nelle attività» e «sto
 * ragionando passo per passo» è §113, ed è nel tipo prima che nella copy.
 */
export type AssistantStreamEvent =
  | { type: 'run_started'; runId: string; threadId: string }
  | { type: 'tool_started'; toolKey: string; module: string; seq: number }
  | { type: 'tool_finished'; toolKey: string; module: string; seq: number; status: string; resultCount: number }
  | { type: 'composing' }
  | { type: 'answer'; messageId: string; answer: AssistantPublicAnswer }
  | { type: 'error'; code: string; message: string }
  | { type: 'done' };

export interface AssistantPublicAnswer {
  status: AssistantAnswerStatus;
  text: string;
  uncertainty: string | null;
  followUps: string[];
  citations: AssistantCitation[];
  /** §30 — le entità fra cui l'utente deve scegliere, già cliccabili. */
  disambiguation: { label: string; hint: string | null; route: string }[];
  /** §144 — gli strumenti che non hanno risposto: la risposta lo dichiara. */
  degraded: string[];
}

/** §120 — da quale scheda è partita la domanda. Il server la verifica (§122). */
export interface AssistantEntityContext {
  type: 'contract' | 'crm_organization' | 'finance_item' | 'document' | 'task';
  id: string;
  label: string;
}
