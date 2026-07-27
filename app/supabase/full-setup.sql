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
--   0017_document_hub
--   0018_calendar_notifications
--   0019_notifications_mark_read
--   0020_workflow_automation
--
-- SERVE A INSTALLARE DA ZERO. Su un database già in esercizio si applica UNA
-- MIGRAZIONE ALLA VOLTA: questo file non aggiunge niente e in caso di errore
-- fa fallire l'intera transazione, compresa la migrazione che si voleva applicare.
--
-- Rieseguirlo è comunque sicuro, e la promessa è VERIFICATA prima di essere
-- scritta — non solo dichiarata. Il generatore controlla che:
--   · nessun trigger e nessuna policy vengano creati senza un «drop … if exists»
--     che li preceda (42710 fermerebbe tutto il file), riconoscendo anche i nomi
--     fra virgolette;
--   · nessun valore enum appena aggiunto venga usato nello stesso file (55P04).
-- Ciò che NON controlla, e che quindi resta responsabilità di chi scrive una
-- migrazione: tabelle, indici, colonne, vincoli, tipi e inserimenti di dati,
-- che vanno resi ripetibili a mano («if not exists», «do $$ … exception»,
-- «on conflict», «drop constraint if exists»).
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
drop trigger if exists trg_profiles_updated on public.profiles;
create trigger trg_profiles_updated        before update on public.profiles         for each row execute function public.set_updated_at();
drop trigger if exists trg_companies_updated on public.companies;
create trigger trg_companies_updated       before update on public.companies        for each row execute function public.set_updated_at();
drop trigger if exists trg_company_profiles_updated on public.company_profiles;
create trigger trg_company_profiles_updated before update on public.company_profiles for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.companies        enable row level security;
alter table public.company_members  enable row level security;
alter table public.company_profiles enable row level security;

