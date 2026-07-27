-- ============================================================================
-- SwissAI Suite — SETUP COMPLETO DATABASE
-- Incolla TUTTO questo file nel SQL Editor di Supabase ed esegui.
--
-- GENERATO dalle migrazioni versionate: NON modificarlo a mano.
-- Per rigenerarlo dopo aver aggiunto una migrazione:  npm run db:bundle
--
-- Contiene, in ordine:
--   0001_core
--   0002_documents
--   0003_subsidy
--   0004_tasks
--   0005_storage
--   0006_admin_ai_pipeline
--   0007_subsidy_programs
--   0008_analysis_truth
--   0009_quota_and_upload_limits
--   0010_analysis_immutability
--   0011_program_availability
--   0012_program_translations
--   0013_inbox
--   0014_inbox_grants
--   0015_inbox_awaiting_analysis
--   0016_work_hub
--
-- È idempotente quanto lo sono le singole migrazioni: rieseguirlo è sicuro.
-- ============================================================================

-- >>>>>>>>>>>>>>>>>>>>  0001_core  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- SwissAI Suite — 0001 CORE
-- Utenti/profili, aziende, membership (multi-tenant), profilo azienda.
-- Include: enum ruoli, funzioni helper SECURITY DEFINER per RLS non ricorsiva,
-- trigger updated_at, trigger creazione profilo al signup, RPC onboarding atomico.
-- ============================================================================

-- Estensioni (gen_random_uuid è in pg_catalog su PG13+, pgcrypto per sicurezza)
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.member_role as enum ('owner', 'admin', 'member');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Funzione: updated_at automatico
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Tabella: profiles (1:1 con auth.users)
-- L'azienda NON sta qui: utente e azienda sono concetti separati.
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  first_name  text not null default '',
  last_name   text not null default '',
  email       text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tabella: companies
-- ---------------------------------------------------------------------------
create table if not exists public.companies (
  id            uuid primary key default gen_random_uuid(),
  legal_name    text not null,
  uid_che       text,
  canton        text,
  municipality  text,
  legal_form    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Tabella: company_members (relazione utente <-> azienda con ruolo)
-- ---------------------------------------------------------------------------
create table if not exists public.company_members (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        public.member_role not null default 'member',
  created_at  timestamptz not null default now(),
  unique (company_id, user_id)
);
create index if not exists idx_company_members_company on public.company_members (company_id);
create index if not exists idx_company_members_user    on public.company_members (user_id);

-- ---------------------------------------------------------------------------
-- Tabella: company_profiles (dati operativi/estesi dell'azienda)
-- ---------------------------------------------------------------------------
create table if not exists public.company_profiles (
  company_id        uuid primary key references public.companies (id) on delete cascade,
  sector            text,
  employee_count    integer,
  revenue_band      text,
  owns_property     boolean not null default false,
  vehicle_count     integer not null default 0,
  current_projects  jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Funzioni helper per RLS — SECURITY DEFINER per NON generare ricorsione
-- (leggono company_members bypassando la RLS di quella tabella).
-- ---------------------------------------------------------------------------
create or replace function public.is_company_member(p_company_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company_id
      and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_company_admin(p_company_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.company_members m
    where m.company_id = p_company_id
      and m.user_id = auth.uid()
      and m.role in ('owner', 'admin')
  );
$$;

revoke all on function public.is_company_member(uuid) from public;
revoke all on function public.is_company_admin(uuid)  from public;
grant execute on function public.is_company_member(uuid) to authenticated;
grant execute on function public.is_company_admin(uuid)  to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger: crea automaticamente il profilo alla registrazione (auth.users)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', '')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- RPC onboarding: crea azienda + membership owner + company_profile in modo
-- ATOMICO. SECURITY DEFINER così il bootstrap non è bloccato dalla RLS, ma
-- l'utente può creare solo aziende di cui diventa owner (user_id = auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function public.create_company_with_owner(
  p_legal_name     text,
  p_uid_che        text default null,
  p_canton         text default null,
  p_municipality   text default null,
  p_legal_form     text default null,
  p_sector         text default null,
  p_employee_count integer default null,
  p_revenue_band   text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company_id uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Utente non autenticato' using errcode = '28000';
  end if;
  if coalesce(btrim(p_legal_name), '') = '' then
    raise exception 'La ragione sociale è obbligatoria' using errcode = '22023';
  end if;

  insert into public.companies (legal_name, uid_che, canton, municipality, legal_form)
  values (btrim(p_legal_name), nullif(btrim(p_uid_che), ''), p_canton, p_municipality, p_legal_form)
  returning id into v_company_id;

  insert into public.company_members (company_id, user_id, role)
  values (v_company_id, v_uid, 'owner');

  insert into public.company_profiles (company_id, sector, employee_count, revenue_band)
  values (v_company_id, nullif(p_sector, ''), p_employee_count, nullif(p_revenue_band, ''));

  return v_company_id;
end;
$$;

revoke all on function public.create_company_with_owner(text, text, text, text, text, text, integer, text) from public;
grant execute on function public.create_company_with_owner(text, text, text, text, text, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger updated_at
-- ---------------------------------------------------------------------------
create trigger trg_profiles_updated        before update on public.profiles         for each row execute function public.set_updated_at();
create trigger trg_companies_updated       before update on public.companies        for each row execute function public.set_updated_at();
create trigger trg_company_profiles_updated before update on public.company_profiles for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.companies        enable row level security;
alter table public.company_members  enable row level security;
alter table public.company_profiles enable row level security;

-- profiles: ognuno vede/aggiorna solo il proprio profilo (l'insert è via trigger)
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- companies: leggibile dai membri; modificabile da owner/admin. Creazione via RPC.
create policy companies_select_member on public.companies
  for select to authenticated using (public.is_company_member(id));
create policy companies_update_admin on public.companies
  for update to authenticated using (public.is_company_admin(id)) with check (public.is_company_admin(id));

-- company_members: i membri vedono i co-membri; owner/admin gestiscono la membership.
create policy members_select_member on public.company_members
  for select to authenticated using (public.is_company_member(company_id));
create policy members_insert_admin on public.company_members
  for insert to authenticated with check (public.is_company_admin(company_id));
create policy members_update_admin on public.company_members
  for update to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
create policy members_delete_admin on public.company_members
  for delete to authenticated using (public.is_company_admin(company_id));

-- company_profiles: leggibile/modificabile dai membri (dati operativi del profilo).
create policy company_profiles_select_member on public.company_profiles
  for select to authenticated using (public.is_company_member(company_id));
create policy company_profiles_insert_member on public.company_profiles
  for insert to authenticated with check (public.is_company_member(company_id));
create policy company_profiles_update_member on public.company_profiles
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- Grant di tabella (RLS resta il gate reale; anon NON riceve nulla)
-- ---------------------------------------------------------------------------
grant select, update            on public.profiles         to authenticated;
grant select, update            on public.companies        to authenticated;
grant select, insert, update, delete on public.company_members to authenticated;
grant select, insert, update    on public.company_profiles to authenticated;

-- >>>>>>>>>>>>>>>>>>>>  0002_documents  <<<<<<<<<<<<<<<<<<<<

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

-- >>>>>>>>>>>>>>>>>>>>  0003_subsidy  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- SwissAI Suite — 0003 SUBSIDY
-- Attività dell'utente sugli incentivi: match valutati, pratiche, item pratica.
-- (I programmi restano nel dataset demo lato client in questa fase.)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.eligibility_status as enum ('unknown', 'likely', 'unlikely', 'ineligible');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.subsidy_case_status as enum ('draft', 'collecting_documents', 'ready', 'submitted', 'closed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tabella: subsidy_matches (esito della verifica di idoneità per programma)
-- Un record per (company, program): la verifica successiva aggiorna (upsert).
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_matches (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  program_id             text not null,
  relevance_score        integer,
  eligibility_status     public.eligibility_status not null default 'unknown',
  answers                jsonb not null default '{}'::jsonb,
  satisfied_requirements jsonb not null default '[]'::jsonb,
  unknown_requirements   jsonb not null default '[]'::jsonb,
  failed_requirements    jsonb not null default '[]'::jsonb,
  source_last_checked_at date,
  evaluated_at           timestamptz not null default now(),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  unique (company_id, program_id)
);
create index if not exists idx_matches_company on public.subsidy_matches (company_id);
create index if not exists idx_matches_program on public.subsidy_matches (program_id);

-- ---------------------------------------------------------------------------
-- Tabella: subsidy_cases (le pratiche)
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_cases (
  id                             uuid primary key default gen_random_uuid(),
  company_id                     uuid not null references public.companies (id) on delete cascade,
  created_by                     uuid references auth.users (id) on delete set null,
  program_id                     text not null,
  program_name                   text,
  authority                      text,
  status                         public.subsidy_case_status not null default 'draft',
  eligibility_status_at_creation public.eligibility_status,
  relevance_score                integer,
  source_last_checked_at         date,
  eligibility_snapshot           jsonb,
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);
create index if not exists idx_cases_company on public.subsidy_cases (company_id);
create index if not exists idx_cases_status  on public.subsidy_cases (status);
create index if not exists idx_cases_created_by on public.subsidy_cases (created_by);

-- ---------------------------------------------------------------------------
-- Tabella: subsidy_case_items (checklist documenti della pratica)
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_case_items (
  id               uuid primary key default gen_random_uuid(),
  subsidy_case_id  uuid not null references public.subsidy_cases (id) on delete cascade,
  title            text not null,
  completed        boolean not null default false,
  sort_order       integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_case_items_case on public.subsidy_case_items (subsidy_case_id);

-- ---------------------------------------------------------------------------
-- Helper: membership via pratica (SECURITY DEFINER, evita RLS annidata)
-- ---------------------------------------------------------------------------
create or replace function public.is_case_member(p_case_id uuid)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select exists (
    select 1
    from public.subsidy_cases c
    join public.company_members m on m.company_id = c.company_id
    where c.id = p_case_id
      and m.user_id = auth.uid()
  );
$$;
revoke all on function public.is_case_member(uuid) from public;
grant execute on function public.is_case_member(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Trigger updated_at
-- ---------------------------------------------------------------------------
create trigger trg_matches_updated    before update on public.subsidy_matches    for each row execute function public.set_updated_at();
create trigger trg_cases_updated       before update on public.subsidy_cases      for each row execute function public.set_updated_at();
create trigger trg_case_items_updated  before update on public.subsidy_case_items for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.subsidy_matches    enable row level security;
alter table public.subsidy_cases      enable row level security;
alter table public.subsidy_case_items enable row level security;

create policy matches_select_member on public.subsidy_matches
  for select to authenticated using (public.is_company_member(company_id));
create policy matches_insert_member on public.subsidy_matches
  for insert to authenticated with check (public.is_company_member(company_id));
create policy matches_update_member on public.subsidy_matches
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
create policy matches_delete_member on public.subsidy_matches
  for delete to authenticated using (public.is_company_member(company_id));

create policy cases_select_member on public.subsidy_cases
  for select to authenticated using (public.is_company_member(company_id));
create policy cases_insert_member on public.subsidy_cases
  for insert to authenticated with check (public.is_company_member(company_id) and created_by = auth.uid());
create policy cases_update_member on public.subsidy_cases
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
create policy cases_delete_member on public.subsidy_cases
  for delete to authenticated using (public.is_company_member(company_id));

create policy case_items_select_member on public.subsidy_case_items
  for select to authenticated using (public.is_case_member(subsidy_case_id));
create policy case_items_insert_member on public.subsidy_case_items
  for insert to authenticated with check (public.is_case_member(subsidy_case_id));
create policy case_items_update_member on public.subsidy_case_items
  for update to authenticated using (public.is_case_member(subsidy_case_id)) with check (public.is_case_member(subsidy_case_id));
create policy case_items_delete_member on public.subsidy_case_items
  for delete to authenticated using (public.is_case_member(subsidy_case_id));

grant select, insert, update, delete on public.subsidy_matches    to authenticated;
grant select, insert, update, delete on public.subsidy_cases      to authenticated;
grant select, insert, update, delete on public.subsidy_case_items to authenticated;

-- >>>>>>>>>>>>>>>>>>>>  0004_tasks  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- SwissAI Suite — 0004 TASKS (Scadenziario)
-- Attività/scadenze, collegabili opzionalmente a un documento o a una pratica.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Enum
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.task_priority as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_status as enum ('open', 'completed');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.task_source as enum ('admin_ai', 'subsidy_ai', 'manual');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Tabella: tasks
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  created_by       uuid references auth.users (id) on delete set null,
  document_id      uuid references public.documents (id) on delete set null,
  subsidy_case_id  uuid references public.subsidy_cases (id) on delete set null,
  title            text not null,
  description      text,
  authority        text,
  due_date         date,
  priority         public.task_priority not null default 'medium',
  status           public.task_status not null default 'open',
  source           public.task_source not null default 'manual',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index if not exists idx_tasks_company    on public.tasks (company_id);
create index if not exists idx_tasks_due_date    on public.tasks (due_date);
create index if not exists idx_tasks_status      on public.tasks (status);
create index if not exists idx_tasks_created_by  on public.tasks (created_by);
create index if not exists idx_tasks_document    on public.tasks (document_id);

-- ---------------------------------------------------------------------------
-- Trigger updated_at
-- ---------------------------------------------------------------------------
create trigger trg_tasks_updated before update on public.tasks for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.tasks enable row level security;

create policy tasks_select_member on public.tasks
  for select to authenticated using (public.is_company_member(company_id));
create policy tasks_insert_member on public.tasks
  for insert to authenticated with check (public.is_company_member(company_id) and created_by = auth.uid());
create policy tasks_update_member on public.tasks
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
create policy tasks_delete_member on public.tasks
  for delete to authenticated using (public.is_company_member(company_id));

grant select, insert, update, delete on public.tasks to authenticated;

-- >>>>>>>>>>>>>>>>>>>>  0005_storage  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- SwissAI Suite — 0005 STORAGE
-- Bucket PRIVATO per i documenti aziendali. Accesso via signed URL temporanei.
-- Path convenzione: <company_id>/<document_id>/<original_filename>
-- La prima cartella del path (company_id) determina l'accesso via membership.
-- ============================================================================

-- Bucket privato (public = false)
insert into storage.buckets (id, name, public)
values ('company-documents', 'company-documents', false)
on conflict (id) do nothing;

-- Policy su storage.objects, ristrette al bucket e alla company del path.
-- (storage.foldername(name))[1] = primo segmento del path = company_id.
create policy "company_documents_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'company-documents'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  );

create policy "company_documents_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'company-documents'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  );

create policy "company_documents_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'company-documents'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'company-documents'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  );

create policy "company_documents_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'company-documents'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  );

-- >>>>>>>>>>>>>>>>>>>>  0006_admin_ai_pipeline  <<<<<<<<<<<<<<<<<<<<

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

-- >>>>>>>>>>>>>>>>>>>>  0007_subsidy_programs  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- SwissAI Suite — 0007 SUBSIDY: catalogo programmi di incentivo (dati reali)
--
-- Sposta i programmi dal dataset hardcoded (demo) a una TABELLA gestibile, così
-- si aggiornano senza deploy del frontend e ogni voce porta con sé la fonte
-- ufficiale + la data di revisione (§ verificabilità: nessun dato inventato).
--
-- È un CATALOGO condiviso (non dati per-azienda): lettura per tutti gli utenti
-- autenticati, scrittura solo server-side (service_role) previa verifica umana.
-- Il motore di matching resta invariato: il service ricostruisce il ProgramModel.
-- ============================================================================

create table if not exists public.subsidy_programs (
  id                            text primary key,            -- slug stabile (es. 'innosuisse'); referenziato da subsidy_matches/cases
  name                          text not null,
  authority                     text not null,
  support_type                  text not null default 'grant',   -- grant | tax_relief | guarantee | loan | reimbursement | advisory | other
  geography                     text[] not null default '{}',    -- es. {'ALL'} oppure {'Ticino'}
  target_sectors                text[] not null default '{}',    -- id settori ammessi, oppure {'ALL'}
  company_size_min              integer not null default 0,
  company_size_max              integer not null default 100000,
  project_types                 text[] not null default '{}',    -- id tipi progetto pertinenti
  -- [{ "id","text","question","mustBe":"si","hard":true|false }]
  requirements                  jsonb not null default '[]'::jsonb,
  -- [{ "id","text","question":null|string,"triggeringAnswer":null|string,"evaluable":bool }]
  exclusions                    jsonb not null default '[]'::jsonb,
  contribution_description      text,
  application_window            text,
  must_apply_before_start       boolean not null default false,
  must_apply_before_start_text  text,
  documents_required            text[] not null default '{}',
  -- Provenienza e verificabilità (§)
  official_source_url           text not null,
  source_title                  text,
  last_checked_at               date,
  data_status                   text not null default 'verified',  -- verified | recheck | demo
  active                        boolean not null default true,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists idx_subsidy_programs_active on public.subsidy_programs (active);

-- RLS: catalogo condiviso. Lettura ai membri autenticati; scrittura solo service_role.
alter table public.subsidy_programs enable row level security;

drop policy if exists subsidy_programs_select on public.subsidy_programs;
create policy subsidy_programs_select on public.subsidy_programs
  for select to authenticated using (active = true);

grant select on public.subsidy_programs to authenticated;

drop trigger if exists trg_subsidy_programs_updated on public.subsidy_programs;
create trigger trg_subsidy_programs_updated before update on public.subsidy_programs
  for each row execute function public.set_updated_at();

-- >>>>>>>>>>>>>>>>>>>>  0008_analysis_truth  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- 0008 — "verità dell'analisi": correzioni di correttezza e sicurezza.
--
-- 1) ai_request_log: chiudere la falla per cui un membro poteva falsificare il
--    log e bloccare l'AI dell'intera azienda (rate limit avvelenato).
-- 2) document_analyses.amount_type: il tipo dell'importo principale, per non
--    presentare mai una multa come "importo dovuto" (§12).
-- 3) document_extractions.truncated: dichiarare quando il testo inviato al
--    modello è stato tagliato, invece di spacciare l'analisi per completa (§28).
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) ai_request_log — un membro poteva inserire righe a nome di ALTRI utenti e
--    con `created_at` arbitrario (anche futuro). Con 12 righe nella finestra si
--    rendeva il rate limit un 429 permanente per tutti i colleghi, e l'audit
--    diventava inaffidabile perché `user_id` non era attribuibile.
--    Le policy gemelle (replies, corrections) vincolavano già l'identità: qui
--    mancava. Si allinea, e si impedisce di retrodatare/postdatare la riga.
-- ---------------------------------------------------------------------------
alter table public.ai_request_log
  alter column created_at set default now();

drop policy if exists ai_log_insert_member on public.ai_request_log;
create policy ai_log_insert_member on public.ai_request_log
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and user_id = auth.uid()                                   -- non si scrive a nome d'altri
    and created_at between now() - interval '5 minutes'        -- niente righe retrodatate
                       and now() + interval '1 minute'         -- né postdatate (rate limit avvelenato)
  );

-- La colonna `created_at` non deve poter essere scelta liberamente dal client:
-- il default `now()` vale quando non viene passata, la policy blocca il resto.
comment on policy ai_log_insert_member on public.ai_request_log is
  'Un membro può registrare solo le PROPRIE chiamate, con timestamp coerente: impedisce di avvelenare il rate limit altrui e mantiene il log attribuibile.';

-- ---------------------------------------------------------------------------
-- 2) Tipo dell'importo principale (§12).
--    `amount` conserva l'importo "di testa": se il documento non contiene un
--    importo DOVUTO si ripiega sul più rilevante, ma il tipo va dichiarato
--    perché una multa non è una richiesta di pagamento.
-- ---------------------------------------------------------------------------
alter table public.document_analyses
  add column if not exists amount_type text;

comment on column public.document_analyses.amount_type is
  'Tipo dell''importo in `amount`: due | fine | fee | contribution | other. NULL = nessun importo rilevato.';

-- ---------------------------------------------------------------------------
-- 3) Troncamento del testo dichiarato (§28).
--    Oltre il limite di caratteri il modello vede solo l'inizio del documento:
--    va registrato, altrimenti un'analisi parziale sembra completa.
-- ---------------------------------------------------------------------------
alter table public.document_extractions
  add column if not exists truncated boolean not null default false;

comment on column public.document_extractions.truncated is
  'true = il testo inviato al modello è stato tagliato al limite: l''analisi può non coprire la parte finale del documento.';

-- >>>>>>>>>>>>>>>>>>>>  0009_quota_and_upload_limits  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- 0009 — Controllo abusi e costi: quota AI atomica + limiti di upload reali.
--
-- 1) Rate limit §50: oggi è "leggi-poi-agisci" (si conta prima del lavoro e si
--    scrive dopo), quindi N richieste concorrenti leggono lo stesso conteggio e
--    passano TUTTE. Qui la verifica e la prenotazione dello slot diventano una
--    sola operazione serializzata per azienda.
-- 2) Il limite di dimensione file si fidava di `documents.file_size`, colonna
--    scritta dal browser: si impone il limite sul BUCKET, dove il client non
--    può mentire, insieme ai tipi MIME ammessi.
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Quota AI atomica.
--    `pg_advisory_xact_lock` serializza le richieste della STESSA azienda per la
--    durata della transazione: due chiamate concorrenti non possono più leggere
--    lo stesso conteggio e passare entrambe. Aziende diverse non si bloccano a
--    vicenda (il lock è sull'id dell'azienda).
--    La riga viene PRENOTATA subito con stato 'pending': una richiesta in corso
--    occupa la sua quota, che è la semantica corretta. `finalize_ai_request` la
--    completa con l'esito reale.
-- ---------------------------------------------------------------------------
create or replace function public.try_consume_ai_quota(
  p_company_id uuid,
  p_kind text,
  p_limit int,
  p_document_id uuid default null,
  p_provider text default null,
  p_model text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_id uuid;
begin
  -- Autorizzazione esplicita: SECURITY DEFINER scavalca la RLS, quindi la
  -- membership va verificata qui dentro, non darla per scontata.
  if auth.uid() is null or not public.is_company_member(p_company_id) then
    raise exception 'not a member of company %', p_company_id using errcode = '42501';
  end if;

  -- Serializza le richieste concorrenti della stessa azienda.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 0));

  select count(*) into v_count
    from public.ai_request_log
   where company_id = p_company_id
     and created_at > now() - interval '1 minute';

  if v_count >= p_limit then
    return null;                      -- quota esaurita: il chiamante risponde 429
  end if;

  insert into public.ai_request_log (company_id, user_id, document_id, kind, provider, model, status)
  values (p_company_id, auth.uid(), p_document_id, p_kind, p_provider, p_model, 'pending')
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.try_consume_ai_quota is
  'Verifica e consuma in modo ATOMICO uno slot di quota AI per l''azienda. Ritorna l''id della riga di log prenotata, oppure NULL se il limite è già stato raggiunto.';

