-- ============================================================================
-- 0024 — CONTRACT MANAGER
--
-- Contratti e accordi aziendali: capire con chi si è legati, da quando, fino a
-- quando, a quali condizioni, e trasformare le date che ne derivano in lavoro
-- concreto. NON è uno studio legale, e la differenza non è di ambizione ma di
-- competenza: uno studio legale AFFERMA che cosa il diritto impone, questo
-- modulo RIPORTA che cosa il documento dice.
--
-- ⚠️ CIÒ CHE QUESTA MIGRAZIONE NON FA, E NON PER MANCANZA DI TEMPO:
-- non giudica se una clausola sia valida, nulla, abusiva, opponibile o
-- contestabile; non applica il Codice delle obbligazioni né alcuna norma
-- cantonale; non colma con la legge i termini che il contratto tace; non invia
-- disdette, non firma, non accetta né rifiuta rinnovi, non scrive alla
-- controparte. Un contratto si legge e si organizza, non si esegue.
--
-- ⚠️ NON CREA UNA SECONDA VERITÀ SUI DOCUMENTI.
-- Il file resta del documento (Storage), il testo resta dell'estrazione, la
-- lettura amministrativa resta dell'analisi immutabile, il lavoro resta delle
-- attività, il promemoria resta del calendario e delle notifiche. Qui si
-- aggiunge SOLO la lettura contrattuale specializzata, i termini che una
-- persona ha verificato e le date che ne derivano.
--
--   DOCUMENTI → ESTRAZIONE CONTRATTUALE → VERIFICA UMANA → TERMINI VERIFICATI
--             → MILESTONE → ATTIVITÀ → CALENDARIO → NOTIFICA → DECISIONE UMANA
--
-- ⚠️ LA REGOLA CHE GOVERNA TUTTO IL FILE: EVIDENZA > FIDUCIA > AUTOMAZIONE.
-- Se una clausola è ambigua si mostra; se una data non si può derivare non si
-- inventa; se arriva una modifica non si sovrascrive; se un termine è
-- verificato allora — e solo allora — può diventare lavoro.
--
-- Requisiti: 0001–0023 applicate.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. I tipi
--
-- Tutti con `create type … as enum (…)`: i valori dichiarati alla creazione
-- sono utilizzabili SUBITO, anche nella stessa transazione. È la differenza con
-- `alter type … add value` del punto 2, che rende l'etichetta inservibile fino
-- al commit (55P04).
-- ---------------------------------------------------------------------------

-- Che cosa è il contratto. §2 — undici valori, e nessuno di essi è una
-- categoria giuridica: sono i rapporti che una PMI riconosce guardando la
-- propria cartella. `other` è una scelta esplicita, non un ripiego per l'ignoto:
-- quando il tipo non si sa, la colonna resta al suo default e il documento
-- porta la propria bandiera di qualità.
do $$ begin
  create type public.contract_type as enum (
    'insurance',              -- polizze
    'leasing',
    'rent',                   -- locazione di locali, magazzini, posteggi
    'telecom',
    'software_subscription',
    'supplier',               -- fornitura di beni
    'maintenance',            -- manutenzione e assistenza
    'service',                -- prestazione di servizi
    'licensing',
    'nda',
    'other'
  );
exception when duplicate_object then null; end $$;

-- §9 — che cosa deve fare una PERSONA. Tre valori, e il terzo è il cuore del
-- modulo: `review_required_again` non è «da verificare» — è «era verificato, poi
-- è arrivato un documento che sembra cambiare i termini». Fonderli farebbe
-- sparire proprio l'informazione per cui esiste la gestione degli amendment.
do $$ begin
  create type public.contract_review_status as enum
    ('needs_review', 'verified', 'review_required_again');
exception when duplicate_object then null; end $$;

-- §10 — lo stato operativo del rapporto. `unknown` è il default e non è una
-- lacuna: finché nessuno ha verificato le date, dire «attivo» sarebbe
-- un'affermazione che nessun dato sostiene.
-- ⚠️ NON SI DERIVA AUTOMATICAMENTE (§118). Una data passata non basta a
-- dichiarare finito un contratto che prevede rinnovo tacito, e sbagliare in
-- questa direzione significa smettere di sorvegliare un impegno ancora in
-- vigore. Il prodotto può SUGGERIRE «possibilmente scaduto» in lettura; a
-- scrivere questa colonna è solo una persona.
do $$ begin
  create type public.contract_lifecycle_status as enum
    ('unknown', 'upcoming', 'active', 'ended', 'terminated');
exception when duplicate_object then null; end $$;

-- §5 — che ruolo ha un documento dentro il contratto. Un contratto reale non è
-- un PDF: è un accordo, i suoi allegati, le condizioni generali richiamate, le
-- modifiche successive e — se arriva — la disdetta.
do $$ begin
  create type public.contract_document_relation as enum (
    'main_agreement',
    'amendment',            -- modifica i termini: è l'unico che apre una revisione
    'annex',                -- allegato, incluse le condizioni generali allegate
    'renewal',
    'termination_notice',
    'other'
  );
exception when duplicate_object then null; end $$;

-- Chi ha collegato il documento o creato il contratto. §78 chiede audit sul
-- collegamento: `rule` è la regola deterministica del prodotto, `manual` una
-- persona, `workflow` una regola scritta dall'azienda.
do $$ begin
  create type public.contract_origin as enum ('manual', 'rule', 'workflow');
exception when duplicate_object then null; end $$;

-- §81 — a che punto è la MACCHINA su un singolo documento. Deliberatamente
-- separato dallo stato di revisione: «l'estrazione è fallita» e «i dati vanno
-- verificati» sono due cose diverse.
do $$ begin
  create type public.contract_processing_status as enum
    ('pending', 'processing', 'completed', 'failed');
exception when duplicate_object then null; end $$;

-- Esito di un tentativo di lettura. Due valori: o ha prodotto un verbale
-- leggibile o non l'ha prodotto. Un'estrazione con campi mancanti è `completed`
-- con le sue incertezze — «incompleto» non è «fallito».
do $$ begin
  create type public.contract_extraction_status as enum ('completed', 'failed');
exception when duplicate_object then null; end $$;

-- §25 — lo stato di una versione dei termini. `draft` è ciò che il sistema
-- propone, `verified` ciò che una persona ha confermato e che da quel momento è
-- immutabile, `superseded` una versione precedente che resta leggibile.
do $$ begin
  create type public.contract_term_version_status as enum
    ('draft', 'verified', 'superseded');
exception when duplicate_object then null; end $$;

-- §33 — che cosa sappiamo della fine del contratto. Tre stati, e il terzo non è
-- il secondo: `none` è «il documento dice che non c'è una fine fissa» (contratto
-- a tempo indeterminato), `unknown` è «non l'ho trovata». Confonderli
-- trasformerebbe un'ignoranza in un'affermazione.
do $$ begin
  create type public.contract_end_kind as enum ('explicit', 'none', 'unknown');
exception when duplicate_object then null; end $$;

-- §35 — il rinnovo automatico. TRE valori e mai un booleano: un documento che
-- non parla di rinnovo non dice «no», dice niente. Un `false` scritto al posto
-- di `unclear` è la bugia più costosa che questo modulo possa raccontare, perché
-- spegne la sorveglianza proprio dove serve.
do $$ begin
  create type public.contract_auto_renewal as enum ('yes', 'no', 'unclear');
exception when duplicate_object then null; end $$;

-- §37 — l'unità di un periodo (preavviso, rinnovo, durata minima).
do $$ begin
  create type public.contract_period_unit as enum ('days', 'weeks', 'months', 'years');
exception when duplicate_object then null; end $$;

-- ⚠️⚠️ §38 — L'ANCORAGGIO DEL PREAVVISO, ED È IL TIPO PIÙ IMPORTANTE DEL FILE.
-- «Tre mesi» non è un termine: è un numero in cerca di una data. Tre mesi prima
-- della scadenza, tre mesi per la fine del mese, tre mesi per la fine del
-- trimestre e tre mesi in qualsiasi momento producono quattro date diverse — e
-- soltanto per i primi due il prodotto sa fare un calcolo di cui rispondere.
--
-- I valori che NON producono alcuna data sono qui perché ESISTONO nei contratti
-- veri, non perché il prodotto sappia trattarli: dichiararli permette di dire
-- «il preavviso è indicato, ma non è possibile derivare con sicurezza una data»
-- invece di tacere o, peggio, di calcolare.
do $$ begin
  create type public.contract_notice_anchor as enum (
    'before_fixed_end',     -- CALCOLABILE: N prima di una fine esplicita
    'before_renewal_date',  -- CALCOLABILE: N prima della data di rinnovo
    'to_month_end',         -- «auf Monatsende» — semantica non univoca
    'to_quarter_end',
    'to_year_end',
    'anytime',              -- nessuna scadenza a cui ancorare
    'other',
    'unclear'               -- il documento indica un preavviso senza dire a che cosa
  );
exception when duplicate_object then null; end $$;

-- §49 — come il contratto dice che la disdetta va comunicata. Si estrae SOLO se
-- esplicito, e l'interfaccia lo presenta come «il contratto indica: …», mai come
-- «devi usare». Che quel modo sia giuridicamente necessario è una domanda di
-- diritto, e questo modulo non la pone.
do $$ begin
  create type public.contract_termination_method as enum
    ('written_notice', 'email', 'registered_mail', 'portal', 'other');
exception when duplicate_object then null; end $$;

-- §53 — con quale cadenza il costo si ripete. `unknown` non è `one_time`.
do $$ begin
  create type public.contract_cost_frequency as enum
    ('one_time', 'monthly', 'quarterly', 'yearly', 'other', 'unknown');
exception when duplicate_object then null; end $$;

-- §40 — le date che meritano attenzione.
do $$ begin
  create type public.contract_milestone_kind as enum (
    'contract_start', 'contract_end', 'renewal_date', 'notice_deadline',
    'review_date', 'other'
  );
exception when duplicate_object then null; end $$;

-- §41 — da dove viene una data. `explicit` è scritta nel contratto, `derived` è
-- calcolata dal prodotto, `manual` l'ha messa una persona. Tenerle distinte è
-- ciò che permette di non trattare un calcolo come una lettura.
do $$ begin
  create type public.contract_milestone_source as enum ('explicit', 'derived', 'manual');
exception when duplicate_object then null; end $$;

-- ⚠️ §43/§44 — LA DISTINZIONE FONDAMENTALE DEL MODULO.
-- `candidate` è una data che il sistema propone; `verified` è una data che una
-- persona ha confermato. Solo la seconda può generare lavoro (§87), perché solo
-- della seconda qualcuno risponde. `dismissed` è una data scartata da una
-- persona; `superseded` una data resa obsoleta da una nuova versione dei
-- termini — e le due non si confondono, perché la prima è un giudizio e la
-- seconda un fatto.
do $$ begin
  create type public.contract_milestone_status as enum
    ('candidate', 'verified', 'dismissed', 'superseded');
exception when duplicate_object then null; end $$;

-- §140 — le bandiere di qualità. Sono CHIAVI: la frase la scrive l'interfaccia
-- nella lingua di chi legge. Ognuna corrisponde a una verifica che il codice
-- esegue davvero — non esiste una bandiera che nessuno alza.
do $$ begin
  create type public.contract_quality_flag as enum (
    'missing_counterparty',
    'ambiguous_start_date',
    'ambiguous_end_date',
    'renewal_unclear',            -- §35: il documento non chiarisce il rinnovo
    'notice_anchor_unclear',      -- §38: c'è un preavviso, non si sa da quando
    'notice_not_derivable',       -- §39: preavviso noto, data NON calcolabile
    'conflicting_terms',          -- due documenti dicono cose diverse
    'missing_referenced_annex',   -- §115: richiama allegati che non ci sono
    'low_extraction_confidence',
    'amendment_requires_review',  -- §26: una modifica attende una persona
    'partially_analysed',         -- §113: documento più lungo del limite
    'out_of_scope_contract_kind', -- §3: lavoro, M&A, contenzioso…
    'cost_unclear',
    'multiple_currencies'         -- §55: importi in valute diverse, mai sommati
  );
exception when duplicate_object then null; end $$;

-- §85 — lo storico. Lo scrivono i trigger; non si registra la lettura.
do $$ begin
  create type public.contract_event_kind as enum (
    'created', 'document_added', 'document_removed', 'extraction_completed',
    'extraction_failed', 'corrected', 'verified', 'review_reopened',
    'owner_changed', 'term_version_verified', 'milestone_verified',
    'milestone_dismissed', 'milestone_added', 'amendment_added',
    'archived', 'restored', 'lifecycle_changed', 'retry_requested'
  );
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- 2. I quattro inneschi nuovi del motore delle automazioni
--
-- ⚠️⚠️ LEGGERE PRIMA DI TOCCARE QUESTE QUATTRO RIGHE.
--
-- `alter type … add value` si esegue dentro una transazione, ma l'etichetta NON
-- è utilizzabile finché quella transazione non è chiusa (Postgres 55P04). Il SQL
-- editor di Supabase esegue tutto in un'unica transazione, e `full-setup.sql`
-- concatena TUTTE le migrazioni: basta una riga che VALUTI l'etichetta appena
-- aggiunta per far fallire ogni installazione da zero. È successo con la 0015.
--
-- In questo file i quattro valori compaiono altrove SOLTANTO dentro il corpo di
-- `create function`. Un corpo plpgsql viene depositato come TESTO: Postgres non
-- risolve le etichette che vi compaiono finché la funzione non viene chiamata,
-- cioè dopo il commit. È la stessa scelta della 0021, e `npm run db:bundle` la
-- riconosce (con autoverifica in entrambe le direzioni).
--
-- ⚠️ Il blocco di autoverifica in fondo NON nomina questi valori e NON chiama
-- alcuna funzione che li nomini: quel blocco viene eseguito davvero.
-- ---------------------------------------------------------------------------
alter type public.automation_event_type add value if not exists 'contract_verified';
alter type public.automation_event_type add value if not exists 'contract_review_required';
alter type public.automation_event_type add value if not exists 'contract_milestone_verified';
alter type public.automation_event_type add value if not exists 'contract_milestone_window_opened';


-- ---------------------------------------------------------------------------
-- 3. `contract` diventa un'entità del motore delle automazioni
--
-- ⚠️ PERCHÉ QUI SI ALLARGA IL VINCOLO MENTRE FINANCE NON L'AVEVA FATTO.
-- La 0021 lasciò `document`, e per una buona ragione: una fattura È la lettura
-- di un documento, e una regola che parla di fatture vuole poter guardare anche
-- la categoria e il mittente di quel documento.
-- Un contratto no. Un contratto ha PIÙ documenti (§5), può esistere senza
-- averne nessuno, e le sue milestone non appartengono ad alcuno di essi.
-- Agganciare l'evento all'accordo principale significherebbe dire una cosa
-- falsa — «questo fatto riguarda quel PDF» — proprio nel campo che serve al
-- motore per ritrovare l'entità.
--
-- Si allarga l'elenco, non si toglie il controllo: un `entity_type` libero
-- lascerebbe entrare qualunque stringa, e la 0020 lo evitava di proposito.
-- ---------------------------------------------------------------------------
alter table public.automation_events drop constraint if exists automation_events_entity_type_check;
alter table public.automation_events
  add constraint automation_events_entity_type_check
  check (entity_type in ('document', 'email_message', 'task', 'contract'));

alter table public.workflow_runs drop constraint if exists workflow_runs_entity_type_check;
alter table public.workflow_runs
  add constraint workflow_runs_entity_type_check
  check (entity_type in ('document', 'email_message', 'task', 'contract'));

-- Una notifica può ora riferirsi a un contratto: «il preavviso di X si avvicina»
-- non ha altro referente sensato.
alter table public.notifications drop constraint if exists notifications_entity_type_check;
alter table public.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('task', 'calendar_connection', 'document', 'email_message', 'contract'));


