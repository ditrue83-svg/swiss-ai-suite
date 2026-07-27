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
  reason?: 'missing' | 'low_confidence' | 'currency_mismatch' | 'unknown_field';
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
