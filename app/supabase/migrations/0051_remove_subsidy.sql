-- 0051 — Decisione di prodotto D-13: rimozione definitiva del modulo.
--
-- ATTENZIONE OPERATIVA: prima di applicare questa migrazione in produzione il
-- catalogo deve essere esportato nell'archivio concordato. L'export non fa
-- parte di questa migrazione e la cancellazione qui sotto è irreversibile.

begin;

-- I dati condivisi che puntano al modulo escono prima degli oggetti proprietari.
-- Le configurazioni sono dati: anche una regola con un innesco diverso può
-- contenere una condizione o un'azione riferita al modulo rimosso.
delete from public.notifications
 where type::text like 'subsidy_%'
    or entity_type in ('subsidy_opportunity', 'subsidy_case');

delete from public.workflow_definitions
 where trigger_type::text like 'subsidy_%'
    or conditions::text ilike '%subsidy%'
    or actions::text ilike '%subsidy%';

delete from public.workflow_runs
 where entity_type in ('subsidy_opportunity', 'subsidy_case');

delete from public.automation_events
 where event_type::text like 'subsidy_%'
    or entity_type in ('subsidy_opportunity', 'subsidy_case');

delete from public.tasks
 where source::text = 'subsidy_ai'
    or subsidy_case_id is not null;

-- I vincoli condivisi tornano al perimetro effettivamente supportato.
alter table public.automation_events drop constraint if exists automation_events_entity_type_check;
alter table public.workflow_runs drop constraint if exists workflow_runs_entity_type_check;
alter table public.notifications drop constraint if exists notifications_entity_type_check;

alter table public.automation_events
  add constraint automation_events_entity_type_check
  check (entity_type in ('document', 'email_message', 'task', 'contract',
                         'crm_organization', 'crm_opportunity'));
alter table public.workflow_runs
  add constraint workflow_runs_entity_type_check
  check (entity_type in ('document', 'email_message', 'task', 'contract',
                         'crm_organization', 'crm_opportunity'));
alter table public.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('task', 'calendar_connection', 'document', 'email_message',
                         'contract', 'crm_organization', 'crm_opportunity'));

-- La categoria documentale storica non viene riclassificata in silenzio. Il
-- controllo reale prima della PR conta zero righe; se il dato cambia fra export
-- e deploy, l'intera transazione si ferma e chiede una decisione umana.
do $document_category_empty$
begin
  if exists (
    select 1 from public.documents where category::text = 'subsidies'
  ) then
    raise exception '0051: esistono documenti nella categoria dismessa; nessuna riclassificazione automatica eseguita';
  end if;
end $document_category_empty$;

-- PostgreSQL lega i tipi enum alle firme e ai risultati delle funzioni. Le
-- definizioni vive vengono catturate dal catalogo applicato, poi ripristinate
-- dopo il cambio di tipo: così la 0051 non mantiene una seconda copia di RPC
-- lunghe e non rischia di riportarle a una versione storica.
create temporary table _0051_document_category_functions (
  ordinal bigint primary key,
  definition text not null
) on commit drop;

insert into _0051_document_category_functions (ordinal, definition)
select f.ordinality, pg_get_functiondef(f.function_oid)
from unnest(array[
  'public.document_category_from_analysis(text,text)'::regprocedure,
  'public.documents_autoclassify()'::regprocedure,
  'public.list_documents(uuid,text,public.document_category,boolean,public.document_source_type,text,uuid[],date,date,boolean,boolean,text,integer,integer,uuid)'::regprocedure,
  'public.document_category_counts(uuid,boolean)'::regprocedure,
  'public.documents_bulk_set_category(uuid,uuid[],public.document_category)'::regprocedure,
  'public.contract_document_suggestions(uuid,integer)'::regprocedure
]) with ordinality as f(function_oid, ordinality);

drop trigger if exists trg_documents_autoclassify on public.document_analyses;

-- Le funzioni che espongono gli enum condivisi vanno ricreate dopo il cambio
-- di tipo. REVOKE precede sempre il nuovo GRANT.
revoke all on function public.document_category_from_analysis(text, text) from public, anon, authenticated;
revoke all on function public.documents_autoclassify() from public, anon, authenticated;
revoke all on function public.list_documents(uuid, text, public.document_category, boolean, public.document_source_type, text, uuid[], date, date, boolean, boolean, text, integer, integer, uuid) from public, anon, authenticated;
revoke all on function public.document_category_counts(uuid, boolean) from public, anon, authenticated;
revoke all on function public.documents_bulk_set_category(uuid, uuid[], public.document_category) from public, anon, authenticated;
revoke all on function public.contract_document_suggestions(uuid, integer) from public, anon, authenticated;