-- ---------------------------------------------------------------------------
-- 4. contracts — IL RAPPORTO CONTRATTUALE
--
-- Che cosa sta qui e che cosa no: qui sta ciò che una PERSONA decide (come si
-- chiama, chi è il responsabile, l'ho verificato, l'ho archiviato) e ciò che
-- serve per FILTRARE e ORDINARE. I TERMINI stanno in `contract_term_versions`,
-- i FATTI LETTI in `contract_extractions` (immutabile), i DOCUMENTI restano
-- documenti.
--
-- ⚠️ `display_name` È METADATO ORGANIZZATIVO, NON UNA CORREZIONE (§31).
-- «Swisscom — Internet sede Lugano» non è un dato del contratto: è il modo in
-- cui l'azienda lo chiama. Cambiarlo non produce alcuna correzione dei termini e
-- non tocca lo stato di verifica.
-- ---------------------------------------------------------------------------
create table if not exists public.contracts (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,

  display_name      text not null,
  contract_type     public.contract_type not null default 'other',
  -- §29/§30 — la controparte è METADATO CONTRATTUALE, non un'anagrafica. Nessun
  -- riferimento a una tabella di clienti o fornitori: quella tabella non esiste,
  -- e crearla qui significherebbe cominciare un CRM di straforo (§136).
  counterparty_name text,

  -- §7 — il responsabile interno del rapporto. ⚠️ NON è l'assegnatario di
  -- un'attività (§8): l'uno risponde del contratto, l'altro di un compito. Un
  -- trigger verifica che sia membro della stessa azienda (§102).
  owner_user_id     uuid references auth.users(id) on delete set null,

  review_status     public.contract_review_status not null default 'needs_review',
  lifecycle_status  public.contract_lifecycle_status not null default 'unknown',
  origin            public.contract_origin not null default 'manual',

  -- La versione dei termini attualmente IN VIGORE, cioè verificata da una
  -- persona. `null` finché nessuno ha verificato nulla: in quel caso
  -- l'interfaccia mostra la bozza dichiarandola tale, e non la spaccia per un
  -- termine accertato. La chiave esterna si aggiunge più sotto.
  current_term_version_id uuid,

  quality_flags     public.contract_quality_flag[] not null default '{}',
  -- Nota interna dell'azienda. Non è un dato del contratto e non entra in
  -- nessuna estrazione: è il posto dove scrivere «rinegoziare a settembre».
  internal_note     text,

  verified_at       timestamptz,
  verified_by       uuid references auth.users(id) on delete set null,
  archived_at       timestamptz,
  archived_by       uuid references auth.users(id) on delete set null,

  created_by        uuid references auth.users(id) on delete set null,
  workflow_run_id   uuid references public.workflow_runs(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint contract_display_name_not_blank check (btrim(display_name) <> '')
);

comment on table public.contracts is
  'Il rapporto contrattuale. I TERMINI stanno in contract_term_versions (una '
  'versione verificata è immutabile), i fatti letti in contract_extractions, i '
  'documenti restano in documents: qui c''è ciò che una persona decide.';
comment on column public.contracts.lifecycle_status is
  'Stato operativo. NON si deriva da una data passata (§118): un contratto con '
  'rinnovo tacito e scadenza superata non è finito, e dichiararlo tale '
  'spegnerebbe la sorveglianza su un impegno ancora in vigore.';


-- ---------------------------------------------------------------------------
-- 5. contract_documents — UN CONTRATTO, PIÙ DOCUMENTI
--
-- §5, ed è il punto in cui questo modulo si distingue da una cartella di PDF.
-- Il documento NON viene copiato (§4/§76): qui c'è un riferimento e il RUOLO che
-- quel documento ha nel rapporto.
--
-- ⚠️ Lo stato di lavorazione sta QUI e non sul contratto: ogni documento si
-- legge per conto proprio, e un allegato che non si riesce a leggere non deve
-- far sembrare guasto l'intero contratto.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_documents (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  contract_id       uuid not null references public.contracts(id) on delete cascade,
  -- `cascade`: se il documento sparisce non deve restare un collegamento al
  -- nulla. Il contratto sopravvive — un contratto senza documenti è uno stato
  -- legittimo (creato a mano, in attesa che il PDF arrivi).
  document_id       uuid not null references public.documents(id) on delete cascade,

  relation          public.contract_document_relation not null default 'other',
  origin            public.contract_origin not null default 'manual',

  processing_status public.contract_processing_status not null default 'pending',
  current_extraction_id uuid,
  extraction_attempts   integer not null default 0,
  error_code        text,

  -- §77 — un suggerimento accettato resta tracciato come tale: «l'ha collegato
  -- una persona» e «l'ha proposto il sistema e una persona ha detto sì» sono due
  -- storie diverse, e la seconda va ricostruibile.
  suggested         boolean not null default false,
  added_by          uuid references auth.users(id) on delete set null,
  added_at          timestamptz not null default now(),

  constraint uq_contract_document unique (contract_id, document_id)
);

comment on table public.contract_documents is
  'Il ruolo di un documento dentro un contratto. Il file NON viene copiato: '
  'resta del documento. Un amendment collegato apre una revisione (§26).';


-- ---------------------------------------------------------------------------
-- 6. contract_extractions — IL VERBALE, IMMUTABILE E VERSIONATO
--
-- §11/§13 — stessa disciplina di `document_analyses` (0010) e di
-- `finance_extractions` (0021): uno snapshot non si corregge, si affianca. Un
-- secondo tentativo produce la versione 2 e la 1 resta leggibile.
--
-- ⚠️ L'ESTRAZIONE È PER DOCUMENTO, NON PER CONTRATTO, e non è un dettaglio:
-- l'accordo principale dice preavviso 3 mesi, l'amendment dice 6. Se
-- l'estrazione fosse del contratto, la seconda lettura cancellerebbe la prima e
-- con essa la possibilità di rispondere a «da dove viene questo termine?».
-- I TERMINI IN VIGORE sono un'altra cosa e stanno nel punto 7.
--
-- ⚠️ PERCHÉ NON SI ESTENDE `document_analyses` CON QUARANTA COLONNE (§12).
-- Quella tabella descrive un documento amministrativo — mittente, scadenza,
-- importo, azioni — ed è letta da Admin AI, dal Document Hub, dalle Attività,
-- dalle Automazioni e da Finance. Aggiungerle «ancoraggio del preavviso» e
-- «modalità di disdetta» significherebbe far portare a tutti il peso di un
-- dominio che riguarda un documento su venti, e obbligare ogni lettore a sapere
-- quali colonne sono nulle perché il documento non è un contratto.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_extractions (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  contract_id        uuid not null references public.contracts(id) on delete cascade,
  document_id        uuid not null references public.documents(id) on delete cascade,
  extraction_version integer not null default 1,
  status             public.contract_extraction_status not null default 'completed',

  method             text not null default 'ai',
  provider           text,
  model              text,
  prompt_version     text,
  schema_version     integer not null default 1,

  -- ---- Che cosa sembra essere ---------------------------------------------
  detected_type      public.contract_type,
  -- §3 — i contratti fuori perimetro. Testo LIBERO e non un enum: qui non si
  -- classifica, si RIPORTA che cosa il documento sembra essere, perché la sola
  -- decisione che il prodotto prende è «non me ne occupo io».
  out_of_scope_kind  text,

  -- ---- Le parti (§29) ------------------------------------------------------
  company_party      text,
  counterparty       text,
  counterparty_address text,

  -- ---- Le date (§32/§33) ---------------------------------------------------
  -- ⚠️ TRE DATE DIVERSE E NON UNA. La data stampata sul documento, la data della
  -- firma e la data da cui il contratto ha effetto sono tre fatti distinti che
  -- coincidono spesso e non sempre; fonderli renderebbe impossibile accorgersi
  -- di un contratto firmato a marzo con effetto da luglio.
  document_date      date,
  signature_date     date,
  start_date         date,
  end_date           date,
  end_date_kind      public.contract_end_kind not null default 'unknown',

  -- §34 — la durata minima si estrae SE indicata. ⚠️ Non si trasforma in una
  -- data di fine quando la data d'inizio non è certa: sommare mesi a una data
  -- incerta produce una scadenza che sembra un fatto.
  minimum_term_value integer,
  minimum_term_unit  public.contract_period_unit,

  -- ---- Rinnovo e disdetta (§35–§38, §49, §50) ------------------------------
  auto_renewal       public.contract_auto_renewal not null default 'unclear',
  renewal_period_value integer,
  renewal_period_unit  public.contract_period_unit,

  notice_period_value  integer,
  notice_period_unit   public.contract_period_unit,
  notice_anchor        public.contract_notice_anchor,
  -- Il testo dell'ancoraggio COSÌ COM'È SCRITTO. È ciò che si mostra quando il
  -- calcolo non è possibile: «auf Monatsende» detto in tedesco vale più di
  -- qualunque nostra parafrasi.
  notice_anchor_text   text,

  termination_method   public.contract_termination_method,
  -- §50 — l'indirizzo per la disdetta si estrae, e non diventa MAI il
  -- destinatario di un invio: in questo modulo non esiste alcun invio.
  termination_address  text,

  -- ---- Costi (§52–§56) -----------------------------------------------------
  -- `numeric` senza precisione dichiarata: esatto, come in Finance. Un
  -- `numeric(18,2)` arrotonderebbe in silenzio.
  cost_amount        numeric,
  cost_currency      text,
  cost_frequency     public.contract_cost_frequency not null default 'unknown',
  -- Solo se il documento lo dichiara: `null` è «non lo dice», non «no».
  cost_vat_included  boolean,
  -- §56 — esiste una clausola di adeguamento prezzi. Si segnala la CLAUSOLA, non
  -- si prevede l'importo futuro.
  price_adjustment   boolean not null default false,

  -- ---- Elenchi con citazione (§16/§57/§59/§61) -----------------------------
  -- [{ "party": "…", "text": "…", "cadence": "…", "confidence": 0.8,
  --    "evidence": { "quote": "…", "start": 0, "end": 0, "page": 1 } }]
  obligations        jsonb not null default '[]'::jsonb,
  -- [{ "kind": "exclusivity", "text": "…", "evidence": {…} }] — RILEVAZIONI
  -- FATTUALI, non giudizi: «è presente una clausola di esclusiva» (§60).
  attention_clauses  jsonb not null default '[]'::jsonb,
  -- [{ "text": "…", "amount": "…", "currency": "CHF", "evidence": {…} }]
  penalties          jsonb not null default '[]'::jsonb,
  -- §115 — allegati e condizioni generali RICHIAMATI dal testo.
  referenced_annexes jsonb not null default '[]'::jsonb,

  -- ---- Solo se scritto (§12) -----------------------------------------------
  governing_law      text,
  jurisdiction       text,
  -- §117 — indicazione di firma riconoscibile nel testo. Nessuna verifica
  -- crittografica: non esiste infrastruttura per farla, e affermarla sarebbe
  -- una garanzia inventata.
  signed             boolean,

  -- ---- Provenienza, fiducia, citazioni, incertezze -------------------------
  field_sources      jsonb not null default '{}'::jsonb,
  field_confidence   jsonb not null default '{}'::jsonb,
  evidence           jsonb not null default '{}'::jsonb,
  uncertainties      jsonb not null default '[]'::jsonb,
  quality_flags      public.contract_quality_flag[] not null default '{}',
  document_language  text,
  -- §113 — il documento non ci stava per intero. Non è un dettaglio tecnico: è
  -- la ragione per cui una clausola importante può mancare, e va detto.
  truncated          boolean not null default false,

  -- §112 — impronta del testo letto. Rileggere due volte lo stesso identico
  -- documento è spesa pura: se l'impronta coincide con quella dell'ultima
  -- estrazione riuscita, non si richiama il modello.
  content_hash       text,

  error_code         text,
  input_tokens       integer,
  output_tokens      integer,
  duration_ms        integer,
  created_at         timestamptz not null default now(),

  constraint uq_contract_extraction_version
    unique (contract_id, document_id, extraction_version)
);

-- I collegamenti all'estrazione corrente si dichiarano QUI: le tabelle si
-- riferiscono a vicenda e alla creazione della prima la seconda non esiste.
-- `set null` e non `cascade`: se un giorno si potassero i verbali vecchi, il
-- collegamento deve sopravvivere alla potatura invece di sparire con essa.
do $$ begin
  alter table public.contract_documents
    add constraint contract_documents_current_extraction_fkey
    foreign key (current_extraction_id) references public.contract_extractions(id)
    on delete set null;
exception when duplicate_object then null; end $$;

comment on table public.contract_extractions is
  'Verbale IMMUTABILE della lettura contrattuale di UN documento. L''accordo e '
  'il suo amendment hanno estrazioni distinte: è ciò che permette di dire da '
  'quale documento viene un termine.';


-- ---------------------------------------------------------------------------
-- 7. contract_term_versions — I TERMINI, VERSIONATI
--
-- ⚠️⚠️ IL CUORE DEL MODULO. LEGGERE PRIMA DI CAMBIARE QUALUNQUE COSA QUI.
--
-- §24/§25 — «l'accordo dice preavviso 3 mesi, l'amendment dice 6» non si risolve
-- sovrascrivendo. Qui una versione è una FOTOGRAFIA dei termini in vigore a
-- partire da una certa data, e le versioni si accumulano.
--
-- LE DUE FACCE DI QUESTA TABELLA:
--   · una BOZZA (`draft`) è ciò che il sistema PROPONE. Si ricalcola da sola —
--     versione verificata precedente, più le estrazioni, più le correzioni
--     umane — e non è mai un termine in vigore. Ne esiste al massimo una per
--     contratto (indice unico parziale più sotto).
--   · una versione VERIFICATA è ciò che una PERSONA ha confermato. Da quel
--     momento è IMMUTABILE (trigger), diventa `contracts.current_term_version_id`
--     e la precedente passa a `superseded` restando leggibile.
--
-- ⚠️ PERCHÉ NON BASTAVA «CORREZIONE VINCE SULL'ESTRAZIONE» COME IN FINANCE.
-- Su una fattura il valore giusto è uno solo e il tempo non lo cambia: l'importo
-- letto male oggi era sbagliato anche ieri. Un contratto no — il preavviso di
-- tre mesi ERA vero fino all'amendment, e resta la risposta giusta alla domanda
-- «che cosa valeva a gennaio?». Una proiezione a valore unico cancellerebbe
-- quella risposta ogni volta che arriva un documento nuovo.
--
-- ⚠️ UN AMENDMENT NON CAMBIA I TERMINI DA SOLO (§28). Produce una bozza e mette
-- il contratto in `review_required_again`: fino alla verifica umana, i termini
-- in vigore restano quelli di prima. Questa riga è la ragione per cui la
-- gestione degli amendment non è una funzione, ma una tabella.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_term_versions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  contract_id       uuid not null references public.contracts(id) on delete cascade,
  version           integer not null,
  status            public.contract_term_version_status not null default 'draft',

  -- Da quando questi termini valgono, SE il documento lo dice. Non si deduce
  -- dalla data di caricamento: un amendment firmato a giugno con effetto da
  -- gennaio non ha effetto da giugno.
  effective_from    date,

  -- ---- I termini (gli stessi campi dell'estrazione, per confronto diretto) --
  counterparty_name text,
  company_party     text,
  start_date        date,
  end_date          date,
  end_date_kind     public.contract_end_kind not null default 'unknown',
  minimum_term_value integer,
  minimum_term_unit  public.contract_period_unit,
  auto_renewal      public.contract_auto_renewal not null default 'unclear',
  renewal_period_value integer,
  renewal_period_unit  public.contract_period_unit,
  notice_period_value  integer,
  notice_period_unit   public.contract_period_unit,
  notice_anchor        public.contract_notice_anchor,
  notice_anchor_text   text,
  termination_method   public.contract_termination_method,
  termination_address  text,
  cost_amount       numeric,
  cost_currency     text,
  cost_frequency    public.contract_cost_frequency not null default 'unknown',
  cost_vat_included boolean,
  price_adjustment  boolean not null default false,

  -- ---- Provenienza ---------------------------------------------------------
  -- §25 — da quali documenti vengono questi termini. Un array e non una singola
  -- chiave: una versione può nascere dall'accordo più il suo amendment.
  source_extraction_ids uuid[] not null default '{}',
  -- La versione verificata da cui questa bozza è partita. È ciò che permette il
  -- confronto «prima / adesso» (§27) senza ricostruirlo a mano.
  based_on_version_id uuid references public.contract_term_versions(id) on delete set null,

  verified_at       timestamptz,
  verified_by       uuid references auth.users(id) on delete set null,
  superseded_at     timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint uq_contract_term_version unique (contract_id, version),
  -- Una versione verificata ha sempre il suo timbro: «verificata da nessuno» non
  -- è uno stato, è un difetto.
  constraint contract_term_verified_stamped
    check (status <> 'verified' or verified_at is not null)
);

-- ⚠️ UNA SOLA BOZZA PER CONTRATTO. Due bozze significherebbero due proposte
-- diverse sugli stessi termini, e nessun modo di dire quale l'interfaccia stia
-- mostrando. L'indice unico parziale lo rende impossibile invece di improbabile.
create unique index if not exists uq_contract_single_draft
  on public.contract_term_versions (contract_id)
  where status = 'draft';

do $$ begin
  alter table public.contracts
    add constraint contracts_current_term_version_fkey
    foreign key (current_term_version_id) references public.contract_term_versions(id)
    on delete set null;
exception when duplicate_object then null; end $$;

comment on table public.contract_term_versions is
  'I termini contrattuali, versionati. Una bozza è ciò che il sistema propone e '
  'si ricalcola; una versione verificata è ciò che una persona ha confermato ed '
  'è immutabile. Un amendment non cambia i termini in vigore: crea una bozza.';