-- profiles: ognuno vede/aggiorna solo il proprio profilo (l'insert è via trigger)
drop policy if exists profiles_select_own on public.profiles;
create policy profiles_select_own on public.profiles
  for select to authenticated using (id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- companies: leggibile dai membri; modificabile da owner/admin. Creazione via RPC.
drop policy if exists companies_select_member on public.companies;
create policy companies_select_member on public.companies
  for select to authenticated using (public.is_company_member(id));
drop policy if exists companies_update_admin on public.companies;
create policy companies_update_admin on public.companies
  for update to authenticated using (public.is_company_admin(id)) with check (public.is_company_admin(id));

-- company_members: i membri vedono i co-membri; owner/admin gestiscono la membership.
drop policy if exists members_select_member on public.company_members;
create policy members_select_member on public.company_members
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists members_insert_admin on public.company_members;
create policy members_insert_admin on public.company_members
  for insert to authenticated with check (public.is_company_admin(company_id));
drop policy if exists members_update_admin on public.company_members;
create policy members_update_admin on public.company_members
  for update to authenticated using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
drop policy if exists members_delete_admin on public.company_members;
create policy members_delete_admin on public.company_members
  for delete to authenticated using (public.is_company_admin(company_id));

-- company_profiles: leggibile/modificabile dai membri (dati operativi del profilo).
drop policy if exists company_profiles_select_member on public.company_profiles;
create policy company_profiles_select_member on public.company_profiles
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists company_profiles_insert_member on public.company_profiles;
create policy company_profiles_insert_member on public.company_profiles
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists company_profiles_update_member on public.company_profiles;
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
drop trigger if exists trg_documents_updated on public.documents;
create trigger trg_documents_updated  before update on public.documents         for each row execute function public.set_updated_at();
drop trigger if exists trg_analyses_updated on public.document_analyses;
create trigger trg_analyses_updated   before update on public.document_analyses for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS — accesso solo ai membri della company del record
-- ---------------------------------------------------------------------------
alter table public.documents         enable row level security;
alter table public.document_analyses enable row level security;

drop policy if exists documents_select_member on public.documents;
create policy documents_select_member on public.documents
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists documents_insert_member on public.documents;
create policy documents_insert_member on public.documents
  for insert to authenticated with check (public.is_company_member(company_id) and uploaded_by = auth.uid());
drop policy if exists documents_update_member on public.documents;
create policy documents_update_member on public.documents
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists documents_delete_member on public.documents;
create policy documents_delete_member on public.documents
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists analyses_select_member on public.document_analyses;
create policy analyses_select_member on public.document_analyses
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists analyses_insert_member on public.document_analyses;
create policy analyses_insert_member on public.document_analyses
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists analyses_update_member on public.document_analyses;
create policy analyses_update_member on public.document_analyses
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists analyses_delete_member on public.document_analyses;
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
drop trigger if exists trg_matches_updated on public.subsidy_matches;
create trigger trg_matches_updated    before update on public.subsidy_matches    for each row execute function public.set_updated_at();
drop trigger if exists trg_cases_updated on public.subsidy_cases;
create trigger trg_cases_updated       before update on public.subsidy_cases      for each row execute function public.set_updated_at();
drop trigger if exists trg_case_items_updated on public.subsidy_case_items;
create trigger trg_case_items_updated  before update on public.subsidy_case_items for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.subsidy_matches    enable row level security;
alter table public.subsidy_cases      enable row level security;
alter table public.subsidy_case_items enable row level security;

drop policy if exists matches_select_member on public.subsidy_matches;
create policy matches_select_member on public.subsidy_matches
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists matches_insert_member on public.subsidy_matches;
create policy matches_insert_member on public.subsidy_matches
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists matches_update_member on public.subsidy_matches;
create policy matches_update_member on public.subsidy_matches
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists matches_delete_member on public.subsidy_matches;
create policy matches_delete_member on public.subsidy_matches
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists cases_select_member on public.subsidy_cases;
create policy cases_select_member on public.subsidy_cases
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists cases_insert_member on public.subsidy_cases;
create policy cases_insert_member on public.subsidy_cases
  for insert to authenticated with check (public.is_company_member(company_id) and created_by = auth.uid());
drop policy if exists cases_update_member on public.subsidy_cases;
create policy cases_update_member on public.subsidy_cases
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists cases_delete_member on public.subsidy_cases;
create policy cases_delete_member on public.subsidy_cases
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists case_items_select_member on public.subsidy_case_items;
create policy case_items_select_member on public.subsidy_case_items
  for select to authenticated using (public.is_case_member(subsidy_case_id));
drop policy if exists case_items_insert_member on public.subsidy_case_items;
create policy case_items_insert_member on public.subsidy_case_items
  for insert to authenticated with check (public.is_case_member(subsidy_case_id));
drop policy if exists case_items_update_member on public.subsidy_case_items;
create policy case_items_update_member on public.subsidy_case_items
  for update to authenticated using (public.is_case_member(subsidy_case_id)) with check (public.is_case_member(subsidy_case_id));
drop policy if exists case_items_delete_member on public.subsidy_case_items;
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
drop trigger if exists trg_tasks_updated on public.tasks;
create trigger trg_tasks_updated before update on public.tasks for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.tasks enable row level security;

drop policy if exists tasks_select_member on public.tasks;
create policy tasks_select_member on public.tasks
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists tasks_insert_member on public.tasks;
create policy tasks_insert_member on public.tasks
  for insert to authenticated with check (public.is_company_member(company_id) and created_by = auth.uid());
drop policy if exists tasks_update_member on public.tasks;
create policy tasks_update_member on public.tasks
  for update to authenticated using (public.is_company_member(company_id)) with check (public.is_company_member(company_id));
drop policy if exists tasks_delete_member on public.tasks;
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
--
-- ⚠️ `drop policy if exists` PRIMA di ogni create, aggiunto il 2026-07-27 (secondo
-- giro). `create policy` non ha una forma `if not exists`: su un database che le
-- ha già fallisce con 42710 e — siccome il SQL editor esegue tutto in una
-- transazione sola — fa fallire l'INTERO file.
-- Le stesse quattro policy erano sfuggite alla correzione del 2026-07-27, e il
-- controllo di `npm run db:bundle` non le aveva viste perché i loro nomi sono
-- fra VIRGOLETTE e la sua espressione cercava `create policy <parola>`. Ora il
-- controllo le vede, e ha un caso di autoverifica che lo dimostra.
drop policy if exists "company_documents_select" on storage.objects;
create policy "company_documents_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'company-documents'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "company_documents_insert" on storage.objects;
create policy "company_documents_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'company-documents'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "company_documents_update" on storage.objects;
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

drop policy if exists "company_documents_delete" on storage.objects;
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

-- >>>>>>>>>>>>>>>>>>>>  0017_document_hub  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- AI-Swisse — 0017 SMART DOCUMENT HUB (Documenti)
--
-- L'Archivio diventa «Documenti»: non una cartella di file, ma il posto in cui
-- si ritrova ciò che l'azienda sa. Le domande a cui deve rispondere sono
-- concrete — «dov'è il contratto Swisscom?», «cosa ci ha mandato l'AFC
-- quest'anno?», «da quale email è arrivato questo PDF?» — e nessuna di esse si
-- risponde con un elenco ordinato per data.
--
-- ⚠️ QUESTA MIGRAZIONE NON CREA UNA SECONDA VERITÀ SUI DOCUMENTI.
-- Mittente, tipo, scadenza, importi, citazioni e incertezze restano dove sono:
-- in `document_analyses`, che è immutabile dalla 0010, e in
-- `analysis_corrections` per ciò che una persona ha corretto. Qui si aggiunge
-- SOLO l'organizzazione aziendale — categoria, etichette, archiviazione, note —
-- che è l'unica cosa che l'azienda può cambiare liberamente senza toccare
-- l'analisi. La lettura combinata la fa `list_documents`, che compone; non
-- copia.
--
-- COSA CONTIENE
--   1. Due tipi nuovi: `document_category` e `document_category_source`.
--   2. Colonne di organizzazione su `documents` (categoria, archiviazione, note).
--   3. Etichette aziendali: `document_tags` + `document_tag_links`.
--   4. Ricerca full-text sul testo estratto (configurazione `simple`).
--   5. Classificazione DETERMINISTICA da tipo documento e tipo di ente.
--   6. `list_documents` / `document_category_counts` / le tre azioni di gruppo.
--   7. RLS, permessi e autoverifica.
--
-- ⚠️ VINCOLO SUI VALORI ENUM (lezione della 0015, ricordata dalla 0016)
-- `alter type … add value` rende l'etichetta inutilizzabile fino alla fine
-- della transazione, e `full-setup.sql` concatena tutto in una transazione
-- sola. Qui NON si aggiungono valori a enum esistenti: i due tipi nuovi
-- nascono con `create type … as enum (…)`, e quelli sono utilizzabili subito.
-- `npm run db:bundle` lo verifica.
--
-- Riesecuzione: sicura. Ogni oggetto è idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Categoria documentale
--
-- ⚠️ LA CATEGORIA NON È IL TIPO DI DOCUMENTO. `document_type` dice CHE COSA è
-- un documento (un sollecito, una decisione, una fattura); la categoria dice
-- DOVE STA nell'organizzazione dell'azienda. Un sollecito dell'AFC è di tipo
-- «sollecito» e di categoria «imposte»: chi lo cerca fra sei mesi lo cerca
-- fra le imposte, non fra i solleciti.
--
-- Perché `social_insurance` è una categoria a sé e non sta dentro
-- «assicurazioni» né dentro «personale»: in Svizzera AVS/AI/IPG, LPP e LAINF
-- sono il flusso amministrativo più regolare di una PMI, arrivano da enti
-- diversi dalle assicurazioni private e si conservano separati. Metterli
-- altrove avrebbe significato decidere al posto dell'utente una cosa che il
-- dominio non decide.
--
-- Nessun valore «da classificare»: quello è l'ASSENZA di categoria (NULL).
-- Un documento che il sistema non sa classificare non è «altro» — «altro» è
-- una scelta che una persona può fare, NULL è il fatto che nessuno ha ancora
-- scelto. Confonderli farebbe sparire dalla vista ciò che va sistemato.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.document_category as enum (
    'administration',     -- autorità, permessi, decisioni, controlli
    'taxes',              -- imposte dirette e IVA
    'social_insurance',   -- AVS/AI/IPG, LPP, LAINF
    'invoices',           -- fatture e richieste di pagamento
    'contracts',          -- contratti e documenti contrattuali
    'insurance',          -- polizze private
    'banking',            -- banche e mezzi di pagamento
    'employees',          -- personale, salari, certificati
    'clients',            -- documenti riferiti a un cliente
    'suppliers',          -- documenti riferiti a un fornitore
    'subsidies',          -- incentivi e sussidi
    'other'               -- scelta esplicita di una persona, non un ripiego
  );
exception when duplicate_object then null; end $$;

-- Da dove viene la categoria. Due valori soli, e non tre: non esiste `ai`
-- perché nessuna chiamata AI viene fatta per classificare — dichiarare un
-- valore che il codice non produce sarebbe descrivere una funzione che non c'è.
do $$ begin
  create type public.document_category_source as enum ('rule', 'manual');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Organizzazione aziendale sul documento
--
-- Colonne su `documents` e non una tabella `document_catalog` a fianco: sono
-- attributi DEL documento, non di un'altra entità, e ogni riga della lista li
-- filtra e li ordina. Una tabella uno-a-uno avrebbe aggiunto un join a ogni
-- interrogazione e una riga da creare per ogni documento, in cambio di niente.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists category           public.document_category,
  add column if not exists category_source    public.document_category_source,
  add column if not exists category_set_by    uuid references auth.users (id) on delete set null,
  add column if not exists category_set_at    timestamptz,
  add column if not exists archived_at        timestamptz,
  add column if not exists archived_by        uuid references auth.users (id) on delete set null,
  add column if not exists internal_notes     text,
  add column if not exists notes_updated_at   timestamptz,
  add column if not exists notes_updated_by   uuid references auth.users (id) on delete set null;

do $$ begin
  alter table public.documents
    add constraint documents_internal_notes_len check (length(internal_notes) <= 4000);
exception when duplicate_object then null; end $$;

comment on column public.documents.category is
  'Dove il documento sta nell''organizzazione aziendale. NULL = nessuno ha ancora '
  'classificato, che è diverso da «other» (scelta esplicita di una persona).';
comment on column public.documents.category_source is
  'Chi ha deciso la categoria: «rule» una regola deterministica sul tipo di documento '
  'e sul tipo di ente, «manual» una persona. Lo scrive il trigger, non il client.';
comment on column public.documents.archived_at is
  'Archiviato: fuori dalle viste correnti, ancora nel sistema con analisi, email '
  'di provenienza e attività intatte. Non è la cancellazione.';
comment on column public.documents.internal_notes is
  'Annotazione interna dell''azienda («verificato con la fiduciaria il 12 agosto»). '
  'Testo semplice, mai interpretato come markup, e mai confuso con l''analisi AI.';

-- ---------------------------------------------------------------------------
-- 3. Etichette aziendali
--
-- Categoria e etichette rispondono a domande diverse: la categoria è una sola
-- e dice dove sta il documento, le etichette sono molte e dicono a cosa si
-- riferisce («IVA», «2026», «Sede Lugano», «Veicoli»). Per questo non si è
-- fatto un albero di cartelle: una gerarchia costringe a scegliere un solo
-- ramo e produce lavoro amministrativo invece di ridurlo.
-- ---------------------------------------------------------------------------
create table if not exists public.document_tags (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 40),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Unicità senza distinzione di maiuscole: «IVA» e «Iva» sono la stessa
-- etichetta, e vederle entrambe nell'elenco farebbe dubitare di quale usare.
create unique index if not exists uq_document_tags_name
  on public.document_tags (company_id, lower(btrim(name)));

create table if not exists public.document_tag_links (
  company_id   uuid not null references public.companies (id) on delete cascade,
  document_id  uuid not null references public.documents (id) on delete cascade,
  tag_id       uuid not null references public.document_tags (id) on delete cascade,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (document_id, tag_id)
);
create index if not exists idx_tag_links_tag on public.document_tag_links (tag_id);
create index if not exists idx_tag_links_company on public.document_tag_links (company_id);

-- ---------------------------------------------------------------------------
-- 4. Indici sulle interrogazioni che la lista fa DAVVERO
--
-- Non si aggiungono indici «per sicurezza»: ognuno di questi corrisponde a una
-- clausola che `list_documents` scrive sempre o quasi sempre.
-- ---------------------------------------------------------------------------
-- La lista predefinita: documenti non archiviati di un'azienda, dal più recente.
create index if not exists idx_documents_active
  on public.documents (company_id, created_at desc, id desc)
  where archived_at is null;
-- La barra laterale delle categorie e il filtro per categoria.
create index if not exists idx_documents_category
  on public.documents (company_id, category)
  where archived_at is null;
-- La vista «archiviati».
create index if not exists idx_documents_archived
  on public.documents (company_id, archived_at desc)
  where archived_at is not null;
-- Ricerca sui metadati del documento (titolo e nome del file originale).
create index if not exists idx_documents_text_trgm
  on public.documents using gin (
    (coalesce(title, '') || ' ' || coalesce(original_filename, '')) gin_trgm_ops
  );
-- «L'ultima analisi di questo documento», che la lista chiede per ogni riga.
create index if not exists idx_analyses_document_created
  on public.document_analyses (document_id, created_at desc);
-- Ricerca su mittente e oggetto, che stanno sull'analisi e non sul documento.
create index if not exists idx_analyses_text_trgm
  on public.document_analyses using gin (
    (coalesce(sender, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(recipient, '')) gin_trgm_ops
  );
-- Le correzioni umane di un documento, lette per ogni riga della lista.
create index if not exists idx_corrections_document
  on public.analysis_corrections (document_id, corrected_at);
-- Le attività collegate a un documento.
create index if not exists idx_tasks_document
  on public.tasks (document_id) where document_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Ricerca nel testo estratto
--
-- ⚠️ CONFIGURAZIONE `simple`, E LA RAGIONE VA DICHIARATA.
-- I documenti di una PMI svizzera arrivano in italiano, tedesco e francese,
-- spesso nella stessa settimana. Una configurazione con radici (`italian`,
-- `german`…) migliora una lingua e PEGGIORA le altre due, perché applica a
-- tutti i testi le regole di una sola. `simple` non taglia le desinenze e non
-- toglie parole comuni: cerca esattamente le parole scritte.
--
-- IL PREZZO, dichiarato qui e nel README: cercando «Rechnung» non si trovano i
-- documenti che dicono «Rechnungen». È un limite reale, ed è preferibile a una
-- ricerca che funziona bene in una lingua e male nelle altre due. La ricerca
-- sui metadati resta a sottostringa (trigram), quindi «Rechnung» trova
-- comunque «Rechnungen» in titolo, mittente e oggetto.
--
-- ⚠️ IL TESTO INDICIZZATO È TRONCATO A 500'000 CARATTERI. Non è un
-- arrotondamento: un `tsvector` non può superare 1 MB, e una colonna generata
-- che solleva un'eccezione farebbe fallire il salvataggio dell'ESTRAZIONE,
-- cioè spegnerebbe l'analisi dei documenti molto lunghi. Cinquecentomila
-- caratteri sono circa duecentocinquanta pagine di testo; oltre quella soglia
-- la ricerca full-text non copre la coda del documento, e questo è scritto
-- anche in `docs/document-hub.md`.
-- ---------------------------------------------------------------------------
alter table public.document_extractions
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('simple'::regconfig, left(coalesce(full_text, ''), 500000))
  ) stored;

create index if not exists idx_extractions_search
  on public.document_extractions using gin (search_tsv);

comment on column public.document_extractions.search_tsv is
  'Indice di ricerca del testo estratto, configurazione «simple» (nessuna radice, '
  'nessuna parola esclusa): i documenti arrivano in tre lingue e le regole di una '
  'sola peggiorerebbero le altre due. Copre i primi 500''000 caratteri.';

-- ---------------------------------------------------------------------------
-- 6. Conversioni difensive
--
-- Le correzioni umane sono salvate come JSON dal browser: una data corretta è
-- una stringa. Convertirla con `::date` dentro la lista significherebbe che una
-- sola correzione malformata fa fallire l'INTERA ricerca dell'azienda — un
-- guasto totale causato da un campo secondario. Queste due funzioni tornano
-- NULL invece di sollevare: il valore non convertibile viene ignorato e resta
-- quello dell'analisi, che è un dato vero.
-- ---------------------------------------------------------------------------
create or replace function public.try_date(p_text text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  return btrim(p_text)::date;
exception when others then
  return null;
end $$;

create or replace function public.try_numeric(p_text text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  return btrim(p_text)::numeric;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Classificazione deterministica
--
-- Nessuna chiamata AI: il documento è GIÀ stato analizzato, e da quell'analisi
-- si ricava la categoria quando il segnale è forte. Dove non lo è si torna
-- NULL, e il documento compare fra quelli da classificare — che è la verità.
-- Assegnare «altro» per non lasciare un vuoto sarebbe inventare una certezza.
--
-- L'ordine conta: il tipo di documento vince sul tipo di ente, perché una
-- fattura è una fattura anche se la manda un Comune. Il ripiego sull'ente
-- interviene solo quando il tipo non dice abbastanza.
--
-- Deliberatamente NON classificati: `declaration_request`,
-- `request_for_documents` e `information`. Una dichiarazione da presentare può
-- essere fiscale, sociale o statistica; una richiesta di documenti può venire
-- da chiunque. Il segnale non basta, e chi usa il prodotto se ne accorge
-- subito se la macchina indovina male.
-- ---------------------------------------------------------------------------
create or replace function public.document_category_from_analysis(
  p_document_type text,
  p_authority_type text
)
returns public.document_category
language sql
immutable
set search_path = ''
as $$
  select case
    -- (a) il tipo di documento, quando è già una collocazione
    when p_document_type = 'tax_document'      then 'taxes'::public.document_category
    when p_document_type = 'social_insurance'  then 'social_insurance'::public.document_category
    when p_document_type = 'employment'        then 'employees'::public.document_category
    when p_document_type = 'contract_related'  then 'contracts'::public.document_category
    when p_document_type = 'invoice'           then 'invoices'::public.document_category
    when p_document_type = 'permit'            then 'administration'::public.document_category
    when p_document_type = 'official_decision' then 'administration'::public.document_category
    when p_document_type = 'inspection_notice' then 'administration'::public.document_category

    -- (b) una richiesta di pagamento o un sollecito da un privato è una fattura;
    --     dallo Stato può essere un'imposta, una tassa o un canone, e quale
    --     delle tre non lo dice il tipo.
    when p_document_type in ('payment_request', 'reminder') and p_authority_type = 'private'
      then 'invoices'::public.document_category

    -- (c) il tipo di ente, quando il tipo di documento non ha deciso
    when p_authority_type = 'social_insurance' then 'social_insurance'::public.document_category
    when p_authority_type = 'pension'          then 'social_insurance'::public.document_category
    when p_authority_type = 'insurance'        then 'insurance'::public.document_category
    when p_authority_type in ('federal', 'cantonal', 'municipal')
      then 'administration'::public.document_category

    else null
  end;
$$;

comment on function public.document_category_from_analysis(text, text) is
  'Categoria ricavata da tipo di documento e tipo di ente. Torna NULL quando il '
  'segnale non basta: un documento non classificato è un fatto, una categoria '
  'plausibile ma sbagliata è un errore che nessuno nota.';

-- ---------------------------------------------------------------------------
-- 8. Il guardiano di `documents`
--
-- Come per le attività (0016), i timbri li mette il database. Il client può
-- mandare quello che vuole: chi ha archiviato, chi ha scelto la categoria e
-- quando lo decide `auth.uid()` e `now()`.
--
-- ⚠️ COME SI DISTINGUE UNA PERSONA DAL SISTEMA, e perché serve.
-- Due segnali, entrambi non falsificabili da un browser:
--   · `pg_trigger_depth() > 1` — l'aggiornamento arriva da un altro trigger,
--     cioè dalla classificazione automatica che scatta quando nasce un'analisi;
--   · `auth.uid() is null` — sta scrivendo il service role o una migrazione,
--     che è come lavorano le funzioni server e gli script (stessa condizione
--     già usata dal guardiano dei commenti nella 0016).
-- In quei due casi l'origine dichiarata viene rispettata; in tutti gli altri
-- chi cambia la categoria è una persona, e l'origine diventa «manual» con il
-- suo nome sopra. Così nessun client può spacciare una scelta propria per una
-- classificazione automatica, e viceversa.
-- ---------------------------------------------------------------------------
create or replace function public.documents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_system boolean := v_actor is null or pg_trigger_depth() > 1;
begin
  -- (a) Categoria
  if new.category is null then
    -- Nessuna categoria: non c'è nulla da attribuire a nessuno, né quando la
    -- si toglie né quando non c'è mai stata.
    new.category_source := null;
    new.category_set_by := null;
    new.category_set_at := null;
  elsif v_system then
    -- Il sistema scrive ciò che dichiara. Se ha messo una categoria senza dire
    -- da dove viene, viene dalla regola: è l'unico modo in cui il sistema
    -- classifica.
    if new.category_source is null then
      new.category_source := 'rule';
      new.category_set_at := coalesce(new.category_set_at, now());
    end if;
  elsif tg_op = 'INSERT' or new.category is distinct from old.category then
    new.category_source := 'manual';
    new.category_set_by := v_actor;
    new.category_set_at := now();
  else
    -- Categoria invariata: i timbri restano quelli. Chi ha classificato non
    -- cambia perché qualcuno ha corretto il titolo.
    new.category_source := old.category_source;
    new.category_set_by := old.category_set_by;
    new.category_set_at := old.category_set_at;
  end if;

  -- (b) Archiviazione. Il client dichiara l'intenzione valorizzando
  --     `archived_at`; il valore vero lo mette il database.
  if new.archived_at is not null then
    if tg_op = 'INSERT' or old.archived_at is null then
      new.archived_at := now();
      new.archived_by := v_actor;
    else
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
    end if;
  else
    new.archived_by := null;
  end if;

  -- (c) Nota interna: chi l'ha scritta e quando.
  if tg_op = 'INSERT' then
    if new.internal_notes is not null then
      new.notes_updated_at := now();
      new.notes_updated_by := v_actor;
    else
      new.notes_updated_at := null;
      new.notes_updated_by := null;
    end if;
  elsif new.internal_notes is distinct from old.internal_notes then
    new.notes_updated_at := now();
    new.notes_updated_by := v_actor;
  else
    new.notes_updated_at := old.notes_updated_at;
    new.notes_updated_by := old.notes_updated_by;
  end if;

  return new;
end $$;

drop trigger if exists trg_documents_guard on public.documents;
create trigger trg_documents_guard
  before insert or update on public.documents
  for each row execute function public.documents_guard();

-- ---------------------------------------------------------------------------
-- 9. Classificazione automatica quando arriva un'analisi
--
-- Si applica SOLO se nessuno ha ancora classificato il documento: una scelta
-- fatta da una persona non viene mai sovrascritta da una rianalisi. È
-- deliberatamente un trigger e non una colonna calcolata, perché la categoria
-- deve poter essere cambiata a mano e restare cambiata.
-- ---------------------------------------------------------------------------
create or replace function public.documents_autoclassify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.document_category;
begin
  -- Un'analisi fallita non descrive niente: non se ne ricava una collocazione.
  if new.analysis_status = 'failed' then return new; end if;

  v_category := public.document_category_from_analysis(new.document_type, new.sender_authority_type);
  if v_category is null then return new; end if;

  -- ⚠️ `d.company_id = new.company_id` NON è ridondante, ed è la riga più
  -- importante di questa funzione.
  --
  -- Questa funzione è `security definer`: scrive su `documents` SENZA passare
  -- dalla RLS. La policy di inserimento delle analisi (0010) verifica che chi
  -- inserisce sia membro dell'azienda dichiarata, ma NON che il documento
  -- indicato appartenga a quella stessa azienda. Senza questo confronto, un
  -- membro dell'azienda A potrebbe inserire un'analisi con la PROPRIA
  -- `company_id` e il `document_id` di un documento dell'azienda B, e questo
  -- trigger avrebbe scritto una categoria su un documento di B.
  -- (La falla di partenza viene chiusa qui sotto, al punto 9bis; questa riga
  -- resta comunque, perché una funzione che scavalca la RLS deve difendersi da
  -- sola e non fidarsi di una policy scritta altrove.)
  update public.documents d
     set category = v_category
   where d.id = new.document_id
     and d.company_id = new.company_id
     and d.category is null
     and d.category_source is distinct from 'manual';

  return new;
end $$;

drop trigger if exists trg_documents_autoclassify on public.document_analyses;
create trigger trg_documents_autoclassify
  after insert on public.document_analyses
  for each row execute function public.documents_autoclassify();

-- ---------------------------------------------------------------------------
-- 9bis. Un'analisi appartiene al documento della PROPRIA azienda
--
-- Falla trovata rileggendo la 0010 con l'occhio di chi vuole abusarne, mentre
-- si scriveva la classificazione automatica. La policy di inserimento verifica
-- che chi scrive sia membro dell'azienda DICHIARATA nella riga, ma nessuno
-- verificava che il `document_id` appartenesse a quella azienda: un membro di A
-- poteva creare righe di analisi agganciate ai documenti di B.
--
-- Da sola non era una fuga di dati — la RLS in lettura filtra per `company_id`,
-- quindi B non vedeva quelle righe e A non vedeva i documenti di B — ma era
-- scrittura in casa d'altri, e la classificazione automatica l'avrebbe resa
-- visibile. Si chiude qui, dove è stata trovata, invece di lasciarla aperta
-- perché «non è di questa migrazione».
-- ---------------------------------------------------------------------------
drop policy if exists analyses_insert_member on public.document_analyses;
create policy analyses_insert_member on public.document_analyses
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and engine like 'deterministic-%'              -- niente righe che si spacciano per AI
    and provider is null
    and model is null
    and prompt_version is null
    and exists (
      select 1 from public.documents d
      where d.id = document_id and d.company_id = company_id
    )
  );

comment on policy analyses_insert_member on public.document_analyses is
  'Il client può inserire solo analisi del motore locale, senza provenienza AI, '
  'e SOLO su documenti della stessa azienda dichiarata nella riga.';

-- ---------------------------------------------------------------------------
-- 10. Etichette: appartenenza verificata dal database
--
-- Il caso obliquo è lo stesso già visto con la checklist delle attività: un
-- membro dichiara la PROPRIA azienda e aggancia l'etichetta a un documento di
-- un'altra. La RLS da sola lascerebbe passare — la company dichiarata è
-- davvero la sua — e per questo il controllo confronta le tre appartenenze.
-- ---------------------------------------------------------------------------
create or replace function public.document_tag_link_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc_company uuid;
  v_tag_company uuid;
  v_count integer;
begin
  select d.company_id into v_doc_company from public.documents d where d.id = new.document_id;
  select g.company_id into v_tag_company from public.document_tags g where g.id = new.tag_id;

  if v_doc_company is null or v_tag_company is null
     or v_doc_company is distinct from new.company_id
     or v_tag_company is distinct from new.company_id then
    raise exception 'tag_company_mismatch'
      using errcode = '23514',
            hint = 'Etichetta e documento devono appartenere alla stessa azienda.';
  end if;

  -- Un tetto al numero di etichette per documento: venti sono già molte, e
  -- oltre quella soglia le etichette smettono di aiutare a ritrovare qualcosa.
  select count(*) into v_count from public.document_tag_links l where l.document_id = new.document_id;
  if v_count >= 20 then
    raise exception 'too_many_tags'
      using errcode = '23514', hint = 'Un documento può avere al massimo venti etichette.';
  end if;

  new.created_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_tag_link_guard on public.document_tag_links;
create trigger trg_tag_link_guard
  before insert on public.document_tag_links
  for each row execute function public.document_tag_link_guard();

create or replace function public.document_tag_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end $$;

drop trigger if exists trg_document_tag_guard on public.document_tags;
create trigger trg_document_tag_guard
  before insert or update on public.document_tags
  for each row execute function public.document_tag_guard();

-- ---------------------------------------------------------------------------
-- 11. La lista: ricerca, filtri, ordinamento e paginazione nel database
--
-- Perché una funzione e non query dal client: una riga della lista mette
-- insieme il documento, l'ultima analisi, le correzioni umane, le etichette,
-- le attività collegate e le comunicazioni di provenienza. Fatto dal browser
-- sarebbe una query per documento per relazione — venticinque righe, cento
-- interrogazioni — e per sapere quali venticinque righe mostrare bisognerebbe
-- averle scaricate tutte.
--
-- `security invoker` (il default): la RLS di ogni tabella continua ad
-- applicarsi riga per riga. Il filtro esplicito su `company_id` e il controllo
-- di appartenenza NON la sostituiscono, la accompagnano. Una funzione di
-- ricerca è il posto più facile del mondo per aggirare per sbaglio l'isolamento
-- fra aziende, e qui gli strati sono tre.
--
-- PAGINAZIONE A SCORRIMENTO (offset) e non a cursore, con motivazione: la
-- pagina mostra «venticinque di duecentodiciotto», la barra laterale mostra i
-- conteggi per categoria e l'ordinamento cambia con un menu. Un cursore
-- keyset — che nell'Inbox è la scelta giusta, perché lì si scorre una sola
-- lista sempre nello stesso ordine — qui impedirebbe di dire quanti sono e di
-- saltare avanti. L'ordinamento porta SEMPRE `id` come ultimo criterio: senza,
-- due documenti creati nello stesso istante si scambierebbero di posto fra una
-- pagina e l'altra, e uno dei due non comparirebbe mai.
-- ---------------------------------------------------------------------------
create or replace function public.list_documents(
  p_company_id      uuid,
  p_query           text default null,
  p_category        public.document_category default null,
  p_uncategorized   boolean default false,
  p_source          public.document_source_type default null,
  p_state           text default null,      -- to_verify | analyzed | failed | processing | none
  p_tag_ids         uuid[] default null,
  p_date_from       date default null,
  p_date_to         date default null,
  p_has_deadline    boolean default false,
  p_archived        boolean default false,
  p_sort            text default 'recent',  -- recent | oldest | document_date | title | deadline
  p_limit           integer default 25,
  p_offset          integer default 0,
  -- Un solo documento. Serve al DETTAGLIO, e non è una comodità: la riga della
  -- lista e la testata del dettaglio devono dire la stessa cosa sullo stesso
  -- documento — stessa analisi scelta, stesse correzioni applicate. Con due
  -- implementazioni diverse prima o poi divergono, e a divergere sarebbero
  -- proprio mittente e scadenza.
  p_document_id     uuid default null
)
returns table (
  id uuid,
  title text,
  original_filename text,
  mime_type text,
  file_size bigint,
  storage_path text,
  source_type public.document_source_type,
  status public.document_status,
  page_count integer,
  created_at timestamptz,
  archived_at timestamptz,
  category public.document_category,
  category_source public.document_category_source,
  analysis_id uuid,
  analysis_status public.analysis_status,
  last_attempt_failed boolean,
  error_code text,
  document_type text,
  document_type_corrected boolean,
  sender text,
  sender_corrected boolean,
  sender_authority_type text,
  document_date date,
  deadline date,
  deadline_corrected boolean,
  deadline_requires_verification boolean,
  amount numeric,
  amount_currency text,
  amount_corrected boolean,
  confidence text,
  tags jsonb,
  open_task_count bigint,
  task_count bigint,
  email_count bigint,
  snippet text,
  total_count bigint
)
language sql
stable
set search_path = ''
as $$
  with params as (
    select
      -- I caratteri jolly digitati da una persona devono cercare sé stessi:
      -- un `%` in una ricerca è un per cento, non «qualsiasi cosa».
      nullif(btrim(left(coalesce(p_query, ''), 120)), '') as q,
      replace(replace(replace(
        btrim(left(coalesce(p_query, ''), 120)), '\', '\\'), '%', '\%'), '_', '\_') as q_like
  ),
  base as (
    select
      d.*,
      -- L'ULTIMO tentativo: dice lo STATO, anche quando è un fallimento.
      last_try.id            as try_id,
      last_try.analysis_status as try_status,
      last_try.error_code    as try_error,
      -- L'ultima analisi VALIDA: dice il CONTENUTO. Se l'ultimo tentativo è
      -- fallito ma prima esisteva un risultato buono, quel risultato non
      -- scompare — è la stessa regola di `analysisService.getForDocument`,
      -- e averne due diverse farebbe dire due cose alla stessa schermata.
      good.id                as good_id,
      good.document_type     as a_document_type,
      good.sender            as a_sender,
      good.sender_authority_type as a_authority,
      good.document_date     as a_document_date,
      good.deadline          as a_deadline,
      good.deadline_requires_verification as a_deadline_verify,
      good.amount            as a_amount,
      good.amount_currency   as a_currency,
      good.confidence        as a_confidence,
      corr.v                 as corrections,
      count(*) over ()       as n_total
    from public.documents d
    left join lateral (
      select a.id, a.analysis_status, a.error_code
      from public.document_analyses a
      -- Il confronto sull'azienda accompagna la RLS, non la sostituisce: è la
      -- disciplina di questo progetto, e qui evita anche che un'analisi
      -- agganciata per errore a un documento altrui possa mai essere letta.
      where a.document_id = d.id and a.company_id = d.company_id
      order by a.created_at desc, a.id desc
      limit 1
    ) last_try on true
    left join lateral (
      select a.*
      from public.document_analyses a
      where a.document_id = d.id and a.company_id = d.company_id
        and a.analysis_status <> 'failed'
      order by a.created_at desc, a.id desc
      limit 1
    ) good on true
    left join lateral (
      -- Un solo passaggio sulle correzioni del documento: le più recenti
      -- sovrascrivono le precedenti perché `jsonb_object_agg` tiene l'ultimo
      -- valore di ogni chiave.
      select jsonb_object_agg(c.field, c.corrected_value) as v
      from (
        select c2.field, c2.corrected_value
        from public.analysis_corrections c2
        where c2.document_id = d.id and c2.company_id = d.company_id
        order by c2.corrected_at asc
      ) c
    ) corr on true
    where d.company_id = p_company_id
      -- Sottointerrogazione scalare: l'appartenenza si verifica UNA volta per
      -- interrogazione e non una volta per riga.
      and (select public.is_company_member(p_company_id))
      and (p_document_id is null or d.id = p_document_id)
      -- Chiedendo UN documento non si applica il filtro di archiviazione: il suo
      -- indirizzo deve funzionare anche dopo che è stato archiviato, altrimenti
      -- «archivia» diventerebbe indistinguibile da «fai sparire».
      and (p_document_id is not null
           or (case when p_archived then d.archived_at is not null else d.archived_at is null end))
      and (p_category is null or d.category = p_category)
      and (not p_uncategorized or d.category is null)
      and (p_source is null or d.source_type = p_source)
      and (p_tag_ids is null or array_length(p_tag_ids, 1) is null or exists (
            select 1 from public.document_tag_links l
            where l.document_id = d.id and l.company_id = d.company_id
              and l.tag_id = any (p_tag_ids)
          ))
      and (not p_has_deadline or coalesce(
            public.try_date(corr.v ->> 'deadline'), good.deadline) is not null)
      and (p_date_from is null or coalesce(
            public.try_date(corr.v ->> 'document_date'), good.document_date,
            d.created_at::date) >= p_date_from)
      and (p_date_to is null or coalesce(
            public.try_date(corr.v ->> 'document_date'), good.document_date,
            d.created_at::date) <= p_date_to)
      and (
        p_state is null
        or (p_state = 'failed'     and last_try.analysis_status = 'failed')
        or (p_state = 'to_verify'  and last_try.analysis_status = 'needs_review')
        or (p_state = 'analyzed'   and last_try.analysis_status = 'completed')
        -- «In elaborazione» è uno stato del DOCUMENTO, non dell'analisi: fra il
        -- caricamento e la prima riga di analisi non esiste ancora nulla da
        -- interrogare, ed è proprio il momento in cui una persona si chiede
        -- dove sia finito il suo file.
        or (p_state = 'processing' and d.status in ('extracting', 'analyzing', 'processing'))
        or (p_state = 'none'       and last_try.id is null
              and d.status not in ('extracting', 'analyzing', 'processing'))
      )
      and (
        (select q from params) is null
        or d.title ilike '%' || (select q_like from params) || '%'
        or coalesce(d.original_filename, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(good.sender, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(good.subject, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(good.recipient, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(good.document_type, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(good.reference_numbers::text, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(corr.v::text, '') ilike '%' || (select q_like from params) || '%'
        or exists (
             select 1 from public.document_tag_links l
             join public.document_tags g on g.id = l.tag_id and g.company_id = l.company_id
             where l.document_id = d.id and l.company_id = d.company_id
               and g.name ilike '%' || (select q_like from params) || '%'
           )
        or exists (
             select 1 from public.document_extractions e
             where e.document_id = d.id and e.company_id = d.company_id
               and e.search_tsv @@ plainto_tsquery('simple'::regconfig, (select q from params))
           )
      )
    order by
      case when p_sort = 'oldest' then d.created_at end asc nulls last,
      case when p_sort = 'title' then lower(d.title) end asc nulls last,
      case when p_sort = 'document_date'
           then coalesce(public.try_date(corr.v ->> 'document_date'), good.document_date) end desc nulls last,
      case when p_sort = 'deadline'
           then coalesce(public.try_date(corr.v ->> 'deadline'), good.deadline) end asc nulls last,
      case when p_sort in ('oldest', 'title', 'document_date', 'deadline')
           then null else d.created_at end desc nulls last,
      -- Ultimo criterio SEMPRE presente: senza, due righe uguali possono
      -- scambiarsi di posto fra una pagina e l'altra.
      d.id desc
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    b.id, b.title, b.original_filename, b.mime_type, b.file_size, b.storage_path,
    b.source_type, b.status, b.page_count, b.created_at, b.archived_at,
    b.category, b.category_source,
    coalesce(b.good_id, b.try_id) as analysis_id,
    b.try_status as analysis_status,
    -- `coalesce` fino in fondo: senza analisi queste espressioni valgono NULL, e
    -- un NULL che arriva al posto di un «no» diventa, nel browser, un «forse».
    coalesce(b.try_status = 'failed' and b.good_id is not null, false) as last_attempt_failed,
    b.try_error as error_code,
    -- Valore EFFETTIVO: la correzione umana se c'è, altrimenti il dato
    -- dell'analisi. Il valore originale dell'AI non viene toccato e resta
    -- leggibile nel dettaglio: qui si mostra ciò che l'azienda ritiene vero.
    coalesce(b.corrections ->> 'document_type', b.a_document_type) as document_type,
    coalesce(b.corrections ? 'document_type', false) as document_type_corrected,
    coalesce(b.corrections ->> 'sender', b.a_sender) as sender,
    coalesce(b.corrections ? 'sender', false) as sender_corrected,
    b.a_authority as sender_authority_type,
    coalesce(public.try_date(b.corrections ->> 'document_date'), b.a_document_date) as document_date,
    coalesce(public.try_date(b.corrections ->> 'deadline'), b.a_deadline) as deadline,
    coalesce(b.corrections ? 'deadline', false) as deadline_corrected,
    coalesce(b.a_deadline_verify, false) as deadline_requires_verification,
    coalesce(public.try_numeric(b.corrections ->> 'amount'), b.a_amount) as amount,
    b.a_currency as amount_currency,
    coalesce(b.corrections ? 'amount', false) as amount_corrected,
    b.a_confidence as confidence,
    coalesce(tg.v, '[]'::jsonb) as tags,
    coalesce(tk.open_count, 0) as open_task_count,
    coalesce(tk.all_count, 0) as task_count,
    coalesce(em.n, 0) as email_count,
    -- L'estratto si calcola SOLO sulle righe che si mostrano davvero, ed è
    -- testo semplice: i due delimitatori li interpreta React costruendo
    -- elementi, non inserendo HTML. Nel Document Hub non esiste markup
    -- proveniente da un documento.
    case
      when (select q from params) is null then null
      else (
        -- I delimitatori sono fra virgolette perché l'elenco delle opzioni è
        -- separato da virgole: un valore non quotato che contiene caratteri
        -- speciali verrebbe interpretato male.
        select ts_headline('simple'::regconfig, left(coalesce(e.full_text, ''), 500000),
                 plainto_tsquery('simple'::regconfig, (select q from params)),
                 'StartSel="[[", StopSel="]]", MaxWords=22, MinWords=8, MaxFragments=1')
        from public.document_extractions e
        where e.document_id = b.id and e.company_id = b.company_id
          and e.search_tsv @@ plainto_tsquery('simple'::regconfig, (select q from params))
        limit 1
      )
    end as snippet,
    b.n_total as total_count
  from base b
  left join lateral (
    select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name) as v
    from public.document_tag_links l
    join public.document_tags g on g.id = l.tag_id and g.company_id = l.company_id
    where l.document_id = b.id and l.company_id = b.company_id
  ) tg on true
  left join lateral (
    select
      count(*) filter (where t.status <> 'completed' and t.archived_at is null) as open_count,
      count(*) as all_count
    from public.tasks t where t.document_id = b.id and t.company_id = b.company_id
  ) tk on true
  left join lateral (
    select count(*) as n
    from public.email_message_documents m
    where m.document_id = b.id and m.company_id = b.company_id
  ) em on true
  -- Lo stesso ordine della selezione, espressione per espressione. Ordinare
  -- l'esterno in modo diverso dall'interno vorrebbe dire scegliere venticinque
  -- righe secondo un criterio e mostrarle secondo un altro: la pagina due non
  -- verrebbe dopo la pagina uno.
  order by
    case when p_sort = 'oldest' then b.created_at end asc nulls last,
    case when p_sort = 'title' then lower(b.title) end asc nulls last,
    case when p_sort = 'document_date'
         then coalesce(public.try_date(b.corrections ->> 'document_date'), b.a_document_date) end desc nulls last,
    case when p_sort = 'deadline'
         then coalesce(public.try_date(b.corrections ->> 'deadline'), b.a_deadline) end asc nulls last,
    case when p_sort in ('oldest', 'title', 'document_date', 'deadline')
         then null else b.created_at end desc nulls last,
    b.id desc;
$$;

revoke all on function public.list_documents(uuid, text, public.document_category, boolean, public.document_source_type, text, uuid[], date, date, boolean, boolean, text, integer, integer, uuid) from public, anon;
grant execute on function public.list_documents(uuid, text, public.document_category, boolean, public.document_source_type, text, uuid[], date, date, boolean, boolean, text, integer, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Conteggi per categoria
--
-- Una aggregazione sola invece di dodici interrogazioni. I conteggi seguono lo
-- stesso filtro di archiviazione della lista: mostrare «Imposte 18» accanto a
-- una lista che ne contiene 12 perché sei sono archiviate sarebbe un numero
-- che non corrisponde a niente di visibile.
-- ---------------------------------------------------------------------------
create or replace function public.document_category_counts(
  p_company_id uuid,
  p_archived   boolean default false
)
returns table (category public.document_category, n bigint)
language sql
stable
set search_path = ''
as $$
  select d.category, count(*)
  from public.documents d
  where d.company_id = p_company_id
    and (select public.is_company_member(p_company_id))
    and (case when p_archived then d.archived_at is not null else d.archived_at is null end)
  group by d.category;
$$;

revoke all on function public.document_category_counts(uuid, boolean) from public, anon;
grant execute on function public.document_category_counts(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Azioni di gruppo: tutte o nessuna
--
-- ⚠️ Un'azione su più documenti che ne trova uno di un'altra azienda NON deve
-- fare metà lavoro. La RLS impedirebbe comunque di toccare il documento altrui,
-- ma il risultato sarebbe «fatto» su quattro righe su cinque, senza che nessuno
-- sappia quale è rimasta indietro. Qui il conteggio viene confrontato PRIMA di
-- scrivere: se non torna, non si scrive niente e si dice perché.
--
-- `security invoker`: la RLS resta in vigore, quindi il conteggio vede solo i
-- documenti che il chiamante può davvero vedere.
-- ---------------------------------------------------------------------------
create or replace function public.documents_assert_all_mine(p_company_id uuid, p_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_found integer;
  v_asked integer := coalesce(array_length(p_ids, 1), 0);
begin
  if v_asked = 0 then
    raise exception 'no_documents_selected'
      using errcode = '23514', hint = 'Nessun documento selezionato.';
  end if;
  if v_asked > 200 then
    raise exception 'too_many_documents'
      using errcode = '23514', hint = 'Al massimo duecento documenti per volta.';
  end if;
  if not public.is_company_member(p_company_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select count(*) into v_found
  from public.documents d
  where d.id = any (p_ids) and d.company_id = p_company_id;

  if v_found <> v_asked then
    raise exception 'documents_not_all_visible'
      using errcode = '42501',
            hint = 'Alcuni documenti selezionati non appartengono a questa azienda.';
  end if;
end $$;

create or replace function public.documents_bulk_set_category(
  p_company_id uuid,
  p_ids        uuid[],
  p_category   public.document_category
)
returns integer
language plpgsql
set search_path = ''
as $$
declare v_n integer;
begin
  perform public.documents_assert_all_mine(p_company_id, p_ids);
  update public.documents set category = p_category
   where id = any (p_ids) and company_id = p_company_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.documents_bulk_archive(
  p_company_id uuid,
  p_ids        uuid[],
  p_archived   boolean
)
returns integer
language plpgsql
set search_path = ''
as $$
declare v_n integer;
begin
  perform public.documents_assert_all_mine(p_company_id, p_ids);
  update public.documents
     set archived_at = case when p_archived then now() else null end
   where id = any (p_ids) and company_id = p_company_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.documents_bulk_add_tag(
  p_company_id uuid,
  p_ids        uuid[],
  p_tag_id     uuid
)
returns integer
language plpgsql
set search_path = ''
as $$
declare v_n integer;
begin
  perform public.documents_assert_all_mine(p_company_id, p_ids);
  insert into public.document_tag_links (company_id, document_id, tag_id)
  select p_company_id, x, p_tag_id from unnest(p_ids) as x
  on conflict (document_id, tag_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.documents_assert_all_mine(uuid, uuid[]) from public, anon;
revoke all on function public.documents_bulk_set_category(uuid, uuid[], public.document_category) from public, anon;
revoke all on function public.documents_bulk_archive(uuid, uuid[], boolean) from public, anon;
revoke all on function public.documents_bulk_add_tag(uuid, uuid[], uuid) from public, anon;
grant execute on function public.documents_assert_all_mine(uuid, uuid[]) to authenticated;
grant execute on function public.documents_bulk_set_category(uuid, uuid[], public.document_category) to authenticated;
grant execute on function public.documents_bulk_archive(uuid, uuid[], boolean) to authenticated;
grant execute on function public.documents_bulk_add_tag(uuid, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. RLS e permessi
--
-- ⚠️ `revoke all` PRIMA dei grant sulle tabelle nuove. Su Supabase una tabella
-- di `public` nasce con i permessi di tabella completi per `anon` e
-- `authenticated`, quindi un grant scritto dopo AGGIUNGE privilegi invece di
-- restringerli: è la lezione della 0014, dove i permessi di colonna della 0013
-- non restringevano nulla.
-- ---------------------------------------------------------------------------
alter table public.document_tags       enable row level security;
alter table public.document_tag_links  enable row level security;

revoke all on public.document_tags      from anon, authenticated, public;
revoke all on public.document_tag_links from anon, authenticated, public;

grant select, insert, update, delete on public.document_tags to authenticated;
grant select, insert, delete on public.document_tag_links to authenticated;

drop policy if exists document_tags_select on public.document_tags;
create policy document_tags_select on public.document_tags
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists document_tags_insert on public.document_tags;
create policy document_tags_insert on public.document_tags
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists document_tags_update on public.document_tags;
create policy document_tags_update on public.document_tags
  for update to authenticated using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
-- Cancellare un'etichetta la toglie da tutti i documenti (cascade sui
-- collegamenti): è una modifica che riguarda l'intera azienda, quindi resta a
-- chi la amministra.
drop policy if exists document_tags_delete on public.document_tags;
create policy document_tags_delete on public.document_tags
  for delete to authenticated using (public.is_company_admin(company_id));

drop policy if exists document_tag_links_select on public.document_tag_links;
create policy document_tag_links_select on public.document_tag_links
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists document_tag_links_insert on public.document_tag_links;
create policy document_tag_links_insert on public.document_tag_links
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists document_tag_links_delete on public.document_tag_links;
create policy document_tag_links_delete on public.document_tag_links
  for delete to authenticated using (public.is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- 15. Cancellazione definitiva: chi può
--
-- Fino alla 0016 qualunque membro poteva cancellare qualunque documento
-- dell'azienda, e la cancellazione era l'unico modo di togliere qualcosa dalla
-- lista. Ora togliere si fa ARCHIVIANDO — che non perde niente — e la
-- cancellazione definitiva diventa rara e distruttiva: porta via con sé
-- analisi, estrazioni, correzioni, collegamenti alle email e alle attività.
--
-- La regola: la amministra chi amministra l'azienda (owner o admin). Un membro
-- può cancellare soltanto ciò che ha caricato lui — che comprende il caso in
-- cui l'upload del file fallisce e il servizio deve rimuovere il record appena
-- creato. I documenti arrivati dalla posta hanno `uploaded_by` nullo, quindi
-- restano cancellabili solo da un amministratore.
-- ---------------------------------------------------------------------------
drop policy if exists documents_delete_member on public.documents;
drop policy if exists documents_delete_admin_or_owner on public.documents;
create policy documents_delete_admin_or_owner on public.documents
  for delete to authenticated
  using (
    public.is_company_admin(company_id)
    or (public.is_company_member(company_id) and uploaded_by = auth.uid())
  );

comment on policy documents_delete_admin_or_owner on public.documents is
  'La cancellazione definitiva è degli amministratori; un membro può cancellare solo '
  'i documenti che ha caricato. Per togliere un documento dalle viste si archivia.';

-- ---------------------------------------------------------------------------
-- 16. Classificazione dei documenti già presenti
--
-- Derivazione UNA TANTUM: i documenti che hanno già un'analisi ricevono la
-- categoria che la regola sa dedurre, con origine «rule». Quelli su cui la
-- regola non decide restano senza categoria e compaiono fra i documenti da
-- classificare. Nessuna categoria viene inventata per riempire un vuoto.
--
-- ⚠️ L'aggiornamento passa dal trigger `documents_guard`. Qui `auth.uid()` è
-- nullo — la migrazione la esegue chi amministra il database, non un utente —
-- quindi il guardiano riconosce una scrittura di sistema e registra l'origine
-- «rule» invece di attribuire la classificazione a una persona. Se non fosse
-- così, duecento documenti risulterebbero classificati a mano da nessuno.
-- ---------------------------------------------------------------------------
do $$
declare
  v_touched integer;
begin
  with latest as (
    select distinct on (a.document_id)
      a.document_id, a.document_type, a.sender_authority_type
    from public.document_analyses a
    where a.analysis_status <> 'failed'
    order by a.document_id, a.created_at desc, a.id desc
  ),
  guessed as (
    select l.document_id,
           public.document_category_from_analysis(l.document_type, l.sender_authority_type) as cat
    from latest l
  )
  update public.documents d
     set category = g.cat
    from guessed g
   where d.id = g.document_id
     and g.cat is not null
     and d.category is null;
  get diagnostics v_touched = row_count;
  raise notice 'Documenti classificati dalla regola: %', v_touched;
end $$;

-- ---------------------------------------------------------------------------
-- 17. Autoverifica: la migrazione controlla di aver ottenuto ciò che dichiara.
--
-- Non è un ornamento. La 0013 dichiarava nei commenti una garanzia che non
-- esisteva, e lo si è scoperto solo eseguendo i test sul database vero: da
-- allora ogni migrazione che promette qualcosa la verifica prima di dirsi
-- riuscita.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
  v_cat public.document_category;
begin
  -- (a) Le tabelle nuove non devono essere scrivibili oltre quanto concesso.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'document_tag_links'
    and grantee in ('anon', 'authenticated', 'public')
    and privilege_type = 'UPDATE';
  if v_bad is not null then
    raise exception 'i collegamenti delle etichette risultano modificabili: %', v_bad;
  end if;

  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('document_tags', 'document_tag_links')
    and grantee = 'anon';
  if v_bad is not null then
    raise exception 'le etichette risultano accessibili senza autenticazione: %', v_bad;
  end if;

  -- (b) La regola di classificazione fa quello che dice, sui casi che contano.
  v_cat := public.document_category_from_analysis('tax_document', 'federal');
  if v_cat is distinct from 'taxes' then
    raise exception 'la regola non classifica un documento fiscale fra le imposte (ha detto %)', v_cat;
  end if;
  v_cat := public.document_category_from_analysis('reminder', 'private');
  if v_cat is distinct from 'invoices' then
    raise exception 'la regola non classifica un sollecito privato fra le fatture (ha detto %)', v_cat;
  end if;
  v_cat := public.document_category_from_analysis('information', 'unknown');
  if v_cat is not null then
    raise exception 'la regola inventa una categoria dove non ha elementi (ha detto %)', v_cat;
  end if;

  -- (c) Le conversioni difensive non devono sollevare su un valore sbagliato.
  if public.try_date('non è una data') is not null then
    raise exception 'try_date non torna NULL su un testo non convertibile';
  end if;
  if public.try_numeric('12,50 CHF') is not null then
    raise exception 'try_numeric non torna NULL su un testo non convertibile';
  end if;
end $$;

-- >>>>>>>>>>>>>>>>>>>>  0018_calendar_notifications  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- AI-Swisse — 0018 CALENDARIO E NOTIFICHE
--
-- Il Work Hub sa CHE COSA c'è da fare. Questa migrazione aggiunge QUANDO lo si
-- vede nel tempo e CHE COSA non si può permettere di dimenticare.
--
-- IL PRINCIPIO, E CIÒ CHE NE DERIVA PER LO SCHEMA
-- La fonte di verità del lavoro resta `tasks`. Il calendario è una PROIEZIONE:
-- qui non esiste nessuna tabella che contenga titolo, scadenza o stato di
-- un'attività. `calendar_event_links` contiene solo la CORRISPONDENZA fra una
-- task e l'evento che la rappresenta presso un provider — un identificativo e
-- un'impronta, non una copia. Se domani qualcuno volesse leggere «quali
-- scadenze ha l'azienda» da queste tabelle non ci riuscirebbe, ed è voluto:
-- due posti in cui vive una scadenza sono due scadenze che possono divergere.
--
-- LE GARANZIE CHE STANNO QUI E NON NEL BROWSER
--   1. I TOKEN del calendario sono irraggiungibili dal client: nessun GRANT e
--      nessuna policy su `calendar_connection_secrets`, esattamente come per la
--      posta (0013).
--   2. UNA NOTIFICA È PERSONALE. La RLS filtra per `user_id = auth.uid()`, non
--      per azienda: due colleghi della stessa azienda non si leggono le
--      notifiche a vicenda.
--   3. LE PREFERENZE SONO PERSONALI E LE SCRIVE SOLO IL LORO PROPRIETARIO. Un
--      amministratore non può accendere le email a un collega: il consenso a
--      essere contattati non è delegabile, e qui non lo è tecnicamente.
--   4. NESSUNO SI FABBRICA UNA NOTIFICA. Il client non ha alcun permesso di
--      scrittura su `notifications`: le creano i trigger e il worker. «Segna
--      come letta» passa da una funzione, non da un update.
--   5. LA CODA DI SINCRONIZZAZIONE È DEL SERVER. Il client non la vede e non la
--      scrive: la riempiono i trigger su `tasks`, la svuota una Edge Function.
--   6. L'IDEMPOTENZA È UN VINCOLO, NON UNA CONDIZIONE NEL CODICE.
--      `unique (connection_id, task_id)` su `calendar_event_links` e
--      `unique (task_id)` su `calendar_sync_queue`: un worker eseguito due
--      volte non può creare due eventi, qualunque cosa faccia il codice.
--
-- ⚠️ VINCOLO SUI VALORI ENUM (lezione della 0015, sorvegliata da `db:bundle`)
-- Tutti gli enum di questo file nascono con `create type … as enum (…)`, quindi
-- sono utilizzabili subito. NESSUN `alter type … add value` compare qui: un
-- valore aggiunto non sarebbe usabile nella stessa transazione, e `full-setup.sql`
-- concatena le migrazioni in una transazione sola.
--
-- ⚠️ REVOKE PRIMA DEI GRANT (lezione della 0014)
-- Su Supabase ogni tabella nuova di `public` nasce con i permessi di TABELLA
-- completi per `anon` e `authenticated`. Un grant scritto dopo AGGIUNGE
-- privilegi: non ne toglie. Ogni tabella qui sotto passa da `revoke all`.
--
-- Questa migrazione è RIESEGUIBILE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum
-- ---------------------------------------------------------------------------

-- Provider di calendario. Enum PROPRIO e non riuso di `email_provider`: sono
-- due domini diversi che oggi hanno gli stessi due valori per coincidenza.
-- Legarli significherebbe che aggiungere CalDAV al calendario aggiunge CalDAV
-- anche alla posta.
do $$ begin create type public.calendar_provider as enum ('google', 'microsoft');
exception when duplicate_object then null; end $$;

do $$ begin create type public.calendar_connection_status as enum
  ('active', 'reauth_required', 'error', 'disconnected');
exception when duplicate_object then null; end $$;

-- Stato della corrispondenza fra una task e il suo evento presso il provider.
-- `pending` = la task è cambiata e l'evento non è ancora allineato; è uno stato
-- normale, non un guasto.
do $$ begin create type public.calendar_link_status as enum ('pending', 'synced', 'failed');
exception when duplicate_object then null; end $$;

-- I tipi di notifica della versione 1. Sette, non cinquanta: ognuno corrisponde
-- a una frase che una persona può leggere e a un'azione che può compiere.
do $$ begin create type public.notification_type as enum (
  'task_assigned',
  'task_due_soon',
  'task_due_today',
  'task_overdue',
  'unassigned_task_due_soon',
  'calendar_sync_failed',
  'calendar_reauth_required'
);
exception when duplicate_object then null; end $$;

-- Canali di CONSEGNA. L'in-app non compare: l'in-app È la notifica, la riga di
-- `notifications`. Elencarlo come canale creerebbe una consegna che non ha
-- niente da consegnare.
do $$ begin create type public.notification_channel as enum ('email');
exception when duplicate_object then null; end $$;

do $$ begin create type public.notification_delivery_status as enum
  ('pending', 'sending', 'sent', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. notifications — il segnale
--
-- `payload` contiene SOLO ciò che serve a scrivere la frase: titolo
-- dell'attività, scadenza, priorità. Mai il corpo di un documento, mai il testo
-- di una email, mai un allegato, mai un prompt. La regola non è una convenzione
-- del codice: una notifica finisce in un'email, e un'email esce dal perimetro.
--
-- `dedupe_key` è NULLABILE, e l'unicità è un indice PARZIALE. Le due famiglie
-- di notifiche hanno bisogni opposti:
--   · quelle generate da un CRON (i promemoria) devono poter essere ritentate
--     senza duplicare: hanno una chiave, e l'unicità la impone il database;
--   · quelle generate da un EVENTO (una riassegnazione) non si ritentano mai —
--     il trigger scatta una volta per UPDATE — e due assegnazioni successive
--     sono due fatti distinti che meritano due notifiche.
-- Dare una chiave finta anche alle seconde avrebbe significato inventarla con
-- un timestamp, cioè scrivere un vincolo che non vincola niente.
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  -- Il DESTINATARIO. Una notifica appartiene a una persona, non a un'azienda:
  -- è la ragione per cui la RLS qui filtra su `user_id` e non su membership.
  user_id      uuid not null references auth.users (id) on delete cascade,
  type         public.notification_type not null,
  -- A che cosa si riferisce. Testo e non enum: `entity_type` non governa alcuna
  -- decisione di autorizzazione, serve solo a comporre il collegamento.
  entity_type  text not null check (entity_type in ('task', 'calendar_connection')),
  entity_id    uuid not null,
  payload      jsonb not null default '{}'::jsonb,
  dedupe_key   text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- L'idempotenza dei promemoria. Un job eseguito due volte non crea due righe.
create unique index if not exists uq_notifications_dedupe
  on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
-- La lista della campanella: le mie, di questa azienda, dalla più recente.
create index if not exists idx_notifications_inbox
  on public.notifications (user_id, company_id, created_at desc);
-- Il conteggio del badge, che si fa a ogni caricamento di pagina.
create index if not exists idx_notifications_unread
  on public.notifications (user_id, company_id) where read_at is null;

comment on table public.notifications is
  'Notifiche PERSONALI. La RLS filtra per user_id: due colleghi della stessa azienda non si leggono le notifiche a vicenda. Il client non ha alcun permesso di scrittura.';
comment on column public.notifications.payload is
  'Solo metadati per comporre la frase (titolo, scadenza, priorità). MAI corpo di documenti o email: una notifica può uscire dal perimetro via email.';
comment on column public.notifications.dedupe_key is
  'Chiave di deduplicazione per le notifiche generate da un job periodico. NULL per quelle generate da un evento, che non si ritentano e non vanno deduplicate.';

-- ---------------------------------------------------------------------------
-- 3. notification_preferences — il consenso, per persona e per azienda
--
-- Chiave composta (company_id, user_id): la stessa persona può volere le email
-- per il mandato che segue da vicino e non per l'altro. È lo stesso principio
-- per cui una connessione di calendario è personale E aziendale.
--
-- Il default è dichiarato QUI e non nel codice applicativo: in-app acceso,
-- email SPENTA. L'email è un canale che esce dal prodotto e richiede una scelta
-- esplicita; accenderla per impostazione predefinita significherebbe decidere
-- al posto di qualcuno.
-- ---------------------------------------------------------------------------
create table if not exists public.notification_preferences (
  company_id            uuid not null references public.companies (id) on delete cascade,
  user_id               uuid not null references auth.users (id) on delete cascade,

  in_app_enabled        boolean not null default true,
  email_enabled         boolean not null default false,

  remind_7_days         boolean not null default true,
  remind_1_day          boolean not null default true,
  remind_due_day        boolean not null default true,
  remind_overdue        boolean not null default true,

  -- Fuso IANA. Il default è quello del mercato, ma è un DEFAULT e non una
  -- costante sparsa nel codice: chi lavora da altrove lo cambia qui, e tutto il
  -- motore dei promemoria lo legge da questa colonna.
  timezone              text not null default 'Europe/Zurich',

  -- La lingua in cui il SERVER scrive ciò che esce dal prodotto: la descrizione
  -- dell'evento sul calendario esterno e il testo delle email di promemoria.
  -- Non è una preferenza in più da compilare — la imposta l'interfaccia con la
  -- lingua in uso — ma deve stare nel database: un worker che gira alle 8 del
  -- mattino non ha una sessione da cui dedurla, e scrivere in italiano a un
  -- cliente germanofono perché «l'italiano è la lingua di riferimento» sarebbe
  -- un ripiego silenzioso.
  locale                text not null default 'it' check (locale in ('it', 'de', 'fr')),

  -- §96 — il titolo dell'attività nel calendario ESTERNO. Acceso: un evento che
  -- non dice cosa c'è da fare non serve a niente. Chi tiene il calendario
  -- condiviso con un assistente può spegnerlo, e l'evento diventa generico.
  show_task_title       boolean not null default true,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  primary key (company_id, user_id)
);

comment on table public.notification_preferences is
  'Preferenze PERSONALI per azienda. Solo il proprietario le scrive: un amministratore non può accendere le email a un collega, perché il consenso a essere contattati non è delegabile.';
comment on column public.notification_preferences.timezone is
  'Fuso orario IANA. I promemoria si generano al mattino LOCALE di questa zona, non a un''ora fissa UTC.';

-- ---------------------------------------------------------------------------
-- 4. notification_deliveries — la consegna, separata dal segnale
--
-- Perché due tabelle e non una colonna `email_sent`: una notifica È un fatto
-- avvenuto, una consegna è un tentativo che può fallire, essere ritentato e
-- fallire di nuovo. Metterli nella stessa riga significa o perdere la storia
-- dei tentativi o riscrivere il fatto ogni volta che il tentativo cambia stato.
--
-- Il vincolo unico (notification_id, channel) è l'idempotenza: un worker
-- eseguito tre volte non produce tre email.
-- ---------------------------------------------------------------------------
create table if not exists public.notification_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  notification_id     uuid not null references public.notifications (id) on delete cascade,
  channel             public.notification_channel not null,
  status              public.notification_delivery_status not null default 'pending',
  attempts            integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  -- Identificativo restituito dal provider: è ciò che permette di rispondere a
  -- «questa email è davvero partita?» senza indovinare.
  provider_message_id text,
  error_code          text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (notification_id, channel)
);
create index if not exists idx_deliveries_due
  on public.notification_deliveries (next_attempt_at)
  where status in ('pending', 'sending');

comment on table public.notification_deliveries is
  'Tentativi di consegna su un canale esterno. Separata da `notifications` perché un fatto avvenuto e un tentativo che può fallire sono cose diverse.';

-- ---------------------------------------------------------------------------
-- 5. calendar_connections — il calendario collegato, di UNA persona
--
-- ⚠️ La differenza più importante rispetto a `email_connections`: là la
-- connessione è dell'AZIENDA (una casella aziendale la collega un
-- amministratore e serve a tutti), qui è della PERSONA. Andrea collega il
-- proprio Google, Marco il proprio Outlook, e ognuno riceve sul proprio
-- calendario le attività di cui è responsabile. Da qui il vincolo unico su
-- (company_id, user_id, provider) e una RLS che filtra su `user_id`.
--
-- `provider_calendar_id` NON è un dettaglio recuperabile: con lo scope a
-- privilegio minimo di Google (`calendar.app.created`) l'applicazione NON può
-- elencare i calendari dell'utente — `calendarList.list` non è fra i metodi che
-- quello scope autorizza. L'unico modo di ritrovare il proprio calendario è
-- averne conservato l'identificativo. Se questa colonna si perdesse, il
-- calendario resterebbe nell'account dell'utente e AI-Swisse ne creerebbe un
-- secondo: è la ragione per cui non è una colonna «di comodo».
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_connections (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies (id) on delete cascade,
  user_id                  uuid not null references auth.users (id) on delete cascade,
  provider                 public.calendar_provider not null,
  -- Identità STABILE dell'account presso il provider (Google `sub`, Microsoft
  -- `id`), non l'indirizzo: un indirizzo può essere un alias o cambiare.
  provider_account_id      text not null,
  email_address            text not null,

  -- Il calendario dedicato. NULL finché non è stato creato: uno stato legittimo
  -- fra il consenso e la prima sincronizzazione, non un dato mancante.
  provider_calendar_id     text,
  calendar_name            text,

  status                   public.calendar_connection_status not null default 'active',
  scopes                   text[] not null default '{}',
  sync_enabled             boolean not null default true,

  initial_sync_completed_at timestamptz,
  last_sync_at             timestamptz,
  last_successful_sync_at  timestamptz,
  last_error_code          text,
  last_error_at            timestamptz,

  -- Lock a SCADENZA, non booleano (stessa lezione della 0013): un processo
  -- morto non deve bloccare la sincronizzazione per sempre.
  sync_lease_id            uuid,
  sync_lease_until         timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  unique (company_id, user_id, provider)
);
create index if not exists idx_cal_conn_user on public.calendar_connections (user_id, company_id);
create index if not exists idx_cal_conn_active on public.calendar_connections (company_id)
  where status = 'active' and sync_enabled;

comment on table public.calendar_connections is
  'Calendario esterno collegato da UNA persona per UNA azienda. I token non stanno qui: vedi calendar_connection_secrets.';
comment on column public.calendar_connections.provider_calendar_id is
  'Identificativo del calendario dedicato presso il provider. Con lo scope calendar.app.created di Google l''applicazione non può elencare i calendari: senza questo valore il calendario non è più ritrovabile e ne verrebbe creato un secondo.';

-- ---------------------------------------------------------------------------
-- 6. calendar_connection_secrets — token OAuth, SOLO server
--
-- Stesso modello di minaccia della 0013, e stessa conclusione: nessun GRANT,
-- nessuna policy, RLS attiva. Un `select('*')` scritto per errore in un service
-- non restituisce una riga vuota: fallisce con 42501.
-- I token sono cifrati con AES-256-GCM e la chiave vive in un secret della Edge
-- Function, non nel database. L'AAD è l'id della connessione: un ciphertext
-- copiato su un'altra riga non si decifra.
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_connection_secrets (
  connection_id           uuid primary key references public.calendar_connections (id) on delete cascade,
  company_id              uuid not null references public.companies (id) on delete cascade,

  access_token_ct         bytea,
  access_token_iv         bytea,
  access_token_expires_at timestamptz,
  refresh_token_ct        bytea,
  refresh_token_iv        bytea,

  key_version             integer not null default 1,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.calendar_connection_secrets is
  'Token OAuth del calendario, cifrati. Nessuna policy e nessun GRANT: irraggiungibile dal ruolo authenticated. La chiave di cifratura è un secret della Edge Function.';

-- ---------------------------------------------------------------------------
-- 7. calendar_oauth_states — stato anti-CSRF, con TRIPLO legame
--
-- Rispetto alla 0013 c'è un legame in più che qui è indispensabile: l'UTENTE.
-- Una connessione di calendario è personale, quindi il callback deve sapere non
-- solo per quale azienda ma per quale PERSONA è stato dato il consenso — e non
-- può leggerlo dalla query string, che la decide chi chiama.
--
-- In tabella sta lo SHA-256 dello state, non lo state.
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_oauth_states (
  id                uuid primary key default gen_random_uuid(),
  state_hash        text not null unique,
  company_id        uuid not null references public.companies (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  provider          public.calendar_provider not null,
  code_verifier_ct  bytea,
  code_verifier_iv  bytea,
  key_version       integer not null default 1,
  redirect_path     text,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  consumed_at       timestamptz
);
create index if not exists idx_cal_oauth_states_expiry on public.calendar_oauth_states (expires_at);

-- ---------------------------------------------------------------------------
-- 8. calendar_event_links — la corrispondenza, non una copia
--
-- Contiene un identificativo e un'impronta. NON contiene il titolo, la scadenza
-- né la priorità: quelli stanno in `tasks` e da lì si leggono ogni volta.
--
-- `content_hash` è l'impronta di ciò che è stato scritto PRESSO IL PROVIDER
-- l'ultima volta. Serve a non riscrivere un evento identico a ogni giro della
-- riconciliazione: senza, un controllo periodico su cinquanta attività
-- diventerebbe cinquanta chiamate all'API ogni volta.
--
-- `unique (connection_id, task_id)` è l'idempotenza locale: la stessa attività
-- non può avere due eventi sullo stesso calendario, qualunque cosa faccia il
-- codice del worker.
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_event_links (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  -- Ridondante rispetto alla connessione, ma la RLS deve poter filtrare per
  -- persona senza un join: la ridondanza qui è una scelta di sicurezza.
  user_id              uuid not null references auth.users (id) on delete cascade,
  connection_id        uuid not null references public.calendar_connections (id) on delete cascade,
  task_id              uuid not null references public.tasks (id) on delete cascade,

  provider_event_id    text not null,
  provider_calendar_id text not null,

  sync_status          public.calendar_link_status not null default 'pending',
  content_hash         text,
  last_synced_at       timestamptz,
  error_code           text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (connection_id, task_id)
);
create index if not exists idx_cal_links_task on public.calendar_event_links (task_id);
create index if not exists idx_cal_links_conn on public.calendar_event_links (connection_id, sync_status);

comment on table public.calendar_event_links is
  'Corrispondenza fra un''attività e l''evento che la rappresenta presso un provider. Contiene un identificativo e un''impronta, mai una copia del titolo o della scadenza.';

-- ---------------------------------------------------------------------------
-- 9. calendar_sync_queue — l'outbox
--
-- Perché una coda e non una chiamata dentro il salvataggio della task: se la
-- seconda metà di `await updateTask(); await googleUpdate();` fallisce, la task
-- è salvata e il calendario no, e nessuno lo sa. Con la coda la task è salvata
-- SEMPRE e la sincronizzazione è un lavoro che può essere ritentato.
--
-- `unique (task_id)` è la COALESCENZA: un'attività modificata otto volte in un
-- minuto non produce otto chiamate all'API. Non conta quante volte è cambiata,
-- conta com'è adesso.
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_sync_queue (
  task_id         uuid primary key references public.tasks (id) on delete cascade,
  company_id      uuid not null references public.companies (id) on delete cascade,
  requested_at    timestamptz not null default now(),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- Lease a scadenza, come per le connessioni: un worker ucciso a metà non
  -- blocca la riga per sempre.
  locked_until    timestamptz,
  lock_id         uuid,
  last_error      text
);
create index if not exists idx_cal_queue_due on public.calendar_sync_queue (next_attempt_at)
  where locked_until is null;

comment on table public.calendar_sync_queue is
  'Outbox della sincronizzazione. Una riga per attività: chiave primaria su task_id, quindi otto modifiche rapide diventano una sola sincronizzazione.';

-- ---------------------------------------------------------------------------
-- 10. calendar_sync_runs — osservabilità
--
-- Serve a rispondere a «funziona?» con dei numeri invece che con un'impressione.
-- Non contiene titoli di attività né identificativi di evento: contiene conteggi.
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies (id) on delete cascade,
  connection_id uuid references public.calendar_connections (id) on delete set null,
  provider      public.calendar_provider,
  trigger       text not null,
  status        text not null,
  upserted      integer not null default 0,
  deleted       integer not null default 0,
  failures      integer not null default 0,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  duration_ms   integer,
  error_code    text
);
create index if not exists idx_cal_runs_conn on public.calendar_sync_runs (connection_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 11. Indice per il motore dei promemoria
--
-- Gli indici della 0016 iniziano tutti con `company_id`, perché servono alle
-- liste di UNA azienda. Il worker dei promemoria fa la domanda opposta — «quali
-- attività di CHIUNQUE scadono in questa finestra» — e su quegli indici non
-- potrebbe appoggiarsi. Non è un duplicato: cambia la colonna guida.
-- `assignee_user_id` è nell'indice e non nella condizione perché servono
-- entrambi i casi: il promemoria a chi è responsabile, e l'allarme su
-- un'attività urgente che responsabile non ne ha (§32).
-- ---------------------------------------------------------------------------
create index if not exists idx_tasks_due_global
  on public.tasks (due_date, assignee_user_id)
  where status <> 'completed' and archived_at is null and due_date is not null;

-- ---------------------------------------------------------------------------
-- 12. Il guardiano delle notifiche
--
-- Due cose che il database non può lasciar decidere a chi scrive:
--   · il destinatario dev'essere MEMBRO dell'azienda della notifica. Senza
--     questo controllo una notifica potrebbe raccontare a un estraneo il titolo
--     di un'attività altrui — che è esattamente il dato che il payload contiene;
--   · `read_at` non si sposta all'indietro. «L'ho già letta» è un fatto.
-- ---------------------------------------------------------------------------
create or replace function public.notifications_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.company_members m
    where m.company_id = new.company_id and m.user_id = new.user_id
  ) then
    raise exception 'notification_recipient_not_member'
      using errcode = '23514',
            hint = 'Il destinatario non appartiene a questa azienda.';
  end if;

  if tg_op = 'UPDATE' and old.read_at is not null then
    new.read_at := old.read_at;
  end if;

  return new;
end $$;

drop trigger if exists trg_notifications_guard on public.notifications;
create trigger trg_notifications_guard
  before insert or update on public.notifications
  for each row execute function public.notifications_guard();

-- ---------------------------------------------------------------------------
-- 13. Il guardiano delle preferenze
--
-- Il fuso orario si VALIDA, non si spera. Una stringa come «Europa/Zurigo»
-- passerebbe un check di formato e farebbe fallire ogni calcolo del worker con
-- un errore che nessuno collegherebbe a un campo di testo compilato mesi prima.
-- Qui il database prova a usarla: se non è un fuso IANA, la riga non entra.
--
-- L'identità la impone anche la policy, ma il trigger RIFIUTA invece di
-- correggere in silenzio: è la lezione di `comments_guard` (0016). La
-- condizione lascia passare il service role (`auth.uid()` nullo).
-- ---------------------------------------------------------------------------
create or replace function public.notification_preferences_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe timestamp;
begin
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    raise exception 'preferences_not_own'
      using errcode = '42501',
            hint = 'Le preferenze di notifica le imposta solo il loro proprietario.';
  end if;

  if not exists (
    select 1 from public.company_members m
    where m.company_id = new.company_id and m.user_id = new.user_id
  ) then
    raise exception 'preferences_not_member'
      using errcode = '23514',
            hint = 'La persona non appartiene a questa azienda.';
  end if;

  begin
    v_probe := now() at time zone new.timezone;
  exception when others then
    raise exception 'invalid_timezone'
      using errcode = '23514',
            hint = 'Il fuso orario deve essere un identificativo IANA, per esempio Europe/Zurich.';
  end;

  return new;
end $$;

drop trigger if exists trg_notification_preferences_guard on public.notification_preferences;
create trigger trg_notification_preferences_guard
  before insert or update on public.notification_preferences
  for each row execute function public.notification_preferences_guard();

drop trigger if exists trg_notification_preferences_updated on public.notification_preferences;
create trigger trg_notification_preferences_updated
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

drop trigger if exists trg_deliveries_updated on public.notification_deliveries;
create trigger trg_deliveries_updated
  before update on public.notification_deliveries
  for each row execute function public.set_updated_at();

drop trigger if exists trg_cal_conn_updated on public.calendar_connections;
create trigger trg_cal_conn_updated
  before update on public.calendar_connections
  for each row execute function public.set_updated_at();

drop trigger if exists trg_cal_secrets_updated on public.calendar_connection_secrets;
create trigger trg_cal_secrets_updated
  before update on public.calendar_connection_secrets
  for each row execute function public.set_updated_at();

drop trigger if exists trg_cal_links_updated on public.calendar_event_links;
create trigger trg_cal_links_updated
  before update on public.calendar_event_links
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 14. Il guardiano dei collegamenti evento
--
-- Un collegamento deve appartenere all'azienda E alla persona della propria
-- connessione. Senza questo controllo, chi potesse scrivere qui potrebbe
-- agganciare l'evento di una task altrui alla propria connessione — e il worker,
-- che gira con il service role, lo scriverebbe sul proprio calendario.
-- È la stessa disciplina della 0017: una funzione che scavalca la RLS deve
-- difendersi da sola, non fidarsi di una policy scritta altrove.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_links_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn record;
  v_task_company uuid;
begin
  select c.company_id, c.user_id into v_conn
  from public.calendar_connections c where c.id = new.connection_id;

  if v_conn.company_id is null
     or v_conn.company_id is distinct from new.company_id
     or v_conn.user_id is distinct from new.user_id then
    raise exception 'calendar_link_connection_mismatch'
      using errcode = '23514',
            hint = 'Il collegamento non appartiene alla connessione indicata.';
  end if;

  select t.company_id into v_task_company from public.tasks t where t.id = new.task_id;
  if v_task_company is null or v_task_company is distinct from new.company_id then
    raise exception 'calendar_link_task_mismatch'
      using errcode = '23514',
            hint = 'L''attività non appartiene a questa azienda.';
  end if;

  return new;
end $$;

drop trigger if exists trg_cal_links_guard on public.calendar_event_links;
create trigger trg_cal_links_guard
  before insert or update on public.calendar_event_links
  for each row execute function public.calendar_links_guard();

-- ---------------------------------------------------------------------------
-- 15. Il trigger che riempie la coda
--
-- Scatta sui soli campi che cambiano ciò che il calendario deve mostrare.
-- `description` non c'è: la descrizione dell'evento esterno non la contiene
-- (§95 — nel calendario finisce il minimo indispensabile), quindi modificarla
-- non richiede una chiamata all'API.
--
-- Non si accoda nulla per le aziende che non hanno alcun calendario collegato:
-- sarebbero righe che il worker prenderebbe solo per scoprire che non c'è
-- niente da fare. La condizione è una lettura di un indice parziale.
--
-- ⚠️ Il cambio di ASSEGNATARIO produce UNA sola riga, non due. La coda è
-- indicizzata per attività e il worker guarda TUTTI i collegamenti esistenti di
-- quella task più la connessione che dovrebbe averne uno: l'evento del vecchio
-- responsabile viene rimosso e quello del nuovo creato nello stesso passaggio.
-- Una coda per (task, utente) avrebbe richiesto di sapere già qui chi perde
-- l'evento, cioè di duplicare nel trigger la logica dello stato desiderato.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_enqueue_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relevant boolean;
begin
  if tg_op = 'INSERT' then
    v_relevant := true;
  else
    v_relevant :=
      new.title            is distinct from old.title
      or new.due_date      is distinct from old.due_date
      or new.assignee_user_id is distinct from old.assignee_user_id
      or new.status        is distinct from old.status
      or new.priority      is distinct from old.priority
      or (new.archived_at is not null) is distinct from (old.archived_at is not null);
  end if;

  if not v_relevant then return new; end if;

  if not exists (
    select 1 from public.calendar_connections c
    where c.company_id = new.company_id and c.status = 'active' and c.sync_enabled
  ) then
    return new;
  end if;

  insert into public.calendar_sync_queue (task_id, company_id, requested_at, attempts, next_attempt_at)
  values (new.id, new.company_id, now(), 0, now())
  on conflict (task_id) do update
    set requested_at    = now(),
        -- I tentativi ripartono da zero: il contenuto è cambiato, quindi il
        -- fallimento precedente riguardava una versione che non esiste più.
        attempts        = 0,
        next_attempt_at = now(),
        last_error      = null;

  return new;
end $$;

drop trigger if exists trg_tasks_calendar_enqueue on public.tasks;
create trigger trg_tasks_calendar_enqueue
  after insert or update on public.tasks
  for each row execute function public.calendar_enqueue_task();

-- ---------------------------------------------------------------------------
-- 16. Il trigger che avvisa chi riceve un'attività
--
-- Scatta solo quando il responsabile CAMBIA e diventa qualcuno. Non avvisa chi
-- si assegna un'attività da sé: sa già di averlo fatto, e una notifica per una
-- cosa che si è appena fatti da soli insegna a ignorare la campanella.
--
-- Il `payload` porta titolo e scadenza. Il collegamento lo compone la
-- schermata: mettere qui un URL significherebbe conservare un dominio che
-- domani potrebbe cambiare.
-- ---------------------------------------------------------------------------
create or replace function public.tasks_notify_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefs boolean;
begin
  if new.assignee_user_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_user_id is not distinct from old.assignee_user_id then
    return new;
  end if;
  if auth.uid() is not null and auth.uid() = new.assignee_user_id then return new; end if;
  -- Un'attività già conclusa o archiviata non genera lavoro per nessuno.
  if new.status = 'completed' or new.archived_at is not null then return new; end if;

  -- Le preferenze possono non esistere: in quel caso valgono i default, e il
  -- default dell'in-app è ACCESO. `coalesce` su una riga assente, non su un
  -- valore nullo — sono due assenze diverse.
  select p.in_app_enabled into v_prefs
  from public.notification_preferences p
  where p.company_id = new.company_id and p.user_id = new.assignee_user_id;
  if v_prefs is not null and v_prefs = false then return new; end if;

  insert into public.notifications (company_id, user_id, type, entity_type, entity_id, payload)
  values (
    new.company_id, new.assignee_user_id, 'task_assigned', 'task', new.id,
    jsonb_build_object(
      'title', new.title,
      'dueDate', new.due_date,
      'priority', new.priority
    )
  );

  return new;
end $$;

drop trigger if exists trg_tasks_notify_assignment on public.tasks;
create trigger trg_tasks_notify_assignment
  after insert or update on public.tasks
  for each row execute function public.tasks_notify_assignment();

-- ---------------------------------------------------------------------------
-- 17. Il modello di lettura del calendario interno
--
-- Restituisce SOLO ciò che una griglia mensile mostra: niente checklist, niente
-- commenti, niente storico, niente analisi. Una vista mensile con quaranta
-- attività non deve scaricare quaranta analisi documentali per disegnare
-- quaranta righe di testo.
--
-- Le SCADUTE entrano sempre, anche quando cadono fuori dall'intervallo
-- richiesto: un'attività in ritardo non smette di esserlo perché si è girata
-- pagina al mese. È la stessa ragione per cui la Home mostra sempre le priorità
-- alte (§ dedup della 0016): nascondere un problema perché sta in un'altra
-- casella non è filtrare, è perderlo.
--
-- `security invoker` (il default): la RLS di `tasks` continua ad applicarsi.
-- Il filtro esplicito su `company_id` la accompagna, non la sostituisce.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_tasks(
  p_company_id      uuid,
  p_from            date,
  p_to              date,
  p_mine            boolean default true,
  p_status          public.task_status default null,
  p_priority        public.task_priority default null,
  p_assignee        uuid default null,
  p_include_overdue boolean default true,
  p_limit           integer default 500
)
returns table (
  id uuid, title text, due_date date,
  priority public.task_priority, status public.task_status, source public.task_source,
  assignee_user_id uuid, assignee_name text, document_id uuid
)
language sql
stable
set search_path = ''
as $$
  select
    t.id, t.title, t.due_date, t.priority, t.status, t.source,
    t.assignee_user_id,
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as assignee_name,
    t.document_id
  from public.tasks t
  left join public.profiles p on p.id = t.assignee_user_id
  where t.company_id = p_company_id
    and t.archived_at is null
    and t.due_date is not null
    and (
      (t.due_date >= p_from and t.due_date <= p_to)
      -- ⚠️ `<=` e non `<`. Il database vive in UTC, l'utente in Europe/Zurich:
      -- alle 00:30 locali di giovedì, per Postgres è ancora mercoledì, e
      -- un'attività scaduta mercoledì non rientrerebbe in `due_date < current_date`.
      -- Un giorno di margine costa una riga in più e chiude la finestra.
      -- Qui si SELEZIONA soltanto: che cosa sia «in ritardo» lo decide
      -- `isOverdue()` in `taskFormat`, la stessa funzione che usano Attività e
      -- Panoramica. Due definizioni di «scaduta» sono due schermate che prima o
      -- poi si contraddicono.
      or (coalesce(p_include_overdue, true)
          and t.status <> 'completed'
          and t.due_date <= current_date)
    )
    and (not coalesce(p_mine, false) or t.assignee_user_id = auth.uid())
    and (p_status   is null or t.status = p_status)
    and (p_priority is null or t.priority = p_priority)
    and (p_assignee is null or t.assignee_user_id = p_assignee)
  order by t.due_date asc, case t.priority when 'high' then 0 when 'medium' then 1 else 2 end, t.created_at desc
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

revoke all on function public.calendar_tasks(uuid, date, date, boolean, public.task_status, public.task_priority, uuid, boolean, integer) from public, anon;
grant execute on function public.calendar_tasks(uuid, date, date, boolean, public.task_status, public.task_priority, uuid, boolean, integer) to authenticated;

-- Quante attività non hanno scadenza (§21). Si mostra il numero e si rimanda
-- ad Attività: non si inventa una data per farle stare in una casella.
create or replace function public.calendar_undated_count(
  p_company_id uuid,
  p_mine       boolean default true
)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.tasks t
  where t.company_id = p_company_id
    and t.archived_at is null
    and t.due_date is null
    and t.status <> 'completed'
    and (not coalesce(p_mine, false) or t.assignee_user_id = auth.uid());
$$;

revoke all on function public.calendar_undated_count(uuid, boolean) from public, anon;
grant execute on function public.calendar_undated_count(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 18. Notifiche: lettura e conteggio
--
-- «Segna come letta» passa da una funzione e non da un `update`: così il client
-- non ha alcun permesso di scrittura sulla tabella, e non esiste un percorso in
-- cui una notifica venga alterata in qualcosa di diverso da «letta».
-- `security invoker`: la RLS filtra già per utente. Il filtro su `auth.uid()`
-- scritto qui dentro la accompagna — un'ora spesa a scrivere due volte la stessa
-- condizione costa meno di un pomeriggio a capire perché non c'era.
-- ---------------------------------------------------------------------------
create or replace function public.notifications_mark_read(p_ids uuid[])
returns integer
language sql
volatile
set search_path = ''
as $$
  with updated as (
    update public.notifications n
       set read_at = now()
     where n.id = any(coalesce(p_ids, '{}'::uuid[]))
       and n.user_id = auth.uid()
       and n.read_at is null
    returning n.id
  )
  select count(*)::integer from updated;
$$;

create or replace function public.notifications_mark_all_read(p_company_id uuid)
returns integer
language sql
volatile
set search_path = ''
as $$
  with updated as (
    update public.notifications n
       set read_at = now()
     where n.company_id = p_company_id
       and n.user_id = auth.uid()
       and n.read_at is null
    returning n.id
  )
  select count(*)::integer from updated;
$$;

create or replace function public.notifications_unread_count(p_company_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.notifications n
  where n.company_id = p_company_id
    and n.user_id = auth.uid()
    and n.read_at is null;
$$;

revoke all on function public.notifications_mark_read(uuid[])     from public, anon;
revoke all on function public.notifications_mark_all_read(uuid)   from public, anon;
revoke all on function public.notifications_unread_count(uuid)    from public, anon;
grant execute on function public.notifications_mark_read(uuid[])   to authenticated;
grant execute on function public.notifications_mark_all_read(uuid) to authenticated;
grant execute on function public.notifications_unread_count(uuid)  to authenticated;

-- ---------------------------------------------------------------------------
-- 19. La coda: prenotazione atomica di un lotto
--
-- `for update skip locked` è ciò che permette a due esecuzioni sovrapposte del
-- worker di lavorare senza pestarsi i piedi e senza che una resti ferma ad
-- aspettare l'altra. Il `locked_until` sopravvive alla transazione: se
-- l'isolate viene ucciso a metà (i 150 secondi di Supabase), la riga si libera
-- da sola alla scadenza invece di restare presa per sempre.
--
-- `security definer` perché la tabella non ha alcun permesso per il client, e
-- l'esecuzione è concessa al solo `service_role`.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_queue_claim(
  p_limit        integer default 20,
  p_lock_seconds integer default 120,
  -- Restringe la prenotazione a un insieme di attività. Serve al pulsante
  -- «Sincronizza ora»: senza, prenoterebbe le righe più VECCHIE della coda —
  -- che possono essere di chiunque — e il messaggio «N eventi aggiornati»
  -- conterebbe il lavoro di qualcun altro. NULL = tutta la coda, che è ciò che
  -- serve allo scheduler.
  p_task_ids     uuid[] default null
)
returns table (task_id uuid, company_id uuid, attempts integer, lock_id uuid)
language sql
security definer
set search_path = ''
as $$
  with candidati as (
    select q.task_id as tid
    from public.calendar_sync_queue q
    where q.next_attempt_at <= now()
      and (q.locked_until is null or q.locked_until < now())
      and (p_task_ids is null or q.task_id = any(p_task_ids))
    order by q.next_attempt_at asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ),
  aggiornati as (
    update public.calendar_sync_queue q
       set locked_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lock_seconds, 120), 600))),
           -- Un lock per RIGA, non per lotto: chi rilascia una riga non può
           -- liberare per sbaglio quelle che un'altra esecuzione sta trattando.
           lock_id      = gen_random_uuid()
      from candidati c
     where q.task_id = c.tid
    returning q.task_id, q.company_id, q.attempts, q.lock_id
  )
  select a.task_id, a.company_id, a.attempts, a.lock_id from aggiornati a;
$$;

revoke all on function public.calendar_queue_claim(integer, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.calendar_queue_claim(integer, integer, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 20. RLS
-- ---------------------------------------------------------------------------
alter table public.notifications                enable row level security;
alter table public.notification_preferences     enable row level security;
alter table public.notification_deliveries      enable row level security;
alter table public.calendar_connections         enable row level security;
alter table public.calendar_connection_secrets  enable row level security;
alter table public.calendar_oauth_states        enable row level security;
alter table public.calendar_event_links         enable row level security;
alter table public.calendar_sync_queue          enable row level security;
alter table public.calendar_sync_runs           enable row level security;

-- Prima si toglie TUTTO. `service_role` non compare: è il ruolo con cui
-- scrivono le Edge Function e deve conservare i propri permessi.
revoke all on public.notifications               from anon, authenticated, public;
revoke all on public.notification_preferences    from anon, authenticated, public;
revoke all on public.notification_deliveries     from anon, authenticated, public;
revoke all on public.calendar_connections        from anon, authenticated, public;
revoke all on public.calendar_connection_secrets from anon, authenticated, public;
revoke all on public.calendar_oauth_states       from anon, authenticated, public;
revoke all on public.calendar_event_links        from anon, authenticated, public;
revoke all on public.calendar_sync_queue         from anon, authenticated, public;
revoke all on public.calendar_sync_runs          from anon, authenticated, public;

-- NOTIFICHE — sola lettura. La marcatura passa dalle funzioni del punto 18.
grant select on public.notifications to authenticated;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id));
-- L'UPDATE esiste per far passare `read_at` scritto dalle funzioni, che girano
-- `security invoker`. Resta inutilizzabile dal client: non c'è alcun GRANT di
-- UPDATE sulla tabella, quindi la policy da sola non basta ad aprire nulla.
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- PREFERENZE — lettura e scrittura delle PROPRIE. Nessun DELETE: cancellare le
-- preferenze significherebbe tornare ai default senza dirlo; si modificano.
grant select, insert, update on public.notification_preferences to authenticated;

drop policy if exists prefs_select_own on public.notification_preferences;
create policy prefs_select_own on public.notification_preferences
  for select to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id));
drop policy if exists prefs_insert_own on public.notification_preferences;
create policy prefs_insert_own on public.notification_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_company_member(company_id));
drop policy if exists prefs_update_own on public.notification_preferences;
create policy prefs_update_own on public.notification_preferences
  for update to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id))
  with check (user_id = auth.uid() and public.is_company_member(company_id));

-- CONNESSIONI — solo le PROPRIE, e solo le colonne che una schermata mostra.
-- Un collega non vede la connessione di un altro: nulla nell'interfaccia ne ha
-- bisogno, e ciò che non serve non si espone (§85).
-- ⚠️ Da qui in avanti `select('*')` su questa tabella FALLISCE con «permission
-- denied for column»: è voluto, ed è il motivo per cui il service elenca le
-- colonne una per una.
grant select (
  id, company_id, user_id, provider, email_address, provider_calendar_id, calendar_name,
  status, scopes, sync_enabled, initial_sync_completed_at, last_sync_at,
  last_successful_sync_at, last_error_code, last_error_at, created_at, updated_at
) on public.calendar_connections to authenticated;

drop policy if exists cal_conn_select_own on public.calendar_connections;
create policy cal_conn_select_own on public.calendar_connections
  for select to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id));

-- COLLEGAMENTI EVENTO — sola lettura, e solo i propri: servono a dire «questa
-- attività è sul tuo calendario» e nient'altro.
grant select on public.calendar_event_links to authenticated;

drop policy if exists cal_links_select_own on public.calendar_event_links;
create policy cal_links_select_own on public.calendar_event_links
  for select to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id));

-- SEGRETI, STATI OAUTH, CODA, ESECUZIONI, CONSEGNE — nessun permesso, per
-- nessuno. Il `revoke` di sopra è già sufficiente; qui non si concede nulla.
-- Le consegne email restano fuori dalla portata del client di proposito: sapere
-- che un'email è stata inviata è un dato di esercizio, non una schermata.

-- ---------------------------------------------------------------------------
-- 21. Autoverifica
--
-- La migrazione controlla di aver ottenuto ciò che dichiara. Se un domani
-- qualcuno concedesse per sbaglio la scrittura sulle notifiche o un permesso
-- qualsiasi sui token, questa migrazione rieseguita lo direbbe subito — invece
-- di lasciar passare una falla che non produce alcun sintomo visibile finché
-- qualcuno non la sfrutta. È la lezione della 0014.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s (%s)', table_name, privilege_type), ', ')
    into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated', 'public')
     and table_name in (
       'calendar_connection_secrets', 'calendar_oauth_states',
       'calendar_sync_queue', 'calendar_sync_runs', 'notification_deliveries'
     );
  if v_bad is not null then
    raise exception 'Le tabelle di servizio del calendario non devono avere alcun permesso: %', v_bad;
  end if;

  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated', 'public')
     and table_name in ('notifications', 'calendar_event_links')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'Notifiche e collegamenti evento non devono essere scrivibili dal client: %', v_bad;
  end if;

  select string_agg(format('calendar_connections.%s (%s)', column_name, privilege_type), ', ')
    into v_bad
    from information_schema.column_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and table_name = 'calendar_connections'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'Le connessioni di calendario non devono essere scrivibili dal client: %', v_bad;
  end if;

  raise notice 'Permessi 0018 verificati: token irraggiungibili, notifiche non fabbricabili, coda del solo server.';
end $$;

-- >>>>>>>>>>>>>>>>>>>>  0019_notifications_mark_read  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- AI-Swisse — 0019 «SEGNA COME LETTA» NON FUNZIONAVA
--
-- COSA È ANDATO STORTO NELLA 0018
-- `notifications_mark_read` e `notifications_mark_all_read` erano `security
-- invoker`, cioè giravano con i permessi di CHI LE CHIAMA. Sulla tabella
-- `notifications` il ruolo `authenticated` ha soltanto `SELECT` — di proposito,
-- perché una notifica non deve essere riscrivibile dal browser — quindi l'UPDATE
-- dentro la funzione veniva respinto:
--
--     42501: permission denied for table notifications
--
-- Il risultato era che la campanella non riusciva a segnare niente come letto e
-- il badge non scendeva mai.
--
-- IL RAGIONAMENTO SBAGLIATO, PERCHÉ È LA PARTE CHE VALE LA PENA RICORDARE
-- Nella 0018 c'era scritto: «l'UPDATE esiste per far passare `read_at` scritto
-- dalle funzioni, che girano security invoker. Resta inutilizzabile dal client:
-- non c'è alcun GRANT di UPDATE sulla tabella, quindi la policy da sola non
-- basta ad aprire nulla.» La seconda metà è vera. La prima no: se la funzione
-- gira come il chiamante, allora la funzione È il chiamante, e il permesso che
-- manca al client manca anche a lei. Una policy senza il GRANT corrispondente
-- non apre niente — nemmeno a chi vorremmo che aprisse.
--
-- COME È EMERSO: `npm run test:calendar` alla PRIMA esecuzione sul database
-- reale, 3 fallimenti su 57. Non leggendo il codice e non facendo la revisione:
-- eseguendo. È la stessa lezione della 0014, dove i permessi di colonna della
-- 0013 dichiaravano nei commenti una garanzia che non era in vigore.
--
-- ⚠️ E IL TEST LO AVEVA QUASI NASCOSTO. Il controllo «Andrea non può segnare
-- come letta una notifica di Marco» PASSAVA — ma per il motivo sbagliato: la
-- chiamata falliva con 42501, `data` tornava `null`, e `Number(null)` è zero.
-- Un test che scarta l'errore e guarda solo il risultato non distingue «zero
-- righe» da «non ho potuto provarci». Corretto anche quello.
--
-- LA CORREZIONE
-- Le due funzioni diventano `security definer`. Da quel momento la RLS non le
-- filtra più, quindi la condizione `user_id = auth.uid()` scritta dentro non è
-- più una ridondanza: è L'UNICA difesa, ed è esattamente la disciplina già
-- fissata nella 0017 — una funzione che scavalca la RLS deve difendersi da sola
-- e non fidarsi di una policy scritta altrove.
--
-- Il client continua a NON avere alcun permesso di scrittura su `notifications`.
--
-- Perché una migrazione nuova e non una correzione della 0018: la 0018 è già
-- stata applicata. Un file di migrazione è il verbale di ciò che è stato
-- eseguito; riscriverlo dopo l'applicazione significherebbe che il repository e
-- il database raccontano due storie diverse. È la stessa ragione per cui la
-- 0014 esiste accanto alla 0013 invece di sostituirla.
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Le due funzioni, ora `security definer`
--
-- `set search_path = ''` resta indispensabile: una funzione `security definer`
-- gira con i privilegi del proprietario, e un search_path manipolabile dal
-- chiamante le farebbe eseguire codice altrui con quei privilegi.
--
-- Ogni condizione ha una ragione:
--   · `n.id = any(…)`      soltanto le righe indicate;
--   · `n.user_id = auth.uid()`  soltanto le PROPRIE. Senza questa riga la
--     funzione segnerebbe come lette le notifiche di chiunque, perché in
--     `security definer` la RLS non c'è più;
--   · `n.read_at is null`  «già letta» non si conta due volte, e il valore
--     originale non si sposta.
-- ---------------------------------------------------------------------------
create or replace function public.notifications_mark_read(p_ids uuid[])
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with updated as (
    update public.notifications n
       set read_at = now()
     where n.id = any(coalesce(p_ids, '{}'::uuid[]))
       and n.user_id = auth.uid()
       and n.read_at is null
    returning n.id
  )
  select count(*)::integer from updated;
$$;

create or replace function public.notifications_mark_all_read(p_company_id uuid)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with updated as (
    update public.notifications n
       set read_at = now()
     where n.company_id = p_company_id
       and n.user_id = auth.uid()
       and n.read_at is null
    returning n.id
  )
  select count(*)::integer from updated;
$$;

-- `security definer` con `auth.uid()` nullo — cioè chiamata dal service role o
-- da uno script — non aggiorna nulla, perché nessuna riga ha `user_id` nullo.
-- È il comportamento voluto: non esiste un modo di segnare come lette le
-- notifiche «di tutti».

revoke all on function public.notifications_mark_read(uuid[])   from public, anon;
revoke all on function public.notifications_mark_all_read(uuid) from public, anon;
grant execute on function public.notifications_mark_read(uuid[])   to authenticated;
grant execute on function public.notifications_mark_all_read(uuid) to authenticated;

-- `notifications_unread_count` resta `security invoker` e NON si tocca: legge
-- soltanto, e per una lettura la RLS è la difesa giusta — è già in vigore e
-- filtra riga per riga. Renderla `definer` sposterebbe quella difesa dentro una
-- condizione scritta a mano, senza guadagnarci niente.

-- ---------------------------------------------------------------------------
-- 2. Via la policy che non apriva niente
--
-- `notifications_update_own` era stata scritta per far passare l'UPDATE delle
-- funzioni. Non serviva già allora — senza GRANT una policy non apre nulla — e
-- ora che le funzioni sono `security definer` la RLS non le riguarda affatto.
-- Si toglie invece di lasciarla: una policy che sembra concedere una scrittura
-- che non esiste è un invito a concedere, un domani, anche il GRANT che la
-- renderebbe vera.
-- ---------------------------------------------------------------------------
drop policy if exists notifications_update_own on public.notifications;

-- ---------------------------------------------------------------------------
-- 3. Autoverifica
--
-- Due affermazioni, entrambe controllate qui e non solo nella suite di test:
-- le funzioni sono davvero `security definer`, e il client continua a non avere
-- alcuna scrittura sulla tabella. La seconda è la garanzia che la prima non
-- deve costare.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ')
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('notifications_mark_read', 'notifications_mark_all_read')
     and not p.prosecdef;
  if v_bad is not null then
    raise exception 'Queste funzioni devono essere security definer, altrimenti l''UPDATE viene respinto: %', v_bad;
  end if;

  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name = 'notifications'
     and grantee in ('anon', 'authenticated', 'public')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'Le notifiche non devono essere scrivibili dal client: %', v_bad;
  end if;

  raise notice '0019 verificata: «segna come letta» funziona e le notifiche restano non riscrivibili dal client.';
end $$;

-- >>>>>>>>>>>>>>>>>>>>  0020_workflow_automation  <<<<<<<<<<<<<<<<<<<<

-- ============================================================================
-- AI-Swisse — 0020 WORKFLOW AUTOMATION (Automazioni)
--
-- QUANDO succede X, SE valgono le condizioni Y, ALLORA esegui Z.
--
-- Non è un agente autonomo e non è un costruttore di flussi generici: è il
-- motore di REGOLE OPERATIVE dell'azienda. Le regole sono DATI, mai codice —
-- nessun `eval`, nessuna espressione da interpretare, nessun SQL costruito a
-- stringhe. Il motore legge una configurazione dichiarativa e la confronta con
-- un insieme CHIUSO di campi che ogni evento dichiara.
--
-- ⚠️ QUESTA MIGRAZIONE NON CREA UNA SECONDA VERITÀ SU NIENTE.
-- Le automazioni non copiano analisi, non copiano documenti, non copiano
-- attività: leggono ciò che esiste e producono attività, categorie, etichette e
-- notifiche PASSANDO DALLE STESSE TABELLE E DAGLI STESSI TRIGGER che usa una
-- persona. Un'attività creata da una regola è un'attività normale, con lo stesso
-- storico, le stesse garanzie e la stessa sincronizzazione di calendario.
--
-- COSA CONTIENE
--   1.  Enum del dominio (tutti nuovi: utilizzabili subito).
--   2.  Due valori aggiunti a enum esistenti — e MAI nominati altrove qui.
--   3.  `automation_events`: l'outbox. Lo scrivono i TRIGGER, non il browser.
--   4.  `workflow_definitions`: la regola.
--   5.  `workflow_runs` + `workflow_action_runs`: cosa è stato fatto e perché.
--   6.  `workflow_events`: chi ha creato, attivato, messo in pausa, archiviato.
--   7.  Provenienza: `tasks.workflow_run_id`, `documents.category_workflow_run_id`.
--   8.  `automation_emit()` — il punto UNICO da cui nasce un evento.
--   9.  I trigger che lo chiamano (analisi, categoria, posta, attività).
--   10. La coda: prenotazione atomica con lease, come il calendario (0018).
--   11. RLS, permessi e autoverifica.
--
-- ⚠️ VINCOLO SUI VALORI ENUM NUOVI (lezione della 0015, ricordata da 0016/0017)
-- `alter type … add value` non rende l'etichetta utilizzabile finché la
-- transazione non è chiusa, e `full-setup.sql` concatena tutto in una
-- transazione sola. Qui si aggiungono DUE valori a due enum esistenti
-- (`notification_type` e `document_category_source`) e NESSUNA altra istruzione
-- di questo file li nomina: li scrive soltanto il codice del worker, a runtime.
-- `npm run db:bundle` lo verifica.
--
-- ⚠️ REVOKE PRIMA DEI GRANT (lezione della 0014)
-- Su Supabase ogni tabella nuova di `public` nasce con i permessi di TABELLA
-- completi per `anon` e `authenticated`. Un grant scritto dopo AGGIUNGE
-- privilegi: non ne toglie. Ogni tabella qui sotto passa da `revoke all`.
--
-- Questa migrazione è RIESEGUIBILE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum del dominio
-- ---------------------------------------------------------------------------

-- I tipi di evento della versione 1. Sei, e ognuno corrisponde a un fatto che il
-- prodotto PRODUCE GIÀ: non si dichiara un innesco che nessuno scriverebbe mai.
-- «Fattura ricevuta», «contratto in scadenza», «cliente creato» non ci sono
-- perché non esistono le sorgenti: elencarli qui li farebbe comparire in un
-- menu a tendina che non scatterebbe mai.
do $$ begin create type public.automation_event_type as enum (
  'document_analysis_completed',   -- un'analisi valida è stata scritta
  'document_category_changed',     -- la categoria organizzativa è cambiata
  'email_attention_ready',         -- una comunicazione ha finito il processamento
  'task_created',                  -- è nata un'attività
  'task_status_changed',           -- un'attività ha cambiato stato
  'task_became_overdue'            -- un'attività ha superato la propria scadenza
);
exception when duplicate_object then null; end $$;

comment on type public.automation_event_type is
  'Fatti del dominio che possono innescare una regola. Solo eventi che il prodotto '
  'produce davvero: un innesco dichiarato e mai emesso sarebbe una funzione finta.';

-- Stato di un evento nella coda. `dead_letter` è distinto da `failed`: il primo
-- è «ho smesso di riprovare», il secondo «non c'era niente da riprovare».
do $$ begin create type public.automation_event_status as enum
  ('pending', 'processing', 'done', 'failed', 'dead_letter');
exception when duplicate_object then null; end $$;

-- Stato di una regola. L'archiviazione È uno stato qui — a differenza delle
-- attività, dove è una data — perché una regola archiviata non deve poter
-- comparire in nessun elenco operativo e lo stato è il campo su cui filtra ogni
-- interrogazione del motore.
do $$ begin create type public.workflow_status as enum
  ('draft', 'active', 'paused', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin create type public.workflow_run_status as enum
  ('pending', 'running', 'succeeded', 'partial', 'failed', 'skipped');
exception when duplicate_object then null; end $$;

do $$ begin create type public.workflow_action_status as enum
  ('pending', 'succeeded', 'skipped', 'failed');
exception when duplicate_object then null; end $$;

-- Le voci dello storico di una regola. Sono gesti di PERSONE (più due decisioni
-- del sistema che vanno dichiarate: la pausa automatica e il taglio della
-- catena), non risultati di esecuzione: quelli stanno in `workflow_runs`.
-- §125 — «domain events» alimentano l'automazione, «audit events» raccontano
-- chi ha fatto cosa. Condividere una tabella confonderebbe le due cose.
do $$ begin create type public.workflow_audit_kind as enum (
  'created', 'updated', 'activated', 'paused', 'archived', 'restored',
  'retried', 'auto_paused', 'chain_depth_exceeded'
);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Due valori aggiunti a enum ESISTENTI
--
-- ⚠️ NESSUNA ALTRA ISTRUZIONE DI QUESTO FILE PUÒ NOMINARLI, nemmeno dentro il
-- corpo di una funzione: Postgres li rifiuterebbe con 55P04 finché la
-- transazione non è chiusa. Li usa soltanto il worker, a runtime, quando la
-- migrazione è ormai applicata da un pezzo.
--
--   · notification_type      riceve il tipo delle notifiche prodotte da una
--                            regola. Riusare `task_assigned` avrebbe
--                            significato far dire alla campanella una cosa
--                            falsa; creare una tabella di notifiche parallela
--                            avrebbe significato due campanelle (§91).
--   · document_category_source riceve l'origine «regola aziendale». Non è
--                            «rule»: quella è la classificazione deterministica
--                            per tipo di documento ed ente (0017), che il
--                            prodotto fa da sé. Una categoria scelta da una
--                            regola dell'AZIENDA è una terza cosa, e chi guarda
--                            il documento ha diritto di sapere quale delle due
--                            l'ha messa.
-- ---------------------------------------------------------------------------
--   · task_source             riceve la provenienza «regola aziendale». Le tre
--                            esistenti dicono da quale MODULO nasce il lavoro
--                            (analisi documentale, incentivi, mano di una
--                            persona): nessuna delle tre descrive un'attività
--                            che non ha deciso nessuno sul momento. Chi la
--                            riceve ha diritto di saperlo, e
--                            `tasks.workflow_run_id` dice anche QUALE regola.
alter type public.notification_type add value if not exists 'workflow_alert';
alter type public.document_category_source add value if not exists 'workflow';
alter type public.task_source add value if not exists 'workflow';

-- ---------------------------------------------------------------------------
-- 3. automation_events — l'outbox
--
-- IL PATTERN, E PERCHÉ NON SE NE PUÒ FARE A MENO.
-- Un'analisi che finisce e una regola che parte sono due cose che devono
-- succedere insieme o non succedere affatto. Se la seconda vivesse dentro la
-- richiesta della prima — `await salvaAnalisi(); await eseguiRegole();` — un
-- guasto in mezzo lascerebbe l'analisi scritta e le regole perse, e nessuno lo
-- saprebbe. Qui l'evento nasce nella STESSA TRANSAZIONE del fatto, scritto da
-- un trigger: o ci sono entrambi o non c'è nessuno dei due. Poi un worker
-- asincrono lo consuma, e il processo di partenza è già finito da un pezzo
-- (§11/§58).
--
-- ⚠️ IL CLIENT NON PUÒ SCRIVERE QUI, E NON PUÒ NEMMENO LEGGERE.
-- Nessun GRANT, per nessun ruolo diverso da `service_role`. Un browser che
-- potesse dichiarare `document_analysis_completed` con un payload inventato
-- potrebbe far creare attività, cambiare categorie e mandare notifiche a nome
-- di regole che non ha scritto lui (§12/§151).
--
-- ⚠️ IL PAYLOAD È MINIMO (§13/§117).
-- Identificativi e pochissimi metadati. MAI il corpo di una email, mai il testo
-- estratto di un documento, mai un allegato, mai un JSON di analisi. Chi esegue
-- la regola ha il service role e può rileggere ciò che gli serve dalle tabelle
-- vere: conservarne una copia qui significherebbe soltanto moltiplicare i posti
-- da cui un dato personale può uscire.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_events (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  event_type        public.automation_event_type not null,
  -- Testo e non enum: `entity_type` non governa nessuna decisione di
  -- autorizzazione — quella la fa `company_id` — e serve solo a sapere in quale
  -- tabella andare a rileggere. Stessa scelta di `notifications` (0018).
  entity_type       text not null check (entity_type in ('document', 'email_message', 'task')),
  entity_id         uuid not null,
  -- La versione del CONTRATTO dell'evento. Serve il giorno in cui un evento
  -- cambia forma: le regole scritte per la versione 1 devono continuare a
  -- essere interpretabili, e un worker deve poter rifiutare ciò che non capisce
  -- invece di indovinare.
  event_version     integer not null default 1 check (event_version >= 1),
  payload           jsonb not null default '{}'::jsonb,
  occurred_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  -- ---- Provenienza e catena causale (§68/§69/§71/§72) --------------------
  -- `system` = il fatto è successo perché qualcuno ha caricato un documento,
  -- ricevuto una email, creato un'attività. `automation` = l'ha prodotto una
  -- regola. Senza questa distinzione una regola che crea attività e una regola
  -- che reagisce alle attività si inseguirebbero all'infinito.
  origin            text not null default 'system' check (origin in ('system', 'automation')),
  origin_run_id     uuid,          -- FK a workflow_runs: aggiunta più sotto (dipendenza circolare)
  -- L'identità della CATENA. Tutti gli eventi discendenti da uno stesso fatto
  -- iniziale condividono questo valore, ed è ciò che permette la regola
  -- fondamentale: una regola gira AL PIÙ UNA VOLTA per catena.
  correlation_id    uuid not null default gen_random_uuid(),
  causation_id      uuid references public.automation_events (id) on delete set null,
  root_event_id     uuid references public.automation_events (id) on delete set null,
  chain_depth       integer not null default 0 check (chain_depth >= 0),

  -- ---- Coda ---------------------------------------------------------------
  processing_status public.automation_event_status not null default 'pending',
  attempts          integer not null default 0,
  next_attempt_at   timestamptz not null default now(),
  -- Lease a SCADENZA e non booleano: un worker ucciso dai 150 secondi di
  -- Supabase non deve bloccare una riga per sempre (§61). È la stessa forma
  -- della coda del calendario, e per la stessa ragione.
  locked_until      timestamptz,
  lock_id           uuid,
  processed_at      timestamptz,
  error_code        text,
  -- Idempotenza dell'EMISSIONE. Serve agli eventi che nascono da una scansione
  -- periodica («questa attività è scaduta»), che senza chiave si ripeterebbero
  -- a ogni giro. Gli eventi che nascono da un cambiamento di stato non ne hanno
  -- bisogno — il trigger scatta una volta per UPDATE — e dargliene una finta
  -- con dentro un timestamp sarebbe scrivere un vincolo che non vincola nulla.
  -- È esattamente la scelta già fatta per `notifications.dedupe_key` (0018).
  dedupe_key        text
);

create unique index if not exists uq_automation_events_dedupe
  on public.automation_events (company_id, dedupe_key) where dedupe_key is not null;
-- La domanda del worker: «cosa c'è da fare adesso». Indice parziale, perché le
-- righe già trattate sono la maggioranza e non interessano più.
create index if not exists idx_automation_events_due
  on public.automation_events (next_attempt_at, company_id)
  where processing_status in ('pending', 'processing');
-- La diagnostica: cosa è successo a questa azienda, e cosa è finito male.
create index if not exists idx_automation_events_company
  on public.automation_events (company_id, occurred_at desc);
create index if not exists idx_automation_events_dead
  on public.automation_events (company_id, occurred_at desc)
  where processing_status = 'dead_letter';
-- La regola «una volta per catena» interroga per correlazione.
create index if not exists idx_automation_events_chain
  on public.automation_events (correlation_id);

comment on table public.automation_events is
  'Outbox dei fatti del dominio. Lo scrivono i trigger nella stessa transazione del '
  'fatto; il client non ha alcun permesso, né di lettura né di scrittura. Append-only: '
  'nessuno può riscrivere un evento già avvenuto.';
comment on column public.automation_events.payload is
  'Solo identificativi e metadati minimi. Mai corpi di email, testi estratti o allegati: '
  'chi esegue rilegge dalle tabelle vere con il service role.';
comment on column public.automation_events.correlation_id is
  'Identità della catena causale. Una regola gira al più una volta per catena: è ciò '
  'che impedisce sia il ciclo su sé stessa sia il ciclo A→B→A.';

-- ---------------------------------------------------------------------------
-- 4. workflow_definitions — la regola
--
-- `conditions` e `actions` sono JSONB e la scelta è motivata (§127/§128): una
-- configurazione è per natura una struttura variabile, e normalizzarla in
-- `workflow_condition_rows` + `workflow_condition_values` avrebbe prodotto tre
-- tabelle da ricomporre a ogni lettura per rappresentare quello che è, di
-- fatto, un documento. Il prezzo del JSONB è che il database non ne conosce la
-- forma: si paga con i vincoli strutturali qui sotto (tipo, dimensione,
-- numero di elementi) e con la validazione SEMANTICA nel registro tipizzato,
-- che è l'unico posto in cui esistono i campi e le azioni ammesse.
--
-- ⚠️ NESSUN PERMESSO DI SCRITTURA PER IL CLIENT. Si crea, si modifica, si
-- attiva e si archivia SOLO passando dalla Edge Function `automation-admin`,
-- che verifica il ruolo e valida la configurazione contro il registro prima di
-- scrivere. È la stessa disciplina delle connessioni di posta (0013): «al
-- client non serve nessun permesso di scrittura, e non averlo è più solido che
-- averlo e controllarlo altrove».
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_definitions (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  name             text not null check (length(btrim(name)) between 1 and 80),
  description      text check (length(description) <= 500),
  status           public.workflow_status not null default 'draft',
  trigger_type     public.automation_event_type not null,
  -- `all` = tutte le condizioni devono valere, `any` = ne basta una (§22).
  -- Due valori e non un albero ricorsivo: un costruttore di espressioni
  -- annidate è una cosa che si scrive in una settimana e si spiega in un'ora,
  -- e nessun titolare di PMI ne ha mai chiesto uno.
  condition_match  text not null default 'all' check (condition_match in ('all', 'any')),
  conditions       jsonb not null default '[]'::jsonb,
  actions          jsonb not null default '[]'::jsonb,

  -- La versione cresce a ogni modifica della configurazione, e ogni esecuzione
  -- registra quale versione ha eseguito: le run di ieri restano interpretabili
  -- anche dopo che la regola è cambiata (§46/§47).
  version          integer not null default 1 check (version >= 1),

  -- ⚠️ §163 — ATTIVARE UNA REGOLA NON PROCESSA IL PASSATO.
  -- Non è un filtro nel worker che qualcuno può dimenticare: il motore confronta
  -- `occurred_at` dell'evento con questa data. Una regola attivata oggi non può
  -- reagire a un documento di marzo, e la garanzia sta in un solo posto.
  activated_at     timestamptz,

  -- «Attiva, ma richiede attenzione» (§103): la configurazione è diventata
  -- invalida — il responsabile non è più in azienda, l'etichetta è stata
  -- cancellata. Non è uno stato, perché la regola resta quella che è: è un
  -- CODICE, e la schermata lo traduce in una frase che dice cosa fare.
  attention_code   text,
  attention_at     timestamptz,
  -- Fallimenti PERMANENTI consecutivi. Oltre la soglia la regola si mette in
  -- pausa da sé (§104): fallire diecimila volte non è resilienza, è rumore.
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),

  last_run_at      timestamptz,
  last_run_status  public.workflow_run_status,

  created_by       uuid references auth.users (id) on delete set null,
  updated_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid references auth.users (id) on delete set null,

  -- Vincoli STRUTTURALI: ciò che il database può verificare da solo su un
  -- JSONB. La semantica — questo campo esiste? questa azione esiste? questo
  -- segnaposto è valido? — la verifica il registro, e senza quella validazione
  -- la regola non può essere attivata.
  constraint workflow_conditions_is_array check (jsonb_typeof(conditions) = 'array'),
  constraint workflow_actions_is_array    check (jsonb_typeof(actions) = 'array'),
  constraint workflow_conditions_max      check (jsonb_array_length(conditions) <= 10),
  constraint workflow_actions_max         check (jsonb_array_length(actions) <= 5)
);

-- ⚠️ §154 — l'indice che rende il motore indipendente dal numero di aziende.
-- La domanda del worker è sempre la stessa: «quali regole ATTIVE di QUESTA
-- azienda ascoltano QUESTO tipo di evento». Senza questo indice parziale,
-- ogni evento costerebbe una scansione di tutte le regole del database.
create index if not exists idx_workflows_active
  on public.workflow_definitions (company_id, trigger_type)
  where status = 'active';
-- L'elenco della schermata: tutte quelle non archiviate, dalla più recente.
create index if not exists idx_workflows_company
  on public.workflow_definitions (company_id, created_at desc)
  where status <> 'archived';

comment on table public.workflow_definitions is
  'Una regola operativa dell''azienda: QUANDO / SE / ALLORA. La configurazione è un '
  'DATO, mai codice: nessuna espressione viene interpretata, nessun SQL viene costruito.';
comment on column public.workflow_definitions.activated_at is
  'Da quando la regola è in vigore. Il motore ignora gli eventi precedenti: attivare '
  'una regola non fa ripartire il passato, e la garanzia sta qui e non in un filtro '
  'sparso nel worker.';
comment on column public.workflow_definitions.attention_code is
  'Configurazione diventata invalida a regola già attiva (responsabile uscito, etichetta '
  'cancellata). Codice, non frase: la frase la scrive l''interfaccia nella lingua di chi legge.';

-- ---------------------------------------------------------------------------
-- 5. workflow_runs — che cosa è successo, e con quale versione della regola
--
-- ⚠️ `unique (workflow_id, trigger_event_id)` È L'IDEMPOTENZA DI PIÙ ALTO
-- LIVELLO, e non è un indice «per sicurezza»: è la ragione per cui lo stesso
-- evento consegnato due volte non produce due esecuzioni. Un ritentativo
-- RIUSA la riga esistente invece di crearne una nuova, e le azioni già
-- riuscite non vengono rifatte (§43/§65/§135).
--
-- ⚠️ NON SI SCRIVE UNA RUN PER OGNI EVENTO CHE NON CORRISPONDE (§101).
-- Una regola su «categoria = Imposte» vedrebbe passare ogni documento
-- dell'azienda: con novecentonovanta documenti l'anno significherebbe
-- novecentonovanta righe «saltata» che nessuno leggerà mai, e la storia utile
-- — le venti volte in cui ha agito — sarebbe sepolta. Si scrive una run quando
-- le condizioni CORRISPONDONO, oppure quando qualcosa è andato storto: i non
-- corrispondenti diventano un contatore sull'evento, non una riga.
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_runs (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  workflow_id       uuid not null references public.workflow_definitions (id) on delete cascade,
  workflow_version  integer not null,
  -- Fotografia della configurazione USATA. Senza, una run di ieri letta domani
  -- racconterebbe la regola di domani: si vedrebbero azioni che non sono mai
  -- state eseguite e non si vedrebbero quelle che lo sono state (§46).
  config_snapshot   jsonb not null default '{}'::jsonb,
  trigger_event_id  uuid references public.automation_events (id) on delete set null,

  -- L'entità su cui la regola ha agito. Solo tipo e identificativo: il titolo
  -- lo rilegge la schermata dalle tabelle vere, passando dalla RLS. Conservarne
  -- una copia qui significherebbe sia un dato in più da proteggere sia un
  -- titolo che invecchia (§117).
  entity_type       text check (entity_type in ('document', 'email_message', 'task')),
  entity_id         uuid,

  status            public.workflow_run_status not null default 'pending',
  -- Le condizioni, una per una, con l'esito. È ciò che permette alla schermata
  -- di dire «✓ Categoria = Imposte» invece di «ha funzionato» (§49). Contiene
  -- il campo, l'operatore, il valore ATTESO e l'esito: NON il valore osservato
  -- quando è un testo libero, per non trascinare qui il mittente di ogni
  -- documento dell'azienda.
  condition_results jsonb not null default '[]'::jsonb,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  duration_ms       integer,
  error_code        text,
  created_at        timestamptz not null default now(),

  unique (workflow_id, trigger_event_id)
);
create index if not exists idx_workflow_runs_wf
  on public.workflow_runs (workflow_id, started_at desc);
create index if not exists idx_workflow_runs_company
  on public.workflow_runs (company_id, started_at desc);
-- «Quante esecuzioni e quanti errori negli ultimi trenta giorni» (§102).
create index if not exists idx_workflow_runs_problem
  on public.workflow_runs (workflow_id, started_at desc)
  where status in ('failed', 'partial');

comment on table public.workflow_runs is
  'Un''esecuzione. Immutabile per il client: la scrive il worker con il service role. '
  'Il vincolo unico (workflow, evento) è ciò che impedisce a un evento consegnato due '
  'volte di produrre due esecuzioni.';

-- Ora che `workflow_runs` esiste, si può chiudere la dipendenza circolare: un
-- evento può essere stato prodotto da una run, e una run nasce da un evento.
do $$ begin
  alter table public.automation_events
    add constraint automation_events_origin_run_fk
    foreign key (origin_run_id) references public.workflow_runs (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 6. workflow_action_runs — ogni azione, con la sua chiave di idempotenza
--
-- ⚠️ LA CHIAVE UNICA È NEL DATABASE, NON NEL CODICE (§66).
-- «Guarda se esiste, poi inserisci» non è una garanzia: fra il guardare e
-- l'inserire ci sta un'altra esecuzione del worker. Qui la seconda insert
-- fallisce con 23505 e l'esecutore lo interpreta per quello che è — «l'ho già
-- fatto» — invece di creare una seconda attività identica.
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_action_runs (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  workflow_run_id    uuid not null references public.workflow_runs (id) on delete cascade,
  action_key         text not null check (length(action_key) between 1 and 60),
  action_position    integer not null check (action_position >= 0),
  status             public.workflow_action_status not null default 'pending',
  -- `<evento>:<regola>:<posizione>`. L'identificativo dell'evento è già unico,
  -- quindi la chiave lo è; averla in chiaro invece che come impronta permette
  -- di capire, guardando una riga, quale esecuzione l'ha prodotta.
  idempotency_key    text not null,
  -- Che cosa ha prodotto: l'attività creata, il documento toccato, la notifica.
  output_entity_type text check (output_entity_type in ('task', 'document', 'notification', 'document_tag')),
  output_entity_id   uuid,
  -- Perché è stata saltata o è fallita. Codice, mai frase: la frase la scrive
  -- l'interfaccia nella lingua di chi legge (§50).
  error_code         text,
  started_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),

  unique (idempotency_key),
  unique (workflow_run_id, action_position)
);
create index if not exists idx_action_runs_run
  on public.workflow_action_runs (workflow_run_id, action_position);

comment on column public.workflow_action_runs.idempotency_key is
  'Chiave di idempotenza «evento:regola:posizione». L''unicità la impone il database: '
  'un controllo applicativo non regge fra due esecuzioni sovrapposte del worker.';

-- ---------------------------------------------------------------------------
-- 7. workflow_events — chi ha fatto cosa alla regola
--
-- §124/§125 — È UN ALTRO REGISTRO, non lo stesso di `automation_events`.
-- Quello è la coda che alimenta il motore; questo racconta le decisioni delle
-- persone: chi ha creato, attivato, messo in pausa, archiviato, ritentato. Lo
-- scrivono i trigger, e il client non può scriverlo — un registro che
-- l'interessato può riscrivere non è un registro (0016).
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_events (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  workflow_id    uuid not null references public.workflow_definitions (id) on delete cascade,
  actor_user_id  uuid references auth.users (id) on delete set null,
  kind           public.workflow_audit_kind not null,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_workflow_events_wf
  on public.workflow_events (workflow_id, created_at desc);
create index if not exists idx_workflow_events_company
  on public.workflow_events (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 8. Provenienza sulle entità prodotte
--
-- §42 — «serve sapere: questa attività è stata creata automaticamente dalla
-- regola X». Una relazione esplicita, NON una frase infilata nella descrizione:
-- una descrizione è testo per una persona, e scriverci dentro un dato
-- strutturato significa non poterlo più interrogare e doverlo leggere con
-- un'espressione regolare.
--
-- Le due colonne servono anche alla PROTEZIONE DEI CICLI: sono il modo in cui
-- il trigger che emette l'evento successivo sa di essere dentro una catena
-- avviata da un'automazione, e non all'inizio di una nuova storia (§68).
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists workflow_run_id uuid references public.workflow_runs (id) on delete set null;

alter table public.documents
  add column if not exists category_workflow_run_id uuid references public.workflow_runs (id) on delete set null;

create index if not exists idx_tasks_workflow_run
  on public.tasks (workflow_run_id) where workflow_run_id is not null;

-- ⚠️ Una notifica prodotta da una regola può riferirsi a un DOCUMENTO o a una
-- COMUNICAZIONE, non solo a un'attività. Il vincolo della 0018 ammetteva due
-- soli valori perché due erano i casi che esistevano allora; lasciarlo com'era
-- avrebbe fatto fallire l'azione «notifica» su ogni innesco documentale con un
-- errore di vincolo, cioè con un guasto tecnico al posto di una funzione.
-- Si allarga l'elenco, non si toglie il controllo: un `entity_type` libero
-- permetterebbe di scrivere qualsiasi cosa e la campanella comporrebbe
-- collegamenti verso rotte inesistenti.
alter table public.notifications drop constraint if exists notifications_entity_type_check;
do $$ begin
  alter table public.notifications
    add constraint notifications_entity_type_check
    check (entity_type in ('task', 'calendar_connection', 'document', 'email_message'));
exception when duplicate_object then null; end $$;

comment on column public.tasks.workflow_run_id is
  'L''esecuzione che ha creato questa attività, quando è nata da una regola. Si scrive '
  'solo all''inserimento: una modifica successiva non è una creazione, e riscriverlo '
  'farebbe dire alla schermata una cosa falsa.';
comment on column public.documents.category_workflow_run_id is
  'L''esecuzione che ha impostato la categoria, quando l''ha impostata una regola. '
  'Accompagna category_source: dice QUALE regola, non solo che ce n''è stata una.';

-- ---------------------------------------------------------------------------
-- 9. I limiti, dichiarati dal database
--
-- Esistono in due posti — qui e nel contratto TypeScript del motore — perché il
-- database li APPLICA e l'interfaccia li DICHIARA. Quando le due copie
-- divergono, la schermata promette una cosa e il sistema ne fa un'altra: è già
-- successo con `INITIAL_SYNC_DAYS` dell'Inbox, e da allora un test verifica che
-- coincidano. Questa funzione esiste perché quel test possa farlo.
-- ---------------------------------------------------------------------------
create or replace function public.automation_limits()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'maxActiveWorkflows', 10,
    'maxConditions', 10,
    'maxActions', 5,
    'maxChainDepth', 5,
    'maxEventAttempts', 5,
    'maxRunsPerCompanyPerPass', 50,
    'maxTemplateLength', 200
  );
$$;

revoke all on function public.automation_limits() from public, anon;
grant execute on function public.automation_limits() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. automation_emit — il punto UNICO da cui nasce un evento
--
-- Tutti i trigger passano di qui. Una funzione sola perché le decisioni
-- delicate — non emettere se nessuno ascolta, ereditare la catena, fermarsi
-- alla profondità massima — devono esistere in un posto solo: scritte cinque
-- volte, prima o poi quattro sono giuste e una no.
--
-- ⚠️ NON SI EMETTE SE NESSUNA REGOLA ATTIVA ASCOLTA QUESTO TIPO DI EVENTO.
-- È la stessa scelta di `calendar_enqueue_task`, che non accoda nulla per le
-- aziende senza calendario collegato. Senza, l'importazione iniziale di una
-- casella di posta scriverebbe ottanta righe che nessuno consumerà mai. La
-- conseguenza va detta: gli eventi accaduti PRIMA che una regola esistesse non
-- si trovano da nessuna parte — ed è coerente con §163, perché una regola
-- appena attivata non deve comunque processare il passato.
--
-- `security definer` perché i trigger che la chiamano girano per conto di
-- chiunque stia scrivendo, e questa tabella non ha permessi per nessuno.
-- ---------------------------------------------------------------------------
create or replace function public.automation_emit(
  p_company_id  uuid,
  p_event_type  public.automation_event_type,
  p_entity_type text,
  p_entity_id   uuid,
  p_payload     jsonb default '{}'::jsonb,
  p_dedupe_key  text default null,
  -- Valorizzato SOLO quando il fatto è stato prodotto da un'automazione: è il
  -- filo che tiene insieme la catena causale.
  p_run_id      uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_parent       record;
  v_depth        integer := 0;
  v_correlation  uuid;
  v_root         uuid;
  v_causation    uuid;
  v_origin       text := 'system';
  v_max_depth    integer := (public.automation_limits() ->> 'maxChainDepth')::integer;
  v_id           uuid;
begin
  if p_company_id is null or p_entity_id is null then return null; end if;

  -- Nessuno ascolta: non si scrive niente.
  if not exists (
    select 1 from public.workflow_definitions w
    where w.company_id = p_company_id
      and w.trigger_type = p_event_type
      and w.status = 'active'
  ) then
    return null;
  end if;

  if p_run_id is not null then
    select r.id as run_id, r.workflow_id, e.id as event_id,
           e.correlation_id, e.root_event_id, e.chain_depth
      into v_parent
      from public.workflow_runs r
      left join public.automation_events e on e.id = r.trigger_event_id
     where r.id = p_run_id;

    if v_parent.run_id is not null then
      v_origin      := 'automation';
      v_causation   := v_parent.event_id;
      v_correlation := v_parent.correlation_id;
      v_root        := coalesce(v_parent.root_event_id, v_parent.event_id);
      v_depth       := coalesce(v_parent.chain_depth, 0) + 1;

      -- §70 — oltre la profondità massima si SMETTE, e lo si scrive. Un taglio
      -- silenzioso sarebbe indistinguibile da «non c'era altro da fare», che è
      -- proprio la confusione che questo progetto evita ovunque.
      if v_depth > v_max_depth then
        insert into public.workflow_events (company_id, workflow_id, actor_user_id, kind, detail)
        values (p_company_id, v_parent.workflow_id, null, 'chain_depth_exceeded',
                jsonb_build_object('depth', v_depth, 'max', v_max_depth,
                                   'correlationId', v_correlation, 'eventType', p_event_type));
        return null;
      end if;
    end if;
  end if;

  insert into public.automation_events (
    company_id, event_type, entity_type, entity_id, payload,
    origin, origin_run_id, correlation_id, causation_id, root_event_id, chain_depth,
    dedupe_key
  ) values (
    p_company_id, p_event_type, p_entity_type, p_entity_id, coalesce(p_payload, '{}'::jsonb),
    v_origin, p_run_id, coalesce(v_correlation, gen_random_uuid()), v_causation, v_root, v_depth,
    p_dedupe_key
  )
  on conflict (company_id, dedupe_key) where dedupe_key is not null do nothing
  returning id into v_id;

  return v_id;
end $$;

revoke all on function public.automation_emit(uuid, public.automation_event_type, text, uuid, jsonb, text, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. I trigger che emettono
--
-- ⚠️ Ognuno emette dalla TABELLA che possiede il fatto, e non da un servizio:
-- così l'evento e il fatto stanno nella stessa transazione qualunque sia il
-- percorso che ha scritto il fatto — l'interfaccia, una Edge Function, uno
-- script di manutenzione o una migrazione. Un evento emesso dal codice
-- applicativo avrebbe coperto solo i percorsi a cui qualcuno ha pensato.
-- ---------------------------------------------------------------------------

-- (a) Un'analisi valida è stata scritta.
--     Le analisi FALLITE non emettono: un'analisi fallita non descrive niente,
--     e far scattare una regola su un fallimento significherebbe classificare o
--     assegnare lavoro sulla base di un dato che non esiste (§140).
create or replace function public.automation_on_analysis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc record;
begin
  if new.analysis_status = 'failed' then return new; end if;

  select d.id, d.company_id, d.category, d.source_type
    into v_doc
    from public.documents d
   where d.id = new.document_id;

  -- Il confronto sull'azienda NON è ridondante: questa funzione è
  -- `security definer` e una funzione che scavalca la RLS deve difendersi da
  -- sola, senza fidarsi di una policy scritta altrove (lezione della 0017).
  if v_doc.id is null or v_doc.company_id is distinct from new.company_id then
    return new;
  end if;

  perform public.automation_emit(
    new.company_id, 'document_analysis_completed', 'document', new.document_id,
    jsonb_build_object('analysisId', new.id, 'analysisStatus', new.analysis_status),
    -- Una rianalisi dello stesso documento È un fatto nuovo (il contenuto
    -- capito può essere cambiato), quindi nessuna deduplicazione: la si
    -- otterrebbe solo inventando una chiave con dentro l'ora.
    null, null
  );
  return new;
end $$;

drop trigger if exists trg_automation_analysis on public.document_analyses;
create trigger trg_automation_analysis
  after insert on public.document_analyses
  for each row execute function public.automation_on_analysis();

-- (b) La categoria organizzativa è cambiata.
--     Solo il CAMBIO, non ogni salvataggio del documento: rinominare un file
--     non è un fatto per cui una regola debba muoversi.
create or replace function public.automation_on_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category is not distinct from old.category then return new; end if;
  if new.category is null then return new; end if;

  perform public.automation_emit(
    new.company_id, 'document_category_changed', 'document', new.id,
    jsonb_build_object(
      'category', new.category,
      'previousCategory', old.category,
      'categorySource', new.category_source
    ),
    null,
    -- Se la categoria l'ha messa una regola, l'evento eredita la catena: è il
    -- filo che impedisce a due regole di rincorrersi sulla stessa categoria.
    new.category_workflow_run_id
  );
  return new;
end $$;

drop trigger if exists trg_automation_category on public.documents;
create trigger trg_automation_category
  after update on public.documents
  for each row execute function public.automation_on_category();

-- (c) Una comunicazione ha finito il processamento ed è pronta per una persona.
--     Si emette al passaggio a `done`, che è lo stato terminale riuscito. Non
--     su `failed`: là non c'è una comunicazione capita, c'è un guasto — e
--     l'Inbox lo mostra già come tale.
create or replace function public.automation_on_email_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.processing_status <> 'done' then return new; end if;
  if old.processing_status = 'done' then return new; end if;

  perform public.automation_emit(
    new.company_id, 'email_attention_ready', 'email_message', new.id,
    jsonb_build_object(
      'attentionStatus', new.attention_status,
      'relevance', new.relevance,
      'hasAttachments', new.has_attachments
    ),
    -- Un messaggio raggiunge `done` una volta sola nella pratica, ma la chiave
    -- lo rende un fatto: una riesecuzione della pipeline non produce due
    -- eventi, e quindi non due attività.
    'email:' || new.id::text || ':ready',
    null
  );
  return new;
end $$;

drop trigger if exists trg_automation_email_ready on public.email_messages;
create trigger trg_automation_email_ready
  after update on public.email_messages
  for each row execute function public.automation_on_email_ready();

-- (d) Attività: creazione e cambio di stato.
create or replace function public.automation_on_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.automation_emit(
      new.company_id, 'task_created', 'task', new.id,
      jsonb_build_object('source', new.source, 'priority', new.priority,
                         'status', new.status, 'hasAssignee', new.assignee_user_id is not null),
      null,
      -- ⚠️ Qui si chiude il cerchio della protezione dei cicli: un'attività
      -- creata da una regola porta con sé l'esecuzione che l'ha creata, quindi
      -- l'evento che ne nasce sa di essere dentro una catena e ne eredita la
      -- profondità. Senza questa riga, «quando nasce un'attività, crea
      -- un'attività» girerebbe per sempre.
      new.workflow_run_id
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    perform public.automation_emit(
      new.company_id, 'task_status_changed', 'task', new.id,
      jsonb_build_object('from', old.status, 'to', new.status,
                         'priority', new.priority,
                         'hasAssignee', new.assignee_user_id is not null),
      null, new.workflow_run_id
    );
  end if;

  return new;
end $$;

drop trigger if exists trg_automation_task on public.tasks;
create trigger trg_automation_task
  after insert or update on public.tasks
  for each row execute function public.automation_on_task();

-- ---------------------------------------------------------------------------
-- 12. «È diventata scaduta»: un fatto che non ha un UPDATE
--
-- Nessuno scrive niente quando un'attività supera la propria scadenza: passa il
-- tempo, e basta. Serve quindi una scansione — ma NON un secondo rilevatore di
-- scadenze (§9): la definizione di «scaduta» è quella che il prodotto già usa
-- nella vista «Scadute» di `list_tasks`, cioè `due_date < current_date` con
-- l'attività né conclusa né archiviata. Averne due significherebbe una
-- schermata che dice «in ritardo» e una regola che non scatta.
--
-- La finestra all'indietro è deliberata: si guardano solo le attività scadute
-- di recente. Senza, la prima esecuzione dopo l'attivazione di una regola
-- rovescerebbe addosso all'azienda tutto l'arretrato — che è esattamente il
-- backfill che §164 vieta.
--
-- La chiave di deduplicazione rende l'emissione idempotente: un'attività
-- diventa scaduta UNA volta. Se viene completata e riaperta oltre la scadenza,
-- non riparte: «scaduta» descrive il superamento della data, non lo stato del
-- lavoro, e ripeterlo ogni mattina addestrerebbe a ignorare l'avviso — la
-- stessa scelta già fatta per il promemoria «scaduta» dei calendari (0018).
-- ---------------------------------------------------------------------------
create or replace function public.automation_emit_overdue(
  p_lookback_days integer default 3,
  p_limit         integer default 200
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task  record;
  v_count integer := 0;
  v_id    uuid;
begin
  for v_task in
    select t.id, t.company_id, t.priority, t.status, t.due_date,
           t.assignee_user_id is not null as has_assignee
      from public.tasks t
     where t.status <> 'completed'
       and t.archived_at is null
       and t.due_date is not null
       and t.due_date < current_date
       and t.due_date >= current_date - greatest(1, least(coalesce(p_lookback_days, 3), 30))
     order by t.due_date desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    v_id := public.automation_emit(
      v_task.company_id, 'task_became_overdue', 'task', v_task.id,
      jsonb_build_object('priority', v_task.priority, 'status', v_task.status,
                         'dueDate', v_task.due_date, 'hasAssignee', v_task.has_assignee),
      'task:' || v_task.id::text || ':overdue',
      null
    );
    if v_id is not null then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

revoke all on function public.automation_emit_overdue(integer, integer) from public, anon, authenticated;
grant execute on function public.automation_emit_overdue(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 13. La coda: prenotazione atomica di un lotto
--
-- `for update skip locked`, come la coda del calendario e per la stessa
-- ragione: due esecuzioni sovrapposte del worker lavorano su eventi diversi
-- senza aspettarsi a vicenda. Il `locked_until` sopravvive alla transazione,
-- quindi un isolate ucciso a metà libera la riga alla scadenza invece di
-- tenerla presa per sempre (§61/§133).
--
-- ⚠️ IL TETTO PER AZIENDA (§73) non è prudenza teorica: un'importazione
-- iniziale di posta o un caricamento massivo di documenti possono produrre
-- centinaia di eventi in un minuto, e senza tetto una sola azienda occuperebbe
-- ogni esecuzione del worker mentre le altre aspettano. `row_number()` per
-- azienda risolve con una riga di SQL ciò che nel worker sarebbe stato un
-- contatore da ricordarsi.
-- ---------------------------------------------------------------------------
create or replace function public.automation_events_claim(
  p_limit        integer default 40,
  p_lock_seconds integer default 120,
  p_per_company  integer default 50
)
returns table (
  id uuid, company_id uuid, event_type public.automation_event_type,
  entity_type text, entity_id uuid, payload jsonb, occurred_at timestamptz,
  origin text, correlation_id uuid, root_event_id uuid, chain_depth integer,
  attempts integer, lock_id uuid
)
language sql
security definer
set search_path = ''
as $$
  with candidati as (
    select e.id as eid
    from (
      select ev.id, ev.next_attempt_at,
             row_number() over (partition by ev.company_id order by ev.next_attempt_at asc, ev.occurred_at asc) as rn
      from public.automation_events ev
      where ev.processing_status in ('pending', 'processing')
        and ev.next_attempt_at <= now()
        and (ev.locked_until is null or ev.locked_until < now())
    ) e
    where e.rn <= greatest(1, least(coalesce(p_per_company, 50), 200))
    order by e.next_attempt_at asc
    limit greatest(1, least(coalesce(p_limit, 40), 200))
  ),
  bloccati as (
    select q.id as eid
    from public.automation_events q
    where q.id in (select c.eid from candidati c)
      and q.processing_status in ('pending', 'processing')
      and q.next_attempt_at <= now()
      and (q.locked_until is null or q.locked_until < now())
    for update skip locked
  ),
  aggiornati as (
    update public.automation_events ev
       set processing_status = 'processing',
           locked_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lock_seconds, 120), 600))),
           -- Un lock per RIGA e non per lotto: chi rilascia una riga non può
           -- liberare per sbaglio quelle che un'altra esecuzione sta trattando.
           lock_id = gen_random_uuid(),
           -- ⚠️ IL TENTATIVO SI CONTA QUANDO SI PRENDE, NON QUANDO SI FALLISCE.
           -- Se lo si contasse al fallimento, un worker ucciso a metà (i 150
           -- secondi di Supabase) lascerebbe la riga con lo stesso numero di
           -- tentativi di prima: alla scadenza del lease verrebbe ripresa, e
           -- riuccisa, e ripresa — per sempre, senza che il contatore arrivi
           -- mai al tetto. Contando qui, anche un evento che fa morire il
           -- worker finisce in `dead_letter` e diventa visibile.
           attempts = ev.attempts + 1
      from bloccati b
     where ev.id = b.eid
    returning ev.id, ev.company_id, ev.event_type, ev.entity_type, ev.entity_id,
              ev.payload, ev.occurred_at, ev.origin, ev.correlation_id,
              ev.root_event_id, ev.chain_depth, ev.attempts, ev.lock_id
  )
  select a.id, a.company_id, a.event_type, a.entity_type, a.entity_id, a.payload,
         a.occurred_at, a.origin, a.correlation_id, a.root_event_id, a.chain_depth,
         a.attempts, a.lock_id
  from aggiornati a;
$$;

revoke all on function public.automation_events_claim(integer, integer, integer) from public, anon, authenticated;
grant execute on function public.automation_events_claim(integer, integer, integer) to service_role;

-- L'età dell'evento più vecchio ancora da trattare (§169). È la misura che
-- risponde a «il worker sta girando?» con un numero invece che con
-- un'impressione: se cresce, qualcosa è fermo.
--
-- ⚠️ `security definer` PER FORZA, e la ragione va scritta: `automation_events`
-- non ha alcun GRANT per `authenticated`, quindi una funzione `security
-- invoker` fallirebbe con «permission denied» per chiunque la chiamasse. La
-- difesa è la prima riga del WHERE — solo un amministratore dell'azienda
-- richiesta ottiene dei numeri — ed è l'unica difesa che c'è, esattamente come
-- in `company_member_directory` (0016). Escono CONTEGGI, mai una riga.
--
-- ⚠️ E RIFIUTA, NON RISPONDE ZERO. Un'aggregazione senza `group by` restituisce
-- SEMPRE una riga: con un semplice `and is_company_admin(...)` nel WHERE, chi
-- non è amministratore otterrebbe «nessun arretrato» invece di «non ti è
-- permesso» — cioè una risposta rassicurante a una domanda che non aveva il
-- diritto di fare. È la forma di fallback silenzioso che questo progetto
-- considera il difetto peggiore, e qui costa tre righe evitarla.
create or replace function public.automation_backlog(p_company_id uuid)
returns table (pending integer, dead_letter integer, oldest_pending_seconds integer)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not public.is_company_admin(p_company_id) then
    raise exception 'automation_backlog_forbidden'
      using errcode = '42501',
            hint = 'Lo stato del motore lo legge chi amministra l''azienda.';
  end if;

  return query
  select
    count(*) filter (where e.processing_status in ('pending', 'processing'))::integer,
    count(*) filter (where e.processing_status = 'dead_letter')::integer,
    coalesce(extract(epoch from (now() - min(e.occurred_at)
      filter (where e.processing_status in ('pending', 'processing'))))::integer, 0)
  from public.automation_events e
  where e.company_id = p_company_id;
end $$;

revoke all on function public.automation_backlog(uuid) from public, anon;
grant execute on function public.automation_backlog(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 14. Il guardiano delle regole
--
-- Quattro cose che il database non lascia decidere a chi scrive:
--   · l'AUTORE e chi MODIFICA devono essere membri dell'azienda della regola;
--   · la VERSIONE cresce quando cambia la configurazione, e non quando cambia
--     il nome: una run che dichiara «versione 3» deve riferirsi a una
--     configurazione diversa dalla 2, altrimenti il numero non significa nulla;
--   · `activated_at` lo scrive il database, e una regola non si può attivare
--     senza almeno un'azione — una regola che non fa niente, attiva, è solo un
--     modo di credere che qualcosa stia succedendo;
--   · il TETTO di regole attive per azienda (§166/§73).
--
-- La validazione SEMANTICA — questo campo esiste? questa azione esiste? questo
-- segnaposto è valido? — non è qui: sta nel registro tipizzato, che è l'unico
-- posto in cui quei nomi esistono. Duplicarla in SQL avrebbe creato due elenchi
-- destinati a divergere, ed è la stessa ragione per cui la scrittura passa da
-- una Edge Function e non dal browser.
-- ---------------------------------------------------------------------------
create or replace function public.workflows_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_active integer;
  v_max    integer := (public.automation_limits() ->> 'maxActiveWorkflows')::integer;
  v_changed boolean;
begin
  new.name := btrim(new.name);

  -- (a) Appartenenza. Vale anche per il service role: la Edge Function scrive
  --     `created_by` con l'utente che ha premuto il pulsante, e se quella
  --     persona non è dell'azienda la riga non entra.
  if new.created_by is not null and not exists (
    select 1 from public.company_members m
    where m.company_id = new.company_id and m.user_id = new.created_by
  ) then
    raise exception 'workflow_author_not_member'
      using errcode = '23514', hint = 'L''autore non appartiene a questa azienda.';
  end if;
  if new.updated_by is not null and not exists (
    select 1 from public.company_members m
    where m.company_id = new.company_id and m.user_id = new.updated_by
  ) then
    raise exception 'workflow_editor_not_member'
      using errcode = '23514', hint = 'Chi modifica non appartiene a questa azienda.';
  end if;

  -- (b) Versione: cresce solo quando cambia ciò che il motore esegue.
  if tg_op = 'UPDATE' then
    v_changed :=
      new.trigger_type    is distinct from old.trigger_type
      or new.condition_match is distinct from old.condition_match
      or new.conditions   is distinct from old.conditions
      or new.actions      is distinct from old.actions;
    if v_changed then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
  end if;

  -- (c) Attivazione.
  if new.status = 'active' then
    if jsonb_array_length(new.actions) < 1 then
      raise exception 'workflow_no_actions'
        using errcode = '23514', hint = 'Una regola attiva deve avere almeno un''azione.';
    end if;
    if tg_op = 'INSERT' or old.status is distinct from 'active' then
      new.activated_at := now();
      select count(*) into v_active
        from public.workflow_definitions w
       where w.company_id = new.company_id and w.status = 'active' and w.id <> new.id;
      if v_active >= v_max then
        raise exception 'workflow_too_many_active'
          using errcode = '23514',
                hint = 'È stato raggiunto il numero massimo di automazioni attive.';
      end if;
    end if;
    -- Una regola che torna attiva riparte pulita: i fallimenti contati
    -- riguardavano una configurazione che chi ha riattivato ha già rivisto.
    if tg_op = 'UPDATE' and old.status is distinct from 'active' then
      new.consecutive_failures := 0;
      new.attention_code := null;
      new.attention_at := null;
    end if;
  end if;

  -- (d) Il codice di attenzione porta sempre la propria data: un avviso senza
  --     quando è un avviso di cui non si sa se è di oggi o di marzo.
  if new.attention_code is null then
    new.attention_at := null;
  elsif tg_op = 'INSERT' or old.attention_code is distinct from new.attention_code then
    new.attention_at := now();
  else
    new.attention_at := coalesce(old.attention_at, now());
  end if;

  -- (e) Archiviazione: il timbro lo mette il database.
  if new.status = 'archived' then
    if tg_op = 'INSERT' or old.status is distinct from 'archived' then
      new.archived_at := now();
      new.archived_by := coalesce(v_actor, new.updated_by);
    else
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
    end if;
  else
    new.archived_at := null;
    new.archived_by := null;
  end if;

  return new;
end $$;

drop trigger if exists trg_workflows_guard on public.workflow_definitions;
create trigger trg_workflows_guard
  before insert or update on public.workflow_definitions
  for each row execute function public.workflows_guard();

drop trigger if exists trg_workflows_updated on public.workflow_definitions;
create trigger trg_workflows_updated
  before update on public.workflow_definitions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 15. Lo storico delle regole, scritto dai trigger
-- ---------------------------------------------------------------------------
create or replace function public.workflows_record_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- L'attore è chi ha premuto il pulsante. Con il service role `auth.uid()` è
  -- nullo, e allora vale `updated_by`, che la Edge Function ha già verificato
  -- essere l'utente autenticato: è l'unico modo per non attribuire al «sistema»
  -- ciò che ha deciso una persona.
  --
  -- ⚠️ NESSUN RIPIEGO SU `created_by`, e la ragione è una riga di storico che
  -- avrebbe detto il falso. Quando il motore mette in pausa una regola da sé
  -- dopo errori ripetuti (§104), scrive `updated_by = null` proprio perché non
  -- l'ha decisa nessuno: con il ripiego su `created_by` lo storico avrebbe
  -- attribuito la pausa a chi la regola l'aveva SCRITTA, magari mesi prima.
  -- Un registro che attribuisce a una persona una decisione del sistema è la
  -- stessa classe di difetto del «Non assegnata ha creato l'attività» trovato
  -- nel Work Hub: non rompe niente, dice una cosa che non è vera.
  v_actor uuid := coalesce(auth.uid(), new.updated_by);
begin
  if tg_op = 'INSERT' then
    insert into public.workflow_events (company_id, workflow_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, coalesce(auth.uid(), new.created_by), 'created',
            jsonb_build_object('trigger', new.trigger_type, 'status', new.status));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.workflow_events (company_id, workflow_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor,
            case
              when new.status = 'active'   then 'activated'::public.workflow_audit_kind
              when new.status = 'paused'   then 'paused'::public.workflow_audit_kind
              when new.status = 'archived' then 'archived'::public.workflow_audit_kind
              when old.status = 'archived' then 'restored'::public.workflow_audit_kind
              else 'updated'::public.workflow_audit_kind
            end,
            jsonb_build_object('from', old.status, 'to', new.status,
                               'reason', new.attention_code));
  elsif new.version is distinct from old.version then
    insert into public.workflow_events (company_id, workflow_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor, 'updated',
            jsonb_build_object('version', new.version));
  end if;

  return new;
end $$;

drop trigger if exists trg_workflows_events on public.workflow_definitions;
create trigger trg_workflows_events
  after insert or update on public.workflow_definitions
  for each row execute function public.workflows_record_events();

-- ---------------------------------------------------------------------------
-- 16. Il guardiano delle esecuzioni
--
-- Le scrive solo il worker con il service role, ma la disciplina di questo
-- progetto è che una tabella si difenda comunque da sola: azienda della run =
-- azienda della regola, azienda dell'azione = azienda della run. Senza,
-- un'esecuzione potrebbe dichiarare l'azienda sbagliata e comparire nello
-- storico di chi non c'entra.
-- ---------------------------------------------------------------------------
create or replace function public.workflow_runs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select w.company_id into v_company
    from public.workflow_definitions w where w.id = new.workflow_id;
  if v_company is null or v_company is distinct from new.company_id then
    raise exception 'workflow_run_company_mismatch'
      using errcode = '23514', hint = 'L''esecuzione non appartiene all''azienda della regola.';
  end if;

  if new.trigger_event_id is not null and not exists (
    select 1 from public.automation_events e
    where e.id = new.trigger_event_id and e.company_id = new.company_id
  ) then
    raise exception 'workflow_run_event_mismatch'
      using errcode = '23514', hint = 'L''evento non appartiene a questa azienda.';
  end if;

  if new.completed_at is not null and new.started_at is not null then
    new.duration_ms := greatest(0, (extract(epoch from (new.completed_at - new.started_at)) * 1000)::integer);
  end if;

  return new;
end $$;

drop trigger if exists trg_workflow_runs_guard on public.workflow_runs;
create trigger trg_workflow_runs_guard
  before insert or update on public.workflow_runs
  for each row execute function public.workflow_runs_guard();

create or replace function public.workflow_action_runs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select r.company_id into v_company
    from public.workflow_runs r where r.id = new.workflow_run_id;
  if v_company is null or v_company is distinct from new.company_id then
    raise exception 'workflow_action_company_mismatch'
      using errcode = '23514', hint = 'L''azione non appartiene all''azienda dell''esecuzione.';
  end if;
  return new;
end $$;

drop trigger if exists trg_workflow_action_runs_guard on public.workflow_action_runs;
create trigger trg_workflow_action_runs_guard
  before insert or update on public.workflow_action_runs
  for each row execute function public.workflow_action_runs_guard();

-- ---------------------------------------------------------------------------
-- 17. Le regole che ascoltano un evento
--
-- ⚠️ QUI VIVONO DUE GARANZIE, E NESSUNA DELLE DUE È NEL WORKER.
--
--   §163 — `w.activated_at <= p_occurred_at`: una regola attivata alle 15
--   non reagisce a un documento analizzato alle 14. Attivare non fa ripartire
--   il passato, e la garanzia non è un `if` che qualcuno può dimenticare.
--
--   §69/§72 — una regola gira AL PIÙ UNA VOLTA per catena causale. È la riga
--   `not exists (… same correlation_id …)`, e da sola chiude tre casi:
--   il ciclo di una regola su sé stessa («quando nasce un'attività, crea
--   un'attività»), il ciclo A→B→A, e la ripetizione di una regola già eseguita
--   più in alto nella stessa storia. Le catene UTILI restano possibili: A che
--   causa B che causa C funziona, perché sono regole diverse.
-- ---------------------------------------------------------------------------
create or replace function public.workflows_for_event(
  p_company_id     uuid,
  p_event_type     public.automation_event_type,
  p_occurred_at    timestamptz,
  p_correlation_id uuid
)
returns table (
  id uuid, name text, version integer, trigger_type public.automation_event_type,
  condition_match text, conditions jsonb, actions jsonb
)
language sql
security definer
stable
set search_path = ''
as $$
  select w.id, w.name, w.version, w.trigger_type, w.condition_match, w.conditions, w.actions
  from public.workflow_definitions w
  where w.company_id = p_company_id
    and w.trigger_type = p_event_type
    and w.status = 'active'
    and w.activated_at is not null
    and w.activated_at <= p_occurred_at
    and not exists (
      select 1
      from public.workflow_runs r
      join public.automation_events e on e.id = r.trigger_event_id
      where r.workflow_id = w.id
        and e.correlation_id = p_correlation_id
    )
  order by w.created_at asc;
$$;

revoke all on function public.workflows_for_event(uuid, public.automation_event_type, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.workflows_for_event(uuid, public.automation_event_type, timestamptz, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 18. Le metriche di una regola (§102)
--
-- Numeri veri, non metriche di vanità: quante volte ha agito, quante azioni
-- sono andate a buon fine, quanti errori. Nessun conteggio delle volte in cui
-- non è scattata, perché quelle non sono righe (§101).
-- ---------------------------------------------------------------------------
create or replace function public.workflow_metrics(p_workflow_id uuid, p_days integer default 30)
returns table (runs integer, actions_done integer, actions_failed integer, errors integer)
language sql
stable
set search_path = ''
as $$
  with r as (
    select run.id, run.status
    from public.workflow_runs run
    join public.workflow_definitions w on w.id = run.workflow_id
    where run.workflow_id = p_workflow_id
      and (select public.is_company_member(w.company_id))
      and run.started_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
  )
  select
    (select count(*) from r)::integer,
    (select count(*) from public.workflow_action_runs a
      where a.workflow_run_id in (select id from r) and a.status = 'succeeded')::integer,
    (select count(*) from public.workflow_action_runs a
      where a.workflow_run_id in (select id from r) and a.status = 'failed')::integer,
    (select count(*) from r where r.status in ('failed', 'partial'))::integer;
$$;

revoke all on function public.workflow_metrics(uuid, integer) from public, anon;
grant execute on function public.workflow_metrics(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 19. RLS e permessi
--
-- La forma è quella di tutto il progetto: `revoke all` PRIMA dei grant, perché
-- su Supabase una tabella nuova nasce con i permessi di tabella completi per
-- `anon` e `authenticated` e un grant scritto dopo AGGIUNGE privilegi invece di
-- toglierne (lezione della 0014).
--
-- CHI LEGGE COSA
--   · `workflow_definitions`, `workflow_runs`, `workflow_action_runs`: ogni
--     MEMBRO. Non c'è niente di riservato — una regola dice cosa fa l'azienda,
--     e chi riceve un'attività creata da una regola ha diritto di sapere quale.
--   · `workflow_events` (chi ha attivato, chi ha messo in pausa): solo
--     AMMINISTRATORI, come `email_audit_log`. È informazione di governo.
--   · `automation_events`: NESSUNO oltre al service role. È la coda del motore,
--     non un dato di prodotto, e contiene la struttura della catena causale.
--
-- CHI SCRIVE: nessuno dal client, mai, su nessuna di queste tabelle.
-- ---------------------------------------------------------------------------
alter table public.automation_events     enable row level security;
alter table public.workflow_definitions  enable row level security;
alter table public.workflow_runs         enable row level security;
alter table public.workflow_action_runs  enable row level security;
alter table public.workflow_events       enable row level security;

revoke all on public.automation_events     from anon, authenticated, public;
revoke all on public.workflow_definitions  from anon, authenticated, public;
revoke all on public.workflow_runs         from anon, authenticated, public;
revoke all on public.workflow_action_runs  from anon, authenticated, public;
revoke all on public.workflow_events       from anon, authenticated, public;

grant select on public.workflow_definitions to authenticated;
grant select on public.workflow_runs        to authenticated;
grant select on public.workflow_action_runs to authenticated;
grant select on public.workflow_events      to authenticated;
-- `automation_events` NON compare: nessun grant, quindi nessuna policy potrebbe
-- comunque aprirla. È voluto — un permesso assente è più difficile da allentare
-- per sbaglio di una policy restrittiva (0013).

drop policy if exists workflows_select_member on public.workflow_definitions;
create policy workflows_select_member on public.workflow_definitions
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists workflow_runs_select_member on public.workflow_runs;
create policy workflow_runs_select_member on public.workflow_runs
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists workflow_action_runs_select_member on public.workflow_action_runs;
create policy workflow_action_runs_select_member on public.workflow_action_runs
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists workflow_events_select_admin on public.workflow_events;
create policy workflow_events_select_admin on public.workflow_events
  for select to authenticated using (public.is_company_admin(company_id));

-- ---------------------------------------------------------------------------
-- 20. Autoverifica: la migrazione controlla di aver ottenuto ciò che dichiara
--
-- Le due volte in cui questo progetto ha creduto a una garanzia senza provarla
-- — i permessi di colonna della 0013, `full-setup.sql` «rieseguibile» — la
-- garanzia non c'era. Qui la migrazione fallisce all'applicazione invece di
-- lasciar passare la falla.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  -- (a) Nessuna scrittura dal client su nessuna tabella dell'automazione.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('automation_events', 'workflow_definitions', 'workflow_runs',
                       'workflow_action_runs', 'workflow_events')
    and grantee in ('anon', 'authenticated', 'public')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if v_bad is not null then
    raise exception 'le automazioni risultano scrivibili dal client: %', v_bad;
  end if;

  -- (b) La coda non è nemmeno leggibile: contiene la struttura delle catene
  --     causali e non serve a nessuna schermata.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'automation_events'
    and grantee in ('anon', 'authenticated', 'public');
  if v_bad is not null then
    raise exception 'la coda degli eventi risulta accessibile dal client: %', v_bad;
  end if;

  -- (c) Le funzioni del solo server non sono eseguibili da un utente collegato.
  if exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name in ('automation_events_claim', 'automation_emit',
                           'automation_emit_overdue', 'workflows_for_event')
      and grantee in ('anon', 'authenticated', 'public')
  ) then
    raise exception 'una funzione del motore risulta eseguibile dal client';
  end if;
end $$;

