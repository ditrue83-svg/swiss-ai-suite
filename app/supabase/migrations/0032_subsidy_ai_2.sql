-- ============================================================================
-- AI-Swisse — 0032 SUBSIDY AI 2.0 · «Incentivi»
--
-- Il modulo passa da «ecco alcuni programmi che potrebbero interessarti» a
-- «questa opportunità è pertinente a QUESTO progetto, questi criteri sembrano
-- soddisfatti, questi mancano, questa call è aperta, questa è la fonte e la
-- data in cui l'abbiamo verificata».
--
-- IL PRINCIPIO CHE GOVERNA TUTTO IL FILE:
--   RILEVANZA ≠ IDONEITÀ ≠ PRONTEZZA ≠ APPROVAZIONE.
-- Sono quattro misure diverse, con quattro colonne diverse, e nessuna delle
-- quattro è una probabilità di ottenere il contributo. La decisione resta
-- all'autorità: in questo file non esiste alcuno stato che la anticipi.
--
-- LE CINQUE ENTITÀ, che il modulo 1.0 confondeva in due:
--   programma   — lo strumento di sostegno, stabile per anni
--   versione    — il testo dei requisiti in un certo momento, IMMUTABILE
--   call        — la finestra concreta in cui ci si candida
--   progetto    — l'iniziativa dell'impresa
--   opportunità — l'incontro fra un progetto e una versione (più una call)
--   pratica     — il lavoro di preparazione della candidatura
--
-- ⚠️ CHE COSA NON FA QUESTO MODULO, e non per difetto:
--   non invia domande, non accede a portali, non compila formulari, non firma,
--   non carica allegati, non dichiara nulla a un'autorità, non stima
--   probabilità di approvazione, non converte valute, non promette importi.
--   Nessuna di queste azioni esiste come colonna, funzione o permesso: non
--   sono spente, non ci sono.
--
-- ⚠️ SEZIONE 1 — I VALORI AGGIUNTI AGLI ENUM ESISTENTI.
-- `alter type … add value` non rende l'etichetta usabile nella stessa
-- transazione (55P04), e `full-setup.sql` concatena tutte le migrazioni in una
-- transazione sola. Quindi i valori aggiunti alla sezione 1 compaiono in questo
-- file SOLTANTO dentro il corpo di una `create function` — che Postgres
-- deposita come testo e risolve alla prima esecuzione — e MAI dentro un
-- `do $$ … $$`, che invece viene eseguito. È il quinto giro di questa trappola
-- (0015, 0021, 0022, 0030) e `scripts/bundle-migrations.mjs` la sorveglia.
--
-- ⚠️ SU SUPABASE UN GRANT DI COLONNA NON RESTRINGE NIENTE senza un `revoke all`
-- che lo preceda: `alter default privileges … grant all on tables to
-- authenticated` è già impostato a livello di schema. La sezione 22 revoca
-- prima e concede poi, e la sezione 23 lo VERIFICA interrogando
-- `information_schema` — se un permesso inatteso esiste, questa migrazione
-- fallisce invece di applicarsi a metà. È la lezione della 0014.
--
-- ⚠️ I TRIGGER DI QUESTO FILE DEVONO SOPRAVVIVERE ALLA CASCATA. Un trigger che
-- SOLLEVA (0023) o che INSERISCE (0025, 0028) durante la cancellazione di
-- un'azienda rende quell'azienda indistruttibile. Ogni trigger di storico qui
-- verifica che i genitori esistano ancora prima di scrivere.
--
-- ⚠️ QUANDO SI SCEGLIE UN'ETICHETTA ENUM CON UN `CASE`, IL CAST VA SU OGNI RAMO
-- (42804, 0022 e 0025). In questo file le etichette si scelgono in una
-- VARIABILE TIPIZZATA, che è la forma che non può sbagliare.
--
-- Idempotente per costruzione: si può riapplicare senza danni.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. VALORI AGGIUNTI AGLI ENUM ESISTENTI
--
-- ⚠️ Nessuna delle etichette qui sotto compare altrove in questo file se non
--    dentro il corpo di una funzione. Vedi l'avvertenza in testa.
-- ---------------------------------------------------------------------------

-- Gli stati della pratica. Il modulo 1.0 ne aveva cinque e descrivevano solo la
-- preparazione: mancava tutto ciò che accade DOPO l'invio, che è esattamente il
-- momento in cui una PMI ha bisogno di sapere a che punto è.
-- ⚠️ `approved` e `rejected` NON sono dedotti da niente: li registra una
--    persona, o li documenta una decisione ufficiale caricata in Documenti. Il
--    prodotto non ha alcun canale verso l'autorità e non può sapere l'esito.
alter type public.subsidy_case_status add value if not exists 'assessing';
alter type public.subsidy_case_status add value if not exists 'under_review';
alter type public.subsidy_case_status add value if not exists 'approved';
alter type public.subsidy_case_status add value if not exists 'rejected';
alter type public.subsidy_case_status add value if not exists 'withdrawn';

-- Gli inneschi delle automazioni. Sette, e ognuno ha una sorgente vera in
-- questo file o nel worker: l'errore da non ripetere è quello che
-- `docs/workflow-automation.md` racconta di sé, inneschi dichiarati e senza
-- produttore.
-- ⚠️ NESSUN INNESCO SU «programma sembrato rilevante»: la rilevanza la calcola
--    il motore a ogni rivalutazione e cambierebbe a ogni giro. Scatta su
--    `subsidy_opportunity_high_relevance`, che è un SUPERAMENTO DI SOGLIA
--    deduplicato per opportunità, non su un punteggio che oscilla.
alter type public.automation_event_type add value if not exists 'subsidy_opportunity_created';
alter type public.automation_event_type add value if not exists 'subsidy_opportunity_high_relevance';
alter type public.automation_event_type add value if not exists 'subsidy_call_opened';
alter type public.automation_event_type add value if not exists 'subsidy_deadline_approaching';
alter type public.automation_event_type add value if not exists 'subsidy_assessment_became_stale';
alter type public.automation_event_type add value if not exists 'subsidy_case_status_changed';
alter type public.automation_event_type add value if not exists 'subsidy_source_critical_change';

-- I tipi di notifica. Quattro e non dodici: si notifica ciò che cambia il
-- lavoro di una persona, non ogni rivalutazione (§81).
alter type public.notification_type add value if not exists 'subsidy_new_opportunity';
alter type public.notification_type add value if not exists 'subsidy_call_opened';
alter type public.notification_type add value if not exists 'subsidy_deadline_approaching';
alter type public.notification_type add value if not exists 'subsidy_program_changed';


-- ---------------------------------------------------------------------------
-- 2. I VINCOLI DI ENTITÀ, PRIMA DEI PRODUTTORI
--
-- ⚠️ L'ORDINE NON È INDIFFERENTE, ed è la lezione della 0026: se un trigger
--    emette un evento con un `entity_type` che il CHECK non ammette ancora, la
--    scrittura fallisce. Prima il vincolo, poi chi lo usa.
--
-- Due entità nuove, e la distinzione è di merito. Un'opportunità è
-- l'abbinamento fra un progetto e una versione di programma: vive e muore con
-- la rivalutazione. Una pratica è il lavoro di candidatura: sopravvive al
-- cambiamento del catalogo, perché conserva l'istantanea con cui è nata.
-- Agganciare gli eventi della pratica all'opportunità renderebbe impossibile
-- ritrovarli quando l'opportunità viene ricalcolata.
-- ---------------------------------------------------------------------------

alter table public.automation_events drop constraint if exists automation_events_entity_type_check;
alter table public.automation_events
  add constraint automation_events_entity_type_check
  check (entity_type in ('document', 'email_message', 'task', 'contract',
                         'crm_organization', 'crm_opportunity',
                         'subsidy_opportunity', 'subsidy_case'));

alter table public.workflow_runs drop constraint if exists workflow_runs_entity_type_check;
alter table public.workflow_runs
  add constraint workflow_runs_entity_type_check
  check (entity_type in ('document', 'email_message', 'task', 'contract',
                         'crm_organization', 'crm_opportunity',
                         'subsidy_opportunity', 'subsidy_case'));

alter table public.notifications drop constraint if exists notifications_entity_type_check;
alter table public.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('task', 'calendar_connection', 'document', 'email_message',
                         'contract', 'crm_organization', 'crm_opportunity',
                         'subsidy_opportunity', 'subsidy_case'));


-- ---------------------------------------------------------------------------
-- 3. GLI ENUM NUOVI
--
-- Creati con `create type`, quindi i loro valori sono utilizzabili SUBITO,
-- anche nella stessa transazione: la trappola 55P04 riguarda solo le etichette
-- AGGIUNTE a un tipo che esisteva già. È la distinzione che
-- `scripts/bundle-migrations.mjs` conosce dalla 0021.
-- ---------------------------------------------------------------------------

-- ---- Il catalogo ----------------------------------------------------------

-- ⚠️ Tutti i tipi ammessi sono UFFICIALI. Non esiste `blog`, non esiste
--    `aggregator`, non esiste `newsletter`: una fonte non ufficiale non entra
--    nel catalogo, e il modo per garantirlo è che non ci sia l'etichetta.
do $$ begin create type public.subsidy_source_type as enum (
  'official_program_page',
  'official_call_page',
  'official_database',
  'official_law',
  'official_regulation',
  'official_guideline',
  'official_pdf',
  -- La fonte esiste, è ufficiale, ma non è interrogabile in modo affidabile:
  -- niente API, niente feed, struttura instabile. Si controlla A MANO, e
  -- dichiararlo è meglio di uno scraper fragile che finge automazione (§15).
  'manual_official_source'
);
exception when duplicate_object then null; end $$;

-- Quanto pesa che questa fonte sia sbagliata o vecchia. Governa la frequenza
-- del controllo e il livello di rischio della revisione.
do $$ begin create type public.subsidy_source_criticality as enum ('low', 'normal', 'high', 'critical');
exception when duplicate_object then null; end $$;

-- L'esito di un controllo. ⚠️ `unchanged` e `changed` sono ESITI RIUSCITI: la
-- fonte ha risposto. `error` e `blocked` no — e `blocked` esiste separato
-- perché «la guardia ha rifiutato l'indirizzo» non è «il sito non risponde»:
-- il primo è un problema di configurazione nostro, il secondo dell'autorità.
do $$ begin create type public.subsidy_fetch_status as enum (
  'unchanged', 'changed', 'error', 'blocked', 'skipped'
);
exception when duplicate_object then null; end $$;

-- Lo stato di una versione di programma.
-- ⚠️ `published` è IMMUTABILE (sezione 12): non si corregge una versione
--    pubblicata, se ne pubblica un'altra. È ciò che rende ricostruibile una
--    pratica aperta mesi fa.
do $$ begin create type public.subsidy_version_status as enum (
  'draft', 'published', 'superseded', 'withdrawn'
);
exception when duplicate_object then null; end $$;

-- Lo stato di una call. ⚠️ `unknown` NON è un ripiego: significa che la fonte
-- non dice se sia aperta, e presentarla come aperta o come chiusa sarebbe in
-- entrambi i casi un'invenzione. `continuous` è una finestra permanente, che è
-- una cosa diversa da «aperta fino a una data».
do $$ begin create type public.subsidy_call_status as enum (
  'upcoming', 'open', 'closed', 'continuous', 'suspended', 'unknown'
);
exception when duplicate_object then null; end $$;

-- Quanto pesa un criterio.
-- ⚠️ `soft` NON può produrre un'esclusione (§49): un criterio non bloccante non
--    soddisfatto abbassa la completezza, non l'idoneità.
-- ⚠️ `informative` è un LIMITE dichiarato che nessuno può valutare
--    automaticamente: compare, si legge, non entra nel calcolo (§50).
do $$ begin create type public.subsidy_rule_hardness as enum (
  'hard', 'soft', 'exclusion', 'informative'
);
exception when duplicate_object then null; end $$;

-- Come si stabilisce se un criterio è soddisfatto.
--   auto     — dai fatti che il prodotto già conosce (profilo, progetto, Zefix)
--   question — serve una risposta della persona
--   manual   — nessuno dei due basta: va verificato sulla fonte o con l'ente
do $$ begin create type public.subsidy_rule_evaluability as enum ('auto', 'question', 'manual');
exception when duplicate_object then null; end $$;

-- Gli operatori ammessi. ⚠️ È un insieme CHIUSO, ed è il cuore della sicurezza
-- del motore: una regola può nominare solo uno di questi, e ognuno è una
-- funzione TypeScript in `_shared/subsidy/rules.ts`. Non esiste alcun percorso
-- in cui una stringa del catalogo diventi un'espressione da valutare — niente
-- `eval`, niente SQL costruito a stringhe, niente template arbitrari (§52).
do $$ begin create type public.subsidy_rule_operator as enum (
  'equals', 'not_equals', 'contains', 'in',
  'greater_than', 'greater_or_equal', 'less_than', 'less_or_equal',
  'exists', 'not_exists', 'before', 'after'
);
exception when duplicate_object then null; end $$;

-- Che cosa è cambiato in una fonte. Il tipo governa il RISCHIO, e il rischio
-- governa se la modifica può entrare da sola (§22, §23).
do $$ begin create type public.subsidy_review_change_type as enum (
  'new_program', 'program_metadata', 'program_requirements', 'program_exclusions',
  'contribution', 'deadline', 'call_status', 'new_call', 'availability',
  'source_unreachable', 'source_structure_changed', 'other'
);
exception when duplicate_object then null; end $$;

do $$ begin create type public.subsidy_review_risk as enum ('low', 'medium', 'high', 'critical');
exception when duplicate_object then null; end $$;

do $$ begin create type public.subsidy_review_status as enum ('pending', 'accepted', 'rejected', 'ignored');
exception when duplicate_object then null; end $$;

-- ---- I dati dell'impresa --------------------------------------------------

-- Lo stadio del progetto. ⚠️ È il campo più importante di tutto il modulo dopo
-- la geografia: moltissimi programmi richiedono che la domanda preceda
-- l'avvio, e un progetto già iniziato non li perde per un dettaglio — li perde
-- del tutto. Per questo `started` non nasconde il programma: lo segnala (§71).
do $$ begin create type public.subsidy_project_stage as enum (
  'idea', 'planned', 'started', 'completed', 'cancelled'
);
exception when duplicate_object then null; end $$;

-- Da dove viene un fatto usato nella valutazione (§38). Nessun fatto entra nel
-- motore senza questa etichetta: un criterio che dice «soddisfatto» deve poter
-- dire anche «perché, e chi lo ha detto».
-- ⚠️ Non esistono `derived_from_finance_revenue` né `derived_from_crm_headcount`
--    e non è una dimenticanza: §39 vieta quelle deduzioni, e il modo per
--    vietarle davvero è non avere l'etichetta con cui scriverle.
do $$ begin create type public.subsidy_fact_source as enum (
  'company_profile',   -- i dati che l'impresa ha inserito
  'company_registry',  -- Zefix / registro IDI: anagrafica verificabile
  'project',           -- i campi strutturati del progetto
  'user_answer',       -- una risposta esplicita a un criterio
  'document',          -- un documento collegato, con riferimento
  'interpretation',    -- l'AI che ha letto la descrizione, con citazione
  'unknown'
);
exception when duplicate_object then null; end $$;

-- ---- Il risultato della valutazione ---------------------------------------

-- ⚠️ NON ESISTE `eligible`, ed è la decisione più importante del file (§47).
--    Il valore più alto è `potentially_eligible`: «i criteri che possiamo
--    valutare sembrano soddisfatti». Dichiarare un'impresa idonea sarebbe
--    sostituirsi all'autorità, e nessuna colonna di questo schema può farlo
--    perché l'etichetta non c'è.
do $$ begin create type public.subsidy_eligibility_status as enum (
  'not_assessed',
  'insufficient_information',
  'potentially_eligible',
  'likely_ineligible',
  'ineligible'
);
exception when duplicate_object then null; end $$;

-- La rilevanza è una FASCIA, non una percentuale (§45). Il punteggio numerico
-- esiste per ordinare l'elenco e resta interno: «82/100» letto da un
-- imprenditore diventa «82% di possibilità», che è falso.
do $$ begin create type public.subsidy_relevance_level as enum ('high', 'medium', 'low');
exception when duplicate_object then null; end $$;

-- Lo stato di un singolo criterio (§92).
-- ⚠️ `conflicting` esiste perché due fonti dello stesso fatto possono
--    contraddirsi — una risposta della persona contro un dato del profilo — e
--    scegliere in silenzio quale vince sarebbe la peggiore delle due opzioni.
do $$ begin create type public.subsidy_criterion_state as enum (
  'satisfied', 'not_satisfied', 'unknown', 'conflicting', 'not_evaluable'
);
exception when duplicate_object then null; end $$;

-- Quanto sono aggiornate le fonti su cui poggia una valutazione (§43).
-- ⚠️ `unverified` non è «vecchio»: è «non l'abbiamo mai controllato», e le due
--    cose portano a due frasi diverse in interfaccia.
do $$ begin create type public.subsidy_freshness as enum ('fresh', 'aging', 'stale', 'unverified');
exception when duplicate_object then null; end $$;

-- Quanti dati mancano per poter valutare (§43). Distinta dall'idoneità: un
-- profilo incompleto non rende un'impresa non idonea, rende la risposta
-- incompleta.
do $$ begin create type public.subsidy_completeness as enum ('complete', 'minor_gaps', 'major_gaps');
exception when duplicate_object then null; end $$;

-- La tempistica: dipende dalla CALL, non dal programma.
do $$ begin create type public.subsidy_timing as enum (
  'open', 'upcoming', 'closed', 'continuous', 'unknown'
);
exception when duplicate_object then null; end $$;

-- Quanto lavoro manca per candidarsi (§43). È la misura che il modulo 1.0 non
-- aveva affatto, e che risponde alla domanda vera: «che cosa devo fare adesso».
do $$ begin create type public.subsidy_readiness as enum (
  'not_started', 'in_preparation', 'ready', 'submitted'
);
exception when duplicate_object then null; end $$;

-- Perché un'opportunità è stata messa da parte (§101). Il record NON si
-- cancella: se domani la call cambia, si può proporre di riguardarla, e senza
-- il motivo non si saprebbe se ha senso farlo.
do $$ begin create type public.subsidy_dismissal_reason as enum (
  'not_relevant', 'already_applied', 'not_now', 'project_cancelled', 'other'
);
exception when duplicate_object then null; end $$;

-- Un'opportunità legata a un progetto è una cosa; un programma che sembra
-- pertinente al solo profilo aziendale è un'altra, e va detto (§62).
do $$ begin create type public.subsidy_opportunity_kind as enum ('project', 'general');
exception when duplicate_object then null; end $$;

-- ---- La pratica -----------------------------------------------------------

-- ⚠️ `unknown` è il default e resta tale finché una persona non registra
--    l'esito. Non esiste alcun percorso automatico che scriva `approved`.
do $$ begin create type public.subsidy_case_outcome as enum (
  'approved', 'rejected', 'withdrawn', 'unknown'
);
exception when duplicate_object then null; end $$;

-- A che cosa serve un documento dentro una pratica (§112).
do $$ begin create type public.subsidy_document_relation as enum (
  'application_form', 'business_plan', 'budget', 'financial_statement',
  'quotation', 'partner_letter', 'proof', 'decision', 'correspondence', 'other'
);
exception when duplicate_object then null; end $$;

-- Lo storico della pratica (§122). Lo scrivono i trigger.
do $$ begin create type public.subsidy_case_event_kind as enum (
  'case_created', 'owner_changed', 'status_changed', 'assessment_updated',
  'document_linked', 'document_unlinked', 'checklist_completed',
  'checklist_reopened', 'submitted', 'outcome_recorded',
  'source_changed', 'archived'
);
exception when duplicate_object then null; end $$;

