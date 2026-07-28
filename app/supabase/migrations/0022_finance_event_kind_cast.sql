-- ============================================================================
-- 0022 — LO STORICO DI FINANCE NON SI SCRIVEVA
--
-- ⚠️ IL DIFETTO. Tre trigger della 0021 scrivono `finance_events.kind` — che è
-- un enum — scegliendo l'etichetta con un `CASE`:
--
--     case when new.status = 'completed' then 'extraction_completed'
--          else 'extraction_failed' end
--
-- Quando TUTTI i rami di un `CASE` sono letterali senza tipo, Postgres risolve
-- l'espressione come `text` (è la regola documentata: se tutti gli ingressi sono
-- di tipo `unknown`, il risultato è `text`). E da `text` a un enum non esiste
-- conversione implicita:
--
--     42804: column "kind" is of type public.finance_event_kind
--            but expression is of type text
--
-- Un letterale NUDO — `'created'` — sarebbe passato senza problemi, perché resta
-- `unknown` e viene coercito alla colonna. Dentro un `CASE` no. È la differenza
-- che ha reso il difetto invisibile a occhio: nello stesso trigger, tre insert
-- funzionavano e due no.
--
-- ⚠️ QUANTO ERA GRAVE. Il trigger scrive DOPO l'inserimento di un'estrazione:
-- l'eccezione annullava l'intera transazione, quindi NON si poteva salvare
-- alcun verbale finanziario. Il modulo non funzionava affatto — ma la 0021 si
-- era applicata senza un errore, e nessuna verifica statica poteva accorgersene:
-- il corpo di una funzione plpgsql non viene analizzato alla creazione.
--
-- L'ha trovato la PRIMA esecuzione di `npm run test:finance` contro il database
-- vero, come per la 0010, la 0014, la 0016 e la 0018. Su questo progetto è
-- successo cinque volte su sei: ciò che non è provato contro la cosa reale non
-- è vero, è solo scritto.
--
-- ⚠️ PERCHÉ UNA MIGRAZIONE NUOVA E NON UNA CORREZIONE DELLA 0021.
-- La 0021 è già applicata. Riscriverla significherebbe che il file non descrive
-- più ciò che è stato eseguito. È lo stesso caso della 0019, che ha corretto la
-- 0018 dopo l'applicazione invece di riaprirla.
--
-- Requisiti: 0021 applicata.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. Il trigger che promuove un'estrazione e ne registra l'esito
--
-- Identico a quello della 0021 tranne i due `::public.finance_event_kind`.
-- ---------------------------------------------------------------------------
create or replace function public.finance_after_extraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Solo un'estrazione RIUSCITA diventa quella corrente: un tentativo fallito
  -- non deve sostituire un verbale buono precedente.
  if new.status = 'completed' then
    update public.finance_items
       set current_extraction_id = new.id,
           processing_status = 'completed',
           error_code = null
     where id = new.finance_item_id;
    perform public.finance_refresh_effective(new.finance_item_id);
  else
    -- ⚠️ ANCHE IL FALLIMENTO LO SCRIVE IL TRIGGER, non il worker.
    -- Una riga di estrazione con esito `failed` significa una cosa sola: si è
    -- provato e quel documento non si riesce a leggere. I guasti TRANSITORI —
    -- quota esaurita, tempo finito, provider irraggiungibile — non scrivono
    -- alcuna riga: l'elemento resta in coda e si ritenta.
    update public.finance_items
       set processing_status = 'failed',
           error_code = new.error_code
     where id = new.finance_item_id;
  end if;

  insert into public.finance_events (company_id, finance_item_id, actor_user_id, kind, detail)
  values (new.company_id, new.finance_item_id, null,
          -- ⚠️ IL CAST È IL PUNTO DI QUESTA MIGRAZIONE. Senza, l'intera
          -- transazione fallisce e nessun verbale può essere salvato.
          case when new.status = 'completed'
               then 'extraction_completed'::public.finance_event_kind
               else 'extraction_failed'::public.finance_event_kind end,
          jsonb_build_object('version', new.extraction_version, 'method', new.method));
  return new;
end $$;

drop trigger if exists trg_finance_after_extraction on public.finance_extractions;
create trigger trg_finance_after_extraction
  after insert on public.finance_extractions
  for each row execute function public.finance_after_extraction();


