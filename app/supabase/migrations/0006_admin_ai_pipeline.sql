-- ============================================================================
-- SwissAI Suite — 0006 ADMIN AI: pipeline documentale reale (Fase 2)
--
-- Separa nettamente i tre livelli richiesti:
--   DOCUMENTO ORIGINALE (documents + Storage)
--   TESTO ESTRATTO      (document_extractions, per pagina)
--   ANALISI AI          (document_analyses, snapshot immutabile)
--
-- Aggiunge inoltre: bozze di risposta, correzioni umane tracciate, log tecnico
-- per osservabilità e rate limiting, hash file per deduplicazione.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Stati documento (§25). I vecchi valori restano validi per retrocompatibilità:
--    'processing' e 'analyzed' sono legacy di 'extracting'/'analyzing' e 'completed'.
-- ---------------------------------------------------------------------------
alter type public.document_status add value if not exists 'extracting';
alter type public.document_status add value if not exists 'analyzing';
alter type public.document_status add value if not exists 'completed';
alter type public.document_status add value if not exists 'needs_review';

do $$ begin
  create type public.analysis_status as enum ('pending', 'completed', 'needs_review', 'failed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.extraction_method as enum ('native_pdf', 'ocr', 'text');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. documents: hash per deduplicazione (§28/§29) + metadati di pagina
-- ---------------------------------------------------------------------------
alter table public.documents add column if not exists file_hash text;
alter table public.documents add column if not exists page_count integer;

-- La deduplicazione è per AZIENDA, non globale, e non usa mai il filename (§29).
create index if not exists idx_documents_company_hash on public.documents (company_id, file_hash);

-- ---------------------------------------------------------------------------
-- 3. document_extractions — il testo estratto, separato dall'originale (§5)
--    Una estrazione "corrente" per documento; conserva la struttura per pagina (§4).
-- ---------------------------------------------------------------------------
create table if not exists public.document_extractions (
  id                 uuid primary key default gen_random_uuid(),
  document_id        uuid not null references public.documents (id) on delete cascade,
  company_id         uuid not null references public.companies (id) on delete cascade,
  extraction_method  public.extraction_method not null,
  full_text          text,
  -- [{ "pageNumber": 1, "text": "...", "ocrConfidence": 0.92 }]
  pages              jsonb not null default '[]'::jsonb,
  page_count         integer,
  char_count         integer,
  ocr_confidence     numeric(4,3),
  duration_ms        integer,
  created_at         timestamptz not null default now(),
  unique (document_id)
);
create index if not exists idx_extractions_company on public.document_extractions (company_id);

-- ---------------------------------------------------------------------------
-- 4. document_analyses — schema ricco (§6–18) + metadati di esecuzione (§23/§24)
--    I campi query-critical restano colonne; le strutture annidate sono JSONB.
-- ---------------------------------------------------------------------------
alter table public.document_analyses add column if not exists extraction_id uuid references public.document_extractions (id) on delete set null;
alter table public.document_analyses add column if not exists analysis_status public.analysis_status not null default 'completed';

-- Provenienza e versioning (§24)
alter table public.document_analyses add column if not exists provider text;
alter table public.document_analyses add column if not exists model text;
alter table public.document_analyses add column if not exists prompt_version text;
alter table public.document_analyses add column if not exists schema_version integer not null default 1;

-- Esecuzione e diagnostica (§23/§45/§46) — nessun contenuto sensibile qui
alter table public.document_analyses add column if not exists processing_started_at timestamptz;
alter table public.document_analyses add column if not exists processing_completed_at timestamptz;
alter table public.document_analyses add column if not exists error_code text;
alter table public.document_analyses add column if not exists error_message_safe text;
alter table public.document_analyses add column if not exists input_tokens integer;
alter table public.document_analyses add column if not exists output_tokens integer;

-- Campi di analisi query-critical
alter table public.document_analyses add column if not exists overall_confidence numeric(4,3);
alter table public.document_analyses add column if not exists document_type_confidence numeric(4,3);
alter table public.document_analyses add column if not exists sender_authority_type text;
alter table public.document_analyses add column if not exists sender_confidence numeric(4,3);
alter table public.document_analyses add column if not exists recipient text;
alter table public.document_analyses add column if not exists subject text;
alter table public.document_analyses add column if not exists document_date date;
alter table public.document_analyses add column if not exists reply_needed boolean;

-- Scadenza strutturata (§11): mai una data assoluta inventata
alter table public.document_analyses add column if not exists deadline_type text;               -- explicit | relative | inferred | none
alter table public.document_analyses add column if not exists deadline_source_text text;
alter table public.document_analyses add column if not exists deadline_confidence numeric(4,3);
alter table public.document_analyses add column if not exists deadline_requires_verification boolean not null default false;

-- Strutture annidate (§23)
alter table public.document_analyses add column if not exists amounts jsonb not null default '[]'::jsonb;              -- §12
alter table public.document_analyses add column if not exists reference_numbers jsonb not null default '[]'::jsonb;
alter table public.document_analyses add column if not exists legal_references jsonb not null default '[]'::jsonb;
alter table public.document_analyses add column if not exists sender_evidence_list jsonb not null default '[]'::jsonb;

create index if not exists idx_analyses_status on public.document_analyses (analysis_status);
create index if not exists idx_analyses_deadline on public.document_analyses (deadline);

-- ---------------------------------------------------------------------------
-- 5. document_replies — bozze di risposta (§38), generate su richiesta (§35)
-- ---------------------------------------------------------------------------
create table if not exists public.document_replies (
  id              uuid primary key default gen_random_uuid(),
  document_id     uuid not null references public.documents (id) on delete cascade,
  company_id      uuid not null references public.companies (id) on delete cascade,
  analysis_id     uuid references public.document_analyses (id) on delete set null,
  created_by      uuid references auth.users (id) on delete set null,
  language        text not null,
  tone            text not null,
  content         text not null,
  provider        text,
  model           text,
  prompt_version  text,
  is_edited       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_replies_document on public.document_replies (document_id);
create index if not exists idx_replies_company on public.document_replies (company_id);

-- ---------------------------------------------------------------------------
-- 6. analysis_corrections — revisione umana tracciata (§34)
--    L'analisi AI resta immutabile: le correzioni vivono qui accanto.
-- ---------------------------------------------------------------------------
create table if not exists public.analysis_corrections (
  id                uuid primary key default gen_random_uuid(),
  analysis_id       uuid not null references public.document_analyses (id) on delete cascade,
  document_id       uuid not null references public.documents (id) on delete cascade,
  company_id        uuid not null references public.companies (id) on delete cascade,
  field             text not null,          -- sender | deadline | amount | document_type
  original_ai_value jsonb,
  corrected_value   jsonb,
  corrected_by      uuid references auth.users (id) on delete set null,
  corrected_at      timestamptz not null default now()
);
create index if not exists idx_corrections_analysis on public.analysis_corrections (analysis_id);
create index if not exists idx_corrections_company on public.analysis_corrections (company_id);

-- ---------------------------------------------------------------------------
-- 7. ai_request_log — osservabilità (§45) e base per il rate limiting (§50).
--    MAI contenuto del documento: solo identificatori, stato e metriche.
-- ---------------------------------------------------------------------------
create table if not exists public.ai_request_log (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  user_id       uuid references auth.users (id) on delete set null,
  document_id   uuid references public.documents (id) on delete set null,
  kind          text not null,              -- analysis | reply | extraction
  provider      text,
  model         text,
  status        text not null,              -- ok | error
  error_code    text,
  duration_ms   integer,
  input_tokens  integer,
  output_tokens integer,
  created_at    timestamptz not null default now()
);
-- Indice pensato per la finestra di rate limiting (conteggio recente per azienda).
create index if not exists idx_ai_log_company_time on public.ai_request_log (company_id, created_at desc);
create index if not exists idx_ai_log_user_time on public.ai_request_log (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 8. Trigger updated_at
-- ---------------------------------------------------------------------------
drop trigger if exists trg_replies_updated on public.document_replies;
create trigger trg_replies_updated before update on public.document_replies
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 9. RLS — stessa regola di sempre: si accede solo ai dati della propria company
-- ---------------------------------------------------------------------------
alter table public.document_extractions enable row level security;
alter table public.document_replies     enable row level security;
alter table public.analysis_corrections enable row level security;
alter table public.ai_request_log       enable row level security;

drop policy if exists extractions_select_member on public.document_extractions;
create policy extractions_select_member on public.document_extractions
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists extractions_insert_member on public.document_extractions;
create policy extractions_insert_member on public.document_extractions
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists extractions_update_member on public.document_extractions;
create policy extractions_update_member on public.document_extractions
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists extractions_delete_member on public.document_extractions;
create policy extractions_delete_member on public.document_extractions
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists replies_select_member on public.document_replies;
create policy replies_select_member on public.document_replies
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists replies_insert_member on public.document_replies;
create policy replies_insert_member on public.document_replies
  for insert to authenticated with check (public.is_company_member(company_id) and created_by = auth.uid());
drop policy if exists replies_update_member on public.document_replies;
create policy replies_update_member on public.document_replies
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists replies_delete_member on public.document_replies;
create policy replies_delete_member on public.document_replies
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists corrections_select_member on public.analysis_corrections;
create policy corrections_select_member on public.analysis_corrections
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists corrections_insert_member on public.analysis_corrections;
create policy corrections_insert_member on public.analysis_corrections
  for insert to authenticated with check (public.is_company_member(company_id) and corrected_by = auth.uid());

-- Il log è in sola lettura per l'utente: lo scrive il server (service role) o il
-- membro stesso; non è modificabile né cancellabile dal client.
drop policy if exists ai_log_select_member on public.ai_request_log;
create policy ai_log_select_member on public.ai_request_log
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists ai_log_insert_member on public.ai_request_log;
create policy ai_log_insert_member on public.ai_request_log
  for insert to authenticated with check (public.is_company_member(company_id));

grant select, insert, update, delete on public.document_extractions to authenticated;
grant select, insert, update, delete on public.document_replies     to authenticated;
grant select, insert                 on public.analysis_corrections to authenticated;
grant select, insert                 on public.ai_request_log       to authenticated;
