-- ============================================================================
-- AI-Swisse — 0033 · LA RISPOSTA APPEND-ONLY RENDEVA L'AZIENDA INDISTRUTTIBILE
--
-- IL DIFETTO, RIPRODOTTO PRIMA DI ESSERE CORRETTO (2026-07-30):
--   1. azienda usa-e-getta senza risposte  → `delete from companies` → 204, va via;
--   2. stessa azienda con UNA riga in `subsidy_answers` → `delete` → **23514**,
--      `subsidy_answers_append_only`, e l'azienda resta in produzione.
--
-- La causa: `subsidy_answers_guard()` solleva su `tg_op <> 'INSERT'`, e il suo
-- trigger è `before insert or update or delete`. Durante la cancellazione di
-- un'azienda la cascata prova a togliere le risposte, il trigger la respinge, e
-- l'intera transazione fallisce.
--
-- ⚠️ È LA STESSA CLASSE DI DIFETTO DELLA 0023, DELLA 0025 E DELLA 0028, e la
--    0032 la dichiara nella propria intestazione: «I TRIGGER DI QUESTO FILE
--    DEVONO SOPRAVVIVERE ALLA CASCATA. Un trigger che SOLLEVA o che INSERISCE
--    durante la cancellazione di un'azienda rende quell'azienda
--    indistruttibile.» La regola era scritta; su questa tabella non era
--    applicata. `subsidy_program_rules` la applica correttamente (verifica che
--    il genitore esista ancora), `subsidy_assessments` e
--    `subsidy_project_interpretations` non sono esposte perché il loro trigger
--    non copre il DELETE: `subsidy_answers` era l'unica.
--
-- ⚠️ NON SI INDEBOLISCE L'APPEND-ONLY. §187 resta intero: una risposta non si
--    modifica e non si cancella A MANO. Ciò che si distingue è la
--    CANCELLAZIONE DIRETTA — che va ancora rifiutata — dalla CASCATA, che è la
--    conseguenza di una cancellazione già autorizzata a monte e che nessuno sta
--    «modificando». La distinzione si fa come nella 0032 sezione 26: si guarda
--    se il GENITORE esiste ancora. Se l'azienda non c'è più, siamo dentro la
--    sua cascata.
--
-- ⚠️ Perché non basta togliere `delete` dal trigger: `answered_by` e
--    `answered_at` li timbra questo guardiano, e l'UPDATE va ancora respinto.
--    Serve il ramo, non l'assenza del trigger.
--
-- Idempotente per costruzione: `create or replace` + `drop trigger if exists`.
-- ============================================================================

create or replace function public.subsidy_answers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  -- ⚠️ `old` si legge SOLO nel ramo che le appartiene. In plpgsql
  --    l'espressione viene preparata per intero, quindi nominare `old` insieme
  --    a `tg_op` la farebbe valutare anche su INSERT, dove non è assegnata:
  --    è la trappola annotata undici volte nella 0032 e prima nella 0026.
  v_parent_gone boolean := false;
begin
  if tg_op = 'DELETE' then
    -- La cancellazione DIRETTA di una risposta resta vietata: §187 dice che se
    -- un criterio è stato dichiarato soddisfatto a marzo e non soddisfatto a
    -- giugno, quel cambiamento è un fatto che riguarda una pratica in corso.
    -- Ma se l'azienda non esiste più non c'è alcuna storia da proteggere: c'è
    -- una cancellazione già autorizzata a monte, e opporsi la fa fallire tutta.
    select not exists (
      select 1 from public.companies c where c.id = old.company_id
    ) into v_parent_gone;

    if v_parent_gone then
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

drop trigger if exists trg_subsidy_answers_guard on public.subsidy_answers;
create trigger trg_subsidy_answers_guard
  before insert or update or delete on public.subsidy_answers
  for each row execute function public.subsidy_answers_guard();

comment on function public.subsidy_answers_guard() is
  'Append-only sulle risposte: insert sì, update mai, delete solo dentro la cascata di un''azienda già cancellata (0033). Un trigger che solleva durante la cascata rende l''azienda indistruttibile — 0023, 0025, 0028.';


-- ---------------------------------------------------------------------------
-- AUTOVERIFICA
--
-- Il file non si limita a dichiarare la garanzia: la prova su un'azienda
-- usa-e-getta, e se non torna l'applicazione FALLISCE invece di riuscire a
-- metà. È la disciplina della 0032 sezione 43 e della 0026.
--
-- ⚠️ Riproduce ENTRAMBI i lati: la cancellazione diretta deve ancora essere
--    respinta, e la cascata deve passare. Un controllo che provasse solo il
--    secondo non vedrebbe un append-only smontato per sbaglio.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid;
  v_version uuid;
  v_answer  uuid;
  v_blocked boolean := false;
begin
  select id into v_version
    from public.subsidy_program_versions where status = 'published' limit 1;
  if v_version is null then
    raise notice '0033: nessuna versione pubblicata, autoverifica saltata';
    return;
  end if;

  insert into public.companies (legal_name, canton)
    values ('ZZ autoverifica 0033', 'TI')
    returning id into v_company;

  insert into public.subsidy_answers (company_id, program_version_id, rule_key, value)
    values (v_company, v_version, 'autoverifica_0033', 'no')
    returning id into v_answer;

  -- (a) la cancellazione DIRETTA resta vietata
  begin
    delete from public.subsidy_answers where id = v_answer;
  exception when check_violation then
    v_blocked := true;
  end;
  if not v_blocked then
    raise exception '0033: l''append-only è stato smontato — una risposta si cancella a mano';
  end if;

  -- (b) la cascata dell'azienda deve passare
  delete from public.companies where id = v_company;

  if exists (select 1 from public.companies where id = v_company) then
    raise exception '0033: l''azienda è ancora indistruttibile';
  end if;
  if exists (select 1 from public.subsidy_answers where id = v_answer) then
    raise exception '0033: la risposta è sopravvissuta alla cascata';
  end if;

  raise notice '0033: autoverifica superata — cancellazione diretta respinta, cascata passata';
end $$;
