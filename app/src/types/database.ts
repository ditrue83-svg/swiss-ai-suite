// ============================================================================
// Tipi del database (stile "Supabase generated types").
// Se in futuro usi la CLI: `supabase gen types typescript --linked > src/types/database.ts`
// sostituirà questo file mantenendo la stessa forma (Database → public → Tables…).
// I campi jsonb sono tipati come `Json`; le forme applicative precise stanno in models.ts
// e la mappatura avviene nel service layer.
//
// Allineato alla migrazione 0006 (pipeline Admin AI reale): estrazioni per pagina,
// schema ricco su document_analyses, bozze, correzioni umane, log tecnico.
// ============================================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type MemberRole = 'owner' | 'admin' | 'member';
export type DocumentSourceType = 'upload' | 'pasted_text' | 'email';
// §25 — nuovi stati della pipeline. I legacy 'processing'/'analyzed' restano validi.
export type DocumentStatus =
  | 'uploaded' | 'extracting' | 'analyzing' | 'completed' | 'needs_review' | 'failed'
  | 'processing' | 'analyzed';
export type AnalysisStatus = 'pending' | 'completed' | 'needs_review' | 'failed';
export type ExtractionMethod = 'native_pdf' | 'ocr' | 'text';
/**
 * Categoria documentale (0017). NON è il tipo di documento: `DocumentType` dice
 * che cosa è un documento, la categoria dice dove sta nell'organizzazione
 * dell'azienda. Un sollecito dell'AFC è di tipo «sollecito» e di categoria
 * «imposte». Nel database si salva la chiave tecnica; l'etichetta si risolve al
 * render dai dizionari.
 * L'assenza di categoria (`null`) è uno stato legittimo — nessuno ha ancora
 * classificato — e va tenuta distinta da `other`, che è una scelta esplicita.
 */
export type DocumentCategory =
  | 'administration' | 'taxes' | 'social_insurance' | 'invoices' | 'contracts'
  | 'insurance' | 'banking' | 'employees' | 'clients' | 'suppliers' | 'subsidies' | 'other';
/** Chi ha deciso la categoria. Nessun valore `ai`: nessuna AI classifica. */
/**
 * Chi ha deciso la categoria. Nessun valore `ai`: nessuna AI classifica.
 * `rule` = la regola deterministica del prodotto (tipo di documento + ente),
 * `workflow` = una regola scritta dall'azienda (0020). Sono due cose diverse e
 * il documento deve poter dire quale delle due.
 */
export type DocumentCategorySource = 'rule' | 'manual' | 'workflow';
export type TaskPriority = 'low' | 'medium' | 'high';
/**
 * Stato di un'attività. `open` è il nome storico del database e nell'interfaccia
 * si chiama «Da fare»: rinominarlo avrebbe richiesto una migrazione distruttiva
 * su dati esistenti, per guadagnare solo una parola.
 */
export type TaskStatus = 'open' | 'in_progress' | 'waiting' | 'completed';
export type TaskEventKind =
  | 'created' | 'status_changed' | 'assignee_changed' | 'priority_changed'
  | 'due_date_changed' | 'completed' | 'reopened' | 'archived' | 'restored'
  | 'checklist_item_completed' | 'comment_added';
/**
 * Da dove nasce il lavoro. `workflow` (0020) è la provenienza di un'attività
 * creata da una REGOLA aziendale: non l'ha scritta una persona e non viene da
 * un modulo, e chi la riceve ha diritto di saperlo. Quale regola lo dice
 * `tasks.workflow_run_id`.
 */
export type TaskSource = 'admin_ai' | 'subsidy_ai' | 'manual' | 'workflow';
export type EligibilityStatus = 'unknown' | 'likely' | 'unlikely' | 'ineligible';
export type SubsidyCaseStatus = 'draft' | 'collecting_documents' | 'ready' | 'submitted' | 'closed';

// ---- Inbox (0013) ----------------------------------------------------------
// Enum separati per stati che descrivono cose diverse (§8 del capitolato):
// dove è arrivata la macchina (`EmailProcessingStatus`), cosa deve fare una
// persona (`EmailAttentionStatus`), cosa ha concluso il classificatore
// (`EmailRelevance`). Fonderli renderebbe un guasto tecnico indistinguibile da
// «niente da fare».
export type EmailProvider = 'google' | 'microsoft';
export type EmailConnectionStatus = 'active' | 'reauth_required' | 'error' | 'disconnected';
export type EmailSyncType = 'initial' | 'incremental' | 'manual' | 'reconciliation';
export type EmailSyncStatus = 'running' | 'ok' | 'partial' | 'failed';
export type EmailProcessingStatus =
  | 'pending' | 'classifying' | 'importing' | 'awaiting_analysis' | 'analyzing' | 'done' | 'failed';
export type EmailAttentionStatus = 'needs_attention' | 'to_verify' | 'informational' | 'ignored' | 'handled';
export type EmailRelevance = 'likely_actionable' | 'possibly_actionable' | 'informational' | 'clearly_irrelevant';
export type EmailDocumentRelation = 'body' | 'attachment';
export type EmailAttachmentImportStatus =
  | 'pending' | 'imported' | 'skipped_inline' | 'skipped_unsupported' | 'skipped_too_large' | 'failed';

// ---- Calendario e notifiche (0018) -----------------------------------------
// `CalendarProvider` è un tipo PROPRIO e non un alias di `EmailProvider`: oggi
// hanno gli stessi due valori per coincidenza, e legarli significherebbe che
// aggiungere un provider di calendario ne aggiunge uno di posta.
export type CalendarProvider = 'google' | 'microsoft';
export type CalendarConnectionStatus = 'active' | 'reauth_required' | 'error' | 'disconnected';
/** Stato di un collegamento fra attività ed evento. `pending` è normale, non un guasto. */
export type CalendarSyncStatus = 'pending' | 'synced' | 'failed';
export type NotificationType =
  | 'task_assigned' | 'task_due_soon' | 'task_due_today' | 'task_overdue'
  | 'unassigned_task_due_soon' | 'calendar_sync_failed' | 'calendar_reauth_required'
  // 0020 — l'avviso prodotto da una regola aziendale. Il TESTO lo scrive
  // l'azienda dentro la regola: non è traducibile, ed è dichiarato come tale.
  | 'workflow_alert';
