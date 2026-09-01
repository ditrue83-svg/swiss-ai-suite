-- ==========================================================================
-- 0050 — CRM Light, Fase 1.3: sequenze di follow-up sulle trattative.
--
-- La configurazione e' un DATO: sequenze + passi. Il motore resta quello delle
-- automazioni e usa soltanto due delle sei azioni a rischio basso: crea
-- attivita' e notifica. Nessuna email viene inviata da questa migrazione.
-- ==========================================================================

alter type public.automation_event_type add value if not exists 'crm_follow_up_sequence_due';

alter table public.workflow_definitions
  add column if not exists managed_source text,
  add column if not exists managed_entity_id uuid;

alter table public.workflow_definitions
  drop constraint if exists workflow_managed_source_valid;
alter table public.workflow_definitions
  add constraint workflow_managed_source_valid check (
    (managed_source is null and managed_entity_id is null)
    or (managed_source = 'crm_follow_up_sequences' and managed_entity_id is null)
  );

create unique index if not exists uq_workflow_follow_up_managed
  on public.workflow_definitions (company_id, managed_source)
  where managed_source = 'crm_follow_up_sequences';

create table if not exists public.crm_follow_up_sequences (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 80),
  stage public.crm_opportunity_stage not null,
  is_active boolean not null default true,
  activated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  constraint crm_follow_up_sequence_open_stage check (stage not in ('won', 'lost'))
);

-- Una sola sequenza attiva per fase: altrimenti la stessa trattativa avrebbe
-- due risposte diverse alla domanda «qual e' il prossimo passo?». Le sequenze
-- in pausa possono convivere e restano storia, non vengono cancellate.
create unique index if not exists uq_crm_follow_up_sequence_active_stage
  on public.crm_follow_up_sequences (company_id, stage)
  where is_active and archived_at is null;

create table if not exists public.crm_follow_up_steps (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sequence_id uuid not null references public.crm_follow_up_sequences(id) on delete cascade,
  position integer not null check (position between 1 and 10),
  silence_days integer not null check (silence_days between 1 and 365),
  task_title text not null check (length(btrim(task_title)) between 1 and 200),
  email_template_id uuid references public.crm_email_templates(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint uq_crm_follow_up_step_position unique (sequence_id, position),
  constraint uq_crm_follow_up_step_delay unique (sequence_id, silence_days)
);

-- Il verbale minimo della scansione. Non e' una seconda coda: l'evento vero
-- resta automation_events. Questa tabella rende interrogabile il «prossimo
-- passo» e chiude l'idempotenza prima ancora che il worker prenda l'evento.
create table if not exists public.crm_follow_up_emissions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sequence_id uuid not null references public.crm_follow_up_sequences(id) on delete cascade,
  step_id uuid references public.crm_follow_up_steps(id) on delete set null,
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  outbound_email_id uuid not null references public.email_messages(id) on delete cascade,
  automation_event_id uuid references public.automation_events(id) on delete set null,
  emitted_on date not null default current_date,
  created_at timestamptz not null default now(),
  constraint uq_crm_follow_up_emission_cycle
    unique (sequence_id, step_id, opportunity_id, outbound_email_id),
  constraint uq_crm_follow_up_emission_day
    unique (sequence_id, step_id, opportunity_id, emitted_on)
);

comment on table public.crm_follow_up_sequences is
  'Configurazione aziendale delle sequenze: una fase aperta e passi ordinati. Nessuna azione di contatto.';
comment on table public.crm_follow_up_steps is
  'Un passo scatta N giorni dopo l ultima email CRM uscente se non esistono risposte o interazioni successive.';
comment on column public.crm_follow_up_steps.email_template_id is
  'Suggerimento per il composer umano. Il motore non invia mai il template.';
comment on table public.crm_follow_up_emissions is
  'Verbale idempotente delle emissioni per sequenza, passo, trattativa e ciclo di email uscente.';

create index if not exists idx_crm_follow_up_steps_sequence
  on public.crm_follow_up_steps (sequence_id, position);
create index if not exists idx_crm_follow_up_emissions_opportunity
  on public.crm_follow_up_emissions (opportunity_id, outbound_email_id, created_at);

