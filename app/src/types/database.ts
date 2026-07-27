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
export type DocumentCategorySource = 'rule' | 'manual';
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
export type TaskSource = 'admin_ai' | 'subsidy_ai' | 'manual';
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
        Row: { id: string; company_id: string; created_by: string | null; document_id: string | null; subsidy_case_id: string | null; title: string; description: string | null; authority: string | null; due_date: string | null; priority: TaskPriority; status: TaskStatus; source: TaskSource; assignee_user_id: string | null; completed_at: string | null; completed_by: string | null; archived_at: string | null; archived_by: string | null; created_at: string; updated_at: string };
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
    };
    CompositeTypes: Record<string, never>;
  };
}
