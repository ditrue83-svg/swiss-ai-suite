-- ============================================================================
-- 0035 — I DUE SCHEDULER DEL CALENDARIO E DELLE NOTIFICHE ENTRANO NEL REPOSITORY
--
-- ⚠️ PERCHÉ ESISTE, e non è la stessa cosa che «accenderli».
-- Il 2026-07-31 `calendar-sync-drain` e `notifications-worker` sono stati
-- creati A MANO dal SQL editor, incollando il blocco di
-- docs/calendar-notifications.md §11.4. Da quel momento funzionano: sono in
-- `cron.job`, sono attivi, hanno le cadenze giuste. Ma esistono in DUE posti —
-- un documento e un database — e in nessuno dei due sono un artefatto tracciato.
--
-- Il costo di questa differenza è scritto, parola per parola, nel testo di
-- aiuto di `scripts/verify-deploy.mjs`: «se il database va rifatto non
-- torneranno». Un progetto Supabase ricostruito, un ambiente di prova, un
-- cliente installato da zero con `full-setup.sql` ottengono oggi undici moduli
-- e nessun promemoria — senza che un solo test diventi rosso, perché nessun
-- test può vedere un job che non è mai stato creato. È esattamente il difetto
-- che `test:operations` è nato per intercettare, e che intercettava a metà:
-- l'inventario accetta una dichiarazione scritta in un `.md`, e un blocco di
-- codice dentro un documento non lo esegue nessuno. Da questa migrazione
-- l'inventario pretende una MIGRAZIONE (controllo 5 di `test:operations`).
--
-- Questa migrazione non cambia il comportamento dei due worker. Non tocca il
-- loro codice, non tocca il loro contratto, non tocca i loro segreti. Rende
-- RIPRODUCIBILE ciò che oggi è stato battuto a mano una volta sola.
--
-- ---------------------------------------------------------------------------
-- ⚠️⚠️ L'ORIGINE DEL PROGETTO NON È SCRITTA QUI, E NON È UN VEZZO
--
-- I sei job HTTP già in esercizio portano l'origine scritta in chiaro nel
-- comando («https://<ref>.supabase.co/…»), perché sono stati creati a mano su
-- QUEL progetto e non sono mai passati da una migrazione. Una migrazione è
-- un'altra cosa: finisce in `supabase/full-setup.sql`, che la CI applica a un
-- database effimero a ogni pull request e che il README dà a chi installa da
-- zero. Con l'origine scritta dentro, OGNI installazione nuova programmerebbe
-- due chiamate ogni 10 e 15 minuti verso la NOSTRA produzione, autenticate con
-- un segreto che non ha — cioè un carico costante di 403 verso di noi, prodotto
-- dal database di qualcun altro.
--
-- L'origine si risolve quindi A OGNI ESECUZIONE, dal VAULT.
--
-- ⚠️ È lo stesso identico idioma che il repository usa già per il SEGRETO, e la
-- ragione scritta nel comando di `automation-worker` vale parola per parola
-- anche qui: «non è scritto nel job: si legge a ogni esecuzione, così ruotarlo
-- non richiede di riscrivere il job». Non è un secondo sistema di
-- configurazione: è lo STESSO, applicato all'altro dato che dipende
-- dall'ambiente.
--
-- ⚠️ PERCHÉ IL VAULT E NON UN PARAMETRO DI DATABASE, che era la prima scelta:
-- perché su Supabase ospitato NON SI PUÒ. Provato contro il progetto vero:
--     alter database postgres set app.settings.functions_base_url = '…'
--     → ERROR 42501: permission denied to set parameter
-- e lo stesso `alter role postgres set`. Il ruolo `postgres` possiede il
-- database ma non è superutente, e un parametro personalizzato a livello di
-- database o di ruolo richiede il superutente. Funziona solo `set` di sessione,
-- che a pg_cron — che apre la propria — non serve a niente. Il Vault invece è
-- scrivibile da noi: i sette segreti dei worker sono lì da giorni.
--
-- ⚠️ E SE NON È CONFIGURATO, SI VEDE. `public.functions_base_url()` SOLLEVA
-- invece di restituire NULL. Un database che non sa a quale progetto appartiene
-- non compone un URL sbagliato e non fa finta di niente: ogni esecuzione finisce
-- `failed` in `cron.job_run_details` con il messaggio che dice cosa manca e come
-- si rimedia. Un guasto registrato, non un risultato plausibile. Questa
-- migrazione lo annuncia inoltre con un WARNING quando viene applicata.
--
-- Perché un WARNING e non un'eccezione al momento dell'applicazione: un'
-- eccezione renderebbe inapplicabile l'intero elenco delle migrazioni a un
-- database vuoto, che è proprio il percorso che la CI prova a ogni pull request
-- (`supabase start` applica le migrazioni PRIMA che qualcuno possa configurare
-- alcunché). Il guasto non viene ammorbidito: viene spostato dove è
-- verificabile — a ogni esecuzione del job, e in `npm run verify:deploy`, che
-- dalla stessa data legge anche l'ESITO dell'ultima esecuzione di ogni job.
--
-- ⚠️ Una configurazione SBAGLIATA, invece, fa fallire questa migrazione: una
-- mezza configurazione è peggio di nessuna, perché somiglia a una buona.
--
-- Da eseguire UNA VOLTA sul progetto, prima o dopo questa migrazione:
--
--   select vault.create_secret('https://<ref>.supabase.co', 'project_functions_base_url');
--
-- ---------------------------------------------------------------------------
-- Requisiti: 0018 (calendario e notifiche) applicata; le Edge Function
-- `calendar-sync` e `notifications-worker` deployate; nel Vault
-- `calendar_worker_secret`, `notifications_worker_secret` e
-- `project_functions_base_url`.
-- Documento di modulo: docs/calendar-notifications.md §11.4
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Le estensioni
--
-- `pg_cron` la crea già la 0031; ripeterla è innocuo e rende questa migrazione
-- leggibile da sola. `pg_net` non la crea NESSUNA migrazione: i sei job che la
-- usano sono nati a mano su un progetto dove Supabase l'aveva già attivata, e
-- un'installazione da zero non ce l'avrebbe. È la prima volta che il
-- repository la dichiara.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema cron;
create extension if not exists pg_net  with schema extensions;

-- ---------------------------------------------------------------------------
-- 2. Da dove chiamare — l'unica funzione di questa migrazione
--
-- ⚠️ SOLLEVA invece di restituire NULL, ed è tutto il punto. Un `select` che
-- torna NULL comporrebbe `NULL || '/functions/v1/…'` = NULL, e
-- `net.http_post(url := null)` è un guasto che nessuno legge. Qui il messaggio
-- dice che cosa manca e quale comando lo rimedia, e finisce in
-- `cron.job_run_details.return_message`.
--
-- ⚠️ `security invoker` (il predefinito) DI PROPOSITO. Con `security definer`
-- questa funzione leggerebbe il Vault per conto di chiunque possa eseguirla, e
-- basterebbe un `grant` distratto per farne una finestra sul Vault. Così invece
-- chi non ha i privilegi sul Vault ottiene «permission denied for schema vault»
-- anche riuscendo a chiamarla. pg_cron esegue come `postgres`, che quei
-- privilegi ce li ha.
--
-- ⚠️ `search_path = ''` e ogni nome qualificato: senza, chi controlla il
-- `search_path` della sessione chiamante potrebbe interporre un proprio
-- `decrypted_secrets`.
-- ---------------------------------------------------------------------------
create or replace function public.functions_base_url()
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_raw text;
begin
  select s.decrypted_secret into v_raw
    from vault.decrypted_secrets s
   where s.name = 'project_functions_base_url';

  if v_raw is null then
    raise exception
      'project_functions_base_url non è nel Vault: questo database non sa a quale progetto appartiene, e gli scheduler non possono chiamare nessuna Edge Function. Rimedio: select vault.create_secret(''https://<ref>.supabase.co'', ''project_functions_base_url'');';
  end if;

  v_raw := btrim(v_raw);
  if v_raw = '' then
    raise exception 'project_functions_base_url è nel Vault ma VUOTO: comporrebbe un URL relativo.';
  end if;

  v_raw := rtrim(v_raw, '/');
  if v_raw !~ '^https?://[^[:space:]/]+$' then
    raise exception
      'project_functions_base_url non è utilizzabile: %. Serve la sola origine, senza percorso, per esempio https://abcdefgh.supabase.co',
      v_raw;
  end if;

  return v_raw;
end $fn$;

comment on function public.functions_base_url() is
  'Origine del progetto per gli scheduler, letta dal Vault a ogni esecuzione. Solleva se manca o non è utilizzabile: un URL composto male darebbe un cron eternamente fallito e silenzioso.';

-- ⚠️ Su `public` Supabase concede i privilegi pieni per default (la lezione del
-- preambolo di `full-setup.sql`): senza questo `revoke`, `anon` e
-- `authenticated` potrebbero eseguirla — e `public` è lo schema che PostgREST
-- espone, quindi sarebbe una `rpc` raggiungibile dal browser.
revoke all on function public.functions_base_url() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. La configurazione, se c'è, dev'essere SANA
--
-- Non si pretende che esista (vedi l'intestazione). Si pretende che, se
-- esiste, sia utilizzabile — e lo si verifica CHIAMANDO la funzione, non
-- ripetendone le regole qui: due copie della stessa validazione divergono.
-- ---------------------------------------------------------------------------
do $mig$
declare
  v_esiste boolean;
  v_base   text;
begin
  select exists (
    select 1 from vault.secrets where name = 'project_functions_base_url'
  ) into v_esiste;

  if not v_esiste then
    return;   -- il WARNING lo emette il blocco 5, dopo aver creato i job
  end if;

  v_base := public.functions_base_url();   -- solleva se è configurata male
  raise notice 'origine degli scheduler: %', v_base;
end $mig$;

-- ---------------------------------------------------------------------------
-- 4. I due job
--
-- ⚠️ Si toglie PRIMA di rimettere, per la ragione già scritta nella 0031:
-- `cron.schedule` con lo stesso nome aggiorna il job sulle versioni recenti di
-- pg_cron ma non su tutte, e senza la rimozione riapplicare questa migrazione
-- su una versione più vecchia fallirebbe con una violazione di unicità
-- lasciandola a metà. `cron.unschedule` su un nome inesistente solleva, quindi
-- si guarda prima se c'è.
--
-- ⚠️ `timeout_milliseconds := 150000` NON è facoltativo: pg_net chiude la
-- connessione dopo 5 secondi predefiniti, e i due worker hanno un budget di
-- 150. Senza, OGNI esecuzione risulterebbe fallita anche facendo il proprio
-- lavoro. È la trappola già pagata con l'Inbox.
--
-- ⚠️ I due comandi sono COSTANTI: non c'è un solo valore interpolato qui
-- dentro. Né l'origine né il segreto finiscono nel testo del job — si leggono
-- entrambi a ogni esecuzione. Chi legge `cron.job` non trova nulla da
-- proteggere.
-- ---------------------------------------------------------------------------
do $mig$
begin
  -- 4.1 La coda del calendario: ogni 10 minuti, perché è ciò che tiene
  --     allineati gli eventi. Payload `{"action":"drain"}`, che è il contratto
  --     di `calendar-sync` (le altre due azioni sono `sync`, di una persona, e
  --     `reconcile`, della diagnostica).
  if exists (select 1 from cron.job where jobname = 'calendar-sync-drain') then
    perform cron.unschedule('calendar-sync-drain');
  end if;

  perform cron.schedule(
    'calendar-sync-drain',
    '*/10 * * * *',
    $job$select net.http_post(
      url := public.functions_base_url() || '/functions/v1/calendar-sync',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-calendar-worker-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'calendar_worker_secret')
      ),
      body := jsonb_build_object('action', 'drain'),
      timeout_milliseconds := 150000
    );$job$
  );

  -- 4.2 I promemoria: ogni quarto d'ora. La finestra è «dalle otto locali in
  --     poi», quindi girare spesso serve a coprire tutti i fusi e a
  --     recuperare un'esecuzione saltata. Corpo vuoto: il worker non prende
  --     parametri.
  if exists (select 1 from cron.job where jobname = 'notifications-worker') then
    perform cron.unschedule('notifications-worker');
  end if;

  perform cron.schedule(
    'notifications-worker',
    '*/15 * * * *',
    $job$select net.http_post(
      url := public.functions_base_url() || '/functions/v1/notifications-worker',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-notifications-worker-secret',
        (select decrypted_secret from vault.decrypted_secrets where name = 'notifications_worker_secret')
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 150000
    );$job$
  );
