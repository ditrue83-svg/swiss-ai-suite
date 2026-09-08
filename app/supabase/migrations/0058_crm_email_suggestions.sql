-- ============================================================================
-- 0058 — CRM: SUGGERIMENTI DALLE EMAIL (FASE 3.3)
--
-- L'Inbox ha già classificato il messaggio e già conosce `is_bulk`. Questa
-- migrazione usa quei due fatti senza riclassificare nulla: propone soltanto i
-- mittenti azionabili, non massivi e non di servizio. Nessuna scheda nasce e
-- nessuna email viene collegata senza la conferma di una persona.
--
-- Il filtro rispecchia `deservesSuggestion()` in `crmMatch.ts`. La scansione è
-- separata da quella di contratti/Finanze per poter essere provata e osservata
-- da sola; il worker somma i due conteggi nello stesso indicatore.
-- ============================================================================

create or replace function public.crm_email_deserves_suggestion(
  p_sender_email text,
  p_is_bulk boolean,
  p_relevance public.email_relevance
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with parts as (
    select public.crm_norm_email(p_sender_email) as email,
           split_part(public.crm_norm_email(p_sender_email), '@', 1) as local_part
  ), service_words(word) as (
    values
      ('noreply'), ('donotreply'), ('noresponse'),
      ('newsletter'), ('newsletters'), ('mailer'), ('mailerdaemon'),
      ('mailing'), ('mailings'), ('bounce'), ('bounces'), ('postmaster'),
      ('listserv'), ('notification'), ('notifications'), ('notifica'),
      ('notifiche'), ('automated'), ('automatic'), ('autoreply')
  )
  select p.email is not null
     and position('@' in p.email) > 1
     and not coalesce(p_is_bulk, false)
     and coalesce(p_relevance in ('likely_actionable', 'possibly_actionable'), false)
     and not exists (
       select 1
         from service_words w
        where regexp_replace(p.local_part, '[._+\-]', '', 'g') = w.word
           or exists (
             select 1
               from unnest(regexp_split_to_array(p.local_part, '[._+]')) part
              where regexp_replace(part, '-', '', 'g') = w.word
           )
     )
    from parts p;
$$;

comment on function public.crm_email_deserves_suggestion(text, boolean, public.email_relevance) is
  'Copia SQL dichiarata di deservesSuggestion(): usa la classificazione già '
  'prodotta dall Inbox e scarta posta massiva e caselle di servizio.';


create or replace function public.crm_scan_email_link_suggestions(
  p_limit integer default 200
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r          record;
  v_created  integer := 0;
  v_limit    integer := greatest(coalesce(p_limit, 200), 0);
  v_target   uuid;
  v_matches  integer;
  v_reason   public.crm_match_reason;
  v_detail   text;
  v_key      text;
begin
  -- È un lavoro di sistema. Il service role arriva senza `auth.uid()`; una
  -- sessione utente non può usare una funzione security definer come scorciatoia.
  if auth.uid() is not null then
    raise exception 'crm_scan_email_suggestions_not_callable_by_user'
      using errcode = '42501',
            hint = 'La scansione dei suggerimenti email e un lavoro di sistema.';
  end if;

  for r in
    select m.id, m.company_id, m.sender_name, m.sender_email
      from public.email_messages m
     where m.direction = 'in'
       and public.crm_email_deserves_suggestion(m.sender_email, m.is_bulk, m.relevance)
       and not exists (
         select 1 from public.crm_organization_emails l
          where l.company_id = m.company_id and l.email_message_id = m.id)
       and not exists (
         select 1 from public.crm_contact_emails l
          where l.company_id = m.company_id and l.email_message_id = m.id)
       and not exists (
         select 1 from public.crm_link_suggestions s
          where s.company_id = m.company_id
            and s.source_entity_type = 'email_message'
            and s.source_entity_id = m.id
            and s.status = 'pending')
     order by m.received_at desc, m.id desc
     limit v_limit
  loop
    -- Prima l'identità: un recapito uguale, direttamente sull'organizzazione o
    -- su una persona che vi è collegata. Due risultati sono ambigui: niente.
    select count(*)::integer, (array_agg(x.organization_id))[1]
      into v_matches, v_target
      from (
        select distinct coalesce(cm.organization_id, co.organization_id) as organization_id
          from public.crm_contact_methods cm
          left join lateral (
            select rel.organization_id
              from public.crm_contact_organizations rel
             where rel.contact_id = cm.contact_id and rel.active_until is null
             order by rel.is_primary desc, rel.created_at
             limit 1
          ) co on true
         where cm.company_id = r.company_id
           and cm.type = 'email'
           and cm.normalized_value = public.crm_norm_email(r.sender_email)
           and coalesce(cm.organization_id, co.organization_id) is not null
      ) x;

    if v_matches > 1 then continue; end if;

    if v_matches = 1 then
      v_reason := 'email_exact';
      v_detail := public.crm_norm_email(r.sender_email);
    else
      -- Poi il dominio aziendale, mai quelli pubblici. Anche qui due schede
      -- candidate significano che la macchina non sa quale scegliere.
      select count(*)::integer, (array_agg(o.id order by o.created_at))[1]
        into v_matches, v_target
        from public.crm_organizations o
       where o.company_id = r.company_id
         and o.archived_at is null
         and o.merged_into_id is null
         and o.website_domain = public.crm_norm_domain(r.sender_email)
         and not public.crm_is_public_domain(o.website_domain);

      if v_matches > 1 then continue; end if;

      if v_matches = 1 then
        v_reason := 'domain_match';
        v_detail := public.crm_norm_domain(r.sender_email);
      else
        v_target := null;
        v_reason := 'extracted_name';
        v_detail := r.sender_email;
      end if;
    end if;

    v_key := 'crm:email_message:' || r.id::text || ':' || v_reason::text || ':'
             || coalesce(v_target::text, 'new');

    insert into public.crm_link_suggestions (
      company_id, source_entity_type, source_entity_id,
      suggested_organization_id, suggested_name, suggested_email,
      reason, reason_detail, status, dedupe_key)
    values (
      r.company_id, 'email_message', r.id, v_target,
      coalesce(nullif(btrim(r.sender_name), ''), r.sender_email), r.sender_email,
      v_reason, v_detail, 'pending', v_key)
    on conflict (company_id, dedupe_key) do nothing;

    if found then v_created := v_created + 1; end if;
  end loop;

  -- Il riferimento è polimorfico: la pulizia esplicita evita proposte che
  -- aprirebbero un messaggio ormai cancellato. Le risposte già date restano storia.
  delete from public.crm_link_suggestions s
   where s.status = 'pending'
     and s.source_entity_type = 'email_message'
     and not exists (select 1 from public.email_messages m where m.id = s.source_entity_id);

  return v_created;
end;
$$;

comment on function public.crm_scan_email_link_suggestions(integer) is
  'Propone collegamenti CRM per mittenti email filtrati da deservesSuggestion. '
  'Non crea anagrafiche e non collega messaggi.';

revoke all on function public.crm_email_deserves_suggestion(text, boolean, public.email_relevance)
  from public, anon, authenticated;
revoke all on function public.crm_scan_email_link_suggestions(integer)
  from public, anon, authenticated;
grant execute on function public.crm_email_deserves_suggestion(text, boolean, public.email_relevance)
  to service_role;
grant execute on function public.crm_scan_email_link_suggestions(integer)
  to service_role;

do $$
declare
  v_security_definer boolean;
  v_user_execute integer;
begin
  select p.prosecdef into v_security_definer
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'crm_scan_email_link_suggestions';
  if v_security_definer is distinct from true then
    raise exception 'crm_scan_email_link_suggestions deve essere security definer';
  end if;

  select count(*) into v_user_execute
    from (values ('anon'), ('authenticated')) r(role_name)
   where has_function_privilege(
     r.role_name, 'public.crm_scan_email_link_suggestions(integer)', 'execute');
  if v_user_execute <> 0 then
    raise exception 'la scansione email e eseguibile da ruoli browser';
  end if;
end;
$$;
