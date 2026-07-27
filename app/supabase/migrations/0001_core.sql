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