drop function public.documents_autoclassify();
drop function public.document_category_from_analysis(text, text);
drop function public.list_documents(uuid, text, public.document_category, boolean, public.document_source_type, text, uuid[], date, date, boolean, boolean, text, integer, integer, uuid);
drop function public.document_category_counts(uuid, boolean);
drop function public.documents_bulk_set_category(uuid, uuid[], public.document_category);
drop function public.contract_document_suggestions(uuid, integer);

revoke all on function public.list_tasks(uuid, text, public.task_status, public.task_priority, public.task_source, uuid, text, integer, integer) from public, anon, authenticated;
drop function public.list_tasks(uuid, text, public.task_status, public.task_priority, public.task_source, uuid, text, integer, integer);
revoke all on function public.calendar_tasks(uuid, date, date, boolean, public.task_status, public.task_priority, uuid, boolean, integer) from public, anon, authenticated;
drop function public.calendar_tasks(uuid, date, date, boolean, public.task_status, public.task_priority, uuid, boolean, integer);
revoke all on function public.automation_emit(uuid, public.automation_event_type, text, uuid, jsonb, text, uuid) from public, anon, authenticated;
drop function public.automation_emit(uuid, public.automation_event_type, text, uuid, jsonb, text, uuid);
revoke all on function public.automation_events_claim(integer, integer, integer) from public, anon, authenticated;
drop function public.automation_events_claim(integer, integer, integer);
revoke all on function public.workflows_for_event(uuid, public.automation_event_type, timestamptz, uuid) from public, anon, authenticated;
drop function public.workflows_for_event(uuid, public.automation_event_type, timestamptz, uuid);

-- PostgreSQL non rimuove singole etichette dagli enum: si ricreano i tipi
-- condivisi dopo avere eliminato le righe che usavano le etichette dismesse.
alter type public.document_category rename to document_category_removed_0051;
create type public.document_category as enum (
  'taxes', 'social_insurance', 'administration', 'contracts', 'invoices',
  'insurance', 'banking', 'employees', 'clients', 'suppliers', 'other'
);
alter table public.documents alter column category type public.document_category
  using category::text::public.document_category;
drop type public.document_category_removed_0051;

do $recreate_document_category_functions$
declare v_definition text;
begin
  for v_definition in
    select definition from _0051_document_category_functions order by ordinal
  loop
    execute v_definition;
  end loop;
end $recreate_document_category_functions$;

comment on function public.document_category_from_analysis(text, text) is
  'Categoria ricavata da tipo di documento e tipo di ente. Torna NULL quando il segnale non basta.';

create trigger trg_documents_autoclassify
  after insert on public.document_analyses
  for each row execute function public.documents_autoclassify();

revoke all on function public.list_documents(uuid, text, public.document_category, boolean, public.document_source_type, text, uuid[], date, date, boolean, boolean, text, integer, integer, uuid) from public, anon;
grant execute on function public.list_documents(uuid, text, public.document_category, boolean, public.document_source_type, text, uuid[], date, date, boolean, boolean, text, integer, integer, uuid) to authenticated;
revoke all on function public.document_category_counts(uuid, boolean) from public, anon;
grant execute on function public.document_category_counts(uuid, boolean) to authenticated;
revoke all on function public.documents_bulk_set_category(uuid, uuid[], public.document_category) from public, anon;
grant execute on function public.documents_bulk_set_category(uuid, uuid[], public.document_category) to authenticated;
revoke all on function public.contract_document_suggestions(uuid, integer) from public, anon;
grant execute on function public.contract_document_suggestions(uuid, integer) to authenticated;

alter type public.task_source rename to task_source_removed_0051;
create type public.task_source as enum ('admin_ai', 'manual', 'workflow', 'crm');
alter table public.tasks alter column source drop default;
alter table public.tasks alter column source type public.task_source
  using source::text::public.task_source;
alter table public.tasks alter column source set default 'manual'::public.task_source;
drop type public.task_source_removed_0051;