-- Completa la riga prenotata con l'esito. SECURITY DEFINER perché al client non
-- viene concesso UPDATE diretto sul log (resta append-only dal suo punto di vista).
create or replace function public.finalize_ai_request(
  p_id uuid,
  p_status text,
  p_duration_ms int default null,
  p_input_tokens int default null,
  p_output_tokens int default null,
  p_error_code text default null,
  p_model text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_request_log
     set status        = coalesce(p_status, status),
         duration_ms   = coalesce(p_duration_ms, duration_ms),
         input_tokens  = coalesce(p_input_tokens, input_tokens),
         output_tokens = coalesce(p_output_tokens, output_tokens),
         error_code    = coalesce(p_error_code, error_code),
         model         = coalesce(p_model, model)
   where id = p_id
     and user_id = auth.uid();        -- si completa solo la PROPRIA riga
end;
$$;

comment on function public.finalize_ai_request is
  'Completa con l''esito una riga di ai_request_log prenotata da try_consume_ai_quota. Un utente può aggiornare solo le proprie righe.';

revoke all on function public.try_consume_ai_quota(uuid, text, int, uuid, text, text) from public;
revoke all on function public.finalize_ai_request(uuid, text, int, int, int, text, text) from public;
grant execute on function public.try_consume_ai_quota(uuid, text, int, uuid, text, text) to authenticated;
grant execute on function public.finalize_ai_request(uuid, text, int, int, int, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Limiti di upload imposti dal BUCKET (il client non può aggirarli).
--    `documents.file_size` è scritto dal browser: usarlo come unico controllo
--    significa fidarsi di un valore che l'utente decide. Il bucket invece rifiuta
--    l'oggetto a monte.
--    15 MB = lo stesso tetto già applicato lato Edge Function (MAX_FILE_BYTES).
-- ---------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 15728640,             -- 15 MB
       allowed_mime_types = array[
         'application/pdf',
         'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/tiff',
         'text/plain', 'message/rfc822'
       ]
 where id = 'company-documents';

-- >>>>>>>>>>>>>>>>>>>>  0010_analysis_immutability  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- SwissAI Suite — 0010 IMMUTABILITÀ DELL'ANALISI
--
-- Il problema che chiude. `document_analyses` era insieme due cose:
--   · lo SNAPSHOT dell'analisi AI, che il README dichiara immutabile;
--   · lo STATO MUTABILE dell'utente (spunte della checklist, bozza di risposta).
-- Per permettere la seconda, la 0002 concedeva update e delete sull'INTERA
-- tabella a ogni membro. Conseguenza: chiunque, con la sola chiave anon e una
-- sessione valida, poteva riscrivere via API scadenza, mittente e importi di
-- un'analisi — cioè proprio i campi su cui poggia la promessa di verificabilità.
-- L'immutabilità era un'affermazione della documentazione, non un vincolo.
--
-- Cosa fa questa migrazione:
--   1. action_progress — lo stato della checklist esce dall'analisi e va in una
--      tabella propria;
--   2. le bozze di risposta vivono solo in document_replies (che esiste dalla
--      0006); reply_draft/reply_language/reply_tone diventano deprecate;
--   3. MIGRA i dati esistenti e SOLO DOPO revoca update e delete;
--   4. l'insert dal client resta, ma vincolato al motore locale: un membro non
--      può più fabbricare una riga che si spaccia per analisi AI;
--   5. document_extractions torna in sola lettura per il client, che non l'ha
--      mai scritta (la scrive la pipeline con service role).
--
-- ORDINE DI MESSA IN OPERA — questa migrazione va applicata PRIMA di deployare
-- il codice che la accompagna, non dopo. Nell'intervallo il frontend vecchio,
-- che scrive ancora sull'analisi, riceve un errore esplicito sulla spunta della
-- checklist: un guasto visibile, non un salvataggio che sembra riuscito. Il
-- percorso inverso (codice nuovo su schema vecchio) darebbe lo stesso errore su
-- una tabella inesistente. Non esiste un ordine indolore: si sceglie quello che
-- fallisce in modo dichiarato, coerente con §60 (nessun fallback silenzioso).
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. action_progress — la checklist dell'utente, separata dallo snapshot
--
-- Perché una tabella nuova e non un'estensione di `tasks`: sono due oggetti
-- diversi. Un task dello scadenziario è creato deliberatamente dall'utente,
-- ha titolo, priorità e scadenza proprie e SOPRAVVIVE all'analisi (resta anche
-- se il documento viene rianalizzato). La spunta di una checklist è invece
-- legata a UNA specifica analisi, identificata dalla posizione dell'azione in
-- quello snapshot: usare `tasks` significherebbe o creare una voce di
-- scadenziario a ogni spunta — inquinando la lista delle scadenze vere — o
-- aggiungere a `tasks` colonne che valgono solo per le azioni. Le due cose
-- restano collegate dal pulsante "aggiungi allo scadenziario", che continua a
-- creare un task vero.
--
-- Chiave (analysis_id, action_index): `action_index` è la posizione dell'azione
-- nell'array `document_analyses.actions`, che coincide sempre con il campo `id`
-- dell'oggetto perché entrambi i motori rinumerano le azioni dopo l'ordinamento
-- finale (engine.ts e _shared/persist.ts). Poiché ogni rianalisi crea una NUOVA
-- riga in document_analyses, il progresso non può mai riferirsi a un'azione
-- diversa da quella spuntata.
-- ---------------------------------------------------------------------------
create table if not exists public.action_progress (
  id            uuid primary key default gen_random_uuid(),
  analysis_id   uuid not null references public.document_analyses (id) on delete cascade,
  company_id    uuid not null references public.companies (id) on delete cascade,
  action_index  integer not null check (action_index >= 0),
  -- Copia del testo dell'azione al momento della spunta. Non è usata per
  -- leggere il progresso: serve a poter DIMOSTRARE, rileggendo lo snapshot, che
  -- l'indice punta ancora all'azione che l'utente aveva davanti. Se un giorno
  -- l'ordinamento cambiasse, la divergenza sarebbe rilevabile invece che muta.
  action_text   text,
  done          boolean not null default false,
  -- NULL quando `done` è false, e anche per le righe importate da questa
  -- migrazione: di quelle spunte non conosciamo né autore né momento, e un
  -- valore di ripiego sarebbe un dato inventato (§60).
  done_by       uuid references auth.users (id) on delete set null,
  done_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (analysis_id, action_index)
);
create index if not exists idx_action_progress_analysis on public.action_progress (analysis_id);
create index if not exists idx_action_progress_company  on public.action_progress (company_id);

comment on table public.action_progress is
  'Stato della checklist per singola azione di una analisi. Separata da document_analyses, che è uno snapshot immutabile.';
comment on column public.action_progress.action_index is
  'Posizione dell''azione in document_analyses.actions, uguale al campo id dell''oggetto azione.';
comment on column public.action_progress.done_at is
  'NULL = spunta importata dalla 0010 (momento reale ignoto) oppure azione non spuntata. Mai un valore di ripiego.';

-- ---------------------------------------------------------------------------
-- 2. Attribuzione decisa dal database, non dal client
--
-- `done_by` e `done_at` non vengono letti dalla richiesta: li imposta questo
-- trigger. Così un membro non può attribuire una spunta a un collega né datarla
-- a piacere, e il client non deve ricordarsi di farlo.
--
-- Quando `auth.uid()` è NULL (migrazione dei dati, service role) i valori
-- passati NON vengono sovrascritti: è il caso delle righe storiche, che restano
-- con done_at NULL invece di ricevere il timestamp della migrazione.
-- ---------------------------------------------------------------------------
create or replace function public.set_action_progress_actor()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();

  if not new.done then
    new.done_by := null;
    new.done_at := null;
    return new;
  end if;

  if auth.uid() is null then
    return new;                                    -- import/service role: nessuna attribuzione inventata
  end if;

  -- NB: su INSERT il record OLD non esiste, e in plpgsql non si può contare sulla
  -- valutazione pigra di un OR per evitarlo: i due casi restano separati.
  if tg_op = 'INSERT' then
    new.done_by := auth.uid();
    new.done_at := now();
  elsif not coalesce(old.done, false) then
    new.done_by := auth.uid();                     -- transizione a "fatto": chi la compie è chi la firma
    new.done_at := now();
  else
    new.done_by := coalesce(old.done_by, auth.uid());
    new.done_at := coalesce(old.done_at, now());   -- già spuntata: si conserva la prima firma
  end if;
  return new;
end $$;

drop trigger if exists trg_action_progress_actor on public.action_progress;
create trigger trg_action_progress_actor
  before insert or update on public.action_progress
  for each row execute function public.set_action_progress_actor();

-- ---------------------------------------------------------------------------
-- 3. RLS di action_progress
--
-- Oltre alla membership si verifica che l'analisi appartenga alla STESSA
-- azienda indicata nella riga: senza questo controllo un membro potrebbe
-- agganciare righe di progresso ad analisi di un'altra azienda passando il
-- proprio company_id. La sottoquery è a sua volta soggetta alla RLS di
-- document_analyses, quindi non rivela nulla di ciò che l'utente non può già
-- leggere: se l'analisi non è sua, l'exists è semplicemente falso.
--
-- Nessuna policy di DELETE: per togliere una spunta si aggiorna `done` a false.
-- Le righe spariscono solo in cascata con l'analisi.
-- ---------------------------------------------------------------------------
alter table public.action_progress enable row level security;

drop policy if exists action_progress_select_member on public.action_progress;
create policy action_progress_select_member on public.action_progress
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists action_progress_insert_member on public.action_progress;
create policy action_progress_insert_member on public.action_progress
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.document_analyses a
      where a.id = action_progress.analysis_id
        and a.company_id = action_progress.company_id
    )
  );

