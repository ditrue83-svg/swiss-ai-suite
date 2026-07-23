-- ============================================================================
-- SwissAI Suite — 0002 DOCUMENTS
-- Documenti (metadati; il file vero sta in Storage) + analisi persistenti.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.document_source_type as enum ('upload', 'pasted_text', 'email');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.document_status as enum ('uploaded', 'processing', 'analyzed', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tabella: documents
-- NB: NESSUN contenuto del PDF nel DB — solo metadati + storage_path.
-- ---------------------------------------------------------------------------
create table if not exists public.documents (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  uploaded_by        uuid references auth.users (id) on delete set null,
  title              text not null,
  original_filename  text,
  mime_type          text,
  file_size          bigint,
  storage_path       text,
  source_type        public.document_source_type not null default 'upload',
  status             public.document_status not null default 'uploaded',
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists idx_documents_company    on public.documents (company_id);
create index if not exists idx_documents_created     on public.documents (created_at desc);
create index if not exists idx_documents_status      on public.documents (status);
create index if not exists idx_documents_uploaded_by on public.documents (uploaded_by);

-- ---------------------------------------------------------------------------
-- Tabella: document_analyses
-- Il motore deterministico popola questi campi; un futuro LLM potrà popolarli
-- allo stesso modo senza cambiare lo schema né la UI.
-- ---------------------------------------------------------------------------
create table if not exists public.document_analyses (
  id                  uuid primary key default gen_random_uuid(),
  document_id         uuid not null references public.documents (id) on delete cascade,
  company_id          uuid not null references public.companies (id) on delete cascade,
  analysis_version    integer not null default 2,
  engine              text not null default 'deterministic-v2',
  language            text,
  sender              text,
  sender_evidence     jsonb,
  document_type       text,
  deadline            date,
  deadline_evidence   jsonb,
  amount              numeric(14,2),
  amount_currency     text,
  amount_evidence     jsonb,
  summary             text,
  actions             jsonb not null default '[]'::jsonb,
  requested_documents jsonb not null default '[]'::jsonb,
  risks               jsonb,
  uncertainties       jsonb not null default '[]'::jsonb,
  confidence          text,
  reply_draft         text,
  reply_language      text,
  reply_tone          text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_analyses_document on public.document_analyses (document_id);
create index if not exists idx_analyses_company  on public.document_analyses (company_id);

-- ---------------------------------------------------------------------------
-- Trigger updated_at
-- ---------------------------------------------------------------------------
create trigger trg_documents_updated  before update on public.documents         for each row execute function public.set_updated_at();
create trigger trg_analyses_updated   before update on public.document_analyses for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — accesso solo ai membri della company del record
-- ---------------------------------------------------------------------------
alter table public.documents         enable row level security;
alter table public.document_analyses enable row level security;

create policy documents_select_member on public.documents
  for select to authenticated using (public.is_company_member(company_id));
create policy documents_insert_member on public.documents
  for insert to authenticated with check (public.is_company_member(company_id) and uploaded_by = auth.uid());
create policy documents_update_member on public.documents
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
create policy documents_delete_member on public.documents
  for delete to authenticated using (public.is_company_member(company_id));

create policy analyses_select_member on public.document_analyses
  for select to authenticated using (public.is_company_member(company_id));
create policy analyses_insert_member on public.document_analyses
  for insert to authenticated with check (public.is_company_member(company_id));
create policy analyses_update_member on public.document_analyses
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
create policy analyses_delete_member on public.document_analyses
  for delete to authenticated using (public.is_company_member(company_id));

grant select, insert, update, delete on public.documents         to authenticated;
grant select, insert, update, delete on public.document_analyses to authenticated;
