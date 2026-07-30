-- ============================================================================
-- 0028 — CRM: LO STORICO NON DEVE IMPEDIRE LA CASCATA
--
-- ⚠️⚠️ IL DIFETTO CHE QUESTA MIGRAZIONE CHIUDE RENDEVA UN'AZIENDA
-- INCANCELLABILE, e non l'ha trovato una rilettura: l'ha trovato
-- `npm run test:crm` alla PRIMA esecuzione contro il database vero, nella
-- sezione della cascata.
--
-- Che cosa accadeva. Cancellando un'azienda, `on delete cascade` porta via
-- `crm_organizations` e con loro `crm_organization_roles`. I trigger di storico
-- sono `after delete`: scattano su ogni riga figlia e INSERISCONO in
-- `crm_events` una riga `role_removed` con `old.company_id` e
-- `old.organization_id`. Ma quei due genitori sono già spariti nella stessa
-- transazione, e l'inserimento viola la chiave esterna:
--
--     insert or update on table "crm_events" violates foreign key
--     constraint "crm_events_company_id_fkey"
--
-- L'intera cancellazione va in rollback. Conseguenza reale: un'azienda con una
-- sola controparte e un solo ruolo non si poteva più cancellare — né da un test,
-- né da una richiesta di cancellazione dei dati, né dal dashboard.
--
-- ⚠️ È ESATTAMENTE LA CLASSE DELLA 0023, dove i trigger di immutabilità di
-- Finanze vietavano anche il `delete` e nessun documento con una fattura era più
-- cancellabile. Stessa lezione: una garanzia scritta guardando il caso normale
-- va provata anche contro il caso in cui tutto se ne va.
--
-- LA CORREZIONE. Nel ramo `delete` di ogni trigger di storico si controlla che i
-- genitori esistano ANCORA. Se non esistono, non si scrive niente e si esce: la
-- storia di un'entità che sparisce sparisce con lei — è già ciò che dice
-- `crm_events.organization_id ... on delete cascade`, e scrivere una riga
-- mentre il suo referente viene distrutto non aggiungerebbe alcuna informazione.
--
-- ⚠️ DUE controlli e non uno. Il primo caso (l'azienda se ne va) si prende con
-- `companies`; il secondo — cancellare UNA organizzazione, che il service role
-- può fare — lascia l'azienda in piedi e porta via solo l'organizzazione, e là
-- a fallire sarebbe la chiave esterna su `organization_id`.
--
-- ⚠️ CIÒ CHE NON CAMBIA: la fusione (`crm_merge_organizations`) cancella i ruoli
-- del record secondario mentre azienda e organizzazione ESISTONO entrambe,
-- quindi continua a scrivere il proprio `role_removed`. La traccia della fusione
-- resta completa: è il caso normale, e il caso normale non si tocca.
--
-- Requisiti: 0026 applicata. Indipendente dalla 0027 (Company Assistant): non
-- tocca nessuna delle sue tabelle e può essere applicata prima o dopo di essa.
-- ⚠️ Il numero è 0028 e non 0027 perché una 0027 esiste già: due migrazioni con
-- lo stesso numero verrebbero ordinate per NOME da `db:bundle`, e l'ordine di
-- applicazione dipenderebbe dal caso.
-- Prova: `npm run test:crm`, sezione «Cascata — cancellata l'azienda non resta
-- niente», tredici asserzioni, una per tabella.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. I ruoli
-- ---------------------------------------------------------------------------
create or replace function public.crm_log_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
    values (new.company_id, new.organization_id, 'role_added',
            jsonb_build_object('role', new.role), auth.uid());
    return null;
  end if;

  -- L'azienda o l'organizzazione stanno sparendo: con loro sparisce la storia.
  if not exists (select 1 from public.companies c where c.id = old.company_id) then
    return null;
  end if;
  if not exists (select 1 from public.crm_organizations o where o.id = old.organization_id) then
    return null;
  end if;

  insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
  values (old.company_id, old.organization_id, 'role_removed',
          jsonb_build_object('role', old.role), auth.uid());
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Le persone dentro un'organizzazione
-- ---------------------------------------------------------------------------
create or replace function public.crm_log_contact_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_events (company_id, organization_id, contact_id, kind, detail, actor_user_id)
    values (new.company_id, new.organization_id, new.contact_id, 'contact_linked',
            jsonb_build_object('jobTitle', new.job_title), auth.uid());
    return null;
  end if;

  if not exists (select 1 from public.companies c where c.id = old.company_id) then
    return null;
  end if;
  if not exists (select 1 from public.crm_organizations o where o.id = old.organization_id) then
    return null;
  end if;
  -- ⚠️ Anche il CONTATTO: cancellando una persona si portano via i suoi
  -- rapporti, e `crm_events.contact_id` punta a lei con `on delete cascade`.
  if not exists (select 1 from public.crm_contacts p where p.id = old.contact_id) then
    return null;
  end if;

  insert into public.crm_events (company_id, organization_id, contact_id, kind, detail, actor_user_id)
  values (old.company_id, old.organization_id, old.contact_id, 'contact_unlinked',
          '{}'::jsonb, auth.uid());
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 3. I collegamenti alle entità degli altri moduli, lato organizzazione
-- ---------------------------------------------------------------------------
create or replace function public.crm_log_org_entity_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity public.crm_linked_entity := tg_argv[0]::public.crm_linked_entity;
begin
  if tg_op = 'INSERT' then
    insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
    values (new.company_id, new.organization_id, 'entity_linked',
            jsonb_build_object('entity', v_entity, 'reason', new.match_reason), auth.uid());
    return null;
  end if;

  if not exists (select 1 from public.companies c where c.id = old.company_id) then
    return null;
  end if;
  if not exists (select 1 from public.crm_organizations o where o.id = old.organization_id) then
    return null;
  end if;

  insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
  values (old.company_id, old.organization_id, 'entity_unlinked',
          jsonb_build_object('entity', v_entity), auth.uid());
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Lo stesso, lato persona
-- ---------------------------------------------------------------------------
create or replace function public.crm_log_contact_entity_link()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entity public.crm_linked_entity := tg_argv[0]::public.crm_linked_entity;
begin
  if tg_op = 'INSERT' then
    insert into public.crm_events (company_id, contact_id, kind, detail, actor_user_id)
    values (new.company_id, new.contact_id, 'entity_linked',
            jsonb_build_object('entity', v_entity, 'reason', new.match_reason), auth.uid());
    return null;
  end if;

  if not exists (select 1 from public.companies c where c.id = old.company_id) then
    return null;
  end if;
  if not exists (select 1 from public.crm_contacts p where p.id = old.contact_id) then
    return null;
  end if;

  insert into public.crm_events (company_id, contact_id, kind, detail, actor_user_id)
  values (old.company_id, old.contact_id, 'entity_unlinked',
          jsonb_build_object('entity', v_entity), auth.uid());
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. «Ultimo contatto» durante una cascata
--
-- `crm_touch_last_contact` scatta `after delete` su `crm_organization_emails` e
-- su `crm_interactions`, e chiama `crm_refresh_last_contact`, che fa un `update`
-- su `crm_organizations`. Durante una cascata quella riga non c'è più e
-- l'`update` non trova nulla: non è un errore, ma è lavoro inutile ripetuto per
-- ogni riga cancellata. Con l'uscita anticipata la cancellazione di un'azienda
-- con mille comunicazioni collegate non fa mille update a vuoto.
-- ---------------------------------------------------------------------------
create or replace function public.crm_touch_last_contact()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org uuid;
begin
  -- ⚠️ Rami SEPARATI e non un `case`: un'espressione sola che nomina insieme
  -- `old` e `new` viene preparata per intero, e su un INSERT `old` non è
  -- assegnata.
  if tg_op = 'DELETE' then
    v_org := old.organization_id;
  else
    v_org := new.organization_id;
  end if;

  if v_org is null then
    return null;
  end if;

  -- Se l'organizzazione sta sparendo non c'è niente da ricalcolare.
  if not exists (select 1 from public.crm_organizations o where o.id = v_org) then
    return null;
  end if;

  perform public.crm_refresh_last_contact(v_org);

  if tg_op = 'UPDATE' then
    if old.organization_id is not null and old.organization_id is distinct from v_org
       and exists (select 1 from public.crm_organizations o where o.id = old.organization_id) then
      perform public.crm_refresh_last_contact(old.organization_id);
    end if;
  end if;

  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Autoverifica
--
-- ⚠️ Qui NON si può provare la cascata: creare un'azienda richiede una riga in
-- `auth.users`, e fabbricarne una dentro una migrazione sarebbe peggio del
-- difetto che si sta correggendo. La prova sta in `npm run test:crm`, sezione
-- «Cascata», tredici asserzioni — una per tabella. Questo blocco verifica
-- soltanto ciò che si può verificare qui: che le cinque funzioni esistano
-- ancora come `security definer` (un `create or replace` che dimenticasse quella
-- parola riporterebbe il difetto chiuso dalla 0019) e che il ramo di uscita
-- anticipata sia davvero nel corpo depositato, non solo in questo commento.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad  text;
  v_src  text;
  v_name text;
begin
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('crm_log_role', 'crm_log_contact_link',
                       'crm_log_org_entity_link', 'crm_log_contact_entity_link',
                       'crm_touch_last_contact')
     and p.prosecdef = false;
  if v_bad is not null then
    raise exception 'funzioni di storico che devono essere security definer non lo sono: %', v_bad;
  end if;

  -- Il corpo depositato contiene davvero il controllo sull'esistenza
  -- dell'azienda: senza, questa migrazione non avrebbe corretto niente.
  for v_name in
    select unnest(array['crm_log_role', 'crm_log_contact_link',
                        'crm_log_org_entity_link', 'crm_log_contact_entity_link'])
  loop
    select p.prosrc into v_src
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    if v_src is null or position('from public.companies' in v_src) = 0 then
      raise exception '% non controlla che l''azienda esista ancora', v_name;
    end if;
  end loop;

  raise notice '0028 applicata: lo storico del CRM non impedisce piu la cancellazione di un''azienda.';
end $$;
