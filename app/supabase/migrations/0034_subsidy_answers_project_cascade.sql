-- ============================================================================
-- AI-Swisse — 0034 · LA STESSA REGOLA, UN LIVELLO PIÙ SOTTO
--
-- La 0033 ha esentato dalla guardia append-only la cascata di un'AZIENDA
-- cancellata. Applicandola si è visto subito che il trapping restava un livello
-- più sotto: `subsidy_answers.project_id` è `on delete cascade`, quindi un
-- PROGETTO con anche una sola risposta non si cancella — nemmeno con il ruolo
-- di servizio.
--
-- ⚠️ NON È UN PROBLEMA DEL PRODOTTO NORMALE, e va detto: al client non è
--    concesso alcun `delete` su `subsidy_projects` — un progetto si ARCHIVIA,
--    perché cancellarlo porterebbe via opportunità, valutazioni e il legame
--    delle pratiche che ne sono nate. Il caso che questo file chiude è quello
--    del ruolo di servizio: la pulizia di una suite di test e la rimozione di
--    dati di prova. È esattamente la pena che `test:crm` ha pagato prima della
--    0028, quando la pulizia falliva e lasciava aziende di prova in produzione.
--
-- LA REGOLA, ORA SCRITTA UNA VOLTA SOLA: una risposta non si cancella A MANO;
-- si cancella soltanto DENTRO la cascata di un genitore che non esiste più —
-- l'azienda o il progetto. In entrambi i casi la cancellazione è già stata
-- autorizzata a monte e non c'è alcuna storia da proteggere: le opportunità e
-- le valutazioni di quel progetto se ne sono andate con lui.
--
-- ⚠️ L'append-only NON si indebolisce: la cancellazione diretta di una risposta
--    resta rifiutata, e l'autoverifica lo prova prima di ogni altra cosa.
--
-- Idempotente per costruzione.
-- ============================================================================

create or replace function public.subsidy_answers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  -- ⚠️ `old` si legge SOLO nel ramo che le appartiene: in plpgsql l'espressione
  --    viene preparata per intero, e nominarla altrove la farebbe valutare
  --    anche su INSERT, dove non è assegnata.
  v_cascade boolean := false;
begin
  if tg_op = 'DELETE' then
    -- Il genitore da cui arriva la cascata non esiste più? Allora questa non è
    -- la modifica di qualcuno: è la conseguenza di una cancellazione già
    -- autorizzata, e opporsi la fa fallire tutta (0023, 0025, 0028, 0033).
    select not exists (select 1 from public.companies c where c.id = old.company_id)
        or (old.project_id is not null
            and not exists (select 1 from public.subsidy_projects p where p.id = old.project_id))
      into v_cascade;

    if v_cascade then
      return old;
    end if;

    raise exception 'subsidy_answers_append_only: una risposta non si cancella; se ne registra un''altra'
      using errcode = 'check_violation';
  end if;

  if tg_op = 'UPDATE' then
    raise exception 'subsidy_answers_append_only: una risposta non si modifica; se ne registra un''altra'
      using errcode = 'check_violation';
  end if;

  if auth.uid() is not null then
    if new.answered_by is not null and new.answered_by is distinct from auth.uid() then
      raise exception 'subsidy_answer_author_mismatch: non si può rispondere a nome di un collega'
        using errcode = 'check_violation';
    end if;
    new.answered_by := auth.uid();
  end if;
  new.answered_at := now();

  if new.project_id is not null then
    select company_id into v_company
      from public.subsidy_projects where id = new.project_id;
    if not found or v_company is distinct from new.company_id then
      raise exception 'subsidy_project_cross_tenant: il progetto non appartiene a questa azienda'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end $$;

comment on function public.subsidy_answers_guard() is
  'Append-only sulle risposte: insert sì, update mai, delete solo dentro la cascata di un genitore già cancellato — azienda (0033) o progetto (0034). Un trigger che solleva durante la cascata rende il genitore indistruttibile.';


-- ---------------------------------------------------------------------------
-- AUTOVERIFICA — TRE LATI, non uno
--
-- (a) la cancellazione diretta resta respinta;
-- (b) la cascata del PROGETTO passa;
-- (c) la cascata dell'AZIENDA continua a passare (la garanzia della 0033 non
--     deve essersi rotta riscrivendo la funzione).
-- Se uno dei tre non torna, questa migrazione FALLISCE invece di applicarsi.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid;
  v_project uuid;
  v_version uuid;
  v_answer  uuid;
  v_blocked boolean := false;
begin
  select id into v_version
    from public.subsidy_program_versions where status = 'published' limit 1;
  if v_version is null then
    raise notice '0034: nessuna versione pubblicata, autoverifica saltata';
    return;
  end if;

  insert into public.companies (legal_name, canton)
    values ('ZZ autoverifica 0034', 'TI') returning id into v_company;
  insert into public.subsidy_projects (company_id, title)
    values (v_company, 'ZZ autoverifica 0034') returning id into v_project;
  insert into public.subsidy_answers (company_id, project_id, program_version_id, rule_key, value)
    values (v_company, v_project, v_version, 'autoverifica_0034', 'no')
    returning id into v_answer;

  -- (a)
  begin
    delete from public.subsidy_answers where id = v_answer;
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception '0034: l''append-only è stato smontato — una risposta si cancella a mano';
  end if;

  -- (b)
  delete from public.subsidy_projects where id = v_project;
  if exists (select 1 from public.subsidy_projects where id = v_project) then
    raise exception '0034: il progetto è ancora indistruttibile';
  end if;
  if exists (select 1 from public.subsidy_answers where id = v_answer) then
    raise exception '0034: la risposta è sopravvissuta alla cascata del progetto';
  end if;

  -- (c) — la garanzia della 0033, riprovata su una risposta SENZA progetto
  insert into public.subsidy_answers (company_id, program_version_id, rule_key, value)
    values (v_company, v_version, 'autoverifica_0034_azienda', 'no')
    returning id into v_answer;
  delete from public.companies where id = v_company;
  if exists (select 1 from public.companies where id = v_company) then
    raise exception '0034: l''azienda è tornata indistruttibile — la 0033 si è rotta';
  end if;

  raise notice '0034: autoverifica superata — diretta respinta, cascata di progetto e di azienda passate';
end $$;
