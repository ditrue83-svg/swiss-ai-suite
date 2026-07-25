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
export type TaskPriority = 'low' | 'medium' | 'high';
export type TaskStatus = 'open' | 'completed';
export type TaskSource = 'admin_ai' | 'subsidy_ai' | 'manual';
export type EligibilityStatus = 'unknown' | 'likely' | 'unlikely' | 'ineligible';
export type SubsidyCaseStatus = 'draft' | 'collecting_documents' | 'ready' | 'submitted' | 'closed';

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
        Row: { id: string; company_id: string; uploaded_by: string | null; title: string; original_filename: string | null; mime_type: string | null; file_size: number | null; storage_path: string | null; source_type: DocumentSourceType; status: DocumentStatus; file_hash: string | null; page_count: number | null; created_at: string; updated_at: string };
        Insert: { id?: string; company_id: string; uploaded_by?: string | null; title: string; original_filename?: string | null; mime_type?: string | null; file_size?: number | null; storage_path?: string | null; source_type?: DocumentSourceType; status?: DocumentStatus; file_hash?: string | null; page_count?: number | null };
        Update: { title?: string; original_filename?: string | null; mime_type?: string | null; file_size?: number | null; storage_path?: string | null; source_type?: DocumentSourceType; status?: DocumentStatus; file_hash?: string | null; page_count?: number | null };
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
        Row: { id: string; company_id: string; created_by: string | null; document_id: string | null; subsidy_case_id: string | null; title: string; description: string | null; authority: string | null; due_date: string | null; priority: TaskPriority; status: TaskStatus; source: TaskSource; created_at: string; updated_at: string };
        Insert: { id?: string; company_id: string; created_by?: string | null; document_id?: string | null; subsidy_case_id?: string | null; title: string; description?: string | null; authority?: string | null; due_date?: string | null; priority?: TaskPriority; status?: TaskStatus; source?: TaskSource };
        Update: { title?: string; description?: string | null; authority?: string | null; due_date?: string | null; priority?: TaskPriority; status?: TaskStatus };
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
    };
    Enums: {
      member_role: MemberRole;
      document_source_type: DocumentSourceType;
      document_status: DocumentStatus;
      analysis_status: AnalysisStatus;
      extraction_method: ExtractionMethod;
      task_priority: TaskPriority;
      task_status: TaskStatus;
      task_source: TaskSource;
      eligibility_status: EligibilityStatus;
      subsidy_case_status: SubsidyCaseStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