-- Che cosa può contenere un item di checklist (§114).
do $$ begin create type public.subsidy_checklist_kind as enum (
  'document', 'verification', 'contact', 'preparation', 'submission', 'other'
);
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- 4. subsidy_sources — IL REGISTRO DELLE FONTI UFFICIALI
--
-- §10. Il valore del modulo dipende interamente dalla qualità del catalogo, e
-- un catalogo aggiornato a mano da un seed SQL invecchia in silenzio. Qui
-- ciascun programma dichiara DA DOVE viene, e quel «dove» è un record che si
-- controlla, che fallisce in modo visibile e che ha una data.
--
-- ⚠️ `allowed_host` NON È UNA COMODITÀ: è il perimetro. La guardia lato server
--    confronta l'host effettivo della richiesta — dopo ogni redirect — con
--    questo valore, e rifiuta tutto il resto. Non esiste un percorso in cui un
--    utente inserisca un URL che il backend scarica (§13): non c'è alcun
--    permesso di scrittura su questa tabella per il client, e la sezione 23 lo
--    verifica.
--
-- ⚠️ `adapter_key` è la chiave di un adapter DICHIARATO in TypeScript. Una
--    chiave sconosciuta non produce un ripiego generico: la fonte viene
--    saltata con un errore esplicito. Un parser «universale» su un sito
--    cantonale è il modo più rapido per riempire il catalogo di dati falsi.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_sources (
  id                       uuid primary key default gen_random_uuid(),
  -- L'autorità che PUBBLICA, non chi eroga: sono spesso diverse, e la fonte
  -- appartiene a chi la scrive.
  authority                text not null,
  source_type              public.subsidy_source_type not null,
  canonical_url            text not null,
  -- L'host ammesso, in minuscolo e senza porta. La guardia lo confronta con
  -- l'host di OGNI richiesta della catena di redirect.
  allowed_host             text not null,
  -- Lingua della fonte. Può non essere quella dell'interfaccia: §139 dice di
  -- mostrare l'evidenza originale e spiegare nella lingua dell'utente.
  locale                   text not null default 'it' check (locale in ('it', 'de', 'fr', 'en')),
  -- 'CH' per la Confederazione, il codice cantonale per i cantoni ('TI', 'ZH'…).
  jurisdiction             text not null,
  adapter_key              text not null,
  -- Ogni quanti giorni si ricontrolla. §24: NON una soglia unica per tutto —
  -- una deadline si guarda spesso, una base legale no.
  check_frequency_days     integer not null default 30 check (check_frequency_days between 1 and 3650),
  criticality              public.subsidy_source_criticality not null default 'normal',
  enabled                  boolean not null default true,
  -- ⚠️ Quando si è controllata con SUCCESSO. Un tentativo fallito NON la
  --    aggiorna (§159): dedurre freschezza da un errore sarebbe la peggiore
  --    delle bugie, perché renderebbe «verificato oggi» un dato mai letto.
  last_successful_check_at timestamptz,
  last_error_at            timestamptz,
  last_error_code          text,
  -- Quando tocca di nuovo. Lo scrive un trigger da `check_frequency_days`:
  -- è l'indice su cui lo scheduler prende il lavoro.
  next_check_at            timestamptz not null default now(),
  -- L'ultima impronta nota del contenuto normalizzato. Serve a distinguere
  -- «la pagina è cambiata» da «la pagina risponde»: senza, ogni controllo
  -- sembrerebbe un cambiamento.
  last_content_hash        text,
  notes                    text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);

create unique index if not exists uq_subsidy_sources_url
  on public.subsidy_sources (canonical_url);
create index if not exists idx_subsidy_sources_due
  on public.subsidy_sources (next_check_at) where enabled = true;
create index if not exists idx_subsidy_sources_authority
  on public.subsidy_sources (authority);

comment on table public.subsidy_sources is
  'Registro delle fonti UFFICIALI del catalogo incentivi. Nessuna fonte non ufficiale: i tipi ammessi dall''enum sono tutti official_*. Scrittura solo service_role.';
comment on column public.subsidy_sources.allowed_host is
  'Host ammesso per questa fonte. La guardia SSRF lo confronta con l''host di ogni richiesta della catena di redirect e rifiuta tutto il resto (§147).';
comment on column public.subsidy_sources.last_successful_check_at is
  'Aggiornata SOLO da un controllo riuscito. Un errore non la tocca: la freschezza non si deduce da un tentativo fallito (§159).';


-- ---------------------------------------------------------------------------
-- 5. subsidy_source_fetches — OGNI CONTROLLO, RIUSCITO O NO
--
-- §16. È il registro operativo: dice quante volte una fonte ha risposto, quanto
-- ci ha messo, e se il contenuto è cambiato. NON contiene il contenuto — solo
-- l'impronta e i metadati HTTP.
--
-- ⚠️ `http_status_category` e non lo status esatto: '2xx', '3xx', '4xx', '5xx'.
--    Il numero esatto non cambia alcuna decisione e un log che lo conserva per
--    anni è un log che nessuno rilegge. Ciò che conta è la CLASSE.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_source_fetches (
  id                   uuid primary key default gen_random_uuid(),
  source_id            uuid not null references public.subsidy_sources (id) on delete cascade,
  status               public.subsidy_fetch_status not null,
  checked_at           timestamptz not null default now(),
  http_status_category text check (http_status_category in ('2xx', '3xx', '4xx', '5xx', 'none')),
  content_hash         text,
  etag                 text,
  last_modified        text,
  detected_change      boolean not null default false,
  error_code           text,
  duration_ms          integer,
  -- Quanti byte sono stati letti. Serve a riconoscere una pagina che si è
  -- svuotata: una fonte che passa da 80 KB a 400 byte «risponde» ma non dice
  -- più niente, e senza questa colonna sembrerebbe soltanto «cambiata».
  content_bytes        integer,
  created_at           timestamptz not null default now()
);

create index if not exists idx_subsidy_fetches_source
  on public.subsidy_source_fetches (source_id, checked_at desc);
create index if not exists idx_subsidy_fetches_errors
  on public.subsidy_source_fetches (checked_at desc) where status in ('error', 'blocked');

comment on table public.subsidy_source_fetches is
  'Un record per ogni controllo di una fonte. Mai il contenuto: solo impronta e metadati (§16).';


-- ---------------------------------------------------------------------------
-- 6. subsidy_source_snapshots — CIÒ CHE LA FONTE DICEVA, QUEL GIORNO
--
-- §17. Un'istantanea NON è una copia della pagina: è l'insieme dei campi
-- normalizzati che l'adapter ha saputo estrarre, più i frammenti di testo che
-- li giustificano. È l'oggetto a cui punta ogni evidenza di criterio, ed è ciò
-- che rende una pratica di sei mesi fa ancora leggibile.
--
-- ⚠️ `evidence` contiene FRAMMENTI, non pagine. Ogni frammento porta il testo
--    letterale, la sezione da cui viene e — nei PDF — il numero di pagina. È
--    la stessa disciplina delle citazioni verificate dell'analisi documentale:
--    un'affermazione che non si ritrova nella fonte vale zero.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_source_snapshots (
  id                uuid primary key default gen_random_uuid(),
  source_id         uuid not null references public.subsidy_sources (id) on delete cascade,
  fetch_id          uuid references public.subsidy_source_fetches (id) on delete set null,
  retrieved_at      timestamptz not null default now(),
  title             text,
  canonical_url     text not null,
  content_hash      text not null,
  language          text check (language in ('it', 'de', 'fr', 'en')),
  -- Data di pubblicazione/aggiornamento DICHIARATA DALLA FONTE, quando c'è.
  -- ⚠️ Nulla quando la fonte non la dichiara: dedurla dall'header HTTP
  --    `Last-Modified` sarebbe raccontare che l'autorità ha aggiornato il testo
  --    quando invece si è mosso solo un file su un server.
  source_published_at date,
  source_updated_at   date,
  parser_version    text not null,
  -- I campi che l'adapter ha saputo leggere, nella forma normalizzata del
  -- prodotto. Ciò che non ha saputo leggere NON compare: un campo assente è
  -- diverso da un campo vuoto.
  normalized        jsonb not null default '{}'::jsonb,
  -- [{ "field": "...", "quote": "...", "section": "...", "page": 3|null }]
  evidence          jsonb not null default '[]'::jsonb,
  -- Strutture che l'adapter ha visto e NON ha saputo interpretare (§14). Si
  -- dichiarano: un adapter che tace su ciò che non capisce dà l'impressione di
  -- aver letto tutto.
  unsupported       jsonb not null default '[]'::jsonb,
  created_at        timestamptz not null default now()
);

create index if not exists idx_subsidy_snapshots_source
  on public.subsidy_source_snapshots (source_id, retrieved_at desc);
create index if not exists idx_subsidy_snapshots_hash
  on public.subsidy_source_snapshots (source_id, content_hash);

comment on table public.subsidy_source_snapshots is
  'Istantanea normalizzata di una fonte ufficiale in un dato momento, con i frammenti di testo che giustificano ogni campo (§17, §19).';


-- ---------------------------------------------------------------------------
-- 7. subsidy_program_versions — LA VERSIONE, CHE È IL CUORE DEL MODELLO
--
-- §4. Il programma è l'identità stabile: `subsidy_programs` continua a
-- rappresentarla e non viene toccata nella sostanza. Ciò che CAMBIA — requisiti,
-- esclusioni, importi, documenti richiesti — vive qui, in una riga che una
-- volta pubblicata non si modifica più.
--
-- ⚠️ PERCHÉ IMMUTABILE. Una pratica aperta ad aprile è stata preparata contro
--    certi requisiti. Se a luglio l'autorità li cambia e noi sovrascriviamo, la
--    pratica diventa incomprensibile: dice di aver soddisfatto criteri che nel
--    frattempo non esistono più. Con le versioni, la pratica punta alla sua e
--    resta leggibile per sempre (§109, §166).
--
-- ⚠️ UNA SOLA VERSIONE PUBBLICATA PER PROGRAMMA, garantita da un indice unico
--    parziale. Non è un dettaglio: è ciò che rende «la versione corrente» una
--    domanda con una risposta sola. Le altre diventano `superseded`.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_program_versions (
  id                  uuid primary key default gen_random_uuid(),
  program_id          text not null references public.subsidy_programs (id) on delete cascade,
  version_number      integer not null check (version_number >= 1),
  status              public.subsidy_version_status not null default 'draft',
  -- Da quando i requisiti di questa versione sono in vigore SECONDO LA FONTE.
  -- Diverso da `published_at`, che è quando li abbiamo recepiti noi.
  effective_from      date,
  effective_until     date,
  published_at        timestamptz,
  reviewed_at         timestamptz,
  reviewed_by         uuid references auth.users (id) on delete set null,
  source_snapshot_id  uuid references public.subsidy_source_snapshots (id) on delete set null,
  -- Il contenuto normalizzato della versione: nome, autorità, tipo di
  -- sostegno, geografia, settori, dimensione, tipi di progetto, descrizione del
  -- contributo, costi ammissibili, documenti richiesti, traduzioni.
  -- ⚠️ Le REGOLE non stanno qui: hanno una tabella propria (sezione 8) perché
  --    ognuna ha la sua evidenza e il suo stato, e vanno interrogate una per una.
  normalized_content  jsonb not null default '{}'::jsonb,
  -- Impronta del contenuto + regole. Due versioni con lo stesso hash sono la
  -- stessa cosa detta due volte, e la seconda non si pubblica.
  content_hash        text not null,
  -- Chi ha creato la bozza: il worker ('system') o una persona.
  created_by          uuid references auth.users (id) on delete set null,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (program_id, version_number)
);

-- ⚠️ L'indice che garantisce «una sola corrente».
create unique index if not exists uq_subsidy_version_published
  on public.subsidy_program_versions (program_id) where status = 'published';
create index if not exists idx_subsidy_versions_program
  on public.subsidy_program_versions (program_id, version_number desc);
create index if not exists idx_subsidy_versions_status
  on public.subsidy_program_versions (status, published_at desc);

comment on table public.subsidy_program_versions is
  'Versione dei requisiti di un programma. Una versione pubblicata è IMMUTABILE: correggere significa pubblicarne un''altra (§4, §109).';
comment on column public.subsidy_program_versions.effective_from is
  'Data da cui la fonte dichiara in vigore questi requisiti. Diversa da published_at, che è quando li abbiamo recepiti.';


-- ---------------------------------------------------------------------------
-- 8. subsidy_program_rules — I CRITERI, UNO PER RIGA
--
-- §52, §54. Ogni requisito è una struttura tipizzata: un fatto da guardare, un
-- operatore fra dodici, un valore atteso. Non c'è codice, non c'è espressione,
-- non c'è SQL: il motore legge queste colonne e chiama una funzione.
--
-- ⚠️ `fact_key` NON è validata dal database, ed è una scelta. L'elenco dei
--    fatti conoscibili vive in `_shared/subsidy/facts.ts` e cambia con il
--    prodotto; duplicarlo in un CHECK creerebbe due copie destinate a
--    divergere — la trappola di `crm_is_public_domain`, che si è chiusa con un
--    test che LEGGE la migrazione, non con un vincolo. Qui il comportamento
--    sicuro è nel motore: un `fact_key` che il registro non conosce produce
--    `not_evaluable`, MAI `satisfied`. Un criterio che non sappiamo valutare
--    non è un criterio superato.
--
-- ⚠️ `source_evidence` è OBBLIGATORIA nei fatti per i criteri `hard` e
--    `exclusion`: un criterio che può escludere un'impresa senza poter mostrare
--    da dove viene è esattamente ciò che questo prodotto non deve fare. Il
--    controllo sta nella sezione 23 e in `subsidy:health`.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_program_rules (
  id                  uuid primary key default gen_random_uuid(),
  program_version_id  uuid not null references public.subsidy_program_versions (id) on delete cascade,
  -- Stabile fra le versioni: è ciò che permette di dire «questo criterio è
  -- cambiato» invece di «un criterio è sparito e un altro è comparso».
  rule_key            text not null,
  label               text not null,
  fact_key            text,
  operator            public.subsidy_rule_operator,
  expected_value      jsonb,
  hardness            public.subsidy_rule_hardness not null,
  evaluability        public.subsidy_rule_evaluability not null,
  -- La domanda da porre alla persona quando `evaluability = 'question'`.
  question            text,
  -- { "snapshotId": uuid|null, "quote": "...", "section": "...", "page": n|null,
  --   "url": "...", "language": "it|de|fr|en", "checkedAt": "YYYY-MM-DD" }
  source_evidence     jsonb,
  notes               text,
  sort_order          integer not null default 0,
  created_at          timestamptz not null default now(),
  unique (program_version_id, rule_key)
);

create index if not exists idx_subsidy_rules_version
  on public.subsidy_program_rules (program_version_id, sort_order);

comment on table public.subsidy_program_rules is
  'Un criterio per riga, tipizzato. Nessuna espressione, nessun eval, nessun SQL dinamico: operatori da un enum chiuso (§52, §53).';
comment on column public.subsidy_program_rules.fact_key is
  'Chiave del fatto in _shared/subsidy/facts.ts. Una chiave sconosciuta produce not_evaluable, MAI satisfied: un criterio che non sappiamo valutare non è superato.';


-- ---------------------------------------------------------------------------
-- 9. subsidy_calls — LE FINESTRE
--
-- §2, §5, §162. Un programma dura anni; le sue call aprono, chiudono, cambiano
-- scadenza e si ripetono. Il modulo 1.0 le teneva in un campo di testo
-- (`application_window`), e da lì non si poteva né ordinare, né avvisare, né
-- sapere se oggi ci si può candidare.
--
-- ⚠️ UNA CALL NUOVA È UN RECORD NUOVO (§162). Non si riapre quella dell'anno
--    scorso cambiandole la data: la pratica che punta alla vecchia deve
--    continuare a puntare a una call chiusa, altrimenti la sua storia diventa
--    falsa (§163).
--
-- ⚠️ LA PRECISIONE DELLA SCADENZA È UN DATO (§7). `deadline_on` è la data;
--    `deadline_at` l'istante, e vale SOLO se la fonte lo dichiara. Nessun
--    `23:59` d'ufficio: un termine che scade alle 12:00 e che noi mostriamo
--    alle 23:59 fa perdere la candidatura.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_calls (
  id                  uuid primary key default gen_random_uuid(),
  program_id          text not null references public.subsidy_programs (id) on delete cascade,
  -- La versione dei requisiti valida PER QUESTA call. Nulla quando la fonte
  -- non lo lega esplicitamente: non si indovina.
  program_version_id  uuid references public.subsidy_program_versions (id) on delete set null,
  -- Il riferimento che usa l'autorità ("Call 2026-2", "Ausschreibung Herbst").
  external_reference  text,
  title               text,
  status              public.subsidy_call_status not null default 'unknown',
  opens_on            date,
  deadline_on         date,
  -- ⚠️ Valorizzato SOLO se la fonte dichiara un'ora. Vedi sopra.
  deadline_at         timestamptz,
  timezone            text,
  -- Finestra permanente: ci si candida in ogni momento. Diverso da 'open',
  -- che è una finestra con una fine.
  continuous          boolean not null default false,
  -- Quando la fonte UFFICIALE dice quando aprirà la prossima. Testo e non data:
  -- le autorità scrivono «autunno 2026», e trasformarlo in 01.09.2026 sarebbe
  -- inventare un giorno (§161).
  expected_next_call  text,
  source_snapshot_id  uuid references public.subsidy_source_snapshots (id) on delete set null,
  checked_at          timestamptz,
  published_at        timestamptz,
  closed_at           timestamptz,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create unique index if not exists uq_subsidy_calls_reference
  on public.subsidy_calls (program_id, external_reference)
  where external_reference is not null;
create index if not exists idx_subsidy_calls_program
  on public.subsidy_calls (program_id, status);
create index if not exists idx_subsidy_calls_deadline
  on public.subsidy_calls (deadline_on) where status in ('open', 'upcoming');

comment on table public.subsidy_calls is
  'Le finestre di candidatura. Una call nuova è un record nuovo: non si riapre la precedente cambiandole la scadenza (§162).';
comment on column public.subsidy_calls.deadline_at is
  'Istante esatto, SOLO se la fonte lo dichiara. Nessun 23:59 dedotto da una data (§7).';


-- ---------------------------------------------------------------------------
-- 10. subsidy_catalog_reviews — NESSUN CAMBIAMENTO CRITICO ENTRA DA SOLO
--
-- §20, §21, §22. Quando una fonte cambia, il sistema NON riscrive la versione
-- pubblicata. Registra il nuovo hash, calcola la differenza campo per campo, e
-- crea una riga qui. Finché una persona non la accetta, ciò che gli utenti
-- vedono resta la versione precedente — con la data in cui è stata verificata.
--
-- ⚠️ È la differenza fra un catalogo che si aggiorna e un catalogo che si
--    corrompe da solo. Un parser che sbaglia a leggere una tabella HTML può
--    trasformare «fino al 30%» in «fino al 3%»: se quel valore entra in
--    produzione senza che nessuno lo guardi, il prodotto mente con l'aria di
--    essere aggiornato.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_catalog_reviews (
  id               uuid primary key default gen_random_uuid(),
  source_fetch_id  uuid references public.subsidy_source_fetches (id) on delete set null,
  snapshot_id      uuid references public.subsidy_source_snapshots (id) on delete set null,
  program_id       text references public.subsidy_programs (id) on delete cascade,
  call_id          uuid references public.subsidy_calls (id) on delete cascade,
  change_type      public.subsidy_review_change_type not null,
  -- Che cosa dicevamo e che cosa la fonte dice adesso, campo per campo.
  previous_values  jsonb not null default '{}'::jsonb,
  proposed_values  jsonb not null default '{}'::jsonb,
  risk_level       public.subsidy_review_risk not null default 'medium',
  status           public.subsidy_review_status not null default 'pending',
  reviewed_by      uuid references auth.users (id) on delete set null,
  reviewed_at      timestamptz,
  notes            text,
  -- Idempotenza: lo stesso cambiamento rilevato due volte non crea due righe da
  -- revisionare. Senza, un controllo ogni sei ore su una fonte cambiata
  -- produrrebbe quattro voci identiche al giorno.
  dedupe_key       text,
  created_at       timestamptz not null default now()
);

create unique index if not exists uq_subsidy_reviews_dedupe
  on public.subsidy_catalog_reviews (dedupe_key) where dedupe_key is not null;
create index if not exists idx_subsidy_reviews_pending
  on public.subsidy_catalog_reviews (status, risk_level, created_at desc) where status = 'pending';

comment on table public.subsidy_catalog_reviews is
  'Cambiamenti rilevati in una fonte, in attesa di revisione umana. Finché sono pending, la versione pubblicata NON cambia (§20, §22).';


-- ---------------------------------------------------------------------------
-- 11. subsidy_projects — L'INIZIATIVA, CHE PRIMA NON ESISTEVA
--
-- §29. Il modulo 1.0 teneva i progetti in `company_profiles.current_projects`:
-- un array di stringhe come `['innovazione','energia']`. Con quello si poteva
-- rispondere «l'azienda si occupa anche di energia», non «questo progetto da
-- CHF 180'000 con la SUPSI, che parte a settembre e non è ancora iniziato».
-- La differenza è tutta lì: senza un progetto non esiste una domanda a cui il
-- catalogo possa rispondere.
--
-- ⚠️ PROGETTO ≠ ATTIVITÀ (§32). Il progetto descrive l'iniziativa da
--    finanziare; le attività sono il lavoro da fare, stanno in `tasks` e ne
--    esistono molte per progetto. Non si duplicano qui.
--
-- ⚠️ I CAMPI SONO SOLO QUELLI CHE IL MOTORE USA DAVVERO (§29 ultima riga, §98).
--    Un modulo da trenta campi non lo compila nessuno, e i campi vuoti non
--    valutano niente. Ciò che serve a un criterio specifico si chiede quando
--    quel criterio compare, e la risposta finisce in `subsidy_answers`.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_projects (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies (id) on delete cascade,
  title                 text not null check (length(btrim(title)) between 1 and 200),
  description           text,
  stage                 public.subsidy_project_stage not null default 'idea',
  -- §31 — dev'essere membro della stessa azienda. Lo impone un trigger, non la
  -- buona volontà del client: è la garanzia della 0016 applicata qui.
  owner_user_id         uuid references auth.users (id) on delete set null,
  -- Dove si realizza. Può differire dalla sede: un'impresa di Lugano che
  -- risana un capannone a Bellinzona resta ticinese, ma un'impresa ticinese con
  -- un impianto a Zugo non accede ai programmi ticinesi per quell'impianto.
  location_canton       text,
  location_country      text not null default 'CH',
  sector                text,
  estimated_start_date  date,
  estimated_end_date    date,
  -- §67 — importo NUMERICO con valuta ISO separata. Nessun float, nessuna
  -- conversione: due valute diverse non si sommano e non si confrontano.
  budget_amount         numeric(14, 2) check (budget_amount is null or budget_amount >= 0),
  budget_currency       text check (budget_currency is null or budget_currency ~ '^[A-Z]{3}$'),
  -- Quante persone il progetto coinvolge o assume. Nullo = non indicato, che
  -- è diverso da zero.
  employee_impact       integer check (employee_impact is null or employee_impact >= 0),
  -- I tre flag che decidono l'accesso a interi programmi (Innosuisse vuole un
  -- partner di ricerca; la LInn guarda l'internazionalizzazione).
  -- ⚠️ Booleani NULLABILI a tre valori: `null` è «non lo sappiamo», e non deve
  --    diventare `false` (§51). Un criterio su un fatto ignoto resta `unknown`.
  has_research_partner  boolean,
  has_innovation_partner boolean,
  has_international_partners boolean,
  -- I tipi di progetto, dagli stessi otto del catalogo.
  project_types         text[] not null default '{}',
  goals                 text,
  status                text not null default 'active' check (status in ('active', 'archived')),
  created_by            uuid references auth.users (id) on delete set null,
  archived_at           timestamptz,
  archived_by           uuid references auth.users (id) on delete set null,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists idx_subsidy_projects_company
  on public.subsidy_projects (company_id, status, updated_at desc);
create index if not exists idx_subsidy_projects_stage
  on public.subsidy_projects (company_id, stage) where status = 'active';
create index if not exists idx_subsidy_projects_owner
  on public.subsidy_projects (owner_user_id) where owner_user_id is not null;

comment on table public.subsidy_projects is
  'L''iniziativa che l''impresa vuole realizzare. Diversa dalle attività (tasks), che sono il lavoro da svolgere (§32).';
comment on column public.subsidy_projects.has_research_partner is
  'Tre valori: true/false/NULL. NULL significa «non lo sappiamo» e produce un criterio unknown, non un criterio fallito (§51).';


-- ---------------------------------------------------------------------------
-- 12. subsidy_project_documents — I DOCUMENTI RESTANO IN DOCUMENTI
--
-- §41, §113. Business plan, preventivi, lettere del partner: sono documenti
-- dell'impresa e vivono nel Document Hub, che è la loro unica fonte di verità.
-- Qui c'è solo la RELAZIONE. Nessuna copia, nessun secondo archivio.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_project_documents (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  project_id  uuid not null references public.subsidy_projects (id) on delete cascade,
  document_id uuid not null references public.documents (id) on delete cascade,
  relation    public.subsidy_document_relation not null default 'other',
  added_by    uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (project_id, document_id)
);

create index if not exists idx_subsidy_project_docs_project
  on public.subsidy_project_documents (project_id);

comment on table public.subsidy_project_documents is
  'Collegamento fra progetto e documenti. Il file resta in Documenti: qui c''è solo la relazione (§113).';


-- ---------------------------------------------------------------------------
-- 13. subsidy_project_partners — I PARTNER SONO NEL CRM
--
-- §42. Un partner di ricerca, un fornitore, un consorziato: sono controparti, e
-- le controparti hanno già una casa. Qui si dichiara soltanto il RUOLO che
-- quell'organizzazione ha in questo progetto.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_project_partners (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  project_id      uuid not null references public.subsidy_projects (id) on delete cascade,
  organization_id uuid not null references public.crm_organizations (id) on delete cascade,
  -- Il ruolo nel progetto, non nel rapporto commerciale: la stessa SUPSI può
  -- essere fornitore in un progetto e partner di ricerca in un altro.
  role            text not null check (role in ('research', 'implementation', 'supplier', 'consortium', 'other')),
  added_by        uuid references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (project_id, organization_id, role)
);

