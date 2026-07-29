-- ============================================================================
-- 0025 — DUE CORREZIONI ALLA 0024
--
-- Trovate da `npm run test:contracts` alla PRIMA esecuzione sul database vero,
-- e non da una rilettura. Sono entrambe la ripetizione di una trappola già
-- pagata da questo progetto e già scritta in chiaro nelle migrazioni
-- precedenti: averle riprodotte dice quanto poco basti, e quanto valga
-- eseguire invece di ragionare.
--
-- (a) Il `CASE` che sceglie un'etichetta enum si risolve come `text` (0022).
--     Conseguenza: NESSUN VERBALE POTEVA ESSERE SCRITTO. Il worker avrebbe
--     fallito su ogni documento, e il modulo sarebbe stato inutilizzabile.
--
-- (b) Un trigger che INSERISCE durante una cancellazione a cascata la fa
--     fallire (parente stretto della 0023, dove era un trigger che SOLLEVAVA).
--     Conseguenza: un'azienda con contratti era indistruttibile, e la pulizia
--     dei test lasciava residui in produzione — è già successo due volte.
--
-- Requisiti: 0001–0024 applicate.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- (a) ⚠️⚠️ L'ENUM DENTRO UN `CASE` VUOLE IL CAST SU OGNI RAMO
--
-- Quando TUTTI i rami di un `CASE` sono letterali senza tipo, Postgres risolve
-- l'espressione come `text`, e da `text` a un enum non esiste conversione
-- implicita: 42804. Un letterale NUDO (`'created'`) passa, perché resta
-- `unknown` e viene coercito alla colonna — ed è per questo che nello stesso
-- file quattro insert funzionavano e uno no, e che rileggendo non si vedeva.
--
-- È ESATTAMENTE il difetto della 0022, riprodotto due migrazioni dopo, nella
-- stessa forma e nello stesso tipo di trigger.
--
-- ⚠️ Nessuna verifica statica può vederlo: il corpo di una funzione plpgsql non
-- viene analizzato alla creazione. Lo vede solo chi ESEGUE.
-- ---------------------------------------------------------------------------
create or replace function public.contract_after_extraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relation public.contract_document_relation;
  v_kind     public.contract_event_kind;
begin
  select cd.relation into v_relation
    from public.contract_documents cd
   where cd.contract_id = new.contract_id and cd.document_id = new.document_id;

  if new.status = 'completed' then
    update public.contract_documents
       set current_extraction_id = new.id,
           processing_status = 'completed',
           error_code = null
     where contract_id = new.contract_id and document_id = new.document_id;
  else
    -- ⚠️ ANCHE IL FALLIMENTO LO SCRIVE IL TRIGGER, non il worker (lezione della
    -- 0021): due posti in cui ricordarsene sono uno di troppo.
    update public.contract_documents
       set processing_status = 'failed', error_code = new.error_code
     where contract_id = new.contract_id and document_id = new.document_id;
  end if;

  -- ⚠️ L'ETICHETTA SI SCEGLIE IN UNA VARIABILE TIPIZZATA, non dentro l'insert.
  -- È la forma che non può sbagliare: il tipo lo dichiara la variabile, e un
  -- valore fuori enum fallirebbe qui, dove si vede, invece che in un `case`
  -- che si risolve in silenzio come testo.
  if new.status = 'completed' then
    v_kind := 'extraction_completed';
  else
    v_kind := 'extraction_failed';
  end if;

  insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
  values (new.company_id, new.contract_id, null, v_kind,
          jsonb_build_object('documentId', new.document_id,
                             'version', new.extraction_version,
                             'relation', v_relation));

  if new.status = 'completed' then
    perform public.contract_refresh_draft(new.contract_id);

    -- La revisione si riapre solo se c'era qualcosa da riaprire: su un contratto
    -- mai verificato lo stato è già `needs_review`.
    if v_relation in ('amendment', 'renewal') then
      perform set_config('ai_swisse.contract_review', '1', true);
      update public.contracts
         set review_status = 'review_required_again'
       where id = new.contract_id and review_status = 'verified';
      perform set_config('ai_swisse.contract_review', '0', true);

      insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
      values (new.company_id, new.contract_id, null, 'amendment_added',
              jsonb_build_object('documentId', new.document_id, 'relation', v_relation));
    end if;

    perform public.contract_refresh_flags(new.contract_id);
  end if;

  return new;
end $$;