drop policy if exists action_progress_update_member on public.action_progress;
create policy action_progress_update_member on public.action_progress
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.document_analyses a
      where a.id = action_progress.analysis_id
        and a.company_id = action_progress.company_id
    )
  );

grant select, insert, update on public.action_progress to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Bozze di risposta: document_replies è l'unica sede
--
-- Le colonne restano in tabella per non perdere i dati storici già copiati
-- sotto, ma nessuno le scrive più e nessuno le legge più.
-- ---------------------------------------------------------------------------
comment on column public.document_analyses.reply_draft is
  'DEPRECATA (0010): la bozza corrente vive in document_replies. Conservata per i dati storici, non più scritta né letta.';
comment on column public.document_analyses.reply_language is
  'DEPRECATA (0010): vedi document_replies.language.';
comment on column public.document_analyses.reply_tone is
  'DEPRECATA (0010): vedi document_replies.tone.';

-- ---------------------------------------------------------------------------
-- 5. MIGRAZIONE DEI DATI — prima di togliere qualunque permesso
-- ---------------------------------------------------------------------------

-- 5a. Spunte della checklist → action_progress.
--     Si importano solo le azioni realmente spuntate: una riga per ogni `done`
--     a true. Le azioni non spuntate non hanno bisogno di riga (assenza = non
--     fatta). `action_index` viene dal campo `id` dell'oggetto quando è un
--     intero, altrimenti dalla posizione nell'array: i due valori coincidono
--     per costruzione, ma non si dà per scontato un dato storico.
insert into public.action_progress (analysis_id, company_id, action_index, action_text, done, done_by, done_at)
select
  a.id,
  a.company_id,
  case when elem->>'id' ~ '^[0-9]+$' then (elem->>'id')::int else (ord - 1)::int end,
  nullif(elem->>'text', ''),
  true,
  null,                                            -- autore ignoto: non si inventa
  null                                             -- momento ignoto: non si inventa
from public.document_analyses a
cross join lateral jsonb_array_elements(a.actions) with ordinality as t(elem, ord)
where jsonb_typeof(a.actions) = 'array'
  and coalesce(elem->>'done', 'false') = 'true'
on conflict (analysis_id, action_index) do nothing;

-- 5b. Bozze → document_replies, una sola per documento (la più recente), e solo
--     se quel documento non ha già una bozza propria: le bozze generate dall'AI
--     sono la fonte migliore e non vanno scavalcate da una copia legacy.
--     `created_by` NULL identifica le righe importate: nessun utente le ha
--     scritte, e la policy che impone created_by = auth.uid() vale solo per gli
--     insert fatti dal client.
insert into public.document_replies
  (document_id, company_id, analysis_id, created_by, language, tone, content, provider, model, prompt_version, is_edited)
select distinct on (a.document_id)
  a.document_id,
  a.company_id,
  a.id,
  null,
  coalesce(nullif(a.reply_language, ''), nullif(a.language, ''), 'it'),
  coalesce(nullif(a.reply_tone, ''), 'formale'),
  a.reply_draft,
  a.engine,                                        -- provenienza reale: il motore che l'ha prodotta
  null,
  null,
  false                                            -- non sappiamo se fu modificata a mano: non lo si afferma
from public.document_analyses a
where coalesce(a.reply_draft, '') <> ''
  and not exists (
    select 1 from public.document_replies r where r.document_id = a.document_id
  )
order by a.document_id, a.created_at desc;

-- ---------------------------------------------------------------------------
-- 6. SOLO ORA: lo snapshot diventa davvero immutabile
--
-- Restano select e insert. L'insert serve al motore locale, che analizza nel
-- browser (§60) — ma viene vincolato: engine deve essere quello deterministico
-- e i campi di provenienza AI devono restare vuoti. Un membro non può quindi
-- creare una riga che, riletta, sembrerebbe prodotta dal modello.
--
-- ⚠️ PREREQUISITO: la Edge Function `analyze-document` va RIDEPLOYATA insieme a
-- questa migrazione. Fino alla 0009 persisteva l'analisi usando il JWT
-- dell'utente (chiave anon), quindi come ruolo `authenticated`: con queste
-- restrizioni fallirebbe. La versione aggiornata usa un secondo client con
-- service role per le sole scritture, mantenendo il client utente per le letture
-- di autorizzazione, così il controllo cross-tenant (§49) resta dov'era.
--   npx supabase functions deploy analyze-document --project-ref <ref>
-- ---------------------------------------------------------------------------
drop policy if exists analyses_update_member on public.document_analyses;
drop policy if exists analyses_delete_member on public.document_analyses;
revoke update, delete on public.document_analyses from authenticated;

drop policy if exists analyses_insert_member on public.document_analyses;
create policy analyses_insert_member on public.document_analyses
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and engine like 'deterministic-%'              -- niente righe che si spacciano per AI
    and provider is null
    and model is null
    and prompt_version is null
  );

comment on policy analyses_insert_member on public.document_analyses is
  'Il client può inserire solo analisi del motore locale, senza campi di provenienza AI. Le analisi AI le scrive la Edge Function con service role.';
comment on table public.document_analyses is
  'Snapshot immutabile dell''analisi. Dalla 0010 il client ha solo select e insert vincolato: niente update, niente delete. Lo stato dell''utente sta in action_progress e document_replies.';

-- ---------------------------------------------------------------------------
-- 7. document_extractions — sola lettura per il client
--
-- Il testo estratto lo scrive la pipeline (supabase/functions/_shared/persist.ts),
-- che dalla versione rideployata insieme a questa migrazione usa il service role;
-- il client fa solo select (documentService.getExtraction).
-- I permessi di insert/update/delete concessi dalla 0006 non sono mai serviti al
-- browser — li usava solo la Edge Function, che ora scrive con service role — e
-- permettevano di riscrivere il testo su cui le citazioni vengono verificate:
-- alterandolo si potrebbe far "verificare" una citazione che il documento non
-- contiene, che è il contrario della garanzia §20.
-- ---------------------------------------------------------------------------
drop policy if exists extractions_insert_member on public.document_extractions;
drop policy if exists extractions_update_member on public.document_extractions;
drop policy if exists extractions_delete_member on public.document_extractions;
revoke insert, update, delete on public.document_extractions from authenticated;

comment on table public.document_extractions is
  'Testo estratto, base della verifica delle citazioni (§20). Scritta solo dalla pipeline con service role; dalla 0010 il client ha la sola select.';

-- >>>>>>>>>>>>>>>>>>>>  0011_program_availability  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- SwissAI Suite — 0011 DISPONIBILITÀ DEI PROGRAMMI
--
-- Il problema che chiude. Un programma di incentivo può esistere, essere
-- documentato e corretto in ogni suo dettaglio, e ciononostante NON essere
-- ottenibile: la legge lo subordina a una condizione che oggi non ricorre.
--
-- È il caso dell'incentivo ticinese all'assunzione di disoccupati (L-rilocc,
-- RL 857.100): l'art. 3 lo attiva solo se il tasso di disoccupazione medio
-- dell'anno civile precedente raggiunge il tasso di riferimento fissato dal
-- Consiglio di Stato, con massimale del 4%. Il tasso ticinese è oggi intorno al
-- 2,4–3%, e il Cantone dichiara la misura sospesa.
--
-- Finora il catalogo aveva solo `active` (booleano) e `data_status`
-- (verified/recheck/demo). Nessuno dei due esprime «esiste ma non è
-- concedibile»: spegnere `active` lo fa sparire — l'utente non sa che esiste e
-- che potrebbe tornare — mentre lasciarlo attivo lo presenta come disponibile,
-- che è un dato falso. Un requisito "soft" non è la sede giusta: la condizione
-- non riguarda l'azienda e l'imprenditore non può valutarla.
--
-- Da qui una terza informazione, separata dalle altre due: la DISPONIBILITÀ,
-- con il motivo e la fonte che lo attesta, così l'app può dire «questo esiste,
-- ecco cos'è, oggi non è ottenibile e questo è il perché» invece di tacere o
-- di promettere.
--
-- ORDINE: applicare PRIMA di deployare il codice che la accompagna, poi
-- rieseguire il seed del catalogo (`npm run subsidy:seed -- --write`).
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

alter table public.subsidy_programs
  add column if not exists availability text not null default 'available';

-- Il vincolo è ricreato ogni volta per restare idempotente senza dipendere
-- dall'esistenza pregressa (non esiste `add constraint if not exists`).
alter table public.subsidy_programs
  drop constraint if exists subsidy_programs_availability_check;
alter table public.subsidy_programs
  add constraint subsidy_programs_availability_check
  check (availability in ('available', 'suspended'));

