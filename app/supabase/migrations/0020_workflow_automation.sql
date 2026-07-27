-- ============================================================================
-- AI-Swisse — 0020 WORKFLOW AUTOMATION (Automazioni)
--
-- QUANDO succede X, SE valgono le condizioni Y, ALLORA esegui Z.
--
-- Non è un agente autonomo e non è un costruttore di flussi generici: è il
-- motore di REGOLE OPERATIVE dell'azienda. Le regole sono DATI, mai codice —
-- nessun `eval`, nessuna espressione da interpretare, nessun SQL costruito a
-- stringhe. Il motore legge una configurazione dichiarativa e la confronta con
-- un insieme CHIUSO di campi che ogni evento dichiara.
--
-- ⚠️ QUESTA MIGRAZIONE NON CREA UNA SECONDA VERITÀ SU NIENTE.
-- Le automazioni non copiano analisi, non copiano documenti, non copiano
-- attività: leggono ciò che esiste e producono attività, categorie, etichette e
-- notifiche PASSANDO DALLE STESSE TABELLE E DAGLI STESSI TRIGGER che usa una
-- persona. Un'attività creata da una regola è un'attività normale, con lo stesso
-- storico, le stesse garanzie e la stessa sincronizzazione di calendario.
--
-- COSA CONTIENE
--   1.  Enum del dominio (tutti nuovi: utilizzabili subito).
--   2.  Due valori aggiunti a enum esistenti — e MAI nominati altrove qui.
--   3.  `automation_events`: l'outbox. Lo scrivono i TRIGGER, non il browser.
--   4.  `workflow_definitions`: la regola.
--   5.  `workflow_runs` + `workflow_action_runs`: cosa è stato fatto e perché.
--   6.  `workflow_events`: chi ha creato, attivato, messo in pausa, archiviato.
--   7.  Provenienza: `tasks.workflow_run_id`, `documents.category_workflow_run_id`.
--   8.  `automation_emit()` — il punto UNICO da cui nasce un evento.
--   9.  I trigger che lo chiamano (analisi, categoria, posta, attività).
--   10. La coda: prenotazione atomica con lease, come il calendario (0018).
--   11. RLS, permessi e autoverifica.
--
-- ⚠️ VINCOLO SUI VALORI ENUM NUOVI (lezione della 0015, ricordata da 0016/0017)
-- `alter type … add value` non rende l'etichetta utilizzabile finché la
-- transazione non è chiusa, e `full-setup.sql` concatena tutto in una
-- transazione sola. Qui si aggiungono DUE valori a due enum esistenti
-- (`notification_type` e `document_category_source`) e NESSUNA altra istruzione
-- di questo file li nomina: li scrive soltanto il codice del worker, a runtime.
-- `npm run db:bundle` lo verifica.
--
-- ⚠️ REVOKE PRIMA DEI GRANT (lezione della 0014)
-- Su Supabase ogni tabella nuova di `public` nasce con i permessi di TABELLA
-- completi per `anon` e `authenticated`. Un grant scritto dopo AGGIUNGE
-- privilegi: non ne toglie. Ogni tabella qui sotto passa da `revoke all`.
--
-- Questa migrazione è RIESEGUIBILE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum del dominio
-- ---------------------------------------------------------------------------

-- I tipi di evento della versione 1. Sei, e ognuno corrisponde a un fatto che il
-- prodotto PRODUCE GIÀ: non si dichiara un innesco che nessuno scriverebbe mai.
-- «Fattura ricevuta», «contratto in scadenza», «cliente creato» non ci sono
-- perché non esistono le sorgenti: elencarli qui li farebbe comparire in un
-- menu a tendina che non scatterebbe mai.
do $$ begin create type public.automation_event_type as enum (
  'document_analysis_completed',   -- un'analisi valida è stata scritta
  'document_category_changed',     -- la categoria organizzativa è cambiata
  'email_attention_ready',         -- una comunicazione ha finito il processamento
  'task_created',                  -- è nata un'attività
  'task_status_changed',           -- un'attività ha cambiato stato
  'task_became_overdue'            -- un'attività ha superato la propria scadenza
);
exception when duplicate_object then null; end $$;

comment on type public.automation_event_type is
  'Fatti del dominio che possono innescare una regola. Solo eventi che il prodotto '
  'produce davvero: un innesco dichiarato e mai emesso sarebbe una funzione finta.';

-- Stato di un evento nella coda. `dead_letter` è distinto da `failed`: il primo
-- è «ho smesso di riprovare», il secondo «non c'era niente da riprovare».
do $$ begin create type public.automation_event_status as enum
  ('pending', 'processing', 'done', 'failed', 'dead_letter');
exception when duplicate_object then null; end $$;

