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
