-- ============================================================================
-- AI-Swisse — 0057: completamento Fase 2 CRM
--   1. permanenza corrente per fase, esiti storici e motivi di perdita;
--   2. filtro per controparte nel Work Hub.
--
-- Nessuna probabilità assegnata alle fasi. I numeri derivano soltanto dai
-- passaggi realmente registrati e dagli esiti won/lost presenti nel database.
-- ============================================================================

-- La permanenza comincia dall'ultimo ingresso nella fase corrente. Per la fase
-- iniziale, quando non esiste ancora un evento di cambio, comincia da created_at.
create or replace function public.crm_pipeline_stage_metrics(p_company_id uuid)
returns table (
  stage public.crm_opportunity_stage,
  opportunity_count integer,
  average_days_in_stage numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with current_entries as (
    select p.stage,
           coalesce((
             select max(e.occurred_at)
               from public.crm_events e
              where e.opportunity_id = p.id
                and e.kind = 'opportunity_stage_changed'
                and e.detail ->> 'to' = p.stage::text
           ), p.created_at) as entered_at
      from public.crm_opportunities p
     where p.company_id = p_company_id
       and public.is_company_member(p.company_id)
       and p.archived_at is null
  )
  select c.stage,
         count(*)::integer,
         round(avg(greatest(0, extract(epoch from (now() - c.entered_at)) / 86400.0)), 1)
    from current_entries c
   group by c.stage
   order by c.stage;
$$;

comment on function public.crm_pipeline_stage_metrics(uuid) is
  'Permanenza media delle opportunità oggi presenti in ogni fase, misurata '
  'dall ultimo ingresso registrato. Non è una probabilità di chiusura.';

create or replace function public.crm_pipeline_outcomes(p_company_id uuid)
returns table (
  won_count integer,
  lost_count integer,
  win_rate numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select count(*) filter (where p.stage = 'won')::integer,
         count(*) filter (where p.stage = 'lost')::integer,
         case
           when count(*) filter (where p.stage in ('won', 'lost')) = 0 then null
           else round(
             100.0 * count(*) filter (where p.stage = 'won')
             / count(*) filter (where p.stage in ('won', 'lost')),
             1
           )
         end
   from public.crm_opportunities p
   where p.company_id = p_company_id
     and public.is_company_member(p.company_id)
     and p.stage in ('won', 'lost')
  having public.is_company_member(p_company_id);
$$;

comment on function public.crm_pipeline_outcomes(uuid) is
  'Esiti correnti vinti/persi e tasso storico osservato. Le opportunità aperte '
  'non entrano nel denominatore e le archiviate non spariscono nei conteggi.';

create or replace function public.crm_pipeline_loss_reasons(p_company_id uuid)
returns table (
  reason text,
  opportunity_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select nullif(btrim(p.lost_reason), '') as reason,
         count(*)::integer
   from public.crm_opportunities p
   where p.company_id = p_company_id
     and public.is_company_member(p.company_id)
     and p.stage = 'lost'
   group by nullif(btrim(p.lost_reason), '')
   order by count(*) desc, reason nulls last;
$$;

comment on function public.crm_pipeline_loss_reasons(uuid) is
  'Motivi di perdita aggregati dalle opportunità perse. NULL significa che il '
  'motivo facoltativo non è stato registrato.';

revoke all on function public.crm_pipeline_stage_metrics(uuid) from public, anon;
revoke all on function public.crm_pipeline_outcomes(uuid) from public, anon;
revoke all on function public.crm_pipeline_loss_reasons(uuid) from public, anon;
grant execute on function public.crm_pipeline_stage_metrics(uuid) to authenticated;
grant execute on function public.crm_pipeline_outcomes(uuid) to authenticated;
grant execute on function public.crm_pipeline_loss_reasons(uuid) to authenticated;

-- `create or replace` non può cambiare la firma: si sostituisce esplicitamente
-- la funzione a nove argomenti con quella che aggiunge il filtro controparte.
revoke all on function public.list_tasks(uuid, text, public.task_status, public.task_priority, public.task_source, uuid, text, integer, integer)
  from public, anon, authenticated;
drop function public.list_tasks(uuid, text, public.task_status, public.task_priority, public.task_source, uuid, text, integer, integer);

create function public.list_tasks(
  p_company_id  uuid,
  p_view        text default 'todo',
  p_status      public.task_status default null,
  p_priority    public.task_priority default null,
  p_source      public.task_source default null,
  p_assignee    uuid default null,
  p_search      text default null,
  p_limit       integer default 25,
  p_offset      integer default 0,
  p_crm_organization_id uuid default null
)
returns table (
  id uuid, company_id uuid, created_by uuid, document_id uuid,
  title text, description text, authority text, due_date date, appointment_date date,
  priority public.task_priority, status public.task_status, source public.task_source,
  assignee_user_id uuid, completed_at timestamptz, completed_by uuid,
  archived_at timestamptz, archived_by uuid, created_at timestamptz, updated_at timestamptz,
  assignee_name text, email_message_id uuid, total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with filtered as (
    select t.*
      from public.tasks t
     where t.company_id = p_company_id
       and case p_view
             when 'todo'      then t.status <> 'completed' and t.archived_at is null
             when 'mine'      then t.assignee_user_id = auth.uid() and t.status <> 'completed' and t.archived_at is null
             when 'overdue'   then t.status <> 'completed' and t.archived_at is null
                                   and t.due_date is not null and t.due_date < current_date
             when 'completed' then t.status = 'completed' and t.archived_at is null
             when 'archived'  then t.archived_at is not null
             else t.archived_at is null
           end
       and (p_status is null or t.status = p_status)
       and (p_priority is null or t.priority = p_priority)
       and (p_source is null or t.source = p_source)
       and (p_assignee is null or t.assignee_user_id = p_assignee)
       and (p_crm_organization_id is null or t.crm_organization_id = p_crm_organization_id)
       and (
         p_search is null or btrim(p_search) = ''
         or t.title ilike '%' || btrim(p_search) || '%'
         or coalesce(t.description, '') ilike '%' || btrim(p_search) || '%'
         or coalesce(t.authority, '') ilike '%' || btrim(p_search) || '%'
       )
  )
  select
    f.id, f.company_id, f.created_by, f.document_id,
    f.title, f.description, f.authority, f.due_date, f.appointment_date,
    f.priority, f.status, f.source,
    f.assignee_user_id, f.completed_at, f.completed_by,
    f.archived_at, f.archived_by, f.created_at, f.updated_at,
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), ''),
    (select d.email_message_id
       from public.email_message_documents d
      where d.document_id = f.document_id
      order by d.created_at asc
      limit 1),
    count(*) over ()
  from filtered f
  left join public.profiles p on p.id = f.assignee_user_id
  order by
    case when f.status <> 'completed' and f.due_date is not null and f.due_date < current_date
         then 0 else 1 end,
    case f.priority when 'high' then 0 when 'medium' then 1 else 2 end,
    f.due_date asc nulls last,
    f.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.list_tasks(uuid, text, public.task_status, public.task_priority, public.task_source, uuid, text, integer, integer, uuid)
  from public, anon;
grant execute on function public.list_tasks(uuid, text, public.task_status, public.task_priority, public.task_source, uuid, text, integer, integer, uuid)
  to authenticated;
