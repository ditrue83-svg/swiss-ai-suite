-- 0059 — La vista «Oggi» in list_tasks (Fase 3.1: mobile-first / PWA).
--
-- La pagina `/oggi` — la home da mobilità — risponde a una domanda precisa:
-- «cosa scade oggi?». Le viste esistenti non la sanno formulare: «todo»
-- include ciò che non ha scadenza, «overdue» si ferma a ieri. La data la
-- filtra il database, come ogni altro filtro di questa funzione: con mille
-- attività, scaricarle tutte per contare quelle di oggi sarebbe il modo in
-- cui una home smette di aprirsi.
--
-- Firma INVARIATA (p_view resta text): `create or replace` basta, nessun
-- drop — la trappola della 0057 («replace non cambia la firma») qui non
-- scatta. Il fuso è quello di sempre: `current_date` del server, lo stesso
-- della vista «overdue» due righe più sotto — una scadenza di oggi non è
-- «scaduta ieri» (la sezione 17 di test:shell-unit esiste per questo).

begin;

create or replace function public.list_tasks(
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
       -- Le viste. «archived» è l'unica che mostra le archiviate: ovunque
       -- altrove restano fuori, che è il senso dell'archiviazione. «today»
       -- (0059) è la domanda della home da mobilità: scade OGGI, non è fatta,
       -- non è messa via — le scadute restano alla vista «overdue», non qui.
       and case p_view
             when 'todo'      then t.status <> 'completed' and t.archived_at is null
             when 'mine'      then t.assignee_user_id = auth.uid() and t.status <> 'completed' and t.archived_at is null
             when 'overdue'   then t.status <> 'completed' and t.archived_at is null
                                   and t.due_date is not null and t.due_date < current_date
             when 'today'     then t.status <> 'completed' and t.archived_at is null
                                   and t.due_date = current_date
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
    -- La comunicazione da cui nasce, quando il documento collegato viene dalla
    -- posta. Non serve una colonna su `tasks`: la relazione esiste già.
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

-- Autoverifica: la vista «today» deve essere nella definizione RIUSCITA —
-- si legge dal catalogo (pg_get_functiondef), non si esegue una prova sul
-- corpo: la prova comportamentale sta in test:crm, che la chiama davvero.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'list_tasks'
     and pg_get_function_identity_arguments(p.oid)
       = 'p_company_id uuid, p_view text, p_status task_status, p_priority task_priority, p_source task_source, p_assignee uuid, p_search text, p_limit integer, p_offset integer, p_crm_organization_id uuid';
  if v_def is null then
    raise exception '0059 autoverifica fallita: list_tasks a dieci argomenti non trovata';
  end if;
  if v_def not like '%when ''today''%' then
    raise exception '0059 autoverifica fallita: la vista «today» non è nella definizione';
  end if;
end $$;

commit;