-- --------------------------------------------------------------------------
-- Guardie cross-tenant. Valgono anche per service_role: una funzione security
-- definer non puo' affidarsi alla RLS.
-- --------------------------------------------------------------------------
create or replace function public.crm_guard_follow_up_step()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_sequence_company uuid;
  v_template_company uuid;
begin
  select company_id into v_sequence_company
    from public.crm_follow_up_sequences where id = new.sequence_id;
  if v_sequence_company is distinct from new.company_id then
    raise exception 'crm_follow_up_sequence_company_mismatch' using errcode = '23514';
  end if;
  if new.email_template_id is not null then
    select company_id into v_template_company
      from public.crm_email_templates where id = new.email_template_id;
    if v_template_company is distinct from new.company_id then
      raise exception 'crm_follow_up_template_company_mismatch' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_follow_up_step_guard on public.crm_follow_up_steps;
create trigger trg_crm_follow_up_step_guard
  before insert or update on public.crm_follow_up_steps
  for each row execute function public.crm_guard_follow_up_step();

create or replace function public.crm_guard_follow_up_emission()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.crm_follow_up_sequences s
     where s.id = new.sequence_id and s.company_id = new.company_id
  ) or not exists (
    select 1 from public.crm_opportunities o
     where o.id = new.opportunity_id and o.company_id = new.company_id
  ) or not exists (
    select 1 from public.email_messages e
     where e.id = new.outbound_email_id and e.company_id = new.company_id
       and e.direction = 'out'
  ) then
    raise exception 'crm_follow_up_emission_company_mismatch' using errcode = '23514';
  end if;
  if new.step_id is not null and not exists (
    select 1 from public.crm_follow_up_steps st
     where st.id = new.step_id and st.sequence_id = new.sequence_id
       and st.company_id = new.company_id
  ) then
    raise exception 'crm_follow_up_emission_step_mismatch' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_follow_up_emission_guard on public.crm_follow_up_emissions;
create trigger trg_crm_follow_up_emission_guard
  before insert or update on public.crm_follow_up_emissions
  for each row execute function public.crm_guard_follow_up_emission();