/** L'in-app non è un canale: l'in-app È la notifica. Vedi 0018. */
export type NotificationChannel = 'email';

// ---- Automazioni (0020) ----------------------------------------------------
// Gli inneschi sono SEI e corrispondono a fatti che il prodotto produce
// davvero: un innesco dichiarato e mai emesso sarebbe una funzione finta.
export type AutomationEventType =
  | 'document_analysis_completed' | 'document_category_changed' | 'email_attention_ready'
  | 'task_created' | 'task_status_changed' | 'task_became_overdue'
  // 0021 — i due inneschi di Finance. L'entità resta il DOCUMENTO: vedi il
  // registro, dove è spiegato perché non è stata introdotta un'entità nuova.
  | 'finance_item_needs_review' | 'finance_item_ready';
export type AutomationEventStatus = 'pending' | 'processing' | 'done' | 'failed' | 'dead_letter';
/**
 * Stato di una regola. L'archiviazione è uno STATO — non una data come per le
 * attività — perché ogni interrogazione del motore filtra proprio su questo
 * campo, e una regola archiviata non deve comparire in nessun elenco operativo.
 */
export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived';
export type WorkflowRunStatus = 'pending' | 'running' | 'succeeded' | 'partial' | 'failed' | 'skipped';
export type WorkflowActionStatus = 'pending' | 'succeeded' | 'skipped' | 'failed';
export type WorkflowAuditKind =
  | 'created' | 'updated' | 'activated' | 'paused' | 'archived' | 'restored'
  | 'retried' | 'auto_paused' | 'chain_depth_exceeded';
export type NotificationDeliveryStatus = 'pending' | 'sending' | 'sent' | 'failed' | 'cancelled';

// ---- Finance Operations (0021) ---------------------------------------------
// Fatture fornitori, ricevute e note di credito. Il modulo COMPRENDE e PREPARA
// il denaro: non lo muove. Non esiste alcun tipo che descriva un pagamento, un
// ordine bancario o una registrazione contabile, e non è una dimenticanza.
export type FinanceItemType = 'supplier_invoice' | 'receipt' | 'credit_note';
/** A che punto è la MACCHINA. Non dice nulla su che cosa debba fare una persona. */
export type FinanceProcessingStatus = 'pending' | 'processing' | 'completed' | 'failed';
/**
 * Che cosa deve fare una PERSONA. Separato dal precedente di proposito (§109):
 * «l'estrazione è fallita» e «i dati vanno verificati» sono cose diverse.
 * `archived` NON è qui: l'archiviazione è un `archived_at`, come su documenti e
 * attività — altrimenti archiviare una fattura verificata cancellerebbe
 * l'informazione che era stata verificata.
 */
export type FinanceReviewStatus = 'needs_review' | 'ready';
/** Chi ha deciso che il documento è finanziario. Nessun valore `ai`. */
export type FinanceOrigin = 'rule' | 'manual' | 'workflow';
/** Da dove viene UN SINGOLO campo (§101). */
export type FinanceFieldSource = 'qr' | 'deterministic' | 'ai' | 'human';
/** Riferimento di pagamento svizzero: QR, creditore ISO 11649, oppure nessuno. */
export type FinanceReferenceType = 'qrr' | 'scor' | 'non';
/** Organizzazione di una spesa. ⚠️ NON è un conto contabile (§57). */
export type FinanceExpenseCategory =
  | 'travel' | 'meals' | 'office' | 'software' | 'vehicle' | 'other';
export type FinancePaymentMethod = 'card' | 'cash' | 'other';
export type FinanceExtractionStatus = 'completed' | 'failed';
/** Che cosa non torna. Chiavi, non frasi: la frase la scrive l'interfaccia. */
export type FinanceQualityFlag =
  | 'amount_mismatch' | 'vat_mismatch' | 'qr_text_mismatch'
  | 'missing_currency' | 'missing_total' | 'missing_supplier'
  | 'duplicate_suspected' | 'low_ocr_confidence'
  | 'invalid_iban' | 'invalid_reference' | 'reference_type_mismatch'
  | 'inconsistent_due_date' | 'ambiguous_date' | 'qr_not_read' | 'negative_amount';