-- ---------------------------------------------------------------------------
-- 8. contract_corrections — LE CORREZIONI UMANE, IN AGGIUNTA
--
-- §21/§22 — append-only, come `finance_corrections`. L'estrazione non si tocca:
-- il valore originariamente letto resta sempre visibile e auditabile.
--
-- ⚠️ LA CORREZIONE SI APPLICA ALLA BOZZA, NON AL CONTRATTO.
-- È la conseguenza del punto 7: correggere «il preavviso» senza dire di QUALE
-- versione si parla vorrebbe dire riscrivere anche il passato. La bozza a cui la
-- correzione appartiene resta scritta nella riga, e quando quella bozza viene
-- verificata la correzione diventa parte di una versione immutabile.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_corrections (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  contract_id     uuid not null references public.contracts(id) on delete cascade,
  term_version_id uuid not null references public.contract_term_versions(id) on delete cascade,
  -- Quale verbale era in vigore quando la persona ha corretto. `set null`: la
  -- correzione sopravvive comunque.
  extraction_id   uuid references public.contract_extractions(id) on delete set null,
  field           text not null,
  original_value  jsonb,
  corrected_value jsonb,
  corrected_by    uuid references auth.users(id) on delete set null,
  corrected_at    timestamptz not null default now(),

  -- Elenco CHIUSO, come in Finance: un campo fuori elenco non è «un campo che
  -- non conosciamo», è una scrittura che non deve avvenire, perché il ricalcolo
  -- non saprebbe che farsene e il dato resterebbe invisibile.
  constraint contract_correction_field_known check (field in (
    'counterparty_name', 'company_party',
    'start_date', 'end_date', 'end_date_kind',
    'minimum_term_value', 'minimum_term_unit',
    'auto_renewal', 'renewal_period_value', 'renewal_period_unit',
    'notice_period_value', 'notice_period_unit', 'notice_anchor', 'notice_anchor_text',
    'termination_method', 'termination_address',
    'cost_amount', 'cost_currency', 'cost_frequency', 'cost_vat_included',
    'price_adjustment', 'effective_from'
  ))
);

comment on table public.contract_corrections is
  'Correzioni umane, append-only, riferite a UNA bozza di termini. '
  'L''estrazione resta intatta e il valore letto dalla macchina resta visibile.';


-- ---------------------------------------------------------------------------
-- 9. contract_milestones — LE DATE CHE MERITANO ATTENZIONE
--
-- §40–§44. Una milestone è una DATA, non un momento: `date` e non `timestamptz`.
-- «Il preavviso scade il 30 settembre» non ha un'ora, e dargliela obbligherebbe
-- a scegliere un fuso — cioè a inventare un dato per far tornare un tipo.
--
-- ⚠️ CANDIDATA ≠ VERIFICATA, ED È LA DISTINZIONE PIÙ IMPORTANTE DEL MODULO.
-- Una data derivata da una clausola di preavviso è una PROPOSTA: nasce
-- `candidate` e non può generare lavoro (§87). Solo dopo che una persona l'ha
-- guardata diventa `verified`, e da lì in poi è materia di attività, calendario
-- e automazioni.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_milestones (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  contract_id       uuid not null references public.contracts(id) on delete cascade,
  -- Da quale versione dei termini discende. `null` per le date messe a mano, che
  -- non discendono da nessun termine ma da una decisione.
  term_version_id   uuid references public.contract_term_versions(id) on delete set null,

  kind              public.contract_milestone_kind not null,
  due_date          date not null,
  -- Il default è `manual` perché il client non ha il permesso di scrivere questa
  -- colonna: quando una persona aggiunge una data dall'interfaccia, il valore
  -- che arriva è questo. Il prodotto, che scrive dal trigger, lo dichiara sempre
  -- esplicitamente.
  source            public.contract_milestone_source not null default 'manual',
  status            public.contract_milestone_status not null default 'candidate',

  -- §42 — la provenienza di un CALCOLO. Senza questi campi una data derivata
  -- sarebbe indistinguibile da una letta, e nessuno potrebbe rispondere a
  -- «perché il 30 settembre?».
  calculation       text,
  calculation_version integer,
  calculation_inputs jsonb not null default '{}'::jsonb,

  -- Etichetta libera, per `other` e per le date manuali.
  label             text,

  -- §95 — quando la finestra di attenzione si è aperta. Serve a emettere
  -- l'evento UNA volta sola: senza, ogni passaggio del worker lo riemetterebbe e
  -- il motore creerebbe un'attività ogni cinque minuti.
  window_opened_at  timestamptz,

  verified_at       timestamptz,
  verified_by       uuid references auth.users(id) on delete set null,
  dismissed_at      timestamptz,
  dismissed_by      uuid references auth.users(id) on delete set null,

  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  -- Una data verificata porta sempre il suo timbro.
  constraint contract_milestone_verified_stamped
    check (status <> 'verified' or verified_at is not null),
  -- Una data DERIVATA dichiara sempre da quale calcolo viene (§42). Senza questo
  -- vincolo, un giorno qualcuno inserirebbe una derivata senza provenienza e
  -- nessuno saprebbe più distinguerla da una letta nel documento.
  constraint contract_milestone_derived_has_provenance
    check (source <> 'derived' or (calculation is not null and calculation_version is not null))
);

comment on table public.contract_milestones is
  'Date del contratto. `candidate` è una proposta del sistema e NON può '
  'generare lavoro; `verified` è una data che una persona ha confermato. Una '
  'data derivata dichiara sempre il calcolo da cui viene.';


