-- ============================================================================
-- 0030 — CRM: IL CANDIDATO AUTOMATICO (§171)
--
-- Che cosa aggiunge: UNA funzione, `crm_scan_link_suggestions`, che legge le
-- controparti già scritte nei Contratti e i fornitori già letti da Finanze e
-- ne propone il collegamento al CRM, più UN valore all'enum dei motivi (sezione
-- 1, con la ragione per cui senza si direbbe una cosa falsa). Nessuna tabella
-- nuova, nessun trigger, nessuna Edge Function, nessun job cron: la tabella
-- `crm_link_suggestions` esiste dalla 0026 con la sua `dedupe_key`, e la
-- scansione gira nel worker delle automazioni già acceso, accanto ad
-- `automation_emit_overdue` e a `crm_emit_follow_up_due`.
--
-- ⚠️⚠️ PROPONE, NON CREA. Nessuna organizzazione nasce da qui, e nessun
-- contratto o fattura viene collegato da qui. La funzione scrive SOLTANTO
-- righe `crm_link_suggestions` in stato `pending`, che una persona conferma o
-- rifiuta (§21). Il numero che giustifica questa scelta è misurato e sta nella
-- 0026: sulle 117 email vere della casella collegata, il filtro migliore
-- lasciava passare `amazon.it` e `info.interdiscount.ch`. Se nemmeno il filtro
-- migliore autorizza un'anagrafica automatica sui mittenti, non l'autorizza
-- nemmeno su un nome letto da una fattura.
--
-- ⚠️ PERCHÉ NON COLLEGA DA SÉ NEMMENO SULL'IDENTITÀ FORTE. La scala del §25 dice
-- che un IDI valido e un indirizzo email identico autorizzerebbero un
-- collegamento automatico. Qui non si usa quella licenza, e la ragione è che le
-- due sorgenti non portano un'identità: un contratto ha un NOME di controparte
-- e una fattura ha un NOME di fornitore, letti da un documento. Il nome
-- normalizzato è un sospetto per costruzione — lo dichiara il commento di
-- `finance_norm_supplier`: «Swisscom» e «Swisscom SA» restano soggetti diversi
-- finché nessuno dice il contrario.
--
-- ⚠️ AMBIGUITÀ = NIENTE. Se due organizzazioni della stessa azienda hanno lo
-- stesso nome normalizzato, non si propone nessuna delle due: sceglierne una
-- significherebbe attribuire un contratto all'impresa sbagliata in silenzio, ed
-- è la stessa regola di `pickAutoLink` in `crmMatch.ts`. Quel caso ha già un
-- posto dove comparire: `crm_duplicate_candidates`, cioè «possibili duplicati».
--
-- ⚠️ LA CHIAVE DI IDEMPOTENZA HA UNA COPIA IN TYPESCRIPT, ed è dichiarata:
-- `suggestionKey()` in `src/features/crm/crmMatch.ts` compone la stessa
-- stringa. `npm run test:crm-unit` LEGGE QUESTO FILE e confronta le due forme,
-- come già fa con l'elenco dei domini pubblici di `crm_is_public_domain`: è
-- l'unico controllo che può vedere la divergenza, perché il typecheck non
-- guarda dentro l'SQL.
--
-- Requisiti: 0026 e 0028 applicate (contratti e Finanze: 0021–0025).
-- Prova: `npm run test:crm`, sezione «Il candidato automatico».
--
-- ⚠️ QUESTO FILE SI PUÒ RIESEGUIRE. `add value if not exists`, `create or
-- replace`, `comment`, `revoke` e il blocco `do $$` sono tutti ripetibili: una
-- seconda applicazione non solleva e non duplica niente. È stato necessario —
-- vedi la nota su `min(uuid)` nella sezione 2, il difetto che `npm run test:crm`
-- ha trovato alla prima esecuzione dopo la prima applicazione.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. UN MOTIVO NUOVO: «il nome letto sul documento»
--
-- ⚠️ SERVE UN VALORE NUOVO, e la ragione è che senza si direbbe una cosa falsa.
-- `reason` risponde alla domanda «perché mi stai proponendo questo?». Quando
-- nel CRM non c'è nessuna controparte con quel nome, la proposta non nasce da
-- una corrispondenza: nasce dal fatto che un documento nomina qualcuno che qui
-- dentro non esiste. Riusare `name_normalized` significherebbe scrivere
-- «ragione sociale simile» accanto a una riga dove non c'è niente a cui
-- somigliare, e la schermata lo mostrerebbe a una persona.
--
-- ⚠️⚠️ 55P04 — un valore aggiunto NON è utilizzabile in nessun'altra ISTRUZIONE
-- di questo file. Qui compare soltanto dentro il CORPO di una funzione, che
-- Postgres NON esegue alla creazione: è la stessa forma della 0021, ed è ciò
-- che `scripts/bundle-migrations.mjs` sa distinguere da un blocco `do $$`.
-- Il blocco di autoverifica in fondo NON lo nomina, di proposito.
--
-- ⚠️ `extracted_name` NON entra fra i motivi che autorizzano un collegamento
-- automatico (`AUTO_LINK_REASONS` in `crmMatch.ts`): è il più debole di tutti —
-- non collega niente, propone di creare qualcosa.
-- ---------------------------------------------------------------------------
alter type public.crm_match_reason add value if not exists 'extracted_name';