alter type public.notification_type rename to notification_type_removed_0051;
create type public.notification_type as enum (
  'task_assigned', 'task_due_soon', 'task_due_today', 'task_overdue',
  'unassigned_task_due_soon', 'calendar_sync_failed', 'calendar_reauth_required',
  'workflow_alert', 'crm_opportunity_assigned'
);
alter table public.notifications alter column type type public.notification_type
  using type::text::public.notification_type;
drop type public.notification_type_removed_0051;

alter type public.automation_event_type rename to automation_event_type_removed_0051;
create type public.automation_event_type as enum (
  'document_analysis_completed', 'document_category_changed', 'email_attention_ready',
  'task_created', 'task_status_changed', 'task_became_overdue',
  'finance_item_needs_review', 'finance_item_ready',
  'contract_verified', 'contract_review_required',
  'contract_milestone_verified', 'contract_milestone_window_opened',
  'crm_organization_created', 'crm_role_added', 'crm_opportunity_created',
  'crm_opportunity_stage_changed', 'crm_opportunity_won', 'crm_follow_up_due',
  'crm_follow_up_sequence_due'
);
alter table public.automation_events alter column event_type type public.automation_event_type
  using event_type::text::public.automation_event_type;
alter table public.workflow_definitions alter column trigger_type type public.automation_event_type
  using trigger_type::text::public.automation_event_type;
drop type public.automation_event_type_removed_0051;

alter table public.tasks drop column subsidy_case_id;

-- RPC e trigger del modulo: la forma regprocedure include la firma e copre
-- senza ambiguità anche eventuali overload introdotti dalla storia applicata.
do $cleanup_functions$
declare v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and (p.proname like 'subsidy_%' or p.proname = 'is_case_member')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_function);
    execute format('drop function %s cascade', v_function);
  end loop;
end $cleanup_functions$;

drop view if exists public.subsidy_catalog_reviews_expanded cascade;

drop table if exists public.subsidy_case_events cascade;
drop table if exists public.subsidy_case_documents cascade;
drop table if exists public.subsidy_criterion_results cascade;
drop table if exists public.subsidy_assessments cascade;
drop table if exists public.subsidy_opportunities cascade;
drop table if exists public.subsidy_answers cascade;
drop table if exists public.subsidy_project_interpretations cascade;
drop table if exists public.subsidy_project_partners cascade;
drop table if exists public.subsidy_project_documents cascade;
drop table if exists public.subsidy_projects cascade;
drop table if exists public.subsidy_catalog_reviews cascade;
drop table if exists public.subsidy_catalog_editors cascade;
drop table if exists public.subsidy_calls cascade;
drop table if exists public.subsidy_program_rules cascade;
drop table if exists public.subsidy_program_versions cascade;
drop table if exists public.subsidy_source_snapshots cascade;
drop table if exists public.subsidy_source_fetches cascade;
drop table if exists public.subsidy_sources cascade;
drop table if exists public.subsidy_case_items cascade;
drop table if exists public.subsidy_matches cascade;
drop table if exists public.subsidy_cases cascade;
drop table if exists public.subsidy_programs cascade;

do $cleanup_types$
declare v_type text;
begin
  for v_type in
    select t.typname
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public'
       and (t.typname like 'subsidy_%' or t.typname = 'eligibility_status')
  loop
    execute format('drop type public.%I cascade', v_type);
  end loop;
end $cleanup_types$;

-- Il profilo operativo esisteva soltanto per il confronto rimosso. L'identità
-- aziendale (IDI/CHE, cantone, comune e forma giuridica) resta su companies.
revoke all on function public.create_company_with_owner(text, text, text, text, text, text, integer, text) from public, anon, authenticated;
drop function public.create_company_with_owner(text, text, text, text, text, text, integer, text);
drop table if exists public.company_profiles cascade;

