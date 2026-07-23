-- ============================================================================
-- SwissAI Suite — SETUP COMPLETO DATABASE (Fase 1)
-- Incolla TUTTO questo file nel SQL Editor di Supabase ed esegui una volta.
-- Contiene, in ordine: 0001 core · 0002 documents · 0003 subsidy · 0004 tasks · 0005 storage
-- ============================================================================


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0001_core.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0002_documents.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0003_subsidy.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0004_tasks.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

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


-- >>>>>>>>>>>>>>>>>>>>>>>>>>>>>> migrations/0005_storage.sql <<<<<<<<<<<<<<<<<<<<<<<<<<<<<<

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