end $mig$;

-- ---------------------------------------------------------------------------
-- 5. Autoverifica
--
-- Come la 0031 e la 0034: uno scheduler che si spera sia stato creato non è
-- stato creato. Ogni proprietà su cui poggia il funzionamento viene RILETTA da
-- `cron.job`, non dedotta dal fatto che le istruzioni sopra non abbiano
-- sollevato.
--
-- ⚠️ Compreso ciò che NON deve esserci: nessuna origine scritta in chiaro e
-- nessun segreto nel testo del comando. Un controllo che guarda solo ciò che
-- deve esserci non vede arrivare ciò che non deve.
-- ---------------------------------------------------------------------------
do $mig$
declare
  r        record;
  v_atteso record;
  v_quanti integer;
  v_esiste boolean;
begin
  for v_atteso in
    select * from (values
      ('calendar-sync-drain',  '*/10 * * * *', '/functions/v1/calendar-sync',        'calendar_worker_secret'),
      ('notifications-worker', '*/15 * * * *', '/functions/v1/notifications-worker', 'notifications_worker_secret')
    ) as t(nome, cadenza, bersaglio, segreto)
  loop
    -- (a) esiste, ed esiste UNA volta sola
    select count(*) into v_quanti from cron.job where jobname = v_atteso.nome;
    if v_quanti = 0 then
      raise exception 'il job % non è stato creato', v_atteso.nome;
    end if;
    if v_quanti > 1 then
      raise exception 'il job % è duplicato: % righe in cron.job', v_atteso.nome, v_quanti;
    end if;

    select * into r from cron.job where jobname = v_atteso.nome;

    -- (b) è attivo
    if not r.active then
      raise exception 'il job % esiste ma non è attivo', v_atteso.nome;
    end if;

    -- (c) la cadenza è quella dichiarata nell'inventario di test:operations
    if r.schedule <> v_atteso.cadenza then
      raise exception 'il job % ha cadenza «%», attesa «%»', v_atteso.nome, r.schedule, v_atteso.cadenza;
    end if;

    -- (d) punta alla funzione giusta
    if position(v_atteso.bersaglio in r.command) = 0 then
      raise exception 'il job % non punta a %', v_atteso.nome, v_atteso.bersaglio;
    end if;

    -- (e) dichiara il timeout, e quello giusto: la trappola dei 5 secondi
    if position('timeout_milliseconds := 150000' in r.command) = 0 then
      raise exception 'il job % non dichiara timeout_milliseconds := 150000', v_atteso.nome;
    end if;

    -- (f) legge il segreto dal Vault invece di portarselo dentro
    if position('vault.decrypted_secrets' in r.command) = 0
       or position(v_atteso.segreto in r.command) = 0 then
      raise exception 'il job % non legge % dal Vault', v_atteso.nome, v_atteso.segreto;
    end if;

    -- (g) e non porta un'origine scritta in chiaro
    if r.command ~ 'https?://' then
      raise exception
        'il job % contiene un URL in chiaro: l''origine va risolta da public.functions_base_url() a ogni esecuzione',
        v_atteso.nome;
    end if;
    if position('public.functions_base_url()' in r.command) = 0 then
      raise exception 'il job % non risolve l''origine da public.functions_base_url()', v_atteso.nome;
    end if;
  end loop;

  -- (h) la funzione non è raggiungibile da chi non deve
  if has_function_privilege('anon', 'public.functions_base_url()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.functions_base_url()', 'EXECUTE') then
    raise exception 'public.functions_base_url() è eseguibile da anon o authenticated: il revoke non ha avuto effetto';
  end if;

  -- (i) e infine: questo database sa a quale progetto appartiene?
  --     Non è una condizione per creare i job — è una condizione perché
  --     SERVANO. Detto qui, con accanto il comando esatto.
  select exists (select 1 from vault.secrets where name = 'project_functions_base_url') into v_esiste;
  if not v_esiste then
    raise warning
      'i due scheduler sono stati creati ma «project_functions_base_url» NON è nel Vault: ogni esecuzione fallirà, e lo dirà in cron.job_run_details. Da eseguire una volta: select vault.create_secret(''https://<ref>.supabase.co'', ''project_functions_base_url'');';
  end if;
end $mig$;

-- ---------------------------------------------------------------------------
-- 6. Il commento dell'estensione resta la mappa di ciò che il repository
--    programma DAVVERO, e non di ciò che qualcuno ha battuto a mano.
-- ---------------------------------------------------------------------------
comment on extension pg_cron is
  'Pianificazione dentro il database. Job creati da una migrazione: assistant-purge (0031), '
  'retention delle conversazioni dell''assistente; calendar-sync-drain e notifications-worker (0035), '
  'coda del calendario e promemoria. Gli altri job presenti nel progetto sono stati creati a mano '
  'dai blocchi SQL della documentazione di modulo (docs/ai-inbox.md, workflow-automation.md, '
  'finance-operations.md, contract-manager.md, incentivi.md) e NON tornerebbero se il database venisse rifatto.';