create function public.create_company_with_owner(
  p_legal_name text,
  p_uid_che text default null,
  p_canton text default null,
  p_municipality text default null,
  p_legal_form text default null
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

  return v_company_id;
end;
$$;
revoke all on function public.create_company_with_owner(text, text, text, text, text) from public, anon;
grant execute on function public.create_company_with_owner(text, text, text, text, text) to authenticated;

-- RECREATED_FUNCTIONS
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
  id uuid, company_id uuid, created_by uuid, document_id uuid,
  title text, description text, authority text, due_date date, appointment_date date,
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
    f.id, f.company_id, f.created_by, f.document_id,
    f.title, f.description, f.authority, f.due_date, f.appointment_date,
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
create or replace function public.calendar_tasks(
  p_company_id      uuid,
  p_from            date,
  p_to              date,
  p_mine            boolean default false,
  p_status          public.task_status default null,
  p_priority        public.task_priority default null,
  p_assignee        uuid default null,
  p_include_overdue boolean default true,
  p_limit           integer default 500
)
returns table (
  id uuid, title text, due_date date, appointment_date date,
  on_date date, date_kind text,
  priority public.task_priority, status public.task_status, source public.task_source,
  assignee_user_id uuid, assignee_name text, document_id uuid
)
language sql
stable
set search_path = ''
as $$
  with base as (
    select
      t.id, t.title, t.due_date, t.appointment_date, t.priority, t.status, t.source,
      t.assignee_user_id, t.document_id, t.created_at,
      nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as assignee_name
    from public.tasks t
    left join public.profiles p on p.id = t.assignee_user_id
    where t.company_id = p_company_id
      and t.archived_at is null
      and (not coalesce(p_mine, false) or t.assignee_user_id = auth.uid())
      and (p_status   is null or t.status = p_status)
      and (p_priority is null or t.priority = p_priority)
      and (p_assignee is null or t.assignee_user_id = p_assignee)
  ),
  placed as (
    -- I TERMINI: la finestra, più le scadute che restano pertinenti.
    select b.*, b.due_date as on_date, 'deadline'::text as date_kind
    from base b
    where b.due_date is not null
      and (
        (b.due_date >= p_from and b.due_date <= p_to)
        -- ⚠️ "<=" e non "<". Il database vive in UTC, l'utente in Europe/Zurich:
        -- alle 00:30 locali di giovedì, per Postgres è ancora mercoledì, e
        -- un'attività scaduta mercoledì non rientrerebbe in "due_date <
        -- current_date". Un giorno di margine costa una riga in più e chiude la
        -- finestra. Qui si SELEZIONA soltanto: che cosa sia «in ritardo» lo
        -- decide "isOverdue()" in taskFormat, la stessa funzione che usano
        -- Attività e Panoramica. Due definizioni di «scaduta» sono due
        -- schermate che prima o poi si contraddicono.
        or (coalesce(p_include_overdue, true)
            and b.status <> 'completed'
            and b.due_date <= current_date)
      )

    union all

    -- GLI APPUNTAMENTI: la finestra e basta. Nessun recupero del passato.
    select b.*, b.appointment_date as on_date, 'appointment'::text as date_kind
    from base b
    where b.appointment_date is not null
      and b.appointment_date >= p_from
      and b.appointment_date <= p_to
  )
  select
    u.id, u.title, u.due_date, u.appointment_date,
    u.on_date, u.date_kind,
    u.priority, u.status, u.source,
    u.assignee_user_id, u.assignee_name, u.document_id
  from placed u
  order by u.on_date asc,
    case u.priority when 'high' then 0 when 'medium' then 1 else 2 end,
    u.created_at desc
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

revoke all on function public.calendar_tasks(uuid, date, date, boolean, public.task_status, public.task_priority, uuid, boolean, integer) from public, anon;
grant execute on function public.calendar_tasks(uuid, date, date, boolean, public.task_status, public.task_priority, uuid, boolean, integer) to authenticated;
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

-- Autoverifica: nessun oggetto o dato condiviso del perimetro rimosso resta.
do $verify$
declare v_count integer;
begin
  select count(*) into v_count
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname like 'subsidy_%';
  if v_count <> 0 then raise exception '0051: relazioni residue: %', v_count; end if;

  select count(*) into v_count
    from pg_type t join pg_namespace n on n.oid = t.typnamespace
   where n.nspname = 'public' and (t.typname like 'subsidy_%' or t.typname = 'eligibility_status');
  if v_count <> 0 then raise exception '0051: tipi residui: %', v_count; end if;

  if exists (select 1 from public.tasks where source::text = 'subsidy_ai') then
    raise exception '0051: origine attività residua';
  end if;
  if exists (select 1 from public.notifications where type::text like 'subsidy_%') then
    raise exception '0051: notifiche residue';
  end if;
  if exists (select 1 from public.automation_events where event_type::text like 'subsidy_%')
     or exists (select 1 from public.workflow_definitions where trigger_type::text like 'subsidy_%') then
    raise exception '0051: eventi o regole residue';
  end if;
  if exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
      join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'document_category'
       and e.enumlabel = 'subsidies'
  ) then
    raise exception '0051: categoria documentale residua';
  end if;
end $verify$;

commit;