create index if not exists idx_subsidy_project_partners_project
  on public.subsidy_project_partners (project_id);

comment on table public.subsidy_project_partners is
  'Partner del progetto, come riferimento a crm_organizations. Nessuna anagrafica duplicata (§42).';


-- ---------------------------------------------------------------------------
-- 14. subsidy_project_interpretations — L'AI CHE LEGGE, VERSIONATA
--
-- §33, §34. Nel modulo 1.0 l'interpretazione viveva nello stato di React:
-- cambiavi pagina e spariva, e nessuno poteva più dire perché un certo tipo di
-- progetto fosse stato riconosciuto. Ora è una riga, con il modello, la
-- versione del prompt e le citazioni verificate.
--
-- ⚠️ IMMUTABILE (§34). Una descrizione riscritta non modifica la riga
--    precedente: ne crea una nuova con `version` successiva. La valutazione di
--    ieri deve poter continuare a dire su quale interpretazione si basava.
--
-- ⚠️ NON SOVRASCRIVE MAI CIÒ CHE UNA PERSONA HA DETTO (§35). Le correzioni
--    umane sono `subsidy_answers` e i campi del progetto; l'interpretazione è
--    una fonte fra le altre, e nella scala di `subsidy_fact_source` viene DOPO
--    la risposta esplicita e il dato strutturato.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_project_interpretations (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  project_id          uuid not null references public.subsidy_projects (id) on delete cascade,
  version             integer not null check (version >= 1),
  -- L'impronta della descrizione interpretata. §152: se non è cambiata e la
  -- versione del motore nemmeno, non si richiama il modello e non si spende.
  description_hash    text not null,
  model               text not null,
  prompt_version      text not null,
  schema_version      text not null,
  -- L'output normalizzato: tipi di progetto con citazione, settore, importo,
  -- tempistica, aree pertinenti, incertezze.
  content             jsonb not null default '{}'::jsonb,
  -- Quante citazioni sono state scartate perché non ritrovate nel testo (§65).
  dropped_evidence    integer not null default 0,
  overall_confidence  numeric(4, 3) check (overall_confidence is null or (overall_confidence >= 0 and overall_confidence <= 1)),
  created_by          uuid references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  unique (project_id, version)
);

create index if not exists idx_subsidy_interpretations_project
  on public.subsidy_project_interpretations (project_id, version desc);
create index if not exists idx_subsidy_interpretations_hash
  on public.subsidy_project_interpretations (project_id, description_hash, prompt_version);

comment on table public.subsidy_project_interpretations is
  'Interpretazione AI della descrizione, versionata e immutabile. Una nuova descrizione crea una versione nuova, non sovrascrive (§34).';