-- Stato di una regola. L'archiviazione È uno stato qui — a differenza delle
-- attività, dove è una data — perché una regola archiviata non deve poter
-- comparire in nessun elenco operativo e lo stato è il campo su cui filtra ogni
-- interrogazione del motore.
do $$ begin create type public.workflow_status as enum
  ('draft', 'active', 'paused', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin create type public.workflow_run_status as enum
  ('pending', 'running', 'succeeded', 'partial', 'failed', 'skipped');
exception when duplicate_object then null; end $$;

do $$ begin create type public.workflow_action_status as enum
  ('pending', 'succeeded', 'skipped', 'failed');
exception when duplicate_object then null; end $$;

-- Le voci dello storico di una regola. Sono gesti di PERSONE (più due decisioni
-- del sistema che vanno dichiarate: la pausa automatica e il taglio della
-- catena), non risultati di esecuzione: quelli stanno in `workflow_runs`.
-- §125 — «domain events» alimentano l'automazione, «audit events» raccontano
-- chi ha fatto cosa. Condividere una tabella confonderebbe le due cose.
do $$ begin create type public.workflow_audit_kind as enum (
  'created', 'updated', 'activated', 'paused', 'archived', 'restored',
  'retried', 'auto_paused', 'chain_depth_exceeded'
);
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Due valori aggiunti a enum ESISTENTI
--
-- ⚠️ NESSUNA ALTRA ISTRUZIONE DI QUESTO FILE PUÒ NOMINARLI, nemmeno dentro il
-- corpo di una funzione: Postgres li rifiuterebbe con 55P04 finché la
-- transazione non è chiusa. Li usa soltanto il worker, a runtime, quando la
-- migrazione è ormai applicata da un pezzo.
--
--   · notification_type      riceve il tipo delle notifiche prodotte da una
--                            regola. Riusare `task_assigned` avrebbe
--                            significato far dire alla campanella una cosa
--                            falsa; creare una tabella di notifiche parallela
--                            avrebbe significato due campanelle (§91).
--   · document_category_source riceve l'origine «regola aziendale». Non è
--                            «rule»: quella è la classificazione deterministica
--                            per tipo di documento ed ente (0017), che il
--                            prodotto fa da sé. Una categoria scelta da una
--                            regola dell'AZIENDA è una terza cosa, e chi guarda
--                            il documento ha diritto di sapere quale delle due
--                            l'ha messa.
-- ---------------------------------------------------------------------------
--   · task_source             riceve la provenienza «regola aziendale». Le tre
--                            esistenti dicono da quale MODULO nasce il lavoro
--                            (analisi documentale, incentivi, mano di una
--                            persona): nessuna delle tre descrive un'attività
--                            che non ha deciso nessuno sul momento. Chi la
--                            riceve ha diritto di saperlo, e
--                            `tasks.workflow_run_id` dice anche QUALE regola.
alter type public.notification_type add value if not exists 'workflow_alert';
alter type public.document_category_source add value if not exists 'workflow';
alter type public.task_source add value if not exists 'workflow';

-- ---------------------------------------------------------------------------
-- 3. automation_events — l'outbox
--
-- IL PATTERN, E PERCHÉ NON SE NE PUÒ FARE A MENO.
-- Un'analisi che finisce e una regola che parte sono due cose che devono
-- succedere insieme o non succedere affatto. Se la seconda vivesse dentro la
-- richiesta della prima — `await salvaAnalisi(); await eseguiRegole();` — un
-- guasto in mezzo lascerebbe l'analisi scritta e le regole perse, e nessuno lo
-- saprebbe. Qui l'evento nasce nella STESSA TRANSAZIONE del fatto, scritto da
-- un trigger: o ci sono entrambi o non c'è nessuno dei due. Poi un worker
-- asincrono lo consuma, e il processo di partenza è già finito da un pezzo
-- (§11/§58).
--
-- ⚠️ IL CLIENT NON PUÒ SCRIVERE QUI, E NON PUÒ NEMMENO LEGGERE.
-- Nessun GRANT, per nessun ruolo diverso da `service_role`. Un browser che
-- potesse dichiarare `document_analysis_completed` con un payload inventato
-- potrebbe far creare attività, cambiare categorie e mandare notifiche a nome
-- di regole che non ha scritto lui (§12/§151).
--
-- ⚠️ IL PAYLOAD È MINIMO (§13/§117).
-- Identificativi e pochissimi metadati. MAI il corpo di una email, mai il testo
-- estratto di un documento, mai un allegato, mai un JSON di analisi. Chi esegue
-- la regola ha il service role e può rileggere ciò che gli serve dalle tabelle
-- vere: conservarne una copia qui significherebbe soltanto moltiplicare i posti
-- da cui un dato personale può uscire.
-- ---------------------------------------------------------------------------
create table if not exists public.automation_events (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  event_type        public.automation_event_type not null,
  -- Testo e non enum: `entity_type` non governa nessuna decisione di
  -- autorizzazione — quella la fa `company_id` — e serve solo a sapere in quale
  -- tabella andare a rileggere. Stessa scelta di `notifications` (0018).
  entity_type       text not null check (entity_type in ('document', 'email_message', 'task')),
  entity_id         uuid not null,
  -- La versione del CONTRATTO dell'evento. Serve il giorno in cui un evento
  -- cambia forma: le regole scritte per la versione 1 devono continuare a
  -- essere interpretabili, e un worker deve poter rifiutare ciò che non capisce
  -- invece di indovinare.
  event_version     integer not null default 1 check (event_version >= 1),
  payload           jsonb not null default '{}'::jsonb,
  occurred_at       timestamptz not null default now(),
  created_at        timestamptz not null default now(),

  -- ---- Provenienza e catena causale (§68/§69/§71/§72) --------------------
  -- `system` = il fatto è successo perché qualcuno ha caricato un documento,
  -- ricevuto una email, creato un'attività. `automation` = l'ha prodotto una
  -- regola. Senza questa distinzione una regola che crea attività e una regola
  -- che reagisce alle attività si inseguirebbero all'infinito.
  origin            text not null default 'system' check (origin in ('system', 'automation')),
  origin_run_id     uuid,          -- FK a workflow_runs: aggiunta più sotto (dipendenza circolare)
  -- L'identità della CATENA. Tutti gli eventi discendenti da uno stesso fatto
  -- iniziale condividono questo valore, ed è ciò che permette la regola
  -- fondamentale: una regola gira AL PIÙ UNA VOLTA per catena.
  correlation_id    uuid not null default gen_random_uuid(),
  causation_id      uuid references public.automation_events (id) on delete set null,
  root_event_id     uuid references public.automation_events (id) on delete set null,
  chain_depth       integer not null default 0 check (chain_depth >= 0),

  -- ---- Coda ---------------------------------------------------------------
  processing_status public.automation_event_status not null default 'pending',
  attempts          integer not null default 0,
  next_attempt_at   timestamptz not null default now(),
  -- Lease a SCADENZA e non booleano: un worker ucciso dai 150 secondi di
  -- Supabase non deve bloccare una riga per sempre (§61). È la stessa forma
  -- della coda del calendario, e per la stessa ragione.
  locked_until      timestamptz,
  lock_id           uuid,
  processed_at      timestamptz,
  error_code        text,
  -- Idempotenza dell'EMISSIONE. Serve agli eventi che nascono da una scansione
  -- periodica («questa attività è scaduta»), che senza chiave si ripeterebbero
  -- a ogni giro. Gli eventi che nascono da un cambiamento di stato non ne hanno
  -- bisogno — il trigger scatta una volta per UPDATE — e dargliene una finta
  -- con dentro un timestamp sarebbe scrivere un vincolo che non vincola nulla.
  -- È esattamente la scelta già fatta per `notifications.dedupe_key` (0018).
  dedupe_key        text
);

create unique index if not exists uq_automation_events_dedupe
  on public.automation_events (company_id, dedupe_key) where dedupe_key is not null;
-- La domanda del worker: «cosa c'è da fare adesso». Indice parziale, perché le
-- righe già trattate sono la maggioranza e non interessano più.
create index if not exists idx_automation_events_due
  on public.automation_events (next_attempt_at, company_id)
  where processing_status in ('pending', 'processing');
-- La diagnostica: cosa è successo a questa azienda, e cosa è finito male.
create index if not exists idx_automation_events_company
  on public.automation_events (company_id, occurred_at desc);
create index if not exists idx_automation_events_dead
  on public.automation_events (company_id, occurred_at desc)
  where processing_status = 'dead_letter';
-- La regola «una volta per catena» interroga per correlazione.
create index if not exists idx_automation_events_chain
  on public.automation_events (correlation_id);

comment on table public.automation_events is
  'Outbox dei fatti del dominio. Lo scrivono i trigger nella stessa transazione del '
  'fatto; il client non ha alcun permesso, né di lettura né di scrittura. Append-only: '
  'nessuno può riscrivere un evento già avvenuto.';
comment on column public.automation_events.payload is
  'Solo identificativi e metadati minimi. Mai corpi di email, testi estratti o allegati: '
  'chi esegue rilegge dalle tabelle vere con il service role.';
comment on column public.automation_events.correlation_id is
  'Identità della catena causale. Una regola gira al più una volta per catena: è ciò '
  'che impedisce sia il ciclo su sé stessa sia il ciclo A→B→A.';

-- ---------------------------------------------------------------------------
-- 4. workflow_definitions — la regola
--
-- `conditions` e `actions` sono JSONB e la scelta è motivata (§127/§128): una
-- configurazione è per natura una struttura variabile, e normalizzarla in
-- `workflow_condition_rows` + `workflow_condition_values` avrebbe prodotto tre
-- tabelle da ricomporre a ogni lettura per rappresentare quello che è, di
-- fatto, un documento. Il prezzo del JSONB è che il database non ne conosce la
-- forma: si paga con i vincoli strutturali qui sotto (tipo, dimensione,
-- numero di elementi) e con la validazione SEMANTICA nel registro tipizzato,
-- che è l'unico posto in cui esistono i campi e le azioni ammesse.
--
-- ⚠️ NESSUN PERMESSO DI SCRITTURA PER IL CLIENT. Si crea, si modifica, si
-- attiva e si archivia SOLO passando dalla Edge Function `automation-admin`,
-- che verifica il ruolo e valida la configurazione contro il registro prima di
-- scrivere. È la stessa disciplina delle connessioni di posta (0013): «al
-- client non serve nessun permesso di scrittura, e non averlo è più solido che
-- averlo e controllarlo altrove».
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_definitions (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  name             text not null check (length(btrim(name)) between 1 and 80),
  description      text check (length(description) <= 500),
  status           public.workflow_status not null default 'draft',
  trigger_type     public.automation_event_type not null,
  -- `all` = tutte le condizioni devono valere, `any` = ne basta una (§22).
  -- Due valori e non un albero ricorsivo: un costruttore di espressioni
  -- annidate è una cosa che si scrive in una settimana e si spiega in un'ora,
  -- e nessun titolare di PMI ne ha mai chiesto uno.
  condition_match  text not null default 'all' check (condition_match in ('all', 'any')),
  conditions       jsonb not null default '[]'::jsonb,
  actions          jsonb not null default '[]'::jsonb,

  -- La versione cresce a ogni modifica della configurazione, e ogni esecuzione
  -- registra quale versione ha eseguito: le run di ieri restano interpretabili
  -- anche dopo che la regola è cambiata (§46/§47).
  version          integer not null default 1 check (version >= 1),

  -- ⚠️ §163 — ATTIVARE UNA REGOLA NON PROCESSA IL PASSATO.
  -- Non è un filtro nel worker che qualcuno può dimenticare: il motore confronta
  -- `occurred_at` dell'evento con questa data. Una regola attivata oggi non può
  -- reagire a un documento di marzo, e la garanzia sta in un solo posto.
  activated_at     timestamptz,

  -- «Attiva, ma richiede attenzione» (§103): la configurazione è diventata
  -- invalida — il responsabile non è più in azienda, l'etichetta è stata
  -- cancellata. Non è uno stato, perché la regola resta quella che è: è un
  -- CODICE, e la schermata lo traduce in una frase che dice cosa fare.
  attention_code   text,
  attention_at     timestamptz,
  -- Fallimenti PERMANENTI consecutivi. Oltre la soglia la regola si mette in
  -- pausa da sé (§104): fallire diecimila volte non è resilienza, è rumore.
  consecutive_failures integer not null default 0 check (consecutive_failures >= 0),

  last_run_at      timestamptz,
  last_run_status  public.workflow_run_status,

  created_by       uuid references auth.users (id) on delete set null,
  updated_by       uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  archived_at      timestamptz,
  archived_by      uuid references auth.users (id) on delete set null,

  -- Vincoli STRUTTURALI: ciò che il database può verificare da solo su un
  -- JSONB. La semantica — questo campo esiste? questa azione esiste? questo
  -- segnaposto è valido? — la verifica il registro, e senza quella validazione
  -- la regola non può essere attivata.
  constraint workflow_conditions_is_array check (jsonb_typeof(conditions) = 'array'),
  constraint workflow_actions_is_array    check (jsonb_typeof(actions) = 'array'),
  constraint workflow_conditions_max      check (jsonb_array_length(conditions) <= 10),
  constraint workflow_actions_max         check (jsonb_array_length(actions) <= 5)
);

-- ⚠️ §154 — l'indice che rende il motore indipendente dal numero di aziende.
-- La domanda del worker è sempre la stessa: «quali regole ATTIVE di QUESTA
-- azienda ascoltano QUESTO tipo di evento». Senza questo indice parziale,
-- ogni evento costerebbe una scansione di tutte le regole del database.
create index if not exists idx_workflows_active
  on public.workflow_definitions (company_id, trigger_type)
  where status = 'active';
-- L'elenco della schermata: tutte quelle non archiviate, dalla più recente.
create index if not exists idx_workflows_company
  on public.workflow_definitions (company_id, created_at desc)
  where status <> 'archived';

comment on table public.workflow_definitions is
  'Una regola operativa dell''azienda: QUANDO / SE / ALLORA. La configurazione è un '
  'DATO, mai codice: nessuna espressione viene interpretata, nessun SQL viene costruito.';
comment on column public.workflow_definitions.activated_at is
  'Da quando la regola è in vigore. Il motore ignora gli eventi precedenti: attivare '
  'una regola non fa ripartire il passato, e la garanzia sta qui e non in un filtro '
  'sparso nel worker.';
comment on column public.workflow_definitions.attention_code is
  'Configurazione diventata invalida a regola già attiva (responsabile uscito, etichetta '
  'cancellata). Codice, non frase: la frase la scrive l''interfaccia nella lingua di chi legge.';

-- ---------------------------------------------------------------------------
-- 5. workflow_runs — che cosa è successo, e con quale versione della regola
--
-- ⚠️ `unique (workflow_id, trigger_event_id)` È L'IDEMPOTENZA DI PIÙ ALTO
-- LIVELLO, e non è un indice «per sicurezza»: è la ragione per cui lo stesso
-- evento consegnato due volte non produce due esecuzioni. Un ritentativo
-- RIUSA la riga esistente invece di crearne una nuova, e le azioni già
-- riuscite non vengono rifatte (§43/§65/§135).
--
-- ⚠️ NON SI SCRIVE UNA RUN PER OGNI EVENTO CHE NON CORRISPONDE (§101).
-- Una regola su «categoria = Imposte» vedrebbe passare ogni documento
-- dell'azienda: con novecentonovanta documenti l'anno significherebbe
-- novecentonovanta righe «saltata» che nessuno leggerà mai, e la storia utile
-- — le venti volte in cui ha agito — sarebbe sepolta. Si scrive una run quando
-- le condizioni CORRISPONDONO, oppure quando qualcosa è andato storto: i non
-- corrispondenti diventano un contatore sull'evento, non una riga.
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_runs (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  workflow_id       uuid not null references public.workflow_definitions (id) on delete cascade,
  workflow_version  integer not null,
  -- Fotografia della configurazione USATA. Senza, una run di ieri letta domani
  -- racconterebbe la regola di domani: si vedrebbero azioni che non sono mai
  -- state eseguite e non si vedrebbero quelle che lo sono state (§46).
  config_snapshot   jsonb not null default '{}'::jsonb,
  trigger_event_id  uuid references public.automation_events (id) on delete set null,

  -- L'entità su cui la regola ha agito. Solo tipo e identificativo: il titolo
  -- lo rilegge la schermata dalle tabelle vere, passando dalla RLS. Conservarne
  -- una copia qui significherebbe sia un dato in più da proteggere sia un
  -- titolo che invecchia (§117).
  entity_type       text check (entity_type in ('document', 'email_message', 'task')),
  entity_id         uuid,

  status            public.workflow_run_status not null default 'pending',
  -- Le condizioni, una per una, con l'esito. È ciò che permette alla schermata
  -- di dire «✓ Categoria = Imposte» invece di «ha funzionato» (§49). Contiene
  -- il campo, l'operatore, il valore ATTESO e l'esito: NON il valore osservato
  -- quando è un testo libero, per non trascinare qui il mittente di ogni
  -- documento dell'azienda.
  condition_results jsonb not null default '[]'::jsonb,
  started_at        timestamptz not null default now(),
  completed_at      timestamptz,
  duration_ms       integer,
  error_code        text,
  created_at        timestamptz not null default now(),

  unique (workflow_id, trigger_event_id)
);
create index if not exists idx_workflow_runs_wf
  on public.workflow_runs (workflow_id, started_at desc);
create index if not exists idx_workflow_runs_company
  on public.workflow_runs (company_id, started_at desc);
-- «Quante esecuzioni e quanti errori negli ultimi trenta giorni» (§102).
create index if not exists idx_workflow_runs_problem
  on public.workflow_runs (workflow_id, started_at desc)
  where status in ('failed', 'partial');

comment on table public.workflow_runs is
  'Un''esecuzione. Immutabile per il client: la scrive il worker con il service role. '
  'Il vincolo unico (workflow, evento) è ciò che impedisce a un evento consegnato due '
  'volte di produrre due esecuzioni.';

-- Ora che `workflow_runs` esiste, si può chiudere la dipendenza circolare: un
-- evento può essere stato prodotto da una run, e una run nasce da un evento.
do $$ begin
  alter table public.automation_events
    add constraint automation_events_origin_run_fk
    foreign key (origin_run_id) references public.workflow_runs (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 6. workflow_action_runs — ogni azione, con la sua chiave di idempotenza
--
-- ⚠️ LA CHIAVE UNICA È NEL DATABASE, NON NEL CODICE (§66).
-- «Guarda se esiste, poi inserisci» non è una garanzia: fra il guardare e
-- l'inserire ci sta un'altra esecuzione del worker. Qui la seconda insert
-- fallisce con 23505 e l'esecutore lo interpreta per quello che è — «l'ho già
-- fatto» — invece di creare una seconda attività identica.
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_action_runs (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies (id) on delete cascade,
  workflow_run_id    uuid not null references public.workflow_runs (id) on delete cascade,
  action_key         text not null check (length(action_key) between 1 and 60),
  action_position    integer not null check (action_position >= 0),
  status             public.workflow_action_status not null default 'pending',
  -- `<evento>:<regola>:<posizione>`. L'identificativo dell'evento è già unico,
  -- quindi la chiave lo è; averla in chiaro invece che come impronta permette
  -- di capire, guardando una riga, quale esecuzione l'ha prodotta.
  idempotency_key    text not null,
  -- Che cosa ha prodotto: l'attività creata, il documento toccato, la notifica.
  output_entity_type text check (output_entity_type in ('task', 'document', 'notification', 'document_tag')),
  output_entity_id   uuid,
  -- Perché è stata saltata o è fallita. Codice, mai frase: la frase la scrive
  -- l'interfaccia nella lingua di chi legge (§50).
  error_code         text,
  started_at         timestamptz,
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),

  unique (idempotency_key),
  unique (workflow_run_id, action_position)
);
create index if not exists idx_action_runs_run
  on public.workflow_action_runs (workflow_run_id, action_position);

comment on column public.workflow_action_runs.idempotency_key is
  'Chiave di idempotenza «evento:regola:posizione». L''unicità la impone il database: '
  'un controllo applicativo non regge fra due esecuzioni sovrapposte del worker.';

-- ---------------------------------------------------------------------------
-- 7. workflow_events — chi ha fatto cosa alla regola
--
-- §124/§125 — È UN ALTRO REGISTRO, non lo stesso di `automation_events`.
-- Quello è la coda che alimenta il motore; questo racconta le decisioni delle
-- persone: chi ha creato, attivato, messo in pausa, archiviato, ritentato. Lo
-- scrivono i trigger, e il client non può scriverlo — un registro che
-- l'interessato può riscrivere non è un registro (0016).
-- ---------------------------------------------------------------------------
create table if not exists public.workflow_events (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  workflow_id    uuid not null references public.workflow_definitions (id) on delete cascade,
  actor_user_id  uuid references auth.users (id) on delete set null,
  kind           public.workflow_audit_kind not null,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_workflow_events_wf
  on public.workflow_events (workflow_id, created_at desc);
create index if not exists idx_workflow_events_company
  on public.workflow_events (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 8. Provenienza sulle entità prodotte
--
-- §42 — «serve sapere: questa attività è stata creata automaticamente dalla
-- regola X». Una relazione esplicita, NON una frase infilata nella descrizione:
-- una descrizione è testo per una persona, e scriverci dentro un dato
-- strutturato significa non poterlo più interrogare e doverlo leggere con
-- un'espressione regolare.
--
-- Le due colonne servono anche alla PROTEZIONE DEI CICLI: sono il modo in cui
-- il trigger che emette l'evento successivo sa di essere dentro una catena
-- avviata da un'automazione, e non all'inizio di una nuova storia (§68).
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists workflow_run_id uuid references public.workflow_runs (id) on delete set null;

alter table public.documents
  add column if not exists category_workflow_run_id uuid references public.workflow_runs (id) on delete set null;

create index if not exists idx_tasks_workflow_run
  on public.tasks (workflow_run_id) where workflow_run_id is not null;

-- ⚠️ Una notifica prodotta da una regola può riferirsi a un DOCUMENTO o a una
-- COMUNICAZIONE, non solo a un'attività. Il vincolo della 0018 ammetteva due
-- soli valori perché due erano i casi che esistevano allora; lasciarlo com'era
-- avrebbe fatto fallire l'azione «notifica» su ogni innesco documentale con un
-- errore di vincolo, cioè con un guasto tecnico al posto di una funzione.
-- Si allarga l'elenco, non si toglie il controllo: un `entity_type` libero
-- permetterebbe di scrivere qualsiasi cosa e la campanella comporrebbe
-- collegamenti verso rotte inesistenti.
alter table public.notifications drop constraint if exists notifications_entity_type_check;
do $$ begin
  alter table public.notifications
    add constraint notifications_entity_type_check
    check (entity_type in ('task', 'calendar_connection', 'document', 'email_message'));
exception when duplicate_object then null; end $$;

comment on column public.tasks.workflow_run_id is
  'L''esecuzione che ha creato questa attività, quando è nata da una regola. Si scrive '
  'solo all''inserimento: una modifica successiva non è una creazione, e riscriverlo '
  'farebbe dire alla schermata una cosa falsa.';
comment on column public.documents.category_workflow_run_id is
  'L''esecuzione che ha impostato la categoria, quando l''ha impostata una regola. '
  'Accompagna category_source: dice QUALE regola, non solo che ce n''è stata una.';

-- ---------------------------------------------------------------------------
-- 9. I limiti, dichiarati dal database
--
-- Esistono in due posti — qui e nel contratto TypeScript del motore — perché il
-- database li APPLICA e l'interfaccia li DICHIARA. Quando le due copie
-- divergono, la schermata promette una cosa e il sistema ne fa un'altra: è già
-- successo con `INITIAL_SYNC_DAYS` dell'Inbox, e da allora un test verifica che
-- coincidano. Questa funzione esiste perché quel test possa farlo.
-- ---------------------------------------------------------------------------
create or replace function public.automation_limits()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'maxActiveWorkflows', 10,
    'maxConditions', 10,
    'maxActions', 5,
    'maxChainDepth', 5,
    'maxEventAttempts', 5,
    'maxRunsPerCompanyPerPass', 50,
    'maxTemplateLength', 200
  );
$$;

revoke all on function public.automation_limits() from public, anon;
grant execute on function public.automation_limits() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 10. automation_emit — il punto UNICO da cui nasce un evento
--
-- Tutti i trigger passano di qui. Una funzione sola perché le decisioni
-- delicate — non emettere se nessuno ascolta, ereditare la catena, fermarsi
-- alla profondità massima — devono esistere in un posto solo: scritte cinque
-- volte, prima o poi quattro sono giuste e una no.
--
-- ⚠️ NON SI EMETTE SE NESSUNA REGOLA ATTIVA ASCOLTA QUESTO TIPO DI EVENTO.
-- È la stessa scelta di `calendar_enqueue_task`, che non accoda nulla per le
-- aziende senza calendario collegato. Senza, l'importazione iniziale di una
-- casella di posta scriverebbe ottanta righe che nessuno consumerà mai. La
-- conseguenza va detta: gli eventi accaduti PRIMA che una regola esistesse non
-- si trovano da nessuna parte — ed è coerente con §163, perché una regola
-- appena attivata non deve comunque processare il passato.
--
-- `security definer` perché i trigger che la chiamano girano per conto di
-- chiunque stia scrivendo, e questa tabella non ha permessi per nessuno.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 11. I trigger che emettono
--
-- ⚠️ Ognuno emette dalla TABELLA che possiede il fatto, e non da un servizio:
-- così l'evento e il fatto stanno nella stessa transazione qualunque sia il
-- percorso che ha scritto il fatto — l'interfaccia, una Edge Function, uno
-- script di manutenzione o una migrazione. Un evento emesso dal codice
-- applicativo avrebbe coperto solo i percorsi a cui qualcuno ha pensato.
-- ---------------------------------------------------------------------------

-- (a) Un'analisi valida è stata scritta.
--     Le analisi FALLITE non emettono: un'analisi fallita non descrive niente,
--     e far scattare una regola su un fallimento significherebbe classificare o
--     assegnare lavoro sulla base di un dato che non esiste (§140).
create or replace function public.automation_on_analysis()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc record;
begin
  if new.analysis_status = 'failed' then return new; end if;

  select d.id, d.company_id, d.category, d.source_type
    into v_doc
    from public.documents d
   where d.id = new.document_id;

  -- Il confronto sull'azienda NON è ridondante: questa funzione è
  -- `security definer` e una funzione che scavalca la RLS deve difendersi da
  -- sola, senza fidarsi di una policy scritta altrove (lezione della 0017).
  if v_doc.id is null or v_doc.company_id is distinct from new.company_id then
    return new;
  end if;

  perform public.automation_emit(
    new.company_id, 'document_analysis_completed', 'document', new.document_id,
    jsonb_build_object('analysisId', new.id, 'analysisStatus', new.analysis_status),
    -- Una rianalisi dello stesso documento È un fatto nuovo (il contenuto
    -- capito può essere cambiato), quindi nessuna deduplicazione: la si
    -- otterrebbe solo inventando una chiave con dentro l'ora.
    null, null
  );
  return new;
end $$;

drop trigger if exists trg_automation_analysis on public.document_analyses;
create trigger trg_automation_analysis
  after insert on public.document_analyses
  for each row execute function public.automation_on_analysis();

-- (b) La categoria organizzativa è cambiata.
--     Solo il CAMBIO, non ogni salvataggio del documento: rinominare un file
--     non è un fatto per cui una regola debba muoversi.
create or replace function public.automation_on_category()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.category is not distinct from old.category then return new; end if;
  if new.category is null then return new; end if;

  perform public.automation_emit(
    new.company_id, 'document_category_changed', 'document', new.id,
    jsonb_build_object(
      'category', new.category,
      'previousCategory', old.category,
      'categorySource', new.category_source
    ),
    null,
    -- Se la categoria l'ha messa una regola, l'evento eredita la catena: è il
    -- filo che impedisce a due regole di rincorrersi sulla stessa categoria.
    new.category_workflow_run_id
  );
  return new;
end $$;

drop trigger if exists trg_automation_category on public.documents;
create trigger trg_automation_category
  after update on public.documents
  for each row execute function public.automation_on_category();

-- (c) Una comunicazione ha finito il processamento ed è pronta per una persona.
--     Si emette al passaggio a `done`, che è lo stato terminale riuscito. Non
--     su `failed`: là non c'è una comunicazione capita, c'è un guasto — e
--     l'Inbox lo mostra già come tale.
create or replace function public.automation_on_email_ready()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.processing_status <> 'done' then return new; end if;
  if old.processing_status = 'done' then return new; end if;

  perform public.automation_emit(
    new.company_id, 'email_attention_ready', 'email_message', new.id,
    jsonb_build_object(
      'attentionStatus', new.attention_status,
      'relevance', new.relevance,
      'hasAttachments', new.has_attachments
    ),
    -- Un messaggio raggiunge `done` una volta sola nella pratica, ma la chiave
    -- lo rende un fatto: una riesecuzione della pipeline non produce due
    -- eventi, e quindi non due attività.
    'email:' || new.id::text || ':ready',
    null
  );
  return new;
end $$;

drop trigger if exists trg_automation_email_ready on public.email_messages;
create trigger trg_automation_email_ready
  after update on public.email_messages
  for each row execute function public.automation_on_email_ready();

-- (d) Attività: creazione e cambio di stato.
create or replace function public.automation_on_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.automation_emit(
      new.company_id, 'task_created', 'task', new.id,
      jsonb_build_object('source', new.source, 'priority', new.priority,
                         'status', new.status, 'hasAssignee', new.assignee_user_id is not null),
      null,
      -- ⚠️ Qui si chiude il cerchio della protezione dei cicli: un'attività
      -- creata da una regola porta con sé l'esecuzione che l'ha creata, quindi
      -- l'evento che ne nasce sa di essere dentro una catena e ne eredita la
      -- profondità. Senza questa riga, «quando nasce un'attività, crea
      -- un'attività» girerebbe per sempre.
      new.workflow_run_id
    );
    return new;
  end if;

  if new.status is distinct from old.status then
    perform public.automation_emit(
      new.company_id, 'task_status_changed', 'task', new.id,
      jsonb_build_object('from', old.status, 'to', new.status,
                         'priority', new.priority,
                         'hasAssignee', new.assignee_user_id is not null),
      null, new.workflow_run_id
    );
  end if;

  return new;
end $$;

drop trigger if exists trg_automation_task on public.tasks;
create trigger trg_automation_task
  after insert or update on public.tasks
  for each row execute function public.automation_on_task();

-- ---------------------------------------------------------------------------
-- 12. «È diventata scaduta»: un fatto che non ha un UPDATE
--
-- Nessuno scrive niente quando un'attività supera la propria scadenza: passa il
-- tempo, e basta. Serve quindi una scansione — ma NON un secondo rilevatore di
-- scadenze (§9): la definizione di «scaduta» è quella che il prodotto già usa
-- nella vista «Scadute» di `list_tasks`, cioè `due_date < current_date` con
-- l'attività né conclusa né archiviata. Averne due significherebbe una
-- schermata che dice «in ritardo» e una regola che non scatta.
--
-- La finestra all'indietro è deliberata: si guardano solo le attività scadute
-- di recente. Senza, la prima esecuzione dopo l'attivazione di una regola
-- rovescerebbe addosso all'azienda tutto l'arretrato — che è esattamente il
-- backfill che §164 vieta.
--
-- La chiave di deduplicazione rende l'emissione idempotente: un'attività
-- diventa scaduta UNA volta. Se viene completata e riaperta oltre la scadenza,
-- non riparte: «scaduta» descrive il superamento della data, non lo stato del
-- lavoro, e ripeterlo ogni mattina addestrerebbe a ignorare l'avviso — la
-- stessa scelta già fatta per il promemoria «scaduta» dei calendari (0018).
-- ---------------------------------------------------------------------------
create or replace function public.automation_emit_overdue(
  p_lookback_days integer default 3,
  p_limit         integer default 200
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task  record;
  v_count integer := 0;
  v_id    uuid;
begin
  for v_task in
    select t.id, t.company_id, t.priority, t.status, t.due_date,
           t.assignee_user_id is not null as has_assignee
      from public.tasks t
     where t.status <> 'completed'
       and t.archived_at is null
       and t.due_date is not null
       and t.due_date < current_date
       and t.due_date >= current_date - greatest(1, least(coalesce(p_lookback_days, 3), 30))
     order by t.due_date desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    v_id := public.automation_emit(
      v_task.company_id, 'task_became_overdue', 'task', v_task.id,
      jsonb_build_object('priority', v_task.priority, 'status', v_task.status,
                         'dueDate', v_task.due_date, 'hasAssignee', v_task.has_assignee),
      'task:' || v_task.id::text || ':overdue',
      null
    );
    if v_id is not null then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

revoke all on function public.automation_emit_overdue(integer, integer) from public, anon, authenticated;
grant execute on function public.automation_emit_overdue(integer, integer) to service_role;

-- ---------------------------------------------------------------------------
-- 13. La coda: prenotazione atomica di un lotto
--
-- `for update skip locked`, come la coda del calendario e per la stessa
-- ragione: due esecuzioni sovrapposte del worker lavorano su eventi diversi
-- senza aspettarsi a vicenda. Il `locked_until` sopravvive alla transazione,
-- quindi un isolate ucciso a metà libera la riga alla scadenza invece di
-- tenerla presa per sempre (§61/§133).
--
-- ⚠️ IL TETTO PER AZIENDA (§73) non è prudenza teorica: un'importazione
-- iniziale di posta o un caricamento massivo di documenti possono produrre
-- centinaia di eventi in un minuto, e senza tetto una sola azienda occuperebbe
-- ogni esecuzione del worker mentre le altre aspettano. `row_number()` per
-- azienda risolve con una riga di SQL ciò che nel worker sarebbe stato un
-- contatore da ricordarsi.
-- ---------------------------------------------------------------------------
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

-- L'età dell'evento più vecchio ancora da trattare (§169). È la misura che
-- risponde a «il worker sta girando?» con un numero invece che con
-- un'impressione: se cresce, qualcosa è fermo.
--
-- ⚠️ `security definer` PER FORZA, e la ragione va scritta: `automation_events`
-- non ha alcun GRANT per `authenticated`, quindi una funzione `security
-- invoker` fallirebbe con «permission denied» per chiunque la chiamasse. La
-- difesa è la prima riga del WHERE — solo un amministratore dell'azienda
-- richiesta ottiene dei numeri — ed è l'unica difesa che c'è, esattamente come
-- in `company_member_directory` (0016). Escono CONTEGGI, mai una riga.
--
-- ⚠️ E RIFIUTA, NON RISPONDE ZERO. Un'aggregazione senza `group by` restituisce
-- SEMPRE una riga: con un semplice `and is_company_admin(...)` nel WHERE, chi
-- non è amministratore otterrebbe «nessun arretrato» invece di «non ti è
-- permesso» — cioè una risposta rassicurante a una domanda che non aveva il
-- diritto di fare. È la forma di fallback silenzioso che questo progetto
-- considera il difetto peggiore, e qui costa tre righe evitarla.
create or replace function public.automation_backlog(p_company_id uuid)
returns table (pending integer, dead_letter integer, oldest_pending_seconds integer)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not public.is_company_admin(p_company_id) then
    raise exception 'automation_backlog_forbidden'
      using errcode = '42501',
            hint = 'Lo stato del motore lo legge chi amministra l''azienda.';
  end if;

  return query
  select
    count(*) filter (where e.processing_status in ('pending', 'processing'))::integer,
    count(*) filter (where e.processing_status = 'dead_letter')::integer,
    coalesce(extract(epoch from (now() - min(e.occurred_at)
      filter (where e.processing_status in ('pending', 'processing'))))::integer, 0)
  from public.automation_events e
  where e.company_id = p_company_id;
end $$;

revoke all on function public.automation_backlog(uuid) from public, anon;
grant execute on function public.automation_backlog(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 14. Il guardiano delle regole
--
-- Quattro cose che il database non lascia decidere a chi scrive:
--   · l'AUTORE e chi MODIFICA devono essere membri dell'azienda della regola;
--   · la VERSIONE cresce quando cambia la configurazione, e non quando cambia
--     il nome: una run che dichiara «versione 3» deve riferirsi a una
--     configurazione diversa dalla 2, altrimenti il numero non significa nulla;
--   · `activated_at` lo scrive il database, e una regola non si può attivare
--     senza almeno un'azione — una regola che non fa niente, attiva, è solo un
--     modo di credere che qualcosa stia succedendo;
--   · il TETTO di regole attive per azienda (§166/§73).
--
-- La validazione SEMANTICA — questo campo esiste? questa azione esiste? questo
-- segnaposto è valido? — non è qui: sta nel registro tipizzato, che è l'unico
-- posto in cui quei nomi esistono. Duplicarla in SQL avrebbe creato due elenchi
-- destinati a divergere, ed è la stessa ragione per cui la scrittura passa da
-- una Edge Function e non dal browser.
-- ---------------------------------------------------------------------------
create or replace function public.workflows_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_active integer;
  v_max    integer := (public.automation_limits() ->> 'maxActiveWorkflows')::integer;
  v_changed boolean;
begin
  new.name := btrim(new.name);

  -- (a) Appartenenza. Vale anche per il service role: la Edge Function scrive
  --     `created_by` con l'utente che ha premuto il pulsante, e se quella
  --     persona non è dell'azienda la riga non entra.
  if new.created_by is not null and not exists (
    select 1 from public.company_members m
    where m.company_id = new.company_id and m.user_id = new.created_by
  ) then
    raise exception 'workflow_author_not_member'
      using errcode = '23514', hint = 'L''autore non appartiene a questa azienda.';
  end if;
  if new.updated_by is not null and not exists (
    select 1 from public.company_members m
    where m.company_id = new.company_id and m.user_id = new.updated_by
  ) then
    raise exception 'workflow_editor_not_member'
      using errcode = '23514', hint = 'Chi modifica non appartiene a questa azienda.';
  end if;

  -- (b) Versione: cresce solo quando cambia ciò che il motore esegue.
  if tg_op = 'UPDATE' then
    v_changed :=
      new.trigger_type    is distinct from old.trigger_type
      or new.condition_match is distinct from old.condition_match
      or new.conditions   is distinct from old.conditions
      or new.actions      is distinct from old.actions;
    if v_changed then
      new.version := old.version + 1;
    else
      new.version := old.version;
    end if;
  end if;

  -- (c) Attivazione.
  if new.status = 'active' then
    if jsonb_array_length(new.actions) < 1 then
      raise exception 'workflow_no_actions'
        using errcode = '23514', hint = 'Una regola attiva deve avere almeno un''azione.';
    end if;
    if tg_op = 'INSERT' or old.status is distinct from 'active' then
      new.activated_at := now();
      select count(*) into v_active
        from public.workflow_definitions w
       where w.company_id = new.company_id and w.status = 'active' and w.id <> new.id;
      if v_active >= v_max then
        raise exception 'workflow_too_many_active'
          using errcode = '23514',
                hint = 'È stato raggiunto il numero massimo di automazioni attive.';
      end if;
    end if;
    -- Una regola che torna attiva riparte pulita: i fallimenti contati
    -- riguardavano una configurazione che chi ha riattivato ha già rivisto.
    if tg_op = 'UPDATE' and old.status is distinct from 'active' then
      new.consecutive_failures := 0;
      new.attention_code := null;
      new.attention_at := null;
    end if;
  end if;

  -- (d) Il codice di attenzione porta sempre la propria data: un avviso senza
  --     quando è un avviso di cui non si sa se è di oggi o di marzo.
  if new.attention_code is null then
    new.attention_at := null;
  elsif tg_op = 'INSERT' or old.attention_code is distinct from new.attention_code then
    new.attention_at := now();
  else
    new.attention_at := coalesce(old.attention_at, now());
  end if;

  -- (e) Archiviazione: il timbro lo mette il database.
  if new.status = 'archived' then
    if tg_op = 'INSERT' or old.status is distinct from 'archived' then
      new.archived_at := now();
      new.archived_by := coalesce(v_actor, new.updated_by);
    else
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
    end if;
  else
    new.archived_at := null;
    new.archived_by := null;
  end if;

  return new;
end $$;

drop trigger if exists trg_workflows_guard on public.workflow_definitions;
create trigger trg_workflows_guard
  before insert or update on public.workflow_definitions
  for each row execute function public.workflows_guard();

drop trigger if exists trg_workflows_updated on public.workflow_definitions;
create trigger trg_workflows_updated
  before update on public.workflow_definitions
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 15. Lo storico delle regole, scritto dai trigger
-- ---------------------------------------------------------------------------
create or replace function public.workflows_record_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- L'attore è chi ha premuto il pulsante. Con il service role `auth.uid()` è
  -- nullo, e allora vale `updated_by`, che la Edge Function ha già verificato
  -- essere l'utente autenticato: è l'unico modo per non attribuire al «sistema»
  -- ciò che ha deciso una persona.
  --
  -- ⚠️ NESSUN RIPIEGO SU `created_by`, e la ragione è una riga di storico che
  -- avrebbe detto il falso. Quando il motore mette in pausa una regola da sé
  -- dopo errori ripetuti (§104), scrive `updated_by = null` proprio perché non
  -- l'ha decisa nessuno: con il ripiego su `created_by` lo storico avrebbe
  -- attribuito la pausa a chi la regola l'aveva SCRITTA, magari mesi prima.
  -- Un registro che attribuisce a una persona una decisione del sistema è la
  -- stessa classe di difetto del «Non assegnata ha creato l'attività» trovato
  -- nel Work Hub: non rompe niente, dice una cosa che non è vera.
  v_actor uuid := coalesce(auth.uid(), new.updated_by);
begin
  if tg_op = 'INSERT' then
    insert into public.workflow_events (company_id, workflow_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, coalesce(auth.uid(), new.created_by), 'created',
            jsonb_build_object('trigger', new.trigger_type, 'status', new.status));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.workflow_events (company_id, workflow_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor,
            case
              when new.status = 'active'   then 'activated'::public.workflow_audit_kind
              when new.status = 'paused'   then 'paused'::public.workflow_audit_kind
              when new.status = 'archived' then 'archived'::public.workflow_audit_kind
              when old.status = 'archived' then 'restored'::public.workflow_audit_kind
              else 'updated'::public.workflow_audit_kind
            end,
            jsonb_build_object('from', old.status, 'to', new.status,
                               'reason', new.attention_code));
  elsif new.version is distinct from old.version then
    insert into public.workflow_events (company_id, workflow_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor, 'updated',
            jsonb_build_object('version', new.version));
  end if;

  return new;
end $$;

drop trigger if exists trg_workflows_events on public.workflow_definitions;
create trigger trg_workflows_events
  after insert or update on public.workflow_definitions
  for each row execute function public.workflows_record_events();

-- ---------------------------------------------------------------------------
-- 16. Il guardiano delle esecuzioni
--
-- Le scrive solo il worker con il service role, ma la disciplina di questo
-- progetto è che una tabella si difenda comunque da sola: azienda della run =
-- azienda della regola, azienda dell'azione = azienda della run. Senza,
-- un'esecuzione potrebbe dichiarare l'azienda sbagliata e comparire nello
-- storico di chi non c'entra.
-- ---------------------------------------------------------------------------
create or replace function public.workflow_runs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select w.company_id into v_company
    from public.workflow_definitions w where w.id = new.workflow_id;
  if v_company is null or v_company is distinct from new.company_id then
    raise exception 'workflow_run_company_mismatch'
      using errcode = '23514', hint = 'L''esecuzione non appartiene all''azienda della regola.';
  end if;

  if new.trigger_event_id is not null and not exists (
    select 1 from public.automation_events e
    where e.id = new.trigger_event_id and e.company_id = new.company_id
  ) then
    raise exception 'workflow_run_event_mismatch'
      using errcode = '23514', hint = 'L''evento non appartiene a questa azienda.';
  end if;

  if new.completed_at is not null and new.started_at is not null then
    new.duration_ms := greatest(0, (extract(epoch from (new.completed_at - new.started_at)) * 1000)::integer);
  end if;

  return new;
end $$;

drop trigger if exists trg_workflow_runs_guard on public.workflow_runs;
create trigger trg_workflow_runs_guard
  before insert or update on public.workflow_runs
  for each row execute function public.workflow_runs_guard();

create or replace function public.workflow_action_runs_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select r.company_id into v_company
    from public.workflow_runs r where r.id = new.workflow_run_id;
  if v_company is null or v_company is distinct from new.company_id then
    raise exception 'workflow_action_company_mismatch'
      using errcode = '23514', hint = 'L''azione non appartiene all''azienda dell''esecuzione.';
  end if;
  return new;
end $$;

drop trigger if exists trg_workflow_action_runs_guard on public.workflow_action_runs;
create trigger trg_workflow_action_runs_guard
  before insert or update on public.workflow_action_runs
  for each row execute function public.workflow_action_runs_guard();

-- ---------------------------------------------------------------------------
-- 17. Le regole che ascoltano un evento
--
-- ⚠️ QUI VIVONO DUE GARANZIE, E NESSUNA DELLE DUE È NEL WORKER.
--
--   §163 — `w.activated_at <= p_occurred_at`: una regola attivata alle 15
--   non reagisce a un documento analizzato alle 14. Attivare non fa ripartire
--   il passato, e la garanzia non è un `if` che qualcuno può dimenticare.
--
--   §69/§72 — una regola gira AL PIÙ UNA VOLTA per catena causale. È la riga
--   `not exists (… same correlation_id …)`, e da sola chiude tre casi:
--   il ciclo di una regola su sé stessa («quando nasce un'attività, crea
--   un'attività»), il ciclo A→B→A, e la ripetizione di una regola già eseguita
--   più in alto nella stessa storia. Le catene UTILI restano possibili: A che
--   causa B che causa C funziona, perché sono regole diverse.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- 18. Le metriche di una regola (§102)
--
-- Numeri veri, non metriche di vanità: quante volte ha agito, quante azioni
-- sono andate a buon fine, quanti errori. Nessun conteggio delle volte in cui
-- non è scattata, perché quelle non sono righe (§101).
-- ---------------------------------------------------------------------------
create or replace function public.workflow_metrics(p_workflow_id uuid, p_days integer default 30)
returns table (runs integer, actions_done integer, actions_failed integer, errors integer)
language sql
stable
set search_path = ''
as $$
  with r as (
    select run.id, run.status
    from public.workflow_runs run
    join public.workflow_definitions w on w.id = run.workflow_id
    where run.workflow_id = p_workflow_id
      and (select public.is_company_member(w.company_id))
      and run.started_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 30), 365)))
  )
  select
    (select count(*) from r)::integer,
    (select count(*) from public.workflow_action_runs a
      where a.workflow_run_id in (select id from r) and a.status = 'succeeded')::integer,
    (select count(*) from public.workflow_action_runs a
      where a.workflow_run_id in (select id from r) and a.status = 'failed')::integer,
    (select count(*) from r where r.status in ('failed', 'partial'))::integer;
$$;

revoke all on function public.workflow_metrics(uuid, integer) from public, anon;
grant execute on function public.workflow_metrics(uuid, integer) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 19. RLS e permessi
--
-- La forma è quella di tutto il progetto: `revoke all` PRIMA dei grant, perché
-- su Supabase una tabella nuova nasce con i permessi di tabella completi per
-- `anon` e `authenticated` e un grant scritto dopo AGGIUNGE privilegi invece di
-- toglierne (lezione della 0014).
--
-- CHI LEGGE COSA
--   · `workflow_definitions`, `workflow_runs`, `workflow_action_runs`: ogni
--     MEMBRO. Non c'è niente di riservato — una regola dice cosa fa l'azienda,
--     e chi riceve un'attività creata da una regola ha diritto di sapere quale.
--   · `workflow_events` (chi ha attivato, chi ha messo in pausa): solo
--     AMMINISTRATORI, come `email_audit_log`. È informazione di governo.
--   · `automation_events`: NESSUNO oltre al service role. È la coda del motore,
--     non un dato di prodotto, e contiene la struttura della catena causale.
--
-- CHI SCRIVE: nessuno dal client, mai, su nessuna di queste tabelle.
-- ---------------------------------------------------------------------------
alter table public.automation_events     enable row level security;
alter table public.workflow_definitions  enable row level security;
alter table public.workflow_runs         enable row level security;
alter table public.workflow_action_runs  enable row level security;
alter table public.workflow_events       enable row level security;

revoke all on public.automation_events     from anon, authenticated, public;
revoke all on public.workflow_definitions  from anon, authenticated, public;
revoke all on public.workflow_runs         from anon, authenticated, public;
revoke all on public.workflow_action_runs  from anon, authenticated, public;
revoke all on public.workflow_events       from anon, authenticated, public;

grant select on public.workflow_definitions to authenticated;
grant select on public.workflow_runs        to authenticated;
grant select on public.workflow_action_runs to authenticated;
grant select on public.workflow_events      to authenticated;
-- `automation_events` NON compare: nessun grant, quindi nessuna policy potrebbe
-- comunque aprirla. È voluto — un permesso assente è più difficile da allentare
-- per sbaglio di una policy restrittiva (0013).

drop policy if exists workflows_select_member on public.workflow_definitions;
create policy workflows_select_member on public.workflow_definitions
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists workflow_runs_select_member on public.workflow_runs;
create policy workflow_runs_select_member on public.workflow_runs
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists workflow_action_runs_select_member on public.workflow_action_runs;
create policy workflow_action_runs_select_member on public.workflow_action_runs
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists workflow_events_select_admin on public.workflow_events;
create policy workflow_events_select_admin on public.workflow_events
  for select to authenticated using (public.is_company_admin(company_id));

-- ---------------------------------------------------------------------------
-- 20. Autoverifica: la migrazione controlla di aver ottenuto ciò che dichiara
--
-- Le due volte in cui questo progetto ha creduto a una garanzia senza provarla
-- — i permessi di colonna della 0013, `full-setup.sql` «rieseguibile» — la
-- garanzia non c'era. Qui la migrazione fallisce all'applicazione invece di
-- lasciar passare la falla.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  -- (a) Nessuna scrittura dal client su nessuna tabella dell'automazione.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('automation_events', 'workflow_definitions', 'workflow_runs',
                       'workflow_action_runs', 'workflow_events')
    and grantee in ('anon', 'authenticated', 'public')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE');
  if v_bad is not null then
    raise exception 'le automazioni risultano scrivibili dal client: %', v_bad;
  end if;

  -- (b) La coda non è nemmeno leggibile: contiene la struttura delle catene
  --     causali e non serve a nessuna schermata.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'automation_events'
    and grantee in ('anon', 'authenticated', 'public');
  if v_bad is not null then
    raise exception 'la coda degli eventi risulta accessibile dal client: %', v_bad;
  end if;

  -- (c) Le funzioni del solo server non sono eseguibili da un utente collegato.
  if exists (
    select 1
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and routine_name in ('automation_events_claim', 'automation_emit',
                           'automation_emit_overdue', 'workflows_for_event')
      and grantee in ('anon', 'authenticated', 'public')
  ) then
    raise exception 'una funzione del motore risulta eseguibile dal client';
  end if;
end $$;
