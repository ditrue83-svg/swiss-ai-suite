// ============================================================================
// Tipi del database (stile "Supabase generated types").
// Se in futuro usi la CLI: `supabase gen types typescript --linked > src/types/database.ts`
// sostituirà questo file mantenendo la stessa forma (Database → public → Tables…).
// I campi jsonb sono tipati come `Json`; le forme applicative precise stanno in models.ts
// e la mappatura avviene nel service layer.
// ============================================================================

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type MemberRole = 'owner' | 'admin' | 'member';
export type DocumentSourceType = 'upload' | 'pasted_text' | 'email';
export type DocumentStatus = 'uploaded' | 'processing' | 'analyzed' | 'failed';
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
        Row: { id: string; company_id: string; uploaded_by: string | null; title: string; original_filename: string | null; mime_type: string | null; file_size: number | null; storage_path: string | null; source_type: DocumentSourceType; status: DocumentStatus; created_at: string; updated_at: string };
        Insert: { id?: string; company_id: string; uploaded_by?: string | null; title: string; original_filename?: string | null; mime_type?: string | null; file_size?: number | null; storage_path?: string | null; source_type?: DocumentSourceType; status?: DocumentStatus };
        Update: { title?: string; original_filename?: string | null; mime_type?: string | null; file_size?: number | null; storage_path?: string | null; source_type?: DocumentSourceType; status?: DocumentStatus };
        Relationships: [];
      };
      document_analyses: {
        Row: {
          id: string; document_id: string; company_id: string; analysis_version: number; engine: string;
          language: string | null; sender: string | null; sender_evidence: Json | null; document_type: string | null;
          deadline: string | null; deadline_evidence: Json | null; amount: number | null; amount_currency: string | null; amount_evidence: Json | null;
          summary: string | null; actions: Json; requested_documents: Json; risks: Json | null; uncertainties: Json;
          confidence: string | null; reply_draft: string | null; reply_language: string | null; reply_tone: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; document_id: string; company_id: string; analysis_version?: number; engine?: string;
          language?: string | null; sender?: string | null; sender_evidence?: Json | null; document_type?: string | null;
          deadline?: string | null; deadline_evidence?: Json | null; amount?: number | null; amount_currency?: string | null; amount_evidence?: Json | null;
          summary?: string | null; actions?: Json; requested_documents?: Json; risks?: Json | null; uncertainties?: Json;
          confidence?: string | null; reply_draft?: string | null; reply_language?: string | null; reply_tone?: string | null;
        };
        Update: {
          actions?: Json; reply_draft?: string | null; reply_language?: string | null; reply_tone?: string | null; status?: never;
        };
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
      task_priority: TaskPriority;
      task_status: TaskStatus;
      task_source: TaskSource;
      eligibility_status: EligibilityStatus;
      subsidy_case_status: SubsidyCaseStatus;
    };
    CompositeTypes: Record<string, never>;
  };
}