-- ---------------------------------------------------------------------------
-- 10. contract_events — LO STORICO
--
-- Lo scrivono i trigger. Il client non può inserirlo: uno storico che una
-- schermata può fabbricare non è uno storico.
-- ---------------------------------------------------------------------------
create table if not exists public.contract_events (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,
  contract_id   uuid not null references public.contracts(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  kind          public.contract_event_kind not null,
  -- ⚠️ SOLO IDENTIFICATIVI E CHIAVI (§110). Nel dettaglio di un evento non entra
  -- il testo di una clausola, un indirizzo, un importo o il nome di una parte:
  -- lo storico è leggibile da ogni membro dell'azienda e non deve diventare una
  -- seconda copia del contratto.
  detail        jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 11. Le attività sanno a quale contratto appartengono
--
-- §88 — «NON mettere contract ID nella description». Una descrizione non è un
-- riferimento: non si può interrogare, non regge una chiave esterna e diventa
-- falsa il giorno in cui il contratto viene rinominato.
--
-- ⚠️ QUI SERVE UN GUARDIANO, NON UN GRANT DI COLONNA.
-- Su `tasks` la 0004 concede `select, insert, update, delete` di TABELLA a
-- `authenticated`. Un `grant (contract_id)` scritto ora non toglierebbe nulla —
-- è la lezione della 0014, dove i permessi di colonna dichiarati nei commenti
-- non restringevano niente. L'unica difesa possibile è un trigger che confronti
-- le aziende (§105), ed è quello che c'è al punto 16.
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists contract_id uuid references public.contracts(id) on delete set null,
  add column if not exists contract_milestone_id uuid
    references public.contract_milestones(id) on delete set null;

comment on column public.tasks.contract_id is
  'Il contratto da cui l''attività nasce. Chiave esterna e non testo nella '
  'descrizione: un riferimento deve reggere una rinomina e una interrogazione.';


-- ---------------------------------------------------------------------------
-- 12. Indici
--
-- §160 — ognuno corrisponde a una clausola che le funzioni di questo file
-- scrivono davvero. Nessun indice «per sicurezza»: un indice che nessuna query
-- usa è solo scrittura più lenta.
-- ---------------------------------------------------------------------------

-- La lista predefinita: contratti non archiviati di un'azienda.
create index if not exists idx_contracts_active
  on public.contracts (company_id, updated_at desc)
  where archived_at is null;

-- La vista rapida «Da verificare» e il KPI omonimo.
create index if not exists idx_contracts_review
  on public.contracts (company_id, review_status)
  where archived_at is null;

create index if not exists idx_contracts_lifecycle
  on public.contracts (company_id, lifecycle_status)
  where archived_at is null;

create index if not exists idx_contracts_type
  on public.contracts (company_id, contract_type)
  where archived_at is null;

-- «Senza responsabile» è un KPI (§67): l'indice parziale lo rende un accesso
-- diretto invece di una scansione di tutti i contratti dell'azienda.
create index if not exists idx_contracts_owner
  on public.contracts (company_id, owner_user_id)
  where archived_at is null;

create index if not exists idx_contracts_archived
  on public.contracts (company_id, archived_at desc)
  where archived_at is not null;

-- La ricerca per nome e controparte (§68). Stessa forma degli indici trigram del
-- Document Hub (0017), su un'espressione: un `coalesce` evita che una
-- controparte non ancora nota escluda la riga dall'indice.
create index if not exists idx_contracts_text_trgm
  on public.contracts using gin (
    (coalesce(display_name, '') || ' ' || coalesce(counterparty_name, '')) gin_trgm_ops
  );

create index if not exists idx_contract_documents_contract
  on public.contract_documents (contract_id, relation);
-- Da un documento ai suoi contratti: serve al Document Hub («questo documento
-- appartiene al contratto X») e al riconoscimento dei suggerimenti.
create index if not exists idx_contract_documents_document
  on public.contract_documents (document_id);
-- La coda del worker: i documenti da leggere, i più vecchi per primi.
create index if not exists idx_contract_documents_pending
  on public.contract_documents (processing_status, added_at)
  where processing_status in ('pending', 'processing');

create index if not exists idx_contract_extractions_doc
  on public.contract_extractions (contract_id, document_id, extraction_version desc);
create index if not exists idx_contract_extractions_hash
  on public.contract_extractions (document_id, content_hash)
  where status = 'completed';

create index if not exists idx_contract_terms_contract
  on public.contract_term_versions (contract_id, version desc);

create index if not exists idx_contract_corrections_version
  on public.contract_corrections (term_version_id, corrected_at);

-- Le milestone che contano: quelle ancora in gioco, per data. È l'interrogazione
-- di «Rinnovi prossimi», di «Preavvisi prossimi» e del worker che apre le
-- finestre.
create index if not exists idx_contract_milestones_open
  on public.contract_milestones (company_id, due_date, status)
  where status in ('candidate', 'verified');
create index if not exists idx_contract_milestones_contract
  on public.contract_milestones (contract_id, due_date);
-- Il worker cerca le verificate la cui finestra non è ancora stata aperta.
create index if not exists idx_contract_milestones_window
  on public.contract_milestones (due_date)
  where status = 'verified' and window_opened_at is null;

create index if not exists idx_contract_events_contract
  on public.contract_events (contract_id, created_at desc);

-- Le attività di un contratto (§90) e il controllo di deduplicazione (§93).
create index if not exists idx_tasks_contract
  on public.tasks (contract_id)
  where contract_id is not null;
create index if not exists idx_tasks_contract_milestone
  on public.tasks (contract_milestone_id)
  where contract_milestone_id is not null;


-- ---------------------------------------------------------------------------
-- 13. L'ARITMETICA DELLE DATE
--
-- ⚠️⚠️ §47 — L'AI NON CALCOLA MAI UNA DATA. Il modello può leggere «tre mesi
-- prima della scadenza»; la data la fa questo codice, che è deterministico,
-- ripetibile e messo alla prova sui casi difficili da `npm run test:contracts`.
--
-- ⚠️ PERCHÉ IL CALCOLO STA IN SQL E NON IN TYPESCRIPT.
-- Perché deve stare in UN POSTO SOLO, e il posto in cui le date NASCONO è qui:
-- le milestone le scrive un trigger, nella stessa transazione della verifica dei
-- termini, così una persona che verifica vede subito le date invece di
-- aspettare un worker. Scriverlo anche in TypeScript creerebbe il doppione che
-- questo progetto ha già pagato con `urgencyFrom`, e su una data un doppione
-- che diverge è una scadenza sbagliata.
--
-- ⚠️ SEMANTICA DI POSTGRES, VERIFICATA E NON SUPPOSTA: sottrarre mesi da una
-- data «aggancia» la fine del mese quando il giorno non esiste
-- (31.03 − 1 mese → 28.02, e in un anno bisestile → 29.02). È il comportamento
-- che serve, ed è quello che `test:contracts` verifica contro il database vero
-- invece di fidarsi di questo commento.
-- ---------------------------------------------------------------------------
create or replace function public.contract_period_interval(
  p_value integer,
  p_unit  public.contract_period_unit
)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case
    when p_value is null or p_unit is null or p_value <= 0 then null
    when p_unit = 'days'   then make_interval(days   => p_value)
    when p_unit = 'weeks'  then make_interval(weeks  => p_value)
    when p_unit = 'months' then make_interval(months => p_value)
    when p_unit = 'years'  then make_interval(years  => p_value)
  end
$$;

comment on function public.contract_period_interval(integer, public.contract_period_unit) is
  'Un periodo contrattuale come intervallo. NULL su valori non positivi o unità '
  'assente: un periodo che non si sa non è un periodo di zero giorni.';

/*
 * Il termine ultimo di disdetta, SE è derivabile.
 *
 * ⚠️⚠️ §39/§45/§46 — QUESTA FUNZIONE RESTITUISCE NULL PIÙ SPESSO DI QUANTO
 * SEMBRI RAGIONEVOLE, ED È IL SUO SCOPO.
 *
 * CHE COSA SI CALCOLA (e di cui il prodotto risponde):
 *   · preavviso ancorato a una FINE ESPLICITA         → fine − periodo
 *   · preavviso ancorato a una DATA DI RINNOVO nota   → rinnovo − periodo
 *
 * CHE COSA NON SI CALCOLA, E NON PER MANCANZA DI TEMPO:
 *   · «auf Monatsende» / «per fine mese» — servirebbe sapere a quale scadenza il
 *     preavviso si riferisce e come le due regole si compongono. Due letture
 *     legittime della stessa clausola danno due date diverse, e sceglierne una
 *     significherebbe che il prodotto ha deciso una questione di
 *     interpretazione del contratto.
 *   · fine trimestre, fine anno — stessa ragione.
 *   · «in qualsiasi momento» — non esiste una scadenza a cui ancorare.
 *   · ancoraggio ignoto o assente — §39 alla lettera.
 *   · durata minima senza data d'inizio certa (§34) — sommare mesi a una data
 *     incerta produce una scadenza che sembra un fatto.
 *
 * In tutti questi casi l'interfaccia mostra il preavviso, mostra la clausola da
 * cui viene, e dichiara che una data non è derivabile. È la risposta onesta, e
 * l'unica che non produce una scadenza sbagliata su cui qualcuno agirebbe.
 */
create or replace function public.contract_notice_deadline(
  p_notice_value  integer,
  p_notice_unit   public.contract_period_unit,
  p_anchor        public.contract_notice_anchor,
  p_reference_date date
)
returns date
language sql
immutable
set search_path = ''
as $$
  select case
    when p_reference_date is null then null
    when p_anchor is null or p_anchor not in ('before_fixed_end', 'before_renewal_date') then null
    when public.contract_period_interval(p_notice_value, p_notice_unit) is null then null
    else (p_reference_date - public.contract_period_interval(p_notice_value, p_notice_unit))::date
  end
$$;

comment on function public.contract_notice_deadline(integer, public.contract_period_unit, public.contract_notice_anchor, date) is
  'Il termine ultimo di disdetta, SOLO per gli ancoraggi di cui il prodotto '
  'risponde (fine esplicita, data di rinnovo). NULL su «per fine mese», fine '
  'trimestre, «in qualsiasi momento» e ancoraggio ignoto: là la semantica non è '
  'univoca e una data calcolata sarebbe un''interpretazione travestita da fatto.';

/** La versione del calcolo, scritta su ogni data derivata (§42). */
create or replace function public.contract_calculation_version()
returns integer language sql immutable set search_path = '' as $$ select 1 $$;


-- ---------------------------------------------------------------------------
-- 14. Il guardiano del contratto
--
-- Chi ha verificato, chi ha archiviato e quando: lo scrive il database da
-- `auth.uid()` e `now()`, mai il client (§107). Il client dichiara l'INTENZIONE,
-- il valore vero lo mette qui.
--
-- ⚠️ §102 — IL RESPONSABILE DEVE ESSERE MEMBRO DELL'AZIENDA, e il controllo sta
-- qui e non nel servizio: un servizio ben educato non è una garanzia. Vale anche
-- per il worker e per gli script, che passano di qui come tutti.
-- ---------------------------------------------------------------------------
create or replace function public.contracts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Il responsabile, se indicato, è membro di QUESTA azienda (§102/§154).
  if new.owner_user_id is not null and (
       tg_op = 'INSERT' or new.owner_user_id is distinct from old.owner_user_id
     ) then
    if not exists (
      select 1 from public.company_members m
      where m.company_id = new.company_id and m.user_id = new.owner_user_id
    ) then
      raise exception 'contract_owner_not_member'
        using errcode = '23514',
              hint = 'Il responsabile di un contratto deve essere membro dell''azienda.';
    end if;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    -- Chi ha creato il contratto lo stabilisce il database. Il client non ha il
    -- permesso di colonna su `origin`, quindi un inserimento dall'interfaccia
    -- prenderebbe il default e direbbe di essere nato da una regola. Stessa
    -- distinzione sistema/persona di `documents_guard` e `finance_items_guard`:
    -- `auth.uid()` da solo non basta, perché un trigger può scattare mentre una
    -- persona è in sessione; `pg_trigger_depth() > 1` dice che a scrivere è
    -- stato il prodotto.
    if auth.uid() is not null and pg_trigger_depth() <= 1 then
      new.origin := 'manual';
    end if;
    -- Nessun contratto nasce verificato: la verifica è un gesto umano (§82).
    new.review_status := 'needs_review';
    new.verified_at := null;
    new.verified_by := null;
    new.archived_by := null;
    new.current_term_version_id := null;
    new.quality_flags := '{}';
    if new.archived_at is not null then new.archived_at := now(); end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- ---- UPDATE ------------------------------------------------------------
  new.company_id := old.company_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.origin     := old.origin;
  new.updated_at := now();

  -- ⚠️ IL TIMBRO DI VERIFICA E LA VERSIONE CORRENTE NON SI SCRIVONO DAL CLIENT.
  -- Verificare un contratto significa verificare una VERSIONE DEI TERMINI, e
  -- quel percorso è `contract_verify_terms` (punto 24), che è l'unico posto in
  -- cui questi tre campi cambiano insieme e in modo coerente. Un client che
  -- scrivesse `review_status = 'verified'` da solo otterrebbe un contratto
  -- «verificato» senza alcuna versione verificata dietro: la dichiarazione
  -- senza il fatto.
  --
  -- ⚠️ DUE SENTINELLE E NON UNA, e la differenza è sostanziale.
  -- `contract_verify` è il gesto umano completo: cambia stato, timbro e versione
  -- in vigore. `contract_review` è la RIAPERTURA che un amendment provoca: tocca
  -- SOLO lo stato, e lascia deliberatamente in piedi `verified_at`/`verified_by`
  -- della verifica precedente — §84 chiede di non cancellare la storia delle
  -- verifiche, e «era stato verificato il 3 marzo, poi è arrivata una modifica»
  -- è proprio ciò che si vuole poter dire.
  --
  -- ⚠️ Senza la seconda sentinella la riapertura sarebbe stata annullata QUI, in
  -- silenzio: l'amendment sarebbe arrivato, la bozza si sarebbe formata, e il
  -- contratto avrebbe continuato a dichiararsi verificato. Il difetto peggiore
  -- di questo modulo, evitato per un soffio.
  if coalesce(current_setting('ai_swisse.contract_verify', true), '') = '1' then
    null;   -- il percorso di verifica scrive tutto ciò che gli serve
  elsif coalesce(current_setting('ai_swisse.contract_review', true), '') = '1' then
    new.verified_at := old.verified_at;
    new.verified_by := old.verified_by;
    new.current_term_version_id := old.current_term_version_id;
  else
    new.review_status  := old.review_status;
    new.verified_at    := old.verified_at;
    new.verified_by    := old.verified_by;
    new.current_term_version_id := old.current_term_version_id;
  end if;

  -- La proiezione delle bandiere la ricalcola `contract_refresh_flags`.
  if coalesce(current_setting('ai_swisse.contract_refresh', true), '') <> '1' then
    new.quality_flags := old.quality_flags;
  end if;

  -- Archiviazione: solo alla PRIMA, come su `documents` e `finance_items`.
  if new.archived_at is not null and old.archived_at is null then
    new.archived_at := now();
    new.archived_by := auth.uid();
  elsif new.archived_at is null then
    new.archived_by := null;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  return new;
end $$;

drop trigger if exists trg_contracts_guard on public.contracts;
create trigger trg_contracts_guard
  before insert or update on public.contracts
  for each row execute function public.contracts_guard();


-- ---------------------------------------------------------------------------
-- 15. Il guardiano dei documenti collegati
--
-- §104 — UN CONTRATTO DELL'AZIENDA A NON PUÒ PUNTARE A UN DOCUMENTO DI B.
-- La RLS lo impedirebbe dal client, ma questa funzione è `security definer` e
-- deve difendersi da sola: è la disciplina imparata con la 0017, dove una
-- policy scritta altrove non bastava a proteggere un trigger che la scavalca.
-- ---------------------------------------------------------------------------
create or replace function public.contract_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract_company uuid;
  v_doc_company      uuid;
begin
  select c.company_id into v_contract_company
    from public.contracts c where c.id = new.contract_id;
  select d.company_id into v_doc_company
    from public.documents d where d.id = new.document_id;

  if v_contract_company is null or v_doc_company is null
     or v_contract_company is distinct from v_doc_company
     or v_contract_company is distinct from new.company_id then
    raise exception 'contract_document_company_mismatch'
      using errcode = '23514',
            hint = 'Il documento e il contratto devono appartenere alla stessa azienda.';
  end if;

  if tg_op = 'INSERT' then
    new.added_by := auth.uid();
    new.added_at := now();
    if auth.uid() is not null and pg_trigger_depth() <= 1 then
      new.origin := 'manual';
    end if;
    new.current_extraction_id := null;
    new.extraction_attempts := 0;
    new.error_code := null;
    -- Ogni documento nuovo va letto: nasce in coda. Il worker lo prenderà.
    new.processing_status := 'pending';
    return new;
  end if;

  new.company_id  := old.company_id;
  new.contract_id := old.contract_id;
  new.document_id := old.document_id;
  new.added_by    := old.added_by;
  new.added_at    := old.added_at;

  -- Rimettere in coda è legittimo («Riprova lettura», §131), ma solo da uno
  -- stato FERMO: rimettere in coda ciò che è già in lavorazione produrrebbe due
  -- letture concorrenti sullo stesso documento.
  if new.processing_status = 'pending' and old.processing_status = 'processing' then
    new.processing_status := old.processing_status;
  end if;
  return new;
end $$;

drop trigger if exists trg_contract_documents_guard on public.contract_documents;
create trigger trg_contract_documents_guard
  before insert or update on public.contract_documents
  for each row execute function public.contract_documents_guard();


-- ---------------------------------------------------------------------------
-- 16. Il guardiano del legame fra attività e contratto
--
-- §105 — stessa difesa del punto 15, dall'altra parte. È l'UNICA difesa
-- possibile: su `tasks` il ruolo `authenticated` ha i permessi di tabella
-- completi dalla 0004, e nessun grant di colonna scritto oggi li restringerebbe
-- (lezione della 0014).
-- ---------------------------------------------------------------------------
create or replace function public.tasks_contract_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company   uuid;
  v_ms_contract uuid;
  v_ms_company  uuid;
begin
  if new.contract_id is not null then
    select c.company_id into v_company from public.contracts c where c.id = new.contract_id;
    if v_company is null or v_company is distinct from new.company_id then
      raise exception 'task_contract_company_mismatch'
        using errcode = '23514',
              hint = 'L''attività e il contratto devono appartenere alla stessa azienda.';
    end if;
  end if;

  if new.contract_milestone_id is not null then
    select m.contract_id, m.company_id into v_ms_contract, v_ms_company
      from public.contract_milestones m where m.id = new.contract_milestone_id;
    if v_ms_company is null or v_ms_company is distinct from new.company_id then
      raise exception 'task_milestone_company_mismatch'
        using errcode = '23514',
              hint = 'L''attività e la data del contratto devono appartenere alla stessa azienda.';
    end if;
    -- Una data appartiene a un contratto: agganciare l'attività alla data di un
    -- contratto e al riferimento di un altro produrrebbe una schermata che dice
    -- due cose diverse sulla stessa riga.
    if new.contract_id is not null and new.contract_id is distinct from v_ms_contract then
      raise exception 'task_milestone_contract_mismatch'
        using errcode = '23514',
              hint = 'La data indicata appartiene a un altro contratto.';
    end if;
    if new.contract_id is null then new.contract_id := v_ms_contract; end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_tasks_contract_guard on public.tasks;
create trigger trg_tasks_contract_guard
  before insert or update of contract_id, contract_milestone_id, company_id on public.tasks
  for each row execute function public.tasks_contract_guard();


-- ---------------------------------------------------------------------------
-- 17. Le estrazioni sono IMMUTABILI (§13)
--
-- Stessa disciplina della 0010 e della 0021. Il divieto vale anche per il
-- service role, perché il worker gira proprio con quello e un giorno qualcuno
-- potrebbe pensare di «aggiornare» un verbale invece di scriverne uno nuovo.
--
-- ⚠️ SOLO `update`, MAI `delete` — è la lezione della 0023, pagata cara: un
-- trigger che vietava anche la cancellazione rendeva INDISTRUTTIBILE il
-- documento a monte, perché la cascata passa di qui ed è la conseguenza di una
-- cancellazione già autorizzata altrove. La cancellazione la impediscono i
-- PERMESSI (il client non ne ha), che è dove deve stare.
-- ---------------------------------------------------------------------------
create or replace function public.contract_extractions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'contract_extraction_immutable'
    using errcode = '42501',
          hint = 'Un''estrazione non si modifica: se ne scrive una versione nuova.';
end $$;

drop trigger if exists trg_contract_extractions_immutable on public.contract_extractions;
create trigger trg_contract_extractions_immutable
  before update on public.contract_extractions
  for each row execute function public.contract_extractions_immutable();


-- ---------------------------------------------------------------------------
-- 18. Una versione VERIFICATA dei termini è immutabile
--
-- §25 — è ciò che rende vera la frase «l'amendment non sovrascrive». Una bozza
-- si può riscrivere quante volte serve; dal momento in cui una persona la
-- verifica, quei termini sono un fatto storico.
--
-- ⚠️ Anche qui `update` e non `delete`, per la ragione della 0023.
-- ---------------------------------------------------------------------------
create or replace function public.contract_term_versions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Nessuna versione nasce verificata: la si verifica con
    -- `contract_verify_terms`, che è l'unico percorso in cui il timbro, la
    -- versione corrente del contratto e le date restano coerenti fra loro.
    if new.status <> 'draft' then
      raise exception 'contract_term_version_must_start_draft'
        using errcode = '23514',
              hint = 'Una versione dei termini nasce come bozza e viene verificata da una persona.';
    end if;
    new.verified_at := null;
    new.verified_by := null;
    new.superseded_at := null;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- ---- UPDATE ------------------------------------------------------------
  if old.status = 'verified' then
    -- L'unica transizione ammessa su una versione verificata è il passaggio a
    -- `superseded`, che non tocca i termini: dice soltanto che ne esiste una più
    -- recente. Tutto il resto sarebbe riscrivere la storia.
    if new.status = 'superseded'
       and new.start_date is not distinct from old.start_date
       and new.end_date is not distinct from old.end_date
       and new.notice_period_value is not distinct from old.notice_period_value
       and new.notice_period_unit is not distinct from old.notice_period_unit
       and new.notice_anchor is not distinct from old.notice_anchor
       and new.auto_renewal is not distinct from old.auto_renewal
       and new.renewal_period_value is not distinct from old.renewal_period_value
       and new.cost_amount is not distinct from old.cost_amount
       and new.cost_currency is not distinct from old.cost_currency
       and new.cost_frequency is not distinct from old.cost_frequency
       and new.verified_at is not distinct from old.verified_at
       and new.verified_by is not distinct from old.verified_by then
      new.superseded_at := coalesce(old.superseded_at, now());
      new.updated_at := now();
      return new;
    end if;
    raise exception 'contract_term_version_immutable'
      using errcode = '42501',
            hint = 'Una versione verificata dei termini non si modifica: se ne verifica una nuova.';
  end if;

  if old.status = 'superseded' then
    raise exception 'contract_term_version_immutable'
      using errcode = '42501',
            hint = 'Una versione superata resta com''era.';
  end if;

  new.company_id  := old.company_id;
  new.contract_id := old.contract_id;
  new.version     := old.version;
  new.created_at  := old.created_at;
  new.updated_at  := now();
  return new;
end $$;

drop trigger if exists trg_contract_term_versions_guard on public.contract_term_versions;
create trigger trg_contract_term_versions_guard
  before insert or update on public.contract_term_versions
  for each row execute function public.contract_term_versions_guard();


-- ---------------------------------------------------------------------------
-- 19. L'autore di una correzione è chi la scrive
--
-- §106 — RIFIUTA, non riscrive in silenzio. È la lezione dei commenti delle
-- attività (0016): sostituire l'autore e restituire «inserito» produce un
-- risultato sicuro e una conferma falsa.
--
-- ⚠️ SI CORREGGE SOLO UNA BOZZA. Correggere una versione verificata
-- significherebbe cambiare che cosa valeva l'anno scorso: se i termini sono
-- cambiati si verifica una versione nuova, che è esattamente il percorso degli
-- amendment.
-- ---------------------------------------------------------------------------
create or replace function public.contract_corrections_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version record;
  v_text    text;
begin
  select v.id, v.company_id, v.contract_id, v.status
    into v_version
    from public.contract_term_versions v
   where v.id = new.term_version_id;

  if v_version.id is null
     or v_version.company_id is distinct from new.company_id
     or v_version.contract_id is distinct from new.contract_id then
    raise exception 'contract_correction_company_mismatch'
      using errcode = '23514',
            hint = 'La correzione non appartiene all''azienda o al contratto indicato.';
  end if;

  if v_version.status <> 'draft' then
    raise exception 'contract_correction_version_not_draft'
      using errcode = '42501',
            hint = 'Si corregge la versione in preparazione: quelle verificate restano com''erano.';
  end if;

  if auth.uid() is not null and new.corrected_by is not null
     and new.corrected_by is distinct from auth.uid() then
    raise exception 'contract_correction_author_mismatch'
      using errcode = '42501',
            hint = 'Una correzione si firma con il proprio nome.';
  end if;

  -- ⚠️ IL VALORE VA VERIFICATO QUI, NON A VALLE (lezione della 0021).
  -- Il ricalcolo della bozza converte con `try_date`/`try_numeric`, che tornano
  -- NULL su un testo non convertibile e fanno quindi ripiegare sul valore
  -- precedente: una correzione malformata verrebbe SALVATA, comparirebbe fra i
  -- campi corretti a mano, e la schermata continuerebbe a mostrare il valore
  -- vecchio. Una persona convinta di aver corretto una scadenza, e una scadenza
  -- che non è cambiata.
  if new.corrected_value is not null and jsonb_typeof(new.corrected_value) <> 'null' then
    v_text := new.corrected_value #>> '{}';

    if new.field in ('start_date', 'end_date', 'effective_from')
       and public.try_date(v_text) is null then
      raise exception 'contract_correction_bad_date'
        using errcode = '22007', hint = 'La data non è in un formato riconoscibile.';
    end if;

    if new.field in ('minimum_term_value', 'renewal_period_value', 'notice_period_value') then
      if public.try_numeric(v_text) is null or public.try_numeric(v_text) <= 0
         or public.try_numeric(v_text) <> trunc(public.try_numeric(v_text)) then
        raise exception 'contract_correction_bad_period'
          using errcode = '22P02', hint = 'Un periodo è un numero intero di unità, maggiore di zero.';
      end if;
    end if;

    if new.field in ('minimum_term_unit', 'renewal_period_unit', 'notice_period_unit')
       and lower(v_text) not in ('days', 'weeks', 'months', 'years') then
      raise exception 'contract_correction_bad_period_unit'
        using errcode = '22P02', hint = 'L''unità di un periodo non è fra quelle previste.';
    end if;

    if new.field = 'auto_renewal' and lower(v_text) not in ('yes', 'no', 'unclear') then
      raise exception 'contract_correction_bad_renewal'
        using errcode = '22P02', hint = 'Il rinnovo automatico ammette: sì, no, non chiaro.';
    end if;

    if new.field = 'notice_anchor' and lower(v_text) not in (
         'before_fixed_end', 'before_renewal_date', 'to_month_end', 'to_quarter_end',
         'to_year_end', 'anytime', 'other', 'unclear') then
      raise exception 'contract_correction_bad_anchor'
        using errcode = '22P02', hint = 'L''ancoraggio del preavviso non è fra quelli previsti.';
    end if;

    if new.field = 'end_date_kind' and lower(v_text) not in ('explicit', 'none', 'unknown') then
      raise exception 'contract_correction_bad_end_kind'
        using errcode = '22P02', hint = 'Il tipo di scadenza non è fra quelli previsti.';
    end if;

    if new.field = 'termination_method' and lower(v_text) not in (
         'written_notice', 'email', 'registered_mail', 'portal', 'other') then
      raise exception 'contract_correction_bad_termination'
        using errcode = '22P02', hint = 'La modalità di disdetta non è fra quelle previste.';
    end if;

    if new.field = 'cost_amount' and public.try_numeric(v_text) is null then
      raise exception 'contract_correction_bad_amount'
        using errcode = '22P02', hint = 'L''importo non è un numero.';
    end if;

    if new.field = 'cost_currency' and upper(v_text) !~ '^[A-Z]{3}$' then
      raise exception 'contract_correction_bad_currency'
        using errcode = '22P02', hint = 'La valuta è un codice ISO di tre lettere.';
    end if;

    if new.field = 'cost_frequency' and lower(v_text) not in (
         'one_time', 'monthly', 'quarterly', 'yearly', 'other', 'unknown') then
      raise exception 'contract_correction_bad_frequency'
        using errcode = '22P02', hint = 'La cadenza del costo non è fra quelle previste.';
    end if;

    if new.field in ('cost_vat_included', 'price_adjustment')
       and lower(v_text) not in ('true', 'false') then
      raise exception 'contract_correction_bad_boolean'
        using errcode = '22P02', hint = 'Il valore ammette solo sì o no.';
    end if;
  end if;

  new.corrected_by := coalesce(auth.uid(), new.corrected_by);
  new.corrected_at := now();
  -- Il verbale di riferimento lo stabilisce il database: farlo dichiarare al
  -- client vorrebbe dire permettergli di agganciare la correzione al documento
  -- sbagliato.
  select cd.current_extraction_id into new.extraction_id
    from public.contract_documents cd
   where cd.contract_id = new.contract_id
     and cd.current_extraction_id is not null
   order by (case cd.relation when 'amendment' then 0 when 'renewal' then 0
                              when 'main_agreement' then 1 else 2 end),
            cd.added_at desc
   limit 1;
  return new;
end $$;

drop trigger if exists trg_contract_corrections_guard on public.contract_corrections;
create trigger trg_contract_corrections_guard
  before insert on public.contract_corrections
  for each row execute function public.contract_corrections_guard();

create or replace function public.contract_corrections_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'contract_correction_append_only'
    using errcode = '42501',
          hint = 'Le correzioni si aggiungono: per cambiare un valore se ne scrive una nuova.';
end $$;

drop trigger if exists trg_contract_corrections_append_only on public.contract_corrections;
create trigger trg_contract_corrections_append_only
  before update on public.contract_corrections
  for each row execute function public.contract_corrections_append_only();


-- ---------------------------------------------------------------------------
-- 20. Il guardiano delle date
--
-- Il timbro di verifica e quello di rifiuto li scrive il database (§107), e una
-- data non cambia di natura: quello che è stato derivato resta derivato anche
-- dopo che una persona l'ha confermato — «verificata» dice che qualcuno l'ha
-- guardata, non che il prodotto l'abbia letta nel documento.
-- ---------------------------------------------------------------------------
create or replace function public.contract_milestones_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select c.company_id into v_company from public.contracts c where c.id = new.contract_id;
  if v_company is null or v_company is distinct from new.company_id then
    raise exception 'contract_milestone_company_mismatch'
      using errcode = '23514',
            hint = 'La data non appartiene all''azienda del contratto.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.window_opened_at := null;
    -- ⚠️ Una data inserita da una PERSONA è `manual` e nasce già verificata: è
    -- una decisione, non una proposta del sistema, e chiederle una conferma
    -- separata sarebbe chiedere a qualcuno di confermare sé stesso. Le date che
    -- il prodotto propone nascono invece `candidate` e restano tali.
    if auth.uid() is not null and pg_trigger_depth() <= 1 then
      new.source := 'manual';
      new.calculation := null;
      new.calculation_version := null;
      new.calculation_inputs := '{}'::jsonb;
      new.status := 'verified';
      new.verified_at := now();
      new.verified_by := auth.uid();
    else
      new.verified_at := null;
      new.verified_by := null;
    end if;
    new.dismissed_at := null;
    new.dismissed_by := null;
    return new;
  end if;

  -- ---- UPDATE ------------------------------------------------------------
  new.company_id  := old.company_id;
  new.contract_id := old.contract_id;
  new.term_version_id := old.term_version_id;
  new.source      := old.source;
  new.kind        := old.kind;
  new.calculation := old.calculation;
  new.calculation_version := old.calculation_version;
  new.calculation_inputs  := old.calculation_inputs;
  new.created_by  := old.created_by;
  new.created_at  := old.created_at;
  new.updated_at  := now();

  -- ⚠️ LA DATA DI UNA MILESTONE DERIVATA NON SI MODIFICA A MANO.
  -- Cambiarla lascerebbe accanto una provenienza che dice «calcolata così» e un
  -- valore che quel calcolo non produce: la spiegazione smetterebbe di spiegare.
  -- Chi non è d'accordo con una data derivata la scarta e ne aggiunge una
  -- manuale, che dichiara di essere una decisione.
  if new.source = 'derived' and new.due_date is distinct from old.due_date then
    raise exception 'contract_milestone_derived_date_immutable'
      using errcode = '42501',
            hint = 'Una data calcolata non si modifica: si scarta e se ne aggiunge una manuale.';
  end if;

  if new.status is distinct from old.status then
    if new.status = 'verified' then
      new.verified_at := now();
      new.verified_by := auth.uid();
      new.dismissed_at := null;
      new.dismissed_by := null;
    elsif new.status = 'dismissed' then
      new.dismissed_at := now();
      new.dismissed_by := auth.uid();
    elsif new.status = 'candidate' then
      new.verified_at := null;
      new.verified_by := null;
      new.dismissed_at := null;
      new.dismissed_by := null;
    end if;
  else
    new.verified_at := old.verified_at;
    new.verified_by := old.verified_by;
    new.dismissed_at := old.dismissed_at;
    new.dismissed_by := old.dismissed_by;
  end if;

  -- La finestra la apre il worker, non il client: è ciò che impedisce di far
  -- emettere l'evento di automazione dall'esterno.
  if coalesce(current_setting('ai_swisse.contract_window', true), '') <> '1' then
    new.window_opened_at := old.window_opened_at;
  end if;

  return new;
end $$;

drop trigger if exists trg_contract_milestones_guard on public.contract_milestones;
create trigger trg_contract_milestones_guard
  before insert or update on public.contract_milestones
  for each row execute function public.contract_milestones_guard();


-- ---------------------------------------------------------------------------
-- 21. La derivazione delle date da una versione dei termini
--
-- §41/§42/§43 — ogni data prodotta qui nasce `candidate` e dichiara da dove
-- viene. Una data LETTA nel contratto è `explicit`; una data CALCOLATA è
-- `derived` e porta con sé il nome del calcolo, la sua versione e gli
-- ingredienti: senza quelli, nessuno potrebbe rispondere a «perché proprio il
-- 30 settembre?».
--
-- ⚠️ SI RIGENERANO SOLO LE CANDIDATE DI QUESTA VERSIONE. Le date che qualcuno ha
-- verificato o scartato sono giudizi umani e non si toccano; quelle manuali non
-- discendono da termini e non c'entrano.
-- ---------------------------------------------------------------------------
create or replace function public.contract_derive_milestones(p_version_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v      record;
  v_ref  date;
  v_notice date;
  v_kind public.contract_milestone_kind;
  v_count integer := 0;
begin
  select * into v from public.contract_term_versions where id = p_version_id;
  if v.id is null then return 0; end if;

  delete from public.contract_milestones
   where term_version_id = p_version_id
     and status = 'candidate'
     and source in ('explicit', 'derived');

  -- (a) L'inizio, se il contratto lo dice.
  if v.start_date is not null then
    insert into public.contract_milestones
      (company_id, contract_id, term_version_id, kind, due_date, source, status)
    values (v.company_id, v.contract_id, p_version_id, 'contract_start', v.start_date,
            'explicit', 'candidate');
    v_count := v_count + 1;
  end if;

  -- (b) La fine — oppure il RINNOVO, che è un'altra cosa.
  --     ⚠️ Con rinnovo automatico dichiarato, quel giorno il contratto non
  --     finisce: si rinnova. Chiamare «scadenza» la data in cui un impegno si
  --     prolunga di dodici mesi è il modo più diretto per far perdere un
  --     termine di disdetta.
  if v.end_date is not null and v.end_date_kind = 'explicit' then
    v_kind := case when v.auto_renewal = 'yes' then 'renewal_date' else 'contract_end' end;
    insert into public.contract_milestones
      (company_id, contract_id, term_version_id, kind, due_date, source, status)
    values (v.company_id, v.contract_id, p_version_id, v_kind, v.end_date,
            'explicit', 'candidate');
    v_count := v_count + 1;
  end if;

  -- (c) Il termine ultimo di disdetta, SE derivabile (§39/§45/§46).
  --     La data di riferimento è la fine esplicita: è anche la data in cui un
  --     rinnovo tacito scatta, e per questo serve a entrambi gli ancoraggi
  --     calcolabili.
  if v.end_date_kind = 'explicit' then v_ref := v.end_date; else v_ref := null; end if;
  v_notice := public.contract_notice_deadline(
    v.notice_period_value, v.notice_period_unit, v.notice_anchor, v_ref);

  if v_notice is not null then
    insert into public.contract_milestones
      (company_id, contract_id, term_version_id, kind, due_date, source, status,
       calculation, calculation_version, calculation_inputs)
    values (v.company_id, v.contract_id, p_version_id, 'notice_deadline', v_notice,
            'derived', 'candidate',
            'notice_before_reference', public.contract_calculation_version(),
            jsonb_build_object(
              'noticeValue', v.notice_period_value,
              'noticeUnit',  v.notice_period_unit,
              'anchor',      v.notice_anchor,
              'referenceDate', v_ref,
              'referenceKind', case when v.auto_renewal = 'yes' then 'renewal_date'
                                    else 'contract_end' end));
    v_count := v_count + 1;
  end if;

  return v_count;
end $$;

revoke all on function public.contract_derive_milestones(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 22. Il ricalcolo delle bandiere di qualità
--
-- §140/§141 — che cosa una persona deve guardare, e perché. Le bandiere sono
-- una PROIEZIONE: si ricalcolano per intero dalle estrazioni correnti e dai
-- termini in preparazione, e il guardiano del contratto le protegge da qualunque
-- altra scrittura.
-- ---------------------------------------------------------------------------
create or replace function public.contract_refresh_flags(p_contract_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract record;
  v_terms    record;
  v_flags    public.contract_quality_flag[] := '{}';
  v_from_ex  public.contract_quality_flag[];
  v_currencies integer;
  v_conflicts integer;
begin
  select * into v_contract from public.contracts where id = p_contract_id;
  if v_contract.id is null then return; end if;

  -- I termini che contano sono quelli in vigore; se nessuno ha ancora
  -- verificato, la bozza — dichiarata come tale dall'interfaccia.
  select * into v_terms from public.contract_term_versions
   where contract_id = p_contract_id
     and id = coalesce(v_contract.current_term_version_id,
                       (select id from public.contract_term_versions
                         where contract_id = p_contract_id and status = 'draft' limit 1));

  -- (a) Le bandiere che le letture hanno alzato: descrivono COME è andata, e
  --     nessuna correzione umana le rende false.
  select coalesce(array_agg(distinct fl.flag), '{}')
    into v_from_ex
    from public.contract_extractions e
    join public.contract_documents cd
      on cd.contract_id = e.contract_id and cd.current_extraction_id = e.id
   cross join lateral unnest(e.quality_flags) as fl(flag)
   where e.contract_id = p_contract_id and e.status = 'completed'
     and fl.flag in ('partially_analysed', 'low_extraction_confidence',
                     'out_of_scope_contract_kind', 'missing_referenced_annex',
                     'ambiguous_start_date', 'ambiguous_end_date');
  v_flags := v_from_ex;

  -- (b) Le bandiere che dipendono dai termini EFFETTIVI e che quindi devono
  --     spegnersi quando una persona corregge il dato.
  if v_terms.id is not null then
    if v_terms.counterparty_name is null and v_contract.counterparty_name is null then
      v_flags := v_flags || 'missing_counterparty'::public.contract_quality_flag;
    end if;

    if v_terms.auto_renewal = 'unclear' then
      v_flags := v_flags || 'renewal_unclear'::public.contract_quality_flag;
    end if;

    -- §38 — c'è un preavviso, ma non si sa a che cosa si riferisca.
    if v_terms.notice_period_value is not null
       and (v_terms.notice_anchor is null or v_terms.notice_anchor = 'unclear') then
      v_flags := v_flags || 'notice_anchor_unclear'::public.contract_quality_flag;
    end if;

    -- §39 — il preavviso c'è, l'ancoraggio anche, e ciò nonostante una data non
    -- si può derivare. È il caso di «per fine mese» e di una scadenza che non
    -- conosciamo: va DETTO, perché il posto vuoto accanto a «Preavviso: 3 mesi»
    -- verrebbe letto come «nessuna scadenza».
    if v_terms.notice_period_value is not null
       and public.contract_notice_deadline(
             v_terms.notice_period_value, v_terms.notice_period_unit, v_terms.notice_anchor,
             case when v_terms.end_date_kind = 'explicit' then v_terms.end_date end) is null then
      v_flags := v_flags || 'notice_not_derivable'::public.contract_quality_flag;
    end if;

    if v_terms.cost_amount is not null and v_terms.cost_frequency = 'unknown' then
      v_flags := v_flags || 'cost_unclear'::public.contract_quality_flag;
    end if;
  end if;

  -- (c) §26 — una modifica in attesa di una persona.
  if v_contract.review_status = 'review_required_again' then
    v_flags := v_flags || 'amendment_requires_review'::public.contract_quality_flag;
  end if;

  -- (d) §55 — valute diverse fra i documenti dello stesso contratto. Non si
  --     sommano e non si convertono: si dichiara che ce ne sono più di una.
  select count(distinct upper(e.cost_currency)) into v_currencies
    from public.contract_extractions e
    join public.contract_documents cd
      on cd.contract_id = e.contract_id and cd.current_extraction_id = e.id
   where e.contract_id = p_contract_id and e.cost_currency is not null;
  if coalesce(v_currencies, 0) > 1 then
    v_flags := v_flags || 'multiple_currencies'::public.contract_quality_flag;
  end if;

  -- (e) Due documenti che dicono cose diverse sullo stesso termine, senza che
  --     nessuno dei due sia una modifica dichiarata. Un amendment che cambia il
  --     preavviso NON è un conflitto: è il suo mestiere.
  select count(*) into v_conflicts
    from (
      select count(distinct e.notice_period_value) filter (where e.notice_period_value is not null) as n_notice,
             count(distinct e.end_date) filter (where e.end_date is not null) as n_end
        from public.contract_extractions e
        join public.contract_documents cd
          on cd.contract_id = e.contract_id and cd.current_extraction_id = e.id
       where e.contract_id = p_contract_id and e.status = 'completed'
         and cd.relation in ('main_agreement', 'annex')
    ) t
   where t.n_notice > 1 or t.n_end > 1;
  if coalesce(v_conflicts, 0) > 0 then
    v_flags := v_flags || 'conflicting_terms'::public.contract_quality_flag;
  end if;

  perform set_config('ai_swisse.contract_refresh', '1', true);
  update public.contracts
     set quality_flags = (select array(select distinct f from unnest(v_flags) f order by f))
   where id = p_contract_id;
  perform set_config('ai_swisse.contract_refresh', '0', true);
end $$;

revoke all on function public.contract_refresh_flags(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 23. IL RICALCOLO DELLA BOZZA DEI TERMINI
--
-- ⚠️⚠️ LA FUNZIONE PIÙ IMPORTANTE DEL FILE. Compone ciò che il prodotto PROPONE
-- come termini correnti, e l'ordine in cui compone è tutto:
--
--   1. si parte dalla VERSIONE VERIFICATA in vigore, se esiste. È la verità
--      corrente dell'azienda, corretta a mano dove serviva, e nessuna rilettura
--      della macchina deve poterla disfare.
--   2. si sovrascrive con le estrazioni dei documenti che quella versione NON
--      aveva ancora considerato, in ordine di autorità: altro < accordo
--      principale < allegato < rinnovo < modifica. Una modifica successiva pesa
--      più dell'accordo, ed è esattamente il caso «preavviso 3 mesi → 6 mesi».
--   3. si sovrascrive con le CORREZIONI UMANE di questa bozza, in ordine
--      cronologico: l'ultima di ogni campo vince (§22).
--
-- ⚠️ SOLO I VALORI NON NULLI SOVRASCRIVONO. Un amendment che parla soltanto del
-- preavviso non deve cancellare la controparte e il costo: il silenzio di un
-- documento non è una dichiarazione di assenza.
--
-- ⚠️ QUESTA FUNZIONE NON CAMBIA NIENTE DI CIÒ CHE È IN VIGORE (§28).
-- Scrive una BOZZA. I termini del contratto restano quelli verificati finché una
-- persona non verifica anche questa. È la riga che rende vera la frase «un
-- amendment non modifica silenziosamente i termini».
-- ---------------------------------------------------------------------------
create or replace function public.contract_refresh_draft(p_contract_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract record;
  v_base     record;
  v_draft_id uuid;
  v_ex       record;
  v_corr     record;
  v_text     text;
  v_sources  uuid[] := '{}';
  -- I termini in composizione.
  t_counterparty text; t_company_party text;
  t_start date; t_end date; t_end_kind public.contract_end_kind := 'unknown';
  t_min_v integer; t_min_u public.contract_period_unit;
  t_renewal public.contract_auto_renewal := 'unclear';
  t_renewal_v integer; t_renewal_u public.contract_period_unit;
  t_notice_v integer; t_notice_u public.contract_period_unit;
  t_anchor public.contract_notice_anchor; t_anchor_text text;
  t_term_method public.contract_termination_method; t_term_address text;
  t_cost numeric; t_currency text; t_frequency public.contract_cost_frequency := 'unknown';
  t_vat boolean; t_price_adj boolean := false;
  t_effective date;
begin
  select * into v_contract from public.contracts where id = p_contract_id;
  if v_contract.id is null then return null; end if;

  -- ---- 1. La base: la versione verificata in vigore -----------------------
  -- ⚠️ IL `select into` SI ESEGUE SEMPRE, anche quando non c'è nulla da
  -- cercare. In plpgsql un `record` a cui non è mai stata assegnata una riga NON
  -- è un record vuoto: leggerne un campo solleva «record is not assigned yet».
  -- Scritto dentro un `if`, questo blocco avrebbe fatto fallire il ricalcolo di
  -- ogni contratto non ancora verificato — cioè di tutti, al primo giro.
  select * into v_base from public.contract_term_versions
   where contract_id = p_contract_id
     and v_contract.current_term_version_id is not null
     and id = v_contract.current_term_version_id;

  if v_base.id is not null then
    t_counterparty := v_base.counterparty_name;  t_company_party := v_base.company_party;
    t_start := v_base.start_date;                t_end := v_base.end_date;
    t_end_kind := v_base.end_date_kind;
    t_min_v := v_base.minimum_term_value;        t_min_u := v_base.minimum_term_unit;
    t_renewal := v_base.auto_renewal;
    t_renewal_v := v_base.renewal_period_value;  t_renewal_u := v_base.renewal_period_unit;
    t_notice_v := v_base.notice_period_value;    t_notice_u := v_base.notice_period_unit;
    t_anchor := v_base.notice_anchor;            t_anchor_text := v_base.notice_anchor_text;
    t_term_method := v_base.termination_method;  t_term_address := v_base.termination_address;
    t_cost := v_base.cost_amount;                t_currency := v_base.cost_currency;
    t_frequency := v_base.cost_frequency;        t_vat := v_base.cost_vat_included;
    t_price_adj := v_base.price_adjustment;
    v_sources := coalesce(v_base.source_extraction_ids, '{}');
  end if;

  -- ---- 2. Le estrazioni non ancora incorporate ---------------------------
  for v_ex in
    select e.*, cd.relation
      from public.contract_extractions e
      join public.contract_documents cd
        on cd.contract_id = e.contract_id and cd.current_extraction_id = e.id
     where e.contract_id = p_contract_id
       and e.status = 'completed'
       and not (e.id = any(v_sources))
     order by (case cd.relation
                 when 'other' then 0 when 'termination_notice' then 0
                 when 'main_agreement' then 1 when 'annex' then 2
                 when 'renewal' then 3 when 'amendment' then 4 end) asc,
              coalesce(e.document_date, e.signature_date, e.created_at::date) asc,
              e.created_at asc
  loop
    t_counterparty := coalesce(v_ex.counterparty, t_counterparty);
    t_company_party := coalesce(v_ex.company_party, t_company_party);
    t_start := coalesce(v_ex.start_date, t_start);
    if v_ex.end_date is not null or v_ex.end_date_kind <> 'unknown' then
      t_end := coalesce(v_ex.end_date, t_end);
      t_end_kind := v_ex.end_date_kind;
    end if;
    t_min_v := coalesce(v_ex.minimum_term_value, t_min_v);
    t_min_u := coalesce(v_ex.minimum_term_unit, t_min_u);
    -- ⚠️ `unclear` non sovrascrive: un documento che non chiarisce il rinnovo non
    -- rende meno chiaro ciò che un altro aveva detto.
    if v_ex.auto_renewal <> 'unclear' then t_renewal := v_ex.auto_renewal; end if;
    t_renewal_v := coalesce(v_ex.renewal_period_value, t_renewal_v);
    t_renewal_u := coalesce(v_ex.renewal_period_unit, t_renewal_u);
    t_notice_v := coalesce(v_ex.notice_period_value, t_notice_v);
    t_notice_u := coalesce(v_ex.notice_period_unit, t_notice_u);
    t_anchor := coalesce(v_ex.notice_anchor, t_anchor);
    t_anchor_text := coalesce(v_ex.notice_anchor_text, t_anchor_text);
    t_term_method := coalesce(v_ex.termination_method, t_term_method);
    t_term_address := coalesce(v_ex.termination_address, t_term_address);
    t_cost := coalesce(v_ex.cost_amount, t_cost);
    t_currency := coalesce(upper(v_ex.cost_currency), t_currency);
    if v_ex.cost_frequency <> 'unknown' then t_frequency := v_ex.cost_frequency; end if;
    t_vat := coalesce(v_ex.cost_vat_included, t_vat);
    -- Una clausola di adeguamento vista una volta resta vista: `false` è il
    -- default della colonna, non un'affermazione del documento.
    t_price_adj := t_price_adj or v_ex.price_adjustment;
    -- Da quando valgono: la data di firma di una modifica è il segnale migliore
    -- che il documento offre, e resta comunque correggibile a mano.
    if v_ex.relation in ('amendment', 'renewal') then
      t_effective := coalesce(v_ex.start_date, v_ex.signature_date, v_ex.document_date, t_effective);
    end if;
    v_sources := v_sources || v_ex.id;
  end loop;

  -- ---- 3. La bozza: si riusa quella aperta, o se ne apre una -------------
  select id into v_draft_id from public.contract_term_versions
   where contract_id = p_contract_id and status = 'draft';

  if v_draft_id is null then
    insert into public.contract_term_versions (
      company_id, contract_id, version, status, based_on_version_id
    ) values (
      v_contract.company_id, p_contract_id,
      coalesce((select max(version) from public.contract_term_versions
                 where contract_id = p_contract_id), 0) + 1,
      'draft', v_base.id
    )
    returning id into v_draft_id;
  end if;

  -- ---- 4. Le correzioni umane vincono su tutto ---------------------------
  for v_corr in
    select field, corrected_value from public.contract_corrections
     where term_version_id = v_draft_id
     order by corrected_at asc, id asc
  loop
    v_text := v_corr.corrected_value #>> '{}';
    -- Una correzione a `null` è una cancellazione voluta: «questo campo il
    -- contratto non lo dice», ed è un'informazione, non un valore mancante.
    if v_corr.field = 'counterparty_name'    then t_counterparty := v_text;
    elsif v_corr.field = 'company_party'     then t_company_party := v_text;
    elsif v_corr.field = 'start_date'        then t_start := public.try_date(v_text);
    elsif v_corr.field = 'end_date'          then t_end := public.try_date(v_text);
    elsif v_corr.field = 'end_date_kind'     then t_end_kind := coalesce(lower(v_text)::public.contract_end_kind, t_end_kind);
    elsif v_corr.field = 'minimum_term_value' then t_min_v := public.try_numeric(v_text)::integer;
    elsif v_corr.field = 'minimum_term_unit' then t_min_u := lower(v_text)::public.contract_period_unit;
    elsif v_corr.field = 'auto_renewal'      then t_renewal := coalesce(lower(v_text)::public.contract_auto_renewal, t_renewal);
    elsif v_corr.field = 'renewal_period_value' then t_renewal_v := public.try_numeric(v_text)::integer;
    elsif v_corr.field = 'renewal_period_unit'  then t_renewal_u := lower(v_text)::public.contract_period_unit;
    elsif v_corr.field = 'notice_period_value'  then t_notice_v := public.try_numeric(v_text)::integer;
    elsif v_corr.field = 'notice_period_unit'   then t_notice_u := lower(v_text)::public.contract_period_unit;
    elsif v_corr.field = 'notice_anchor'     then t_anchor := lower(v_text)::public.contract_notice_anchor;
    elsif v_corr.field = 'notice_anchor_text' then t_anchor_text := v_text;
    elsif v_corr.field = 'termination_method' then t_term_method := lower(v_text)::public.contract_termination_method;
    elsif v_corr.field = 'termination_address' then t_term_address := v_text;
    elsif v_corr.field = 'cost_amount'       then t_cost := public.try_numeric(v_text);
    elsif v_corr.field = 'cost_currency'     then t_currency := upper(v_text);
    elsif v_corr.field = 'cost_frequency'    then t_frequency := coalesce(lower(v_text)::public.contract_cost_frequency, t_frequency);
    elsif v_corr.field = 'cost_vat_included' then t_vat := (lower(v_text) = 'true');
    elsif v_corr.field = 'price_adjustment'  then t_price_adj := (lower(v_text) = 'true');
    elsif v_corr.field = 'effective_from'    then t_effective := public.try_date(v_text);
    end if;
  end loop;

  -- ---- 5. Si scrive la bozza --------------------------------------------
  update public.contract_term_versions set
    counterparty_name = t_counterparty,
    company_party     = t_company_party,
    start_date        = t_start,
    end_date          = t_end,
    end_date_kind     = t_end_kind,
    minimum_term_value = t_min_v,
    minimum_term_unit  = t_min_u,
    auto_renewal      = t_renewal,
    renewal_period_value = t_renewal_v,
    renewal_period_unit  = t_renewal_u,
    notice_period_value  = t_notice_v,
    notice_period_unit   = t_notice_u,
    notice_anchor        = t_anchor,
    notice_anchor_text   = t_anchor_text,
    termination_method   = t_term_method,
    termination_address  = t_term_address,
    cost_amount       = t_cost,
    cost_currency     = t_currency,
    cost_frequency    = t_frequency,
    cost_vat_included = t_vat,
    price_adjustment  = t_price_adj,
    effective_from    = t_effective,
    source_extraction_ids = v_sources,
    based_on_version_id   = coalesce(based_on_version_id, v_base.id)
  where id = v_draft_id;

  -- Le date che ne discendono, e le bandiere che ne derivano.
  perform public.contract_derive_milestones(v_draft_id);
  perform public.contract_refresh_flags(p_contract_id);

  return v_draft_id;
end $$;

revoke all on function public.contract_refresh_draft(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 24. LA VERIFICA DEI TERMINI — l'unico percorso che rende un termine «in vigore»
--
-- §82/§83 — «Segna i dati come verificati», mai «approva legalmente». Qui non si
-- approva niente: si dichiara di aver guardato ciò che il sistema ha letto.
--
-- ⚠️ È UNA FUNZIONE E NON UN `update` DAL CLIENT perché cinque cose devono
-- accadere insieme o non accadere affatto: la bozza diventa verificata, la
-- versione precedente passa a superata, il contratto punta alla nuova, le date
-- della vecchia versione smettono di valere e lo storico registra il gesto.
-- Lasciarle a cinque scritture separate significherebbe che una schermata
-- interrotta a metà lascia un contratto «verificato» senza termini verificati.
--
-- ⚠️ `security definer` con controllo di appartenenza scritto DENTRO: è la
-- lezione della 0019, dove una funzione `security invoker` non poteva scrivere
-- perché al ruolo `authenticated` mancava il permesso che mancava anche a lei.
-- ---------------------------------------------------------------------------
create or replace function public.contract_verify_terms(p_version_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version  record;
  v_contract record;
  v_previous uuid;
begin
  select * into v_version from public.contract_term_versions where id = p_version_id;
  if v_version.id is null then
    raise exception 'contract_term_version_not_found' using errcode = 'P0002';
  end if;

  -- L'appartenenza è l'UNICA difesa di una funzione che scavalca la RLS.
  if not public.is_company_member(v_version.company_id) then
    raise exception 'contract_forbidden' using errcode = '42501';
  end if;

  if v_version.status <> 'draft' then
    raise exception 'contract_term_version_not_draft'
      using errcode = '23514',
            hint = 'Solo la versione in preparazione può essere verificata.';
  end if;

  select * into v_contract from public.contracts where id = v_version.contract_id;
  v_previous := v_contract.current_term_version_id;

  update public.contract_term_versions
     set status = 'verified', verified_at = now(), verified_by = auth.uid()
   where id = p_version_id;

  if v_previous is not null and v_previous <> p_version_id then
    update public.contract_term_versions
       set status = 'superseded'
     where id = v_previous;
    -- Le date della versione superata smettono di essere in gioco. ⚠️ NON si
    -- cancellano: una data che ha generato un'attività deve restare
    -- ricostruibile, e «superata» è un fatto, non un giudizio.
    update public.contract_milestones
       set status = 'superseded'
     where term_version_id = v_previous
       and status in ('candidate', 'verified');
  end if;

  perform set_config('ai_swisse.contract_verify', '1', true);
  update public.contracts
     set current_term_version_id = p_version_id,
         review_status = 'verified',
         verified_at = now(),
         verified_by = auth.uid()
   where id = v_version.contract_id;
  perform set_config('ai_swisse.contract_verify', '0', true);

  insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
  values (v_version.company_id, v_version.contract_id, auth.uid(), 'term_version_verified',
          jsonb_build_object('versionId', p_version_id, 'version', v_version.version,
                             'previousVersionId', v_previous));

  perform public.contract_refresh_flags(v_version.contract_id);
  return p_version_id;
end $$;


/*
 * Riaprire i termini per correggerli.
 *
 * ⚠️ SERVE PERCHÉ UNA VERSIONE VERIFICATA È IMMUTABILE. Dopo la verifica non
 * esiste più alcuna bozza (l'indice unico parziale si libera), e senza questa
 * funzione un contratto verificato sarebbe un contratto che nessuno può più
 * correggere: ci si accorgerebbe di un preavviso sbagliato e non ci sarebbe
 * dove scriverlo. La bozza nuova parte dai termini in vigore e non li tocca —
 * lo stato resta `verified` finché una persona non verifica anche questa.
 */
create or replace function public.contract_open_draft(p_contract_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select company_id into v_company from public.contracts where id = p_contract_id;
  if v_company is null then
    raise exception 'contract_not_found' using errcode = 'P0002';
  end if;
  if not public.is_company_member(v_company) then
    raise exception 'contract_forbidden' using errcode = '42501';
  end if;
  return public.contract_refresh_draft(p_contract_id);
end $$;


-- ---------------------------------------------------------------------------
-- 25. Quando arriva una lettura nuova
--
-- ⚠️ §26/§28 — UN AMENDMENT NON CAMBIA I TERMINI: APRE UNA REVISIONE.
-- Se il contratto era verificato e arriva la lettura di una modifica, lo stato
-- torna `review_required_again` e la bozza mostra che cosa cambierebbe. I
-- termini in vigore restano quelli di prima finché una persona non decide.
-- ---------------------------------------------------------------------------
create or replace function public.contract_after_extraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relation public.contract_document_relation;
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

    -- ⚠️ ANCHE IL FALLIMENTO LO SCRIVE IL TRIGGER, non il worker (lezione della
    -- 0021): due posti in cui ricordarsene sono uno di troppo, e il giorno in
    -- cui uno dei due dimentica, il documento resta «in lavorazione» per sempre.
  else
    update public.contract_documents
       set processing_status = 'failed', error_code = new.error_code
     where contract_id = new.contract_id and document_id = new.document_id;
  end if;

  insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
  values (new.company_id, new.contract_id, null,
          case when new.status = 'completed' then 'extraction_completed'
               else 'extraction_failed' end,
          jsonb_build_object('documentId', new.document_id,
                             'version', new.extraction_version,
                             'relation', v_relation));

  if new.status = 'completed' then
    perform public.contract_refresh_draft(new.contract_id);

    -- La revisione si riapre solo se c'era qualcosa da riaprire: su un contratto
    -- mai verificato lo stato è già `needs_review` e riscriverlo direbbe che è
    -- successo qualcosa che non è successo.
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

drop trigger if exists trg_contract_after_extraction on public.contract_extractions;
create trigger trg_contract_after_extraction
  after insert on public.contract_extractions
  for each row execute function public.contract_after_extraction();


-- ---------------------------------------------------------------------------
-- 26. La bozza esiste da subito
--
-- §132 — un contratto si può creare in un istante e l'estrazione arriva dopo.
-- La bozza nasce con il contratto, vuota: è il posto in cui una persona può
-- scrivere i termini a mano quando il PDF non c'è ancora, ed è lo stesso posto
-- in cui la lettura li scriverà. Due percorsi diversi per lo stesso dato
-- avrebbero prodotto due schermate che si contraddicono.
-- ---------------------------------------------------------------------------
create or replace function public.contract_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
  values (new.company_id, new.id, new.created_by, 'created',
          jsonb_build_object('type', new.contract_type, 'origin', new.origin));
  perform public.contract_refresh_draft(new.id);
  return new;
end $$;

drop trigger if exists trg_contract_after_insert on public.contracts;
create trigger trg_contract_after_insert
  after insert on public.contracts
  for each row execute function public.contract_after_insert();


-- ---------------------------------------------------------------------------
-- 27. Lo storico degli stati
-- ---------------------------------------------------------------------------
create or replace function public.contracts_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.review_status is distinct from old.review_status then
    if new.review_status = 'review_required_again' then
      insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
      values (new.company_id, new.id, auth.uid(), 'review_reopened', '{}'::jsonb);
    elsif new.review_status = 'verified' then
      insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
      values (new.company_id, new.id, auth.uid(), 'verified', '{}'::jsonb);
    end if;
  end if;

  if new.owner_user_id is distinct from old.owner_user_id then
    -- ⚠️ Nel dettaglio va l'IDENTIFICATIVO, non il nome: lo storico lo legge
    -- ogni membro e i nomi si risolvono al render dalla rubrica (§110).
    insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, auth.uid(), 'owner_changed',
            jsonb_build_object('ownerUserId', new.owner_user_id));
  end if;

  if new.lifecycle_status is distinct from old.lifecycle_status then
    insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, auth.uid(), 'lifecycle_changed',
            jsonb_build_object('status', new.lifecycle_status));
  end if;

  if new.archived_at is not null and old.archived_at is null then
    insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, auth.uid(), 'archived', '{}'::jsonb);
  elsif new.archived_at is null and old.archived_at is not null then
    insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, auth.uid(), 'restored', '{}'::jsonb);
  end if;

  return new;
end $$;

drop trigger if exists trg_contracts_events on public.contracts;
create trigger trg_contracts_events
  after update on public.contracts
  for each row execute function public.contracts_events();

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

  insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
  values (old.company_id, old.contract_id, auth.uid(), 'document_removed',
          jsonb_build_object('documentId', old.document_id, 'relation', old.relation));
  return old;
end $$;

drop trigger if exists trg_contract_documents_events on public.contract_documents;
create trigger trg_contract_documents_events
  after insert or delete on public.contract_documents
  for each row execute function public.contract_documents_events();

-- Togliere un documento cambia i termini che se ne possono comporre: la bozza va
-- rifatta, altrimenti resterebbe a raccontare un documento che non c'è più.
create or replace function public.contract_documents_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Solo se il contratto esiste ancora: durante la cascata di una cancellazione
  -- del contratto non c'è più niente da ricalcolare, e provarci solleverebbe.
  if exists (select 1 from public.contracts where id = old.contract_id) then
    perform public.contract_refresh_draft(old.contract_id);
  end if;
  return old;
end $$;

drop trigger if exists trg_contract_documents_after_delete on public.contract_documents;
create trigger trg_contract_documents_after_delete
  after delete on public.contract_documents
  for each row execute function public.contract_documents_after_delete();

-- Una correzione ridisegna la bozza e lascia traccia.
create or replace function public.contract_after_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.contract_refresh_draft(new.contract_id);
  insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
  values (new.company_id, new.contract_id, new.corrected_by, 'corrected',
          jsonb_build_object('field', new.field));
  return new;
end $$;

drop trigger if exists trg_contract_after_correction on public.contract_corrections;
create trigger trg_contract_after_correction
  after insert on public.contract_corrections
  for each row execute function public.contract_after_correction();

create or replace function public.contract_milestones_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.source = 'manual' then
      insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
      values (new.company_id, new.contract_id, new.created_by, 'milestone_added',
              jsonb_build_object('milestoneId', new.id, 'kind', new.kind));
    end if;
    return new;
  end if;

  if new.status is distinct from old.status then
    if new.status = 'verified' then
      insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
      values (new.company_id, new.contract_id, new.verified_by, 'milestone_verified',
              jsonb_build_object('milestoneId', new.id, 'kind', new.kind,
                                 'source', new.source));
    elsif new.status = 'dismissed' then
      insert into public.contract_events (company_id, contract_id, actor_user_id, kind, detail)
      values (new.company_id, new.contract_id, new.dismissed_by, 'milestone_dismissed',
              jsonb_build_object('milestoneId', new.id, 'kind', new.kind));
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_contract_milestones_events on public.contract_milestones;
create trigger trg_contract_milestones_events
  after insert or update on public.contract_milestones
  for each row execute function public.contract_milestones_events();


-- ---------------------------------------------------------------------------
-- 28. Gli eventi per il motore delle automazioni
--
-- ⚠️ I QUATTRO VALORI NUOVI DELL'ENUM COMPAIONO SOLO QUI DENTRO, e il corpo di
-- una funzione non viene eseguito quando la funzione viene creata: applicare
-- questo file non li valuta mai. Vedi il punto 2.
--
-- ⚠️ NESSUN EVENTO NASCE DA UNA PROPOSTA. `contract_milestone_verified` si emette
-- quando una PERSONA ha confermato una data (§87): una candidata che facesse
-- scattare una regola trasformerebbe un calcolo in un'attività, ed è
-- esattamente ciò che questo modulo non deve fare.
-- ---------------------------------------------------------------------------
create or replace function public.contract_emit_automation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'contractId', new.id, 'type', new.contract_type,
    'reviewStatus', new.review_status, 'ownerUserId', new.owner_user_id);

  if new.review_status = 'verified' and old.review_status is distinct from 'verified' then
    perform public.automation_emit(
      new.company_id, 'contract_verified', 'contract', new.id,
      v_payload, null, new.workflow_run_id);
  end if;

  if new.review_status = 'review_required_again'
     and old.review_status is distinct from 'review_required_again' then
    perform public.automation_emit(
      new.company_id, 'contract_review_required', 'contract', new.id,
      v_payload, null, new.workflow_run_id);
  end if;

  return new;
end $$;

drop trigger if exists trg_contract_emit_automation on public.contracts;
create trigger trg_contract_emit_automation
  after update on public.contracts
  for each row execute function public.contract_emit_automation();

create or replace function public.contract_milestone_emit_automation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contract record;
begin
  if new.status <> 'verified' or old.status = 'verified' then return new; end if;

  select c.company_id, c.contract_type, c.owner_user_id, c.workflow_run_id
    into v_contract
    from public.contracts c where c.id = new.contract_id;

  perform public.automation_emit(
    v_contract.company_id, 'contract_milestone_verified', 'contract', new.contract_id,
    jsonb_build_object('contractId', new.contract_id, 'milestoneId', new.id,
                       'milestoneKind', new.kind, 'milestoneDate', new.due_date,
                       'milestoneSource', new.source,
                       'type', v_contract.contract_type,
                       'ownerUserId', v_contract.owner_user_id),
    null, v_contract.workflow_run_id);
  return new;
end $$;

drop trigger if exists trg_contract_milestone_emit on public.contract_milestones;
create trigger trg_contract_milestone_emit
  after update on public.contract_milestones
  for each row execute function public.contract_milestone_emit_automation();


-- ---------------------------------------------------------------------------
-- 29. L'apertura delle finestre di attenzione
--
-- §95 — «la finestra si apre» è un fatto che dipende dal TEMPO, non da una
-- scrittura: nessun trigger può accorgersene. Lo chiede lo scheduler già
-- esistente, esattamente come `automation_emit_overdue` della 0020 — non si
-- crea un secondo sistema di cron.
--
-- ⚠️ SI EMETTE UNA VOLTA SOLA (`window_opened_at`). Senza, ogni passaggio del
-- worker riemetterebbe l'evento e una regola creerebbe un'attività ogni cinque
-- minuti: è la stessa ragione per cui «scaduta» si emette una volta sola.
--
-- ⚠️ SOLO DATE VERIFICATE. Una candidata non apre nessuna finestra (§87).
-- ---------------------------------------------------------------------------
create or replace function public.contract_open_milestone_windows(
  p_window_days integer default 60,
  p_limit       integer default 200
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ms    record;
  v_count integer := 0;
begin
  for v_ms in
    select m.id, m.company_id, m.contract_id, m.kind, m.due_date, m.source,
           c.contract_type, c.owner_user_id, c.workflow_run_id
      from public.contract_milestones m
      join public.contracts c on c.id = m.contract_id
     where m.status = 'verified'
       and m.window_opened_at is null
       and c.archived_at is null
       and m.due_date >= current_date
       and m.due_date <= current_date + make_interval(days => greatest(p_window_days, 0))
     order by m.due_date asc
     limit greatest(p_limit, 0)
  loop
    perform set_config('ai_swisse.contract_window', '1', true);
    update public.contract_milestones set window_opened_at = now() where id = v_ms.id;
    perform set_config('ai_swisse.contract_window', '0', true);

    perform public.automation_emit(
      v_ms.company_id, 'contract_milestone_window_opened', 'contract', v_ms.contract_id,
      jsonb_build_object('contractId', v_ms.contract_id, 'milestoneId', v_ms.id,
                         'milestoneKind', v_ms.kind, 'milestoneDate', v_ms.due_date,
                         'milestoneSource', v_ms.source,
                         'type', v_ms.contract_type, 'ownerUserId', v_ms.owner_user_id,
                         'windowDays', p_window_days),
      null, v_ms.workflow_run_id);
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

revoke all on function public.contract_open_milestone_windows(integer, integer) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 30. La lista: filtri, ricerca, ordinamento e paginazione nel database
--
-- Stessa forma di `list_documents` (0017) e `list_finance_items` (0021), e per
-- le stesse ragioni: una riga mette insieme il contratto, i termini in vigore,
-- la prossima data e i conteggi. Fatto dal browser sarebbe una interrogazione
-- per riga per relazione, e per sapere quali venticinque righe mostrare
-- bisognerebbe averle scaricate tutte (§70/§159).
--
-- ⚠️ `terms_are_draft` NON È UN DETTAGLIO TECNICO. Dice se ciò che la riga
-- mostra è un termine verificato o una proposta del sistema. Senza quel
-- booleano l'interfaccia mostrerebbe «Preavviso: 3 mesi» con la stessa faccia in
-- entrambi i casi, e la distinzione su cui è costruito tutto il modulo
-- sparirebbe proprio nel punto in cui una persona guarda.
--
-- `security invoker` (il default): la RLS di ogni tabella continua ad applicarsi
-- riga per riga. Il filtro esplicito su `company_id` non la sostituisce, la
-- accompagna.
-- ---------------------------------------------------------------------------
create or replace function public.list_contracts(
  p_company_id   uuid,
  -- all | needs_review | active | renewals | notices | archived
  p_view         text default 'all',
  p_query        text default null,
  p_type         public.contract_type default null,
  p_lifecycle    public.contract_lifecycle_status default null,
  p_review       public.contract_review_status default null,
  p_owner        uuid default null,
  p_auto_renewal public.contract_auto_renewal default null,
  p_without_owner boolean default false,
  -- §66 — la finestra delle viste «prossimi». Novanta giorni è il default
  -- ragionevole per un contratto: un preavviso di tre mesi va visto prima che
  -- scada, e tre mesi è la durata più diffusa.
  p_window_days  integer default 90,
  p_archived     boolean default false,
  p_sort         text default 'default',
  p_limit        integer default 25,
  p_offset       integer default 0,
  p_contract_id  uuid default null
)
returns table (
  id uuid,
  display_name text,
  contract_type public.contract_type,
  counterparty_name text,
  owner_user_id uuid,
  review_status public.contract_review_status,
  lifecycle_status public.contract_lifecycle_status,
  origin public.contract_origin,
  quality_flags public.contract_quality_flag[],
  internal_note text,
  archived_at timestamptz,
  verified_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  -- I termini effettivi e la loro natura
  term_version_id uuid,
  term_version integer,
  terms_are_draft boolean,
  start_date date,
  end_date date,
  end_date_kind public.contract_end_kind,
  auto_renewal public.contract_auto_renewal,
  renewal_period_value integer,
  renewal_period_unit public.contract_period_unit,
  notice_period_value integer,
  notice_period_unit public.contract_period_unit,
  notice_anchor public.contract_notice_anchor,
  notice_anchor_text text,
  termination_method public.contract_termination_method,
  cost_amount numeric,
  cost_currency text,
  cost_frequency public.contract_cost_frequency,
  price_adjustment boolean,
  -- Le prossime date, con il loro stato: una candidata non è una scadenza
  next_renewal_date date,
  next_renewal_status public.contract_milestone_status,
  next_notice_date date,
  next_notice_status public.contract_milestone_status,
  -- Una bozza in attesa quando i termini in vigore sono altri (§27)
  pending_draft_id uuid,
  document_count bigint,
  amendment_count bigint,
  open_task_count bigint,
  processing_pending_count bigint,
  processing_failed_count bigint,
  total_count bigint
)
language sql
stable
set search_path = ''
as $$
with base as (
  select c.*
    from public.contracts c
   where c.company_id = p_company_id
     and public.is_company_member(c.company_id)
     and (p_contract_id is null or c.id = p_contract_id)
     -- La vista «Archiviati» è una vista, non un filtro in più: o si guardano i
     -- contratti correnti o quelli archiviati, mai un miscuglio dei due.
     and (case when p_view = 'archived' or p_archived then c.archived_at is not null
               else c.archived_at is null end)
     and (p_type is null or c.contract_type = p_type)
     and (p_lifecycle is null or c.lifecycle_status = p_lifecycle)
     and (p_review is null or c.review_status = p_review)
     and (p_owner is null or c.owner_user_id = p_owner)
     and (not p_without_owner or c.owner_user_id is null)
     and (p_query is null or btrim(p_query) = '' or
          (coalesce(c.display_name, '') || ' ' || coalesce(c.counterparty_name, ''))
            ilike '%' || btrim(p_query) || '%'
          -- §68 — la ricerca guarda anche il titolo dei documenti collegati:
          -- chi cerca «Swisscom» può averlo letto sul PDF e non nel nome che
          -- l'azienda ha dato al contratto.
          or exists (
            select 1 from public.contract_documents cd
              join public.documents d on d.id = cd.document_id
             where cd.contract_id = c.id
               and d.title ilike '%' || btrim(p_query) || '%'))
), composed as (
  select b.*,
         t.id as t_id, t.version as t_version, t.status as t_status,
         t.start_date as t_start, t.end_date as t_end, t.end_date_kind as t_end_kind,
         t.auto_renewal as t_renewal, t.renewal_period_value as t_ren_v,
         t.renewal_period_unit as t_ren_u, t.notice_period_value as t_not_v,
         t.notice_period_unit as t_not_u, t.notice_anchor as t_anchor,
         t.notice_anchor_text as t_anchor_text, t.termination_method as t_method,
         t.cost_amount as t_cost, t.cost_currency as t_currency,
         t.cost_frequency as t_freq, t.price_adjustment as t_price_adj,
         t.counterparty_name as t_counterparty,
         ren.due_date as ren_date, ren.status as ren_status,
         nod.due_date as not_date, nod.status as not_status,
         draft.id as draft_id,
         dc.n_documents, dc.n_amendments, dc.n_pending, dc.n_failed,
         tk.n_open_tasks
    from base b
    -- I termini in vigore; se nessuno ha verificato, la bozza — e la riga lo
    -- dichiara con `terms_are_draft`.
    left join lateral (
      select v.* from public.contract_term_versions v
       where v.contract_id = b.id
         and v.id = coalesce(b.current_term_version_id,
                             (select v2.id from public.contract_term_versions v2
                               where v2.contract_id = b.id and v2.status = 'draft' limit 1))
       limit 1
    ) t on true
    -- La bozza in attesa, SOLO se non è già ciò che stiamo mostrando: è il
    -- segnale «c'è una modifica da guardare» (§27).
    left join lateral (
      select v.id from public.contract_term_versions v
       where v.contract_id = b.id and v.status = 'draft'
         and b.current_term_version_id is not null
       limit 1
    ) draft on true
    left join lateral (
      select m.due_date, m.status from public.contract_milestones m
       where m.contract_id = b.id
         and m.kind in ('renewal_date', 'contract_end')
         and m.status in ('candidate', 'verified')
         and m.due_date >= current_date
       order by m.due_date asc, (m.status = 'verified') desc
       limit 1
    ) ren on true
    left join lateral (
      select m.due_date, m.status from public.contract_milestones m
       where m.contract_id = b.id
         and m.kind = 'notice_deadline'
         and m.status in ('candidate', 'verified')
         and m.due_date >= current_date
       order by m.due_date asc, (m.status = 'verified') desc
       limit 1
    ) nod on true
    left join lateral (
      select count(*) as n_documents,
             count(*) filter (where cd.relation in ('amendment', 'renewal')) as n_amendments,
             count(*) filter (where cd.processing_status in ('pending', 'processing')) as n_pending,
             count(*) filter (where cd.processing_status = 'failed') as n_failed
        from public.contract_documents cd where cd.contract_id = b.id
    ) dc on true
    left join lateral (
      select count(*) as n_open_tasks from public.tasks tk2
       where tk2.contract_id = b.id and tk2.status <> 'completed' and tk2.archived_at is null
    ) tk on true
), filtered as (
  select * from composed c
   where case p_view
     when 'needs_review' then c.review_status in ('needs_review', 'review_required_again')
     when 'active'       then c.lifecycle_status = 'active'
     when 'renewals'     then c.ren_date is not null
                              and c.ren_date <= current_date + make_interval(days => greatest(p_window_days, 0))
     when 'notices'      then c.not_date is not null
                              and c.not_date <= current_date + make_interval(days => greatest(p_window_days, 0))
     else true
   end
     and (p_auto_renewal is null or c.t_renewal = p_auto_renewal)
)
select
  f.id, f.display_name, f.contract_type,
  -- La controparte dei termini vince su quella scritta sul contratto: la prima
  -- viene dal documento o da una correzione, la seconda è un'etichetta.
  coalesce(f.t_counterparty, f.counterparty_name),
  f.owner_user_id, f.review_status, f.lifecycle_status, f.origin,
  f.quality_flags, f.internal_note, f.archived_at, f.verified_at,
  f.created_at, f.updated_at,
  f.t_id, f.t_version, (f.t_status = 'draft'),
  f.t_start, f.t_end, f.t_end_kind, f.t_renewal, f.t_ren_v, f.t_ren_u,
  f.t_not_v, f.t_not_u, f.t_anchor, f.t_anchor_text, f.t_method,
  f.t_cost, f.t_currency, f.t_freq, f.t_price_adj,
  f.ren_date, f.ren_status, f.not_date, f.not_status,
  f.draft_id,
  coalesce(f.n_documents, 0), coalesce(f.n_amendments, 0), coalesce(f.n_open_tasks, 0),
  coalesce(f.n_pending, 0), coalesce(f.n_failed, 0),
  count(*) over () as total_count
from filtered f
-- ORDINAMENTO PREDEFINITO (§120): prima ciò che richiede una DECISIONE — un
-- preavviso che si avvicina, un rinnovo che scatta — poi ciò che nessuno ha
-- ancora verificato, poi il resto. `id` chiude sempre la catena: senza, due
-- contratti con la stessa data si scambierebbero di posto fra una pagina e
-- l'altra e uno dei due non comparirebbe mai.
order by
  case when p_sort = 'default' then
    case when f.not_date is not null and f.not_date <= current_date + interval '30 days' then 0
         when f.ren_date is not null and f.ren_date <= current_date + interval '30 days' then 1
         when f.review_status <> 'verified' then 2
         else 3 end
  end asc nulls last,
  case when p_sort = 'default' then coalesce(f.not_date, f.ren_date) end asc nulls last,
  case when p_sort = 'renewal' then f.ren_date end asc nulls last,
  case when p_sort = 'notice' then f.not_date end asc nulls last,
  case when p_sort = 'name' then lower(f.display_name) end asc,
  case when p_sort in ('recent', 'default') then f.updated_at end desc,
  f.id desc
limit greatest(coalesce(p_limit, 25), 1)
offset greatest(coalesce(p_offset, 0), 0)
$$;


-- ---------------------------------------------------------------------------
-- 31. I numeri del cruscotto
--
-- §67 — POCHI, e ognuno risponde a una domanda che porta a un'azione. Non
-- quindici numeri: quattro, e sono quelli che dicono che cosa richiede una
-- decisione (§120).
-- ---------------------------------------------------------------------------
create or replace function public.contract_summary(
  p_company_id  uuid,
  p_window_days integer default 90
)
returns table (
  needs_review    bigint,
  renewals_soon   bigint,
  notices_soon    bigint,
  without_owner   bigint,
  -- Non è un KPI da mostrare: serve alla schermata per sapere se esiste una
  -- lettura in corso, e distinguere «non c'è niente» da «non è ancora pronto».
  processing      bigint
)
language sql
stable
set search_path = ''
as $$
  select
    count(*) filter (where c.review_status in ('needs_review', 'review_required_again')),
    count(*) filter (where exists (
      select 1 from public.contract_milestones m
       where m.contract_id = c.id and m.kind in ('renewal_date', 'contract_end')
         and m.status in ('candidate', 'verified')
         and m.due_date between current_date
             and current_date + make_interval(days => greatest(p_window_days, 0)))),
    count(*) filter (where exists (
      select 1 from public.contract_milestones m
       where m.contract_id = c.id and m.kind = 'notice_deadline'
         and m.status in ('candidate', 'verified')
         and m.due_date between current_date
             and current_date + make_interval(days => greatest(p_window_days, 0)))),
    count(*) filter (where c.owner_user_id is null),
    count(*) filter (where exists (
      select 1 from public.contract_documents cd
       where cd.contract_id = c.id and cd.processing_status in ('pending', 'processing')))
  from public.contracts c
 where c.company_id = p_company_id
   and public.is_company_member(c.company_id)
   and c.archived_at is null
$$;


-- ---------------------------------------------------------------------------
-- 32. I documenti che POTREBBERO appartenere a un contratto
--
-- §77 — si SUGGERISCE, non si collega. Il criterio è deliberatamente povero e
-- verificabile: un documento di categoria «contratti», non ancora collegato a
-- nessun contratto, il cui titolo o il cui mittente somigli alla controparte.
--
-- ⚠️ NON ESISTE UN COLLEGAMENTO AUTOMATICO IN CASI INCERTI, e questa funzione
-- non ne crea: restituisce righe che una persona guarda. Un allegato agganciato
-- al contratto sbagliato cambierebbe i termini di due contratti insieme.
-- ---------------------------------------------------------------------------
create or replace function public.contract_document_suggestions(
  p_contract_id uuid,
  p_limit       integer default 10
)
returns table (
  document_id uuid,
  title text,
  created_at timestamptz,
  category public.document_category,
  reason text
)
language sql
stable
set search_path = ''
as $$
  select d.id, d.title, d.created_at, d.category,
         case when c.counterparty_name is not null
                   and d.title ilike '%' || c.counterparty_name || '%'
              then 'counterparty_in_title' else 'contract_category' end
    from public.contracts c
    join public.documents d on d.company_id = c.company_id
   where c.id = p_contract_id
     and public.is_company_member(c.company_id)
     and d.category = 'contracts'
     and d.archived_at is null
     and not exists (
       select 1 from public.contract_documents cd where cd.document_id = d.id)
     and (c.counterparty_name is null
          or d.title ilike '%' || c.counterparty_name || '%'
          or d.created_at >= c.created_at - interval '30 days')
   order by (case when c.counterparty_name is not null
                       and d.title ilike '%' || c.counterparty_name || '%'
                  then 0 else 1 end),
            d.created_at desc
   limit greatest(coalesce(p_limit, 10), 1)
$$;


-- ---------------------------------------------------------------------------
-- 33. RLS e permessi
--
-- ⚠️ `revoke all` PRIMA dei grant, su ogni tabella nuova. Su Supabase una
-- tabella di `public` nasce con i permessi di TABELLA completi per
-- `authenticated` (`alter default privileges … grant all on tables`), quindi un
-- grant scritto dopo AGGIUNGE privilegi invece di restringerli: è la lezione
-- della 0014, dove i permessi di colonna dichiarati nei commenti non
-- restringevano nulla e il difetto emerse solo ESEGUENDO i test.
--
-- CHE COSA UN MEMBRO PUÒ FARE: leggere i contratti della propria azienda;
-- crearne uno; cambiarne l'organizzazione (nome, tipo, responsabile, stato
-- operativo, nota, archiviazione); collegare e scollegare documenti; aggiungere
-- correzioni; aggiungere date manuali e verificare o scartare quelle proposte.
-- Nient'altro. I verbali non si scrivono, i termini verificati non si toccano,
-- lo stato di verifica passa da `contract_verify_terms` e da nessun'altra parte.
-- ---------------------------------------------------------------------------
alter table public.contracts             enable row level security;
alter table public.contract_documents    enable row level security;
alter table public.contract_extractions  enable row level security;
alter table public.contract_term_versions enable row level security;
alter table public.contract_corrections  enable row level security;
alter table public.contract_milestones   enable row level security;
alter table public.contract_events       enable row level security;

revoke all on public.contracts             from anon, authenticated, public;
revoke all on public.contract_documents    from anon, authenticated, public;
revoke all on public.contract_extractions  from anon, authenticated, public;
revoke all on public.contract_term_versions from anon, authenticated, public;
revoke all on public.contract_corrections  from anon, authenticated, public;
revoke all on public.contract_milestones   from anon, authenticated, public;
revoke all on public.contract_events       from anon, authenticated, public;

grant select on public.contracts to authenticated;
grant insert (company_id, display_name, contract_type, counterparty_name, owner_user_id)
  on public.contracts to authenticated;
-- ⚠️ `review_status`, `verified_at/by`, `current_term_version_id`,
-- `quality_flags`, `origin` NON sono qui, di proposito. Il guardiano li
-- ripristinerebbe comunque, ma senza il permesso un tentativo FALLISCE invece di
-- essere ignorato in silenzio — e un fallimento silenzioso è ciò che questo
-- progetto non ammette.
grant update (display_name, contract_type, counterparty_name, owner_user_id,
              lifecycle_status, internal_note, archived_at)
  on public.contracts to authenticated;

grant select on public.contract_documents to authenticated;
grant insert (company_id, contract_id, document_id, relation, suggested)
  on public.contract_documents to authenticated;
-- `processing_status` è scrivibile per un motivo solo: «Riprova lettura» (§131).
-- Il guardiano impedisce di rimettere in coda ciò che è già in lavorazione.
grant update (relation, processing_status) on public.contract_documents to authenticated;
-- §75 — scollegare un documento è un gesto legittimo: il documento resta nel
-- Document Hub, cambia solo il fatto che appartenga a questo contratto.
grant delete on public.contract_documents to authenticated;

-- I verbali e i termini si leggono e basta. Le versioni le scrivono
-- `contract_refresh_draft` e `contract_verify_terms`, che sono `security
-- definer` e non hanno bisogno di alcun permesso del chiamante.
grant select on public.contract_extractions to authenticated;
grant select on public.contract_term_versions to authenticated;

grant select, insert on public.contract_corrections to authenticated;

grant select on public.contract_milestones to authenticated;
-- Una persona può aggiungere una data e decidere di una data proposta. Non può
-- dichiararne la provenienza né il calcolo: quelli li scrive il database.
grant insert (company_id, contract_id, kind, due_date, label)
  on public.contract_milestones to authenticated;
grant update (status, label) on public.contract_milestones to authenticated;

grant select on public.contract_events to authenticated;

drop policy if exists contracts_select on public.contracts;
create policy contracts_select on public.contracts
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists contracts_insert on public.contracts;
create policy contracts_insert on public.contracts
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists contracts_update on public.contracts;
create policy contracts_update on public.contracts
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- ⚠️ Nessuna policy di DELETE e nessun grant sui contratti (§109): un contratto
-- non si cancella, si ARCHIVIA (§108). Archiviare non tocca i documenti, le
-- attività né lo storico — toglie dalla vista corrente. La cancellazione vera
-- appartiene a una politica di conservazione dei dati che questo prodotto non
-- ha ancora, e inventarla qui significherebbe dare a chiunque il potere di far
-- sparire la memoria di un impegno.

drop policy if exists contract_documents_select on public.contract_documents;
create policy contract_documents_select on public.contract_documents
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists contract_documents_insert on public.contract_documents;
create policy contract_documents_insert on public.contract_documents
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists contract_documents_update on public.contract_documents;
create policy contract_documents_update on public.contract_documents
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists contract_documents_delete on public.contract_documents;
create policy contract_documents_delete on public.contract_documents
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists contract_extractions_select on public.contract_extractions;
create policy contract_extractions_select on public.contract_extractions
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists contract_term_versions_select on public.contract_term_versions;
create policy contract_term_versions_select on public.contract_term_versions
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists contract_corrections_select on public.contract_corrections;
create policy contract_corrections_select on public.contract_corrections
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists contract_corrections_insert on public.contract_corrections;
create policy contract_corrections_insert on public.contract_corrections
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists contract_milestones_select on public.contract_milestones;
create policy contract_milestones_select on public.contract_milestones
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists contract_milestones_insert on public.contract_milestones;
create policy contract_milestones_insert on public.contract_milestones
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists contract_milestones_update on public.contract_milestones;
create policy contract_milestones_update on public.contract_milestones
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists contract_events_select on public.contract_events;
create policy contract_events_select on public.contract_events
  for select to authenticated using (public.is_company_member(company_id));

revoke all on function public.list_contracts(uuid, text, text, public.contract_type, public.contract_lifecycle_status, public.contract_review_status, uuid, public.contract_auto_renewal, boolean, integer, boolean, text, integer, integer, uuid) from public, anon;
grant execute on function public.list_contracts(uuid, text, text, public.contract_type, public.contract_lifecycle_status, public.contract_review_status, uuid, public.contract_auto_renewal, boolean, integer, boolean, text, integer, integer, uuid) to authenticated;
revoke all on function public.contract_summary(uuid, integer) from public, anon;
grant execute on function public.contract_summary(uuid, integer) to authenticated;
revoke all on function public.contract_verify_terms(uuid) from public, anon;
grant execute on function public.contract_verify_terms(uuid) to authenticated;
revoke all on function public.contract_open_draft(uuid) from public, anon;
grant execute on function public.contract_open_draft(uuid) to authenticated;
revoke all on function public.contract_document_suggestions(uuid, integer) from public, anon;
grant execute on function public.contract_document_suggestions(uuid, integer) to authenticated;
-- Le funzioni di calcolo sono leggibili: servono all'interfaccia per spiegare
-- una data derivata, e non scrivono niente.
revoke all on function public.contract_period_interval(integer, public.contract_period_unit) from public, anon;
grant execute on function public.contract_period_interval(integer, public.contract_period_unit) to authenticated;
revoke all on function public.contract_notice_deadline(integer, public.contract_period_unit, public.contract_notice_anchor, date) from public, anon;
grant execute on function public.contract_notice_deadline(integer, public.contract_period_unit, public.contract_notice_anchor, date) to authenticated;
revoke all on function public.contract_calculation_version() from public, anon;
grant execute on function public.contract_calculation_version() to authenticated;


-- ---------------------------------------------------------------------------
-- 34. Autoverifica: la migrazione controlla di aver ottenuto ciò che dichiara.
--
-- Non è un ornamento. La 0013 dichiarava nei commenti una garanzia che non
-- esisteva, e lo si scoprì solo eseguendo i test sul database vero. Da allora
-- ogni migrazione che promette qualcosa la verifica prima di dirsi riuscita.
--
-- ⚠️ Nessuna riga di questo blocco nomina i quattro valori enum aggiunti al
-- punto 2 e nessuna chiama una funzione che li nomini: il blocco viene ESEGUITO,
-- e valutare qui un'etichetta nuova farebbe fallire l'intera applicazione con
-- 55P04. È la trappola della 0015, ed è al quarto giro che la si conosce.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
  v_date date;
begin
  -- ⚠️ `information_schema` riporta il ruolo PUBLIC in MAIUSCOLO: cercare solo
  -- 'public' lascerebbe scoperto proprio il ruolo che vale per CHIUNQUE.

  -- (a) I verbali e i termini NON devono essere scrivibili dal browser. È la
  --     garanzia più importante del modulo: se cade, un membro può riscrivere il
  --     preavviso di un contratto senza lasciare traccia in nessuna correzione,
  --     e la distinzione fra ciò che il documento dice e ciò che qualcuno ha
  --     deciso sparisce.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('contract_extractions', 'contract_term_versions', 'contract_events')
    and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'i verbali e i termini risultano scrivibili dal client: %', v_bad;
  end if;

  -- (b) Un contratto non si cancella dal client (§109).
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'contracts'
    and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
    and privilege_type = 'DELETE';
  if v_bad is not null then
    raise exception 'i contratti risultano cancellabili dal client: %', v_bad;
  end if;

  -- (c) Lo stato di verifica non è scrivibile colonna per colonna.
  select string_agg(format('contracts.%s', column_name), ', ')
    into v_bad
  from information_schema.column_privileges
  where table_schema = 'public'
    and table_name = 'contracts'
    and column_name in ('review_status', 'verified_at', 'verified_by',
                        'current_term_version_id', 'quality_flags', 'origin')
    and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
    and privilege_type in ('INSERT', 'UPDATE');
  if v_bad is not null then
    raise exception 'lo stato di verifica di un contratto risulta scrivibile dal client: %', v_bad;
  end if;

  -- (d) La RLS è accesa su tutte e sette le tabelle.
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('contracts', 'contract_documents', 'contract_extractions',
                       'contract_term_versions', 'contract_corrections',
                       'contract_milestones', 'contract_events')
     and c.relrowsecurity = false;
  if v_bad is not null then
    raise exception 'RLS non attiva su: %', v_bad;
  end if;

  -- (e) ⚠️ L'ARITMETICA DELLE DATE FA QUELLO CHE IL FILE DICHIARA.
  --     Non si verifica la sintassi: si verifica il RISULTATO, perché la
  --     semantica di fine mese di Postgres è un'affermazione di questo file e
  --     un'affermazione non provata è solo scritta. Tre casi che devono tornare,
  --     e uno che deve NON produrre una data.
  v_date := public.contract_notice_deadline(3, 'months', 'before_fixed_end', date '2026-12-31');
  if v_date is distinct from date '2026-09-30' then
    raise exception 'preavviso 3 mesi da 31.12.2026 atteso 30.09.2026, ottenuto %', v_date;
  end if;

  -- 31 marzo meno un mese: il 31 febbraio non esiste e Postgres aggancia la fine
  -- del mese. In un anno bisestile diventa il 29.
  v_date := public.contract_notice_deadline(1, 'months', 'before_fixed_end', date '2024-03-31');
  if v_date is distinct from date '2024-02-29' then
    raise exception 'preavviso 1 mese da 31.03.2024 atteso 29.02.2024, ottenuto %', v_date;
  end if;
  v_date := public.contract_notice_deadline(1, 'months', 'before_fixed_end', date '2026-03-31');
  if v_date is distinct from date '2026-02-28' then
    raise exception 'preavviso 1 mese da 31.03.2026 atteso 28.02.2026, ottenuto %', v_date;
  end if;

  -- §46 — «per fine mese» NON produce una data, ed è il caso che conta di più:
  -- se un giorno qualcuno aggiungesse quell'ancoraggio all'elenco dei
  -- calcolabili, questa riga fallirebbe prima che una scadenza sbagliata
  -- raggiunga un cliente.
  v_date := public.contract_notice_deadline(3, 'months', 'to_month_end', date '2026-12-31');
  if v_date is not null then
    raise exception 'un preavviso «per fine mese» non deve produrre una data, ottenuto %', v_date;
  end if;
  v_date := public.contract_notice_deadline(3, 'months', 'before_fixed_end', null);
  if v_date is not null then
    raise exception 'senza data di riferimento non si deriva alcuna scadenza, ottenuto %', v_date;
  end if;

  raise notice '0024 applicata: 7 tabelle, RLS attiva, permessi verificati, aritmetica delle date provata.';
end $$;