-- ---------------------------------------------------------------------------
-- 15. subsidy_answers — LE RISPOSTE, CON UNA STORIA
--
-- §93, §94. Le risposte ai criteri erano un JSON dentro `subsidy_matches`,
-- sovrascritto a ogni verifica: non si poteva sapere chi avesse risposto, né
-- quando, né contro quale versione del programma. Adesso ogni risposta è una
-- riga append-only.
--
-- ⚠️ APPEND-ONLY (§187). Rispondere di nuovo scrive una riga nuova; la corrente
--    è la più recente per (progetto, versione, criterio). La precedente resta:
--    se un criterio è stato dichiarato soddisfatto a marzo e non soddisfatto a
--    giugno, quel cambiamento è un fatto che riguarda una pratica in corso.
--
-- ⚠️ LA RISPOSTA È LEGATA ALLA VERSIONE DEL PROGRAMMA, non al programma. Un
--    criterio riformulato non eredita la vecchia risposta: sarebbe una risposta
--    a una domanda che non è più quella.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_answers (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies (id) on delete cascade,
  project_id          uuid references public.subsidy_projects (id) on delete cascade,
  program_version_id  uuid not null references public.subsidy_program_versions (id) on delete cascade,
  rule_key            text not null,
  -- 'yes' | 'no' | 'unknown'. Tre valori e non un booleano: «non lo so» è una
  -- risposta legittima e diversa dal non aver risposto (che è l'assenza di riga).
  value               text not null check (value in ('yes', 'no', 'unknown')),
  note                text,
  -- ⚠️ Timbrati dal database, non dal client (§146).
  answered_by         uuid references auth.users (id) on delete set null,
  answered_at         timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index if not exists idx_subsidy_answers_current
  on public.subsidy_answers (company_id, project_id, program_version_id, rule_key, answered_at desc);

comment on table public.subsidy_answers is
  'Risposte ai criteri, APPEND-ONLY. La corrente è la più recente; le precedenti restano consultabili (§93, §187).';


-- ---------------------------------------------------------------------------
-- 16. subsidy_opportunities — L'INCONTRO
--
-- §55. Il modulo 1.0 aveva `unique (company_id, program_id)`: una sola riga per
-- azienda e programma. Bastava avere due progetti perché la seconda
-- valutazione cancellasse la prima.
--
-- Un'opportunità è l'incontro fra UN PROGETTO e UNA VERSIONE di programma,
-- eventualmente dentro UNA CALL. La stessa impresa può averne dieci sullo
-- stesso programma, e sono dieci cose diverse.
--
-- ⚠️ SEI MISURE SEPARATE, e nessuna è una probabilità (§43):
--    rilevanza · idoneità · completezza · tempistica · freschezza · prontezza.
--    Comprimerle in un punteggio unico è precisamente il modo in cui un
--    prodotto del genere comincia a mentire.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_opportunities (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  -- Nullo per le opportunità «generali», legate al solo profilo aziendale
  -- (§62): esistono, ma l'interfaccia le tiene distinte da quelle di progetto.
  project_id           uuid references public.subsidy_projects (id) on delete cascade,
  kind                 public.subsidy_opportunity_kind not null default 'project',
  program_id           text not null references public.subsidy_programs (id) on delete cascade,
  program_version_id   uuid not null references public.subsidy_program_versions (id) on delete cascade,
  call_id              uuid references public.subsidy_calls (id) on delete set null,

  -- ---- Le sei misure ----
  relevance_level      public.subsidy_relevance_level not null default 'low',
  -- Punteggio INTERNO, per ordinare. Non si mostra come percentuale (§45).
  relevance_score      integer not null default 0 check (relevance_score between 0 and 100),
  eligibility_status   public.subsidy_eligibility_status not null default 'not_assessed',
  completeness         public.subsidy_completeness not null default 'major_gaps',
  timing               public.subsidy_timing not null default 'unknown',
  source_freshness     public.subsidy_freshness not null default 'unverified',
  readiness            public.subsidy_readiness not null default 'not_started',

  -- Quanti fatti mancano per poter valutare i criteri rimasti aperti. Serve
  -- alla frase «aggiungendo il numero di dipendenti valuteremo 4 criteri in
  -- più», che è un'informazione operativa — al contrario di «profilo al 47%».
  missing_fact_count   integer not null default 0,
  open_criteria_count  integer not null default 0,

  -- La valutazione corrente. `subsidy_assessments` conserva tutte.
  current_assessment_id uuid,
  assessment_version   integer not null default 0,
  -- L'impronta degli ingressi dell'ultima valutazione (§60): stessi dati,
  -- stessa versione, stessa call → nessuna valutazione nuova.
  last_fingerprint     text,
  -- Vero quando i dati sono cambiati dopo l'ultima valutazione (§59): la
  -- schermata dice «valutazione da aggiornare» invece di mostrare un risultato
  -- vecchio come se fosse fresco.
  assessment_stale     boolean not null default false,

  first_matched_at     timestamptz not null default now(),
  last_assessed_at     timestamptz,
  saved_at             timestamptz,
  dismissed_at         timestamptz,
  dismissed_by         uuid references auth.users (id) on delete set null,
  dismissed_reason     public.subsidy_dismissal_reason,
  dismissed_note       text,
  -- §102 — quando la call o i requisiti cambiano in modo rilevante DOPO che
  -- l'opportunità è stata messa da parte, si può proporre di riguardarla. Non
  -- si riattiva da sola: l'utente ha già detto di no una volta.
  reopen_suggested_at  timestamptz,
  -- Il filo della catena causale, quando l'opportunità nasce da un'automazione.
  workflow_run_id      uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- ⚠️ L'UNICITÀ: un'opportunità per (progetto, versione, call). Le opportunità
--    generali non hanno progetto, quindi servono DUE indici parziali —
--    `unique` con una colonna nullable non vincola niente, perché in SQL due
--    NULL sono diversi.
create unique index if not exists uq_subsidy_opp_project
  on public.subsidy_opportunities (project_id, program_version_id, coalesce(call_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where project_id is not null;
create unique index if not exists uq_subsidy_opp_general
  on public.subsidy_opportunities (company_id, program_version_id, coalesce(call_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where project_id is null;

create index if not exists idx_subsidy_opp_company
  on public.subsidy_opportunities (company_id, relevance_level, relevance_score desc)
  where dismissed_at is null;
create index if not exists idx_subsidy_opp_project_list
  on public.subsidy_opportunities (project_id, relevance_score desc) where project_id is not null;
create index if not exists idx_subsidy_opp_stale
  on public.subsidy_opportunities (company_id) where assessment_stale = true and dismissed_at is null;
create index if not exists idx_subsidy_opp_program
  on public.subsidy_opportunities (program_id);
create index if not exists idx_subsidy_opp_call
  on public.subsidy_opportunities (call_id) where call_id is not null;

comment on table public.subsidy_opportunities is
  'L''incontro fra un progetto e una versione di programma. Sei misure separate: rilevanza, idoneità, completezza, tempistica, freschezza, prontezza — nessuna è una probabilità di ottenere il contributo (§43, §44).';
comment on column public.subsidy_opportunities.relevance_score is
  'Punteggio INTERNO per l''ordinamento. Non si mostra come percentuale: «82/100» letto da un imprenditore diventa «82% di possibilità», che è falso (§45).';


-- ---------------------------------------------------------------------------
-- 17. subsidy_assessments — LA STORIA DELLE VALUTAZIONI
--
-- §56, §58. Append-only. Ogni riga è una fotografia completa: quale versione,
-- quale call, quali fatti, quali criteri, che cosa mancava. La nuova diventa la
-- corrente; la precedente resta consultabile.
--
-- ⚠️ PERCHÉ SERVE DAVVERO. Una PMI apre una pratica a maggio con «tre criteri
--    aperti su otto». A luglio l'autorità cambia un requisito e i criteri
--    aperti diventano cinque. Senza lo storico, la schermata mostrerebbe cinque
--    e nessuno saprebbe che due sono comparsi dopo — cioè che non è colpa di
--    chi ci sta lavorando.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_assessments (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  opportunity_id       uuid not null references public.subsidy_opportunities (id) on delete cascade,
  version              integer not null check (version >= 1),
  program_version_id   uuid not null references public.subsidy_program_versions (id) on delete cascade,
  call_id              uuid references public.subsidy_calls (id) on delete set null,
  interpretation_id    uuid references public.subsidy_project_interpretations (id) on delete set null,

  relevance_level      public.subsidy_relevance_level not null,
  relevance_score      integer not null check (relevance_score between 0 and 100),
  -- Le ragioni della rilevanza, DETERMINISTICHE (§46): geografia, tipo di
  -- progetto, settore, dimensione, partner, tempistica. Chiavi di traduzione
  -- con parametri, mai frasi italiane: una frase scritta qui comparirebbe
  -- identica nell'interfaccia tedesca.
  -- [{ "key": "geography", "params": {...} }]
  relevance_reasons    jsonb not null default '[]'::jsonb,
  eligibility_status   public.subsidy_eligibility_status not null,
  completeness         public.subsidy_completeness not null,
  timing               public.subsidy_timing not null,
  source_freshness     public.subsidy_freshness not null,

  -- I fatti usati, ciascuno con la propria provenienza (§38).
  -- { "<factKey>": { "value": ..., "source": "project", "confidence": 0.9,
  --                  "reference": "..."|null } }
  facts_used           jsonb not null default '{}'::jsonb,
  -- Le chiavi dei fatti che servivano e non c'erano.
  missing_facts        jsonb not null default '[]'::jsonb,
  -- I fatti su cui due fonti si contraddicono (§92 `conflicting`).
  conflicts            jsonb not null default '[]'::jsonb,

  -- L'impronta degli ingressi. Due valutazioni con lo stesso fingerprint sono
  -- la stessa valutazione, e la seconda non si scrive (§60, §181).
  fingerprint          text not null,
  engine_version       text not null,
  -- 'worker' quando la scrive il motore periodico, 'user' quando la chiede una
  -- persona premendo «rivaluta». ⚠️ Non è cosmetico: una valutazione chiesta da
  -- una persona può costare una chiamata al modello, quella automatica no.
  trigger_source       text not null default 'worker' check (trigger_source in ('worker', 'user', 'catalog_change', 'migration')),
  created_at           timestamptz not null default now(),
  unique (opportunity_id, version)
);

create index if not exists idx_subsidy_assessments_opp
  on public.subsidy_assessments (opportunity_id, version desc);
create unique index if not exists uq_subsidy_assessments_fingerprint
  on public.subsidy_assessments (opportunity_id, fingerprint);

comment on table public.subsidy_assessments is
  'Storia delle valutazioni, append-only. La nuova diventa corrente, la precedente resta consultabile (§56, §58).';
comment on column public.subsidy_assessments.relevance_reasons is
  'Chiavi di traduzione con parametri, MAI frasi. Una frase italiana scritta qui comparirebbe identica nell''interfaccia tedesca.';


-- ---------------------------------------------------------------------------
-- 18. subsidy_criterion_results — CRITERIO PER CRITERIO
--
-- §91. La schermata deve poter dire, per ogni criterio: il testo, se è
-- obbligatorio, come sta, quale valore aziendale è stato usato, DA DOVE viene
-- quel valore, e da quale punto della fonte viene il requisito.
--
-- ⚠️ `value_source` è la colonna che rende la risposta verificabile. Senza,
--    «soddisfatto» è un'affermazione dell'app; con, è una catena che si può
--    risalire fino al profilo, alla risposta di una persona o alla citazione
--    letterale di un documento.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_criterion_results (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  assessment_id  uuid not null references public.subsidy_assessments (id) on delete cascade,
  rule_key       text not null,
  hardness       public.subsidy_rule_hardness not null,
  state          public.subsidy_criterion_state not null,
  -- Il valore aziendale effettivamente confrontato, come testo leggibile.
  -- Nullo quando non c'era: è il caso di `unknown`.
  observed_value text,
  value_source   public.subsidy_fact_source,
  -- Perché lo stato è quello: 'missing_fact' | 'answer' | 'auto' |
  -- 'unknown_operator' | 'unknown_fact_key' | 'manual_review' | 'conflict'.
  -- ⚠️ `unknown_fact_key` esiste perché una regola che nomina un fatto che il
  --    motore non conosce deve dirlo, non sparire.
  reason_code    text,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  unique (assessment_id, rule_key)
);

create index if not exists idx_subsidy_criteria_assessment
  on public.subsidy_criterion_results (assessment_id, sort_order);

comment on table public.subsidy_criterion_results is
  'Esito di ogni criterio dentro una valutazione, con il valore usato e la sua provenienza (§91).';


-- ---------------------------------------------------------------------------
-- 19. LA PRATICA 2.0 — SI EVOLVE `subsidy_cases`, NON SE NE CREA UN'ALTRA
--
-- §105, §166. La tabella esiste dalla 0003 e va estesa, non sostituita: una
-- tabella parallela avrebbe lasciato le pratiche vecchie in un limbo, ed è
-- esattamente ciò che il Work Hub ha evitato facendo evolvere `tasks`.
--
-- ⚠️ L'ISTANTANEA È IL PUNTO (§109). Alla creazione la pratica congela: quale
--    versione del programma, quale call, quali criteri, quale scadenza, quali
--    documenti. Se il catalogo cambia, la pratica NON si aggiorna da sola —
--    mostra un confronto (§110). Sovrascrivere significherebbe far dire a una
--    pratica di aver soddisfatto criteri che non esistevano quando è nata.
--
-- ⚠️ `submitted` SIGNIFICA CHE UNA PERSONA HA REGISTRATO L'INVIO (§107). Non
--    che l'autorità l'ha ricevuta: il prodotto non ha alcun canale verso
--    l'autorità, e presentare il proprio registro come una conferma esterna
--    sarebbe la bugia più facile da raccontare in questo modulo.
-- ---------------------------------------------------------------------------

alter table public.subsidy_cases
  add column if not exists opportunity_id uuid references public.subsidy_opportunities (id) on delete set null;
alter table public.subsidy_cases
  add column if not exists project_id uuid references public.subsidy_projects (id) on delete set null;
alter table public.subsidy_cases
  add column if not exists program_version_id uuid references public.subsidy_program_versions (id) on delete set null;
alter table public.subsidy_cases
  add column if not exists call_id uuid references public.subsidy_calls (id) on delete set null;
-- §108 — il responsabile interno. Membro della stessa azienda, garantito da un
-- trigger come per le attività e i contratti.
alter table public.subsidy_cases
  add column if not exists owner_user_id uuid references auth.users (id) on delete set null;

-- §118 — DUE scadenze, e non è pignoleria. Quella ufficiale è della call e non
-- si tocca; quella interna la sceglie l'impresa per arrivare pronta prima. Un
-- campo solo costringerebbe a scegliere quale delle due mentire.
alter table public.subsidy_cases
  add column if not exists official_deadline date;
alter table public.subsidy_cases
  add column if not exists official_deadline_at timestamptz;
alter table public.subsidy_cases
  add column if not exists internal_deadline date;

-- §105 — importi. Richiesto e assegnato sono due cose diverse, e l'assegnato lo
-- registra una persona o lo documenta una decisione ufficiale.
-- ⚠️ `numeric`, mai float, e valuta ISO separata. Nessuna conversione (§67).
alter table public.subsidy_cases
  add column if not exists amount_requested numeric(14, 2) check (amount_requested is null or amount_requested >= 0);
alter table public.subsidy_cases
  add column if not exists amount_awarded numeric(14, 2) check (amount_awarded is null or amount_awarded >= 0);
alter table public.subsidy_cases
  add column if not exists currency text check (currency is null or currency ~ '^[A-Z]{3}$');

alter table public.subsidy_cases
  add column if not exists submitted_at timestamptz;
alter table public.subsidy_cases
  add column if not exists submitted_by uuid references auth.users (id) on delete set null;
alter table public.subsidy_cases
  add column if not exists decision_at date;
alter table public.subsidy_cases
  add column if not exists outcome public.subsidy_case_outcome not null default 'unknown';
-- Il documento che DOCUMENTA l'esito, quando c'è (§107, §123). Senza, l'esito
-- è una dichiarazione dell'impresa — legittima, ma va saputo.
alter table public.subsidy_cases
  add column if not exists outcome_document_id uuid references public.documents (id) on delete set null;

-- §109 — l'istantanea completa con cui la pratica è nata: criteri, contributo,
-- documenti richiesti, riferimenti alle fonti. È ciò che permette di rileggerla
-- fra due anni.
alter table public.subsidy_cases
  add column if not exists program_snapshot jsonb;
-- L'impronta del catalogo al momento della creazione. Quando diverge da quella
-- corrente, la schermata mostra il confronto invece di aggiornare in silenzio.
alter table public.subsidy_cases
  add column if not exists snapshot_hash text;
-- ⚠️ §166 — per le pratiche NATE PRIMA di questa migrazione l'istantanea non
--    esiste e non si può ricostruire. Si dichiara, invece di fabbricarne una:
--    una istantanea inventata sarebbe peggio dell'assenza.
alter table public.subsidy_cases
  add column if not exists legacy_snapshot boolean not null default false;
alter table public.subsidy_cases
  add column if not exists source_changed_at timestamptz;

alter table public.subsidy_cases
  add column if not exists archived_at timestamptz;
alter table public.subsidy_cases
  add column if not exists archived_by uuid references auth.users (id) on delete set null;
alter table public.subsidy_cases
  add column if not exists workflow_run_id uuid;

create index if not exists idx_subsidy_cases_opportunity
  on public.subsidy_cases (opportunity_id) where opportunity_id is not null;
create index if not exists idx_subsidy_cases_project
  on public.subsidy_cases (project_id) where project_id is not null;
create index if not exists idx_subsidy_cases_deadline
  on public.subsidy_cases (company_id, official_deadline) where archived_at is null;
create index if not exists idx_subsidy_cases_owner
  on public.subsidy_cases (owner_user_id) where owner_user_id is not null;
create index if not exists idx_subsidy_cases_status_v2
  on public.subsidy_cases (company_id, status, official_deadline) where archived_at is null;

comment on column public.subsidy_cases.program_snapshot is
  'Istantanea del programma alla creazione: criteri, contributo, documenti, fonti. Se il catalogo cambia, la pratica NON si aggiorna — mostra un confronto (§109, §110).';
comment on column public.subsidy_cases.legacy_snapshot is
  'Vero per le pratiche nate prima della 0032, per cui l''istantanea non è ricostruibile. Dichiararlo è meglio che fabbricarne una (§166).';
comment on column public.subsidy_cases.submitted_at is
  'Quando una PERSONA ha registrato l''invio. Non è una conferma dell''autorità: il prodotto non ha alcun canale verso di lei (§107).';


-- ---------------------------------------------------------------------------
-- 20. subsidy_case_documents — I DOCUMENTI DELLA PRATICA
--
-- §111, §113. Come per i progetti: il file resta in Documenti, qui c'è la
-- relazione e — quando è nota — il criterio del programma che quel documento
-- serve a soddisfare.
--
-- ⚠️ `requirement_key` è nullable di proposito: molti documenti utili non
--    rispondono a un requisito specifico (una corrispondenza, un promemoria).
--    Forzare un legame produrrebbe legami falsi.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_case_documents (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  subsidy_case_id  uuid not null references public.subsidy_cases (id) on delete cascade,
  document_id      uuid not null references public.documents (id) on delete cascade,
  requirement_key  text,
  relation_type    public.subsidy_document_relation not null default 'other',
  status           text not null default 'attached' check (status in ('attached', 'verified', 'superseded')),
  added_by         uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (subsidy_case_id, document_id)
);

create index if not exists idx_subsidy_case_docs_case
  on public.subsidy_case_documents (subsidy_case_id);

comment on table public.subsidy_case_documents is
  'Documenti collegati a una pratica. Il file resta in Documenti: nessuna copia (§111, §113).';


-- ---------------------------------------------------------------------------
-- 21. LA CHECKLIST, ESTESA
--
-- §114, §115. `subsidy_case_items` esisteva già ed era una lista di titoli con
-- una spunta. Si estende: che tipo di passo è, quale documento lo soddisfa,
-- quale attività lo porta avanti, entro quando, se è obbligatorio, e da quale
-- criterio del programma nasce.
--
-- ⚠️ §115 — «Preparare il business plan» NON è completato perché esiste un file
--    chiamato `business-plan.pdf`. Il collegamento a un documento è un
--    SUGGERIMENTO: la spunta la mette una persona. Dedurre il completamento
--    dall'esistenza di un file è il modo più elegante di dichiarare pronta una
--    pratica che non lo è.
-- ---------------------------------------------------------------------------
alter table public.subsidy_case_items
  add column if not exists company_id uuid references public.companies (id) on delete cascade;
alter table public.subsidy_case_items
  add column if not exists kind public.subsidy_checklist_kind not null default 'other';
alter table public.subsidy_case_items
  add column if not exists document_id uuid references public.documents (id) on delete set null;
alter table public.subsidy_case_items
  add column if not exists task_id uuid references public.tasks (id) on delete set null;
alter table public.subsidy_case_items
  add column if not exists due_date date;
alter table public.subsidy_case_items
  add column if not exists required boolean not null default true;
-- Il criterio del programma da cui nasce questo passo, quando ce n'è uno.
alter table public.subsidy_case_items
  add column if not exists source_requirement_key text;
alter table public.subsidy_case_items
  add column if not exists completed_at timestamptz;
alter table public.subsidy_case_items
  add column if not exists completed_by uuid references auth.users (id) on delete set null;

create index if not exists idx_subsidy_case_items_doc
  on public.subsidy_case_items (document_id) where document_id is not null;
create index if not exists idx_subsidy_case_items_task
  on public.subsidy_case_items (task_id) where task_id is not null;

comment on column public.subsidy_case_items.document_id is
  'Documento che il passo riguarda. È un SUGGERIMENTO: la spunta la mette una persona (§115).';
comment on column public.subsidy_case_items.completed_at is
  'Timbrata dal database quando `completed` passa a true, insieme a completed_by. Il client non può scriverle.';


-- ---------------------------------------------------------------------------
-- 22. subsidy_case_events — LO STORICO DELLA PRATICA
--
-- §122. Lo scrivono i trigger. Il client non ha alcun permesso di scrittura,
-- quindi nessuno può firmare un'azione a nome di un collega: è la stessa
-- garanzia di `task_events`, `contract_events` e `crm_events`.
--
-- ⚠️ Nel `detail` entrano identificativi e valori di enum, MAI nomi e MAI
--    importi liberi: uno storico che contenesse i testi diventerebbe una
--    seconda copia dei dati, invecchierebbe, e non si potrebbe ripulire quando
--    qualcuno chiede la cancellazione.
-- ---------------------------------------------------------------------------
create table if not exists public.subsidy_case_events (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies (id) on delete cascade,
  subsidy_case_id  uuid not null references public.subsidy_cases (id) on delete cascade,
  kind             public.subsidy_case_event_kind not null,
  detail           jsonb not null default '{}'::jsonb,
  actor_user_id    uuid references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_subsidy_case_events_case
  on public.subsidy_case_events (subsidy_case_id, created_at desc);

comment on table public.subsidy_case_events is
  'Storico della pratica. Lo scrivono i trigger: il client non ha permessi di scrittura, quindi non può firmare a nome di un collega (§122).';


-- ---------------------------------------------------------------------------
-- 23. IL LEGACY — `subsidy_matches` DIVENTA SOLA LETTURA
--
-- §165. La tabella della 0003 teneva un match per (azienda, programma) con le
-- risposte in un JSON sovrascritto. Non si converte in opportunità, e la
-- ragione è di merito: un'opportunità richiede un PROGETTO e una VERSIONE di
-- programma, e nessuno dei due esiste in quelle righe. Fabbricare
-- un'associazione a un progetto che nessuno ha creato sarebbe inventare un
-- dato — precisamente ciò che §165 vieta.
--
-- Restano quindi leggibili e diventano non scrivibili: la scrittura passa dal
-- modello nuovo. È la stessa scelta fatta per `document_analyses.reply_draft`
-- nella 0010 — deprecare senza distruggere.
-- ---------------------------------------------------------------------------
alter table public.subsidy_matches
  add column if not exists legacy boolean not null default true;

comment on table public.subsidy_matches is
  'LEGACY (0003), sola lettura dalla 0032. Non convertita in opportunità perché quelle righe non hanno né un progetto né una versione di programma, e inventarli sarebbe un dato falso (§165). La scrittura passa da subsidy_opportunities.';


-- ---------------------------------------------------------------------------
-- 24. LA COLONNA CHE LEGA IL CATALOGO ALLE FONTI
--
-- Il registro assistente della 0027 dichiarava di NON poter citare gli
-- incentivi, e la ragione era esatta: «`subsidy_matches.program_id` è testo
-- senza chiave esterna e un programma disattivato smette di risolvere la
-- propria fonte». Da qui in avanti un programma ha una fonte con un vincolo, e
-- la citazione diventa verificabile.
-- ---------------------------------------------------------------------------
alter table public.subsidy_programs
  add column if not exists primary_source_id uuid references public.subsidy_sources (id) on delete set null;
-- La versione pubblicata corrente, denormalizzata per non doverla cercare a
-- ogni lettura. ⚠️ COPIA DICHIARATA: la verità è l'indice unico parziale della
-- sezione 7, e un trigger la tiene allineata.
alter table public.subsidy_programs
  add column if not exists current_version_id uuid references public.subsidy_program_versions (id) on delete set null;
-- Il ciclo di vita del PROGRAMMA, distinto dalla disponibilità (0011) e dal
-- `data_status`. §8 ne vuole quattro separati, e questo è il quarto:
-- `retired` significa che lo strumento non esiste più — resta nelle pratiche
-- storiche e non entra nei match nuovi (§160).
alter table public.subsidy_programs
  add column if not exists lifecycle text not null default 'active';
alter table public.subsidy_programs
  drop constraint if exists subsidy_programs_lifecycle_check;
alter table public.subsidy_programs
  add constraint subsidy_programs_lifecycle_check
  check (lifecycle in ('active', 'retired', 'draft'));

create index if not exists idx_subsidy_programs_lifecycle
  on public.subsidy_programs (lifecycle) where active = true;

comment on column public.subsidy_programs.lifecycle is
  'Il programma esiste ancora? Distinto da `availability` (è concedibile oggi?), da `data_status` (quanto è affidabile il dato?) e da `active` (lo mostriamo?). Quattro domande diverse (§8).';
comment on column public.subsidy_programs.current_version_id is
  'Copia DICHIARATA della versione pubblicata. La verità è l''indice unico parziale su subsidy_program_versions; un trigger tiene allineata questa colonna.';


-- ---------------------------------------------------------------------------
-- 25. I TRIGGER `updated_at`
-- ---------------------------------------------------------------------------
drop trigger if exists trg_subsidy_sources_updated on public.subsidy_sources;
create trigger trg_subsidy_sources_updated before update on public.subsidy_sources
  for each row execute function public.set_updated_at();

drop trigger if exists trg_subsidy_versions_updated on public.subsidy_program_versions;
create trigger trg_subsidy_versions_updated before update on public.subsidy_program_versions
  for each row execute function public.set_updated_at();

drop trigger if exists trg_subsidy_calls_updated on public.subsidy_calls;
create trigger trg_subsidy_calls_updated before update on public.subsidy_calls
  for each row execute function public.set_updated_at();

drop trigger if exists trg_subsidy_projects_updated on public.subsidy_projects;
create trigger trg_subsidy_projects_updated before update on public.subsidy_projects
  for each row execute function public.set_updated_at();

drop trigger if exists trg_subsidy_opportunities_updated on public.subsidy_opportunities;
create trigger trg_subsidy_opportunities_updated before update on public.subsidy_opportunities
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 26. LA VERSIONE PUBBLICATA È IMMUTABILE
--
-- §4, §54. Una volta pubblicata, una versione non si modifica: si pubblica la
-- successiva e la precedente diventa `superseded`. Senza questo trigger,
-- l'immutabilità sarebbe una promessa scritta nei commenti — la 0010 e la 0013
-- hanno già insegnato quanto valgono le promesse non applicate.
--
-- ⚠️ SI PUÒ ANCORA CAMBIARE LO STATO (published → superseded/withdrawn) e
--    aggiornare `updated_at`: sono transizioni del ciclo di vita, non
--    riscritture del contenuto. Tutto il resto è bloccato.
--
-- ⚠️ IL `DELETE` NON È VIETATO QUI, ed è deliberato: la 0023 ha insegnato che
--    un divieto scritto in un trigger vale anche per la CASCATA, e vietare la
--    cancellazione renderebbe un programma indistruttibile. A impedire la
--    cancellazione dal client sono i PERMESSI (sezione 32), che è dove doveva
--    stare fin dall'inizio.
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_version_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_frozen boolean;
begin
  if tg_op = 'INSERT' then
    -- Una versione nasce sempre come bozza o pubblicata dal processo di
    -- pubblicazione; `published_at` lo timbra il database.
    if new.status = 'published' and new.published_at is null then
      new.published_at := now();
    end if;
    return new;
  end if;

  v_frozen := old.status in ('published', 'superseded', 'withdrawn');

  if v_frozen then
    if new.program_id      is distinct from old.program_id
       or new.version_number   is distinct from old.version_number
       or new.normalized_content::text is distinct from old.normalized_content::text
       or new.content_hash     is distinct from old.content_hash
       or new.effective_from   is distinct from old.effective_from
       or new.effective_until  is distinct from old.effective_until
       or new.source_snapshot_id is distinct from old.source_snapshot_id
    then
      raise exception 'subsidy_version_immutable: una versione % non si modifica; se ne pubblica un''altra', old.status
        using errcode = 'check_violation';
    end if;
  end if;

  if new.status = 'published' and old.status <> 'published' and new.published_at is null then
    new.published_at := now();
  end if;

  return new;
end $$;

drop trigger if exists trg_subsidy_version_guard on public.subsidy_program_versions;
create trigger trg_subsidy_version_guard
  before insert or update on public.subsidy_program_versions
  for each row execute function public.subsidy_version_guard();

comment on function public.subsidy_version_guard() is
  'Congela il contenuto di una versione non più in bozza. Lo stato può ancora evolvere (published → superseded/withdrawn): è il ciclo di vita, non una riscrittura.';


-- Le REGOLE seguono la versione: se la versione è congelata, non si toccano.
create or replace function public.subsidy_rules_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.subsidy_version_status;
  v_vid    uuid;
  v_del    boolean := tg_op = 'DELETE';
begin
  -- ⚠️ RAMI SEPARATI, e `coalesce(new, old)` sarebbe stato un errore: in
  --    plpgsql l'espressione viene preparata per intero, quindi su un INSERT
  --    nominare `old` — anche solo come secondo argomento di un coalesce —
  --    solleva «record old is not assigned yet». È la stessa trappola annotata
  --    nella 0026 per `crm_touch_last_contact`.
  if v_del then
    v_vid := old.program_version_id;
  else
    v_vid := new.program_version_id;
  end if;

  -- ⚠️ Se la versione non esiste PIÙ siamo dentro una cascata: non è una
  --    scrittura di qualcuno, è la conseguenza di una cancellazione già
  --    autorizzata a monte. È la lezione della 0023 e della 0028.
  select status into v_status
    from public.subsidy_program_versions where id = v_vid;

  if found and v_status <> 'draft' then
    raise exception 'subsidy_rules_immutable: i criteri di una versione % non si modificano', v_status
      using errcode = 'check_violation';
  end if;

  if v_del then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists trg_subsidy_rules_guard on public.subsidy_program_rules;
create trigger trg_subsidy_rules_guard
  before insert or update or delete on public.subsidy_program_rules
  for each row execute function public.subsidy_rules_guard();


-- Quando una versione viene pubblicata, le altre dello stesso programma
-- diventano `superseded` e la colonna denormalizzata si allinea.
-- ⚠️ `after` e non `before`: l'indice unico parziale deve poter respingere due
--    pubblicazioni concorrenti PRIMA che questa funzione ne declassi una.
create or replace function public.subsidy_version_published()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_was_published boolean := false;
begin
  -- ⚠️ `old` si legge in un ramo che gira SOLO su UPDATE: nominarlo dentro
  --    un'espressione insieme a `tg_op` lo farebbe valutare anche su INSERT.
  if tg_op = 'UPDATE' then
    v_was_published := old.status = 'published';
  end if;

  if new.status <> 'published' then
    -- Se la corrente smette di esserlo, la colonna denormalizzata non deve
    -- continuare a indicarla.
    if v_was_published then
      update public.subsidy_programs
         set current_version_id = null
       where id = new.program_id and current_version_id = new.id;
    end if;
    return null;
  end if;

  update public.subsidy_program_versions
     set status = 'superseded'
   where program_id = new.program_id
     and id <> new.id
     and status = 'published';

  update public.subsidy_programs
     set current_version_id = new.id
   where id = new.program_id;

  return null;
end $$;

drop trigger if exists trg_subsidy_version_published on public.subsidy_program_versions;
create trigger trg_subsidy_version_published
  after insert or update of status on public.subsidy_program_versions
  for each row execute function public.subsidy_version_published();


-- ---------------------------------------------------------------------------
-- 27. LA PROSSIMA VERIFICA DI UNA FONTE
--
-- §24 — la frequenza dipende dal tipo di dato, e vive nella riga. Qui si
-- calcola soltanto QUANDO tocca di nuovo, e solo dopo un controllo RIUSCITO:
-- un errore non sposta la scadenza in avanti, altrimenti una fonte rotta
-- verrebbe controllata sempre più di rado proprio mentre serve guardarla.
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_source_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.allowed_host := lower(btrim(coalesce(new.allowed_host, '')));

  if new.allowed_host = '' then
    raise exception 'subsidy_source_host_required: una fonte senza allowed_host non è controllabile in sicurezza'
      using errcode = 'check_violation';
  end if;
  if new.canonical_url !~* '^https://' then
    raise exception 'subsidy_source_https_required: le fonti si leggono solo in HTTPS'
      using errcode = 'check_violation';
  end if;

  -- ⚠️ `old` solo dentro un ramo riservato agli UPDATE, mai in un'espressione
  --    che gira anche su INSERT.
  if tg_op = 'UPDATE' then
    if new.last_successful_check_at is distinct from old.last_successful_check_at
       and new.last_successful_check_at is not null then
      new.next_check_at := new.last_successful_check_at + make_interval(days => new.check_frequency_days);
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_subsidy_source_guard on public.subsidy_sources;
create trigger trg_subsidy_source_guard
  before insert or update on public.subsidy_sources
  for each row execute function public.subsidy_source_guard();

comment on function public.subsidy_source_guard() is
  'Normalizza allowed_host, impone HTTPS, e sposta next_check_at solo dopo un controllo RIUSCITO: un errore non allontana la prossima verifica (§159).';


-- ---------------------------------------------------------------------------
-- 28. IL PROGETTO — RESPONSABILE, TIMBRI, ARCHIVIAZIONE
--
-- §31, §145, §146. Il responsabile dev'essere membro della stessa azienda, e a
-- garantirlo è il database. `created_by`, `archived_at/by` li scrive il
-- trigger: un client che li passasse verrebbe ignorato, ma la sezione 32 gli
-- toglie proprio il permesso di colonna, che è la difesa vera.
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_projects_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor boolean := auth.uid() is not null;
  -- ⚠️ Lo stato PRECEDENTE si legge una volta sola, dentro il ramo degli
  --    UPDATE, e poi si usa una variabile. Nominare `old` in un'espressione
  --    insieme a `tg_op` la farebbe valutare anche su INSERT, dove `old` non è
  --    assegnata: è la trappola annotata nella 0026.
  v_was_archived boolean := false;
begin
  if tg_op = 'INSERT' then
    if v_actor then
      new.created_by := auth.uid();
    end if;
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    v_was_archived := old.status = 'archived';
  end if;

  -- §31/§145 — il responsabile è membro della stessa azienda. È il controllo
  -- che la 0016 fa su `tasks.assignee_user_id` e la 0024 sui contratti.
  if new.owner_user_id is not null then
    if not exists (
      select 1 from public.company_members m
       where m.company_id = new.company_id and m.user_id = new.owner_user_id
    ) then
      raise exception 'subsidy_project_owner_not_member: il responsabile non è membro di questa azienda'
        using errcode = 'check_violation';
    end if;
  end if;

  -- L'archiviazione si timbra da sé; il client scrive solo `status`.
  if new.status = 'archived' and not v_was_archived then
    new.archived_at := now();
    new.archived_by := auth.uid();
  elsif new.status = 'active' then
    new.archived_at := null;
    new.archived_by := null;
  end if;

  -- Le date incoerenti si rifiutano all'ingresso: una fine prima dell'inizio
  -- produrrebbe una durata negativa in ogni criterio che la guarda.
  if new.estimated_start_date is not null and new.estimated_end_date is not null
     and new.estimated_end_date < new.estimated_start_date then
    raise exception 'subsidy_project_dates_inverted: la fine prevista precede l''inizio'
      using errcode = 'check_violation';
  end if;

  -- ⚠️ §67 — un importo senza valuta non è un importo: non si assume CHF
  --    perché l'app è svizzera. È la stessa regola di `validate.ts` e del
  --    cruscotto di Finanze, che lascia il totale a null invece di sommare
  --    valute diverse.
  if new.budget_amount is not null and new.budget_currency is null then
    raise exception 'subsidy_project_currency_required: un importo richiede la valuta (nessun CHF d''ufficio)'
      using errcode = 'check_violation';
  end if;

  return new;
end $$;

drop trigger if exists trg_subsidy_projects_guard on public.subsidy_projects;
create trigger trg_subsidy_projects_guard
  before insert or update on public.subsidy_projects
  for each row execute function public.subsidy_projects_guard();


-- ---------------------------------------------------------------------------
-- 29. I COLLEGAMENTI NON ATTRAVERSANO LE AZIENDE
--
-- §144, §189. Un documento di un'altra impresa non si collega a un progetto o a
-- una pratica di questa. La RLS da sola non basta: `documents` è filtrata in
-- lettura, ma un `insert` con un id indovinato non passa da una `select`. Il
-- controllo esplicito è la difesa — la stessa lezione della 0017, dove una
-- funzione `security definer` doveva difendersi da sola invece di fidarsi di
-- una policy scritta altrove.
-- ---------------------------------------------------------------------------
-- ⚠️ TRE FUNZIONI ESPLICITE e non una generica che ispeziona `to_jsonb(new)`.
--    Una guardia «universale» che scopre a runtime quali colonne esistono si
--    rompe in silenzio nel momento in cui una colonna viene rinominata: non
--    trova più il campo, non controlla più niente, e nessun test lo vede. Qui
--    ogni funzione nomina le proprie colonne, e un rename fa fallire la
--    creazione della funzione.
create or replace function public.subsidy_document_link_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc_company uuid;
begin
  select company_id into v_doc_company
    from public.documents where id = new.document_id;
  if not found or v_doc_company is distinct from new.company_id then
    raise exception 'subsidy_link_cross_tenant: il documento non appartiene a questa azienda'
      using errcode = 'check_violation';
  end if;

  if auth.uid() is not null then
    new.added_by := auth.uid();
  end if;
  return new;
end $$;

comment on function public.subsidy_document_link_guard() is
  'Impedisce che un documento di un''altra azienda venga collegato a un progetto o a una pratica (§144, §189). Un insert non passa da una select, quindi la RLS da sola non lo fermerebbe.';

create or replace function public.subsidy_partner_link_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_company uuid;
begin
  select company_id into v_org_company
    from public.crm_organizations where id = new.organization_id;
  if not found or v_org_company is distinct from new.company_id then
    raise exception 'subsidy_link_cross_tenant: la controparte non appartiene a questa azienda'
      using errcode = 'check_violation';
  end if;

  if auth.uid() is not null then
    new.added_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists trg_subsidy_project_docs_guard on public.subsidy_project_documents;
create trigger trg_subsidy_project_docs_guard
  before insert or update on public.subsidy_project_documents
  for each row execute function public.subsidy_document_link_guard();

drop trigger if exists trg_subsidy_project_partners_guard on public.subsidy_project_partners;
create trigger trg_subsidy_project_partners_guard
  before insert or update on public.subsidy_project_partners
  for each row execute function public.subsidy_partner_link_guard();

drop trigger if exists trg_subsidy_case_docs_guard on public.subsidy_case_documents;
create trigger trg_subsidy_case_docs_guard
  before insert or update on public.subsidy_case_documents
  for each row execute function public.subsidy_document_link_guard();


-- Il progetto collegato dev'essere della stessa azienda del collegamento.
create or replace function public.subsidy_project_child_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company
    from public.subsidy_projects where id = new.project_id;
  if not found or v_company is distinct from new.company_id then
    raise exception 'subsidy_project_cross_tenant: il progetto non appartiene a questa azienda'
      using errcode = 'check_violation';
  end if;
  return new;
end $$;

drop trigger if exists trg_subsidy_project_docs_owner on public.subsidy_project_documents;
create trigger trg_subsidy_project_docs_owner
  before insert or update on public.subsidy_project_documents
  for each row execute function public.subsidy_project_child_guard();

drop trigger if exists trg_subsidy_project_partners_owner on public.subsidy_project_partners;
create trigger trg_subsidy_project_partners_owner
  before insert or update on public.subsidy_project_partners
  for each row execute function public.subsidy_project_child_guard();


-- ---------------------------------------------------------------------------
-- 30. L'INTERPRETAZIONE È IMMUTABILE E SI NUMERA DA SÉ
--
-- §34. La versione la sceglie il database: due interpretazioni chieste nello
-- stesso istante da due schede aperte non possono ricevere lo stesso numero.
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_interpretation_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if tg_op = 'UPDATE' then
    raise exception 'subsidy_interpretation_immutable: un''interpretazione non si modifica; se ne crea una nuova'
      using errcode = 'check_violation';
  end if;

  select company_id into v_company
    from public.subsidy_projects where id = new.project_id;
  if not found or v_company is distinct from new.company_id then
    raise exception 'subsidy_project_cross_tenant: il progetto non appartiene a questa azienda'
      using errcode = 'check_violation';
  end if;

  if new.version is null or new.version < 1 then
    select coalesce(max(version), 0) + 1 into new.version
      from public.subsidy_project_interpretations where project_id = new.project_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_subsidy_interpretation_guard on public.subsidy_project_interpretations;
create trigger trg_subsidy_interpretation_guard
  before insert or update on public.subsidy_project_interpretations
  for each row execute function public.subsidy_interpretation_guard();


-- ---------------------------------------------------------------------------
-- 31. LE RISPOSTE SONO APPEND-ONLY E FIRMATE DAL DATABASE
--
-- §93, §146, §187. Chi risponde è `auth.uid()`, sempre. La 0016 aveva
-- imparato che RISCRIVERE in silenzio l'autore è un fallback silenzioso: chi
-- prova a firmare per un collega riceve un rifiuto, non un «inserito».
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_answers_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if tg_op <> 'INSERT' then
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


-- ---------------------------------------------------------------------------
-- 32. L'OPPORTUNITÀ — TIMBRI E COERENZA
--
-- ⚠️ Il client può fare TRE cose su un'opportunità: salvarla, metterla da
--    parte, riaprirla. Tutto il resto — le sei misure, i conteggi, la
--    valutazione corrente — lo scrive il motore, e la sezione 33 gli toglie il
--    permesso di colonna su ciò che non gli spetta.
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_opportunity_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_company uuid;
  -- ⚠️ `old` si legge una volta, nel ramo degli UPDATE.
  v_was_dismissed boolean := false;
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
    new.project_id := old.project_id;
    new.program_id := old.program_id;
    new.program_version_id := old.program_version_id;
    new.created_at := old.created_at;
    new.first_matched_at := old.first_matched_at;
    v_was_dismissed := old.dismissed_reason is not null;
  end if;

  if new.project_id is not null then
    select company_id into v_project_company
      from public.subsidy_projects where id = new.project_id;
    if not found or v_project_company is distinct from new.company_id then
      raise exception 'subsidy_project_cross_tenant: il progetto non appartiene a questa azienda'
        using errcode = 'check_violation';
    end if;
  end if;

  -- `kind` deriva dalla presenza del progetto: due colonne che possono
  -- contraddirsi producono due elenchi diversi nella stessa schermata.
  if new.project_id is null then
    new.kind := 'general';
  else
    new.kind := 'project';
  end if;

  -- I timbri del «metti da parte». Li scrive il database perché sono la prova
  -- che l'utente ha scelto, e una prova che il client può scrivere non è una
  -- prova (§146).
  if new.dismissed_reason is not null and not v_was_dismissed then
    new.dismissed_at := now();
    new.dismissed_by := auth.uid();
    new.reopen_suggested_at := null;
  elsif new.dismissed_reason is null then
    new.dismissed_at := null;
    new.dismissed_by := null;
    new.dismissed_note := null;
  end if;

  return new;
end $$;

drop trigger if exists trg_subsidy_opportunity_guard on public.subsidy_opportunities;
create trigger trg_subsidy_opportunity_guard
  before insert or update on public.subsidy_opportunities
  for each row execute function public.subsidy_opportunity_guard();


-- ---------------------------------------------------------------------------
-- 33. LA VALUTAZIONE È APPEND-ONLY E SI NUMERA DA SÉ
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_assessment_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  if tg_op = 'UPDATE' then
    raise exception 'subsidy_assessment_append_only: una valutazione non si modifica; se ne registra un''altra'
      using errcode = 'check_violation';
  end if;

  select company_id into v_company
    from public.subsidy_opportunities where id = new.opportunity_id;
  if not found or v_company is distinct from new.company_id then
    raise exception 'subsidy_opportunity_cross_tenant: l''opportunità non appartiene a questa azienda'
      using errcode = 'check_violation';
  end if;

  if new.version is null or new.version < 1 then
    select coalesce(max(version), 0) + 1 into new.version
      from public.subsidy_assessments where opportunity_id = new.opportunity_id;
  end if;

  return new;
end $$;

drop trigger if exists trg_subsidy_assessment_guard on public.subsidy_assessments;
create trigger trg_subsidy_assessment_guard
  before insert or update on public.subsidy_assessments
  for each row execute function public.subsidy_assessment_guard();


-- La valutazione appena scritta diventa la corrente, e l'opportunità smette di
-- essere «da aggiornare».
-- ⚠️ `after` e non `before`: la riga dev'essere già scritta perché
--    `current_assessment_id` possa puntarla senza violare la chiave esterna.
create or replace function public.subsidy_assessment_applied()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.subsidy_opportunities
     set current_assessment_id = new.id,
         assessment_version    = new.version,
         relevance_level       = new.relevance_level,
         relevance_score       = new.relevance_score,
         eligibility_status    = new.eligibility_status,
         completeness          = new.completeness,
         timing                = new.timing,
         source_freshness      = new.source_freshness,
         call_id               = new.call_id,
         last_fingerprint      = new.fingerprint,
         last_assessed_at      = new.created_at,
         assessment_stale      = false,
         missing_fact_count    = coalesce(jsonb_array_length(new.missing_facts), 0)
   where id = new.opportunity_id;

  update public.subsidy_opportunities o
     set open_criteria_count = (
           select count(*) from public.subsidy_criterion_results r
            where r.assessment_id = new.id
              and r.state in ('unknown', 'conflicting', 'not_evaluable')
         )
   where o.id = new.opportunity_id;

  return null;
end $$;

drop trigger if exists trg_subsidy_assessment_applied on public.subsidy_assessments;
create trigger trg_subsidy_assessment_applied
  after insert on public.subsidy_assessments
  for each row execute function public.subsidy_assessment_applied();


-- ---------------------------------------------------------------------------
-- 34. LA PRATICA — RESPONSABILE, INVIO, ESITO
--
-- ⚠️ `submitted_at` e `submitted_by` li timbra il database quando lo stato
--    passa a `submitted`. §107: significa che una persona ha registrato
--    l'invio. Non esiste alcun percorso che lo scriva da solo.
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_case_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_project_company uuid;
  v_opp_company     uuid;
  -- ⚠️ `old` si legge una volta, nel ramo degli UPDATE.
  v_was_submitted boolean := false;
  v_was_archived  boolean := false;
begin
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- L'istantanea con cui la pratica è nata NON si riscrive: è tutto il suo
    -- valore (§109, §188).
    new.program_snapshot := old.program_snapshot;
    new.snapshot_hash    := old.snapshot_hash;
    new.program_version_id := old.program_version_id;
    new.legacy_snapshot  := old.legacy_snapshot;
    v_was_submitted := old.status = 'submitted';
    v_was_archived  := old.archived_at is not null;
  end if;

  if new.owner_user_id is not null then
    if not exists (
      select 1 from public.company_members m
       where m.company_id = new.company_id and m.user_id = new.owner_user_id
    ) then
      raise exception 'subsidy_case_owner_not_member: il responsabile non è membro di questa azienda'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.project_id is not null then
    select company_id into v_project_company
      from public.subsidy_projects where id = new.project_id;
    if not found or v_project_company is distinct from new.company_id then
      raise exception 'subsidy_project_cross_tenant: il progetto non appartiene a questa azienda'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.opportunity_id is not null then
    select company_id into v_opp_company
      from public.subsidy_opportunities where id = new.opportunity_id;
    if not found or v_opp_company is distinct from new.company_id then
      raise exception 'subsidy_opportunity_cross_tenant: l''opportunità non appartiene a questa azienda'
        using errcode = 'check_violation';
    end if;
  end if;

  -- §107 — l'invio lo registra una persona, e il database lo timbra.
  if new.status = 'submitted' and not v_was_submitted then
    new.submitted_at := now();
    new.submitted_by := auth.uid();
  end if;

  -- ⚠️ Un esito registrato richiede uno stato coerente: dire «approvata» su una
  --    pratica in bozza sarebbe un dato che si contraddice da solo.
  if new.outcome <> 'unknown' and new.status in ('draft', 'assessing', 'collecting_documents') then
    raise exception 'subsidy_case_outcome_without_submission: un esito richiede una pratica inviata'
      using errcode = 'check_violation';
  end if;

  -- ⚠️ §70 — un importo assegnato senza valuta non è un importo.
  if (new.amount_requested is not null or new.amount_awarded is not null) and new.currency is null then
    raise exception 'subsidy_case_currency_required: un importo richiede la valuta (nessuna conversione, nessun CHF d''ufficio)'
      using errcode = 'check_violation';
  end if;

  if new.archived_at is null and v_was_archived then
    new.archived_by := null;
  end if;

  return new;
end $$;

drop trigger if exists trg_subsidy_case_guard on public.subsidy_cases;
create trigger trg_subsidy_case_guard
  before insert or update on public.subsidy_cases
  for each row execute function public.subsidy_case_guard();


-- La checklist: i timbri del completamento li scrive il database, come per le
-- azioni dell'analisi documentale (0010) e le attività (0016).
create or replace function public.subsidy_case_item_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  -- ⚠️ `old` si legge una volta, nel ramo degli UPDATE.
  v_was_completed boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_was_completed := old.completed;
  end if;

  select company_id into v_company
    from public.subsidy_cases where id = new.subsidy_case_id;
  if not found then
    raise exception 'subsidy_case_missing: la pratica non esiste'
      using errcode = 'foreign_key_violation';
  end if;
  new.company_id := v_company;

  if new.document_id is not null then
    if not exists (
      select 1 from public.documents d
       where d.id = new.document_id and d.company_id = v_company
    ) then
      raise exception 'subsidy_link_cross_tenant: il documento non appartiene a questa azienda'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.task_id is not null then
    if not exists (
      select 1 from public.tasks t
       where t.id = new.task_id and t.company_id = v_company
    ) then
      raise exception 'subsidy_link_cross_tenant: l''attività non appartiene a questa azienda'
        using errcode = 'check_violation';
    end if;
  end if;

  if new.completed and not v_was_completed then
    new.completed_at := now();
    new.completed_by := auth.uid();
  elsif not new.completed then
    new.completed_at := null;
    new.completed_by := null;
  end if;

  return new;
end $$;

drop trigger if exists trg_subsidy_case_item_guard on public.subsidy_case_items;
create trigger trg_subsidy_case_item_guard
  before insert or update on public.subsidy_case_items
  for each row execute function public.subsidy_case_item_guard();


-- ---------------------------------------------------------------------------
-- 35. LO STORICO DELLA PRATICA — E LA CASCATA
--
-- §122. Lo scrivono i trigger. ⚠️ OGNI TRIGGER CHE INSERISCE DURANTE UNA
-- CANCELLAZIONE DEVE VERIFICARE CHE I GENITORI ESISTANO ANCORA: è il difetto
-- della 0028 (un'azienda con una controparte diventava indistruttibile) e della
-- 0025, e si ripresenta identico qui — `subsidy_case_documents` ha un trigger
-- `after delete`, e senza il controllo una richiesta di cancellazione dei dati
-- fallirebbe in blocco.
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_log_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- ⚠️ VARIABILE TIPIZZATA e non un `case` fra letterali: quando tutti i rami
  --    di un `case` sono letterali senza tipo, Postgres risolve l'espressione
  --    come `text` e da `text` a un enum non esiste conversione implicita
  --    (42804, 0022 e 0025).
  v_kind public.subsidy_case_event_kind;
begin
  if tg_op = 'INSERT' then
    insert into public.subsidy_case_events (company_id, subsidy_case_id, kind, detail, actor_user_id)
    values (new.company_id, new.id, 'case_created',
            jsonb_build_object('programId', new.program_id,
                               'projectId', new.project_id,
                               'legacySnapshot', new.legacy_snapshot),
            auth.uid());
    return null;
  end if;

  if new.status is distinct from old.status then
    v_kind := 'status_changed';
    if new.status = 'submitted' then
      v_kind := 'submitted';
    end if;
    insert into public.subsidy_case_events (company_id, subsidy_case_id, kind, detail, actor_user_id)
    values (new.company_id, new.id, v_kind,
            jsonb_build_object('from', old.status, 'to', new.status), auth.uid());
  end if;

  if new.owner_user_id is distinct from old.owner_user_id then
    insert into public.subsidy_case_events (company_id, subsidy_case_id, kind, detail, actor_user_id)
    values (new.company_id, new.id, 'owner_changed',
            jsonb_build_object('to', new.owner_user_id), auth.uid());
  end if;

  if new.outcome is distinct from old.outcome and new.outcome <> 'unknown' then
    insert into public.subsidy_case_events (company_id, subsidy_case_id, kind, detail, actor_user_id)
    values (new.company_id, new.id, 'outcome_recorded',
            jsonb_build_object('outcome', new.outcome,
                               'documented', new.outcome_document_id is not null),
            auth.uid());
  end if;

  if new.source_changed_at is distinct from old.source_changed_at and new.source_changed_at is not null then
    insert into public.subsidy_case_events (company_id, subsidy_case_id, kind, detail, actor_user_id)
    values (new.company_id, new.id, 'source_changed', '{}'::jsonb, null);
  end if;

  if new.archived_at is distinct from old.archived_at and new.archived_at is not null then
    insert into public.subsidy_case_events (company_id, subsidy_case_id, kind, detail, actor_user_id)
    values (new.company_id, new.id, 'archived', '{}'::jsonb, auth.uid());
  end if;

  return null;
end $$;

drop trigger if exists trg_subsidy_log_case on public.subsidy_cases;
create trigger trg_subsidy_log_case
  after insert or update on public.subsidy_cases
  for each row execute function public.subsidy_log_case();


create or replace function public.subsidy_log_case_document()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case uuid;
  v_company uuid;
  v_kind public.subsidy_case_event_kind;
begin
  if tg_op = 'DELETE' then
    v_case := old.subsidy_case_id;
    v_company := old.company_id;
    v_kind := 'document_unlinked';
  else
    v_case := new.subsidy_case_id;
    v_company := new.company_id;
    v_kind := 'document_linked';
  end if;

  -- ⚠️ LA PROTEZIONE DALLA CASCATA. Se l'azienda o la pratica non esistono più,
  --    siamo dentro la cancellazione di un genitore: scrivere qui violerebbe la
  --    chiave esterna e farebbe fallire l'INTERA cancellazione, rendendo
  --    l'azienda indistruttibile. Due controlli e non uno, perché cancellare
  --    una singola pratica lascia l'azienda in piedi (0028).
  if not exists (select 1 from public.companies where id = v_company) then
    return null;
  end if;
  if not exists (select 1 from public.subsidy_cases where id = v_case) then
    return null;
  end if;

  insert into public.subsidy_case_events (company_id, subsidy_case_id, kind, detail, actor_user_id)
  values (v_company, v_case, v_kind,
          jsonb_build_object('relation', coalesce(new.relation_type, old.relation_type)),
          auth.uid());
  return null;
end $$;

drop trigger if exists trg_subsidy_log_case_document on public.subsidy_case_documents;
create trigger trg_subsidy_log_case_document
  after insert or delete on public.subsidy_case_documents
  for each row execute function public.subsidy_log_case_document();


create or replace function public.subsidy_log_case_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind public.subsidy_case_event_kind;
begin
  if new.completed is not distinct from old.completed then
    return null;
  end if;

  if not exists (select 1 from public.companies where id = new.company_id) then
    return null;
  end if;
  if not exists (select 1 from public.subsidy_cases where id = new.subsidy_case_id) then
    return null;
  end if;

  v_kind := 'checklist_reopened';
  if new.completed then
    v_kind := 'checklist_completed';
  end if;

  insert into public.subsidy_case_events (company_id, subsidy_case_id, kind, detail, actor_user_id)
  values (new.company_id, new.subsidy_case_id, v_kind,
          jsonb_build_object('itemId', new.id, 'required', new.required), auth.uid());
  return null;
end $$;

drop trigger if exists trg_subsidy_log_case_item on public.subsidy_case_items;
create trigger trg_subsidy_log_case_item
  after update of completed on public.subsidy_case_items
  for each row execute function public.subsidy_log_case_item();


-- ---------------------------------------------------------------------------
-- 36. GLI INNESCHI DELLE AUTOMAZIONI
--
-- §125. Sette inneschi, e ognuno ha un produttore vero: quattro qui, tre nel
-- worker (`subsidy_deadline_approaching`, `subsidy_assessment_became_stale`,
-- `subsidy_source_critical_change`), che sono scansioni periodiche e non fatti
-- puntuali.
--
-- ⚠️ I letterali dei valori aggiunti alla sezione 1 compaiono SOLO qui dentro,
--    nei corpi delle funzioni: Postgres li deposita come testo e li risolve
--    alla prima esecuzione. È l'eccezione dichiarata alla trappola 55P04, la
--    stessa che la 0026 usa per i propri sei inneschi.
--
-- ⚠️ NESSUN INNESCO SU UN PUNTEGGIO. `subsidy_opportunity_high_relevance` è un
--    SUPERAMENTO DI SOGLIA, deduplicato per opportunità: scatta una volta,
--    quando la rilevanza diventa alta, e non a ogni giro del worker. Un evento
--    per ogni rivalutazione produrrebbe una notifica ogni cinque minuti su
--    dati che non sono cambiati — cioè lo spam che §81 vieta.
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_emit_opportunity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- ⚠️ `old` si legge una volta, nel ramo degli UPDATE: nominarlo in
  --    un'espressione insieme a `tg_op` lo farebbe valutare anche su INSERT.
  v_was_high boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_was_high := old.relevance_level = 'high';
  end if;

  if tg_op = 'INSERT' then
    perform public.automation_emit(
      new.company_id, 'subsidy_opportunity_created', 'subsidy_opportunity', new.id,
      jsonb_build_object('programId', new.program_id, 'projectId', new.project_id,
                         'kind', new.kind),
      'subsidy:opp:' || new.id::text || ':created',
      new.workflow_run_id
    );
  end if;

  if new.relevance_level = 'high'
     and not v_was_high
     and new.dismissed_at is null then
    perform public.automation_emit(
      new.company_id, 'subsidy_opportunity_high_relevance', 'subsidy_opportunity', new.id,
      jsonb_build_object('programId', new.program_id, 'projectId', new.project_id,
                         'eligibility', new.eligibility_status),
      'subsidy:opp:' || new.id::text || ':high',
      new.workflow_run_id
    );
  end if;

  return null;
end $$;

drop trigger if exists trg_subsidy_emit_opportunity on public.subsidy_opportunities;
create trigger trg_subsidy_emit_opportunity
  after insert or update of relevance_level on public.subsidy_opportunities
  for each row execute function public.subsidy_emit_opportunity();


create or replace function public.subsidy_emit_case_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status is not distinct from old.status then
    return null;
  end if;
  perform public.automation_emit(
    new.company_id, 'subsidy_case_status_changed', 'subsidy_case', new.id,
    jsonb_build_object('from', old.status, 'to', new.status,
                       'programId', new.program_id),
    'subsidy:case:' || new.id::text || ':status:' || new.status::text,
    new.workflow_run_id
  );
  return null;
end $$;

drop trigger if exists trg_subsidy_emit_case_status on public.subsidy_cases;
create trigger trg_subsidy_emit_case_status
  after update of status on public.subsidy_cases
  for each row execute function public.subsidy_emit_case_status();


-- L'apertura di una call riguarda TUTTE le imprese che hanno un'opportunità su
-- quel programma. ⚠️ Un evento per azienda, non uno globale: il motore delle
-- automazioni lavora per azienda, e un evento senza `company_id` non troverebbe
-- alcuna regola.
create or replace function public.subsidy_emit_call_opened()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
  -- ⚠️ `old` si legge una volta, nel ramo degli UPDATE.
  v_was_open boolean := false;
begin
  if tg_op = 'UPDATE' then
    v_was_open := old.status = 'open';
  end if;

  if new.status <> 'open' then
    return null;
  end if;
  if v_was_open then
    return null;
  end if;

  for v_row in
    select distinct o.company_id, o.id as opportunity_id
      from public.subsidy_opportunities o
     where o.program_id = new.program_id
       and o.dismissed_at is null
       and (o.call_id is null or o.call_id = new.id)
  loop
    perform public.automation_emit(
      v_row.company_id, 'subsidy_call_opened', 'subsidy_opportunity', v_row.opportunity_id,
      jsonb_build_object('programId', new.program_id, 'callId', new.id),
      'subsidy:call:' || new.id::text || ':opened:' || v_row.opportunity_id::text,
      null
    );
  end loop;

  return null;
end $$;

drop trigger if exists trg_subsidy_emit_call_opened on public.subsidy_calls;
create trigger trg_subsidy_emit_call_opened
  after insert or update of status on public.subsidy_calls
  for each row execute function public.subsidy_emit_call_opened();


-- ---------------------------------------------------------------------------
-- 37. QUANDO IL CATALOGO CAMBIA, LE VALUTAZIONI DIVENTANO «DA AGGIORNARE»
--
-- §57, §59. Non si rivaluta tutto dentro la transazione che pubblica una
-- versione: §78 lo vieta, e con mille imprese sarebbe una richiesta che non
-- finisce. Si MARCA, e il worker riprende il lavoro a lotti.
--
-- ⚠️ `assessment_stale = true` NON nasconde l'opportunità e non ne cambia le
--    misure: la schermata dice «valutazione da aggiornare» accanto ai valori
--    di ieri, che restano quelli veri fino alla prossima esecuzione. Cancellarli
--    lascerebbe una schermata vuota dove prima c'erano informazioni buone.
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_mark_stale_on_version()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'published' then
    return null;
  end if;

  update public.subsidy_opportunities
     set assessment_stale = true
   where program_id = new.program_id
     and program_version_id <> new.id
     and dismissed_at is null;

  return null;
end $$;

drop trigger if exists trg_subsidy_mark_stale_version on public.subsidy_program_versions;
create trigger trg_subsidy_mark_stale_version
  after insert or update of status on public.subsidy_program_versions
  for each row execute function public.subsidy_mark_stale_on_version();


create or replace function public.subsidy_mark_stale_on_call()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ⚠️ `old` solo dentro il ramo degli UPDATE. Su INSERT una call è sempre una
  --    novità e le opportunità del programma vanno rivalutate.
  if tg_op = 'UPDATE' then
    if new.status is not distinct from old.status
       and new.deadline_on is not distinct from old.deadline_on
       and new.deadline_at is not distinct from old.deadline_at then
      return null;
    end if;
  end if;

  update public.subsidy_opportunities
     set assessment_stale = true
   where program_id = new.program_id
     and dismissed_at is null;

  -- §110 — una pratica aperta su questa call deve poter mostrare il confronto
  -- fra i dati con cui è nata e quelli correnti. Si segna il momento; il
  -- confronto lo compone la schermata dall'istantanea, che NON si tocca.
  update public.subsidy_cases
     set source_changed_at = now()
   where call_id = new.id
     and archived_at is null
     and status not in ('closed', 'submitted');

  return null;
end $$;

drop trigger if exists trg_subsidy_mark_stale_call on public.subsidy_calls;
create trigger trg_subsidy_mark_stale_call
  after insert or update on public.subsidy_calls
  for each row execute function public.subsidy_mark_stale_on_call();


-- Un progetto modificato rende «da aggiornare» solo le SUE opportunità.
create or replace function public.subsidy_mark_stale_on_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage is not distinct from old.stage
     and new.project_types is not distinct from old.project_types
     and new.location_canton is not distinct from old.location_canton
     and new.sector is not distinct from old.sector
     and new.budget_amount is not distinct from old.budget_amount
     and new.budget_currency is not distinct from old.budget_currency
     and new.employee_impact is not distinct from old.employee_impact
     and new.has_research_partner is not distinct from old.has_research_partner
     and new.has_innovation_partner is not distinct from old.has_innovation_partner
     and new.has_international_partners is not distinct from old.has_international_partners
     and new.estimated_start_date is not distinct from old.estimated_start_date
     and new.status is not distinct from old.status then
    return null;
  end if;

  update public.subsidy_opportunities
     set assessment_stale = true
   where project_id = new.id;

  return null;
end $$;

drop trigger if exists trg_subsidy_mark_stale_project on public.subsidy_projects;
create trigger trg_subsidy_mark_stale_project
  after update on public.subsidy_projects
  for each row execute function public.subsidy_mark_stale_on_project();


-- Una risposta nuova rende «da aggiornare» le opportunità su quella versione.
create or replace function public.subsidy_mark_stale_on_answer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.subsidy_opportunities
     set assessment_stale = true
   where company_id = new.company_id
     and program_version_id = new.program_version_id
     and (new.project_id is null or project_id = new.project_id)
     and dismissed_at is null;
  return null;
end $$;

drop trigger if exists trg_subsidy_mark_stale_answer on public.subsidy_answers;
create trigger trg_subsidy_mark_stale_answer
  after insert on public.subsidy_answers
  for each row execute function public.subsidy_mark_stale_on_answer();


-- ---------------------------------------------------------------------------
-- 38. LA PRONTEZZA SI CALCOLA DALLA PRATICA
--
-- §43. `readiness` non è un campo che qualcuno compila: è ciò che risulta dalla
-- pratica collegata. Senza pratica è `not_started`; con una pratica in
-- lavorazione è `in_preparation`; con la checklist obbligatoria completa è
-- `ready`; dopo l'invio è `submitted`.
--
-- ⚠️ `ready` NON significa «i criteri sono soddisfatti»: significa che il
--    lavoro di preparazione è finito. Sono due misure diverse, ed è tutta la
--    differenza fra prontezza e idoneità.
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_refresh_readiness(p_case_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case      record;
  v_open      integer;
  v_readiness public.subsidy_readiness;
begin
  select * into v_case from public.subsidy_cases where id = p_case_id;
  if not found or v_case.opportunity_id is null then
    return;
  end if;

  select count(*) into v_open
    from public.subsidy_case_items
   where subsidy_case_id = p_case_id and required = true and completed = false;

  if v_case.status in ('submitted', 'under_review', 'approved', 'rejected') then
    v_readiness := 'submitted';
  elsif v_open = 0 then
    v_readiness := 'ready';
  else
    v_readiness := 'in_preparation';
  end if;

  update public.subsidy_opportunities
     set readiness = v_readiness
   where id = v_case.opportunity_id
     and readiness is distinct from v_readiness;
end $$;

create or replace function public.subsidy_touch_readiness()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_case uuid;
begin
  if tg_op = 'DELETE' then
    v_case := old.subsidy_case_id;
  else
    v_case := new.subsidy_case_id;
  end if;

  -- Protezione dalla cascata, di nuovo: durante la cancellazione di una
  -- pratica non c'è nulla da ricalcolare.
  if not exists (select 1 from public.subsidy_cases where id = v_case) then
    return null;
  end if;

  perform public.subsidy_refresh_readiness(v_case);
  return null;
end $$;

drop trigger if exists trg_subsidy_readiness_items on public.subsidy_case_items;
create trigger trg_subsidy_readiness_items
  after insert or update of completed, required or delete on public.subsidy_case_items
  for each row execute function public.subsidy_touch_readiness();

create or replace function public.subsidy_touch_readiness_case()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.subsidy_refresh_readiness(new.id);
  return null;
end $$;

drop trigger if exists trg_subsidy_readiness_case on public.subsidy_cases;
create trigger trg_subsidy_readiness_case
  after insert or update of status, opportunity_id on public.subsidy_cases
  for each row execute function public.subsidy_touch_readiness_case();


-- ---------------------------------------------------------------------------
-- 39. LE FUNZIONI DI LETTURA
--
-- ⚠️ TUTTE `SECURITY INVOKER`, e non è un dettaglio: sono le funzioni che
--    l'assistente aziendale chiamerà con il client dell'UTENTE. Con il ruolo di
--    servizio la RLS sparirebbe e restituirebbero i dati di chiunque — è la
--    regola scritta nella 0027 e vale identica qui.
--
-- ⚠️ `p_company_id` è un PARAMETRO ma non è un permesso: passare l'azienda di
--    un altro non restituisce nulla, perché la RLS filtra comunque. Il test lo
--    verifica chiamando con l'id altrui, come fa `test:crm`.
-- ---------------------------------------------------------------------------

-- Le opportunità, già composte con programma, call e progetto: una sola
-- interrogazione invece di N+1 (§200).
create or replace function public.list_subsidy_opportunities(
  p_company_id uuid,
  p_project_id uuid default null,
  p_view       text default 'all',
  p_limit      integer default 50,
  p_offset     integer default 0
)
returns table (
  id                   uuid,
  project_id           uuid,
  project_title        text,
  kind                 public.subsidy_opportunity_kind,
  program_id           text,
  program_name         text,
  authority            text,
  support_type         text,
  program_availability text,
  program_lifecycle    text,
  official_source_url  text,
  program_version_id   uuid,
  version_number       integer,
  version_effective_from date,
  call_id              uuid,
  call_title           text,
  call_status          public.subsidy_call_status,
  call_deadline_on     date,
  call_deadline_at     timestamptz,
  call_continuous      boolean,
  relevance_level      public.subsidy_relevance_level,
  relevance_score      integer,
  eligibility_status   public.subsidy_eligibility_status,
  completeness         public.subsidy_completeness,
  timing               public.subsidy_timing,
  source_freshness     public.subsidy_freshness,
  readiness            public.subsidy_readiness,
  missing_fact_count   integer,
  open_criteria_count  integer,
  assessment_stale     boolean,
  saved_at             timestamptz,
  dismissed_at         timestamptz,
  dismissed_reason     public.subsidy_dismissal_reason,
  reopen_suggested_at  timestamptz,
  last_assessed_at     timestamptz,
  first_matched_at     timestamptz,
  case_id              uuid,
  case_status          public.subsidy_case_status,
  relevance_reasons    jsonb,
  total_count          bigint
)
language sql
security invoker
stable
set search_path = ''
as $$
  with base as (
    select o.*,
           p.name          as p_name,
           p.authority     as p_authority,
           p.support_type  as p_support,
           p.availability  as p_availability,
           p.lifecycle     as p_lifecycle,
           p.official_source_url as p_source,
           v.version_number as v_number,
           v.effective_from as v_from,
           c.title         as c_title,
           c.status        as c_status,
           c.deadline_on   as c_deadline_on,
           c.deadline_at   as c_deadline_at,
           c.continuous    as c_continuous,
           pr.title        as pr_title,
           a.relevance_reasons as a_reasons
      from public.subsidy_opportunities o
      join public.subsidy_programs p          on p.id = o.program_id
      join public.subsidy_program_versions v  on v.id = o.program_version_id
      left join public.subsidy_calls c        on c.id = o.call_id
      left join public.subsidy_projects pr    on pr.id = o.project_id
      left join public.subsidy_assessments a  on a.id = o.current_assessment_id
     where o.company_id = p_company_id
       and (p_project_id is null or o.project_id = p_project_id)
       and case p_view
             -- «Nuove»: mai viste, cioè comparse e non ancora salvate né messe
             -- da parte. Non è «create di recente»: un'opportunità di un mese fa
             -- che nessuno ha guardato è ancora nuova per chi la deve guardare.
             when 'new'       then o.dismissed_at is null and o.saved_at is null
             when 'high'      then o.dismissed_at is null and o.relevance_level = 'high'
             -- «Da verificare»: ci sono criteri aperti o dati mancanti.
             when 'to_verify' then o.dismissed_at is null
                                   and (o.open_criteria_count > 0 or o.missing_fact_count > 0)
             when 'deadline'  then o.dismissed_at is null and c.deadline_on is not null
                                   and c.status = 'open'
                                   and c.deadline_on <= (current_date + 60)
             when 'saved'     then o.dismissed_at is null and o.saved_at is not null
             when 'dismissed' then o.dismissed_at is not null
             else o.dismissed_at is null
           end
  ),
  counted as (select count(*) as n from base)
  select b.id, b.project_id, b.pr_title, b.kind, b.program_id, b.p_name, b.p_authority,
         b.p_support, b.p_availability, b.p_lifecycle, b.p_source,
         b.program_version_id, b.v_number, b.v_from,
         b.call_id, b.c_title, b.c_status, b.c_deadline_on, b.c_deadline_at, b.c_continuous,
         b.relevance_level, b.relevance_score, b.eligibility_status, b.completeness,
         b.timing, b.source_freshness, b.readiness,
         b.missing_fact_count, b.open_criteria_count, b.assessment_stale,
         b.saved_at, b.dismissed_at, b.dismissed_reason, b.reopen_suggested_at,
         b.last_assessed_at, b.first_matched_at,
         k.id, k.status,
         coalesce(b.a_reasons, '[]'::jsonb),
         (select n from counted)
    from base b
    -- ⚠️ `lateral` su una riga sola invece di una join: una pratica archiviata
    --    non deve far comparire l'opportunità come «in lavorazione», e prendere
    --    la più recente NON archiviata è la domanda giusta.
    left join lateral (
      select kk.id, kk.status
        from public.subsidy_cases kk
       where kk.opportunity_id = b.id and kk.archived_at is null
       order by kk.created_at desc
       limit 1
    ) k on true
   order by
     -- I programmi sospesi o ritirati in fondo: esistono, possono tornare, ma
     -- proporne uno in cima suggerirebbe di partire da lì (0011).
     (b.p_availability = 'suspended' or b.p_lifecycle = 'retired'),
     case b.relevance_level when 'high' then 0 when 'medium' then 1 else 2 end,
     b.relevance_score desc,
     b.first_matched_at desc
   limit greatest(1, least(coalesce(p_limit, 50), 200))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function public.list_subsidy_opportunities(uuid, uuid, text, integer, integer) is
  'Opportunità composte con programma, versione, call, progetto e pratica. SECURITY INVOKER: la RLS resta in vigore anche se il chiamante passa un''azienda altrui.';


-- I criteri di una valutazione, con il requisito e la sua evidenza.
create or replace function public.subsidy_assessment_criteria(p_assessment_id uuid)
returns table (
  rule_key       text,
  label          text,
  hardness       public.subsidy_rule_hardness,
  evaluability   public.subsidy_rule_evaluability,
  question       text,
  state          public.subsidy_criterion_state,
  observed_value text,
  value_source   public.subsidy_fact_source,
  reason_code    text,
  fact_key       text,
  source_evidence jsonb,
  sort_order     integer
)
language sql
security invoker
stable
set search_path = ''
as $$
  select r.rule_key, coalesce(g.label, r.rule_key), r.hardness,
         coalesce(g.evaluability, 'manual'::public.subsidy_rule_evaluability),
         g.question, r.state, r.observed_value, r.value_source, r.reason_code,
         g.fact_key, g.source_evidence, r.sort_order
    from public.subsidy_criterion_results r
    join public.subsidy_assessments a on a.id = r.assessment_id
    left join public.subsidy_program_rules g
           on g.program_version_id = a.program_version_id
          and g.rule_key = r.rule_key
   where r.assessment_id = p_assessment_id
   order by
     -- Prima ciò che può escludere, poi ciò che manca, poi il resto: è l'ordine
     -- in cui una persona vuole leggerli.
     case r.hardness when 'exclusion' then 0 when 'hard' then 1 when 'soft' then 2 else 3 end,
     case r.state when 'not_satisfied' then 0 when 'conflicting' then 1
                  when 'unknown' then 2 when 'not_evaluable' then 3 else 4 end,
     r.sort_order;
$$;


-- I progetti con il conteggio delle opportunità: §61 vuole che i risultati non
-- si mescolino fra progetti, e questa è la lista che lo rende possibile.
create or replace function public.list_subsidy_projects(
  p_company_id uuid,
  p_include_archived boolean default false
)
returns table (
  id                    uuid,
  title                 text,
  description           text,
  stage                 public.subsidy_project_stage,
  owner_user_id         uuid,
  location_canton       text,
  sector                text,
  estimated_start_date  date,
  estimated_end_date    date,
  budget_amount         numeric,
  budget_currency       text,
  employee_impact       integer,
  has_research_partner  boolean,
  has_innovation_partner boolean,
  has_international_partners boolean,
  project_types         text[],
  goals                 text,
  status                text,
  archived_at           timestamptz,
  created_at            timestamptz,
  updated_at            timestamptz,
  opportunity_count     integer,
  high_relevance_count  integer,
  stale_count           integer,
  document_count        integer,
  partner_count         integer,
  interpretation_version integer
)
language sql
security invoker
stable
set search_path = ''
as $$
  select pr.id, pr.title, pr.description, pr.stage, pr.owner_user_id,
         pr.location_canton, pr.sector, pr.estimated_start_date, pr.estimated_end_date,
         pr.budget_amount, pr.budget_currency, pr.employee_impact,
         pr.has_research_partner, pr.has_innovation_partner, pr.has_international_partners,
         pr.project_types, pr.goals, pr.status, pr.archived_at, pr.created_at, pr.updated_at,
         o.total, o.high, o.stale,
         d.n, pt.n,
         it.v
    from public.subsidy_projects pr
    left join lateral (
      select count(*)::integer                                              as total,
             count(*) filter (where relevance_level = 'high')::integer      as high,
             count(*) filter (where assessment_stale)::integer              as stale
        from public.subsidy_opportunities
       where project_id = pr.id and dismissed_at is null
    ) o on true
    left join lateral (
      select count(*)::integer as n from public.subsidy_project_documents where project_id = pr.id
    ) d on true
    left join lateral (
      select count(*)::integer as n from public.subsidy_project_partners where project_id = pr.id
    ) pt on true
    left join lateral (
      select max(version) as v from public.subsidy_project_interpretations where project_id = pr.id
    ) it on true
   where pr.company_id = p_company_id
     and (p_include_archived or pr.status = 'active')
   order by pr.status, pr.updated_at desc;
$$;


-- Le pratiche, con la checklist contata e la scadenza più vicina.
create or replace function public.list_subsidy_cases(
  p_company_id uuid,
  p_include_archived boolean default false
)
returns table (
  id                  uuid,
  opportunity_id      uuid,
  project_id          uuid,
  project_title       text,
  program_id          text,
  program_name        text,
  authority           text,
  status              public.subsidy_case_status,
  owner_user_id       uuid,
  official_deadline   date,
  official_deadline_at timestamptz,
  internal_deadline   date,
  amount_requested    numeric,
  amount_awarded      numeric,
  currency            text,
  outcome             public.subsidy_case_outcome,
  submitted_at        timestamptz,
  decision_at         date,
  legacy_snapshot     boolean,
  source_changed_at   timestamptz,
  archived_at         timestamptz,
  created_at          timestamptz,
  items_total         integer,
  items_done          integer,
  items_required_open integer,
  document_count      integer
)
language sql
security invoker
stable
set search_path = ''
as $$
  select k.id, k.opportunity_id, k.project_id, pr.title,
         k.program_id, coalesce(p.name, k.program_name), coalesce(p.authority, k.authority),
         k.status, k.owner_user_id,
         k.official_deadline, k.official_deadline_at, k.internal_deadline,
         k.amount_requested, k.amount_awarded, k.currency, k.outcome,
         k.submitted_at, k.decision_at, k.legacy_snapshot, k.source_changed_at,
         k.archived_at, k.created_at,
         i.total, i.done, i.req_open, d.n
    from public.subsidy_cases k
    left join public.subsidy_programs p on p.id = k.program_id
    left join public.subsidy_projects pr on pr.id = k.project_id
    left join lateral (
      select count(*)::integer                                                as total,
             count(*) filter (where completed)::integer                       as done,
             count(*) filter (where required and not completed)::integer      as req_open
        from public.subsidy_case_items where subsidy_case_id = k.id
    ) i on true
    left join lateral (
      select count(*)::integer as n from public.subsidy_case_documents where subsidy_case_id = k.id
    ) d on true
   where k.company_id = p_company_id
     and (p_include_archived or k.archived_at is null)
   order by (k.archived_at is not null),
            k.official_deadline nulls last,
            k.created_at desc;
$$;


-- Il riassunto per la Panoramica. ⚠️ §133/§134 — la Home NON deve mostrare la
-- stessa scadenza tre volte (opportunità, pratica, attività): questa funzione
-- restituisce i NUMERI, e la dedup la fa `overview.ts` con la stessa regola già
-- usata per documenti e attività.
create or replace function public.subsidy_home_summary(
  p_company_id uuid,
  p_days integer default 30
)
returns jsonb
language sql
security invoker
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'newOpportunities', (
      select count(*) from public.subsidy_opportunities
       where company_id = p_company_id and dismissed_at is null and saved_at is null
    ),
    'highRelevance', (
      select count(*) from public.subsidy_opportunities
       where company_id = p_company_id and dismissed_at is null and relevance_level = 'high'
    ),
    'staleAssessments', (
      select count(*) from public.subsidy_opportunities
       where company_id = p_company_id and dismissed_at is null and assessment_stale
    ),
    'openCases', (
      select count(*) from public.subsidy_cases
       where company_id = p_company_id and archived_at is null
         and status not in ('closed', 'submitted')
    ),
    'casesWithSourceChange', (
      select count(*) from public.subsidy_cases
       where company_id = p_company_id and archived_at is null and source_changed_at is not null
    ),
    'deadlinesSoon', (
      select count(*) from public.subsidy_cases
       where company_id = p_company_id and archived_at is null
         and official_deadline is not null
         and official_deadline between current_date and (current_date + greatest(1, coalesce(p_days, 30)))
    ),
    'activeProjects', (
      select count(*) from public.subsidy_projects
       where company_id = p_company_id and status = 'active'
    )
  );
$$;


-- ---------------------------------------------------------------------------
-- 40. LE SCANSIONI DEL WORKER
--
-- §173 — nessuno scheduler nuovo. Queste funzioni girano dentro il giro già
-- esistente delle automazioni, come `automation_emit_overdue` (0020) e
-- `crm_emit_follow_up_due` (0026). Non sono concesse ad `authenticated`: le
-- chiama il worker con il ruolo di servizio.
--
-- ⚠️ LA FINESTRA ALL'INDIETRO È LIMITATA, e per la stessa ragione delle altre
--    due scansioni: senza il limite, la prima esecuzione dopo l'attivazione di
--    una regola emetterebbe un evento per OGNI scadenza già passata, cioè il
--    backfill che il motore non deve fare. Attivare una regola non processa il
--    passato, e prometterlo sarebbe falso.
-- ---------------------------------------------------------------------------
create or replace function public.subsidy_emit_deadline_approaching(
  p_within_days integer default 30,
  p_limit       integer default 200
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   record;
  v_count integer := 0;
  v_id    uuid;
  v_days  integer;
begin
  for v_row in
    select k.id, k.company_id, k.program_id, k.official_deadline, k.call_id
      from public.subsidy_cases k
     where k.archived_at is null
       and k.official_deadline is not null
       and k.status not in ('submitted', 'under_review', 'approved', 'rejected', 'withdrawn', 'closed')
       and k.official_deadline >= current_date
       and k.official_deadline <= current_date + greatest(1, coalesce(p_within_days, 30))
     order by k.official_deadline
     limit greatest(1, coalesce(p_limit, 200))
  loop
    v_days := v_row.official_deadline - current_date;
    -- ⚠️ La chiave contiene LA DATA, non il numero di giorni residui: con i
    --    giorni, ogni esecuzione del worker produrrebbe una chiave diversa e
    --    quindi un evento nuovo — trenta eventi per una sola scadenza. Con la
    --    data, l'evento è uno; se l'autorità sposta il termine, la chiave
    --    cambia ed è giusto che scatti di nuovo.
    v_id := public.automation_emit(
      v_row.company_id, 'subsidy_deadline_approaching', 'subsidy_case', v_row.id,
      jsonb_build_object('programId', v_row.program_id,
                         'deadline', v_row.official_deadline,
                         'daysLeft', v_days,
                         'callId', v_row.call_id),
      'subsidy:case:' || v_row.id::text || ':deadline:' || v_row.official_deadline::text,
      null
    );
    if v_id is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;

comment on function public.subsidy_emit_deadline_approaching(integer, integer) is
  'Emette subsidy_deadline_approaching per le pratiche con scadenza ufficiale vicina. Chiave deduplicata sulla DATA, non sui giorni residui: altrimenti ogni esecuzione produrrebbe un evento nuovo.';


create or replace function public.subsidy_emit_stale_assessments(p_limit integer default 200)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   record;
  v_count integer := 0;
  v_id    uuid;
begin
  for v_row in
    select o.id, o.company_id, o.program_id, o.project_id, o.assessment_version
      from public.subsidy_opportunities o
     where o.assessment_stale = true
       and o.dismissed_at is null
       -- Solo quelle già valutate almeno una volta: un'opportunità mai valutata
       -- non è «diventata obsoleta», è nuova, e la tratta il matching.
       and o.current_assessment_id is not null
     order by o.relevance_score desc
     limit greatest(1, coalesce(p_limit, 200))
  loop
    v_id := public.automation_emit(
      v_row.company_id, 'subsidy_assessment_became_stale', 'subsidy_opportunity', v_row.id,
      jsonb_build_object('programId', v_row.program_id, 'projectId', v_row.project_id),
      'subsidy:opp:' || v_row.id::text || ':stale:' || v_row.assessment_version::text,
      null
    );
    if v_id is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;


-- Le fonti che tocca controllare. Il worker prende un lotto e sposta
-- `next_check_at` solo dopo un esito riuscito (sezione 27).
create or replace function public.subsidy_sources_due(p_limit integer default 10)
returns setof public.subsidy_sources
language sql
security definer
set search_path = ''
as $$
  select * from public.subsidy_sources
   where enabled = true
     and next_check_at <= now()
     -- Le fonti da curare a mano non si scaricano: §15 preferisce una
     -- procedura dichiarata a uno scraper fragile, e questo è il punto in cui
     -- quella scelta diventa comportamento.
     and source_type <> 'manual_official_source'
   order by
     case criticality when 'critical' then 0 when 'high' then 1 when 'normal' then 2 else 3 end,
     next_check_at
   limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;


-- Le revisioni critiche ancora aperte che toccano una pratica in corso (§131).
create or replace function public.subsidy_emit_source_critical_change(p_limit integer default 100)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row   record;
  v_count integer := 0;
  v_id    uuid;
begin
  for v_row in
    select distinct k.id as case_id, k.company_id, r.id as review_id, r.change_type
      from public.subsidy_catalog_reviews r
      join public.subsidy_cases k
        on (r.program_id is not null and k.program_id = r.program_id)
        or (r.call_id is not null and k.call_id = r.call_id)
     where r.status = 'pending'
       and r.risk_level in ('high', 'critical')
       and k.archived_at is null
       and k.status not in ('closed', 'approved', 'rejected', 'withdrawn')
     limit greatest(1, coalesce(p_limit, 100))
  loop
    v_id := public.automation_emit(
      v_row.company_id, 'subsidy_source_critical_change', 'subsidy_case', v_row.case_id,
      jsonb_build_object('reviewId', v_row.review_id, 'changeType', v_row.change_type),
      'subsidy:case:' || v_row.case_id::text || ':review:' || v_row.review_id::text,
      null
    );
    if v_id is not null then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end $$;


-- ---------------------------------------------------------------------------
-- 41. RLS
--
-- Due regimi diversi, e la distinzione è tutta:
--   · il CATALOGO (fonti, versioni, criteri, call) è CONDIVISO — lettura a
--     tutti gli utenti autenticati, scrittura solo con il ruolo di servizio.
--     Nessun editor di catalogo per il cliente (§28).
--   · i DATI DELL'IMPRESA (progetti, opportunità, valutazioni, risposte,
--     pratiche) sono per azienda, filtrati da `is_company_member` (§142).
-- ---------------------------------------------------------------------------
alter table public.subsidy_sources                 enable row level security;
alter table public.subsidy_source_fetches          enable row level security;
alter table public.subsidy_source_snapshots        enable row level security;
alter table public.subsidy_program_versions        enable row level security;
alter table public.subsidy_program_rules           enable row level security;
alter table public.subsidy_calls                   enable row level security;
alter table public.subsidy_catalog_reviews         enable row level security;
alter table public.subsidy_projects                enable row level security;
alter table public.subsidy_project_documents       enable row level security;
alter table public.subsidy_project_partners        enable row level security;
alter table public.subsidy_project_interpretations enable row level security;
alter table public.subsidy_answers                 enable row level security;
alter table public.subsidy_opportunities           enable row level security;
alter table public.subsidy_assessments             enable row level security;
alter table public.subsidy_criterion_results       enable row level security;
alter table public.subsidy_case_documents          enable row level security;
alter table public.subsidy_case_events             enable row level security;

-- ---- Catalogo: lettura a tutti gli autenticati ----

drop policy if exists subsidy_sources_select on public.subsidy_sources;
create policy subsidy_sources_select on public.subsidy_sources
  for select to authenticated using (enabled = true);

-- ⚠️ NESSUNA POLICY su `subsidy_source_fetches` e `subsidy_catalog_reviews`:
--    sono registri OPERATIVI. Il primo è un log tecnico che non aggiunge nulla
--    a un imprenditore; il secondo contiene proposte non verificate, e mostrarle
--    significherebbe presentare come dato del catalogo qualcosa che nessuno ha
--    ancora guardato — il contrario esatto di ciò che la revisione serve a
--    impedire. Senza policy, `authenticated` non legge nulla.

drop policy if exists subsidy_snapshots_select on public.subsidy_source_snapshots;
create policy subsidy_snapshots_select on public.subsidy_source_snapshots
  for select to authenticated using (true);

-- Le BOZZE di versione non si vedono: sono proposte in attesa di revisione.
drop policy if exists subsidy_versions_select on public.subsidy_program_versions;
create policy subsidy_versions_select on public.subsidy_program_versions
  for select to authenticated using (status <> 'draft');

drop policy if exists subsidy_rules_select on public.subsidy_program_rules;
create policy subsidy_rules_select on public.subsidy_program_rules
  for select to authenticated using (
    exists (
      select 1 from public.subsidy_program_versions v
       where v.id = program_version_id and v.status <> 'draft'
    )
  );

drop policy if exists subsidy_calls_select on public.subsidy_calls;
create policy subsidy_calls_select on public.subsidy_calls
  for select to authenticated using (true);

-- ---- Dati dell'impresa ----

drop policy if exists subsidy_projects_select on public.subsidy_projects;
create policy subsidy_projects_select on public.subsidy_projects
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists subsidy_projects_insert on public.subsidy_projects;
create policy subsidy_projects_insert on public.subsidy_projects
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists subsidy_projects_update on public.subsidy_projects;
create policy subsidy_projects_update on public.subsidy_projects
  for update to authenticated using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists subsidy_project_docs_select on public.subsidy_project_documents;
create policy subsidy_project_docs_select on public.subsidy_project_documents
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists subsidy_project_docs_insert on public.subsidy_project_documents;
create policy subsidy_project_docs_insert on public.subsidy_project_documents
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists subsidy_project_docs_delete on public.subsidy_project_documents;
create policy subsidy_project_docs_delete on public.subsidy_project_documents
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists subsidy_project_partners_select on public.subsidy_project_partners;
create policy subsidy_project_partners_select on public.subsidy_project_partners
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists subsidy_project_partners_insert on public.subsidy_project_partners;
create policy subsidy_project_partners_insert on public.subsidy_project_partners
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists subsidy_project_partners_delete on public.subsidy_project_partners;
create policy subsidy_project_partners_delete on public.subsidy_project_partners
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists subsidy_interpretations_select on public.subsidy_project_interpretations;
create policy subsidy_interpretations_select on public.subsidy_project_interpretations
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists subsidy_answers_select on public.subsidy_answers;
create policy subsidy_answers_select on public.subsidy_answers
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists subsidy_answers_insert on public.subsidy_answers;
create policy subsidy_answers_insert on public.subsidy_answers
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists subsidy_opportunities_select on public.subsidy_opportunities;
create policy subsidy_opportunities_select on public.subsidy_opportunities
  for select to authenticated using (public.is_company_member(company_id));
-- ⚠️ NESSUN INSERT dal client: le opportunità le crea il motore. Un'opportunità
--    scritta a mano sarebbe un abbinamento che nessuna valutazione ha prodotto.
drop policy if exists subsidy_opportunities_update on public.subsidy_opportunities;
create policy subsidy_opportunities_update on public.subsidy_opportunities
  for update to authenticated using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists subsidy_assessments_select on public.subsidy_assessments;
create policy subsidy_assessments_select on public.subsidy_assessments
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists subsidy_criteria_select on public.subsidy_criterion_results;
create policy subsidy_criteria_select on public.subsidy_criterion_results
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists subsidy_case_docs_select on public.subsidy_case_documents;
create policy subsidy_case_docs_select on public.subsidy_case_documents
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists subsidy_case_docs_insert on public.subsidy_case_documents;
create policy subsidy_case_docs_insert on public.subsidy_case_documents
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists subsidy_case_docs_update on public.subsidy_case_documents;
create policy subsidy_case_docs_update on public.subsidy_case_documents
  for update to authenticated using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
drop policy if exists subsidy_case_docs_delete on public.subsidy_case_documents;
create policy subsidy_case_docs_delete on public.subsidy_case_documents
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists subsidy_case_events_select on public.subsidy_case_events;
create policy subsidy_case_events_select on public.subsidy_case_events
  for select to authenticated using (public.is_company_member(company_id));


-- ---------------------------------------------------------------------------
-- 42. I PERMESSI
--
-- ⚠️⚠️ PRIMA IL `REVOKE`, POI I `GRANT`. Su Supabase ogni tabella nuova di
--    `public` nasce con i permessi di TABELLA completi per `authenticated`
--    (`alter default privileges … grant all`), quindi un `grant select (…)`
--    scritto da solo AGGIUNGE privilegi invece di toglierne. È il difetto più
--    serio mai trovato in questo progetto (0013 → 0014), e la sezione 43 lo
--    verifica interrogando `information_schema`.
-- ---------------------------------------------------------------------------
revoke all on public.subsidy_sources                 from anon, authenticated, public;
revoke all on public.subsidy_source_fetches          from anon, authenticated, public;
revoke all on public.subsidy_source_snapshots        from anon, authenticated, public;
revoke all on public.subsidy_program_versions        from anon, authenticated, public;
revoke all on public.subsidy_program_rules           from anon, authenticated, public;
revoke all on public.subsidy_calls                   from anon, authenticated, public;
revoke all on public.subsidy_catalog_reviews         from anon, authenticated, public;
revoke all on public.subsidy_projects                from anon, authenticated, public;
revoke all on public.subsidy_project_documents       from anon, authenticated, public;
revoke all on public.subsidy_project_partners        from anon, authenticated, public;
revoke all on public.subsidy_project_interpretations from anon, authenticated, public;
revoke all on public.subsidy_answers                 from anon, authenticated, public;
revoke all on public.subsidy_opportunities           from anon, authenticated, public;
revoke all on public.subsidy_assessments             from anon, authenticated, public;
revoke all on public.subsidy_criterion_results       from anon, authenticated, public;
revoke all on public.subsidy_case_documents          from anon, authenticated, public;
revoke all on public.subsidy_case_events             from anon, authenticated, public;
-- ⚠️ Le tre tabelle della 0003 avevano `grant select, insert, update, delete`
--    di TABELLA. Si rifà tutto: `subsidy_matches` diventa sola lettura (§165),
--    e su pratiche e checklist si passa ai permessi di COLONNA, perché adesso
--    ci sono colonne che deve timbrare il database.
revoke all on public.subsidy_matches    from anon, authenticated, public;
revoke all on public.subsidy_cases      from anon, authenticated, public;
revoke all on public.subsidy_case_items from anon, authenticated, public;

-- ⚠️⚠️ E `subsidy_programs`, CHE ERA SCRIVIBILE DAL 25 LUGLIO.
--
-- La 0007 scriveva `grant select on subsidy_programs to authenticated` senza
-- alcun `revoke` che lo precedesse, quindi quel grant AGGIUNGEVA una lettura a
-- privilegi di tabella che Supabase aveva già concesso per intero: al
-- 2026-07-30 `information_schema.table_privileges` mostrava INSERT, UPDATE e
-- DELETE su `subsidy_programs` sia per `anon` sia per `authenticated`.
--
-- ⚠️ NON ERA UNA FUGA SFRUTTABILE: la tabella ha una sola policy, `for select`,
--    e senza policy di scrittura la RLS respingeva comunque ogni tentativo. Ma
--    il permesso c'era, e sarebbe bastata una policy aggiunta in futuro «per
--    comodità» perché un cliente potesse riscrivere i requisiti che il prodotto
--    presenta a tutti gli altri.
--
-- È ESATTAMENTE IL DIFETTO DELLA 0013, chiuso dalla 0014, ripetuto su una
-- tabella che nessuno aveva ricontrollato. L'ha trovato l'autoverifica di
-- QUESTO file al primo tentativo di applicazione: la migrazione si è rifiutata
-- di applicarsi, come la 0026 davanti alla propria contraddizione interna.
revoke all on public.subsidy_programs   from anon, authenticated, public;
grant select on public.subsidy_programs to authenticated;

-- ---- Catalogo: SOLA LETTURA per il client (§28, §143) ----
grant select on public.subsidy_sources          to authenticated;
grant select on public.subsidy_source_snapshots to authenticated;
grant select on public.subsidy_program_versions to authenticated;
grant select on public.subsidy_program_rules    to authenticated;
grant select on public.subsidy_calls            to authenticated;
-- ⚠️ NIENTE su `subsidy_source_fetches` e `subsidy_catalog_reviews`, nemmeno la
--    lettura: vedi la nota nella sezione 41.

-- ---- Progetti ----
grant select on public.subsidy_projects to authenticated;
grant insert (company_id, title, description, stage, owner_user_id, location_canton,
              location_country, sector, estimated_start_date, estimated_end_date,
              budget_amount, budget_currency, employee_impact, has_research_partner,
              has_innovation_partner, has_international_partners, project_types, goals, status)
  on public.subsidy_projects to authenticated;
grant update (title, description, stage, owner_user_id, location_canton, location_country,
              sector, estimated_start_date, estimated_end_date, budget_amount, budget_currency,
              employee_impact, has_research_partner, has_innovation_partner,
              has_international_partners, project_types, goals, status)
  on public.subsidy_projects to authenticated;
-- ⚠️ NESSUN `delete`: un progetto si ARCHIVIA. Cancellarlo porterebbe via con
--    sé opportunità, valutazioni e — a cascata — il collegamento delle pratiche
--    che ne sono nate. È la stessa scelta di documenti, attività, contratti e
--    controparti.

grant select, insert, delete on public.subsidy_project_documents to authenticated;
grant select, insert, delete on public.subsidy_project_partners  to authenticated;

-- Le interpretazioni le scrive la Edge Function con il ruolo di servizio: sono
-- il risultato di una chiamata al modello, e un client che potesse inserirle
-- scriverebbe un'interpretazione che nessun modello ha prodotto.
grant select on public.subsidy_project_interpretations to authenticated;

-- Le risposte: si inseriscono, non si modificano (append-only).
grant select on public.subsidy_answers to authenticated;
grant insert (company_id, project_id, program_version_id, rule_key, value, note)
  on public.subsidy_answers to authenticated;

-- ---- Opportunità: il client può fare TRE cose ----
-- ⚠️ Salvare, mettere da parte, riaprire. Le sei misure, i conteggi e la
--    valutazione corrente le scrive il MOTORE: un'opportunità la cui rilevanza
--    si può cambiare dal browser non è una valutazione, è un'opinione.
grant select on public.subsidy_opportunities to authenticated;
grant update (saved_at, dismissed_reason, dismissed_note) on public.subsidy_opportunities to authenticated;

grant select on public.subsidy_assessments       to authenticated;
grant select on public.subsidy_criterion_results to authenticated;

-- ---- Pratiche ----
grant select on public.subsidy_cases to authenticated;
grant insert (company_id, created_by, opportunity_id, project_id, program_id, program_name,
              authority, program_version_id, call_id, owner_user_id, status,
              official_deadline, official_deadline_at, internal_deadline,
              amount_requested, currency, program_snapshot, snapshot_hash,
              eligibility_status_at_creation, relevance_score, source_last_checked_at,
              eligibility_snapshot)
  on public.subsidy_cases to authenticated;
grant update (status, owner_user_id, internal_deadline, amount_requested, amount_awarded,
              currency, decision_at, outcome, outcome_document_id, archived_at, archived_by,
              source_changed_at)
  on public.subsidy_cases to authenticated;
-- ⚠️ NESSUN `delete` e NESSUN update su `program_snapshot`/`snapshot_hash`:
--    l'istantanea è tutto il valore della pratica (§109, §188).

grant select on public.subsidy_case_items to authenticated;
grant insert (subsidy_case_id, title, completed, sort_order, kind, document_id, task_id,
              due_date, required, source_requirement_key)
  on public.subsidy_case_items to authenticated;
grant update (title, completed, sort_order, kind, document_id, task_id, due_date, required)
  on public.subsidy_case_items to authenticated;
grant delete on public.subsidy_case_items to authenticated;

grant select on public.subsidy_case_documents to authenticated;
grant insert (company_id, subsidy_case_id, document_id, requirement_key, relation_type, status)
  on public.subsidy_case_documents to authenticated;
grant update (requirement_key, relation_type, status) on public.subsidy_case_documents to authenticated;
grant delete on public.subsidy_case_documents to authenticated;

-- ⚠️ Solo lettura: lo storico lo scrivono i trigger.
grant select on public.subsidy_case_events    to authenticated;

-- ---- Legacy: sola lettura ----
grant select on public.subsidy_matches to authenticated;

-- ---- Le funzioni ----
revoke all on function public.list_subsidy_opportunities(uuid, uuid, text, integer, integer) from public, anon;
grant execute on function public.list_subsidy_opportunities(uuid, uuid, text, integer, integer) to authenticated;

revoke all on function public.subsidy_assessment_criteria(uuid) from public, anon;
grant execute on function public.subsidy_assessment_criteria(uuid) to authenticated;

revoke all on function public.list_subsidy_projects(uuid, boolean) from public, anon;
grant execute on function public.list_subsidy_projects(uuid, boolean) to authenticated;

revoke all on function public.list_subsidy_cases(uuid, boolean) from public, anon;
grant execute on function public.list_subsidy_cases(uuid, boolean) to authenticated;

revoke all on function public.subsidy_home_summary(uuid, integer) from public, anon;
grant execute on function public.subsidy_home_summary(uuid, integer) to authenticated;

-- ⚠️ NON concesse ad `authenticated`, e non è una dimenticanza: emettono eventi
--    di automazione e leggono l'intero catalogo scavalcando la RLS. È la stessa
--    ragione per cui `automation_emit` e `crm_emit_follow_up_due` sono revocate,
--    ed è la lezione della 0029 — dove `assistant_purge_expired`, revocata a
--    `public` ma non ad `authenticated`, restava invocabile da chiunque.
revoke all on function public.subsidy_emit_deadline_approaching(integer, integer) from public, anon, authenticated;
revoke all on function public.subsidy_emit_stale_assessments(integer)              from public, anon, authenticated;
revoke all on function public.subsidy_emit_source_critical_change(integer)         from public, anon, authenticated;
revoke all on function public.subsidy_sources_due(integer)                         from public, anon, authenticated;
revoke all on function public.subsidy_refresh_readiness(uuid)                      from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 43. AUTOVERIFICA
--
-- Il file non si limita a dichiarare le proprie garanzie: le prova, e se non
-- tornano l'applicazione FALLISCE invece di riuscire a metà. È la disciplina
-- della 0014, della 0024 e della 0026 — e la 0026 ha guadagnato il proprio
-- costo prima ancora di arrivare in produzione, rifiutandosi di applicarsi su
-- una contraddizione interna.
--
-- ⚠️⚠️ QUESTO BLOCCO NON NOMINA NESSUNA DELLE SEDICI ETICHETTE AGGIUNTE AGLI
--    ENUM ESISTENTI NELLA SEZIONE 1 — nemmeno dentro un commento, perché il
--    controllo che sorveglia questa promessa cerca il letterale fra apici e non
--    distingue un commento da un'istruzione. Nominarle qui produrrebbe 55P04 su
--    ogni installazione da zero, dato che `full-setup.sql` concatena tutte le
--    migrazioni in una transazione sola. Quelle verifiche stanno in
--    `test:subsidy-unit` e `test:subsidy`.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
  v_n   integer;
begin
  -- (a) La RLS è accesa su tutte e diciassette le tabelle nuove.
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('subsidy_sources', 'subsidy_source_fetches', 'subsidy_source_snapshots',
                       'subsidy_program_versions', 'subsidy_program_rules', 'subsidy_calls',
                       'subsidy_catalog_reviews', 'subsidy_projects', 'subsidy_project_documents',
                       'subsidy_project_partners', 'subsidy_project_interpretations',
                       'subsidy_answers', 'subsidy_opportunities', 'subsidy_assessments',
                       'subsidy_criterion_results', 'subsidy_case_documents', 'subsidy_case_events')
     and c.relrowsecurity = false;
  if v_bad is not null then
    raise exception 'RLS non attiva su: %', v_bad;
  end if;

  -- (b) ⚠️ IL CATALOGO NON È SCRIVIBILE DAL CLIENT (§28, §143, §195).
  --     È la garanzia più importante del file: se un giorno qualcuno
  --     concedesse un insert su una di queste tabelle, un cliente potrebbe
  --     riscrivere i requisiti che il prodotto presenta a tutti gli altri.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ') into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name in ('subsidy_sources', 'subsidy_source_fetches', 'subsidy_source_snapshots',
                        'subsidy_program_versions', 'subsidy_program_rules', 'subsidy_calls',
                        'subsidy_catalog_reviews', 'subsidy_programs')
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'il catalogo incentivi risulta scrivibile dal client: %', v_bad;
  end if;

  -- (c) ⚠️ LO STORICO E LE VALUTAZIONI NON SONO SCRIVIBILI DAL CLIENT.
  --     Senza, si potrebbe firmare un'azione a nome di un collega o scriversi
  --     una valutazione che nessun motore ha prodotto (§146).
  select string_agg(format('%s.%s', table_name, privilege_type), ', ') into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name in ('subsidy_case_events', 'subsidy_assessments',
                        'subsidy_criterion_results', 'subsidy_project_interpretations')
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'storico o valutazioni risultano scrivibili dal client: %', v_bad;
  end if;

  -- (d) Le risposte sono APPEND-ONLY: nessun update, nessun delete.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ') into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name = 'subsidy_answers'
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
     and privilege_type in ('UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'le risposte ai criteri risultano modificabili: %', v_bad;
  end if;

  -- (e) `subsidy_matches` è sola lettura (§165).
  select string_agg(privilege_type, ', ') into v_bad
    from information_schema.table_privileges
   where table_schema = 'public' and table_name = 'subsidy_matches'
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'subsidy_matches (legacy) risulta ancora scrivibile: %', v_bad;
  end if;

  -- (f) Le colonne che il database timbra non sono scrivibili colonna per
  --     colonna. È il controllo che rende vera la promessa della sezione 42.
  --     ⚠️ Due controlli DISTINTI e non uno solo, per la lezione della 0026:
  --     `company_id` di un progetto DEVE essere inseribile (è `not null` senza
  --     default, e senza insert nessuno potrebbe creare un progetto); ciò che
  --     non deve essere possibile è CAMBIARLO dopo.
  select string_agg(format('%s.%s', table_name, column_name), ', ') into v_bad
    from information_schema.column_privileges
   where table_schema = 'public'
     and ((table_name = 'subsidy_projects'
           and column_name in ('created_by', 'created_at', 'updated_at', 'archived_at', 'archived_by'))
       or (table_name = 'subsidy_opportunities'
           and column_name in ('relevance_level', 'relevance_score', 'eligibility_status',
                               'completeness', 'timing', 'source_freshness', 'readiness',
                               'missing_fact_count', 'open_criteria_count',
                               'current_assessment_id', 'assessment_version', 'last_fingerprint',
                               'assessment_stale', 'dismissed_at', 'dismissed_by',
                               'first_matched_at', 'last_assessed_at', 'program_version_id',
                               'call_id', 'kind', 'workflow_run_id'))
       or (table_name = 'subsidy_answers'
           and column_name in ('answered_by', 'answered_at', 'created_at'))
       or (table_name = 'subsidy_cases'
           and column_name in ('submitted_at', 'submitted_by', 'legacy_snapshot',
                               'created_at', 'updated_at'))
       or (table_name = 'subsidy_case_items'
           and column_name in ('completed_at', 'completed_by', 'company_id')))
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
     and privilege_type in ('INSERT', 'UPDATE');
  if v_bad is not null then
    raise exception 'colonne timbrate dal database risultano scrivibili dal client: %', v_bad;
  end if;

  -- (g) Le colonne di APPARTENENZA di un progetto e di un'opportunità sono
  --     inseribili ma non aggiornabili: spostare un'opportunità da un'azienda
  --     all'altra dopo la creazione non deve essere possibile.
  select string_agg(format('%s.%s', table_name, column_name), ', ') into v_bad
    from information_schema.column_privileges
   where table_schema = 'public'
     and ((table_name = 'subsidy_projects' and column_name = 'company_id')
       or (table_name = 'subsidy_opportunities' and column_name in ('company_id', 'program_id', 'project_id')))
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
     and privilege_type = 'UPDATE';
  if v_bad is not null then
    raise exception 'colonne di appartenenza risultano aggiornabili: %', v_bad;
  end if;

  -- (h) ⚠️ LE FUNZIONI DEL WORKER NON SONO INVOCABILI DA UN UTENTE
  --     AUTENTICATO. È esattamente il difetto che la 0029 ha dovuto chiudere:
  --     `revoke … from public` non basta, perché Supabase concede i privilegi
  --     sulle FUNZIONI anche direttamente ad `anon` e `authenticated`.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('subsidy_emit_deadline_approaching', 'subsidy_emit_stale_assessments',
                       'subsidy_emit_source_critical_change', 'subsidy_sources_due',
                       'subsidy_refresh_readiness')
     and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
       or has_function_privilege('anon', p.oid, 'EXECUTE'));
  if v_bad is not null then
    raise exception 'funzioni del worker invocabili da un utente autenticato: %', v_bad;
  end if;

  -- (i) L'unicità della versione pubblicata esiste davvero. Senza quell'indice,
  --     «la versione corrente» sarebbe una domanda con più risposte.
  select count(*) into v_n
    from pg_indexes
   where schemaname = 'public' and indexname = 'uq_subsidy_version_published';
  if v_n <> 1 then
    raise exception 'manca l''indice che garantisce una sola versione pubblicata per programma';
  end if;

  -- (l) L'unicità dell'impronta di valutazione: due valutazioni identiche sulla
  --     stessa opportunità non si scrivono due volte (§60, §181).
  select count(*) into v_n
    from pg_indexes
   where schemaname = 'public' and indexname = 'uq_subsidy_assessments_fingerprint';
  if v_n <> 1 then
    raise exception 'manca l''indice di idempotenza delle valutazioni';
  end if;

  -- (m) ⚠️ IL GIRO VERO, e serve perché il corpo di una plpgsql NON viene
  --     analizzato alla creazione: il 42804 della 0022 e della 0025 si è visto
  --     solo eseguendo. Qui si crea una fonte, una versione, un criterio e una
  --     call, si verifica che l'immutabilità morda, e si cancella tutto.
  declare
    v_src  uuid;
    v_ver  uuid;
    v_prog text := '__selftest_0032__';
    v_ok   boolean;
  begin
    insert into public.subsidy_sources (authority, source_type, canonical_url, allowed_host,
                                        jurisdiction, adapter_key)
    values ('Autoverifica', 'official_program_page', 'https://example.invalid/selftest',
            'example.invalid', 'CH', 'selftest')
    returning id into v_src;

    insert into public.subsidy_programs (id, name, authority, official_source_url, primary_source_id)
    values (v_prog, 'Autoverifica 0032', 'Autoverifica', 'https://example.invalid/selftest', v_src);

    insert into public.subsidy_program_versions (program_id, version_number, status, content_hash)
    values (v_prog, 1, 'published', 'selftest-hash')
    returning id into v_ver;

    -- La colonna denormalizzata si è allineata da sé?
    if (select current_version_id from public.subsidy_programs where id = v_prog) is distinct from v_ver then
      raise exception 'autoverifica: current_version_id non si allinea alla versione pubblicata';
    end if;

    -- L'immutabilità morde davvero?
    v_ok := false;
    begin
      update public.subsidy_program_versions set content_hash = 'altro' where id = v_ver;
    exception when others then
      v_ok := true;
    end;
    if not v_ok then
      raise exception 'autoverifica: una versione pubblicata risulta modificabile';
    end if;

    -- Un criterio su una versione non in bozza dev'essere rifiutato.
    v_ok := false;
    begin
      insert into public.subsidy_program_rules (program_version_id, rule_key, label, hardness, evaluability)
      values (v_ver, 'selftest', 'Autoverifica', 'hard', 'auto');
    exception when others then
      v_ok := true;
    end;
    if not v_ok then
      raise exception 'autoverifica: i criteri di una versione pubblicata risultano modificabili';
    end if;

    -- La cancellazione a cascata funziona? È il controllo che la 0023, la 0025
    -- e la 0028 hanno dovuto imparare tre volte.
    delete from public.subsidy_programs where id = v_prog;
    delete from public.subsidy_sources  where id = v_src;

    if exists (select 1 from public.subsidy_program_versions where program_id = v_prog) then
      raise exception 'autoverifica: la cascata non ha rimosso le versioni';
    end if;
  end;
end $$;
