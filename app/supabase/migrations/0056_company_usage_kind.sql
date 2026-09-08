-- ============================================================================
-- 0056 — Scopo esplicito del tenant: reale, demo o tecnico.
--
-- Nessuna azienda esistente viene indovinata: parte da `unclassified`. Il nome,
-- l'IDI incompleto e la quantità di test non bastano per dichiarare falsi dati
-- che possono provenire da una casella reale. La scelta appartiene al titolare.
--
-- Ogni cambio lascia una riga append-only. `technical` è riservato al server:
-- un utente non può trasformare una normale azienda in un tenant che i processi
-- operativi tratteranno come usa-e-getta.
-- ============================================================================

do $$ begin
  create type public.company_usage_kind as enum (
    'unclassified', 'live', 'demo', 'technical'
  );
exception when duplicate_object then null; end $$;

alter table public.companies
  add column if not exists usage_kind public.company_usage_kind
  not null default 'unclassified';

comment on column public.companies.usage_kind is
  'Scopo dichiarato del tenant. Non descrive la veridicità dei singoli record e non viene dedotto dai dati.';

create table if not exists public.company_usage_kind_events (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  before_kind public.company_usage_kind not null,
  after_kind  public.company_usage_kind not null,
  changed_by  uuid,
  created_at  timestamptz not null default now(),
  check (before_kind <> after_kind)
);

create index if not exists idx_company_usage_kind_events_company_time
  on public.company_usage_kind_events (company_id, created_at desc);

alter table public.company_usage_kind_events enable row level security;
revoke all on public.company_usage_kind_events from public, anon, authenticated;
grant select on public.company_usage_kind_events to authenticated;

drop policy if exists company_usage_kind_events_select_admin
  on public.company_usage_kind_events;
create policy company_usage_kind_events_select_admin
  on public.company_usage_kind_events for select to authenticated
  using (public.is_company_admin(company_id));

create or replace function public.company_usage_kind_guard_and_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.usage_kind is not distinct from old.usage_kind then
    return new;
  end if;

  if (new.usage_kind = 'technical' or old.usage_kind = 'technical')
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'company_usage_kind_technical_reserved' using errcode = '42501';
  end if;

  insert into public.company_usage_kind_events
    (company_id, before_kind, after_kind, changed_by)
  values (new.id, old.usage_kind, new.usage_kind, auth.uid());
  return new;
end $$;

revoke all on function public.company_usage_kind_guard_and_log() from public;

drop trigger if exists trg_company_usage_kind on public.companies;
create trigger trg_company_usage_kind
  before update of usage_kind on public.companies
  for each row execute function public.company_usage_kind_guard_and_log();