-- --------------------------------------------------------------------------
-- Un solo workflow tecnico per azienda. Le sequenze decidono QUANDO; il
-- workflow usa il registro chiuso per decidere COSA: create_task + notifica.
-- --------------------------------------------------------------------------
create or replace function public.crm_ensure_follow_up_workflow(p_company_id uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_active boolean;
begin
  select exists (
    select 1 from public.crm_follow_up_sequences
     where company_id = p_company_id and is_active and archived_at is null
  ) into v_active;

  select id into v_id from public.workflow_definitions
   where company_id = p_company_id and managed_source = 'crm_follow_up_sequences';

  if v_id is null then
    insert into public.workflow_definitions (
      company_id, name, description, status, trigger_type, condition_match,
      conditions, actions, activated_at, managed_source
    ) values (
      p_company_id, 'CRM follow-up sequences',
      'Managed by CRM follow-up settings. Creates work and notifications; never sends email.',
      case when v_active then 'active'::public.workflow_status else 'paused'::public.workflow_status end,
      'crm_follow_up_sequence_due', 'all',
      '[{"field":"follow_up.still_silent","operator":"equals","value":true}]'::jsonb,
      '[{"key":"create_task","config":{"titleTemplate":"{{follow_up.task_title}}","priority":"medium","assigneeMode":"owner","dueDate":"in_days","dueDateDays":0,"linkEntity":true}},{"key":"create_notification","config":{"recipient":"assignee","messageTemplate":"{{follow_up.task_title}}"}}]'::jsonb,
      case when v_active then now() else null end,
      'crm_follow_up_sequences'
    ) returning id into v_id;
  else
    update public.workflow_definitions
       set status = case when v_active then 'active'::public.workflow_status else 'paused'::public.workflow_status end,
           activated_at = case
             when v_active and status <> 'active' then now()
             when v_active then activated_at
             else null
           end,
           updated_at = now()
     where id = v_id;
  end if;
  return v_id;
end $$;

-- Salvataggio atomico: il browser non scrive direttamente le tabelle. Il tipo
-- e la struttura dei passi vengono verificati una volta sola nel database.
create or replace function public.crm_save_follow_up_sequence(
  p_company_id uuid,
  p_sequence_id uuid,
  p_name text,
  p_stage public.crm_opportunity_stage,
  p_is_active boolean,
  p_steps jsonb
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_user uuid := (select auth.uid());
  v_step jsonb;
  v_pos integer := 0;
  v_previous_days integer := 0;
  v_days integer;
  v_template uuid;
begin
  if v_user is null or not public.is_company_admin(p_company_id) then
    raise exception 'crm_follow_up_forbidden' using errcode = '42501';
  end if;
  if p_stage in ('won', 'lost') or length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'crm_follow_up_invalid_sequence' using errcode = '23514';
  end if;
  if jsonb_typeof(p_steps) <> 'array' or jsonb_array_length(p_steps) not between 1 and 10 then
    raise exception 'crm_follow_up_invalid_steps' using errcode = '23514';
  end if;

  if p_sequence_id is null then
    insert into public.crm_follow_up_sequences (
      company_id, name, stage, is_active, activated_at, created_by, updated_by
    ) values (
      p_company_id, btrim(p_name), p_stage, p_is_active,
      case when p_is_active then now() else null end, v_user, v_user
    )
    returning id into v_id;
  else
    update public.crm_follow_up_sequences
       set name = btrim(p_name), stage = p_stage, is_active = p_is_active,
           activated_at = case when p_is_active then now() else null end,
           updated_by = v_user, updated_at = now()
     where id = p_sequence_id and company_id = p_company_id and archived_at is null
     returning id into v_id;
    if v_id is null then raise exception 'crm_follow_up_not_found' using errcode = 'P0002'; end if;
    delete from public.crm_follow_up_steps where sequence_id = v_id;
  end if;

  for v_step in select value from jsonb_array_elements(p_steps)
  loop
    v_pos := v_pos + 1;
    v_days := nullif(v_step->>'silenceDays', '')::integer;
    v_template := nullif(v_step->>'emailTemplateId', '')::uuid;
    if v_days is null or v_days < 1 or v_days > 365 or v_days <= v_previous_days
       or length(btrim(coalesce(v_step->>'taskTitle', ''))) not between 1 and 200 then
      raise exception 'crm_follow_up_invalid_step' using errcode = '23514';
    end if;
    insert into public.crm_follow_up_steps (
      company_id, sequence_id, position, silence_days, task_title, email_template_id
    ) values (
      p_company_id, v_id, v_pos, v_days, btrim(v_step->>'taskTitle'), v_template
    );
    v_previous_days := v_days;
  end loop;

  perform public.crm_ensure_follow_up_workflow(p_company_id);
  return v_id;
end $$;

create or replace function public.crm_archive_follow_up_sequence(
  p_company_id uuid, p_sequence_id uuid
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid := (select auth.uid());
begin
  if v_user is null or not public.is_company_admin(p_company_id) then
    raise exception 'crm_follow_up_forbidden' using errcode = '42501';
  end if;
  update public.crm_follow_up_sequences
     set is_active = false, archived_at = now(), archived_by = v_user,
         updated_by = v_user, updated_at = now()
   where id = p_sequence_id and company_id = p_company_id and archived_at is null;
  if not found then raise exception 'crm_follow_up_not_found' using errcode = 'P0002'; end if;
  perform public.crm_ensure_follow_up_workflow(p_company_id);
end $$;

-- --------------------------------------------------------------------------
-- Misura del silenzio.
--
-- 1. l'ultima email out deve essere successiva all'ingresso nella fase;
-- 2. una email in dello stesso contatto o collegata alla trattativa ferma;
-- 3. QUALSIASI interazione registrata sulla controparte dopo l'out ferma;
-- 4. una fase diversa, won/lost o archiviata ferma prima della scansione.
-- --------------------------------------------------------------------------
create or replace function public.crm_emit_follow_up_sequences(p_limit integer default 200)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_event uuid;
  v_emission uuid;
  v_count integer := 0;
begin
  for r in
    with candidates as (
      select s.id as sequence_id, st.id as step_id, st.position, st.silence_days,
             st.task_title, st.email_template_id,
             o.id as opportunity_id, o.company_id, o.organization_id,
             o.owner_user_id, outmail.email_id as outbound_email_id,
             outmail.sent_at as outbound_at
        from public.crm_follow_up_sequences s
        join public.crm_follow_up_steps st on st.sequence_id = s.id
        join public.crm_opportunities o
          on o.company_id = s.company_id and o.stage = s.stage
        cross join lateral (
          select e.id as email_id, coalesce(e.sent_at, e.created_at) as sent_at
            from public.crm_opportunity_emails oe
            join public.email_messages e on e.id = oe.email_message_id
           where oe.opportunity_id = o.id and oe.company_id = o.company_id
             and e.company_id = o.company_id and e.direction = 'out'
             and e.delivery_status in ('sent', 'delivered')
             and coalesce(e.sent_at, e.created_at) >= coalesce((
               select max(ev.occurred_at) from public.crm_events ev
                where ev.opportunity_id = o.id and ev.kind = 'opportunity_stage_changed'
             ), o.created_at)
           order by coalesce(e.sent_at, e.created_at) desc, e.id desc
           limit 1
        ) outmail
       where s.is_active and s.archived_at is null
         and o.archived_at is null and o.stage not in ('won', 'lost')
         and outmail.sent_at >= s.activated_at
         and outmail.sent_at <= now() - make_interval(days => st.silence_days)
         and not exists (
           select 1 from public.crm_follow_up_steps earlier
            where earlier.sequence_id = s.id and earlier.position < st.position
              and not exists (
                select 1 from public.crm_follow_up_emissions done
                 where done.sequence_id = s.id and done.step_id = earlier.id
                   and done.opportunity_id = o.id
                   and done.outbound_email_id = outmail.email_id
              )
         )
         and not exists (
           select 1 from public.crm_follow_up_emissions done
            where done.sequence_id = s.id and done.step_id = st.id
              and done.opportunity_id = o.id
              and done.outbound_email_id = outmail.email_id
         )
         and not exists (
           select 1 from public.email_messages incoming
            where incoming.company_id = o.company_id and incoming.direction = 'in'
              and coalesce(incoming.received_at, incoming.created_at) > outmail.sent_at
              and (
                exists (select 1 from public.crm_opportunity_emails ioe
                         where ioe.opportunity_id = o.id and ioe.email_message_id = incoming.id)
                or exists (
                  select 1 from public.crm_contact_emails ice
                  join public.crm_outgoing_email_recipients recipient
                    on recipient.email_message_id = outmail.email_id
                  join public.crm_contact_methods method
                    on method.id = recipient.contact_method_id
                   where ice.email_message_id = incoming.id
                     and ice.contact_id = method.contact_id
                )
              )
         )
         and not exists (
           select 1 from public.crm_interactions i
            where i.company_id = o.company_id and i.organization_id = o.organization_id
              and i.occurred_at > outmail.sent_at
              and (i.opportunity_id = o.id or i.opportunity_id is null)
         )
       order by outmail.sent_at, st.position, o.id
       limit greatest(p_limit, 0)
    )
    select * from candidates
  loop
    insert into public.crm_follow_up_emissions (
      company_id, sequence_id, step_id, opportunity_id, outbound_email_id
    ) values (
      r.company_id, r.sequence_id, r.step_id, r.opportunity_id, r.outbound_email_id
    ) on conflict do nothing returning id into v_emission;

    if v_emission is null then continue; end if;

    v_event := public.automation_emit(
      r.company_id, 'crm_follow_up_sequence_due', 'crm_opportunity', r.opportunity_id,
      jsonb_build_object(
        'sequenceId', r.sequence_id, 'stepId', r.step_id,
        'outboundEmailId', r.outbound_email_id,
        'silenceDays', r.silence_days, 'taskTitle', r.task_title,
        'emailTemplateId', r.email_template_id
      ),
      'crm:sequence:' || r.sequence_id::text || ':step:' || r.step_id::text
        || ':opp:' || r.opportunity_id::text || ':out:' || r.outbound_email_id::text,
      null
    );
    update public.crm_follow_up_emissions set automation_event_id = v_event where id = v_emission;
    if v_event is not null then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

-- Rilettura stretta usata dal worker dopo il claim. Non si fida del payload:
-- il payload identifica soltanto le righe, questa funzione ricalcola il fatto.
create or replace function public.crm_follow_up_event_facts(
  p_company_id uuid, p_opportunity_id uuid, p_sequence_id uuid,
  p_step_id uuid, p_outbound_email_id uuid
)
returns table (
  sequence_id uuid, step_id uuid, silence_days integer, task_title text,
  email_template_id uuid, still_silent boolean
) language sql stable security definer set search_path = '' as $$
  with base as (
    select s.id as sequence_id, st.id as step_id, st.silence_days,
           st.task_title, st.email_template_id, o.id as opportunity_id,
           o.company_id, o.organization_id, o.stage, o.created_at
      from public.crm_follow_up_sequences s
      join public.crm_follow_up_steps st
        on st.sequence_id = s.id and st.company_id = s.company_id
      join public.crm_opportunities o on o.id = p_opportunity_id
       and o.company_id = s.company_id
     where s.id = p_sequence_id and st.id = p_step_id
       and s.company_id = p_company_id
  ), sent as (
    select b.*, e.id as email_id, coalesce(e.sent_at, e.created_at) as sent_at
      from base b
      left join public.crm_opportunity_emails oe
        on oe.opportunity_id = b.opportunity_id and oe.company_id = b.company_id
       and oe.email_message_id = p_outbound_email_id
      left join public.email_messages e on e.id = oe.email_message_id
       and e.company_id = b.company_id and e.direction = 'out'
       and e.delivery_status in ('sent', 'delivered')
  )
  select x.sequence_id, x.step_id, x.silence_days, x.task_title,
         x.email_template_id,
         x.email_id is not null
         and x.stage not in ('won', 'lost')
         and exists (
           select 1 from public.crm_follow_up_sequences active
           where active.id = x.sequence_id and active.is_active
              and active.archived_at is null and active.stage = x.stage
              and x.sent_at >= active.activated_at
         )
         and x.sent_at >= coalesce((
           select max(ev.occurred_at) from public.crm_events ev
            where ev.opportunity_id = x.opportunity_id
              and ev.kind = 'opportunity_stage_changed'
         ), x.created_at)
         and not exists (
           select 1 from public.crm_opportunity_emails newer_link
           join public.email_messages newer on newer.id = newer_link.email_message_id
            where newer_link.opportunity_id = x.opportunity_id
              and newer.direction = 'out' and newer.delivery_status in ('sent', 'delivered')
              and (coalesce(newer.sent_at, newer.created_at), newer.id)
                > (x.sent_at, x.email_id)
         )
         and not exists (
           select 1 from public.email_messages incoming
            where incoming.company_id = x.company_id and incoming.direction = 'in'
              and coalesce(incoming.received_at, incoming.created_at) > x.sent_at
              and (
                exists (select 1 from public.crm_opportunity_emails ioe
                         where ioe.opportunity_id = x.opportunity_id
                           and ioe.email_message_id = incoming.id)
                or exists (
                  select 1 from public.crm_contact_emails ice
                  join public.crm_outgoing_email_recipients recipient
                    on recipient.email_message_id = x.email_id
                  join public.crm_contact_methods method
                    on method.id = recipient.contact_method_id
                   where ice.email_message_id = incoming.id
                     and ice.contact_id = method.contact_id
                )
              )
         )
         and not exists (
           select 1 from public.crm_interactions i
            where i.company_id = x.company_id
              and i.organization_id = x.organization_id
              and i.occurred_at > x.sent_at
              and (i.opportunity_id = x.opportunity_id or i.opportunity_id is null)
         )
    from sent x;
$$;

-- Stato dichiarato nella scheda. Restituisce anche «in attesa di una nuova
-- email uscente» dopo risposta/interazione/cambio fase: una macchina non resta
-- invisibilmente attiva.
create or replace function public.crm_opportunity_follow_up_status(
  p_company_id uuid, p_opportunity_id uuid
)
returns table (
  sequence_id uuid, sequence_name text, sequence_active boolean,
  step_id uuid, step_position integer, silence_days integer, task_title text,
  email_template_id uuid, email_template_name text, due_at timestamptz,
  outbound_at timestamptz, state text
) language sql stable security invoker set search_path = '' as $$
  with base as (
    select o.*, s.id as sequence_id, s.name as sequence_name,
           s.is_active as sequence_active, s.activated_at as sequence_activated_at
      from public.crm_opportunities o
      join public.crm_follow_up_sequences s
        on s.company_id = o.company_id and s.stage = o.stage
       and s.is_active and s.archived_at is null
     where o.id = p_opportunity_id and o.company_id = p_company_id
       and o.archived_at is null and o.stage not in ('won', 'lost')
       and public.is_company_member(p_company_id)
  ), outbound as (
    select b.*, x.email_id, x.sent_at
      from base b
      left join lateral (
        select e.id as email_id, coalesce(e.sent_at, e.created_at) as sent_at
          from public.crm_opportunity_emails oe
          join public.email_messages e on e.id = oe.email_message_id
         where oe.opportunity_id = b.id and e.direction = 'out'
           and e.delivery_status in ('sent', 'delivered')
           and coalesce(e.sent_at, e.created_at) >= b.sequence_activated_at
           and coalesce(e.sent_at, e.created_at) >= coalesce((
             select max(ev.occurred_at) from public.crm_events ev
              where ev.opportunity_id = b.id and ev.kind = 'opportunity_stage_changed'
           ), b.created_at)
         order by coalesce(e.sent_at, e.created_at) desc, e.id desc limit 1
      ) x on true
  ), live as (
    select o.*,
      case when o.email_id is null then false else not exists (
        select 1 from public.email_messages incoming
         where incoming.company_id = o.company_id and incoming.direction = 'in'
           and coalesce(incoming.received_at, incoming.created_at) > o.sent_at
           and (
             exists (select 1 from public.crm_opportunity_emails ioe
                      where ioe.opportunity_id = o.id and ioe.email_message_id = incoming.id)
             or exists (
               select 1 from public.crm_contact_emails ice
               join public.crm_outgoing_email_recipients recipient
                 on recipient.email_message_id = o.email_id
               join public.crm_contact_methods method
                 on method.id = recipient.contact_method_id
                where ice.email_message_id = incoming.id
                  and ice.contact_id = method.contact_id
             )
           )
      ) and not exists (
        select 1 from public.crm_interactions i
         where i.company_id = o.company_id and i.organization_id = o.organization_id
           and i.occurred_at > o.sent_at
           and (i.opportunity_id = o.id or i.opportunity_id is null)
      ) end as still_silent
    from outbound o
  ), next_step as (
    select l.*, st.id as next_step_id, st.position, st.silence_days,
           st.task_title, st.email_template_id
      from live l
      left join lateral (
        select step.* from public.crm_follow_up_steps step
         where step.sequence_id = l.sequence_id
           and (l.email_id is null or not exists (
             select 1 from public.crm_follow_up_emissions e
              where e.sequence_id = l.sequence_id and e.step_id = step.id
                and e.opportunity_id = l.id and e.outbound_email_id = l.email_id
           ))
         order by step.position limit 1
      ) st on true
  )
  select n.sequence_id, n.sequence_name, n.sequence_active,
         n.next_step_id, n.position, n.silence_days, n.task_title,
         n.email_template_id, t.name,
         case when n.sent_at is not null and n.silence_days is not null
              then n.sent_at + make_interval(days => n.silence_days) end,
         n.sent_at,
         case when n.email_id is null then 'waiting_outbound'
              when not n.still_silent then 'stopped'
              when n.next_step_id is null then 'completed'
              else 'active' end
    from next_step n
    left join public.crm_email_templates t
      on t.id = n.email_template_id and t.company_id = n.company_id;
$$;

-- --------------------------------------------------------------------------
-- RLS e privilegi minimi. Revoke PRIMA dei grant.
-- --------------------------------------------------------------------------
alter table public.crm_follow_up_sequences enable row level security;
alter table public.crm_follow_up_steps enable row level security;
alter table public.crm_follow_up_emissions enable row level security;

revoke all on public.crm_follow_up_sequences from anon, authenticated, public;
revoke all on public.crm_follow_up_steps from anon, authenticated, public;
revoke all on public.crm_follow_up_emissions from anon, authenticated, public;

grant select on public.crm_follow_up_sequences to authenticated;
grant select on public.crm_follow_up_steps to authenticated;

drop policy if exists crm_follow_up_sequences_select on public.crm_follow_up_sequences;
create policy crm_follow_up_sequences_select on public.crm_follow_up_sequences
  for select to authenticated using ((select public.is_company_member(company_id)));
drop policy if exists crm_follow_up_steps_select on public.crm_follow_up_steps;
create policy crm_follow_up_steps_select on public.crm_follow_up_steps
  for select to authenticated using ((select public.is_company_member(company_id)));

revoke all on function public.crm_guard_follow_up_step() from public, anon, authenticated;
revoke all on function public.crm_guard_follow_up_emission() from public, anon, authenticated;
revoke all on function public.crm_ensure_follow_up_workflow(uuid) from public, anon, authenticated;
revoke all on function public.crm_save_follow_up_sequence(uuid, uuid, text, public.crm_opportunity_stage, boolean, jsonb) from public, anon;
revoke all on function public.crm_archive_follow_up_sequence(uuid, uuid) from public, anon;
revoke all on function public.crm_emit_follow_up_sequences(integer) from public, anon, authenticated;
revoke all on function public.crm_follow_up_event_facts(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.crm_opportunity_follow_up_status(uuid, uuid) from public, anon;

grant execute on function public.crm_save_follow_up_sequence(uuid, uuid, text, public.crm_opportunity_stage, boolean, jsonb) to authenticated;
grant execute on function public.crm_archive_follow_up_sequence(uuid, uuid) to authenticated;
grant execute on function public.crm_emit_follow_up_sequences(integer) to service_role;
grant execute on function public.crm_follow_up_event_facts(uuid, uuid, uuid, uuid, uuid) to service_role;
grant execute on function public.crm_opportunity_follow_up_status(uuid, uuid) to authenticated;

-- --------------------------------------------------------------------------
-- Autoverifica: forma, RLS, privilegi e ordine dei passi.
-- Non nomina il nuovo valore enum: 55P04 nella transazione della migrazione.
-- --------------------------------------------------------------------------
do $$
declare v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('crm_follow_up_sequences', 'crm_follow_up_steps', 'crm_follow_up_emissions')
     and not c.relrowsecurity;
  if v_bad is not null then raise exception '0050: RLS non attiva su %', v_bad; end if;

  select string_agg(p.table_name || ':' || p.privilege_type, ', ') into v_bad
    from information_schema.role_table_grants p
   where p.table_schema = 'public'
     and p.table_name in ('crm_follow_up_sequences', 'crm_follow_up_steps', 'crm_follow_up_emissions')
     and lower(p.grantee) in ('anon', 'public');
  if v_bad is not null then raise exception '0050: privilegi anon/public inattesi: %', v_bad; end if;

  select string_agg(p.table_name || ':' || p.privilege_type, ', ') into v_bad
    from information_schema.role_table_grants p
   where p.table_schema = 'public'
     and p.table_name in ('crm_follow_up_sequences', 'crm_follow_up_steps')
     and lower(p.grantee) = 'authenticated' and p.privilege_type <> 'SELECT';
  if v_bad is not null then raise exception '0050: client puo scrivere configurazione: %', v_bad; end if;

  if exists (
    select 1 from public.crm_follow_up_steps a
    join public.crm_follow_up_steps b on b.sequence_id = a.sequence_id
     and b.position > a.position and b.silence_days <= a.silence_days
  ) then raise exception '0050: passi non strettamente crescenti'; end if;
end $$;
