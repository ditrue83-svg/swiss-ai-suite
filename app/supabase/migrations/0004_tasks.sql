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