export type FinanceEventKind =
  | 'created' | 'extraction_completed' | 'extraction_failed' | 'corrected'
  | 'reviewed' | 'reopened' | 'archived' | 'restored' | 'type_changed'
  | 'category_changed' | 'retry_requested';

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: { id: string; first_name: string; last_name: string; email: string | null; created_at: string; updated_at: string };
        Insert: { id: string; first_name?: string; last_name?: string; email?: string | null };
        Update: { first_name?: string; last_name?: string; email?: string | null };
        Relationships: [];
      };
      companies: {
        Row: { id: string; legal_name: string; uid_che: string | null; canton: string | null; municipality: string | null; legal_form: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; legal_name: string; uid_che?: string | null; canton?: string | null; municipality?: string | null; legal_form?: string | null };
        Update: { legal_name?: string; uid_che?: string | null; canton?: string | null; municipality?: string | null; legal_form?: string | null };
        Relationships: [];
      };
      company_members: {
        Row: { id: string; company_id: string; user_id: string; role: MemberRole; created_at: string };
        Insert: { id?: string; company_id: string; user_id: string; role?: MemberRole };
        Update: { role?: MemberRole };
        Relationships: [];
      };
      company_profiles: {
        Row: { company_id: string; sector: string | null; employee_count: number | null; revenue_band: string | null; owns_property: boolean; vehicle_count: number; current_projects: Json; created_at: string; updated_at: string };
        Insert: { company_id: string; sector?: string | null; employee_count?: number | null; revenue_band?: string | null; owns_property?: boolean; vehicle_count?: number; current_projects?: Json };
        Update: { sector?: string | null; employee_count?: number | null; revenue_band?: string | null; owns_property?: boolean; vehicle_count?: number; current_projects?: Json };
        Relationships: [];
      };
      documents: {
        Row: {
          id: string; company_id: string; uploaded_by: string | null; title: string;
          original_filename: string | null; mime_type: string | null; file_size: number | null;
          storage_path: string | null; source_type: DocumentSourceType; status: DocumentStatus;
          file_hash: string | null; page_count: number | null; created_at: string; updated_at: string;
          // 0017 — organizzazione aziendale. Il dato del documento resta nell'analisi.
          category: DocumentCategory | null; category_source: DocumentCategorySource | null;
          category_set_by: string | null; category_set_at: string | null;
          archived_at: string | null; archived_by: string | null;
          internal_notes: string | null; notes_updated_at: string | null; notes_updated_by: string | null;
          // 0020 — quale esecuzione di quale regola ha messo la categoria.
          category_workflow_run_id: string | null;
        };
        Insert: { id?: string; company_id: string; uploaded_by?: string | null; title: string; original_filename?: string | null; mime_type?: string | null; file_size?: number | null; storage_path?: string | null; source_type?: DocumentSourceType; status?: DocumentStatus; file_hash?: string | null; page_count?: number | null };
        // 0017 — `category_source`, `category_set_by/at`, `archived_by` e i timbri
        // della nota NON compaiono: li scrive il trigger `documents_guard`, e un
        // client che li mandasse li vedrebbe comunque sovrascritti. `archived_at`
        // c'è perché è il modo in cui si DICHIARA di voler archiviare; il valore
        // vero lo mette il database.
        Update: {
          title?: string; original_filename?: string | null; mime_type?: string | null;
          file_size?: number | null; storage_path?: string | null; source_type?: DocumentSourceType;
          status?: DocumentStatus; file_hash?: string | null; page_count?: number | null;
          category?: DocumentCategory | null; archived_at?: string | null; internal_notes?: string | null;
        };
        Relationships: [];
      };
      document_tags: {
        Row: { id: string; company_id: string; name: string; created_by: string | null; created_at: string };
        // `created_by` lo imposta il trigger: chi crea un'etichetta è chi sta scrivendo.
        Insert: { id?: string; company_id: string; name: string };
        Update: { name?: string };
        Relationships: [];
      };
      document_tag_links: {
        Row: { company_id: string; document_id: string; tag_id: string; created_by: string | null; created_at: string };
        Insert: { company_id: string; document_id: string; tag_id: string };
        // Un collegamento non si modifica: si toglie e si rimette.
        Update: Record<string, never>;
        Relationships: [];
      };
      document_extractions: {
        Row: {
          id: string; document_id: string; company_id: string; extraction_method: ExtractionMethod;
          full_text: string | null; pages: Json; page_count: number | null; char_count: number | null;
          ocr_confidence: number | null; truncated: boolean; duration_ms: number | null; created_at: string;
        };
        // 0010 — la scrive solo la pipeline con service role (_shared/persist.ts).
        // Dal client è in sola lettura: è il testo su cui si verificano le
        // citazioni (§20), riscriverlo permetterebbe di far "verificare" una
        // citazione assente dal documento.
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      document_analyses: {
        Row: {
          id: string; document_id: string; company_id: string; extraction_id: string | null;
          analysis_version: number; analysis_status: AnalysisStatus; engine: string;
          provider: string | null; model: string | null; prompt_version: string | null; schema_version: number;
          processing_started_at: string | null; processing_completed_at: string | null;
          error_code: string | null; error_message_safe: string | null; input_tokens: number | null; output_tokens: number | null;
          // legacy (consumate dalla UI attuale)
          language: string | null; sender: string | null; sender_evidence: Json | null; document_type: string | null;
          deadline: string | null; deadline_evidence: Json | null; amount: number | null; amount_currency: string | null; amount_type: string | null; amount_evidence: Json | null;
          summary: string | null; actions: Json; requested_documents: Json; risks: Json | null; uncertainties: Json;
          confidence: string | null; reply_draft: string | null; reply_language: string | null; reply_tone: string | null;
          // ricche (§6–18/§23)
          overall_confidence: number | null; document_type_confidence: number | null;
          sender_authority_type: string | null; sender_confidence: number | null;
          recipient: string | null; subject: string | null; document_date: string | null; reply_needed: boolean | null;
          deadline_type: string | null; deadline_source_text: string | null; deadline_confidence: number | null; deadline_requires_verification: boolean;
          amounts: Json; reference_numbers: Json; legal_references: Json; sender_evidence_list: Json;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; document_id: string; company_id: string; extraction_id?: string | null;
          analysis_version?: number; analysis_status?: AnalysisStatus; engine?: string;
          provider?: string | null; model?: string | null; prompt_version?: string | null; schema_version?: number;
          processing_started_at?: string | null; processing_completed_at?: string | null;
          error_code?: string | null; error_message_safe?: string | null; input_tokens?: number | null; output_tokens?: number | null;
          language?: string | null; sender?: string | null; sender_evidence?: Json | null; document_type?: string | null;
          deadline?: string | null; deadline_evidence?: Json | null; amount?: number | null; amount_currency?: string | null; amount_type?: string | null; amount_evidence?: Json | null;
          summary?: string | null; actions?: Json; requested_documents?: Json; risks?: Json | null; uncertainties?: Json;
          // 0010 — reply_draft/reply_language/reply_tone non sono più inseribili:
          // deprecate, la bozza vive in document_replies.
          confidence?: string | null;
          overall_confidence?: number | null; document_type_confidence?: number | null;
          sender_authority_type?: string | null; sender_confidence?: number | null;
          recipient?: string | null; subject?: string | null; document_date?: string | null; reply_needed?: boolean | null;
          deadline_type?: string | null; deadline_source_text?: string | null; deadline_confidence?: number | null; deadline_requires_verification?: boolean;
          amounts?: Json; reference_numbers?: Json; legal_references?: Json; sender_evidence_list?: Json;
        };
        // 0010 — lo snapshot è immutabile: il client non ha più il permesso di
        // update sulla tabella. Il tipo vuoto rende l'errore visibile in fase di
        // typecheck invece che a runtime come errore RLS.
        Update: Record<string, never>;
        Relationships: [];
      };
      action_progress: {
        Row: {
          id: string; analysis_id: string; company_id: string; action_index: number;
          action_text: string | null; done: boolean; done_by: string | null; done_at: string | null;
          created_at: string; updated_at: string;
        };
        // done_by/done_at li imposta il trigger set_action_progress_actor: non
        // vanno inviati dal client.
        Insert: {
          id?: string; analysis_id: string; company_id: string; action_index: number;
          action_text?: string | null; done?: boolean;
        };
        Update: { done?: boolean; action_text?: string | null };
        Relationships: [];
      };
      document_replies: {
        Row: {
          id: string; document_id: string; company_id: string; analysis_id: string | null; created_by: string | null;
          language: string; tone: string; content: string; provider: string | null; model: string | null;
          prompt_version: string | null; is_edited: boolean; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; document_id: string; company_id: string; analysis_id?: string | null; created_by?: string | null;
          language: string; tone: string; content: string; provider?: string | null; model?: string | null;
          prompt_version?: string | null; is_edited?: boolean;
        };
        Update: { content?: string; language?: string; tone?: string; is_edited?: boolean };
        Relationships: [];
      };
      analysis_corrections: {
        Row: {
          id: string; analysis_id: string; document_id: string; company_id: string; field: string;
          original_ai_value: Json | null; corrected_value: Json | null; corrected_by: string | null; corrected_at: string;
        };
        Insert: {
          id?: string; analysis_id: string; document_id: string; company_id: string; field: string;
          original_ai_value?: Json | null; corrected_value?: Json | null; corrected_by?: string | null;
        };
        Update: { corrected_value?: Json | null };
        Relationships: [];
      };
      ai_request_log: {
        Row: {
          id: string; company_id: string; user_id: string | null; document_id: string | null; kind: string;
          provider: string | null; model: string | null; status: string; error_code: string | null;
          duration_ms: number | null; input_tokens: number | null; output_tokens: number | null; created_at: string;
        };
        Insert: {
          id?: string; company_id: string; user_id?: string | null; document_id?: string | null; kind: string;
          provider?: string | null; model?: string | null; status: string; error_code?: string | null;
          duration_ms?: number | null; input_tokens?: number | null; output_tokens?: number | null;
        };
        Update: { status?: string };
        Relationships: [];
      };
      tasks: {
        Row: { id: string; company_id: string; created_by: string | null; document_id: string | null; subsidy_case_id: string | null; title: string; description: string | null; authority: string | null; due_date: string | null; priority: TaskPriority; status: TaskStatus; source: TaskSource; assignee_user_id: string | null; completed_at: string | null; completed_by: string | null; archived_at: string | null; archived_by: string | null; created_at: string; updated_at: string; workflow_run_id: string | null };
        Insert: { id?: string; company_id: string; created_by?: string | null; document_id?: string | null; subsidy_case_id?: string | null; title: string; description?: string | null; authority?: string | null; due_date?: string | null; priority?: TaskPriority; status?: TaskStatus; source?: TaskSource; assignee_user_id?: string | null };
        // `completed_at`, `completed_by`, `archived_by` non compaiono in Update:
        // li scrive il trigger `tasks_guard`, e un client che li mandasse li
        // vedrebbe comunque sovrascritti. `archived_at` c'è perché è il modo in
        // cui si DICHIARA di voler archiviare; il valore vero lo mette il server.
        Update: { title?: string; description?: string | null; authority?: string | null; due_date?: string | null; priority?: TaskPriority; status?: TaskStatus; assignee_user_id?: string | null; archived_at?: string | null };
        Relationships: [];
      };
      task_checklist_items: {
        Row: { id: string; company_id: string; task_id: string; text: string; position: number; done: boolean; done_at: string | null; done_by: string | null; created_at: string; updated_at: string };
        Insert: { id?: string; company_id: string; task_id: string; text: string; position?: number; done?: boolean };
        Update: { text?: string; position?: number; done?: boolean };
        Relationships: [];
      };
      task_comments: {
        Row: { id: string; company_id: string; task_id: string; author_user_id: string; body: string; created_at: string; updated_at: string };
        Insert: { id?: string; company_id: string; task_id: string; author_user_id: string; body: string };
        Update: { body?: string };
        Relationships: [];
      };
      task_events: {
        // Sola lettura per il client: le righe le scrivono i trigger.
        Row: { id: string; company_id: string; task_id: string; actor_user_id: string | null; kind: TaskEventKind; detail: Json; created_at: string };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      notifications: {
        // Sola lettura per il client (0018): le righe le scrivono i trigger e il
        // worker, e «segna come letta» passa da una funzione.
        Row: {
          id: string; company_id: string; user_id: string; type: NotificationType;
          entity_type: string; entity_id: string; payload: Json;
          dedupe_key: string | null; read_at: string | null; created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      notification_preferences: {
        Row: {
          company_id: string; user_id: string;
          in_app_enabled: boolean; email_enabled: boolean;
          remind_7_days: boolean; remind_1_day: boolean; remind_due_day: boolean; remind_overdue: boolean;
          timezone: string; locale: string; show_task_title: boolean;
          created_at: string; updated_at: string;
        };
        Insert: {
          company_id: string; user_id: string;
          in_app_enabled?: boolean; email_enabled?: boolean;
          remind_7_days?: boolean; remind_1_day?: boolean; remind_due_day?: boolean; remind_overdue?: boolean;
          timezone?: string; locale?: string; show_task_title?: boolean;
        };
        Update: {
          in_app_enabled?: boolean; email_enabled?: boolean;
          remind_7_days?: boolean; remind_1_day?: boolean; remind_due_day?: boolean; remind_overdue?: boolean;
          timezone?: string; locale?: string; show_task_title?: boolean;
        };
        Relationships: [];
      };
      calendar_connections: {
        // ⚠️ La 0018 concede al client la SELECT su un elenco di colonne, non
        // sulla tabella: `select('*')` fallisce con «permission denied for
        // column». È il motivo per cui il service le elenca una per una.
        Row: {
          id: string; company_id: string; user_id: string; provider: CalendarProvider;
          email_address: string; provider_calendar_id: string | null; calendar_name: string | null;
          status: CalendarConnectionStatus; scopes: string[]; sync_enabled: boolean;
          initial_sync_completed_at: string | null; last_sync_at: string | null;
          last_successful_sync_at: string | null; last_error_code: string | null; last_error_at: string | null;
          created_at: string; updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      calendar_event_links: {
        Row: {
          id: string; company_id: string; user_id: string; connection_id: string; task_id: string;
          provider_event_id: string; provider_calendar_id: string;
          sync_status: CalendarSyncStatus; content_hash: string | null;
          last_synced_at: string | null; error_code: string | null;
          created_at: string; updated_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      subsidy_matches: {
        Row: { id: string; company_id: string; program_id: string; relevance_score: number | null; eligibility_status: EligibilityStatus; answers: Json; satisfied_requirements: Json; unknown_requirements: Json; failed_requirements: Json; source_last_checked_at: string | null; evaluated_at: string; created_at: string; updated_at: string };
        Insert: { id?: string; company_id: string; program_id: string; relevance_score?: number | null; eligibility_status?: EligibilityStatus; answers?: Json; satisfied_requirements?: Json; unknown_requirements?: Json; failed_requirements?: Json; source_last_checked_at?: string | null; evaluated_at?: string };
        Update: { relevance_score?: number | null; eligibility_status?: EligibilityStatus; answers?: Json; satisfied_requirements?: Json; unknown_requirements?: Json; failed_requirements?: Json; source_last_checked_at?: string | null; evaluated_at?: string };
        Relationships: [];
      };
      subsidy_cases: {
        Row: { id: string; company_id: string; created_by: string | null; program_id: string; program_name: string | null; authority: string | null; status: SubsidyCaseStatus; eligibility_status_at_creation: EligibilityStatus | null; relevance_score: number | null; source_last_checked_at: string | null; eligibility_snapshot: Json | null; created_at: string; updated_at: string };
        Insert: { id?: string; company_id: string; created_by?: string | null; program_id: string; program_name?: string | null; authority?: string | null; status?: SubsidyCaseStatus; eligibility_status_at_creation?: EligibilityStatus | null; relevance_score?: number | null; source_last_checked_at?: string | null; eligibility_snapshot?: Json | null };
        Update: { status?: SubsidyCaseStatus };
        Relationships: [];
      };
      subsidy_case_items: {
        Row: { id: string; subsidy_case_id: string; title: string; completed: boolean; sort_order: number; created_at: string; updated_at: string };
        Insert: { id?: string; subsidy_case_id: string; title: string; completed?: boolean; sort_order?: number };
        Update: { title?: string; completed?: boolean; sort_order?: number };
        Relationships: [];
      };
      subsidy_programs: {
        Row: {
          id: string; name: string; authority: string; support_type: string;
          geography: string[]; target_sectors: string[]; company_size_min: number; company_size_max: number;
          project_types: string[]; requirements: Json; exclusions: Json;
          contribution_description: string | null; application_window: string | null;
          must_apply_before_start: boolean; must_apply_before_start_text: string | null; documents_required: string[];
          official_source_url: string; source_title: string | null; last_checked_at: string | null;
          data_status: string; active: boolean; created_at: string; updated_at: string;
          translations: Json;   // 0012 — contenuti tradotti per lingua
          // 0011 — disponibilità: distinta da `active` (che nasconde il programma)
          // e da `data_status` (che riguarda l'affidabilità del dato).
          availability: string; availability_note: string | null;
          availability_source_url: string | null; availability_checked_at: string | null;
        };
        // Catalogo condiviso: la 0007 concede al client la sola `select`. Lo
        // scrive il seed con service_role (scripts/seed-subsidy-programs.mjs).
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };

      // ---- Inbox (0013) ----------------------------------------------------
      // Le Row rispecchiano SOLO le colonne che la 0013 concede al ruolo
      // `authenticated`. `sync_cursor`, `watch_resource_id`, `history_floor_at`
      // e le colonne dei segreti non compaiono qui perché il client non ha il
      // permesso di leggerle: se comparissero, il tipo prometterebbe un dato
      // che il database rifiuta di dare.
      email_connections: {
        Row: {
          id: string; company_id: string; connected_by: string | null;
          provider: EmailProvider; provider_account_id: string; email_address: string; display_name: string | null;
          status: EmailConnectionStatus; scopes: string[]; sync_enabled: boolean;
          initial_sync_completed_at: string | null; last_sync_at: string | null; last_successful_sync_at: string | null;
          last_error_code: string | null; last_error_at: string | null;
          watch_expires_at: string | null; sync_lease_until: string | null;
          created_at: string; updated_at: string;
        };
        // Il ciclo di vita della connessione passa dalle Edge Function, che
        // verificano il ruolo: al client non serve alcuna scrittura.
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      email_messages: {
        Row: {
          id: string; company_id: string; connection_id: string;
          provider_message_id: string; provider_thread_id: string | null; internet_message_id: string | null;
          subject: string | null; sender_name: string | null; sender_email: string | null;
          to_recipients: Json; cc_recipients: Json;
          received_at: string; sent_at: string | null;
          body_text: string | null; body_preview: string | null; body_links: Json; body_char_count: number | null;
          body_clean: string | null; quoted_removed: boolean;
          has_attachments: boolean; attachment_count: number; importance: string | null; is_bulk: boolean;
          processing_status: EmailProcessingStatus; attention_status: EmailAttentionStatus;
          relevance: EmailRelevance | null; relevance_confidence: number | null; relevance_reason: string | null;
          classifier_version: string | null; classifier_provider: string | null; classifier_model: string | null;
          classifier_prompt_version: string | null; classified_at: string | null;
          error_code: string | null; error_message_safe: string | null;
          seen_at: string | null; handled_at: string | null; handled_by: string | null;
          source_fingerprint: string | null; analysis_deadline: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, never>;
        // 0013 — il grant di colonna concede solo queste due. `handled_by` e
        // `handled_at` li scrive il trigger, e il ripristino ricalcola lo stato
        // dalla classificazione ignorando il valore inviato.
        Update: { seen_at?: string | null; attention_status?: EmailAttentionStatus };
        Relationships: [];
      };
      email_attachments: {
        Row: {
          id: string; company_id: string; email_message_id: string; provider_attachment_id: string;
          filename: string | null; safe_filename: string | null;
          declared_mime_type: string | null; mime_type: string | null; size_bytes: number | null;
          content_id: string | null; is_inline: boolean;
          storage_path: string | null; file_hash: string | null;
          import_status: EmailAttachmentImportStatus; skip_reason: string | null; error_code: string | null;
          created_at: string; updated_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      email_message_documents: {
        Row: {
          id: string; company_id: string; email_message_id: string; document_id: string;
          relation: EmailDocumentRelation; attachment_id: string | null; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      email_sync_runs: {
        Row: {
          id: string; company_id: string; connection_id: string;
          sync_type: EmailSyncType; status: EmailSyncStatus; triggered_by: string | null;
          started_at: string; completed_at: string | null; duration_ms: number | null;
          messages_seen: number; messages_new: number; messages_updated: number;
          attachments_imported: number; documents_created: number; analyses_started: number;
          cursor_before: string | null; cursor_after: string | null;
          error_code: string | null; error_detail_safe: string | null; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      email_audit_log: {
        Row: {
          id: string; company_id: string; connection_id: string | null; actor_user_id: string | null;
          action: string; detail: Json; created_at: string;
        };
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };

      // ---- Automazioni (0020) ------------------------------------------
      // ⚠️ Tutte in SOLA LETTURA per il client, e non per prudenza: le regole
      // si scrivono passando dalla Edge Function `automation-admin`, che
      // verifica il ruolo e valida la configurazione contro il registro
      // tipizzato. Il database quel registro non ce l'ha, e ripeterlo in SQL
      // avrebbe creato un secondo elenco destinato a divergere dal primo.
      workflow_definitions: {
        Row: {
          id: string; company_id: string; name: string; description: string | null;
          status: WorkflowStatus; trigger_type: AutomationEventType;
          condition_match: 'all' | 'any'; conditions: Json; actions: Json;
          version: number; activated_at: string | null;
          attention_code: string | null; attention_at: string | null;
          consecutive_failures: number;
          last_run_at: string | null; last_run_status: WorkflowRunStatus | null;
          created_by: string | null; updated_by: string | null;
          created_at: string; updated_at: string;
          archived_at: string | null; archived_by: string | null;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workflow_runs: {
        Row: {
          id: string; company_id: string; workflow_id: string; workflow_version: number;
          config_snapshot: Json; trigger_event_id: string | null;
          entity_type: string | null; entity_id: string | null;
          status: WorkflowRunStatus; condition_results: Json;
          started_at: string; completed_at: string | null; duration_ms: number | null;
          error_code: string | null; created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      workflow_action_runs: {
        Row: {
          id: string; company_id: string; workflow_run_id: string;
          action_key: string; action_position: number; status: WorkflowActionStatus;
          idempotency_key: string;
          output_entity_type: string | null; output_entity_id: string | null;
          error_code: string | null;
          started_at: string | null; completed_at: string | null; created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
      // ---- Finance Operations (0021) -----------------------------------
      // ⚠️ Le colonne `eff_*` NON compaiono in Insert né in Update: sono la
      // PROIEZIONE che il trigger ricalcola da estrazione più correzioni, e il
      // client non ha alcun permesso di scrittura su di esse. Un tipo che le
      // rendesse scrivibili prometterebbe qualcosa che il database rifiuta.
      finance_items: {
        Row: {
          id: string; company_id: string; document_id: string;
          type: FinanceItemType;
          processing_status: FinanceProcessingStatus;
          review_status: FinanceReviewStatus;
          origin: FinanceOrigin;
          current_extraction_id: string | null;
          extraction_attempts: number; error_code: string | null;
          expense_category: FinanceExpenseCategory | null;
          expense_category_set_by: string | null; expense_category_set_at: string | null;
          payment_method: FinancePaymentMethod | null;
          quality_flags: FinanceQualityFlag[];
          reviewed_at: string | null; reviewed_by: string | null;
          archived_at: string | null; archived_by: string | null;
          created_by: string | null; workflow_run_id: string | null;
          eff_supplier_name: string | null; eff_supplier_norm: string | null;
          eff_invoice_number: string | null; eff_invoice_number_norm: string | null;
          eff_invoice_date: string | null; eff_due_date: string | null;
          eff_currency: string | null;
          eff_gross_amount: number | null; eff_net_amount: number | null; eff_vat_amount: number | null;
          eff_iban: string | null; eff_reference_type: FinanceReferenceType | null;
          eff_payment_reference: string | null;
          eff_merchant: string | null; eff_expense_date: string | null;
          dup_key: string | null;
          created_at: string; updated_at: string;
        };
        // Il grant di colonna della 0021 concede solo queste tre: il resto lo
        // scrivono i trigger e il worker.
        Insert: { company_id: string; document_id: string; type: FinanceItemType };
        // `processing_status` c'è solo per poter DICHIARARE «riprova»: il
        // guardiano rifiuta ogni transizione che non parta da uno stato fermo.
        Update: {
          type?: FinanceItemType;
          review_status?: FinanceReviewStatus;
          archived_at?: string | null;
          expense_category?: FinanceExpenseCategory | null;
          payment_method?: FinancePaymentMethod | null;
          processing_status?: FinanceProcessingStatus;
        };
        Relationships: [];
      };
      finance_extractions: {
        Row: {
          id: string; company_id: string; finance_item_id: string; document_id: string;
          extraction_version: number; status: FinanceExtractionStatus;
          method: string; provider: string | null; model: string | null;
          prompt_version: string | null; schema_version: number;
          invoice_number: string | null; supplier_name: string | null;
          supplier_address: string | null; supplier_vat_id: string | null;
          supplier_country: string | null;
          invoice_date: string | null; due_date: string | null; currency: string | null;
          gross_amount: number | null; net_amount: number | null; vat_amount: number | null;
          vat_breakdown: Json;
          creditor_iban: string | null; iban_is_qr: boolean | null;
          reference_type: FinanceReferenceType | null; payment_reference: string | null;
          qr_present: boolean; qr_valid: boolean | null;
          qr_spec_version: string | null; qr_errors: string[];
          merchant: string | null; expense_date: string | null;
          payment_method_detected: FinancePaymentMethod | null;
          field_sources: Json; field_confidence: Json; evidence: Json;
          uncertainties: Json; quality_flags: FinanceQualityFlag[];
          document_language: string | null; error_code: string | null;
          input_tokens: number | null; output_tokens: number | null; duration_ms: number | null;
          created_at: string;
        };
        // Il verbale lo scrive SOLO il worker con il service role, e non si
        // modifica: i trigger rifiutano update e delete anche a lui.
        Insert: Record<string, never>;
        Update: Record<string, never>;
        Relationships: [];
      };
      finance_corrections: {
        Row: {
          id: string; company_id: string; finance_item_id: string; document_id: string;
          extraction_id: string | null; field: string;
          original_value: Json | null; corrected_value: Json | null;
          corrected_by: string | null; corrected_at: string;
        };
        // `document_id` ed `extraction_id` li stabilisce il trigger dall'elemento:
        // farli dichiarare al client permetterebbe di agganciare una correzione
        // al documento sbagliato.
        Insert: {
          company_id: string; finance_item_id: string; field: string;
          original_value?: Json | null; corrected_value?: Json | null;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      finance_events: {
        // Sola lettura: lo storico lo scrivono i trigger.
        Row: {
          id: string; company_id: string; finance_item_id: string;
          actor_user_id: string | null; kind: FinanceEventKind; detail: Json; created_at: string;
        };
        Insert: never; Update: never;
        Relationships: [];
      };
      finance_vat_rates: {
        // Catalogo comune, in sola lettura. Sono SUGGERIMENTI per la correzione
        // manuale: un'aliquota fuori elenco è accettata, non rifiutata (§52).
        Row: {
          id: string; country_code: string; kind: string; rate: number;
          valid_from: string; valid_to: string | null;
          source_url: string; source_title: string | null; checked_at: string; created_at: string;
        };
        Insert: Record<string, never>; Update: Record<string, never>;
        Relationships: [];
      };

      workflow_events: {
        // Chi ha creato, attivato, messo in pausa. Solo amministratori.
        Row: {
          id: string; company_id: string; workflow_id: string;
          actor_user_id: string | null; kind: WorkflowAuditKind; detail: Json; created_at: string;
        };
        Insert: never;
        Update: never;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      is_company_member: { Args: { p_company_id: string }; Returns: boolean };
      is_company_admin: { Args: { p_company_id: string }; Returns: boolean };
      is_case_member: { Args: { p_case_id: string }; Returns: boolean };
      create_company_with_owner: {
        Args: {
          p_legal_name: string; p_uid_che?: string | null; p_canton?: string | null; p_municipality?: string | null;
          p_legal_form?: string | null; p_sector?: string | null; p_employee_count?: number | null; p_revenue_band?: string | null;
        };
        Returns: string;
      };
      /** Rubrica dei membri: `profiles` è leggibile solo dal proprietario. */
      company_member_directory: {
        Args: { p_company_id: string };
        Returns: { user_id: string; display_name: string | null; role: MemberRole }[];
      };
      /**
       * Document Hub (0017): una riga di lista già composta dal database —
       * documento, ultima analisi, correzioni umane applicate, etichette,
       * attività collegate, comunicazioni di provenienza, estratto di ricerca.
       * NON restituisce mai il testo estratto né il JSON dell'analisi.
       */
      list_documents: {
        Args: {
          p_company_id: string; p_query?: string | null;
          p_category?: DocumentCategory | null; p_uncategorized?: boolean;
          p_source?: DocumentSourceType | null; p_state?: string | null;
          p_tag_ids?: string[] | null; p_date_from?: string | null; p_date_to?: string | null;
          p_has_deadline?: boolean; p_archived?: boolean; p_sort?: string;
          p_limit?: number; p_offset?: number; p_document_id?: string | null;
        };
        Returns: {
          id: string; title: string; original_filename: string | null; mime_type: string | null;
          file_size: number | null; storage_path: string | null;
          source_type: DocumentSourceType; status: DocumentStatus; page_count: number | null;
          created_at: string; archived_at: string | null;
          category: DocumentCategory | null; category_source: DocumentCategorySource | null;
          analysis_id: string | null; analysis_status: AnalysisStatus | null;
          last_attempt_failed: boolean; error_code: string | null;
          document_type: string | null; document_type_corrected: boolean;
          sender: string | null; sender_corrected: boolean; sender_authority_type: string | null;
          document_date: string | null; deadline: string | null; deadline_corrected: boolean;
          deadline_requires_verification: boolean;
          amount: number | null; amount_currency: string | null; amount_corrected: boolean;
          confidence: string | null;
          tags: { id: string; name: string }[];
          open_task_count: number; task_count: number; email_count: number;
          snippet: string | null; total_count: number;
        }[];
      };
      /** Conteggi per categoria in un'unica aggregazione (§102). */
      document_category_counts: {
        Args: { p_company_id: string; p_archived?: boolean };
        Returns: { category: DocumentCategory | null; n: number }[];
      };
      /** Azioni di gruppo: tutte o nessuna, mai a metà (§84). */
      documents_bulk_set_category: {
        Args: { p_company_id: string; p_ids: string[]; p_category: DocumentCategory | null };
        Returns: number;
      };
      documents_bulk_archive: {
        Args: { p_company_id: string; p_ids: string[]; p_archived: boolean };
        Returns: number;
      };
      documents_bulk_add_tag: {
        Args: { p_company_id: string; p_ids: string[]; p_tag_id: string };
        Returns: number;
      };
      /**
       * Calendario interno (0018): le attività con scadenza in un intervallo,
       * più le scadute che restano pertinenti anche fuori intervallo.
       * NON restituisce checklist, commenti, storico né analisi: una vista
       * mensile con quaranta attività non deve caricare quaranta analisi.
       * ⚠️ Non c'è `is_overdue`: che cosa sia «in ritardo» lo decide
       * `isOverdue()` in `taskFormat`, una definizione sola per tutto il prodotto.
       */
      calendar_tasks: {
        Args: {
          p_company_id: string; p_from: string; p_to: string;
          p_mine?: boolean; p_status?: TaskStatus | null; p_priority?: TaskPriority | null;
          p_assignee?: string | null; p_include_overdue?: boolean; p_limit?: number;
        };
        Returns: {
          id: string; title: string; due_date: string;
          priority: TaskPriority; status: TaskStatus; source: TaskSource;
          assignee_user_id: string | null; assignee_name: string | null; document_id: string | null;
        }[];
      };
      /** Quante attività aperte non hanno scadenza. Si mostra il numero, non si inventa una data. */
      calendar_undated_count: { Args: { p_company_id: string; p_mine?: boolean }; Returns: number };
      notifications_mark_read: { Args: { p_ids: string[] }; Returns: number };
      notifications_mark_all_read: { Args: { p_company_id: string }; Returns: number };
      notifications_unread_count: { Args: { p_company_id: string }; Returns: number };
      /** Lista attività: filtri, ordinamento e paginazione nel database. */
      list_tasks: {
        Args: {
          p_company_id: string; p_view?: string; p_status?: TaskStatus | null;
          p_priority?: TaskPriority | null; p_source?: TaskSource | null;
          p_assignee?: string | null; p_search?: string | null;
          p_limit?: number; p_offset?: number;
        };
        Returns: (Database['public']['Tables']['tasks']['Row'] & {
          assignee_name: string | null; email_message_id: string | null; total_count: number;
        })[];
      };
      /** Quante esecuzioni, quante azioni, quanti errori negli ultimi N giorni (§102). */
      workflow_metrics: {
        Args: { p_workflow_id: string; p_days?: number };
        Returns: { runs: number; actions_done: number; actions_failed: number; errors: number }[];
      };
      /**
       * Lo stato della coda del motore: quanti eventi aspettano, da quanto, e
       * quanti hanno smesso di essere ritentati. Risponde a «sta girando?» con
       * un numero invece che con un'impressione (§169). Solo amministratori.
       */
      automation_backlog: {
        Args: { p_company_id: string };
        Returns: { pending: number; dead_letter: number; oldest_pending_seconds: number }[];
      };
      /** I limiti che il database APPLICA. Il test li confronta con il contratto TypeScript. */
      automation_limits: { Args: Record<string, never>; Returns: Json };

      /**
       * Finance (0021): una riga di lista già composta dal database — elemento
       * operativo, valori effettivi, documento, duplicato sospetto CALCOLATO,
       * attività e provenienza. Non restituisce mai il testo del documento né
       * il JSON dell'estrazione.
       */
      list_finance_items: {
        Args: {
          p_company_id: string; p_tab?: string | null; p_query?: string | null;
          p_review?: string | null; p_processing?: string | null;
          p_supplier?: string | null; p_currency?: string | null;
          p_date_from?: string | null; p_date_to?: string | null;
          p_due_from?: string | null; p_due_to?: string | null;
          p_source?: DocumentSourceType | null;
          p_category?: FinanceExpenseCategory | null;
          p_duplicates?: boolean; p_flagged?: boolean; p_archived?: boolean;
          p_sort?: string; p_limit?: number; p_offset?: number;
          p_item_id?: string | null;
        };
        Returns: {
          id: string; document_id: string; type: FinanceItemType;
          processing_status: FinanceProcessingStatus; review_status: FinanceReviewStatus;
          origin: FinanceOrigin; error_code: string | null;
          expense_category: FinanceExpenseCategory | null;
          payment_method: FinancePaymentMethod | null;
          quality_flags: FinanceQualityFlag[];
          duplicate_suspected: boolean; duplicate_count: number;
          supplier_name: string | null; invoice_number: string | null;
          invoice_date: string | null; due_date: string | null; expense_date: string | null;
          merchant: string | null; currency: string | null;
          gross_amount: number | null; net_amount: number | null; vat_amount: number | null;
          iban: string | null; reference_type: FinanceReferenceType | null;
          payment_reference: string | null;
          corrected_fields: string[];
          reviewed_at: string | null; reviewed_by: string | null;
          archived_at: string | null; created_at: string;
          extraction_id: string | null; extraction_version: number | null;
          document_title: string; document_source: DocumentSourceType;
          document_status: DocumentStatus; storage_path: string | null; mime_type: string | null;
          open_task_count: number; task_count: number; email_count: number;
          total_count: number;
        }[];
      };
      /**
       * I quattro numeri del cruscotto, UNA RIGA PER VALUTA (§113).
       * ⚠️ `total` è `null` sulla riga dei conteggi senza importo e quando la
       * valuta non è nota: un importo senza valuta non è un importo, e
       * sommarlo ne inventerebbe una.
       */
      finance_summary: {
        Args: { p_company_id: string; p_due_days?: number };
        Returns: { bucket: string; currency: string | null; n: number; total: number | null }[];
      };
      /** Le controparti di un possibile duplicato. Non fonde niente (§72). */
      finance_duplicates: {
        Args: { p_item_id: string };
        Returns: {
          id: string; document_id: string; supplier_name: string | null;
          invoice_number: string | null; invoice_date: string | null;
          currency: string | null; gross_amount: number | null;
          review_status: FinanceReviewStatus; created_at: string;
        }[];
      };
    };
    Enums: {
      member_role: MemberRole;
      document_source_type: DocumentSourceType;
      document_status: DocumentStatus;
      document_category: DocumentCategory;
      document_category_source: DocumentCategorySource;
      analysis_status: AnalysisStatus;
      extraction_method: ExtractionMethod;
      task_priority: TaskPriority;
      task_status: TaskStatus;
      task_source: TaskSource;
      task_event_kind: TaskEventKind;
      eligibility_status: EligibilityStatus;
      subsidy_case_status: SubsidyCaseStatus;
      email_provider: EmailProvider;
      email_connection_status: EmailConnectionStatus;
      email_sync_type: EmailSyncType;
      email_sync_status: EmailSyncStatus;
      email_processing_status: EmailProcessingStatus;
      email_attention_status: EmailAttentionStatus;
      email_relevance: EmailRelevance;
      email_document_relation: EmailDocumentRelation;
      email_attachment_import_status: EmailAttachmentImportStatus;
      calendar_provider: CalendarProvider;
      calendar_connection_status: CalendarConnectionStatus;
      calendar_link_status: CalendarSyncStatus;
      notification_type: NotificationType;
      notification_channel: NotificationChannel;
      notification_delivery_status: NotificationDeliveryStatus;
      automation_event_type: AutomationEventType;
      automation_event_status: AutomationEventStatus;
      workflow_status: WorkflowStatus;
      workflow_run_status: WorkflowRunStatus;
      workflow_action_status: WorkflowActionStatus;
      workflow_audit_kind: WorkflowAuditKind;
      finance_item_type: FinanceItemType;
      finance_processing_status: FinanceProcessingStatus;
      finance_review_status: FinanceReviewStatus;
      finance_origin: FinanceOrigin;
      finance_field_source: FinanceFieldSource;
      finance_reference_type: FinanceReferenceType;
      finance_expense_category: FinanceExpenseCategory;
      finance_payment_method: FinancePaymentMethod;
      finance_extraction_status: FinanceExtractionStatus;
      finance_quality_flag: FinanceQualityFlag;
      finance_event_kind: FinanceEventKind;
    };
    CompositeTypes: Record<string, never>;
  };
}
