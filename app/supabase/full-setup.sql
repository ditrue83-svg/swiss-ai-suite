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