-- ---------------------------------------------------------------------------
-- 2. Il trigger che registra i cambi di stato
--
-- Stesso difetto in due punti: «verificata / riaperta» e «archiviata /
-- ripristinata». Gli altri quattro insert di questa funzione usano letterali
-- nudi e funzionavano già — ed è precisamente ciò che rendeva il difetto
-- difficile da vedere rileggendo.
-- ---------------------------------------------------------------------------
create or replace function public.finance_items_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.finance_events (company_id, finance_item_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, new.created_by, 'created',
            jsonb_build_object('type', new.type, 'origin', new.origin));
    return new;
  end if;

  if new.review_status is distinct from old.review_status then
    insert into public.finance_events (company_id, finance_item_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, auth.uid(),
            case when new.review_status = 'ready'
                 then 'reviewed'::public.finance_event_kind
                 else 'reopened'::public.finance_event_kind end, '{}'::jsonb);
  end if;

  if (new.archived_at is not null) is distinct from (old.archived_at is not null) then
    insert into public.finance_events (company_id, finance_item_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, auth.uid(),
            case when new.archived_at is not null
                 then 'archived'::public.finance_event_kind
                 else 'restored'::public.finance_event_kind end, '{}'::jsonb);
  end if;

  if new.type is distinct from old.type then
    insert into public.finance_events (company_id, finance_item_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, auth.uid(), 'type_changed',
            jsonb_build_object('from', old.type, 'to', new.type));
  end if;

  if new.expense_category is distinct from old.expense_category then
    insert into public.finance_events (company_id, finance_item_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, auth.uid(), 'category_changed',
            jsonb_build_object('from', old.expense_category, 'to', new.expense_category));
  end if;

  if new.processing_status = 'pending' and old.processing_status in ('completed', 'failed') then
    insert into public.finance_events (company_id, finance_item_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, auth.uid(), 'retry_requested', '{}'::jsonb);
  end if;

  return new;
end $$;

drop trigger if exists trg_finance_items_events on public.finance_items;
create trigger trg_finance_items_events
  after insert or update on public.finance_items
  for each row execute function public.finance_items_events();


-- ---------------------------------------------------------------------------
-- 3. ⚠️ PERCHÉ QUESTA MIGRAZIONE NON SI AUTOVERIFICA
--
-- Ogni migrazione di questo progetto controlla, in fondo, di aver ottenuto ciò
-- che dichiara. Questa NO, e la ragione va scritta perché è la stessa trappola
-- che ha già colpito due volte.
--
-- Il controllo naturale sarebbe: creare un'estrazione di prova ed esigere che lo
-- storico la registri — cioè ESEGUIRE il percorso che falliva. Ma inserire
-- un'estrazione fa scattare `trg_finance_after_extraction`, che promuove
-- l'elemento a `completed`, che a sua volta fa scattare
-- `trg_finance_emit_automation`, il cui corpo NOMINA
-- `finance_item_needs_review` — uno dei due valori che la 0021 aggiunge ad
-- `automation_event_type`.
--
-- Su un database esistente non succede nulla: quei valori sono committati da
-- tempo. Ma `full-setup.sql` concatena 0021 e 0022 in un'UNICA transazione, e
-- lì l'etichetta è stata aggiunta pochi istanti prima e non è ancora
-- utilizzabile: Postgres solleverebbe
--
--     55P04: unsafe use of new value of enum type
--
-- e OGNI INSTALLAZIONE DA ZERO fallirebbe. È esattamente il guasto della 0015 —
-- invisibile a chi ha già il database, che applica una migrazione alla volta, e
-- visibile solo al primo cliente nuovo.
--
-- `npm run db:bundle` non lo vedrebbe: il suo controllo riconosce l'etichetta
-- dentro il corpo di una funzione (dove è innocua) e dentro un blocco `do`
-- (dove non lo è), ma non può seguire una CHIAMATA da un `do` a una funzione
-- che la nomina. È il limite dichiarato in cima a quel controllo.
--
-- La verifica esiste, e sta dove può girare senza questo vincolo: la sezione 4
-- di `npm run test:finance` scrive un'estrazione vera contro il database vero,
-- DOPO il commit, e pretende di ritrovare la riga nello storico. È l'esecuzione
-- che ha trovato questo difetto, ed è l'esecuzione che lo tiene chiuso.
-- ---------------------------------------------------------------------------
