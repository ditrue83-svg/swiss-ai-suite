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