-- Perché non è concedibile, in linguaggio comprensibile. In italiano come il
-- resto dei contenuti del catalogo (i testi dei programmi non sono tradotti:
-- lo sono le etichette dell'interfaccia).
alter table public.subsidy_programs
  add column if not exists availability_note text;

-- La fonte che attesta la sospensione. Senza questa, «sospeso» sarebbe
-- un'affermazione dell'app anziché un fatto verificabile: la stessa regola che
-- vale per le analisi documentali vale per il catalogo.
alter table public.subsidy_programs
  add column if not exists availability_source_url text;

-- Quando lo stato è stato verificato l'ultima volta. Distinto da
-- `last_checked_at`, che riguarda il CONTENUTO del programma: il contenuto può
-- restare valido per anni mentre la disponibilità cambia ogni anno, perché
-- dipende da una statistica annuale.
alter table public.subsidy_programs
  add column if not exists availability_checked_at date;

comment on column public.subsidy_programs.availability is
  'available = concedibile; suspended = esiste ed è documentato ma oggi non è ottenibile (condizione di legge non soddisfatta). Diverso da `active`, che nasconde del tutto il programma.';
comment on column public.subsidy_programs.availability_note is
  'Motivo della sospensione, in linguaggio comprensibile. Obbligatorio nei fatti quando availability = suspended: senza motivo, «sospeso» non è verificabile.';
comment on column public.subsidy_programs.availability_source_url is
  'Fonte che attesta lo stato di disponibilità (può differire da official_source_url).';
comment on column public.subsidy_programs.availability_checked_at is
  'Data dell''ultima verifica dello STATO. Distinta da last_checked_at, che riguarda il contenuto del programma.';

-- >>>>>>>>>>>>>>>>>>>>  0012_program_translations  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- SwissAI Suite — 0012 TRADUZIONI DEL CATALOGO INCENTIVI
--
-- L'interfaccia è trilingue dal 2026-07, ma i CONTENUTI dei programmi no: nomi,
-- requisiti, descrizione del contributo e finestra di domanda vivono in questa
-- tabella e venivano mostrati in italiano anche in tedesco e francese. Per una
-- PMI germanofona o romanda è il testo che conta davvero — i requisiti da
-- soddisfare — a restare in una lingua che non è la sua.
--
-- Perché QUI e non nei dizionari `src/i18n/`: il catalogo è un DATO, aggiornabile
-- senza un deploy. Spostare i suoi testi nel codice avrebbe legato ogni
-- correzione di un requisito a una nuova pubblicazione dell'applicazione.
--
-- Struttura: una sola colonna JSONB, niente tabella separata né una colonna per
-- lingua. Le join non servono (si legge sempre l'intero programma) e aggiungere
-- una lingua non richiede una migrazione.
--
--   {
--     "de": {
--       "name": "...", "authority": "...", "contribution_description": "...",
--       "application_window": "...", "must_apply_before_start_text": "...",
--       "source_title": "...", "availability_note": "...",
--       "documents_required": ["...", "..."],
--       "requirements": { "<id>": { "text": "...", "question": "..." } },
--       "exclusions":   { "<id>": { "text": "...", "question": "..." } }
--     },
--     "fr": { ... }
--   }
--
-- Requisiti ed esclusioni sono indicizzati per ID, non per posizione: se un
-- domani se ne aggiunge uno o cambia l'ordine, le traduzioni restano agganciate
-- a ciò che traducono invece di scivolare sulla voce sbagliata.
--
-- Cosa NON viene tradotto, di proposito: le sigle e le denominazioni ufficiali
-- (LInn, FER, L-Rilocc, ProKilowatt, Innosuisse, Pronovo) e gli URL delle fonti.
-- Dove una denominazione ufficiale esiste già nelle tre lingue si usa quella —
-- "Il Programma Edifici" è "Das Gebäudeprogramm", non una traduzione letterale.
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

alter table public.subsidy_programs
  add column if not exists translations jsonb not null default '{}'::jsonb;

comment on column public.subsidy_programs.translations is
  'Traduzioni dei contenuti per lingua ("de", "fr"); l''italiano resta nelle colonne base. Requisiti ed esclusioni sono indicizzati per id, non per posizione. Una lingua assente o un campo mancante ricadono sull''italiano, e l''app lo DICHIARA invece di far passare il testo per tradotto.';

-- >>>>>>>>>>>>>>>>>>>>  0013_inbox  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- AI-Swisse — 0013 INBOX
--
-- Acquisizione della posta aziendale (Google Workspace / Microsoft 365) come
-- punto d'ingresso del back-office. NON è un secondo motore di analisi: una
-- email amministrativamente rilevante diventa un `documents` normale e passa
-- dalla pipeline Admin AI già esistente. Qui si modella solo ciò che la posta
-- ha in più: la connessione al provider, il messaggio, i suoi allegati e la
-- RELAZIONE fra messaggio e documento.
--
-- Le tre separazioni che reggono lo schema
--   1. CONNESSIONE ≠ SEGRETI. `email_connections` contiene metadati che un
--      membro può vedere; i token OAuth stanno in `email_connection_secrets`,
--      che NON ha alcuna policy e a cui il ruolo `authenticated` non ha alcun
--      permesso. Un client con la chiave anon non può leggerli in nessun modo,
--      nemmeno per errore di programmazione lato applicazione.
--   2. STATO DELLA MACCHINA ≠ STATO DELL'UTENTE. `processing_status` racconta
--      dove è arrivata la pipeline; `attention_status` racconta cosa deve fare
--      una persona. Confonderli significa che un guasto tecnico si traveste da
--      «niente da fare» — esattamente il falso negativo che qui è più pericoloso
--      del falso positivo.
--   3. STATO LOCALE ≠ STATO DEL PROVIDER. Niente in questo schema descrive
--      Gmail o Outlook: `handled_at` significa «tolto dalla vista operativa di
--      AI-Swisse», non «archiviato su Gmail». La versione 1 è in sola lettura
--      verso il provider e lo schema non offre nemmeno il posto dove annotare
--      il contrario.
--
-- Cancellazioni (§79). `email_messages.connection_id` cascata sulla connessione,
-- ma **disconnettere non cancella**: `email-disconnect` porta la connessione a
-- `disconnected` e distrugge i segreti, senza toccare una riga di posta. La
-- cascata esiste solo per la cancellazione dell'azienda, dove tutto deve sparire.
-- Un eventuale «elimina dati importati» sarà un'azione separata e dichiarata.
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- Ricerca testuale server-side (§10): trigram, così `ilike '%…%'` usa un indice
-- invece di scaricare la Inbox nel browser per filtrarla lì.
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. Enum
--
-- Enum e non testo libero dove il valore governa una decisione (routing della
-- pipeline, visibilità in Inbox, autorizzazioni): un refuso in una stringa
-- libera diventerebbe una categoria nuova e silenziosa. Restano testo i campi
-- puramente descrittivi (error_code, importance), dove il valore arriva dal
-- provider e inventarne un enum significherebbe rifiutare valori legittimi.
-- ---------------------------------------------------------------------------
do $$ begin create type public.email_provider as enum ('google', 'microsoft');
exception when duplicate_object then null; end $$;

do $$ begin create type public.email_connection_status as enum
  ('active', 'reauth_required', 'error', 'disconnected');
exception when duplicate_object then null; end $$;

do $$ begin create type public.email_sync_type as enum
  ('initial', 'incremental', 'manual', 'reconciliation');
exception when duplicate_object then null; end $$;

do $$ begin create type public.email_sync_status as enum
  ('running', 'ok', 'partial', 'failed');
exception when duplicate_object then null; end $$;

-- Stato della PIPELINE su un messaggio. Descrive il lavoro della macchina.
do $$ begin create type public.email_processing_status as enum
  ('pending', 'classifying', 'importing', 'analyzing', 'done', 'failed');
exception when duplicate_object then null; end $$;

-- Stato di ATTENZIONE per una persona. Descrive cosa c'è da fare.
-- `ignored` = il classificatore l'ha giudicata non amministrativa: la riga
-- resta e resta recuperabile, non viene nascosta per sempre.
do $$ begin create type public.email_attention_status as enum
  ('needs_attention', 'to_verify', 'informational', 'ignored', 'handled');
exception when duplicate_object then null; end $$;

-- Esito del classificatore. Deliberatamente CONSERVATIVO: `clearly_irrelevant`
-- richiede segnali forti e concordi, perché una comunicazione amministrativa
-- persa costa molto più di una newsletter mostrata di troppo.
do $$ begin create type public.email_relevance as enum
  ('likely_actionable', 'possibly_actionable', 'informational', 'clearly_irrelevant');
exception when duplicate_object then null; end $$;

do $$ begin create type public.email_document_relation as enum ('body', 'attachment');
exception when duplicate_object then null; end $$;

-- Perché un allegato non è stato importato: la ragione è un dato, non un log.
-- L'utente deve poter capire che quel PDF non è stato letto e perché.
do $$ begin create type public.email_attachment_import_status as enum
  ('pending', 'imported', 'skipped_inline', 'skipped_unsupported', 'skipped_too_large', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. email_connections — la casella collegata
--
-- `provider_account_id` è l'identità STABILE del provider (Google `sub`,
-- Microsoft `id` della mailbox), non l'indirizzo: un indirizzo può essere un
-- alias o cambiare, e usarlo come identità farebbe apparire lo stesso account
-- come due connessioni diverse dopo una rinomina (§127). L'indirizzo resta,
-- perché è ciò che l'utente riconosce.
--
-- Il vincolo è per AZIENDA, non globale: una fiduciaria può legittimamente
-- collegare la stessa casella a due mandati, e vietarlo qui significherebbe
-- decidere un modello commerciale dentro uno schema (§74).
-- ---------------------------------------------------------------------------
create table if not exists public.email_connections (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies (id) on delete cascade,
  connected_by              uuid references auth.users (id) on delete set null,
  provider                  public.email_provider not null,
  provider_account_id       text not null,
  email_address             text not null,
  display_name              text,
  status                    public.email_connection_status not null default 'active',
  -- Scope realmente concessi dal provider, così la schermata «Account email»
  -- può dire cosa AI-Swisse può fare invece di quello che ha chiesto.
  scopes                    text[] not null default '{}',
  sync_enabled              boolean not null default true,

  -- Cursore di sincronizzazione incrementale: `historyId` per Gmail, `deltaLink`
  -- per Microsoft Graph. Opaco per l'applicazione, che non lo interpreta mai.
  sync_cursor               text,
  -- Confine inferiore dell'import iniziale (§44): oltre questa data non si
  -- risale. Serve alla riconciliazione per sapere cosa NON è un buco.
  history_floor_at          timestamptz,

  initial_sync_completed_at timestamptz,
  last_sync_at              timestamptz,
  last_successful_sync_at   timestamptz,
  last_error_code           text,
  last_error_at             timestamptz,

  -- Push: `watch_resource_id` è la subscription Graph o il topic watch Gmail.
  watch_resource_id         text,
  watch_expires_at          timestamptz,
  watch_last_renewed_at     timestamptz,
  watch_last_error_code     text,

  -- §125 — lock di sincronizzazione a SCADENZA, non booleano. Un `is_syncing`
  -- senza scadenza resta true per sempre se il processo muore, e la casella non
  -- si sincronizza più senza che nessuno sappia perché.
  sync_lease_id             uuid,
  sync_lease_until          timestamptz,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  unique (company_id, provider, provider_account_id)
);
create index if not exists idx_email_conn_company on public.email_connections (company_id);
-- Selezione delle connessioni da rinnovare/riconciliare, per il job periodico.
create index if not exists idx_email_conn_due on public.email_connections (status, sync_enabled, watch_expires_at)
  where status = 'active' and sync_enabled;

comment on table public.email_connections is
  'Casella di posta collegata a un''azienda. I token NON stanno qui: vedi email_connection_secrets.';
comment on column public.email_connections.sync_lease_until is
  'Scadenza del lock di sincronizzazione. A scadenza, non booleano: un processo morto non deve bloccare la casella per sempre.';
comment on column public.email_connections.history_floor_at is
  'Data più antica importata. La riconciliazione non cerca buchi prima di questo istante: là non c''è un buco, c''è un confine dichiarato.';

-- ---------------------------------------------------------------------------
-- 3. email_connection_secrets — token OAuth, SOLO server
--
-- MODELLO DI MINACCIA (§18), esplicito perché la sicurezza di questa tabella è
-- l'unica cosa che separa un bug applicativo dalla lettura della posta altrui.
--
--   · Client con chiave anon e sessione valida — bloccato due volte: nessun
--     GRANT al ruolo `authenticated` e RLS attiva senza policy. Anche un
--     `select('*')` scritto per errore in un service non restituisce nulla:
--     PostgREST risponde 42501, non una riga vuota.
--   · Chiave anon rubata — identico al caso sopra: la chiave anon non conferisce
--     alcun accesso a questa tabella.
--   · Dump del database — i token sono cifrati con AES-256-GCM e la chiave NON
--     è nel database: vive come secret della Edge Function (EMAIL_TOKEN_KEY).
--     Un dump da solo non basta per leggere la posta.
--   · Service role compromessa — NON è mitigato da questo schema: chi ha la
--     service role E la chiave di cifratura ha i token. È il limite dichiarato,
--     e vale già oggi per l'intero database.
--
-- Sono `bytea` e non `text` perché sono byte, non testo: nessuna codifica
-- intermedia da sbagliare, e nessuna tentazione di leggerli «tanto per vedere».
-- ---------------------------------------------------------------------------
create table if not exists public.email_connection_secrets (
  connection_id             uuid primary key references public.email_connections (id) on delete cascade,
  company_id                uuid not null references public.companies (id) on delete cascade,

  access_token_ct           bytea,
  access_token_iv           bytea,
  access_token_expires_at   timestamptz,
  refresh_token_ct          bytea,
  refresh_token_iv          bytea,
  -- Microsoft: `clientState` con cui si autentica la notifica in arrivo. È un
  -- segreto condiviso, quindi sta qui e non nella tabella dei metadati.
  webhook_state_ct          bytea,
  webhook_state_iv          bytea,

  -- Versione della chiave di cifratura: permette una rotazione futura senza
  -- dover indovinare con quale chiave è stato cifrato ogni record.
  key_version               integer not null default 1,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.email_connection_secrets is
  'Token OAuth cifrati (AES-256-GCM). Nessuna policy e nessun GRANT: irraggiungibile dal ruolo authenticated. La chiave di cifratura è un secret della Edge Function, non sta nel database.';

-- ---------------------------------------------------------------------------
-- 4. email_oauth_states — stato anti-CSRF del flusso OAuth (§72)
--
-- Lo `state` non viaggia firmato ma OPACO: il client riceve un valore casuale e
-- il server ritrova qui il contesto. Così il callback non si fida mai di un
-- `company_id` arrivato dalla query string — che sarebbe la via più diretta per
-- collegare la casella di qualcun altro alla propria azienda.
--
-- In tabella sta lo SHA-256 del valore, non il valore: chi leggesse questa
-- tabella non otterrebbe uno state utilizzabile. Il `code_verifier` PKCE è
-- cifrato come i token, perché è a tutti gli effetti un segreto di sessione.
-- ---------------------------------------------------------------------------
create table if not exists public.email_oauth_states (
  id                uuid primary key default gen_random_uuid(),
  state_hash        text not null unique,
  company_id        uuid not null references public.companies (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  provider          public.email_provider not null,
  code_verifier_ct  bytea,
  code_verifier_iv  bytea,
  key_version       integer not null default 1,
  redirect_path     text,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  consumed_at       timestamptz
);
create index if not exists idx_email_oauth_states_expiry on public.email_oauth_states (expires_at);

comment on table public.email_oauth_states is
  'Stato OAuth monouso e a scadenza breve. Contiene lo SHA-256 dello state, non lo state: leggere questa tabella non permette di fabbricarne uno valido.';

-- ---------------------------------------------------------------------------
-- 5. email_messages — il messaggio normalizzato
--
-- Non si conserva l'HTML del provider. Il corpo viene ridotto server-side a
-- TESTO con un tokenizzatore che scarta script, stile, gestori di evento e
-- risorse remote; i collegamenti vengono estratti a parte, con la loro
-- destinazione reale. Conseguenze volute:
--   · non esiste HTML non fidato da sanificare al momento del render, quindi
--     non esiste il bug in cui la sanificazione viene dimenticata (§54);
--   · nessun pixel di tracciamento può partire, perché non c'è nulla da
--     caricare: la privacy non dipende da un'opzione lasciata spenta (§55);
--   · il testo su cui l'AI ragiona è lo stesso che l'utente legge, quindi una
--     citazione resta verificabile.
-- Il prezzo è che la posta non si vede impaginata. In una Inbox che serve a
-- decidere cosa richiede attenzione, è un prezzo che vale la pena pagare.
-- ---------------------------------------------------------------------------
create table if not exists public.email_messages (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  connection_id          uuid not null references public.email_connections (id) on delete cascade,

  provider_message_id    text not null,
  provider_thread_id     text,
  internet_message_id    text,

  subject                text,
  sender_name            text,
  sender_email           text,
  -- To/CC come jsonb: [{ "name": "...", "email": "..." }]. Normalizzarli in
  -- tabelle separate darebbe la possibilità di interrogarli, che qui non serve
  -- a nessuna schermata; il costo sarebbero due join per ogni riga di lista.
  to_recipients          jsonb not null default '[]'::jsonb,
  cc_recipients          jsonb not null default '[]'::jsonb,

  received_at            timestamptz not null,
  sent_at                timestamptz,

  body_text              text,
  body_preview           text,
  -- Collegamenti estratti dal corpo: [{ "url": "...", "label": "...", "host": "..." }].
  -- Solo http/https, validati server-side: l'interfaccia mostra il dominio vero,
  -- non il testo che il mittente ha scelto di far vedere (§56).
  body_links             jsonb not null default '[]'::jsonb,
  body_char_count        integer,
  -- Il corpo depurato di firme e storico citato, usato per la classificazione.
  -- Deriva da `body_text`, che resta intatto: quando il taglio è dubbio non si
  -- taglia, e in nessun caso si perde l'originale normalizzato (§115/§116).
  body_clean             text,
  quoted_removed         boolean not null default false,

  has_attachments        boolean not null default false,
  attachment_count       integer not null default 0,
  importance             text,
  -- Segnale di posta di massa (List-Unsubscribe, Precedence: bulk). È un FATTO
  -- letto dagli header, non un giudizio: il giudizio è `relevance`.
  is_bulk                boolean not null default false,

  processing_status      public.email_processing_status not null default 'pending',
  attention_status       public.email_attention_status not null default 'to_verify',
  relevance              public.email_relevance,
  relevance_confidence   numeric(4,3),
  relevance_reason       text,
  -- §118 — riproducibilità della decisione: con quale regola e quale modello è
  -- stata presa. Senza questi campi, «perché questa email è finita fra le
  -- irrilevanti?» non ha risposta.
  classifier_version     text,
  classifier_provider    text,
  classifier_model       text,
  classifier_prompt_version text,
  classified_at          timestamptz,

  error_code             text,
  error_message_safe     text,

  seen_at                timestamptz,
  handled_at             timestamptz,
  handled_by             uuid references auth.users (id) on delete set null,

  -- §117 — impronta della fonte al momento dell'acquisizione. Una
  -- risincronizzazione che trovasse un contenuto diverso NON riscrive in
  -- silenzio ciò che è già stato analizzato: la divergenza è rilevabile.
  source_fingerprint     text,

  -- COPIA della scadenza trovata dall'analisi collegata, al solo scopo di
  -- filtrare e ordinare la lista senza join (§9/§104). La fonte di verità
  -- resta `document_analyses`: qui non c'è la citazione, non c'è la fiducia,
  -- non c'è il tipo di scadenza, e la schermata di dettaglio legge sempre
  -- dall'analisi. La scrive solo la pipeline, dopo un'analisi riuscita.
  analysis_deadline      date,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- §26 — l'idempotenza non è una condizione nel codice applicativo ma un
  -- vincolo del database: un webhook consegnato due volte non può creare due
  -- righe, qualunque cosa faccia il codice.
  unique (connection_id, provider_message_id)
);

-- Ricerca (§10). Colonna generata + indice trigram: la ricerca resta sul
-- server anche con decine di migliaia di messaggi.
alter table public.email_messages
  add column if not exists search_text text
  generated always as (
    lower(coalesce(subject, '') || ' ' || coalesce(sender_name, '') || ' '
          || coalesce(sender_email, '') || ' ' || coalesce(body_preview, ''))
  ) stored;

-- Ordinamento stabile della lista e paginazione keyset (§76).
create index if not exists idx_email_msg_company_recv
  on public.email_messages (company_id, received_at desc, id desc);
create index if not exists idx_email_msg_company_attention
  on public.email_messages (company_id, attention_status, received_at desc, id desc);
create index if not exists idx_email_msg_connection on public.email_messages (connection_id);
create index if not exists idx_email_msg_thread on public.email_messages (company_id, provider_thread_id)
  where provider_thread_id is not null;
create index if not exists idx_email_msg_search on public.email_messages using gin (search_text gin_trgm_ops);
-- Ripresa del lavoro rimasto indietro: poche righe, quindi indice parziale.
create index if not exists idx_email_msg_pending on public.email_messages (company_id, processing_status, received_at)
  where processing_status in ('pending', 'failed');
create index if not exists idx_email_msg_internet_id on public.email_messages (company_id, internet_message_id)
  where internet_message_id is not null;
-- Filtro «con una scadenza vicina»: poche righe, indice parziale.
create index if not exists idx_email_msg_deadline on public.email_messages (company_id, analysis_deadline)
  where analysis_deadline is not null;

comment on column public.email_messages.body_text is
  'Testo normalizzato del messaggio. L''HTML del provider non viene conservato: viene ridotto a testo server-side, quindi non esiste HTML non fidato da rendere.';
comment on column public.email_messages.attention_status is
  'Stato per una persona. Indipendente da processing_status: un guasto tecnico non deve mai apparire come "niente da fare".';

-- ---------------------------------------------------------------------------
-- 6. email_attachments
--
-- `declared_mime_type` è quello che DICE il provider, `mime_type` quello che il
-- server ha accettato dopo la validazione. Tenerli separati permette di non
-- fidarsi del primo (§15) senza perderlo: se un giorno la politica cambia, si
-- sa cosa era stato dichiarato.
-- ---------------------------------------------------------------------------
create table if not exists public.email_attachments (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies (id) on delete cascade,
  email_message_id        uuid not null references public.email_messages (id) on delete cascade,
  provider_attachment_id  text not null,

  filename                text,
  safe_filename           text,
  declared_mime_type      text,
  mime_type               text,
  size_bytes              bigint,
  content_id              text,
  is_inline               boolean not null default false,

  storage_path            text,
  file_hash               text,
  import_status           public.email_attachment_import_status not null default 'pending',
  skip_reason             text,
  error_code              text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (email_message_id, provider_attachment_id)
);
create index if not exists idx_email_att_message on public.email_attachments (email_message_id);
create index if not exists idx_email_att_company on public.email_attachments (company_id);
create index if not exists idx_email_att_hash on public.email_attachments (company_id, file_hash)
  where file_hash is not null;

-- ---------------------------------------------------------------------------
-- 7. email_message_documents — la relazione email ↔ documento (§16/§59/§60)
--
-- Tabella di relazione e non colonne email dentro `documents`: la stessa email
-- può generare più documenti (corpo + allegati) e lo STESSO documento può
-- essere raggiunto da più email — è precisamente ciò che succede quando la
-- deduplicazione per hash riconosce un PDF già caricato a mano. Deduplicare il
-- documento non deve far perdere la traccia che quel PDF era allegato anche a
-- QUEL messaggio.
--
-- Due indici unici parziali invece di un unique con colonna nullable: in SQL
-- due NULL non sono uguali, quindi `unique (message, relation, attachment_id)`
-- non impedirebbe affatto due righe `body`.
-- ---------------------------------------------------------------------------
create table if not exists public.email_message_documents (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  email_message_id  uuid not null references public.email_messages (id) on delete cascade,
  document_id       uuid not null references public.documents (id) on delete cascade,
  relation          public.email_document_relation not null,
  attachment_id     uuid references public.email_attachments (id) on delete cascade,
  created_at        timestamptz not null default now(),

  -- Un allegato genera un documento, non due; un corpo non ha allegato.
  constraint email_msg_doc_shape check (
    (relation = 'body' and attachment_id is null)
    or (relation = 'attachment' and attachment_id is not null)
  )
);
create unique index if not exists uq_email_msg_doc_body
  on public.email_message_documents (email_message_id) where relation = 'body';
create unique index if not exists uq_email_msg_doc_attachment
  on public.email_message_documents (email_message_id, attachment_id) where relation = 'attachment';
create index if not exists idx_email_msg_doc_document on public.email_message_documents (document_id);
create index if not exists idx_email_msg_doc_company on public.email_message_documents (company_id);

-- ---------------------------------------------------------------------------
-- 8. email_sync_runs — perché questa casella non si aggiorna (§47/§48)
--
-- Audit tecnico, non contenuto: identificatori, conteggi, esito. Mai un oggetto,
-- mai un mittente, mai un token. Serve a rispondere a una domanda di esercizio,
-- e per rispondere non serve sapere cosa c'era scritto nelle email.
-- ---------------------------------------------------------------------------
create table if not exists public.email_sync_runs (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  connection_id          uuid not null references public.email_connections (id) on delete cascade,
  sync_type              public.email_sync_type not null,
  status                 public.email_sync_status not null default 'running',
  triggered_by           text,                       -- user | webhook | schedule | oauth_callback
  started_at             timestamptz not null default now(),
  completed_at           timestamptz,
  duration_ms            integer,
  messages_seen          integer not null default 0,
  messages_new           integer not null default 0,
  messages_updated       integer not null default 0,
  attachments_imported   integer not null default 0,
  documents_created      integer not null default 0,
  analyses_started       integer not null default 0,
  cursor_before          text,
  cursor_after           text,
  error_code             text,
  error_detail_safe      text,
  created_at             timestamptz not null default now()
);
create index if not exists idx_email_sync_runs_conn on public.email_sync_runs (connection_id, started_at desc);
create index if not exists idx_email_sync_runs_company on public.email_sync_runs (company_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 9. email_webhook_events — idempotenza delle notifiche (§26/§49)
--
-- Si conserva un'IMPRONTA dell'evento, non il suo payload: per riconoscere un
-- duplicato basta sapere che quell'evento è già passato. Il vincolo unico fa il
-- lavoro; il codice applicativo non deve ricordarsi di controllare.
-- ---------------------------------------------------------------------------
create table if not exists public.email_webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           public.email_provider not null,
  connection_id      uuid references public.email_connections (id) on delete cascade,
  event_fingerprint  text not null unique,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz,
  status             text not null default 'received',   -- received | processed | ignored | failed
  error_code         text
);
create index if not exists idx_email_webhook_received on public.email_webhook_events (received_at desc);

-- ---------------------------------------------------------------------------
-- 10. email_audit_log — chi ha collegato questa casella (§81)
--
-- Non è un SIEM. Sono le poche azioni per cui «chi è stato» è una domanda
-- legittima: collegare, riconnettere, disconnettere, forzare una sincronizzazione.
-- ---------------------------------------------------------------------------
create table if not exists public.email_audit_log (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  connection_id  uuid references public.email_connections (id) on delete set null,
  actor_user_id  uuid references auth.users (id) on delete set null,
  action         text not null,          -- connected | reconnected | disconnected | sync_requested
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_email_audit_company on public.email_audit_log (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 11. Trigger updated_at
-- ---------------------------------------------------------------------------
drop trigger if exists trg_email_conn_updated on public.email_connections;
create trigger trg_email_conn_updated before update on public.email_connections
  for each row execute function public.set_updated_at();

drop trigger if exists trg_email_secrets_updated on public.email_connection_secrets;
create trigger trg_email_secrets_updated before update on public.email_connection_secrets
  for each row execute function public.set_updated_at();

drop trigger if exists trg_email_msg_updated on public.email_messages;
create trigger trg_email_msg_updated before update on public.email_messages
  for each row execute function public.set_updated_at();

drop trigger if exists trg_email_att_updated on public.email_attachments;
create trigger trg_email_att_updated before update on public.email_attachments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 12. Il client può cambiare solo lo stato UMANO del messaggio
--
-- I permessi di colonna (punto 14) impediscono già di scrivere altrove. Questo
-- trigger aggiunge le due cose che un GRANT non sa esprimere:
--   · verso quali valori `attention_status` può muoversi da un'azione manuale —
--     un membro può dire «gestita» o rimetterla in lista, non può promuovere a
--     `needs_attention` una email che il classificatore ha giudicato altrimenti,
--     perché quella è una conclusione, non una preferenza;
--   · chi e quando, scritti dal database e non dalla richiesta, come già fa
--     `action_progress` (0010).
-- ---------------------------------------------------------------------------
-- Dove va un messaggio quando NON è stato messo via: lo decide la
-- classificazione, non la richiesta. Un'unica funzione, usata sia dalla
-- pipeline sia dal ripristino, così le due strade non possono divergere.
create or replace function public.email_attention_for_relevance(p_rel public.email_relevance)
returns public.email_attention_status
language sql
immutable
as $$
  select case p_rel
    when 'likely_actionable'   then 'needs_attention'
    when 'possibly_actionable' then 'to_verify'
    when 'informational'       then 'informational'
    when 'clearly_irrelevant'  then 'ignored'
    else 'to_verify'                       -- non ancora classificata: si mostra
  end::public.email_attention_status;
$$;

create or replace function public.set_email_message_handled_actor()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();

  if new.attention_status is distinct from old.attention_status then
    if new.attention_status = 'handled' then
      -- «Metti via»: chi e quando li scrive il database, non la richiesta.
      if auth.uid() is not null then
        new.handled_by := auth.uid();
        new.handled_at := now();
      end if;
    elsif old.attention_status = 'handled' then
      -- «Rimetti in lista»: il messaggio torna dove lo aveva messo la
      -- classificazione. Il valore inviato dal client viene IGNORATO — un
      -- ripristino è un annullamento, non l'occasione per riscrivere una
      -- conclusione dell'analisi.
      new.attention_status := public.email_attention_for_relevance(new.relevance);
      new.handled_by := null;
      new.handled_at := null;
    elsif auth.uid() is not null then
      -- Ogni altro cambio è una conclusione della pipeline, non una preferenza:
      -- dal client si può solo mettere via o rimettere in lista.
      raise exception 'attention_status: dal client sono ammessi solo "handled" e il ripristino'
        using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_email_msg_handled on public.email_messages;
create trigger trg_email_msg_handled before update on public.email_messages
  for each row execute function public.set_email_message_handled_actor();

-- ---------------------------------------------------------------------------
-- 13. RLS
--
-- Regola invariata dal 0001: si accede solo ai dati della propria azienda. Le
-- tabelle di servizio (segreti, stati OAuth, eventi webhook) non hanno policy
-- perché non devono avere accesso, e una policy assente è più difficile da
-- allentare per sbaglio di una policy restrittiva.
-- ---------------------------------------------------------------------------
alter table public.email_connections        enable row level security;
alter table public.email_connection_secrets enable row level security;
alter table public.email_oauth_states       enable row level security;
alter table public.email_messages           enable row level security;
alter table public.email_attachments        enable row level security;
alter table public.email_message_documents  enable row level security;
alter table public.email_sync_runs          enable row level security;
alter table public.email_webhook_events     enable row level security;
alter table public.email_audit_log          enable row level security;

-- Connessioni: i membri leggono. Creare e disconnettere passa dalle Edge
-- Function, che verificano il ruolo: al client non serve nessun permesso di
-- scrittura, e non averlo è più solido che averlo e controllarlo altrove.
drop policy if exists email_conn_select_member on public.email_connections;
create policy email_conn_select_member on public.email_connections
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists email_msg_select_member on public.email_messages;
create policy email_msg_select_member on public.email_messages
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists email_msg_update_member on public.email_messages;
create policy email_msg_update_member on public.email_messages
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists email_att_select_member on public.email_attachments;
create policy email_att_select_member on public.email_attachments
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists email_msg_doc_select_member on public.email_message_documents;
create policy email_msg_doc_select_member on public.email_message_documents
  for select to authenticated using (public.is_company_member(company_id));

-- Diagnostica: la legge chi può agire sulla connessione, non ogni membro.
drop policy if exists email_sync_runs_select_admin on public.email_sync_runs;
create policy email_sync_runs_select_admin on public.email_sync_runs
  for select to authenticated using (public.is_company_admin(company_id));

drop policy if exists email_audit_select_admin on public.email_audit_log;
create policy email_audit_select_admin on public.email_audit_log
  for select to authenticated using (public.is_company_admin(company_id));

-- ---------------------------------------------------------------------------
-- 14. GRANT — permessi di COLONNA, non di tabella
--
-- La RLS decide QUALI righe; il grant decide QUALI COLONNE. Sulla connessione
-- il client non ha bisogno di vedere il cursore di sincronizzazione né
-- l'identificativo della subscription: non sono segreti, ma non servono a
-- nessuna schermata, e ciò che non viene concesso non può essere esposto da una
-- `select('*')` scritta distrattamente.
--
-- Sul messaggio, l'unico UPDATE concesso riguarda due colonne: il resto della
-- riga è il verbale di ciò che è arrivato, e non si riscrive.
-- ---------------------------------------------------------------------------
grant select (
  id, company_id, connected_by, provider, provider_account_id, email_address, display_name,
  status, scopes, sync_enabled, initial_sync_completed_at, last_sync_at, last_successful_sync_at,
  last_error_code, last_error_at, watch_expires_at, sync_lease_until, created_at, updated_at
) on public.email_connections to authenticated;

grant select on public.email_messages to authenticated;
grant update (seen_at, attention_status) on public.email_messages to authenticated;
grant select on public.email_attachments to authenticated;
grant select on public.email_message_documents to authenticated;
grant select on public.email_sync_runs to authenticated;
grant select on public.email_audit_log to authenticated;

-- Esplicito, anche se è già il default: queste tabelle non sono raggiungibili.
revoke all on public.email_connection_secrets from authenticated, anon;
revoke all on public.email_oauth_states       from authenticated, anon;
revoke all on public.email_webhook_events     from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 15. Quota AI per il lavoro SENZA utente
--
-- `try_consume_ai_quota` (0009) pretende `auth.uid()` e verifica la membership:
-- è giusto, perché nasce per una richiesta fatta da una persona. La
-- sincronizzazione della posta però non ha una persona dietro — è un webhook o
-- un job — e con quella funzione fallirebbe.
--
-- La tentazione sarebbe contare le righe e poi inserirne una: è esattamente
-- l'errore che la 0009 è stata scritta per riparare, perché due sincronizzazioni
-- concorrenti leggono lo stesso conteggio e passano entrambe. Qui si riusa lo
-- STESSO lock consultivo per azienda, e si lascia cadere solo il controllo che
-- non ha senso senza un utente. Il ruolo `service_role` è l'unico che può
-- eseguirla, quindi la verifica di appartenenza è già stata fatta a monte da
-- chi possiede la connessione.
-- ---------------------------------------------------------------------------
create or replace function public.try_consume_ai_quota_system(
  p_company_id uuid,
  p_kind text,
  p_limit int,
  p_document_id uuid default null,
  p_provider text default null,
  p_model text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 0));

  select count(*) into v_count
    from public.ai_request_log
   where company_id = p_company_id
     and created_at > now() - interval '1 minute';

  if v_count >= p_limit then
    return null;
  end if;

  -- `user_id` resta NULL: nessuna persona ha chiesto questo lavoro, e
  -- attribuirlo a chi ha collegato la casella sarebbe un dato inventato (§80).
  insert into public.ai_request_log (company_id, user_id, document_id, kind, provider, model, status)
  values (p_company_id, null, p_document_id, p_kind, p_provider, p_model, 'pending')
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.finalize_ai_request_system(
  p_id uuid,
  p_status text,
  p_duration_ms int default null,
  p_input_tokens int default null,
  p_output_tokens int default null,
  p_error_code text default null,
  p_model text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo righe di sistema: `finalize_ai_request` non potrebbe toccarle
  -- (confronta con auth.uid(), che qui è NULL), e questa non può toccare quelle
  -- di un utente. Le due funzioni restano disgiunte.
  update public.ai_request_log
     set status        = coalesce(p_status, status),
         duration_ms   = coalesce(p_duration_ms, duration_ms),
         input_tokens  = coalesce(p_input_tokens, input_tokens),
         output_tokens = coalesce(p_output_tokens, output_tokens),
         error_code    = coalesce(p_error_code, error_code),
         model         = coalesce(p_model, model)
   where id = p_id
     and user_id is null;
end;
$$;

revoke all on function public.try_consume_ai_quota_system(uuid, text, int, uuid, text, text) from public, anon, authenticated;
revoke all on function public.finalize_ai_request_system(uuid, text, int, int, int, text, text) from public, anon, authenticated;
grant execute on function public.try_consume_ai_quota_system(uuid, text, int, uuid, text, text) to service_role;
grant execute on function public.finalize_ai_request_system(uuid, text, int, int, int, text, text) to service_role;

comment on function public.try_consume_ai_quota_system is
  'Quota AI per il lavoro server-side senza utente (sincronizzazione Inbox). Stesso lock per azienda della 0009; eseguibile solo da service_role.';

-- ---------------------------------------------------------------------------
-- 16. Deduplicazione documentale (§59)
--
-- La ricerca per hash esiste già come indice dalla 0006
-- (`idx_documents_company_hash`): l'import da Inbox la riusa così com'è, senza
-- aggiungere una seconda nozione di «documento uguale». Qui si aggiunge solo
-- l'indice che serve alla provenienza inversa — «da quale email arriva questo
-- documento?» — che l'archivio userà per mostrarne l'origine.
-- ---------------------------------------------------------------------------
create index if not exists idx_documents_company_source on public.documents (company_id, source_type)
  where source_type = 'email';

-- >>>>>>>>>>>>>>>>>>>>  0014_inbox_grants  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- AI-Swisse — 0014 INBOX: i permessi di colonna diventano davvero restrittivi
--
-- COSA È ANDATO STORTO NELLA 0013
-- La 0013 concedeva `grant select (colonne…)` e `grant update (seen_at,
-- attention_status)` convinta di RESTRINGERE. Non restringeva nulla: un GRANT
-- aggiunge privilegi, non li toglie, e su Supabase ogni tabella nuova dello
-- schema `public` nasce già con i permessi di TABELLA completi per `anon` e
-- `authenticated` — è l'effetto di
--     alter default privileges in schema public grant all on tables to …
-- che il progetto imposta una volta e che si applica a ogni tabella creata da
-- lì in avanti. I permessi di colonna della 0013 erano quindi ridondanti.
--
-- Conseguenza concreta, misurata da `npm run test:inbox` sul database reale:
-- un membro dell'azienda poteva eseguire
--     update email_messages set subject = '…', body_text = '…', relevance = '…'
-- sui messaggi della PROPRIA azienda. La policy RLS lo autorizzava (è pensata
-- per far passare `seen_at`) e nessun permesso di colonna lo fermava. La riga
-- di posta non era il verbale immutabile di ciò che era arrivato: era un campo
-- libero. E poiché il ripristino di un messaggio «messo via» ricalcola lo stato
-- da `relevance`, riscrivere la classificazione permetteva anche di spostare un
-- messaggio in una categoria a piacere — aggirando il controllo che il trigger
-- fa proprio per impedirlo.
--
-- Perché per i segreti aveva funzionato: là la 0013 scriveva `revoke all`
-- prima. Mancava dappertutto altrove.
--
-- LA REGOLA CHE NE DERIVA
-- Su questo progetto, un permesso di colonna non significa niente finché non è
-- preceduto da un `revoke all` sulla stessa tabella. Vale per ogni tabella
-- futura dello schema `public`.
--
-- Perché una migrazione nuova e non una correzione della 0013: la 0013 è già
-- stata applicata in produzione. Un file di migrazione è il verbale di ciò che
-- è stato eseguito; riscriverlo dopo l'applicazione significherebbe che il
-- repository e il database raccontano due storie diverse.
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Prima si toglie tutto
--
-- `service_role` NON compare: è il ruolo con cui scrivono le Edge Function, e
-- deve conservare i suoi permessi. Si revoca anche da `public` (lo pseudo-ruolo
-- che comprende tutti) per non lasciare una via laterale.
-- ---------------------------------------------------------------------------
revoke all on public.email_connections        from anon, authenticated, public;
revoke all on public.email_connection_secrets from anon, authenticated, public;
revoke all on public.email_oauth_states       from anon, authenticated, public;
revoke all on public.email_messages           from anon, authenticated, public;
revoke all on public.email_attachments        from anon, authenticated, public;
revoke all on public.email_message_documents  from anon, authenticated, public;
revoke all on public.email_sync_runs          from anon, authenticated, public;
revoke all on public.email_webhook_events     from anon, authenticated, public;
revoke all on public.email_audit_log          from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 2. Poi si concede esattamente quello che serve
--
-- CONNESSIONI — sola lettura, e solo le colonne che una schermata mostra.
-- `sync_cursor`, `history_floor_at`, `watch_resource_id`, `watch_last_error_code`
-- e `sync_lease_id` restano fuori: non sono segreti, ma non servono a nessuna
-- vista, e ciò che non è concesso non può essere esposto da una `select('*')`
-- scritta distrattamente.
--
-- ⚠️ Da qui in avanti `select('*')` su questa tabella FALLISCE con «permission
-- denied for column». È voluto, ed è il motivo per cui `emailConnectionService`
-- elenca le colonne una per una.
-- ---------------------------------------------------------------------------
grant select (
  id, company_id, connected_by, provider, provider_account_id, email_address, display_name,
  status, scopes, sync_enabled, initial_sync_completed_at, last_sync_at, last_successful_sync_at,
  last_error_code, last_error_at, watch_expires_at, sync_lease_until, created_at, updated_at
) on public.email_connections to authenticated;

-- MESSAGGI — lettura completa (non c'è nulla di riservato in una riga di posta
-- che il membro non possa già leggere), ma scrittura sulle sole due colonne
-- che rappresentano una decisione UMANA: «l'ho visto» e «l'ho messo via».
-- Tutto il resto — oggetto, mittente, corpo, classificazione, stato della
-- pipeline, impronta della fonte — è il verbale di ciò che è arrivato, e da
-- qui in avanti il client non ha alcun modo di riscriverlo.
grant select on public.email_messages to authenticated;
grant update (seen_at, attention_status) on public.email_messages to authenticated;

-- ALLEGATI, RELAZIONI, REGISTRI — sola lettura. Le righe visibili le decide la
-- RLS (membri per gli allegati e le relazioni, owner/admin per i registri).
grant select on public.email_attachments       to authenticated;
grant select on public.email_message_documents to authenticated;
grant select on public.email_sync_runs         to authenticated;
grant select on public.email_audit_log         to authenticated;

-- SEGRETI, STATI OAUTH, EVENTI WEBHOOK — nessun permesso, per nessuno.
-- Il `revoke` del punto 1 è già sufficiente; non si concede nulla qui.

-- ---------------------------------------------------------------------------
-- 3. Verifica in migrazione
--
-- Il controllo sta QUI dentro e non solo nella suite di test: se un domani
-- qualcuno riapplicasse per errore un `grant all`, questa migrazione rieseguita
-- lo direbbe subito. Un permesso di scrittura su una colonna del verbale è il
-- genere di regressione che non produce alcun sintomo visibile finché qualcuno
-- non la sfrutta.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s.%s (%s)', table_name, column_name, privilege_type), ', ')
    into v_bad
    from information_schema.column_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and table_name = 'email_messages'
     and privilege_type in ('INSERT', 'UPDATE')
     and column_name not in ('seen_at', 'attention_status');

  if v_bad is not null then
    raise exception 'Permessi di scrittura inattesi su email_messages: %', v_bad;
  end if;

  select string_agg(format('%s (%s)', table_name, privilege_type), ', ')
    into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and table_name in ('email_connection_secrets', 'email_oauth_states', 'email_webhook_events');

  if v_bad is not null then
    raise exception 'Le tabelle di servizio non devono avere alcun permesso: %', v_bad;
  end if;

  raise notice 'Permessi Inbox verificati: il verbale non è riscrivibile dal client.';
end $$;

-- >>>>>>>>>>>>>>>>>>>>  0015_inbox_awaiting_analysis  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- AI-Swisse — 0015 INBOX: lo stato «analisi in coda»
--
-- COSA HA MOSTRATO IL PRIMO COLLEGAMENTO REALE (2026-07-26)
-- L'import iniziale di una casella vera ha promosso 14 messaggi a
-- `likely_actionable` in pochi secondi e ha lanciato per ciascuno l'analisi
-- documentale completa. Il limite di quota AI — 12 al minuto per azienda — è
-- stato superato al quarto, e i restanti 14 sono finiti in `failed` con
-- `PROVIDER_RATE_LIMITED`.
--
-- Il risultato era che «Da gestire», la lista più importante del prodotto, si
-- presentava piena di «Esame non riuscito». Non un guasto: una taratura
-- sbagliata. Quel limite protegge dall'utente che carica documenti a mano, ma
-- l'import iniziale non è un utente — è un processo che promuove decine di
-- messaggi tutti insieme. Il limite pensato per proteggere è diventato la causa.
--
-- PERCHÉ SERVE UNO STATO NUOVO E NON BASTA RITENTARE
-- La correzione è scaglionare: durante l'import iniziale si classifica (costa
-- poco) e si RINVIA l'analisi documentale, che verrà smaltita a lotti dalla
-- manutenzione periodica. Ma un messaggio classificato e in attesa di analisi
-- non è né `pending` (non ancora esaminato) né `done` (esaminato) né `failed`
-- (qualcosa è andato storto). È uno stato suo, e senza un nome proprio
-- finirebbe per essere rappresentato da uno degli altri tre — cioè da una
-- descrizione falsa. È la stessa ragione per cui la 0013 tiene separati lo
-- stato della macchina e quello della persona.
--
-- ⚠️ IL VINCOLO CHE HA ROTTO LA PRIMA STESURA DI QUESTA MIGRAZIONE
-- `alter type … add value` si può eseguire dentro una transazione, ma
-- l'etichetta aggiunta NON è utilizzabile finché quella transazione non è
-- chiusa (Postgres, 55P04 «unsafe use of new value»). Il SQL editor di Supabase
-- esegue l'intero script in un'unica transazione, quindi qualunque riga più
-- sotto che nomini 'awaiting_analysis' fa fallire tutto.
--
-- La prima stesura creava un indice parziale con
--   where processing_status = 'awaiting_analysis'
-- e falliva esattamente lì. Spezzare in due migrazioni NON avrebbe risolto:
-- `supabase/full-setup.sql` concatena tutte le migrazioni in un solo script, e
-- un'installazione da zero sarebbe fallita allo stesso punto — un guasto che si
-- sarebbe visto solo al primo cliente nuovo.
--
-- Quindi: in questo file l'etichetta nuova NON compare più da nessuna parte
-- oltre alla riga che la crea. L'indice qui sotto usa `relevance`, il cui
-- valore esiste dalla 0013, e tiene `processing_status` come COLONNA indicizzata
-- invece che come confronto con l'etichetta. Copre la stessa interrogazione —
-- «i messaggi azionabili di questa connessione, in ordine di data» — che è ciò
-- che lo smaltimento della coda esegue.
--
-- Regola generale: in una migrazione che aggiunge un valore a un enum, quel
-- valore non può comparire in nessun'altra istruzione dello stesso file.
--
-- Idempotente.
-- ============================================================================

alter type public.email_processing_status add value if not exists 'awaiting_analysis';

comment on type public.email_processing_status is
  'Stato della pipeline su un messaggio. «awaiting_analysis» = classificato come azionabile, analisi documentale rinviata a un lotto successivo: non è un errore e non è un lavoro concluso.';

-- Selezione dei lotti da smaltire. Il predicato usa solo valori enum esistenti
-- dalla 0013; `processing_status` è una colonna dell'indice, non un confronto.
create index if not exists idx_email_msg_actionable
  on public.email_messages (connection_id, processing_status, received_at desc)
  where relevance = 'likely_actionable';

-- >>>>>>>>>>>>>>>>>>>>  0016_work_hub  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- AI-Swisse — 0016 WORK HUB (Attività)
--
-- Lo Scadenziario diventa il posto in cui il lavoro viene assegnato, seguito e
-- concluso. Non è un task manager generico: è il punto in cui ciò che
-- AI-Swisse ha capito — da un documento, da una comunicazione, da un incentivo
-- — diventa lavoro di qualcuno, con una scadenza e una traccia.
--
-- SI EVOLVE `tasks`, NON SI CREA UNA TABELLA PARALLELA. Le attività esistenti
-- restano valide senza toccarle: una task legacy ha assegnatario nullo,
-- nessuna checklist e nessun commento, e questo è uno stato legittimo.
--
-- QUATTRO GARANZIE, TUTTE IMPOSTE DAL DATABASE E NON DAL BROWSER
--   1. L'ASSEGNATARIO è un membro della stessa azienda. Non un dropdown
--      filtrato lato client: un trigger che rifiuta l'inserimento.
--   2. CHI HA COMPLETATO e QUANDO li scrive il database da `auth.uid()` e
--      `now()`. Il client può mandare quello che vuole: viene sovrascritto.
--   3. L'AUTORE DI UN COMMENTO è `auth.uid()`: la policy lo impone in scrittura
--      e il trigger RIFIUTA — non corregge in silenzio — chi prova a firmare a
--      nome di un collega.
--   4. LO STORICO lo scrivono i trigger. `task_events` non è scrivibile dal
--      client — un registro che l'interessato può riscrivere non è un registro.
--
-- Questa migrazione è RIESEGUIBILE: ogni oggetto viene ricreato in modo
-- idempotente (`if not exists`, `create or replace`, `drop … if exists` prima
-- di policy e trigger). Applicarla due volte non fa danni e non duplica nulla.
--
-- ⚠️ VINCOLO SUI VALORI ENUM NUOVI (lezione della 0015)
-- `alter type … add value` non rende l'etichetta utilizzabile finché la
-- transazione non è chiusa, e il SQL editor esegue tutto in una transazione;
-- `full-setup.sql` concatena le migrazioni, quindi spezzare in due file non
-- risolverebbe — romperebbe ogni installazione da zero. Per questo
-- `in_progress` e `waiting` sono AGGIUNTI qui e non compaiono in nessun'altra
-- istruzione di questo file: trigger e indici parlano solo di `completed`, che
-- esiste dalla 0004.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Stati nuovi. Nessun'altra istruzione di questo file può nominarli.
-- ---------------------------------------------------------------------------
alter type public.task_status add value if not exists 'in_progress';
alter type public.task_status add value if not exists 'waiting';

comment on type public.task_status is
  'Stato di un''attività. «open» = da fare (nome storico, mostrato come «Da fare»), '
  '«in_progress» = qualcuno ci sta lavorando, «waiting» = dipende da terzi o da un evento '
  'esterno, «completed» = conclusa. L''archiviazione NON è uno stato: è `archived_at`, '
  'perché un''attività archiviata conserva lo stato che aveva.';

-- ---------------------------------------------------------------------------
-- 2. Tipi di evento dello storico.
--    Dichiarati con CREATE TYPE, quindi utilizzabili subito in questo file.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.task_event_kind as enum (
    'created', 'status_changed', 'assignee_changed', 'priority_changed',
    'due_date_changed', 'completed', 'reopened', 'archived', 'restored',
    'checklist_item_completed', 'comment_added'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Colonne nuove su `tasks`
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists assignee_user_id uuid references auth.users (id) on delete set null,
  add column if not exists completed_at     timestamptz,
  add column if not exists completed_by     uuid references auth.users (id) on delete set null,
  add column if not exists archived_at      timestamptz,
  add column if not exists archived_by      uuid references auth.users (id) on delete set null;

comment on column public.tasks.assignee_user_id is
  'Chi è responsabile. NULL = non assegnata, che è uno stato legittimo e non un dato mancante. '
  'L''appartenenza all''azienda la verifica il trigger `trg_tasks_guard`, non il client.';
comment on column public.tasks.completed_at is
  'Scritto dal database quando lo stato passa a «completed». Un valore mandato dal client viene ignorato.';
comment on column public.tasks.archived_at is
  'Archiviata: fuori dalle viste correnti, ancora nello storico. Sostituisce la cancellazione '
  'a un clic, che su un prodotto B2B faceva sparire il lavoro senza lasciare traccia.';

-- Un'attività si può assegnare solo a chi ha un utente: se l'assegnatario viene
-- rimosso dall'azienda la riga resta, con `assignee_user_id` che punta a un
-- utente non più membro. Lo si scopre in lettura (il nome non si risolve) e lo
-- si corregge riassegnando — cancellare l'attività sarebbe peggio.

-- ---------------------------------------------------------------------------
-- 4. Checklist: i sotto-passaggi operativi di un'attività.
--
--    ⚠️ NON è `action_progress`, e la distinzione è deliberata:
--      · `action_progress` (0010) sono le azioni ESTRATTE dall'analisi di un
--        documento. Appartengono all'analisi, che è immutabile, e dicono cosa
--        il documento chiede. Non si inventano e non si riscrivono.
--      · `task_checklist_items` sono i passaggi che una persona decide per
--        portare a termine un'attività. Si aggiungono, si riordinano, si
--        cancellano.
--    Convertendo un'analisi in attività le azioni ancora APERTE vengono copiate
--    come passaggi: è una DERIVAZIONE UNA TANTUM, non una sincronizzazione. Da
--    quel momento le due liste vivono separate e nessuna insegue l'altra —
--    spuntare un passaggio non tocca l'analisi, che resta immutabile.
--    Le azioni già completate NON si copiano: ricopiarle come «da fare» sarebbe
--    falso, e copiarle già spuntate lo sarebbe di più, perché il trigger
--    riscriverebbe «chi» e «quando» con l'utente e l'ora di adesso.
--    (Questo commento non descrive alcun oggetto del database: cambiarlo non
--    richiede di riapplicare la migrazione.)
-- ---------------------------------------------------------------------------
create table if not exists public.task_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  task_id     uuid not null references public.tasks (id) on delete cascade,
  text        text not null check (length(btrim(text)) between 1 and 500),
  position    integer not null default 0,
  done        boolean not null default false,
  done_at     timestamptz,
  done_by     uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_checklist_task on public.task_checklist_items (task_id, position, created_at);
create index if not exists idx_checklist_company on public.task_checklist_items (company_id);

-- ---------------------------------------------------------------------------
-- 5. Commenti. Testo semplice: il corpo non viene mai interpretato come markup,
--    né qui né alla lettura. Non esiste HTML da sanificare perché non esiste
--    HTML — la stessa scelta fatta per il corpo delle email (§54/§98).
-- ---------------------------------------------------------------------------
create table if not exists public.task_comments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  task_id         uuid not null references public.tasks (id) on delete cascade,
  author_user_id  uuid not null references auth.users (id) on delete cascade,
  body            text not null check (length(btrim(body)) between 1 and 4000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_comments_task on public.task_comments (task_id, created_at desc);
create index if not exists idx_comments_company on public.task_comments (company_id);

-- ---------------------------------------------------------------------------
-- 6. Storico. Lo scrivono i trigger; il client può solo leggerlo.
-- ---------------------------------------------------------------------------
create table if not exists public.task_events (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  task_id        uuid not null references public.tasks (id) on delete cascade,
  actor_user_id  uuid references auth.users (id) on delete set null,
  kind           public.task_event_kind not null,
  -- Solo ciò che serve a raccontare il cambiamento: valori da/a, mai testi
  -- liberi provenienti dal client.
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_events_task on public.task_events (task_id, created_at desc);
create index if not exists idx_events_company on public.task_events (company_id);

-- ---------------------------------------------------------------------------
-- 7. Indici sulle interrogazioni che la lista fa davvero
-- ---------------------------------------------------------------------------
-- «Cosa c'è da fare»: tutto ciò che non è concluso, per scadenza.
create index if not exists idx_tasks_open_due
  on public.tasks (company_id, due_date, id)
  where status <> 'completed' and archived_at is null;
-- «Le mie attività».
create index if not exists idx_tasks_assignee
  on public.tasks (company_id, assignee_user_id, due_date);
-- Ricerca testuale su titolo e descrizione (stessa estensione già usata dalla 0013).
create index if not exists idx_tasks_search
  on public.tasks using gin ((coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(authority, '')) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 8. Il guardiano di `tasks`: assegnatario valido, completamento e archiviazione
--    scritti dal server.
-- ---------------------------------------------------------------------------
create or replace function public.tasks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- (a) L'assegnatario deve essere membro DELL'AZIENDA DELLA TASK. Senza questo
  --     controllo un membro potrebbe assegnare lavoro a un utente di un'altra
  --     azienda, e quel nome comparirebbe in una schermata che non gli
  --     appartiene. Non è un vincolo esprimibile con un CHECK: serve la lettura
  --     di un'altra tabella.
  if new.assignee_user_id is not null and not exists (
    select 1 from public.company_members m
    where m.company_id = new.company_id and m.user_id = new.assignee_user_id
  ) then
    raise exception 'assignee_not_member'
      using errcode = '23514',
            hint = 'La persona selezionata non appartiene a questa azienda.';
  end if;

  -- (b) Completamento: lo timbra il database. Se l'attività era già conclusa e
  --     resta tale, i valori originali non si toccano — chi ha completato una
  --     cosa non cambia perché qualcuno ha corretto il titolo.
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' then
      new.completed_at := now();
      new.completed_by := auth.uid();
    else
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    end if;
  else
    -- Riaperta: il completamento non è più un fatto, e i suoi campi si svuotano.
    -- Che sia stata completata in passato resta scritto in `task_events`, che è
    -- il posto giusto per la storia.
    new.completed_at := null;
    new.completed_by := null;
  end if;

  -- (c) Archiviazione: stesso principio. Il client dichiara l'intenzione
  --     valorizzando `archived_at`; il valore vero lo mette il database.
  if new.archived_at is not null then
    if tg_op = 'INSERT' or old.archived_at is null then
      new.archived_at := now();
      new.archived_by := auth.uid();
    else
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
    end if;
  else
    new.archived_by := null;
  end if;

  return new;
end $$;

drop trigger if exists trg_tasks_guard on public.tasks;
create trigger trg_tasks_guard
  before insert or update on public.tasks
  for each row execute function public.tasks_guard();

-- ---------------------------------------------------------------------------
-- 9. Storico automatico su `tasks`
-- ---------------------------------------------------------------------------
create or replace function public.tasks_record_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor, 'created',
            jsonb_build_object('source', new.source, 'priority', new.priority));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor,
            case
              when new.status = 'completed' then 'completed'::public.task_event_kind
              when old.status = 'completed' then 'reopened'::public.task_event_kind
              else 'status_changed'::public.task_event_kind
            end,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.assignee_user_id is distinct from old.assignee_user_id then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor, 'assignee_changed',
            jsonb_build_object('from', old.assignee_user_id, 'to', new.assignee_user_id));
  end if;

  if new.priority is distinct from old.priority then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor, 'priority_changed',
            jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;

  if new.due_date is distinct from old.due_date then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor, 'due_date_changed',
            jsonb_build_object('from', old.due_date, 'to', new.due_date));
  end if;

  if (new.archived_at is not null) is distinct from (old.archived_at is not null) then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor,
            case when new.archived_at is not null then 'archived'::public.task_event_kind
                 else 'restored'::public.task_event_kind end,
            '{}'::jsonb);
  end if;

  return new;
end $$;

drop trigger if exists trg_tasks_events on public.tasks;
create trigger trg_tasks_events
  after insert or update on public.tasks
  for each row execute function public.tasks_record_events();

-- ---------------------------------------------------------------------------
-- 10. Checklist: spunta timbrata dal server + evento
-- ---------------------------------------------------------------------------
create or replace function public.checklist_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  -- La riga deve appartenere all'azienda della propria attività: senza questo
  -- controllo un membro potrebbe agganciare una voce a una task altrui
  -- dichiarando la PROPRIA company_id, e la RLS non se ne accorgerebbe.
  select t.company_id into v_company from public.tasks t where t.id = new.task_id;
  if v_company is null or v_company is distinct from new.company_id then
    raise exception 'checklist_company_mismatch'
      using errcode = '23514', hint = 'La voce non appartiene all''attività indicata.';
  end if;

  if new.done then
    if tg_op = 'INSERT' or not old.done then
      new.done_at := now();
      new.done_by := auth.uid();
    else
      new.done_at := old.done_at;
      new.done_by := old.done_by;
    end if;
  else
    new.done_at := null;
    new.done_by := null;
  end if;

  return new;
end $$;

drop trigger if exists trg_checklist_guard on public.task_checklist_items;
create trigger trg_checklist_guard
  before insert or update on public.task_checklist_items
  for each row execute function public.checklist_guard();

drop trigger if exists trg_checklist_updated on public.task_checklist_items;
create trigger trg_checklist_updated
  before update on public.task_checklist_items
  for each row execute function public.set_updated_at();

create or replace function public.checklist_record_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.task_id, auth.uid(), 'checklist_item_completed',
            jsonb_build_object('item_id', new.id));
  end if;
  return new;
end $$;

drop trigger if exists trg_checklist_events on public.task_checklist_items;
create trigger trg_checklist_events
  after insert or update on public.task_checklist_items
  for each row execute function public.checklist_record_event();

-- ---------------------------------------------------------------------------
-- 11. Commenti: stessa verifica di appartenenza + evento
-- ---------------------------------------------------------------------------
create or replace function public.comments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select t.company_id into v_company from public.tasks t where t.id = new.task_id;
  if v_company is null or v_company is distinct from new.company_id then
    raise exception 'comment_company_mismatch'
      using errcode = '23514', hint = 'Il commento non appartiene all''attività indicata.';
  end if;
  -- L'autore è chi sta scrivendo, sempre.
  --
  -- ⚠️ Qui la prima versione RISCRIVEVA il campo con `auth.uid()`. Il risultato
  -- era sicuro — nessun commento è mai stato firmato a nome d'altri — ma era un
  -- fallback silenzioso: chi provava a firmare come un collega riceveva un
  -- «inserito» e non sapeva che il sistema aveva corretto. Su questo progetto un
  -- guasto si dichiara, non si aggiusta di nascosto. Ora si rifiuta.
  --
  -- La condizione lascia passare il service role (`auth.uid()` nullo), che è
  -- come lavorano le funzioni server e gli script di manutenzione.
  if auth.uid() is not null and new.author_user_id is distinct from auth.uid() then
    raise exception 'comment_author_mismatch'
      using errcode = '42501',
            hint = 'Un commento si firma con la propria identità.';
  end if;
  return new;
end $$;

drop trigger if exists trg_comments_guard on public.task_comments;
create trigger trg_comments_guard
  before insert or update on public.task_comments
  for each row execute function public.comments_guard();

drop trigger if exists trg_comments_updated on public.task_comments;
create trigger trg_comments_updated
  before update on public.task_comments
  for each row execute function public.set_updated_at();

create or replace function public.comments_record_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
  values (new.company_id, new.task_id, auth.uid(), 'comment_added',
          jsonb_build_object('comment_id', new.id));
  return new;
end $$;

drop trigger if exists trg_comments_events on public.task_comments;
create trigger trg_comments_events
  after insert on public.task_comments
  for each row execute function public.comments_record_event();

-- ---------------------------------------------------------------------------
-- 11bis. Rubrica dei membri: chi si può assegnare, e come si chiama.
--
-- Serve perché `profiles` è leggibile SOLO dal proprietario
-- (`profiles_select_own`, 0001): senza questa funzione un membro non potrebbe
-- vedere il nome di un collega, e l'interfaccia mostrerebbe identificativi al
-- posto delle persone. Non si allarga la policy di `profiles` — esporrebbe
-- l'intera riga, email compresa, a chiunque condivida un'azienda: si espone
-- solo ciò che serve, cioè come si chiama chi può ricevere un'attività.
--
-- `security definer` legge le tabelle, ma la prima condizione è che il
-- CHIAMANTE sia membro dell'azienda richiesta: senza quella riga la funzione
-- sarebbe una rubrica aperta di tutto il database.
-- ---------------------------------------------------------------------------
create or replace function public.company_member_directory(p_company_id uuid)
returns table (user_id uuid, display_name text, role public.member_role)
language sql
security definer
set search_path = ''
stable
as $$
  select
    m.user_id,
    -- Il nome se c'è; altrimenti l'email, che per un collega della stessa
    -- azienda è comunque un modo di riconoscerlo. Mai una stringa inventata.
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
      as display_name,
    m.role
  from public.company_members m
  left join public.profiles p on p.id = m.user_id
  where m.company_id = p_company_id
    and public.is_company_member(p_company_id)
  order by 2 nulls last;
$$;

revoke all on function public.company_member_directory(uuid) from public, anon;
grant execute on function public.company_member_directory(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11ter. La lista delle attività: filtri, ordinamento e paginazione nel database.
--
-- Perché una funzione e non tre `.order()` dal client: l'ordine che serve —
-- prima le scadute, poi la priorità alta, poi la scadenza più vicina, in fondo
-- quelle senza scadenza — non è esprimibile con una sequenza di colonne, e
-- ordinare in memoria richiederebbe di scaricare tutte le attività prima di
-- sapere quali contano. Con mille attività sarebbe un'applicazione che si
-- ferma; qui la pagina la compone il database.
--
-- `security invoker` (il default): la RLS di `tasks` continua ad applicarsi
-- riga per riga. Il filtro esplicito su `company_id` non la sostituisce — la
-- accompagna, com'è disciplina di questo progetto.
-- ---------------------------------------------------------------------------
create or replace function public.list_tasks(
  p_company_id  uuid,
  p_view        text default 'todo',      -- todo | mine | overdue | completed | archived | all
  p_status      public.task_status default null,
  p_priority    public.task_priority default null,
  p_source      public.task_source default null,
  p_assignee    uuid default null,
  p_search      text default null,
  p_limit       integer default 25,
  p_offset      integer default 0
)
returns table (
  id uuid, company_id uuid, created_by uuid, document_id uuid, subsidy_case_id uuid,
  title text, description text, authority text, due_date date,
  priority public.task_priority, status public.task_status, source public.task_source,
  assignee_user_id uuid, completed_at timestamptz, completed_by uuid,
  archived_at timestamptz, archived_by uuid, created_at timestamptz, updated_at timestamptz,
  assignee_name text, email_message_id uuid, total_count bigint
)
language sql
stable
set search_path = ''
as $$
  with filtered as (
    select t.*
    from public.tasks t
    where t.company_id = p_company_id
      -- Le viste. «archived» è l'unica che mostra le archiviate: ovunque
      -- altrove restano fuori, che è il senso dell'archiviazione.
      and case p_view
            when 'todo'      then t.status <> 'completed' and t.archived_at is null
            when 'mine'      then t.assignee_user_id = auth.uid() and t.status <> 'completed' and t.archived_at is null
            when 'overdue'   then t.status <> 'completed' and t.archived_at is null
                                  and t.due_date is not null and t.due_date < current_date
            when 'completed' then t.status = 'completed' and t.archived_at is null
            when 'archived'  then t.archived_at is not null
            else t.archived_at is null
          end
      and (p_status   is null or t.status = p_status)
      and (p_priority is null or t.priority = p_priority)
      and (p_source   is null or t.source = p_source)
      and (p_assignee is null or t.assignee_user_id = p_assignee)
      and (
        p_search is null or btrim(p_search) = ''
        or t.title ilike '%' || btrim(p_search) || '%'
        or coalesce(t.description, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(t.authority, '') ilike '%' || btrim(p_search) || '%'
      )
  )
  select
    f.id, f.company_id, f.created_by, f.document_id, f.subsidy_case_id,
    f.title, f.description, f.authority, f.due_date,
    f.priority, f.status, f.source,
    f.assignee_user_id, f.completed_at, f.completed_by,
    f.archived_at, f.archived_by, f.created_at, f.updated_at,
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as assignee_name,
    -- La comunicazione da cui nasce, quando il documento collegato viene dalla
    -- posta. Non serve una colonna su `tasks`: la relazione esiste già.
    (select d.email_message_id
       from public.email_message_documents d
      where d.document_id = f.document_id
      order by d.created_at asc
      limit 1) as email_message_id,
    count(*) over () as total_count
  from filtered f
  left join public.profiles p on p.id = f.assignee_user_id
  order by
    -- 1. scadute
    case when f.status <> 'completed' and f.due_date is not null and f.due_date < current_date
         then 0 else 1 end,
    -- 2. priorità alta
    case f.priority when 'high' then 0 when 'medium' then 1 else 2 end,
    -- 3. scadenza più vicina, 4. senza scadenza in fondo
    f.due_date asc nulls last,
    -- 5. a parità di tutto, le più recenti
    f.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.list_tasks(uuid, text, public.task_status, public.task_priority, public.task_source, uuid, text, integer, integer) from public, anon;
grant execute on function public.list_tasks(uuid, text, public.task_status, public.task_priority, public.task_source, uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. RLS
--
-- ⚠️ `revoke all` PRIMA dei grant, su ogni tabella nuova: su Supabase una
-- tabella di `public` nasce con i permessi di tabella completi per `anon` e
-- `authenticated` (`alter default privileges … grant all on tables`), quindi un
-- grant scritto dopo AGGIUNGE privilegi invece di restringerli. È la lezione
-- della 0014, dove i permessi di colonna della 0013 non restringevano nulla.
-- ---------------------------------------------------------------------------
alter table public.task_checklist_items enable row level security;
alter table public.task_comments        enable row level security;
alter table public.task_events          enable row level security;

revoke all on public.task_checklist_items from anon, authenticated, public;
revoke all on public.task_comments        from anon, authenticated, public;
revoke all on public.task_events          from anon, authenticated, public;

grant select, insert, update, delete on public.task_checklist_items to authenticated;
-- I commenti non si cancellano: una conversazione con dei buchi è peggio di una
-- conversazione con un errore. Si possono correggere entro i limiti della policy.
grant select, insert, update on public.task_comments to authenticated;
-- Lo storico è in SOLA LETTURA per il client: lo scrivono i trigger, che girano
-- come `security definer` e non passano da questi permessi.
grant select on public.task_events to authenticated;

drop policy if exists checklist_select_member on public.task_checklist_items;
create policy checklist_select_member on public.task_checklist_items
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists checklist_insert_member on public.task_checklist_items;
create policy checklist_insert_member on public.task_checklist_items
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists checklist_update_member on public.task_checklist_items;
create policy checklist_update_member on public.task_checklist_items
  for update to authenticated using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
drop policy if exists checklist_delete_member on public.task_checklist_items;
create policy checklist_delete_member on public.task_checklist_items
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists comments_select_member on public.task_comments;
create policy comments_select_member on public.task_comments
  for select to authenticated using (public.is_company_member(company_id));
-- `author_user_id = auth.uid()` nella WITH CHECK: nessuno può firmare a nome
-- d'altri, e non è una convenzione del servizio ma una regola del database.
drop policy if exists comments_insert_author on public.task_comments;
create policy comments_insert_author on public.task_comments
  for insert to authenticated
  with check (public.is_company_member(company_id) and author_user_id = auth.uid());
drop policy if exists comments_update_author on public.task_comments;
create policy comments_update_author on public.task_comments
  for update to authenticated
  using (public.is_company_member(company_id) and author_user_id = auth.uid())
  with check (public.is_company_member(company_id) and author_user_id = auth.uid());

drop policy if exists events_select_member on public.task_events;
create policy events_select_member on public.task_events
  for select to authenticated using (public.is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- 13. Autoverifica: la migrazione controlla di aver ottenuto ciò che dichiara.
--     Se domani qualcuno concede per sbaglio la scrittura sullo storico, questa
--     migrazione fallisce all'applicazione invece di lasciar passare la falla.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'task_events'
    and grantee in ('anon', 'authenticated', 'public')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'lo storico delle attività risulta scrivibile dal client: %', v_bad;
  end if;

  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'task_comments'
    and grantee in ('anon', 'authenticated', 'public')
    and privilege_type = 'DELETE';
  if v_bad is not null then
    raise exception 'i commenti risultano cancellabili dal client: %', v_bad;
  end if;
end $$;