-- ---------------------------------------------------------------------------
-- (b) ⚠️⚠️ UN TRIGGER CHE SCRIVE DURANTE UNA CASCATA LA FA FALLIRE
--
-- Cancellando un'AZIENDA, la cascata arriva a `contract_documents`; il trigger
-- di storico inseriva allora una riga in `contract_events`, la cui chiave
-- esterna punta a un'azienda che sta sparendo nella stessa transazione:
-- 23503, e la cancellazione fallisce PER INTERO.
--
-- È il parente stretto della 0023 — là un trigger SOLLEVAVA durante la cascata,
-- qui SCRIVE — e la regola generale è la stessa, con una parola cambiata:
--   «prima di scrivere in un trigger, chiedersi chi altro passa di lì».
--
-- La correzione non indebolisce lo storico: si registra la rimozione di un
-- documento SE il contratto esiste ancora, cioè quando è davvero un gesto di
-- qualcuno. Se sta sparendo anche il contratto, non c'è alcuno storico da
-- tenere — sparisce con lui.
-- ---------------------------------------------------------------------------
create or replace function public.contract_documents_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
    values (new.company_id, new.contract_id, new.added_by, 'document_added',
            jsonb_build_object('documentId', new.document_id, 'relation', new.relation,
                               'suggested', new.suggested));
    return new;
  end if;

  -- ⚠️ Il controllo è su AZIENDA e CONTRATTO insieme: durante la cascata di una
  -- cancellazione l'ordine con cui le righe spariscono non è garantito, e
  -- bastava che una delle due fosse già andata per far fallire l'insert.
  if exists (select 1 from public.contracts c where c.id = old.contract_id)
     and exists (select 1 from public.companies co where co.id = old.company_id) then
    insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
    values (old.company_id, old.contract_id, auth.uid(), 'document_removed',
            jsonb_build_object('documentId', old.document_id, 'relation', old.relation));
  end if;
  return old;
end $$;

-- Stessa difesa sul ricalcolo della bozza: durante la cascata non c'è più nulla
-- da ricalcolare, e provarci solleverebbe. Il controllo c'era già sul
-- contratto; qui si aggiunge l'azienda, per la ragione appena detta.
create or replace function public.contract_documents_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.contracts c where c.id = old.contract_id)
     and exists (select 1 from public.companies co where co.id = old.company_id) then
    perform public.contract_refresh_draft(old.contract_id);
  end if;
  return old;
end $$;

-- Le milestone hanno la stessa forma: il loro trigger di storico scrive in
-- `contract_events` anche su UPDATE, e un update a cascata non esiste — ma
-- `contracts_events` sì, e scrive su ogni update del contratto. Durante la
-- cancellazione di un'azienda nessuno aggiorna un contratto, quindi lì il
-- problema non si pone: si lascia com'è invece di aggiungere difese a un caso
-- che non esiste.


-- ---------------------------------------------------------------------------
-- Autoverifica: le due correzioni fanno ciò che dichiarano.
--
-- ⚠️ Si CREANO davvero un'azienda, un documento, un contratto e un'estrazione,
-- e poi si cancella tutto. È l'unico modo di provare (a): il corpo di una
-- funzione plpgsql non viene analizzato alla creazione, quindi solo una
-- chiamata vera fa emergere il 42804.
--
-- ⚠️ Nessuna riga di questo blocco nomina i quattro valori enum aggiunti dalla
-- 0024 a `automation_event_type` (55P04): l'estrazione qui sotto NON fa
-- scattare `contract_emit_automation`, che si attiva sugli update di
-- `contracts` e solo quando una regola attiva ascolta — e qui non ce ne sono.
-- ---------------------------------------------------------------------------
do $$
declare
  v_company uuid;
  v_doc     uuid;
  v_contract uuid;
  v_events  integer;
begin
  insert into public.companies (legal_name) values ('__verifica 0025__')
  returning id into v_company;

  insert into public.documents (company_id, title, source_type, status)
  values (v_company, '__verifica 0025__', 'upload', 'completed')
  returning id into v_doc;

  insert into public.contracts (company_id, display_name)
  values (v_company, '__verifica 0025__')
  returning id into v_contract;

  insert into public.contract_documents (company_id, contract_id, document_id, relation)
  values (v_company, v_contract, v_doc, 'main_agreement');

  -- (a) Se il `CASE` fosse ancora lì, questa riga fallirebbe con 42804.
  insert into public.contract_extractions
    (company_id, contract_id, document_id, extraction_version, status,
     notice_period_value, notice_period_unit, notice_anchor, end_date, end_date_kind)
  values (v_company, v_contract, v_doc, 1, 'completed',
          3, 'months', 'before_fixed_end', date '2026-12-31', 'explicit');

  select count(*) into v_events from public.contract_events
   where contract_id = v_contract and kind = 'extraction_completed';
  if v_events <> 1 then
    raise exception 'lo storico dell''estrazione non è stato scritto (atteso 1, trovato %)', v_events;
  end if;

  -- La bozza si è ricalcolata e la data è stata derivata.
  if not exists (
    select 1 from public.contract_milestones
     where contract_id = v_contract and kind = 'notice_deadline'
       and due_date = date '2026-09-30' and source = 'derived'
  ) then
    raise exception 'la data di disdetta non è stata derivata dall''estrazione';
  end if;

  -- (b) Se il trigger scrivesse ancora durante la cascata, questa riga
  --     fallirebbe con 23503 e l'azienda sarebbe indistruttibile.
  delete from public.companies where id = v_company;

  if exists (select 1 from public.contracts where id = v_contract) then
    raise exception 'il contratto è sopravvissuto alla cancellazione dell''azienda';
  end if;
  if exists (select 1 from public.contract_events where contract_id = v_contract) then
    raise exception 'lo storico è sopravvissuto alla cancellazione dell''azienda';
  end if;

  raise notice '0025 applicata: verbale scrivibile, date derivate, cascata pulita.';
end $$;