-- ---------------------------------------------------------------------------
-- 2. LA SCANSIONE
--
-- Restituisce quanti suggerimenti ha CREATO, non quante righe ha guardato: è il
-- numero che il rapporto del worker mostra, e «creati» è l'unica cosa che
-- cambia lo stato del mondo.
--
-- ⚠️ Non si guardano le righe che hanno GIÀ un suggerimento in sospeso per
-- quella stessa entità. Due ragioni, entrambe pratiche: senza il filtro, ogni
-- passaggio del worker riesaminerebbe le stesse duecento righe più recenti e
-- non arriverebbe mai alle altre; e con il filtro un contratto che ha già una
-- proposta da confermare non ne riceve una seconda che direbbe la stessa cosa.
-- Quando la proposta viene risolta — accettata, rifiutata o messa da parte —
-- la riga torna esaminabile, e il vincolo unico su `dedupe_key` impedisce che
-- la stessa identica proposta si ripresenti.
-- ---------------------------------------------------------------------------
create or replace function public.crm_scan_link_suggestions(
  p_limit integer default 200
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r            record;
  v_created    integer := 0;
  v_limit      integer := greatest(coalesce(p_limit, 200), 0);
  v_target     uuid;
  v_matches    integer;
  v_key        text;
  v_reason     public.crm_match_reason;
  v_detail     text;
begin
  -- ⚠️ LAVORO DI SISTEMA, NON DI UNA PERSONA. La chiama il worker con il ruolo
  -- di servizio; un utente autenticato non deve poterla eseguire, perché è
  -- `security definer` e scriverebbe righe per conto di tutte le aziende. È la
  -- lezione della 0029: su Supabase i privilegi sulle FUNZIONI vengono
  -- concessi ad `anon` e `authenticated` per default, quindi il `revoke` in
  -- fondo a questo file è necessario ma non basta da solo — questo controllo è
  -- la seconda serratura, dentro la funzione, dove non può essere dimenticata.
  if auth.uid() is not null then
    raise exception 'crm_scan_link_suggestions_not_callable_by_user'
      using errcode = '42501',
            hint = 'La scansione dei suggerimenti e un lavoro di sistema.';
  end if;

  -- (a) LE CONTROPARTI DEI CONTRATTI
  for r in
    select c.id, c.company_id, c.counterparty_name,
           public.finance_norm_supplier(c.counterparty_name) as norm
      from public.contracts c
     where c.archived_at is null
       and c.counterparty_organization_id is null
       and public.finance_norm_supplier(c.counterparty_name) is not null
       and not exists (
         select 1 from public.crm_link_suggestions s
          where s.company_id = c.company_id
            and s.source_entity_type = 'contract'
            and s.source_entity_id = c.id
            and s.status = 'pending')
     order by c.created_at desc
     limit v_limit
  loop
    -- ⚠️⚠️ `array_agg(...)[1]` E NON `min(o.id)`: **`min()` non esiste per
    -- `uuid`**. Misurato su QUESTO database il 2026-07-30 — PostgreSQL 17.6,
    -- nessuna `min(uuid)` in `pg_proc` — e non dedotto da una versione: quale
    -- release la introdurrà non è un fatto che serva a questo file.
    -- L'errore è `42883 function min(uuid) does not exist`, e non lo trova né
    -- una rilettura né `db:bundle`: il corpo di una plpgsql non viene analizzato
    -- alla creazione, quindi la migrazione si applica SENZA UN ERRORE e la
    -- funzione fallisce alla prima riga candidata. Trovato da `npm run test:crm`
    -- alla prima esecuzione — la stessa forma del 42804 della 0022 e della 0025.
    select count(*)::integer, (array_agg(o.id order by o.created_at))[1]
      into v_matches, v_target
      from public.crm_organizations o
     where o.company_id = r.company_id
       and o.archived_at is null
       and o.merged_into_id is null
       and public.finance_norm_supplier(coalesce(o.legal_name, o.display_name)) = r.norm;

    -- Più di una candidata: la decisione torna a una persona, e ci torna
    -- attraverso «possibili duplicati», non attraverso una scelta a caso.
    if v_matches > 1 then continue; end if;

    -- Il motivo dice la verità sui DUE casi, che sono diversi: «somiglia a
    -- questa scheda» e «nel CRM questo nome non c'è».
    if v_matches = 1 then
      v_reason := 'name_normalized';
    else
      v_target := null;
      v_reason := 'extracted_name';
    end if;
    v_detail := r.counterparty_name;

    v_key := 'crm:contract:' || r.id::text || ':' || v_reason::text || ':'
             || coalesce(v_target::text, 'new');

    insert into public.crm_link_suggestions (
      company_id, source_entity_type, source_entity_id,
      suggested_organization_id, suggested_name,
      reason, reason_detail, status, dedupe_key)
    values (
      r.company_id, 'contract', r.id,
      v_target,
      -- ⚠️ Il nome si copia SEMPRE, anche quando c'è già un'organizzazione: è
      -- la copia dichiarata della 0026, quella che permette di mostrare e
      -- rifiutare un suggerimento anche se l'origine nel frattempo è stata
      -- archiviata. Ed è ciò che la schermata legge per dire di CHI si parla.
      r.counterparty_name,
      v_reason, v_detail, 'pending', v_key)
    on conflict (company_id, dedupe_key) do nothing;

    if found then v_created := v_created + 1; end if;
  end loop;

  -- (b) I FORNITORI DI FINANZE
  --
  -- ⚠️ Si legge `eff_supplier_norm`, che il database ha già calcolato con la
  -- STESSA funzione: ricalcolarlo qui vorrebbe dire avere due definizioni di
  -- «nome normalizzato del fornitore» sulla stessa riga, ed è esattamente la
  -- divergenza che le colonne `eff_*` esistono per evitare.
  for r in
    select f.id, f.company_id, f.eff_supplier_name as counterparty_name,
           f.eff_supplier_norm as norm
      from public.finance_items f
     where f.archived_at is null
       and f.supplier_organization_id is null
       and f.eff_supplier_norm is not null
       and f.eff_supplier_name is not null
       and not exists (
         select 1 from public.crm_link_suggestions s
          where s.company_id = f.company_id
            and s.source_entity_type = 'finance_item'
            and s.source_entity_id = f.id
            and s.status = 'pending')
     order by f.created_at desc
     limit v_limit
  loop
    -- ⚠️ Anche qui `array_agg`, per la stessa ragione del ramo (a): `min(uuid)`
    -- non esiste prima di PostgreSQL 17.
    select count(*)::integer, (array_agg(o.id order by o.created_at))[1]
      into v_matches, v_target
      from public.crm_organizations o
     where o.company_id = r.company_id
       and o.archived_at is null
       and o.merged_into_id is null
       and public.finance_norm_supplier(coalesce(o.legal_name, o.display_name)) = r.norm;

    if v_matches > 1 then continue; end if;

    if v_matches = 1 then
      v_reason := 'name_normalized';
    else
      v_target := null;
      v_reason := 'extracted_name';
    end if;

    v_key := 'crm:finance_item:' || r.id::text || ':' || v_reason::text || ':'
             || coalesce(v_target::text, 'new');

    insert into public.crm_link_suggestions (
      company_id, source_entity_type, source_entity_id,
      suggested_organization_id, suggested_name,
      reason, reason_detail, status, dedupe_key)
    values (
      r.company_id, 'finance_item', r.id,
      v_target, r.counterparty_name,
      v_reason, r.counterparty_name, 'pending', v_key)
    on conflict (company_id, dedupe_key) do nothing;

    if found then v_created := v_created + 1; end if;
  end loop;

  -- (c) LE PROPOSTE RIMASTE SENZA ORIGINE
  --
  -- Un contratto o una fattura possono essere cancellati mentre una proposta
  -- che li riguarda è ancora in sospeso. `source_entity_id` è polimorfico e non
  -- ha una chiave esterna, quindi nessuna cascata la porta via: resterebbe una
  -- riga che chiede di confermare qualcosa che non esiste più, e che nessuno
  -- può risolvere sensatamente. Si tolgono solo quelle IN SOSPESO e solo delle
  -- due entità che questa scansione produce: una proposta già risolta è storia,
  -- e la storia non si cancella per comodità.
  delete from public.crm_link_suggestions s
   where s.status = 'pending'
     and s.source_entity_type = 'contract'
     and not exists (select 1 from public.contracts c where c.id = s.source_entity_id);

  delete from public.crm_link_suggestions s
   where s.status = 'pending'
     and s.source_entity_type = 'finance_item'
     and not exists (select 1 from public.finance_items f where f.id = s.source_entity_id);

  return v_created;
end $$;

comment on function public.crm_scan_link_suggestions(integer) is
  'Legge le controparti dei contratti e i fornitori di Finanze e propone il '
  'collegamento al CRM (§171). PROPONE: nessuna organizzazione nasce da qui e '
  'nessun documento viene collegato da qui. Da chiamare dal worker delle '
  'automazioni gia esistente: nessun cron nuovo. La chiave di idempotenza ha '
  'una copia dichiarata in suggestionKey() di src/features/crm/crmMatch.ts, e '
  'test:crm-unit legge questo file per confrontarle.';

-- ---------------------------------------------------------------------------
-- 3. I PERMESSI
--
-- ⚠️ `revoke` ESPLICITO, come la 0029. Su Supabase le funzioni nuove nascono
-- eseguibili da `anon` e `authenticated` per via di
-- `alter default privileges ... grant all on functions`: senza queste due
-- righe, un utente qualunque potrebbe far girare una funzione `security
-- definer` che scrive righe per tutte le aziende del progetto. Il controllo su
-- `auth.uid()` dentro la funzione resta la seconda serratura.
-- ---------------------------------------------------------------------------
revoke all on function public.crm_scan_link_suggestions(integer) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Autoverifica
--
-- Non prova la scansione — creare un'azienda richiede una riga in `auth.users`,
-- e fabbricarne una dentro una migrazione sarebbe peggio del difetto che si sta
-- prevenendo. Verifica ciò che qui si può verificare: che la funzione esista
-- come `security definer`, che nessun ruolo pubblico possa eseguirla, e che il
-- corpo depositato contenga davvero il controllo su `auth.uid()` — senza,
-- questa migrazione avrebbe aggiunto una porta invece di chiuderne una.
-- ---------------------------------------------------------------------------
do $$
declare
  v_secdef boolean;
  v_src    text;
  v_grant  text;
begin
  select p.prosecdef, p.prosrc into v_secdef, v_src
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'crm_scan_link_suggestions';

  if v_secdef is null then
    raise exception 'crm_scan_link_suggestions non esiste dopo la 0030';
  end if;
  if v_secdef = false then
    raise exception 'crm_scan_link_suggestions deve essere security definer';
  end if;
  if position('auth.uid() is not null' in v_src) = 0 then
    raise exception 'crm_scan_link_suggestions non rifiuta piu la chiamata di un utente';
  end if;

  select string_agg(g, ', ') into v_grant
    from unnest(array['anon', 'authenticated', 'public']) g
   where has_function_privilege(g, 'public.crm_scan_link_suggestions(integer)', 'execute');
  if v_grant is not null then
    raise exception 'ruoli che possono ancora eseguire la scansione: %', v_grant;
  end if;

  raise notice '0030 applicata: il candidato automatico propone, e solo il ruolo di servizio puo chiamarlo.';
end $$;
