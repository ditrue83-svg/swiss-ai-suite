-- ============================================================================
-- 0026 — CRM LIGHT: CLIENTI E CONTROPARTI
--
-- Con chi stiamo lavorando? È l'unica domanda che questo modulo aggiunge.
-- Fino alla 0025 il prodotto sapeva che cosa è arrivato (Inbox), che cosa
-- sappiamo (Documenti), che cosa dobbiamo fare (Attività), quando (Calendario),
-- che cosa non dimenticare (Notifiche), che cosa può fare da sé (Automazioni),
-- quali operazioni finanziarie richiedono attenzione (Finanze) e a quali
-- obblighi siamo legati (Contratti). Mancava il soggetto di tutte quelle frasi.
--
-- ⚠️ QUESTA MIGRAZIONE SUPERA UNA DECISIONE SCRITTA, E LO DICE.
-- La 0024, righe 332-335, sul campo `contracts.counterparty_name`:
--   «la controparte è METADATO CONTRATTUALE, non un'anagrafica. Nessun
--    riferimento a una tabella di clienti o fornitori: quella tabella non
--    esiste, e crearla qui significherebbe cominciare un CRM di straforo».
-- E docs/finance-operations.md riga 63: «nessuna anagrafica fornitori: il
-- fornitore è un nome letto sul documento».
-- Erano affermazioni giuste FINCHÉ la tabella non esisteva. Qui esiste, e il
-- modo in cui quelle scelte vengono superate è il punto: NESSUN NOME ESTRATTO
-- VIENE RISCRITTO. `contracts.counterparty_name`, `contract_extractions.
-- counterparty`, `finance_items.eff_supplier_name`, `email_messages.
-- sender_email` restano esattamente ciò che erano. Accanto compare una colonna
-- di collegamento FACOLTATIVA e ANNULLABILE. Un contratto con
-- `counterparty_organization_id = null` è uno stato legittimo e resta tale.
--
-- ⚠️ COLLEGARE, NON COPIARE. Nessuna tabella di questo file contiene una copia
-- del corpo di una email, del testo di un documento, di una clausola, di un
-- importo estratto o di un commento. La timeline COMPONE riferimenti.
--
-- ⚠️ SUGGERIRE, NON INVENTARE. Nessuna organizzazione nasce da sola.
-- Misurato sulle 117 email vere della casella collegata (2026-07-29):
-- 54 mittenti distinti, 44 domini, 57 messaggi `is_bulk`, 40 mittenti
-- noreply/newsletter, 55 messaggi `clearly_irrelevant`. Creare un'anagrafica
-- per mittente avrebbe prodotto 44 righe fatte di stripe.com, amazon.it,
-- mail.adobe.com. Con il filtro di questo modulo i 54 mittenti diventano 6 —
-- e fra quei 6 restano ancora amazon.it e info.interdiscount.ch. Perciò quelle
-- righe sono SUGGERIMENTI (crm_link_suggestions), non clienti.
--
-- ⚠️ VERIFICARE, NON FONDERE. Due nomi simili non sono la stessa impresa.
-- L'unico abbinamento automatico ammesso è su identità forte (IDI valido o
-- indirizzo email identico). Tutto il resto si propone a una persona.
--
--   COMUNICAZIONE → CONTROPARTE → PERSONE → DOCUMENTI → OPPORTUNITÀ
--                 → ATTIVITÀ → CONTRATTI → FINANZE → STORICO DELLA RELAZIONE
--
-- Requisiti: 0001–0025 applicate.
-- Documento di modulo: docs/crm-light.md
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. I tipi
--
-- Tutti con `create type … as enum (…)`: i valori dichiarati alla creazione
-- sono utilizzabili SUBITO, anche nella stessa transazione. È la differenza con
-- `alter type … add value` della sezione 2, che rende l'etichetta inservibile
-- fino al commit (55P04, lezione della 0015 e poi della 0022).
-- ---------------------------------------------------------------------------

-- Che rapporto abbiamo con questa organizzazione. §8 — sono RUOLI, non stati, e
-- sono MULTIPLI: la stessa impresa può essere insieme cliente, fornitore e
-- partner. Un campo unico `type = 'customer'` avrebbe reso quel caso — comune in
-- una PMI — inesprimibile.
do $$ begin
  create type public.crm_organization_role as enum (
    'lead',            -- un nome arrivato, nessun rapporto ancora
    'prospect',        -- ci stiamo parlando
    'customer',
    'former_customer', -- è stato cliente: non è un lead, e non è un cliente
    'supplier',
    'partner',
    'authority',       -- comune, cantone, Confederazione, cassa, assicurazione sociale
    'other'
  );
exception when duplicate_object then null; end $$;

-- Lo stato del rapporto. §10 — DUE valori, non tre.
-- ⚠️ «archived» NON è qui: l'archiviazione è `archived_at` / `archived_by`,
-- come in documents, tasks, contracts, finance_items. Uno stato che duplica un
-- timestamp finisce per divergere dal timestamp, e allora nessuno dei due si
-- può più credere.
do $$ begin
  create type public.crm_relationship_status as enum ('active', 'inactive');
exception when duplicate_object then null; end $$;

-- Da dove viene questa riga. §19 — la provenienza NON è una verifica: una
-- controparte suggerita da una fattura non è per questo un'anagrafica
-- verificata, ed è la ragione per cui `source` e i suggerimenti convivono.
do $$ begin
  create type public.crm_source as enum (
    'manual',     -- l'ha scritta una persona
    'email',      -- proposta da un mittente, e poi confermata
    'document',
    'contract',
    'finance',
    'registry',   -- importata da Zefix, con il disclaimer di non vincolatività
    'import'
  );
exception when duplicate_object then null; end $$;

-- Un recapito. §14 — una persona non ha UN indirizzo: ne ha quanti ne ha.
do $$ begin
  create type public.crm_contact_method_type as enum (
    'email', 'phone', 'mobile', 'website', 'other'
  );
exception when duplicate_object then null; end $$;

-- La fase di una TRATTATIVA. §9 e §41 — non è il ruolo dell'organizzazione:
-- `customer` descrive un rapporto, `negotiation` descrive una singola pratica.
-- Confonderli produrrebbe un cliente che «torna lead» perché una seconda
-- trattativa è appena cominciata.
do $$ begin
  create type public.crm_opportunity_stage as enum (
    'lead', 'contacted', 'proposal', 'negotiation', 'won', 'lost'
  );
exception when duplicate_object then null; end $$;

-- Un contatto avvenuto che nessun altro modulo registra. §63 e §64 — le email
-- NON entrano qui: restano in `email_messages` e si collegano. Copiarle
-- produrrebbe due verità sulla stessa conversazione.
do $$ begin
  create type public.crm_interaction_type as enum ('note', 'call', 'meeting', 'other');
exception when duplicate_object then null; end $$;

-- Che ruolo ha un documento rispetto a questa organizzazione. §34.
do $$ begin
  create type public.crm_document_relation as enum (
    'sender', 'recipient', 'counterparty', 'customer', 'supplier', 'other'
  );
exception when duplicate_object then null; end $$;

-- Perché due cose sono state avvicinate. §22-§25 — il motivo NON è decorativo:
-- decide se il collegamento può avvenire da solo o deve passare da una persona.
-- `uid_exact` ed `email_exact` sono identità; `domain_match` e `name_normalized`
-- sono sospetti, e restano suggerimenti.
do $$ begin
  create type public.crm_match_reason as enum (
    'uid_exact',
    'email_exact',
    'domain_match',
    'name_normalized',
    'manual'
  );
exception when duplicate_object then null; end $$;

-- Che fine ha fatto un suggerimento. §21.
-- `ignored` non è `rejected`: «non ora» e «no» sono risposte diverse, e la
-- seconda non va riproposta.
do $$ begin
  create type public.crm_link_status as enum ('pending', 'accepted', 'rejected', 'ignored');
exception when duplicate_object then null; end $$;

-- Lo storico. §85 — append-only, scritto SOLO da trigger. Non c'è un valore per
-- «qualcuno ha aperto la scheda»: registrare le visualizzazioni sarebbe
-- sorveglianza, non storia.
do $$ begin
  create type public.crm_event_kind as enum (
    'organization_created',
    'organization_updated',
    'role_added',
    'role_removed',
    'owner_changed',
    'contact_added',
    'contact_linked',
    'contact_unlinked',
    'opportunity_created',
    'opportunity_stage_changed',
    'opportunity_won',
    'opportunity_lost',
    'interaction_created',
    'entity_linked',
    'entity_unlinked',
    'archived',
    'restored',
    'merged'
  );
exception when duplicate_object then null; end $$;

-- Che cosa è stato collegato. Serve allo storico per dire «documento» invece di
-- un id nudo, e ai suggerimenti per sapere da dove sono nati.
do $$ begin
  create type public.crm_linked_entity as enum (
    'document', 'email_message', 'task', 'contract', 'finance_item', 'opportunity'
  );
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- 2. I valori aggiunti a enum ESISTENTI
--
-- ⚠️⚠️ REGOLA CHE VALE PER TUTTO IL RESTO DEL FILE, E CHE È GIÀ COSTATA DUE
-- MIGRAZIONI (0015, 0022): un valore aggiunto con `alter type … add value` NON
-- è utilizzabile in nessun'altra ISTRUZIONE di questo file. Non in un indice
-- parziale, non in un insert, non in un default, non in un check, non in un
-- blocco anonimo `do`. Postgres lo rifiuta con 55P04 finché la transazione non
-- è chiusa, e `supabase/full-setup.sql` concatena TUTTE le migrazioni in una
-- transazione sola: spezzare in due file non risolverebbe, romperebbe soltanto
-- le installazioni da zero, cioè il prossimo cliente.
-- (Nota di forma: in questo file nessun commento contiene la coppia di dollari
-- che delimita un corpo, così il bilanciamento dei delimitatori si può
-- verificare contandoli — un controllo che altrimenti darebbe un falso allarme.)
--
-- L'ECCEZIONE, ed è quella che rende possibile questo modulo: il letterale PUÒ
-- comparire dentro il CORPO di una `create function`, perché Postgres deposita
-- il corpo come testo e risolve l'etichetta alla prima ESECUZIONE. Tutti i
-- trigger di questo file che emettono eventi o notifiche usano quell'eccezione.
-- `scripts/bundle-migrations.mjs` conosce la differenza e la verifica.
-- ---------------------------------------------------------------------------

-- §131 — sei inneschi, e solo quelli che hanno davvero una sorgente in questo
-- file. `crm_follow_up_due` non ne ha una propria: riusa lo scanner periodico
-- della sezione 20, che a sua volta gira dentro il worker già acceso. Nessun
-- cron nuovo (regola scritta nella 0024 riga 2553).
alter type public.automation_event_type add value if not exists 'crm_organization_created';
alter type public.automation_event_type add value if not exists 'crm_role_added';
alter type public.automation_event_type add value if not exists 'crm_opportunity_created';
alter type public.automation_event_type add value if not exists 'crm_opportunity_stage_changed';
alter type public.automation_event_type add value if not exists 'crm_opportunity_won';
alter type public.automation_event_type add value if not exists 'crm_follow_up_due';

-- §141 — NON si crea `crm_notifications`. `public.notifications` è già per
-- utente, ha già RLS per persona, grant di sola select, guardiano di
-- membership e funzioni di marcatura. Una seconda campanella sarebbe una
-- seconda campanella.
alter type public.notification_type add value if not exists 'crm_opportunity_assigned';

-- §50 — un'attività può nascere dal CRM, e allora lo dice.
-- ⚠️ Va aggiunto anche allo switch esaustivo `sourceLabelKey()` in
-- src/features/tasks/taskFormat.ts con le tre traduzioni, altrimenti il
-- typecheck fallisce — ed è voluto che fallisca.
alter type public.task_source add value if not exists 'crm';


-- ---------------------------------------------------------------------------
-- 3. Le funzioni di normalizzazione
--
-- Sono PURE e `immutable`: servono agli indici, alle colonne generate e al
-- confronto. Ognuna ha un gemello in TypeScript, e `test:crm-unit` legge QUESTO
-- FILE per verificare che le due copie non siano divergenti — è l'unico
-- controllo che può vederlo, perché il typecheck non guarda dentro l'SQL.
--
-- ⚠️ NESSUNA DI QUESTE FUNZIONI È UN'IDENTITÀ, tranne quella dell'IDI.
-- Normalizzare serve a SOSPETTARE, non a decidere.
-- ---------------------------------------------------------------------------

-- §15 — l'email si confronta in minuscolo e senza spazi, e NIENT'ALTRO.
-- ⚠️ Non si tolgono i punti di Gmail e non si taglia il `+tag`: sono regole di
-- un fornitore, non del protocollo, e applicarle significa DECIDERE che due
-- indirizzi diversi sono la stessa persona. Se sbaglia, sbaglia unendo persone.
-- Nota utile: `email_messages.sender_email` è GIÀ minuscolo alla sorgente
-- (parseAddress in _shared/email/normalize.ts), quindi il confronto con questa
-- funzione è esatto senza ulteriore lavoro.
create or replace function public.crm_norm_email(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(btrim(coalesce(p_value, ''))), '');
$$;

comment on function public.crm_norm_email(text) is
  'Minuscolo e spazi tolti. Nessuna regola di provider: togliere i punti di '
  'Gmail o il +tag significherebbe inventare un''identità (§15).';

-- Il dominio di un indirizzo o di un sito, per il confronto del §23.
-- Accetta sia `laura@rossi.ch` sia `https://www.rossi.ch/chi-siamo`.
create or replace function public.crm_norm_domain(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          lower(btrim(coalesce(p_value, ''))),
          '^[a-z][a-z0-9+.-]*://', ''            -- via lo schema
        ),
        '^[^@/]*@', ''                            -- se è un indirizzo, via la parte locale
      ),
      '^(www\.)?([^/:?#]*).*$', '\2'              -- via www., via percorso/porta/query
    ),
    ''
  );
$$;

comment on function public.crm_norm_domain(text) is
  'Il dominio di un indirizzo o di un URL, in minuscolo, senza schema, senza '
  '«www.» e senza percorso. Serve al suggerimento del §23, mai a un '
  'collegamento automatico.';

-- §24 — un dominio pubblico NON prova che due persone lavorino insieme.
-- ⚠️ Questo elenco esiste in DUE posti: qui e in `src/features/crm/crmMatch.ts`.
-- La duplicazione è deliberata (l'SQL deve poter filtrare senza chiamare il
-- browser) e sorvegliata: `test:crm-unit` legge questo file, estrae l'array e
-- lo confronta con la costante TypeScript. È l'unico modo di accorgersi che
-- divergono — la lezione degli ancoraggi dei contratti, che vivevano in due
-- posti e in uno solo erano giusti.
create or replace function public.crm_is_public_domain(p_domain text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(lower(btrim(p_domain)), '') = any (array[
    'gmail.com',
    'googlemail.com',
    'outlook.com',
    'hotmail.com',
    'hotmail.ch',
    'live.com',
    'msn.com',
    'yahoo.com',
    'yahoo.it',
    'icloud.com',
    'me.com',
    'proton.me',
    'protonmail.com',
    'gmx.ch',
    'gmx.net',
    'bluewin.ch',
    'sunrise.ch',
    'hispeed.ch',
    'tiscali.it',
    'libero.it',
    'aol.com'
  ]);
$$;

comment on function public.crm_is_public_domain(text) is
  'Vero per i domini di posta pubblici. §24 — «bluewin.ch» non è un''impresa: '
  'due indirizzi su un dominio pubblico non collegano nessuno. L''elenco è '
  'duplicato in src/features/crm/crmMatch.ts e test:crm-unit confronta le copie.';

-- L'IDI, in forma canonica per il confronto: `CHE` + 9 cifre, senza punti.
-- ⚠️ Ritorna NULL se la CIFRA DI CONTROLLO non torna, e questo è il punto:
-- un IDI non verificato non identifica nessuno, quindi non deve poter
-- collegare niente da solo (§25 grado 1). L'algoritmo mod-11 è lo stesso di
-- `uidDigits/isValidUid` in src/lib/uid.ts e di `checkUid` in
-- supabase/functions/_shared/finance/checksums.ts: la terza copia è dichiarata,
-- e `test:crm` la confronta con la seconda su una serie di IDI veri.
create or replace function public.crm_norm_uid(p_value text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_digits text;
  v_weights integer[] := array[5, 4, 3, 2, 7, 6, 5, 4];
  v_sum     integer := 0;
  v_check   integer;
  i         integer;
begin
  v_digits := regexp_replace(coalesce(p_value, ''), '\D', '', 'g');
  if length(v_digits) <> 9 then
    return null;
  end if;

  for i in 1..8 loop
    v_sum := v_sum + (substr(v_digits, i, 1))::integer * v_weights[i];
  end loop;

  v_check := 11 - (v_sum % 11);
  -- 10 non è una cifra e 11 si riscrive 0: sono i due casi che una lettura
  -- distratta della norma perde, e sono esattamente quelli che fanno passare
  -- un IDI inventato.
  if v_check = 11 then
    v_check := 0;
  elsif v_check = 10 then
    return null;
  end if;

  if v_check <> (substr(v_digits, 9, 1))::integer then
    return null;
  end if;

  return 'CHE' || v_digits;
end $$;

comment on function public.crm_norm_uid(text) is
  'L''IDI in forma canonica CHE+9 cifre, oppure NULL se la cifra di controllo '
  'mod-11 non torna. §25 — un IDI non verificato non identifica nessuno e non '
  'deve poter collegare niente da solo.';

-- §16 — il telefono si normalizza con prudenza, per cercare e per sospettare un
-- doppione. Non si costruisce un sistema telefonico: non si indovina il
-- prefisso internazionale mancante, perché indovinarlo significa attribuire un
-- paese a un numero che non lo dichiara. Il valore ORIGINALE resta sempre.
create or replace function public.crm_norm_phone(p_value text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(
    case
      when btrim(coalesce(p_value, '')) like '+%'
        then '+' || regexp_replace(p_value, '\D', '', 'g')
      else regexp_replace(coalesce(p_value, ''), '\D', '', 'g')
    end,
    ''
  );
$$;

comment on function public.crm_norm_phone(text) is
  'Solo cifre, con il + iniziale se c''era. Non si indovina il prefisso '
  'internazionale mancante: sarebbe attribuire un paese a un numero che non lo '
  'dichiara (§16). Il valore originale resta in `value`.';


-- ---------------------------------------------------------------------------
-- 4. crm_organizations — LA CONTROPARTE
--
-- §5. È il centro del modulo: un'impresa, un ente, uno studio, un comune.
--
-- ⚠️ NON È `public.companies`. Quella è il TENANT — l'impresa che USA
-- AI-Swisse, una riga per cliente, creata solo dalla RPC
-- `create_company_with_owner`. Qui c'è chi sta DALL'ALTRA PARTE. Metterle nella
-- stessa tabella con una bandierina avrebbe reso possibile, con un errore di
-- filtro, mostrare a un cliente l'elenco degli altri clienti del prodotto.
-- Conseguenza da tenere a mente: `companies.uid_che` è l'IDI di chi usa il
-- prodotto, `crm_organizations.uid_che` è l'IDI di una controparte. Non sono
-- la stessa cosa e non vanno confrontati fra loro.
--
-- ⚠️ NIENTE `primary_email` / `primary_phone` QUI (deviazione dichiarata dal
-- §5, che chiede di adattare il modello alle convenzioni reali). Sarebbero una
-- seconda verità accanto a `crm_contact_methods`, dove `is_primary` esiste già
-- e vale sia per le persone sia per le organizzazioni. Il recapito principale
-- è un valore COMPOSTO IN LETTURA, non una colonna scritta due volte: è la
-- stessa disciplina per cui Documenti compone il mittente effettivo invece di
-- ricopiarlo.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_organizations (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,

  -- §6 — due nomi, perché servono a due cose. `display_name` è come la
  -- chiamiamo noi e compare in ogni schermata; `legal_name` è la ragione
  -- sociale. «Swisscom» e «Swisscom (Svizzera) SA» sono la stessa impresa, e
  -- costringere l'una a fare da titolo dell'altra rende le liste illeggibili.
  display_name  text not null,
  legal_name    text,

  -- §7 — identificativi, MAI obbligatori: non tutte le controparti sono
  -- svizzere, non tutte sono iscritte, e una persona fisica non ha un IDI.
  -- `uid_che` è l'unica identità forte del modello (vedi l'indice unico della
  -- sezione 15); `uid_norm` è la sua forma canonica ed è scritta dal database,
  -- non dal client.
  uid_che       text,
  uid_norm      text,
  vat_number    text,

  website       text,
  -- Scritto dal guardiano da `website`. Serve al suggerimento del §23, e per
  -- questo NON è nei grant: un dominio scritto a mano diverso dal sito
  -- renderebbe il suggerimento una bugia con l'aria di un calcolo.
  website_domain text,

  -- §5 — l'indirizzo sta qui e non in una tabella a parte: nel repository non
  -- esiste alcun modello di indirizzo riutilizzabile (`public.companies` ha
  -- soltanto canton e municipality) e inventarne uno per una riga sola
  -- sarebbe una tabella in più senza un secondo utente.
  street        text,
  postal_code   text,
  city          text,
  -- ⚠️ Sigla cantonale a due lettere (`TI`, `LU`, `SG`), NON l'etichetta a sei
  -- valori di `programs.ts`: quella è il perimetro del catalogo incentivi, non
  -- della Svizzera, e un cliente di Lucerna registrato come «Altro» sarebbe un
  -- dato perso. La ricerca Zefix per nome NON restituisce il cantone: quando
  -- manca resta null, e null vuol dire «non lo sappiamo».
  canton        text,
  country_code  text,

  relationship_status public.crm_relationship_status not null default 'active',
  account_owner_user_id uuid references auth.users(id) on delete set null,

  source        public.crm_source not null default 'manual',
  -- §19 — da dove è arrivato il suggerimento che ha prodotto questa riga.
  -- Non è una verifica: dice solo chi l'ha proposta.
  source_detail text,

  notes         text,

  -- §67 — COPIA DENORMALIZZATA DICHIARATA, come `email_messages.
  -- analysis_deadline`. La verità sono le email collegate e le interazioni; qui
  -- c'è il massimo delle loro date, ricalcolato dal database
  -- (`crm_refresh_last_contact`) e MAI scrivibile dal client. Un campo manuale
  -- «ultimo contatto» avrebbe finito per contraddire la timeline che gli sta
  -- sotto, ed è esattamente il tipo di divergenza che questo progetto paga caro.
  last_contact_at timestamptz,

  archived_at   timestamptz,
  archived_by   uuid references auth.users(id) on delete set null,

  -- §31 — dopo una fusione il record secondario non sparisce: resta archiviato
  -- e punta al principale, così i vecchi collegamenti e i vecchi indirizzi
  -- continuano a portare da qualche parte invece che nel vuoto.
  merged_into_id uuid references public.crm_organizations(id) on delete set null,

  -- §140 — protezione dai cicli: se questa riga è nata da un'automazione, si sa
  -- quale. Senza, «quando nasce un cliente, crea un cliente» girerebbe per
  -- sempre. Precedenti: tasks.workflow_run_id (0020), contracts.workflow_run_id (0024).
  workflow_run_id uuid references public.workflow_runs(id) on delete set null,

  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint crm_org_display_name_not_blank check (btrim(display_name) <> ''),
  constraint crm_org_canton_len check (canton is null or length(canton) = 2),
  constraint crm_org_country_len check (country_code is null or length(country_code) = 2),
  constraint crm_org_not_merged_into_self check (merged_into_id is null or merged_into_id <> id)
);

comment on table public.crm_organizations is
  'Una controparte: cliente, fornitore, partner, ente. NON è public.companies, '
  'che è il tenant. Il nome estratto dai documenti non viene mai riscritto qui: '
  'questa tabella aggiunge un''identità, non sostituisce un fatto.';

comment on column public.crm_organizations.last_contact_at is
  'Copia denormalizzata dichiarata (§67): il massimo fra le date delle email '
  'collegate e delle interazioni. La scrive crm_refresh_last_contact, non il '
  'client. Fonte di verità: crm_organization_emails e crm_interactions.';

comment on column public.crm_organizations.uid_norm is
  'Forma canonica dell''IDI (CHE + 9 cifre) oppure NULL se la cifra di '
  'controllo non torna. Scritta dal guardiano. È l''unica identità forte del '
  'modello e regge l''indice unico.';


-- ---------------------------------------------------------------------------
-- 5. crm_organization_roles — I RUOLI, AL PLURALE
--
-- §3 e §8. Il caso che una colonna sola rendeva inesprimibile: l'officina che
-- ci ripara i furgoni (fornitore) e a cui vendiamo il gestionale (cliente).
-- Una riga per ruolo, `unique (organization_id, role)`.
--
-- ⚠️ §42 — quando un'opportunità è vinta si AGGIUNGE il ruolo `customer` e NON
-- si toglie `prospect`: cancellare il passato per aggiornare il presente è il
-- modo più rapido di perdere la storia di come è nato un cliente.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_organization_roles (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.crm_organizations(id) on delete cascade,
  role            public.crm_organization_role not null,
  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint uq_crm_org_role unique (organization_id, role)
);

comment on table public.crm_organization_roles is
  'I ruoli di un''organizzazione, multipli per scelta (§3): la stessa impresa '
  'può essere cliente, fornitore e partner nello stesso momento.';


-- ---------------------------------------------------------------------------
-- 6. crm_contacts — LE PERSONE
--
-- §4 e §13. «Laura Bianchi» è una riga; «Rossi SA» è un'altra; il legame è la
-- sezione 8. Salvare «Laura Bianchi — Rossi SA» come stringa unica avrebbe
-- reso impossibile la cosa che succede davvero: Laura cambia azienda.
--
-- ⚠️ Nome e cognome NON sono obbligatori separatamente (§13): di molti
-- contatti si conosce solo «Studio Bernasconi» o un nome di battesimo. Ciò che
-- è obbligatorio è `display_name`, perché una riga senza un modo di chiamarla
-- non serve a nessuno.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_contacts (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete cascade,

  first_name    text,
  last_name     text,
  display_name  text not null,

  -- Serve a scrivere alla persona nella sua lingua. Le tre del prodotto, e
  -- null quando non si sa: un default 'it' sarebbe un'ipotesi travestita da dato.
  preferred_language text,

  notes         text,

  archived_at   timestamptz,
  archived_by   uuid references auth.users(id) on delete set null,

  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint crm_contact_display_name_not_blank check (btrim(display_name) <> ''),
  constraint crm_contact_language_known
    check (preferred_language is null or preferred_language in ('it', 'de', 'fr'))
);

comment on table public.crm_contacts is
  'Le persone di contatto. §119 — solo dati professionali: nessuna data di '
  'nascita, nessun documento d''identità, nessun profilo social, nessuna '
  'categoria sensibile. Non sono utenti dell''applicazione.';


-- ---------------------------------------------------------------------------
-- 7. crm_contact_methods — I RECAPITI
--
-- §14. Una riga appartiene a UNA PERSONA oppure a UN'ORGANIZZAZIONE, mai a
-- entrambe e mai a nessuna: il check `crm_method_owner_xor` lo impone.
-- `info@rossi.ch` è dell'organizzazione, `laura@rossi.ch` è di Laura — ed è
-- proprio questa distinzione che evita di attribuire a una persona la casella
-- generale dell'azienda.
--
-- ⚠️ `normalized_value` la scrive il guardiano, non il client: è la chiave con
-- cui si riconosce un mittente, e lasciarla scrivere significherebbe permettere
-- di dichiarare che un indirizzo è un altro.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_contact_methods (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,

  contact_id      uuid references public.crm_contacts(id) on delete cascade,
  organization_id uuid references public.crm_organizations(id) on delete cascade,

  type            public.crm_contact_method_type not null,
  value           text not null,
  normalized_value text,
  label           text,
  is_primary      boolean not null default false,

  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint crm_method_owner_xor
    check ((contact_id is not null) <> (organization_id is not null)),
  constraint crm_method_value_not_blank check (btrim(value) <> '')
);

comment on table public.crm_contact_methods is
  'Email, telefoni e siti di una persona OPPURE di un''organizzazione (mai di '
  'entrambe). normalized_value è scritta dal database ed è la chiave del match '
  'esatto del §22.';


-- ---------------------------------------------------------------------------
-- 8. crm_contact_organizations — DOVE LAVORA, E DOVE LAVORAVA
--
-- §17 e §18. Quando Laura passa da Rossi SA a Bianchi SA non si riscrive il
-- passato: la riga vecchia riceve `active_until` e ne nasce una nuova. Le email
-- di due anni fa restano email scambiate con Rossi SA, perché è quello che sono
-- state.
--
-- Per la versione 1 basta una relazione principale attiva — ed è ciò che l'
-- interfaccia mostra — ma la forma della tabella non impedisce di conservarne
-- la storia, e questa è l'unica cosa che davvero non si può aggiungere dopo.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_contact_organizations (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  contact_id      uuid not null references public.crm_contacts(id) on delete cascade,
  organization_id uuid not null references public.crm_organizations(id) on delete cascade,

  job_title       text,
  department      text,
  is_primary      boolean not null default false,

  active_from     date,
  active_until    date,

  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint uq_crm_contact_org unique (contact_id, organization_id, active_from),
  constraint crm_contact_org_period
    check (active_until is null or active_from is null or active_until >= active_from)
);

comment on table public.crm_contact_organizations is
  'Chi lavora dove, con la storia: un rapporto finito riceve active_until e '
  'non viene cancellato (§18).';


-- ---------------------------------------------------------------------------
-- 9. crm_opportunities — LE TRATTATIVE
--
-- §40. Una pratica commerciale con una fase, un responsabile, un prossimo passo.
--
-- ⚠️ §44 — NESSUNA PROBABILITÀ. Non c'è una colonna `probability`, e non è una
-- dimenticanza: «Offerta = 50%» ha l'aria di una misura e non deriva da niente.
-- Sommata su venti trattative produce un numero che qualcuno userà per decidere.
-- ⚠️ §47 — nessuna previsione, nessun ponderato, nessun obiettivo raggiunto.
-- ⚠️ §45 — il valore porta la SUA valuta e non si somma con le altre. Il totale
-- di pipeline è per valuta, e lo calcola il database (sezione 21) proprio per
-- non farlo fare a JavaScript in virgola mobile.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_opportunities (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.crm_organizations(id) on delete cascade,
  -- §177 — se c'è, deve essere una persona DI QUELLA organizzazione: il
  -- guardiano lo verifica. Collegare il referente di Rossi SA a una trattativa
  -- con Bianchi SA è l'errore che si fa scegliendo dalla tendina sbagliata, e
  -- sarebbe invisibile.
  primary_contact_id uuid references public.crm_contacts(id) on delete set null,

  title           text not null,
  stage           public.crm_opportunity_stage not null default 'lead',
  owner_user_id   uuid references auth.users(id) on delete set null,

  -- §46 — facoltativo: molte trattative non hanno un valore stimato, e
  -- obbligarlo produrrebbe cifre inventate. `numeric(14,2)` e non `numeric`
  -- nudo come in Finanze: là l'importo è LETTO da un documento e la scala la
  -- decide il documento, qui lo scrive una persona e due decimali sono la
  -- forma giusta di un importo scritto a mano.
  value_amount    numeric(14,2),
  value_currency  text,

  expected_close_date date,

  -- §49 e §50 — la sintesi commerciale, non il lavoro. Il lavoro è un'attività,
  -- e il pulsante «Crea attività dal prossimo passo» le collega senza
  -- duplicarle.
  next_step       text,
  next_step_due_date date,

  lost_reason     text,
  won_at          timestamptz,
  lost_at         timestamptz,

  archived_at     timestamptz,
  archived_by     uuid references auth.users(id) on delete set null,

  workflow_run_id uuid references public.workflow_runs(id) on delete set null,

  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint crm_opp_title_not_blank check (btrim(title) <> ''),
  -- §175 — il timbro esiste se e solo se la fase lo prevede. Un `won_at` su una
  -- trattativa in negoziazione sarebbe una data di vittoria mai avvenuta.
  constraint crm_opp_won_stamp check ((stage = 'won') = (won_at is not null)),
  constraint crm_opp_lost_stamp check ((stage = 'lost') = (lost_at is not null)),
  -- §45 — se c'è un importo c'è la valuta. Un numero senza valuta finirebbe
  -- sommato a qualunque cosa: è la finzione tolta dal prodotto il 2026-07-29,
  -- e non si rientra dalla finestra.
  constraint crm_opp_currency_with_amount
    check (value_amount is null or (value_currency is not null and length(value_currency) = 3)),
  constraint crm_opp_amount_not_negative check (value_amount is null or value_amount >= 0)
);

comment on table public.crm_opportunities is
  'Le trattative commerciali. Nessuna probabilità di chiusura e nessuna '
  'previsione (§44, §47): sarebbero numeri decorativi. Il valore porta sempre '
  'la sua valuta e non si somma con le altre (§45).';


-- ---------------------------------------------------------------------------
-- 10. crm_interactions — I CONTATTI CHE NESSUN ALTRO MODULO REGISTRA
--
-- §63. Una telefonata, una visita, una nota.
--
-- ⚠️ §64 — LE EMAIL NON ENTRANO QUI. Restano in `email_messages` e si
-- collegano: copiarle produrrebbe due verità sulla stessa conversazione, e la
-- copia invecchierebbe.
-- ⚠️ §65 — una nota «riunione» dice che una riunione c'è stata. Non è un
-- appuntamento e non parla con il calendario: per fissare qualcosa si crea
-- un'attività con una scadenza, e il calendario arriva da lì.
-- ⚠️ §66 — testo semplice. Nessun HTML, nessuna formattazione: il corpo di
-- queste note viene mostrato come testo e non c'è alcun percorso in cui
-- diventi markup.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_interactions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.crm_organizations(id) on delete cascade,
  contact_id      uuid references public.crm_contacts(id) on delete set null,
  opportunity_id  uuid references public.crm_opportunities(id) on delete set null,

  type            public.crm_interaction_type not null default 'note',
  occurred_at     timestamptz not null default now(),
  subject         text,
  notes           text,

  created_by      uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  -- §66 — una lunghezza dichiarata invece di un troncamento silenzioso: chi
  -- scrive un romanzo riceve un rifiuto, non una nota tagliata a metà senza
  -- che nessuno glielo dica.
  constraint crm_interaction_subject_len check (subject is null or length(subject) <= 200),
  constraint crm_interaction_notes_len check (notes is null or length(notes) <= 5000)
);

comment on table public.crm_interactions is
  'Note, telefonate e incontri: ciò che è successo e che nessun altro modulo '
  'registra. Le email NON si copiano qui (§64), si collegano.';


-- ---------------------------------------------------------------------------
-- 11. crm_events — LO STORICO
--
-- §85 e §86. Append-only, scritto SOLO da trigger: il client non ha alcun
-- permesso di scrittura, quindi non può firmare un'azione a nome di un collega.
-- È la stessa disciplina di `task_events` e `contract_events`.
--
-- ⚠️ Nel `detail` entrano ID e valori di enum, MAI ragioni sociali o nomi di
-- persone: un jsonb di storico che contenesse i nomi diventerebbe una seconda
-- copia dell'anagrafica, invecchierebbe, e non si potrebbe cancellare quando
-- una persona chiede di essere cancellata.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,

  organization_id uuid references public.crm_organizations(id) on delete cascade,
  contact_id      uuid references public.crm_contacts(id) on delete cascade,
  opportunity_id  uuid references public.crm_opportunities(id) on delete cascade,

  kind            public.crm_event_kind not null,
  detail          jsonb not null default '{}'::jsonb,

  actor_user_id   uuid references auth.users(id) on delete set null,
  occurred_at     timestamptz not null default now()
);

comment on table public.crm_events is
  'Storico append-only del CRM, scritto solo dai trigger (§86). Nel detail '
  'entrano identificativi e valori di enum, mai nomi: sarebbe una seconda '
  'copia dell''anagrafica.';


-- ---------------------------------------------------------------------------
-- 12. I COLLEGAMENTI — quattro tabelle ponte
--
-- §32 e §33. Non un JSON polimorfico senza chiavi esterne: quattro tabelle con
-- integrità vera, sul modello di `public.contract_documents` (0024) e di
-- `public.email_message_documents` (0013), che sono i due ponti già collaudati
-- del repository.
--
-- ⚠️ PERCHÉ NON UNA COLONNA SULLE TABELLE ESISTENTI:
-- (a) su `email_messages` il client ha `grant update (seen_at, attention_status)`
--     e nient'altro — una colonna nuova là non sarebbe scrivibile dal browser;
-- (b) su `documents` i grant sono di TABELLA dalla 0002, quindi una colonna
--     nuova sarebbe scrivibile da chiunque con qualunque valore;
-- (c) la relazione è molti-a-molti nei fatti: una email può riguardare due
--     controparti, e lo stesso documento può appartenere a più email
--     (deduplicazione per file_hash in createOrReuseDocument).
--
-- ⚠️ `company_id` è RIDONDANTE in tutte e quattro, ed è voluto: permette alla
-- RLS di filtrare senza join e al guardiano di confrontare tre valori invece
-- di dedurne uno.
-- ---------------------------------------------------------------------------

-- §34 — un documento può riguardare più controparti, e con ruoli diversi:
-- il mittente di una fattura e il cliente a cui si riferisce non sono la stessa
-- organizzazione.
create table if not exists public.crm_organization_documents (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  organization_id uuid not null references public.crm_organizations(id) on delete cascade,
  document_id     uuid not null references public.documents(id) on delete cascade,

  relation        public.crm_document_relation not null default 'counterparty',
  -- §77 della 0024, ripreso qui: «l'ha collegato una persona» e «l'ha proposto
  -- il sistema e una persona ha detto sì» sono due storie diverse.
  match_reason    public.crm_match_reason not null default 'manual',
  confirmed_by    uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),

  constraint uq_crm_org_document unique (organization_id, document_id)
);

comment on table public.crm_organization_documents is
  'Quali documenti riguardano questa controparte. Il documento non viene '
  'copiato e la sua analisi non viene toccata (§4 del modulo).';

-- §33 e §73 — l'aggancio si fa sul MESSAGGIO, non sul thread: `provider_thread_id`
-- è un identificativo opaco del provider e non tutte le caselle lo valorizzano.
-- La timeline raggruppa per thread in LETTURA («Conversazione email — 4
-- messaggi»), che è il posto giusto per un raggruppamento: se lo si scrivesse
-- nel dato, collegare un thread collegherebbe anche i messaggi futuri che
-- nessuno ha ancora letto.
create table if not exists public.crm_organization_emails (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  organization_id  uuid not null references public.crm_organizations(id) on delete cascade,
  email_message_id uuid not null references public.email_messages(id) on delete cascade,

  match_reason     public.crm_match_reason not null default 'manual',
  confirmed_by     uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),

  constraint uq_crm_org_email unique (organization_id, email_message_id)
);

comment on table public.crm_organization_emails is
  'Quali comunicazioni riguardano questa controparte. Il corpo della email non '
  'viene mai copiato qui (§61): la timeline mostra oggetto, mittente e data '
  'leggendoli da email_messages.';

-- §33 — la stessa email può essere collegata sia all'organizzazione sia alla
-- persona che l'ha scritta. Due tabelle e non una con due colonne nullable: un
-- vincolo unico su una coppia con un NULL non impedisce i doppioni, perché due
-- NULL non sono uguali fra loro.
create table if not exists public.crm_contact_emails (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references public.companies(id) on delete cascade,
  contact_id       uuid not null references public.crm_contacts(id) on delete cascade,
  email_message_id uuid not null references public.email_messages(id) on delete cascade,

  match_reason     public.crm_match_reason not null default 'manual',
  confirmed_by     uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),

  constraint uq_crm_contact_email unique (contact_id, email_message_id)
);

-- §89 — il capitolato, la richiesta d'offerta, la proposta. Un collegamento,
-- non un generatore di offerte: quello non esiste e non è in programma.
create table if not exists public.crm_opportunity_documents (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  document_id    uuid not null references public.documents(id) on delete cascade,

  added_by       uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),

  constraint uq_crm_opportunity_document unique (opportunity_id, document_id)
);


-- ---------------------------------------------------------------------------
-- 13. crm_link_suggestions — CIÒ CHE IL SISTEMA SOSPETTA
--
-- §20 e §21, ed è la tabella che decide se questo CRM sarà usabile.
--
-- Il numero che giustifica questa tabella, misurato sul database vero il
-- 2026-07-29: 117 email, 54 mittenti distinti, 44 domini. Creando
-- un'organizzazione per mittente si otterrebbero 44 anagrafiche fatte in
-- maggioranza di stripe.com, amazon.it, mail.adobe.com, newsletter e noreply.
-- Con il filtro del §20 (non massiva, rilevanza azionabile, mittente non di
-- servizio) i 54 mittenti scendono a 6 — e fra quei 6 restano amazon.it e
-- info.interdiscount.ch. Cioè: NEMMENO IL FILTRO MIGLIORE AUTORIZZA UN'
-- ANAGRAFICA AUTOMATICA. Perciò quelle righe finiscono qui, in attesa di un sì.
--
-- ⚠️ `suggested_name` e `suggested_email` sono una COPIA, e sono l'unica di
-- tutto il file. È voluto: un suggerimento deve poter essere mostrato anche se
-- l'entità d'origine nel frattempo è stata archiviata, e deve poter essere
-- rifiutato senza lasciare tracce dell'entità. È una copia con una scadenza,
-- non una seconda anagrafica.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_link_suggestions (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,

  source_entity_type public.crm_linked_entity not null,
  source_entity_id   uuid not null,

  -- Se il suggerimento è «questa email è di un'organizzazione che conosci già»,
  -- qui c'è quale. Se è «questa sembra una controparte nuova», resta null e
  -- valgono suggested_name / suggested_email.
  suggested_organization_id uuid references public.crm_organizations(id) on delete cascade,
  suggested_contact_id      uuid references public.crm_contacts(id) on delete cascade,

  suggested_name  text,
  suggested_email text,

  reason          public.crm_match_reason not null,
  -- Il perché in chiaro, per la schermata: non un punteggio, una FRASE
  -- verificabile («il dominio del mittente coincide con il sito»). §153 — la
  -- preferenza è per il deterministico, e un numero fra 0 e 1 qui non
  -- misurerebbe niente.
  reason_detail   text,

  status          public.crm_link_status not null default 'pending',
  resolved_at     timestamptz,
  resolved_by     uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),

  -- Idempotenza: la stessa proposta non si ripresenta a ogni passaggio del
  -- worker. È la chiave che rende ripetibile il candidato del §171.
  dedupe_key      text not null,

  constraint uq_crm_suggestion_dedupe unique (company_id, dedupe_key),
  constraint crm_suggestion_resolved_stamp
    check ((status = 'pending') = (resolved_at is null)),
  constraint crm_suggestion_has_target
    check (suggested_organization_id is not null
           or suggested_contact_id is not null
           or nullif(btrim(coalesce(suggested_name, '')), '') is not null)
);

comment on table public.crm_link_suggestions is
  'Ciò che il sistema sospetta e che una persona deve confermare (§21). '
  'Nessuna organizzazione nasce da qui senza un gesto umano.';


-- ---------------------------------------------------------------------------
-- 14. LE COLONNE DI COLLEGAMENTO SUI MODULI ESISTENTI
--
-- §35, §36, §37. Tre colonne facoltative, annullabili, che NON sostituiscono
-- nulla. §169 — i record esistenti continuano a funzionare senza: un contratto
-- con `counterparty_organization_id = null` è valido e resta valido.
--
-- ⚠️⚠️ LA DIFESA DI QUESTE TRE COLONNE NON PUÒ ESSERE UN GRANT.
-- Su `public.tasks` i grant sono di TABELLA dalla 0004 (`grant select, insert,
-- update, delete … to authenticated`) e nessuna migrazione li ha mai revocati:
-- un `grant (colonna)` scritto oggi AGGIUNGE privilegi, non ne toglie. È la
-- lezione misurata della 0013/0014. L'unica difesa possibile è un TRIGGER, ed è
-- quello che la sezione 16 fa — per tutte e tre, anche dove i grant di colonna
-- funzionerebbero, perché una difesa che vale in un posto solo si dimentica.
-- ---------------------------------------------------------------------------

-- §35 e §81 — un'attività riguarda normalmente UNA controparte principale,
-- quindi una chiave esterna e non una tabella di relazione. La verifica:
-- `list_tasks` elenca le proprie colonne una per una, quindi una colonna nuova
-- non la rompe — è già successo due volte senza toccarla (tasks.workflow_run_id
-- nella 0020, tasks.contract_id nella 0024).
alter table public.tasks
  add column if not exists crm_organization_id uuid references public.crm_organizations(id) on delete set null;
alter table public.tasks
  add column if not exists crm_opportunity_id uuid references public.crm_opportunities(id) on delete set null;

comment on column public.tasks.crm_organization_id is
  'La controparte a cui questa attività si riferisce. Facoltativa: '
  'un''attività interna non ne ha una. Difesa da trg_tasks_crm_guard, non da un '
  'grant — su tasks i grant sono di tabella dalla 0004.';

-- §36 — ACCANTO a counterparty_name, non al suo posto.
-- `contracts.counterparty_name` resta l'etichetta scrivibile a mano,
-- `contract_extractions.counterparty` resta il nome LETTO e immutabile, e
-- `list_contracts` continua a restituire `coalesce(t_counterparty,
-- counterparty_name)`: i termini verificati continuano a vincere. Il CRM
-- aggiunge un riferimento, non cambia ciò che la schermata mostra.
alter table public.contracts
  add column if not exists counterparty_organization_id uuid references public.crm_organizations(id) on delete set null;

comment on column public.contracts.counterparty_organization_id is
  'Collegamento facoltativo alla controparte nel CRM. NON sostituisce '
  'counterparty_name né il nome estratto: scollegare non cancella nulla (§26).';

-- §37 — il fornitore letto sulla fattura resta `eff_supplier_name`.
-- Qui c'è solo «e quel fornitore è questa organizzazione».
alter table public.finance_items
  add column if not exists supplier_organization_id uuid references public.crm_organizations(id) on delete set null;
-- La coppia timbrata dal database, sul modello già presente in questa stessa
-- tabella (`expense_category_set_by` / `expense_category_set_at`): chi ha
-- deciso che quel fornitore è quell'organizzazione, e quando.
alter table public.finance_items
  add column if not exists supplier_organization_set_by uuid references auth.users(id) on delete set null;
alter table public.finance_items
  add column if not exists supplier_organization_set_at timestamptz;

comment on column public.finance_items.supplier_organization_id is
  'Collegamento facoltativo del fornitore al CRM. eff_supplier_name e '
  'finance_extractions.supplier_name restano intatti: il CRM aggiunge '
  'un''identità, non riscrive un fatto (§27).';


-- ---------------------------------------------------------------------------
-- 15. GLI INDICI
--
-- Ognuno serve un'interrogazione che questo modulo fa davvero. §111 chiede di
-- controllare quelli esistenti e di non duplicarli: l'unico indice che manca
-- fuori dal CRM è quello su `email_messages (company_id, sender_email)`, che
-- oggi non esiste — `isKnownAdministrativeSender` fa già quella ricerca senza.
-- ---------------------------------------------------------------------------

-- La lista: per azienda, non archiviate, in ordine di nome.
create index if not exists idx_crm_org_company_name
  on public.crm_organizations (company_id, display_name)
  where archived_at is null;

create index if not exists idx_crm_org_company_updated
  on public.crm_organizations (company_id, updated_at desc);

-- §69 — «nessun contatto da 30 giorni». `nulls first` perché un'organizzazione
-- mai contattata viene PRIMA di una contattata sei mesi fa: è il caso più
-- urgente, non il meno.
create index if not exists idx_crm_org_last_contact
  on public.crm_organizations (company_id, last_contact_at nulls first)
  where archived_at is null;

create index if not exists idx_crm_org_owner
  on public.crm_organizations (company_id, account_owner_user_id)
  where archived_at is null and account_owner_user_id is not null;

-- ⚠️ §29 — L'IDI È UN'IDENTITÀ, e due righe con lo stesso IDI nella stessa
-- azienda sono sempre un duplicato. Su `public.companies` questo vincolo NON
-- esiste e la duplicazione è possibile: il CRM non ripete quella lacuna.
-- L'indice è sulla forma NORMALIZZATA e verificata, quindi «CHE-107.721.785» e
-- «CHE107721785» collidono come devono, mentre un IDI con la cifra di
-- controllo sbagliata (uid_norm = null) non blocca niente — non identifica
-- nessuno, quindi non può impedire un inserimento.
create unique index if not exists uq_crm_org_uid
  on public.crm_organizations (company_id, uid_norm)
  where uid_norm is not null;

-- §23 — il sospetto per dominio, e il §29 per i duplicati.
create index if not exists idx_crm_org_domain
  on public.crm_organizations (company_id, website_domain)
  where website_domain is not null;

-- §103 — la ricerca. Trigram sull'espressione che la funzione di lista
-- interroga davvero: è la trappola annotata su `idx_tasks_search`, dove
-- l'indice è su un'espressione e il filtro su tre colonne separate, e quindi
-- l'indice non serve la ricerca che dice di servire.
create index if not exists idx_crm_org_text_trgm
  on public.crm_organizations
  using gin ((coalesce(display_name, '') || ' ' || coalesce(legal_name, '') || ' ' || coalesce(city, '')) gin_trgm_ops);

create index if not exists idx_crm_org_roles_role
  on public.crm_organization_roles (company_id, role);
create index if not exists idx_crm_org_roles_org
  on public.crm_organization_roles (organization_id);

create index if not exists idx_crm_contacts_company_name
  on public.crm_contacts (company_id, display_name)
  where archived_at is null;
create index if not exists idx_crm_contacts_text_trgm
  on public.crm_contacts
  using gin ((coalesce(display_name, '') || ' ' || coalesce(first_name, '') || ' ' || coalesce(last_name, '')) gin_trgm_ops);

-- §22 — la chiave del match esatto: dato un `sender_email`, chi è.
create index if not exists idx_crm_methods_normalized
  on public.crm_contact_methods (company_id, normalized_value)
  where normalized_value is not null;
create index if not exists idx_crm_methods_contact
  on public.crm_contact_methods (contact_id) where contact_id is not null;
create index if not exists idx_crm_methods_org
  on public.crm_contact_methods (organization_id) where organization_id is not null;

-- §127 — un indirizzo email appartiene a UN solo soggetto dentro l'azienda.
-- Se `info@rossi.ch` è già dell'organizzazione, non può diventare anche di una
-- persona: è la regola che spinge a metterlo dove sta davvero, invece di
-- duplicarlo. Il rifiuto è un 23505, che `toUserMessage` traduce già.
create unique index if not exists uq_crm_method_email
  on public.crm_contact_methods (company_id, normalized_value)
  where type = 'email' and normalized_value is not null;

create index if not exists idx_crm_contact_orgs_org
  on public.crm_contact_organizations (organization_id)
  where active_until is null;
create index if not exists idx_crm_contact_orgs_contact
  on public.crm_contact_organizations (contact_id);

-- §17 — un solo rapporto PRINCIPALE attivo per persona. Il vincolo è parziale
-- perché un rapporto concluso può benissimo essere stato il principale a suo
-- tempo, e riscrivere quel flag sarebbe riscrivere la storia.
create unique index if not exists uq_crm_contact_primary_org
  on public.crm_contact_organizations (contact_id)
  where is_primary and active_until is null;

create index if not exists idx_crm_opp_company_stage
  on public.crm_opportunities (company_id, stage)
  where archived_at is null;
create index if not exists idx_crm_opp_org
  on public.crm_opportunities (organization_id)
  where archived_at is null;
create index if not exists idx_crm_opp_owner
  on public.crm_opportunities (company_id, owner_user_id)
  where archived_at is null;
-- §100 — «follow-up scaduti» e «senza prossimo passo» sono due delle quattro
-- misure della pagina iniziale, e sono interrogazioni, non conteggi in memoria.
create index if not exists idx_crm_opp_next_step_due
  on public.crm_opportunities (company_id, next_step_due_date)
  where archived_at is null and next_step_due_date is not null
        and stage not in ('won', 'lost');

create index if not exists idx_crm_interactions_org
  on public.crm_interactions (organization_id, occurred_at desc);
create index if not exists idx_crm_interactions_contact
  on public.crm_interactions (contact_id, occurred_at desc)
  where contact_id is not null;

-- §109 — la timeline si pagina con `occurred_at desc, id desc`: l'indice porta
-- entrambe le colonne, altrimenti la seconda chiave d'ordine costerebbe un
-- ordinamento in memoria proprio sulla query che deve restare leggera.
create index if not exists idx_crm_events_org
  on public.crm_events (organization_id, occurred_at desc, id desc)
  where organization_id is not null;
create index if not exists idx_crm_events_opp
  on public.crm_events (opportunity_id, occurred_at desc, id desc)
  where opportunity_id is not null;

create index if not exists idx_crm_org_docs_org
  on public.crm_organization_documents (organization_id);
create index if not exists idx_crm_org_docs_doc
  on public.crm_organization_documents (document_id);
create index if not exists idx_crm_org_emails_org
  on public.crm_organization_emails (organization_id);
create index if not exists idx_crm_org_emails_msg
  on public.crm_organization_emails (email_message_id);
create index if not exists idx_crm_contact_emails_contact
  on public.crm_contact_emails (contact_id);
create index if not exists idx_crm_opp_docs_opp
  on public.crm_opportunity_documents (opportunity_id);

create index if not exists idx_crm_suggestions_pending
  on public.crm_link_suggestions (company_id, created_at desc)
  where status = 'pending';
create index if not exists idx_crm_suggestions_source
  on public.crm_link_suggestions (company_id, source_entity_type, source_entity_id);

-- I collegamenti sui moduli esistenti: parziali, perché la stragrande
-- maggioranza delle righe non li userà mai.
create index if not exists idx_tasks_crm_org
  on public.tasks (crm_organization_id) where crm_organization_id is not null;
create index if not exists idx_tasks_crm_opp
  on public.tasks (crm_opportunity_id) where crm_opportunity_id is not null;
create index if not exists idx_contracts_crm_org
  on public.contracts (counterparty_organization_id) where counterparty_organization_id is not null;
create index if not exists idx_finance_items_crm_org
  on public.finance_items (company_id, supplier_organization_id) where supplier_organization_id is not null;

-- §22 — l'indice che MANCAVA fuori dal CRM. `isKnownAdministrativeSender`
-- (_shared/email/store.ts) fa già `eq(company_id) + eq(sender_email)` senza
-- indice dedicato; il CRM aggiunge un secondo chiamante su una tabella che oggi
-- ha 117 righe ma che cresce a ogni sincronizzazione.
create index if not exists idx_email_msg_sender
  on public.email_messages (company_id, sender_email)
  where sender_email is not null;


-- ---------------------------------------------------------------------------
-- 16. I GUARDIANI
--
-- §39, §86, §115, §174, §176, §177. Qui vive tutto ciò che il browser non deve
-- poter decidere: chi è l'autore, a quale azienda appartiene ciò che si
-- collega, quando si scrivono i timbri.
--
-- ⚠️ PERCHÉ NON BASTA LA RLS, e vale per ognuna delle funzioni che seguono.
-- La RLS impedisce di scrivere una riga che DICHIARA un'azienda altrui. Non
-- impedisce di dichiarare la PROPRIA azienda e agganciare l'entità di un'altra:
-- quel caso passa la policy e va fermato qui. È la disciplina imparata con la
-- 0017, dove una policy scritta altrove non bastava a proteggere un trigger che
-- la scavalca — e queste funzioni sono `security definer`, quindi devono
-- difendersi da sole.
--
-- ⚠️ IL SENTINELLA `ai_swisse.crm_internal`.
-- Due colonne — `last_contact_at` e `merged_into_id` — non appartengono a
-- nessuno se non al database: la prima la calcola `crm_refresh_last_contact`, la
-- seconda la scrive `crm_merge_organizations`. Il guardiano le ripristina da
-- `old` SEMPRE, tranne quando quel parametro di sessione è acceso. Così restano
-- inattaccabili anche se un giorno qualcuno aggiungesse un grant per sbaglio:
-- la difesa non dipende dai permessi. È la forma di `ai_swisse.contract_review`
-- della 0024, che il suo autore chiama «il difetto peggiore di quel modulo,
-- evitato per un soffio».
-- ---------------------------------------------------------------------------

create or replace function public.crm_organizations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_merge_company uuid;
begin
  -- §11 e §176 — il responsabile della relazione deve essere della stessa
  -- azienda. Non è una formalità: l'elenco «i miei clienti» si costruisce su
  -- questa colonna, e un id estraneo produrrebbe una riga che non appartiene a
  -- nessuno e che nessuno vede.
  if new.account_owner_user_id is not null
     and (tg_op = 'INSERT' or new.account_owner_user_id is distinct from old.account_owner_user_id) then
    if not exists (select 1 from public.company_members m
                    where m.company_id = new.company_id
                      and m.user_id = new.account_owner_user_id) then
      raise exception 'crm_owner_not_member'
        using errcode = '23514',
              hint = 'Il responsabile deve essere un membro di questa azienda.';
    end if;
  end if;

  -- Le forme canoniche le calcola il database, sempre, da ciò che è stato
  -- scritto. Se le calcolasse il client, un dominio dichiarato diverso dal sito
  -- renderebbe il suggerimento del §23 una bugia con l'aria di un calcolo.
  new.uid_norm       := public.crm_norm_uid(new.uid_che);
  new.website_domain := public.crm_norm_domain(new.website);
  new.canton         := nullif(upper(btrim(coalesce(new.canton, ''))), '');
  new.country_code   := nullif(upper(btrim(coalesce(new.country_code, ''))), '');
  new.display_name   := btrim(new.display_name);
  new.legal_name     := nullif(btrim(coalesce(new.legal_name, '')), '');

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.last_contact_at := null;   -- non esiste un contatto prima della riga
    new.merged_into_id  := null;
    new.archived_by := null;
    if new.archived_at is not null then new.archived_at := now(); end if;
    -- §19 e §96 — la provenienza la dichiara chi inserisce, ma dal browser si
    -- possono dichiarare solo le provenienze che un browser può davvero avere:
    -- l'ha scritta una persona, l'ha importata dal registro, è arrivata da un
    -- file. «Nata da una email» o «da una fattura» le può affermare solo il
    -- codice server-side, che quelle cose le ha davvero viste — altrimenti una
    -- riga scritta a mano potrebbe presentarsi come dedotta da un documento.
    if auth.uid() is not null and pg_trigger_depth() <= 1
       and new.source not in ('manual', 'registry', 'import') then
      new.source := 'manual';
    end if;
    return new;
  end if;

  -- UPDATE — ciò che non cambia mai.
  new.company_id := old.company_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.source     := old.source;   -- da dove è arrivata è un fatto, non un'opinione
  new.updated_at := now();

  -- §124 — archiviare e ripristinare, con il timbro scritto dal database.
  if new.archived_at is not null and old.archived_at is null then
    new.archived_at := now();
    new.archived_by := auth.uid();
  elsif new.archived_at is null then
    new.archived_by := null;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  -- Le due colonne del database. Vedi il sentinella in testa alla sezione.
  if coalesce(current_setting('ai_swisse.crm_internal', true), '') <> 'on' then
    new.last_contact_at := old.last_contact_at;
    new.merged_into_id  := old.merged_into_id;
  end if;

  if new.merged_into_id is not null then
    if new.merged_into_id = new.id then
      raise exception 'crm_merge_into_self'
        using errcode = '23514', hint = 'Un''organizzazione non si fonde con sé stessa.';
    end if;
    select o.company_id into v_merge_company
      from public.crm_organizations o where o.id = new.merged_into_id;
    if v_merge_company is null or v_merge_company is distinct from new.company_id then
      raise exception 'crm_merge_company_mismatch'
        using errcode = '23514',
              hint = 'Le due organizzazioni devono appartenere alla stessa azienda.';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_crm_organizations_guard on public.crm_organizations;
create trigger trg_crm_organizations_guard
  before insert or update on public.crm_organizations
  for each row execute function public.crm_organizations_guard();


-- Il ruolo appartiene all'organizzazione, e l'organizzazione all'azienda: tre
-- valori che devono coincidere, non due.
create or replace function public.crm_org_child_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_company uuid;
begin
  select o.company_id into v_org_company
    from public.crm_organizations o where o.id = new.organization_id;
  if v_org_company is null or v_org_company is distinct from new.company_id then
    raise exception 'crm_organization_company_mismatch'
      using errcode = '23514',
            hint = 'L''organizzazione deve appartenere alla stessa azienda.';
  end if;
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_org_roles_guard on public.crm_organization_roles;
create trigger trg_crm_org_roles_guard
  before insert or update on public.crm_organization_roles
  for each row execute function public.crm_org_child_guard();


create or replace function public.crm_contacts_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.display_name := btrim(new.display_name);
  new.first_name := nullif(btrim(coalesce(new.first_name, '')), '');
  new.last_name  := nullif(btrim(coalesce(new.last_name, '')), '');

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.archived_by := null;
    if new.archived_at is not null then new.archived_at := now(); end if;
    return new;
  end if;

  new.company_id := old.company_id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();

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

drop trigger if exists trg_crm_contacts_guard on public.crm_contacts;
create trigger trg_crm_contacts_guard
  before insert or update on public.crm_contacts
  for each row execute function public.crm_contacts_guard();


-- §14 e §15. Il recapito appartiene a una persona OPPURE a un'organizzazione, e
-- quel soggetto deve essere della stessa azienda. `normalized_value` la scrive
-- il database: è la chiave con cui si riconosce un mittente, e permettere di
-- scriverla significherebbe permettere di dichiarare che un indirizzo è un altro.
create or replace function public.crm_contact_methods_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner_company uuid;
begin
  if new.contact_id is not null then
    select c.company_id into v_owner_company
      from public.crm_contacts c where c.id = new.contact_id;
  else
    select o.company_id into v_owner_company
      from public.crm_organizations o where o.id = new.organization_id;
  end if;

  if v_owner_company is null or v_owner_company is distinct from new.company_id then
    raise exception 'crm_method_company_mismatch'
      using errcode = '23514',
            hint = 'Il recapito e il suo intestatario devono appartenere alla stessa azienda.';
  end if;

  new.value := btrim(new.value);
  new.normalized_value := case new.type
    when 'email' then public.crm_norm_email(new.value)
    when 'phone' then public.crm_norm_phone(new.value)
    when 'mobile' then public.crm_norm_phone(new.value)
    when 'website' then public.crm_norm_domain(new.value)
    else public.crm_norm_email(new.value)
  end;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.company_id := old.company_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    -- L'intestatario di un recapito non cambia con un update… tranne durante
    -- una fusione, che è l'unico gesto legittimo che sposta le righe da
    -- un'organizzazione a un'altra. Vedi il sentinella della sezione 16.
    if coalesce(current_setting('ai_swisse.crm_internal', true), '') <> 'on' then
      new.contact_id := old.contact_id;
      new.organization_id := old.organization_id;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_crm_contact_methods_guard on public.crm_contact_methods;
create trigger trg_crm_contact_methods_guard
  before insert or update on public.crm_contact_methods
  for each row execute function public.crm_contact_methods_guard();


-- Un solo recapito principale per tipo e per intestatario. Si toglie il flag
-- agli altri invece di rifiutare: chi dice «questo è il principale» sta
-- affermando qualcosa di completo, non chiedendo un permesso.
create or replace function public.crm_contact_methods_primary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not new.is_primary then return new; end if;

  update public.crm_contact_methods m
     set is_primary = false
   where m.id <> new.id
     and m.type = new.type
     and m.is_primary
     and ((new.contact_id is not null and m.contact_id = new.contact_id)
       or (new.organization_id is not null and m.organization_id = new.organization_id));

  return new;
end $$;

drop trigger if exists trg_crm_contact_methods_primary on public.crm_contact_methods;
create trigger trg_crm_contact_methods_primary
  after insert or update of is_primary on public.crm_contact_methods
  for each row execute function public.crm_contact_methods_primary();


-- §17 — la persona e l'organizzazione, entrambe della stessa azienda.
create or replace function public.crm_contact_organizations_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_company uuid;
  v_org_company     uuid;
begin
  select c.company_id into v_contact_company
    from public.crm_contacts c where c.id = new.contact_id;
  select o.company_id into v_org_company
    from public.crm_organizations o where o.id = new.organization_id;

  if v_contact_company is null or v_org_company is null
     or v_contact_company is distinct from new.company_id
     or v_org_company is distinct from new.company_id then
    raise exception 'crm_contact_org_company_mismatch'
      using errcode = '23514',
            hint = 'La persona e l''organizzazione devono appartenere alla stessa azienda.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
  else
    new.company_id := old.company_id;
    new.contact_id := old.contact_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    if coalesce(current_setting('ai_swisse.crm_internal', true), '') <> 'on' then
      new.organization_id := old.organization_id;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_crm_contact_orgs_guard on public.crm_contact_organizations;
create trigger trg_crm_contact_orgs_guard
  before insert or update on public.crm_contact_organizations
  for each row execute function public.crm_contact_organizations_guard();


-- §48, §175, §177. Il guardiano più denso del file: qui vivono la validazione
-- del responsabile, quella del referente e i due timbri di vittoria e perdita.
create or replace function public.crm_opportunities_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_company     uuid;
  v_contact_company uuid;
  v_contact_linked  boolean;
begin
  select o.company_id into v_org_company
    from public.crm_organizations o where o.id = new.organization_id;
  if v_org_company is null or v_org_company is distinct from new.company_id then
    raise exception 'crm_opportunity_company_mismatch'
      using errcode = '23514',
            hint = 'L''opportunità e l''organizzazione devono appartenere alla stessa azienda.';
  end if;

  -- §48 — il responsabile della trattativa è un membro dell'azienda.
  if new.owner_user_id is not null
     and (tg_op = 'INSERT' or new.owner_user_id is distinct from old.owner_user_id) then
    if not exists (select 1 from public.company_members m
                    where m.company_id = new.company_id and m.user_id = new.owner_user_id) then
      raise exception 'crm_opportunity_owner_not_member'
        using errcode = '23514',
              hint = 'Il responsabile deve essere un membro di questa azienda.';
    end if;
  end if;

  -- §177 — il referente principale deve essere una persona DI QUELLA
  -- organizzazione. È l'errore che si fa scegliendo dalla tendina sbagliata, e
  -- sarebbe invisibile: la scheda mostrerebbe il nome di Laura sotto una
  -- trattativa con un'altra impresa, e nessuno lo noterebbe finché non le si
  -- scrive.
  if new.primary_contact_id is not null
     and (tg_op = 'INSERT' or new.primary_contact_id is distinct from old.primary_contact_id) then
    select c.company_id into v_contact_company
      from public.crm_contacts c where c.id = new.primary_contact_id;
    if v_contact_company is null or v_contact_company is distinct from new.company_id then
      raise exception 'crm_opportunity_contact_company_mismatch'
        using errcode = '23514',
              hint = 'La persona di contatto deve appartenere alla stessa azienda.';
    end if;
    select exists (
      select 1 from public.crm_contact_organizations co
       where co.contact_id = new.primary_contact_id
         and co.organization_id = new.organization_id
    ) into v_contact_linked;
    if not v_contact_linked then
      raise exception 'crm_opportunity_contact_not_in_organization'
        using errcode = '23514',
              hint = 'La persona di contatto non lavora per questa organizzazione.';
    end if;
  end if;

  new.title := btrim(new.title);
  new.value_currency := nullif(upper(btrim(coalesce(new.value_currency, ''))), '');

  -- §175 — i due timbri. La fase la decide una persona; la data la scrive il
  -- database. Riaprire una trattativa vinta azzera il timbro ma NON cancella lo
  -- storico: il passaggio resta scritto in crm_events, che è append-only.
  if new.stage = 'won' then
    if tg_op = 'INSERT' or old.stage is distinct from 'won' then
      new.won_at := now();
    else
      new.won_at := old.won_at;
    end if;
  else
    new.won_at := null;
  end if;

  if new.stage = 'lost' then
    if tg_op = 'INSERT' or old.stage is distinct from 'lost' then
      new.lost_at := now();
    else
      new.lost_at := old.lost_at;
    end if;
  else
    new.lost_at := null;
    -- §43 — il motivo appartiene alla perdita. Riaprendo, resta senza oggetto.
    new.lost_reason := null;
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.archived_by := null;
    if new.archived_at is not null then new.archived_at := now(); end if;
    return new;
  end if;

  new.company_id      := old.company_id;
  new.created_by      := old.created_by;
  new.created_at      := old.created_at;
  new.updated_at      := now();
  -- L'organizzazione non cambia con un update… tranne durante una fusione,
  -- che è l'unico gesto legittimo che sposta righe fra due anagrafiche.
  if coalesce(current_setting('ai_swisse.crm_internal', true), '') <> 'on' then
    new.organization_id := old.organization_id;
  end if;

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

drop trigger if exists trg_crm_opportunities_guard on public.crm_opportunities;
create trigger trg_crm_opportunities_guard
  before insert or update on public.crm_opportunities
  for each row execute function public.crm_opportunities_guard();


-- §63 — l'autore di un'interazione è chi scrive, e il database non si fida
-- della firma che arriva dal browser. È la stessa correzione della 0016 sui
-- commenti delle attività, dove il trigger RISCRIVEVA in silenzio l'autore e
-- chi provava a firmare come un collega riceveva «inserito»: qui si RIFIUTA.
create or replace function public.crm_interactions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_company     uuid;
  v_contact_company uuid;
  v_opp_org         uuid;
begin
  select o.company_id into v_org_company
    from public.crm_organizations o where o.id = new.organization_id;
  if v_org_company is null or v_org_company is distinct from new.company_id then
    raise exception 'crm_interaction_company_mismatch'
      using errcode = '23514',
            hint = 'L''interazione e l''organizzazione devono appartenere alla stessa azienda.';
  end if;

  if new.contact_id is not null then
    select c.company_id into v_contact_company
      from public.crm_contacts c where c.id = new.contact_id;
    if v_contact_company is null or v_contact_company is distinct from new.company_id then
      raise exception 'crm_interaction_contact_company_mismatch'
        using errcode = '23514',
              hint = 'La persona deve appartenere alla stessa azienda.';
    end if;
  end if;

  if new.opportunity_id is not null then
    select p.organization_id into v_opp_org
      from public.crm_opportunities p
     where p.id = new.opportunity_id and p.company_id = new.company_id;
    if v_opp_org is null then
      raise exception 'crm_interaction_opportunity_company_mismatch'
        using errcode = '23514',
              hint = 'L''opportunità deve appartenere alla stessa azienda.';
    end if;
    if v_opp_org is distinct from new.organization_id then
      raise exception 'crm_interaction_opportunity_organization_mismatch'
        using errcode = '23514',
              hint = 'L''opportunità appartiene a un''altra organizzazione.';
    end if;
  end if;

  new.subject := nullif(btrim(coalesce(new.subject, '')), '');
  new.notes   := nullif(btrim(coalesce(new.notes, '')), '');

  if tg_op = 'INSERT' then
    if auth.uid() is not null and new.created_by is not null and new.created_by <> auth.uid() then
      raise exception 'crm_interaction_author_mismatch'
        using errcode = '23514',
              hint = 'L''autore di un''interazione è chi la registra.';
    end if;
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  new.company_id      := old.company_id;
  new.created_by      := old.created_by;
  new.created_at      := old.created_at;
  new.updated_at      := now();
  -- L'organizzazione non cambia con un update… tranne durante una fusione,
  -- che è l'unico gesto legittimo che sposta righe fra due anagrafiche.
  if coalesce(current_setting('ai_swisse.crm_internal', true), '') <> 'on' then
    new.organization_id := old.organization_id;
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_interactions_guard on public.crm_interactions;
create trigger trg_crm_interactions_guard
  before insert or update on public.crm_interactions
  for each row execute function public.crm_interactions_guard();


-- ---------------------------------------------------------------------------
-- 16-bis. I GUARDIANI DEI COLLEGAMENTI
--
-- §39 e §115 — la regola che vale per tutti: TRE company_id devono coincidere,
-- quello dichiarato nella riga di collegamento, quello dell'entità CRM e quello
-- dell'entità collegata. Confrontarne due su tre lascia aperto proprio il caso
-- che si vuole chiudere.
-- ---------------------------------------------------------------------------

create or replace function public.crm_org_document_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_company uuid;
  v_doc_company uuid;
begin
  select o.company_id into v_org_company from public.crm_organizations o where o.id = new.organization_id;
  select d.company_id into v_doc_company from public.documents d where d.id = new.document_id;

  if v_org_company is null or v_doc_company is null
     or v_org_company is distinct from v_doc_company
     or v_org_company is distinct from new.company_id then
    raise exception 'crm_document_company_mismatch'
      using errcode = '23514',
            hint = 'Il documento e l''organizzazione devono appartenere alla stessa azienda.';
  end if;

  if tg_op = 'INSERT' then
    new.confirmed_by := auth.uid();
    new.created_at := now();
    -- Dal browser un collegamento è sempre un gesto: solo il codice
    -- server-side può dichiarare un altro motivo.
    if auth.uid() is not null and pg_trigger_depth() <= 1 then
      new.match_reason := 'manual';
    end if;
  else
    new.company_id := old.company_id;
    new.document_id := old.document_id;
    if coalesce(current_setting('ai_swisse.crm_internal', true), '') <> 'on' then
      new.organization_id := old.organization_id;
    end if;
    new.confirmed_by := old.confirmed_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_org_document_guard on public.crm_organization_documents;
create trigger trg_crm_org_document_guard
  before insert or update on public.crm_organization_documents
  for each row execute function public.crm_org_document_guard();


create or replace function public.crm_org_email_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_company uuid;
  v_msg_company uuid;
begin
  select o.company_id into v_org_company from public.crm_organizations o where o.id = new.organization_id;
  select e.company_id into v_msg_company from public.email_messages e where e.id = new.email_message_id;

  if v_org_company is null or v_msg_company is null
     or v_org_company is distinct from v_msg_company
     or v_org_company is distinct from new.company_id then
    raise exception 'crm_email_company_mismatch'
      using errcode = '23514',
            hint = 'La comunicazione e l''organizzazione devono appartenere alla stessa azienda.';
  end if;

  if tg_op = 'INSERT' then
    new.confirmed_by := auth.uid();
    new.created_at := now();
    if auth.uid() is not null and pg_trigger_depth() <= 1 then
      new.match_reason := 'manual';
    end if;
  else
    new.company_id := old.company_id;
    new.email_message_id := old.email_message_id;
    if coalesce(current_setting('ai_swisse.crm_internal', true), '') <> 'on' then
      new.organization_id := old.organization_id;
    end if;
    new.confirmed_by := old.confirmed_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_org_email_guard on public.crm_organization_emails;
create trigger trg_crm_org_email_guard
  before insert or update on public.crm_organization_emails
  for each row execute function public.crm_org_email_guard();


create or replace function public.crm_contact_email_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_contact_company uuid;
  v_msg_company     uuid;
begin
  select c.company_id into v_contact_company from public.crm_contacts c where c.id = new.contact_id;
  select e.company_id into v_msg_company from public.email_messages e where e.id = new.email_message_id;

  if v_contact_company is null or v_msg_company is null
     or v_contact_company is distinct from v_msg_company
     or v_contact_company is distinct from new.company_id then
    raise exception 'crm_email_company_mismatch'
      using errcode = '23514',
            hint = 'La comunicazione e la persona devono appartenere alla stessa azienda.';
  end if;

  if tg_op = 'INSERT' then
    new.confirmed_by := auth.uid();
    new.created_at := now();
    if auth.uid() is not null and pg_trigger_depth() <= 1 then
      new.match_reason := 'manual';
    end if;
  else
    new.company_id := old.company_id;
    new.contact_id := old.contact_id;
    new.email_message_id := old.email_message_id;
    new.confirmed_by := old.confirmed_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_contact_email_guard on public.crm_contact_emails;
create trigger trg_crm_contact_email_guard
  before insert or update on public.crm_contact_emails
  for each row execute function public.crm_contact_email_guard();


create or replace function public.crm_opportunity_document_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opp_company uuid;
  v_doc_company uuid;
begin
  select p.company_id into v_opp_company from public.crm_opportunities p where p.id = new.opportunity_id;
  select d.company_id into v_doc_company from public.documents d where d.id = new.document_id;

  if v_opp_company is null or v_doc_company is null
     or v_opp_company is distinct from v_doc_company
     or v_opp_company is distinct from new.company_id then
    raise exception 'crm_opportunity_document_company_mismatch'
      using errcode = '23514',
            hint = 'Il documento e l''opportunità devono appartenere alla stessa azienda.';
  end if;

  if tg_op = 'INSERT' then
    new.added_by := auth.uid();
    new.created_at := now();
  else
    new.company_id := old.company_id;
    new.opportunity_id := old.opportunity_id;
    new.document_id := old.document_id;
    new.added_by := old.added_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_opportunity_document_guard on public.crm_opportunity_documents;
create trigger trg_crm_opportunity_document_guard
  before insert or update on public.crm_opportunity_documents
  for each row execute function public.crm_opportunity_document_guard();


-- §21 — un suggerimento si risolve, e chi lo risolve resta scritto. Il
-- suggerimento in sé non è scrivibile dal client se non nel suo stato: il
-- contenuto lo produce il codice server-side.
create or replace function public.crm_link_suggestions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.status := coalesce(new.status, 'pending');
    if new.status = 'pending' then
      new.resolved_at := null;
      new.resolved_by := null;
    end if;
    return new;
  end if;

  new.company_id := old.company_id;
  new.source_entity_type := old.source_entity_type;
  new.source_entity_id := old.source_entity_id;
  new.suggested_organization_id := old.suggested_organization_id;
  new.suggested_contact_id := old.suggested_contact_id;
  new.suggested_name := old.suggested_name;
  new.suggested_email := old.suggested_email;
  new.reason := old.reason;
  new.reason_detail := old.reason_detail;
  new.dedupe_key := old.dedupe_key;
  new.created_at := old.created_at;

  if new.status is distinct from old.status then
    if new.status = 'pending' then
      new.resolved_at := null;
      new.resolved_by := null;
    else
      new.resolved_at := now();
      new.resolved_by := auth.uid();
    end if;
  else
    new.resolved_at := old.resolved_at;
    new.resolved_by := old.resolved_by;
  end if;

  return new;
end $$;

drop trigger if exists trg_crm_link_suggestions_guard on public.crm_link_suggestions;
create trigger trg_crm_link_suggestions_guard
  before insert or update on public.crm_link_suggestions
  for each row execute function public.crm_link_suggestions_guard();


-- ---------------------------------------------------------------------------
-- 16-ter. I GUARDIANI SULLE TABELLE DEGLI ALTRI MODULI
--
-- ⚠️ Trigger NUOVI e SEPARATI, non modifiche a `tasks_contract_guard`,
-- `contracts_guard` e `finance_items_guard`. Riscrivere una funzione esistente
-- per aggiungerci tre righe significa riprodurne a memoria duecento, e questo
-- repository ha già pagato una sostituzione automatica finita dentro un
-- `import`: il typecheck era verde e il deploy è fallito. Un trigger accanto è
-- additivo, si legge da solo e non può rompere ciò che non tocca.
--
-- ⚠️ Su `public.tasks` questa è l'UNICA difesa possibile: i grant sono di
-- tabella dalla 0004 e un grant di colonna non restringerebbe nulla.
-- ---------------------------------------------------------------------------

create or replace function public.tasks_crm_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_company uuid;
  v_opp_company uuid;
  v_opp_org     uuid;
begin
  if new.crm_organization_id is not null then
    select o.company_id into v_org_company
      from public.crm_organizations o where o.id = new.crm_organization_id;
    if v_org_company is null or v_org_company is distinct from new.company_id then
      raise exception 'task_crm_company_mismatch'
        using errcode = '23514',
              hint = 'L''attività e la controparte devono appartenere alla stessa azienda.';
    end if;
  end if;

  if new.crm_opportunity_id is not null then
    select p.company_id, p.organization_id into v_opp_company, v_opp_org
      from public.crm_opportunities p where p.id = new.crm_opportunity_id;
    if v_opp_company is null or v_opp_company is distinct from new.company_id then
      raise exception 'task_crm_opportunity_company_mismatch'
        using errcode = '23514',
              hint = 'L''attività e l''opportunità devono appartenere alla stessa azienda.';
    end if;
    -- Un'opportunità appartiene a un'organizzazione: agganciare l'attività a
    -- una trattativa e a una controparte diverse produrrebbe una riga che dice
    -- due cose incompatibili. Stessa forma di `task_milestone_contract_mismatch`.
    if new.crm_organization_id is not null and new.crm_organization_id is distinct from v_opp_org then
      raise exception 'task_crm_opportunity_organization_mismatch'
        using errcode = '23514',
              hint = 'L''opportunità indicata appartiene a un''altra controparte.';
    end if;
    if new.crm_organization_id is null then
      new.crm_organization_id := v_opp_org;
    end if;
  end if;

  return new;
end $$;

drop trigger if exists trg_tasks_crm_guard on public.tasks;
create trigger trg_tasks_crm_guard
  before insert or update of crm_organization_id, crm_opportunity_id, company_id on public.tasks
  for each row execute function public.tasks_crm_guard();


create or replace function public.contracts_crm_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_company uuid;
begin
  if new.counterparty_organization_id is not null then
    select o.company_id into v_org_company
      from public.crm_organizations o where o.id = new.counterparty_organization_id;
    if v_org_company is null or v_org_company is distinct from new.company_id then
      raise exception 'contract_crm_company_mismatch'
        using errcode = '23514',
              hint = 'Il contratto e la controparte devono appartenere alla stessa azienda.';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_contracts_crm_guard on public.contracts;
create trigger trg_contracts_crm_guard
  before insert or update of counterparty_organization_id, company_id on public.contracts
  for each row execute function public.contracts_crm_guard();


-- §37 — oltre al controllo, i due timbri: chi ha collegato il fornitore e
-- quando. Sono la copia esatta della coppia `expense_category_set_by/_at` che
-- questa stessa tabella ha già, e sono scritti dal database perché una
-- decisione umana registrata dal browser non è una decisione registrata.
create or replace function public.finance_items_crm_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_org_company uuid;
begin
  if new.supplier_organization_id is not null then
    select o.company_id into v_org_company
      from public.crm_organizations o where o.id = new.supplier_organization_id;
    if v_org_company is null or v_org_company is distinct from new.company_id then
      raise exception 'finance_crm_company_mismatch'
        using errcode = '23514',
              hint = 'La fattura e il fornitore devono appartenere alla stessa azienda.';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.supplier_organization_id is not null then
      new.supplier_organization_set_by := auth.uid();
      new.supplier_organization_set_at := now();
    else
      new.supplier_organization_set_by := null;
      new.supplier_organization_set_at := null;
    end if;
    return new;
  end if;

  if new.supplier_organization_id is distinct from old.supplier_organization_id then
    if new.supplier_organization_id is null then
      new.supplier_organization_set_by := null;
      new.supplier_organization_set_at := null;
    else
      new.supplier_organization_set_by := auth.uid();
      new.supplier_organization_set_at := now();
    end if;
  else
    new.supplier_organization_set_by := old.supplier_organization_set_by;
    new.supplier_organization_set_at := old.supplier_organization_set_at;
  end if;

  return new;
end $$;

drop trigger if exists trg_finance_items_crm_guard on public.finance_items;
create trigger trg_finance_items_crm_guard
  before insert or update of supplier_organization_id, company_id on public.finance_items
  for each row execute function public.finance_items_crm_guard();


-- ---------------------------------------------------------------------------
-- 17. «DA QUANTO TEMPO NON LI SENTIAMO»
--
-- §67. `last_contact_at` è una COPIA DENORMALIZZATA DICHIARATA, sul modello di
-- `email_messages.analysis_deadline`: la verità sono le email collegate e le
-- interazioni, e questa colonna è il massimo delle loro date.
--
-- ⚠️ §67 vieta un campo manuale opaco, e la ragione è concreta: un «ultimo
-- contatto» scritto a mano finirebbe per dire 12 marzo mentre la timeline
-- appena sotto mostra una email del 3 aprile. Due numeri che si contraddicono
-- nella stessa schermata non sono un dettaglio: sono la fine della fiducia in
-- entrambi.
--
-- ⚠️ §69 — la SOGLIA di inattività non è qui. Questa colonna registra un fatto
-- («l'ultimo contatto è del…»); decidere che trenta giorni sono troppi è un
-- giudizio, e vive nel filtro della schermata e nelle regole di automazione,
-- dove una persona può cambiarlo.
-- ---------------------------------------------------------------------------
create or replace function public.crm_refresh_last_contact(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_last timestamptz;
begin
  select max(d) into v_last from (
    select max(e.received_at) as d
      from public.crm_organization_emails l
      join public.email_messages e on e.id = l.email_message_id
     where l.organization_id = p_organization_id
    union all
    -- §67 — una NOTA non è un contatto: annotare qualcosa su un cliente non
    -- significa avergli parlato. Telefonate e incontri sì.
    select max(i.occurred_at)
      from public.crm_interactions i
     where i.organization_id = p_organization_id
       and i.type in ('call', 'meeting')
  ) s;

  perform set_config('ai_swisse.crm_internal', 'on', true);
  update public.crm_organizations
     set last_contact_at = v_last
   where id = p_organization_id
     and last_contact_at is distinct from v_last;
  perform set_config('ai_swisse.crm_internal', '', true);
end $$;

comment on function public.crm_refresh_last_contact(uuid) is
  'Ricalcola last_contact_at dal massimo fra le email collegate e le '
  'interazioni di tipo call/meeting. Una nota non è un contatto (§67).';

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
  -- assegnata. È la forma che tutte le migrazioni applicate usano.
  if tg_op = 'DELETE' then
    v_org := old.organization_id;
  else
    v_org := new.organization_id;
  end if;

  if v_org is not null then
    perform public.crm_refresh_last_contact(v_org);
  end if;

  -- Un'interazione spostata da un'organizzazione a un'altra le tocca entrambe.
  if tg_op = 'UPDATE' then
    if old.organization_id is not null and old.organization_id is distinct from v_org then
      perform public.crm_refresh_last_contact(old.organization_id);
    end if;
  end if;

  return null;
end $$;

drop trigger if exists trg_crm_org_emails_touch on public.crm_organization_emails;
create trigger trg_crm_org_emails_touch
  after insert or delete on public.crm_organization_emails
  for each row execute function public.crm_touch_last_contact();

drop trigger if exists trg_crm_interactions_touch on public.crm_interactions;
create trigger trg_crm_interactions_touch
  after insert or update or delete on public.crm_interactions
  for each row execute function public.crm_touch_last_contact();


-- ---------------------------------------------------------------------------
-- 18. LO STORICO
--
-- §85, §86, §87. Lo scrivono i trigger. Il client non ha alcun permesso su
-- `crm_events`, quindi non può firmare un'azione a nome di un collega — è la
-- stessa garanzia di `task_events` e `contract_events`, e il §196 la mette
-- alla prova.
--
-- ⚠️ Nel `detail` entrano identificativi e valori di enum. MAI nomi: uno
-- storico che contenesse le ragioni sociali diventerebbe una seconda copia
-- dell'anagrafica — invecchierebbe, e non si potrebbe ripulire quando una
-- persona chiede la cancellazione dei propri dati (§122).
-- ---------------------------------------------------------------------------
create or replace function public.crm_log_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
    values (new.company_id, new.id, 'organization_created',
            jsonb_build_object('source', new.source), auth.uid());
    return null;
  end if;

  if new.account_owner_user_id is distinct from old.account_owner_user_id then
    insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
    values (new.company_id, new.id, 'owner_changed',
            jsonb_build_object('from', old.account_owner_user_id, 'to', new.account_owner_user_id),
            auth.uid());
  end if;

  if new.archived_at is not null and old.archived_at is null then
    insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
    values (new.company_id, new.id, 'archived', '{}'::jsonb, auth.uid());
  elsif new.archived_at is null and old.archived_at is not null then
    insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
    values (new.company_id, new.id, 'restored', '{}'::jsonb, auth.uid());
  end if;

  if new.merged_into_id is not null and old.merged_into_id is null then
    insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
    values (new.company_id, new.id, 'merged',
            jsonb_build_object('into', new.merged_into_id), auth.uid());
  end if;

  -- §85 — «aggiornata» si registra una volta sola per gesto, e solo se qualcosa
  -- che si vede è cambiato. Registrare ogni update produrrebbe uno storico in
  -- cui il fatto importante è sepolto sotto venti righe identiche.
  if (new.display_name, new.legal_name, new.uid_che, new.website, new.city,
      new.canton, new.relationship_status)
     is distinct from
     (old.display_name, old.legal_name, old.uid_che, old.website, old.city,
      old.canton, old.relationship_status) then
    insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
    values (new.company_id, new.id, 'organization_updated', '{}'::jsonb, auth.uid());
  end if;

  return null;
end $$;

drop trigger if exists trg_crm_log_organization on public.crm_organizations;
create trigger trg_crm_log_organization
  after insert or update on public.crm_organizations
  for each row execute function public.crm_log_organization();


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
  insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
  values (old.company_id, old.organization_id, 'role_removed',
          jsonb_build_object('role', old.role), auth.uid());
  return null;
end $$;

drop trigger if exists trg_crm_log_role on public.crm_organization_roles;
create trigger trg_crm_log_role
  after insert or delete on public.crm_organization_roles
  for each row execute function public.crm_log_role();


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
  insert into public.crm_events (company_id, organization_id, contact_id, kind, detail, actor_user_id)
  values (old.company_id, old.organization_id, old.contact_id, 'contact_unlinked',
          '{}'::jsonb, auth.uid());
  return null;
end $$;

drop trigger if exists trg_crm_log_contact_link on public.crm_contact_organizations;
create trigger trg_crm_log_contact_link
  after insert or delete on public.crm_contact_organizations
  for each row execute function public.crm_log_contact_link();


-- §87 — il passaggio di fase conserva DA DOVE e VERSO DOVE, non solo il valore
-- corrente. Senza il «da», la domanda «questa trattativa è tornata indietro?»
-- non ha risposta, ed è una delle poche domande che un responsabile fa davvero.
create or replace function public.crm_log_opportunity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.crm_events (company_id, organization_id, opportunity_id, kind, detail, actor_user_id)
    values (new.company_id, new.organization_id, new.id, 'opportunity_created',
            jsonb_build_object('stage', new.stage), auth.uid());
    return null;
  end if;

  if new.stage is distinct from old.stage then
    insert into public.crm_events (company_id, organization_id, opportunity_id, kind, detail, actor_user_id)
    values (new.company_id, new.organization_id, new.id, 'opportunity_stage_changed',
            jsonb_build_object('from', old.stage, 'to', new.stage), auth.uid());

    if new.stage = 'won' then
      insert into public.crm_events (company_id, organization_id, opportunity_id, kind, detail, actor_user_id)
      values (new.company_id, new.organization_id, new.id, 'opportunity_won', '{}'::jsonb, auth.uid());
    elsif new.stage = 'lost' then
      insert into public.crm_events (company_id, organization_id, opportunity_id, kind, detail, actor_user_id)
      values (new.company_id, new.organization_id, new.id, 'opportunity_lost',
              jsonb_build_object('reason', new.lost_reason), auth.uid());
    end if;
  end if;

  return null;
end $$;

drop trigger if exists trg_crm_log_opportunity on public.crm_opportunities;
create trigger trg_crm_log_opportunity
  after insert or update on public.crm_opportunities
  for each row execute function public.crm_log_opportunity();


create or replace function public.crm_log_interaction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.crm_events (company_id, organization_id, contact_id, opportunity_id,
                                 kind, detail, actor_user_id)
  values (new.company_id, new.organization_id, new.contact_id, new.opportunity_id,
          'interaction_created', jsonb_build_object('type', new.type), new.created_by);
  return null;
end $$;

drop trigger if exists trg_crm_log_interaction on public.crm_interactions;
create trigger trg_crm_log_interaction
  after insert on public.crm_interactions
  for each row execute function public.crm_log_interaction();


-- I collegamenti alle entità degli altri moduli: una sola funzione per tutti,
-- perché la riga di storico è la stessa e cambia solo l'etichetta dell'entità.
-- I collegamenti alle entità degli altri moduli.
-- ⚠️ DUE funzioni e non una parametrizzata: `crm_contact_emails` non ha la
-- colonna `organization_id`, e una funzione sola che la nomini — anche dentro
-- un ramo `case` mai percorso — fallirebbe con «record new has no field
-- organization_id». In plpgsql l'espressione viene preparata per intero, non
-- ramo per ramo: è la stessa ragione per cui i rami `old`/`new` stanno in `if`
-- separati e non in un `case`.
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
  insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
  values (old.company_id, old.organization_id, 'entity_unlinked',
          jsonb_build_object('entity', v_entity), auth.uid());
  return null;
end $$;

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
  insert into public.crm_events (company_id, contact_id, kind, detail, actor_user_id)
  values (old.company_id, old.contact_id, 'entity_unlinked',
          jsonb_build_object('entity', v_entity), auth.uid());
  return null;
end $$;

drop trigger if exists trg_crm_log_document_link on public.crm_organization_documents;
create trigger trg_crm_log_document_link
  after insert or delete on public.crm_organization_documents
  for each row execute function public.crm_log_org_entity_link('document');

drop trigger if exists trg_crm_log_email_link on public.crm_organization_emails;
create trigger trg_crm_log_email_link
  after insert or delete on public.crm_organization_emails
  for each row execute function public.crm_log_org_entity_link('email_message');

drop trigger if exists trg_crm_log_contact_email_link on public.crm_contact_emails;
create trigger trg_crm_log_contact_email_link
  after insert or delete on public.crm_contact_emails
  for each row execute function public.crm_log_contact_entity_link('email_message');


-- §42 — VINTA: si AGGIUNGE il ruolo cliente, e non si toglie niente.
-- «È stato un prospect e adesso è un cliente» è una storia; «è un cliente» da
-- solo è un'istantanea che ha perso come ci si è arrivati. `on conflict do
-- nothing` perché la seconda trattativa vinta non deve fallire per un ruolo
-- che c'è già.
create or replace function public.crm_opportunity_won_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.stage = 'won' and (tg_op = 'INSERT' or old.stage is distinct from 'won') then
    insert into public.crm_organization_roles (company_id, organization_id, role, created_by)
    values (new.company_id, new.organization_id, 'customer', auth.uid())
    on conflict (organization_id, role) do nothing;
  end if;
  return null;
end $$;

drop trigger if exists trg_crm_opportunity_won_role on public.crm_opportunities;
create trigger trg_crm_opportunity_won_role
  after insert or update of stage on public.crm_opportunities
  for each row execute function public.crm_opportunity_won_role();


-- ---------------------------------------------------------------------------
-- 19. LE NOTIFICHE
--
-- §141 — NON si crea `crm_notifications`. `public.notifications` è già per
-- utente, ha già la RLS per persona, il grant di sola select, il guardiano di
-- membership e le funzioni di marcatura. Una seconda tabella sarebbe una
-- seconda campanella, ed è esattamente la ragione che la 0020 scrive per aver
-- riusato l'enum invece di duplicarlo.
--
-- ⚠️ PRIMA il vincolo, poi il produttore. `notifications_entity_type_check` è un
-- elenco chiuso che si è allargato a ogni modulo (0018: task e
-- calendar_connection; 0020: document e email_message; 0024: contract).
-- Dimenticarlo significa prendere un 23514 a runtime, cioè — parole della
-- 0020 — «un guasto tecnico al posto di una funzione».
-- I letterali qui sono TESTO, non etichette di enum: nessun 55P04.
-- ---------------------------------------------------------------------------
alter table public.notifications drop constraint if exists notifications_entity_type_check;
do $$ begin
  alter table public.notifications
    add constraint notifications_entity_type_check
    check (entity_type in ('task', 'calendar_connection', 'document', 'email_message',
                           'contract', 'crm_organization', 'crm_opportunity'));
exception when duplicate_object then null; end $$;

alter table public.automation_events drop constraint if exists automation_events_entity_type_check;
do $$ begin
  alter table public.automation_events
    add constraint automation_events_entity_type_check
    check (entity_type in ('document', 'email_message', 'task', 'contract',
                           'crm_organization', 'crm_opportunity'));
exception when duplicate_object then null; end $$;

alter table public.workflow_runs drop constraint if exists workflow_runs_entity_type_check;
do $$ begin
  alter table public.workflow_runs
    add constraint workflow_runs_entity_type_check
    check (entity_type in ('document', 'email_message', 'task', 'contract',
                           'crm_organization', 'crm_opportunity'));
exception when duplicate_object then null; end $$;

-- §84 e §141 — si avvisa il responsabile della trattativa, non tutta l'azienda.
-- Cinque uscite anticipate copiate da `tasks_notify_assignment` (0018), e la
-- terza è quella che conta: CHI SI ASSEGNA DA SÉ NON RICEVE NIENTE. Una
-- campanella che suona per un gesto appena compiuto insegna a ignorarla.
create or replace function public.crm_notify_opportunity_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefs boolean;
begin
  if new.owner_user_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.owner_user_id is not distinct from old.owner_user_id then
    return new;
  end if;
  if auth.uid() is not null and auth.uid() = new.owner_user_id then return new; end if;
  if new.archived_at is not null or new.stage in ('won', 'lost') then return new; end if;

  select p.in_app_enabled into v_prefs
    from public.notification_preferences p
   where p.user_id = new.owner_user_id and p.company_id = new.company_id;
  -- L'assenza della riga NON è un rifiuto: i default valgono finché nessuno li
  -- cambia (lezione della 0018, dove tre copie dei default convivono).
  if v_prefs is not null and v_prefs = false then return new; end if;

  -- ⚠️ `organizationId` nel payload NON è un vezzo: il percorso della scheda è
  -- `/clienti/:organizzazione/opportunita/:id`, e senza quel dato la campanella
  -- porterebbe alla panoramica — cioè da nessuna parte, in silenzio. È il
  -- difetto che `notificationLink` ha per costruzione su ogni entità che non
  -- conosce, e l'unico modo di non ripeterlo è portarsi il dato dietro.
  insert into public.notifications (company_id, user_id, type, entity_type, entity_id, payload)
  values (new.company_id, new.owner_user_id, 'crm_opportunity_assigned',
          'crm_opportunity', new.id,
          jsonb_build_object('title', new.title,
                             'stage', new.stage,
                             'organizationId', new.organization_id,
                             'nextStepDueDate', new.next_step_due_date));
  return new;
end $$;

drop trigger if exists trg_crm_notify_opportunity_owner on public.crm_opportunities;
create trigger trg_crm_notify_opportunity_owner
  after insert or update of owner_user_id on public.crm_opportunities
  for each row execute function public.crm_notify_opportunity_owner();


-- ---------------------------------------------------------------------------
-- 20. LE AUTOMAZIONI
--
-- §131-§140. Sei inneschi, e tutti hanno una sorgente vera in questo file —
-- l'errore da non ripetere è quello che `docs/workflow-automation.md` racconta
-- di sé: inneschi dichiarati «non implementati perché non esistono le
-- sorgenti».
--
-- ⚠️ §135 — un'automazione CRM può creare lavoro e avvisare persone. NON può
-- inviare follow-up, iscrivere a newsletter, creare campagne, contattare
-- qualcuno o telefonare. Non è una scelta di configurazione: quelle azioni non
-- esistono nel motore, e l'Inbox è di sola lettura per contratto.
--
-- ⚠️ I letterali degli eventi compaiono SOLO qui dentro, nei corpi delle
-- funzioni. È l'eccezione dichiarata alla regola 55P04 della sezione 2:
-- Postgres deposita il corpo come testo e risolve l'etichetta alla prima
-- esecuzione. `scripts/bundle-migrations.mjs` conosce questa differenza.
-- ---------------------------------------------------------------------------
create or replace function public.crm_emit_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.automation_emit(
    new.company_id, 'crm_organization_created', 'crm_organization', new.id,
    jsonb_build_object('source', new.source),
    'crm:org:' || new.id::text || ':created',
    new.workflow_run_id
  );
  return null;
end $$;

drop trigger if exists trg_crm_emit_organization on public.crm_organizations;
create trigger trg_crm_emit_organization
  after insert on public.crm_organizations
  for each row execute function public.crm_emit_organization();


create or replace function public.crm_emit_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.automation_emit(
    new.company_id, 'crm_role_added', 'crm_organization', new.organization_id,
    jsonb_build_object('role', new.role),
    'crm:org:' || new.organization_id::text || ':role:' || new.role::text,
    null
  );
  return null;
end $$;

drop trigger if exists trg_crm_emit_role on public.crm_organization_roles;
create trigger trg_crm_emit_role
  after insert on public.crm_organization_roles
  for each row execute function public.crm_emit_role();


-- ⚠️ §140 — LA PROTEZIONE DAI CICLI, ed è il motivo per cui
-- `crm_opportunities.workflow_run_id` esiste. Senza, «quando cambia fase, crea
-- un'opportunità» e «quando nasce un'opportunità, cambia fase» si
-- rincorrerebbero. La chiave di deduplicazione del cambio di fase contiene la
-- fase di ARRIVO: lo stesso passaggio non si ripete, un passaggio diverso sì.
create or replace function public.crm_emit_opportunity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.automation_emit(
      new.company_id, 'crm_opportunity_created', 'crm_opportunity', new.id,
      jsonb_build_object('stage', new.stage, 'organizationId', new.organization_id),
      'crm:opp:' || new.id::text || ':created',
      new.workflow_run_id
    );
    return null;
  end if;

  if new.stage is distinct from old.stage then
    perform public.automation_emit(
      new.company_id, 'crm_opportunity_stage_changed', 'crm_opportunity', new.id,
      jsonb_build_object('from', old.stage, 'to', new.stage,
                         'organizationId', new.organization_id),
      'crm:opp:' || new.id::text || ':stage:' || new.stage::text,
      new.workflow_run_id
    );

    if new.stage = 'won' then
      perform public.automation_emit(
        new.company_id, 'crm_opportunity_won', 'crm_opportunity', new.id,
        jsonb_build_object('organizationId', new.organization_id),
        'crm:opp:' || new.id::text || ':won',
        new.workflow_run_id
      );
    end if;
  end if;

  return null;
end $$;

drop trigger if exists trg_crm_emit_opportunity on public.crm_opportunities;
create trigger trg_crm_emit_opportunity
  after insert or update of stage on public.crm_opportunities
  for each row execute function public.crm_emit_opportunity();


-- §132 — IL FOLLOW-UP SCADUTO RIUSA LO SCHEDULER ESISTENTE.
-- La regola scritta nella 0024 riga 2553 — «si riusa lo scheduler già
-- esistente, non si crea un secondo sistema di cron» — vale anche qui. Questa
-- funzione è la gemella di `automation_emit_overdue` (0020) e va chiamata dallo
-- stesso worker, nello stesso giro: nessun job pg_cron nuovo, nessuna Edge
-- Function nuova.
--
-- ⚠️ La finestra all'indietro è dichiarata e limitata, come per le attività: un
-- follow-up scaduto da un mese quando la regola viene attivata NON produce
-- niente. È la conseguenza di `automation_emit`, che non scrive nulla se
-- nessuna regola attiva ascoltava quel giorno — e di `workflows_for_event`, che
-- pretende `activated_at <= occurred_at`. Non esiste alcun recupero del
-- passato, e prometterlo sarebbe falso.
create or replace function public.crm_emit_follow_up_due(
  p_lookback_days integer default 3,
  p_limit         integer default 200
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_count integer := 0;
begin
  for r in
    select o.id, o.company_id, o.organization_id, o.stage, o.next_step_due_date, o.owner_user_id
      from public.crm_opportunities o
     where o.archived_at is null
       and o.stage not in ('won', 'lost')
       and o.next_step_due_date is not null
       and o.next_step_due_date < current_date
       and o.next_step_due_date >= current_date - make_interval(days => greatest(p_lookback_days, 0))
     order by o.next_step_due_date
     limit greatest(p_limit, 0)
  loop
    perform public.automation_emit(
      r.company_id, 'crm_follow_up_due', 'crm_opportunity', r.id,
      jsonb_build_object('stage', r.stage,
                         'organizationId', r.organization_id,
                         'nextStepDueDate', r.next_step_due_date,
                         'ownerUserId', r.owner_user_id),
      -- Una volta sola per opportunità e per scadenza: se qualcuno sposta il
      -- prossimo passo a un'altra data, quella è una scadenza nuova e vale.
      'crm:opp:' || r.id::text || ':followup:' || r.next_step_due_date::text,
      null
    );
    v_count := v_count + 1;
  end loop;

  return v_count;
end $$;

comment on function public.crm_emit_follow_up_due(integer, integer) is
  'Emette crm_follow_up_due per le opportunità con il prossimo passo scaduto. '
  'Da chiamare dal worker delle automazioni già esistente (§132): nessun cron '
  'nuovo. La finestra all''indietro è dichiarata e non recupera il passato.';


-- ---------------------------------------------------------------------------
-- 21. LE FUNZIONI DI LETTURA
--
-- §107, §108, §110. I conteggi li fa il database. Caricare le entità per
-- contarle nel browser è la differenza fra un modulo che regge mille clienti e
-- uno che regge dieci — e il §201 chiede espressamente che regga i mille.
--
-- ⚠️ LA LISTA E IL DETTAGLIO PASSANO DALLA STESSA FUNZIONE (`p_organization_id`).
-- È la disciplina del Document Hub: due implementazioni dei «valori composti»
-- finirebbero per mostrare due responsabili diversi sulla stessa
-- organizzazione, e il giorno in cui accade nessuno sa quale credere.
--
-- ⚠️ `security invoker` + filtro esplicito su `is_company_member`: DUE strati,
-- come `list_contracts`. Il primo è la RLS, il secondo è la funzione che non si
-- fida di essere stata chiamata con l'azienda giusta. La prova del §195 chiama
-- questa funzione passando il `p_company_id` di un'ALTRA azienda.
-- ---------------------------------------------------------------------------
create or replace function public.list_crm_organizations(
  p_company_id      uuid,
  p_query           text default null,
  p_role            public.crm_organization_role default null,
  p_owner_user_id   uuid default null,
  p_status          public.crm_relationship_status default null,
  p_stage           public.crm_opportunity_stage default null,
  p_stale_days      integer default null,
  p_only_overdue_tasks boolean default false,
  p_no_open_opportunity boolean default false,
  p_archived        boolean default false,
  p_sort            text default 'updated',
  p_limit           integer default 25,
  p_offset          integer default 0,
  p_organization_id uuid default null
)
returns table (
  id uuid,
  display_name text,
  legal_name text,
  uid_che text,
  vat_number text,
  website text,
  website_domain text,
  street text,
  postal_code text,
  city text,
  canton text,
  country_code text,
  relationship_status public.crm_relationship_status,
  account_owner_user_id uuid,
  source public.crm_source,
  source_detail text,
  notes text,
  last_contact_at timestamptz,
  archived_at timestamptz,
  merged_into_id uuid,
  created_at timestamptz,
  updated_at timestamptz,
  roles text[],
  primary_contact_id uuid,
  primary_contact_name text,
  primary_email text,
  primary_phone text,
  contact_count integer,
  open_task_count integer,
  overdue_task_count integer,
  open_opportunity_count integer,
  won_opportunity_count integer,
  contract_count integer,
  document_count integer,
  email_count integer,
  finance_count integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select o.*, count(*) over () as total_count
      from public.crm_organizations o
     where o.company_id = p_company_id
       -- Il secondo strato. `list_crm_organizations` è invoker, quindi la RLS
       -- gira comunque: questo filtro serve a rendere la garanzia leggibile e
       -- a non dipendere dal fatto che qualcuno un giorno cambi una policy.
       and public.is_company_member(o.company_id)
       and (p_organization_id is null or o.id = p_organization_id)
       and (p_organization_id is not null
            or (case when p_archived then o.archived_at is not null
                     else o.archived_at is null end))
       and (p_status is null or o.relationship_status = p_status)
       and (p_owner_user_id is null or o.account_owner_user_id = p_owner_user_id)
       and (p_role is null or exists (
             select 1 from public.crm_organization_roles r
              where r.organization_id = o.id and r.role = p_role))
       and (p_stage is null or exists (
             select 1 from public.crm_opportunities p
              where p.organization_id = o.id and p.archived_at is null and p.stage = p_stage))
       -- §69 — «da quanto non li sentiamo». `last_contact_at is null` rientra
       -- nel filtro: un'organizzazione mai contattata è il caso più estremo di
       -- inattività, non un caso da escludere perché manca il dato.
       and (p_stale_days is null
            or o.last_contact_at is null
            or o.last_contact_at < now() - make_interval(days => p_stale_days))
       and (not p_only_overdue_tasks or exists (
             select 1 from public.tasks t
              where t.crm_organization_id = o.id
                and t.company_id = o.company_id
                and t.archived_at is null
                and t.status <> 'completed'
                and t.due_date is not null
                and t.due_date < current_date))
       and (not p_no_open_opportunity or not exists (
             select 1 from public.crm_opportunities p
              where p.organization_id = o.id and p.archived_at is null
                and p.stage not in ('won', 'lost')))
       and (
         p_query is null or btrim(p_query) = ''
         or (coalesce(o.display_name, '') || ' ' || coalesce(o.legal_name, '') || ' '
             || coalesce(o.city, '')) ilike '%' || btrim(p_query) || '%'
         or coalesce(o.uid_che, '') ilike '%' || btrim(p_query) || '%'
         or coalesce(o.vat_number, '') ilike '%' || btrim(p_query) || '%'
         or coalesce(o.website_domain, '') ilike '%' || btrim(p_query) || '%'
         -- §103 — si cerca anche per persona e per recapito: chi cerca «Laura»
         -- sta cercando l'impresa di Laura, e non saperlo costringe a ricordare
         -- il nome dell'impresa per trovare la persona.
         or exists (
              select 1 from public.crm_contact_organizations co
                join public.crm_contacts c on c.id = co.contact_id
               where co.organization_id = o.id
                 and (coalesce(c.display_name, '') || ' ' || coalesce(c.first_name, '')
                      || ' ' || coalesce(c.last_name, '')) ilike '%' || btrim(p_query) || '%')
         or exists (
              select 1 from public.crm_contact_methods m
               where (m.organization_id = o.id
                      or m.contact_id in (select co.contact_id
                                            from public.crm_contact_organizations co
                                           where co.organization_id = o.id))
                 and coalesce(m.value, '') ilike '%' || btrim(p_query) || '%')
         or exists (
              select 1 from public.crm_opportunities p
               where p.organization_id = o.id
                 and coalesce(p.title, '') ilike '%' || btrim(p_query) || '%')
       )
     order by
       case when p_sort = 'name' then o.display_name end asc,
       -- `nulls first`: mai contattato viene prima di contattato molto tempo fa.
       case when p_sort = 'last_contact' then o.last_contact_at end asc nulls first,
       case when p_sort = 'created' then o.created_at end desc,
       case when p_sort not in ('name', 'last_contact', 'created') then o.updated_at end desc,
       o.id
     limit greatest(coalesce(p_limit, 25), 0)
     offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    b.id, b.display_name, b.legal_name, b.uid_che, b.vat_number, b.website, b.website_domain,
    b.street, b.postal_code, b.city, b.canton, b.country_code,
    b.relationship_status, b.account_owner_user_id, b.source, b.source_detail, b.notes,
    b.last_contact_at, b.archived_at, b.merged_into_id, b.created_at, b.updated_at,
    coalesce(rr.roles, array[]::text[]) as roles,
    pc.contact_id as primary_contact_id,
    pc.contact_name as primary_contact_name,
    pe.value as primary_email,
    pp.value as primary_phone,
    coalesce(cc.n, 0)::integer as contact_count,
    coalesce(tk.open_n, 0)::integer as open_task_count,
    coalesce(tk.overdue_n, 0)::integer as overdue_task_count,
    coalesce(op.open_n, 0)::integer as open_opportunity_count,
    coalesce(op.won_n, 0)::integer as won_opportunity_count,
    coalesce(ct.n, 0)::integer as contract_count,
    coalesce(dc.n, 0)::integer as document_count,
    coalesce(em.n, 0)::integer as email_count,
    coalesce(fi.n, 0)::integer as finance_count,
    b.total_count
  from base b
  -- I `lateral` girano SOLO sulle righe già rese: è la stessa disciplina di
  -- `list_documents`, e la differenza fra un conteggio su venticinque righe e
  -- uno su tutta la tabella.
  left join lateral (
    select array_agg(r.role::text order by r.role::text) as roles
      from public.crm_organization_roles r where r.organization_id = b.id
  ) rr on true
  left join lateral (
    select co.contact_id, c.display_name as contact_name
      from public.crm_contact_organizations co
      join public.crm_contacts c on c.id = co.contact_id
     where co.organization_id = b.id and co.active_until is null and c.archived_at is null
     order by co.is_primary desc, c.display_name
     limit 1
  ) pc on true
  left join lateral (
    select m.value from public.crm_contact_methods m
     where m.organization_id = b.id and m.type = 'email'
     order by m.is_primary desc, m.created_at limit 1
  ) pe on true
  left join lateral (
    select m.value from public.crm_contact_methods m
     where m.organization_id = b.id and m.type in ('phone', 'mobile')
     order by m.is_primary desc, m.created_at limit 1
  ) pp on true
  left join lateral (
    select count(*) as n from public.crm_contact_organizations co
      join public.crm_contacts c on c.id = co.contact_id
     where co.organization_id = b.id and co.active_until is null and c.archived_at is null
  ) cc on true
  left join lateral (
    select
      count(*) filter (where t.status <> 'completed') as open_n,
      count(*) filter (where t.status <> 'completed'
                         and t.due_date is not null and t.due_date < current_date) as overdue_n
      from public.tasks t
     where t.crm_organization_id = b.id and t.company_id = b.company_id and t.archived_at is null
  ) tk on true
  left join lateral (
    select
      count(*) filter (where p.stage not in ('won', 'lost')) as open_n,
      count(*) filter (where p.stage = 'won') as won_n
      from public.crm_opportunities p
     where p.organization_id = b.id and p.archived_at is null
  ) op on true
  left join lateral (
    select count(*) as n from public.contracts c
     where c.counterparty_organization_id = b.id and c.archived_at is null
  ) ct on true
  left join lateral (
    select count(*) as n from public.crm_organization_documents k where k.organization_id = b.id
  ) dc on true
  left join lateral (
    select count(*) as n from public.crm_organization_emails k where k.organization_id = b.id
  ) em on true
  left join lateral (
    select count(*) as n from public.finance_items f
     where f.supplier_organization_id = b.id and f.archived_at is null
  ) fi on true
  order by
    case when p_sort = 'name' then b.display_name end asc,
    case when p_sort = 'last_contact' then b.last_contact_at end asc nulls first,
    case when p_sort = 'created' then b.created_at end desc,
    case when p_sort not in ('name', 'last_contact', 'created') then b.updated_at end desc,
    b.id;
$$;

comment on function public.list_crm_organizations is
  'Lista E dettaglio delle controparti, con i conteggi calcolati dal database '
  '(§110). Il dettaglio passa da qui con p_organization_id: due '
  'implementazioni dei valori composti finirebbero per divergere.';


-- §52 e §54 — le opportunità, per la vista a colonne e per l'elenco.
create or replace function public.list_crm_opportunities(
  p_company_id      uuid,
  p_query           text default null,
  p_stage           public.crm_opportunity_stage default null,
  p_owner_user_id   uuid default null,
  p_organization_id uuid default null,
  p_only_overdue_next_step boolean default false,
  p_only_without_next_step boolean default false,
  p_archived        boolean default false,
  p_sort            text default 'updated',
  p_limit           integer default 50,
  p_offset          integer default 0,
  p_opportunity_id  uuid default null
)
returns table (
  id uuid,
  organization_id uuid,
  organization_name text,
  primary_contact_id uuid,
  primary_contact_name text,
  title text,
  stage public.crm_opportunity_stage,
  owner_user_id uuid,
  value_amount numeric,
  value_currency text,
  expected_close_date date,
  next_step text,
  next_step_due_date date,
  lost_reason text,
  won_at timestamptz,
  lost_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz,
  updated_at timestamptz,
  open_task_count integer,
  overdue_task_count integer,
  document_count integer,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with base as (
    select p.*, count(*) over () as total_count
      from public.crm_opportunities p
     where p.company_id = p_company_id
       and public.is_company_member(p.company_id)
       and (p_opportunity_id is null or p.id = p_opportunity_id)
       and (p_opportunity_id is not null
            or (case when p_archived then p.archived_at is not null
                     else p.archived_at is null end))
       and (p_stage is null or p.stage = p_stage)
       and (p_owner_user_id is null or p.owner_user_id = p_owner_user_id)
       and (p_organization_id is null or p.organization_id = p_organization_id)
       and (not p_only_overdue_next_step
            or (p.next_step_due_date is not null and p.next_step_due_date < current_date
                and p.stage not in ('won', 'lost')))
       -- §99 — «opportunità senza prossimo passo» è una delle quattro domande
       -- della pagina iniziale: una trattativa aperta che nessuno sa come
       -- proseguire è ferma, anche se sembra viva.
       and (not p_only_without_next_step
            or (nullif(btrim(coalesce(p.next_step, '')), '') is null
                and p.stage not in ('won', 'lost')))
       and (p_query is null or btrim(p_query) = ''
            or p.title ilike '%' || btrim(p_query) || '%'
            or exists (select 1 from public.crm_organizations o
                        where o.id = p.organization_id
                          and o.display_name ilike '%' || btrim(p_query) || '%'))
     order by
       case when p_sort = 'close_date' then p.expected_close_date end asc nulls last,
       case when p_sort = 'next_step' then p.next_step_due_date end asc nulls last,
       case when p_sort = 'value' then p.value_amount end desc nulls last,
       case when p_sort not in ('close_date', 'next_step', 'value') then p.updated_at end desc,
       p.id
     limit greatest(coalesce(p_limit, 50), 0)
     offset greatest(coalesce(p_offset, 0), 0)
  )
  select
    b.id, b.organization_id, o.display_name, b.primary_contact_id, c.display_name,
    b.title, b.stage, b.owner_user_id, b.value_amount, b.value_currency,
    b.expected_close_date, b.next_step, b.next_step_due_date, b.lost_reason,
    b.won_at, b.lost_at, b.archived_at, b.created_at, b.updated_at,
    coalesce(tk.open_n, 0)::integer, coalesce(tk.overdue_n, 0)::integer,
    coalesce(dc.n, 0)::integer,
    b.total_count
  from base b
  join public.crm_organizations o on o.id = b.organization_id
  left join public.crm_contacts c on c.id = b.primary_contact_id
  left join lateral (
    select count(*) filter (where t.status <> 'completed') as open_n,
           count(*) filter (where t.status <> 'completed'
                              and t.due_date is not null and t.due_date < current_date) as overdue_n
      from public.tasks t
     where t.crm_opportunity_id = b.id and t.archived_at is null
  ) tk on true
  left join lateral (
    select count(*) as n from public.crm_opportunity_documents k where k.opportunity_id = b.id
  ) dc on true
  order by
    case when p_sort = 'close_date' then b.expected_close_date end asc nulls last,
    case when p_sort = 'next_step' then b.next_step_due_date end asc nulls last,
    case when p_sort = 'value' then b.value_amount end desc nulls last,
    case when p_sort not in ('close_date', 'next_step', 'value') then b.updated_at end desc,
    b.id;
$$;


-- §45 e §100 — IL VALORE DI PIPELINE, SEPARATO PER VALUTA.
-- Una riga per valuta, e la somma la fa Postgres in `numeric`. Sommare
-- CHF ed EUR produrrebbe un numero che non esiste; sommarli in JavaScript in
-- virgola mobile produrrebbe anche un numero sbagliato.
create or replace function public.crm_pipeline_summary(p_company_id uuid)
returns table (
  stage public.crm_opportunity_stage,
  currency text,
  opportunity_count integer,
  total_amount numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  select p.stage,
         p.value_currency,
         count(*)::integer,
         sum(p.value_amount)
    from public.crm_opportunities p
   where p.company_id = p_company_id
     and public.is_company_member(p.company_id)
     and p.archived_at is null
   group by p.stage, p.value_currency
   order by p.stage, p.value_currency nulls last;
$$;

comment on function public.crm_pipeline_summary(uuid) is
  'Conteggi e valori della pipeline, UNA RIGA PER VALUTA (§45). CHF ed EUR non '
  'si sommano: il totale unico sarebbe un numero che non esiste.';


-- §99 e §100 — le quattro misure della pagina iniziale, e nessuna quinta.
-- §101 — non c'è «numero totale di contatti» né «email ricevute»: sono numeri
-- che non aiutano a decidere niente.
create or replace function public.crm_home_summary(
  p_company_id uuid,
  p_stale_days integer default 30
)
returns table (
  open_opportunities integer,
  without_next_step integer,
  overdue_follow_ups integer,
  stale_relationships integer,
  pending_suggestions integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    (select count(*)::integer from public.crm_opportunities p
      where p.company_id = p_company_id and p.archived_at is null
        and p.stage not in ('won', 'lost')),
    (select count(*)::integer from public.crm_opportunities p
      where p.company_id = p_company_id and p.archived_at is null
        and p.stage not in ('won', 'lost')
        and nullif(btrim(coalesce(p.next_step, '')), '') is null),
    (select count(*)::integer from public.crm_opportunities p
      where p.company_id = p_company_id and p.archived_at is null
        and p.stage not in ('won', 'lost')
        and p.next_step_due_date is not null and p.next_step_due_date < current_date),
    -- Solo clienti e prospect: un ente pubblico che non sentiamo da sei mesi
    -- non è una relazione trascurata, è un ente pubblico.
    (select count(*)::integer from public.crm_organizations o
      where o.company_id = p_company_id and o.archived_at is null
        and o.relationship_status = 'active'
        and exists (select 1 from public.crm_organization_roles r
                     where r.organization_id = o.id
                       and r.role in ('customer', 'prospect', 'lead'))
        and (o.last_contact_at is null
             or o.last_contact_at < now() - make_interval(days => greatest(p_stale_days, 1)))),
    (select count(*)::integer from public.crm_link_suggestions s
      where s.company_id = p_company_id and s.status = 'pending')
  where public.is_company_member(p_company_id);
$$;


-- §60, §61, §62, §109 — LA TIMELINE.
--
-- ⚠️ COMPONE, NON COPIA. Qui non c'è il corpo di una email, il testo di un
-- documento, una clausola né un commento: ci sono oggetto, data, tipo e
-- l'identificativo per aprire la cosa vera. Se un giorno il corpo di una email
-- finisse in questa funzione, il CRM diventerebbe una seconda casella di posta
-- che invecchia.
--
-- ⚠️ §73 — i messaggi NON si raggruppano nel dato. La funzione restituisce
-- `thread_key`, e il raggruppamento («Conversazione email — 4 messaggi») lo fa
-- la schermata. Scriverlo nel dato significherebbe che collegare un thread
-- collega anche i messaggi che nessuno ha ancora ricevuto.
create or replace function public.crm_timeline(
  p_company_id      uuid,
  p_organization_id uuid,
  p_limit           integer default 30,
  p_offset          integer default 0
)
returns table (
  id uuid,
  kind text,
  occurred_at timestamptz,
  title text,
  detail jsonb,
  entity_type text,
  entity_id uuid,
  actor_user_id uuid,
  contact_id uuid,
  opportunity_id uuid,
  thread_key text,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with allowed as (
    select o.id, o.company_id
      from public.crm_organizations o
     where o.id = p_organization_id
       and o.company_id = p_company_id
       and public.is_company_member(o.company_id)
  ),
  rows_all as (
    -- Le comunicazioni: solo metadati.
    select e.id,
           'email'::text as kind,
           e.received_at as occurred_at,
           e.subject as title,
           jsonb_build_object('senderName', e.sender_name, 'senderEmail', e.sender_email,
                              'hasAttachments', e.has_attachments) as detail,
           'email_message'::text as entity_type,
           e.id as entity_id,
           null::uuid as actor_user_id,
           null::uuid as contact_id,
           null::uuid as opportunity_id,
           e.provider_thread_id as thread_key
      from public.crm_organization_emails l
      join allowed a on a.id = l.organization_id
      join public.email_messages e on e.id = l.email_message_id

    union all

    -- Ciò che è successo e che nessun altro modulo registra.
    select i.id, 'interaction', i.occurred_at, i.subject,
           jsonb_build_object('type', i.type, 'hasNotes', i.notes is not null),
           'crm_interaction', i.id, i.created_by, i.contact_id, i.opportunity_id, null
      from public.crm_interactions i
      join allowed a on a.id = i.organization_id

    union all

    -- Lo storico del CRM: ruoli, responsabile, fasi, collegamenti.
    select v.id, 'event', v.occurred_at, null,
           v.detail || jsonb_build_object('kind', v.kind),
           'crm_event', v.id, v.actor_user_id, v.contact_id, v.opportunity_id, null
      from public.crm_events v
      join allowed a on a.id = v.organization_id

    union all

    -- §62 — gli eventi SIGNIFICATIVI delle attività: nata e conclusa. Non
    -- ogni spunta di una checklist: la timeline della relazione non è il
    -- diario di lavoro dell'attività, che ha già il suo storico.
    select t.id, 'task_created', t.created_at, t.title,
           jsonb_build_object('status', t.status, 'priority', t.priority, 'dueDate', t.due_date),
           'task', t.id, t.created_by, null, t.crm_opportunity_id, null
      from public.tasks t
      join allowed a on a.id = t.crm_organization_id and a.company_id = t.company_id

    union all

    select t.id, 'task_completed', t.completed_at, t.title,
           jsonb_build_object('status', t.status),
           'task', t.id, t.completed_by, null, t.crm_opportunity_id, null
      from public.tasks t
      join allowed a on a.id = t.crm_organization_id and a.company_id = t.company_id
     where t.completed_at is not null

    union all

    -- I contratti con questa controparte: la data in cui il rapporto è entrato
    -- in archivio. Le milestone restano dei Contratti, che è dove si leggono.
    select c.id, 'contract', c.created_at, c.display_name,
           jsonb_build_object('type', c.contract_type, 'lifecycle', c.lifecycle_status),
           'contract', c.id, c.created_by, null, null, null
      from public.contracts c
      join allowed a on a.id = c.counterparty_organization_id and a.company_id = c.company_id
  ),
  counted as (
    select r.*, count(*) over () as total_count
      from rows_all r
     where r.occurred_at is not null
  )
  select c.id, c.kind, c.occurred_at, c.title, c.detail, c.entity_type, c.entity_id,
         c.actor_user_id, c.contact_id, c.opportunity_id, c.thread_key, c.total_count
    from counted c
   -- §109 — ordine STABILE: senza la seconda chiave, due righe con lo stesso
   -- istante si scambierebbero fra una pagina e l'altra e qualcosa sparirebbe.
   order by c.occurred_at desc, c.id desc
   limit greatest(coalesce(p_limit, 30), 0)
   offset greatest(coalesce(p_offset, 0), 0);
$$;

comment on function public.crm_timeline is
  'La storia della relazione, composta per riferimenti (§61): oggetto, data e '
  'identificativo, mai il contenuto. thread_key serve alla schermata per '
  'raggruppare le conversazioni in lettura (§73).';


-- §28, §29, §30 — I DUPLICATI SI MOSTRANO, NON SI RISOLVONO.
-- La funzione restituisce righe con un MOTIVO leggibile e si ferma lì. Nessuna
-- fusione automatica su somiglianza di nome: «Rossi SA» e «Rossi SA, Lugano»
-- possono essere due imprese diverse, e chi lo sa è una persona.
--
-- ⚠️ §180 — rigorosamente DENTRO l'azienda. Non esiste, e non deve esistere,
-- una risposta del tipo «questo cliente esiste in un'altra azienda AI-Swisse»:
-- sarebbe una fuga di dati fra clienti travestita da funzione utile.
create or replace function public.crm_duplicate_candidates(
  p_company_id      uuid,
  p_organization_id uuid default null,
  p_limit           integer default 20
)
returns table (
  organization_id uuid,
  display_name text,
  duplicate_id uuid,
  duplicate_name text,
  reason public.crm_match_reason,
  reason_detail text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with mine as (
    select o.* from public.crm_organizations o
     where o.company_id = p_company_id
       and public.is_company_member(o.company_id)
       and o.archived_at is null
       and o.merged_into_id is null
       and (p_organization_id is null or o.id = p_organization_id)
  ),
  others as (
    select o.* from public.crm_organizations o
     where o.company_id = p_company_id
       and o.archived_at is null
       and o.merged_into_id is null
  )
  select * from (
    -- Il dominio del sito: forte, ma non un'identità — due società dello stesso
    -- gruppo condividono il sito.
    select m.id, m.display_name, x.id, x.display_name,
           'domain_match'::public.crm_match_reason,
           m.website_domain
      from mine m join others x
        on x.id <> m.id and x.website_domain = m.website_domain
     where m.website_domain is not null
       and not public.crm_is_public_domain(m.website_domain)

    union all

    -- La ragione sociale normalizzata. §25 — è un SOSPETTO. Il commento di
    -- `finance_norm_supplier` lo dichiara: «Swisscom e Swisscom SA restano
    -- soggetti diversi finché nessuno dice il contrario».
    select m.id, m.display_name, x.id, x.display_name,
           'name_normalized'::public.crm_match_reason,
           public.finance_norm_supplier(coalesce(m.legal_name, m.display_name))
      from mine m join others x
        on x.id <> m.id
       and public.finance_norm_supplier(coalesce(x.legal_name, x.display_name))
         = public.finance_norm_supplier(coalesce(m.legal_name, m.display_name))
     where public.finance_norm_supplier(coalesce(m.legal_name, m.display_name)) is not null

    union all

    -- Lo stesso indirizzo email registrato su due organizzazioni.
    select m.id, m.display_name, x.id, x.display_name,
           'email_exact'::public.crm_match_reason,
           mm.normalized_value
      from mine m
      join public.crm_contact_methods mm on mm.organization_id = m.id and mm.type = 'email'
      join public.crm_contact_methods xm on xm.normalized_value = mm.normalized_value
                                        and xm.type = 'email'
                                        and xm.organization_id is not null
                                        and xm.organization_id <> m.id
      join others x on x.id = xm.organization_id
     where mm.normalized_value is not null
  ) d(organization_id, display_name, duplicate_id, duplicate_name, reason, reason_detail)
  order by d.display_name, d.duplicate_name
  limit greatest(coalesce(p_limit, 20), 0);
$$;


-- §22, §23, §24 — DATO UN INDIRIZZO, CHI È.
-- Restituisce i candidati con il motivo, e il motivo dice tutto: `email_exact`
-- autorizza un collegamento automatico, `domain_match` no.
--
-- ⚠️ §179 — questa funzione non deve MAI diventare un modo per scoprire se
-- un'altra azienda usa un certo indirizzo. Il filtro su `p_company_id` più
-- `is_company_member` è l'unica risposta possibile: fuori dall'azienda, niente.
create or replace function public.crm_match_email(
  p_company_id uuid,
  p_email      text
)
returns table (
  organization_id uuid,
  organization_name text,
  contact_id uuid,
  contact_name text,
  reason public.crm_match_reason,
  reason_detail text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with norm as (
    select public.crm_norm_email(p_email) as e,
           public.crm_norm_domain(p_email) as d
  )
  select * from (
    -- Grado 2: l'indirizzo è già registrato. È un'identità.
    select coalesce(m.organization_id, co.organization_id) as organization_id,
           o.display_name,
           m.contact_id,
           c.display_name,
           'email_exact'::public.crm_match_reason,
           m.normalized_value
      from public.crm_contact_methods m
      cross join norm n
      left join public.crm_contacts c on c.id = m.contact_id
      left join lateral (
        select co.organization_id from public.crm_contact_organizations co
         where co.contact_id = m.contact_id and co.active_until is null
         order by co.is_primary desc limit 1
      ) co on true
      left join public.crm_organizations o
             on o.id = coalesce(m.organization_id, co.organization_id)
     where m.company_id = p_company_id
       and m.type = 'email'
       and n.e is not null
       and m.normalized_value = n.e

    union all

    -- Grado 3: il dominio coincide con il sito. È un SOSPETTO, e sui domini
    -- pubblici non è nemmeno quello.
    select o.id, o.display_name, null, null,
           'domain_match'::public.crm_match_reason, o.website_domain
      from public.crm_organizations o
      cross join norm n
     where o.company_id = p_company_id
       and o.archived_at is null
       and n.d is not null
       and o.website_domain = n.d
       and not public.crm_is_public_domain(n.d)
  ) r(organization_id, organization_name, contact_id, contact_name, reason, reason_detail)
  where public.is_company_member(p_company_id)
  -- L'identità prima del sospetto: chi legge prende la prima riga.
  order by case r.reason when 'email_exact' then 0 else 1 end, r.organization_name;
$$;

comment on function public.crm_match_email(uuid, text) is
  'Chi è questo indirizzo, dentro questa azienda e solo dentro questa azienda '
  '(§179). email_exact è un''identità e autorizza il collegamento automatico; '
  'domain_match è un sospetto e resta un suggerimento.';


-- §82 e §104 — l'autocompletamento server-side. Non si caricano tutte le
-- organizzazioni nel browser per riempire una tendina: con mille clienti
-- sarebbe un megabyte a ogni apertura di un filtro.
create or replace function public.crm_organization_options(
  p_company_id uuid,
  p_query      text default null,
  p_limit      integer default 20
)
returns table (id uuid, display_name text, city text, roles text[])
language sql
stable
security invoker
set search_path = ''
as $$
  select o.id, o.display_name, o.city,
         coalesce(array(select r.role::text from public.crm_organization_roles r
                         where r.organization_id = o.id order by r.role::text),
                  array[]::text[])
    from public.crm_organizations o
   where o.company_id = p_company_id
     and public.is_company_member(o.company_id)
     and o.archived_at is null
     and (p_query is null or btrim(p_query) = ''
          or o.display_name ilike '%' || btrim(p_query) || '%'
          or coalesce(o.legal_name, '') ilike '%' || btrim(p_query) || '%')
   order by o.display_name
   limit greatest(coalesce(p_limit, 20), 0);
$$;


-- ---------------------------------------------------------------------------
-- 22. LA FUSIONE
--
-- §31. Un gesto da amministratore, transazionale, che sposta tutto sul record
-- principale e ARCHIVIA il secondario lasciando un rimando — non lo cancella:
-- un vecchio collegamento deve continuare a portare da qualche parte.
--
-- ⚠️ §30 — NON esiste alcuna fusione automatica. Questa funzione si chiama solo
-- quando una persona ha guardato due schede e ha detto che sono la stessa.
-- ⚠️ `on conflict do nothing` seguito da `delete`: le relazioni già presenti
-- sul principale non si duplicano, e quelle rimaste sul secondario spariscono
-- con lui invece di restare appese.
-- ---------------------------------------------------------------------------
create or replace function public.crm_merge_organizations(
  p_target_id uuid,
  p_source_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_source_company uuid;
begin
  if p_target_id = p_source_id then
    raise exception 'crm_merge_into_self'
      using errcode = '23514', hint = 'Un''organizzazione non si fonde con sé stessa.';
  end if;

  select o.company_id into v_company from public.crm_organizations o where o.id = p_target_id;
  select o.company_id into v_source_company from public.crm_organizations o where o.id = p_source_id;

  if v_company is null or v_source_company is null or v_company is distinct from v_source_company then
    raise exception 'crm_merge_company_mismatch'
      using errcode = '23514',
            hint = 'Le due organizzazioni devono appartenere alla stessa azienda.';
  end if;

  -- §118 — la fusione è irreversibile nei fatti: la decide chi amministra.
  if not public.is_company_admin(v_company) then
    raise exception 'crm_merge_not_admin'
      using errcode = '42501',
            hint = 'Solo un amministratore dell''azienda può unire due anagrafiche.';
  end if;

  perform set_config('ai_swisse.crm_internal', 'on', true);

  -- I ruoli: si sommano, senza duplicarsi.
  insert into public.crm_organization_roles (company_id, organization_id, role, created_by)
  select v_company, p_target_id, r.role, r.created_by
    from public.crm_organization_roles r where r.organization_id = p_source_id
  on conflict (organization_id, role) do nothing;
  delete from public.crm_organization_roles where organization_id = p_source_id;

  -- Le persone: chi lavorava per il secondario lavora per il principale.
  update public.crm_contact_organizations co
     set organization_id = p_target_id
   where co.organization_id = p_source_id
     and not exists (
       select 1 from public.crm_contact_organizations t
        where t.organization_id = p_target_id
          and t.contact_id = co.contact_id
          and t.active_from is not distinct from co.active_from);
  delete from public.crm_contact_organizations where organization_id = p_source_id;

  -- I recapiti: quelli già presenti sul principale non si ripetono.
  delete from public.crm_contact_methods m
   where m.organization_id = p_source_id
     and exists (select 1 from public.crm_contact_methods t
                  where t.organization_id = p_target_id
                    and t.type = m.type
                    and t.normalized_value is not distinct from m.normalized_value);
  update public.crm_contact_methods
     set organization_id = p_target_id, is_primary = false
   where organization_id = p_source_id;

  update public.crm_opportunities set organization_id = p_target_id where organization_id = p_source_id;
  update public.crm_interactions   set organization_id = p_target_id where organization_id = p_source_id;

  update public.crm_organization_documents k
     set organization_id = p_target_id
   where k.organization_id = p_source_id
     and not exists (select 1 from public.crm_organization_documents t
                      where t.organization_id = p_target_id and t.document_id = k.document_id);
  delete from public.crm_organization_documents where organization_id = p_source_id;

  update public.crm_organization_emails k
     set organization_id = p_target_id
   where k.organization_id = p_source_id
     and not exists (select 1 from public.crm_organization_emails t
                      where t.organization_id = p_target_id
                        and t.email_message_id = k.email_message_id);
  delete from public.crm_organization_emails where organization_id = p_source_id;

  -- I collegamenti sugli altri moduli.
  update public.tasks set crm_organization_id = p_target_id where crm_organization_id = p_source_id;
  update public.contracts set counterparty_organization_id = p_target_id
   where counterparty_organization_id = p_source_id;
  update public.finance_items set supplier_organization_id = p_target_id
   where supplier_organization_id = p_source_id;

  -- Lo storico si conserva e si sposta: la storia della relazione è una sola,
  -- anche se per un po' è stata scritta su due schede.
  update public.crm_events set organization_id = p_target_id where organization_id = p_source_id;

  update public.crm_organizations
     set archived_at = now(),
         archived_by = auth.uid(),
         merged_into_id = p_target_id,
         relationship_status = 'inactive'
   where id = p_source_id;

  perform set_config('ai_swisse.crm_internal', '', true);

  perform public.crm_refresh_last_contact(p_target_id);

  insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
  values (v_company, p_target_id, 'merged',
          jsonb_build_object('from', p_source_id), auth.uid());
end $$;

comment on function public.crm_merge_organizations(uuid, uuid) is
  'Unisce due anagrafiche: ruoli, persone, recapiti, opportunità, interazioni, '
  'collegamenti e storico passano al principale; il secondario resta archiviato '
  'con merged_into_id (§31). Solo amministratori. Nessuna fusione automatica.';


-- ---------------------------------------------------------------------------
-- 23. RLS
--
-- §112-§117. Undici tabelle, la stessa condizione: `is_company_member`.
-- §117 — un utente che apre `/clienti/<id di un'altra azienda>` non riceve
-- dati parziali né un errore che confermi l'esistenza: la riga non esiste per
-- lui, e la schermata mostra «non trovato».
-- ---------------------------------------------------------------------------
alter table public.crm_organizations          enable row level security;
alter table public.crm_organization_roles     enable row level security;
alter table public.crm_contacts               enable row level security;
alter table public.crm_contact_methods        enable row level security;
alter table public.crm_contact_organizations  enable row level security;
alter table public.crm_opportunities          enable row level security;
alter table public.crm_interactions           enable row level security;
alter table public.crm_events                 enable row level security;
alter table public.crm_organization_documents enable row level security;
alter table public.crm_organization_emails    enable row level security;
alter table public.crm_contact_emails         enable row level security;
alter table public.crm_opportunity_documents  enable row level security;
alter table public.crm_link_suggestions       enable row level security;

drop policy if exists crm_organizations_select on public.crm_organizations;
create policy crm_organizations_select on public.crm_organizations
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_organizations_insert on public.crm_organizations;
create policy crm_organizations_insert on public.crm_organizations
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists crm_organizations_update on public.crm_organizations;
create policy crm_organizations_update on public.crm_organizations
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
-- §125 — nessuna policy di DELETE. Si archivia: cancellare un'anagrafica
-- porterebbe via, con la cascata, i collegamenti a documenti e comunicazioni
-- che restano fatti aziendali anche quando il rapporto finisce.

drop policy if exists crm_org_roles_select on public.crm_organization_roles;
create policy crm_org_roles_select on public.crm_organization_roles
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_org_roles_insert on public.crm_organization_roles;
create policy crm_org_roles_insert on public.crm_organization_roles
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists crm_org_roles_delete on public.crm_organization_roles;
create policy crm_org_roles_delete on public.crm_organization_roles
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists crm_contacts_select on public.crm_contacts;
create policy crm_contacts_select on public.crm_contacts
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_contacts_insert on public.crm_contacts;
create policy crm_contacts_insert on public.crm_contacts
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists crm_contacts_update on public.crm_contacts;
create policy crm_contacts_update on public.crm_contacts
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists crm_methods_select on public.crm_contact_methods;
create policy crm_methods_select on public.crm_contact_methods
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_methods_insert on public.crm_contact_methods;
create policy crm_methods_insert on public.crm_contact_methods
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists crm_methods_update on public.crm_contact_methods;
create policy crm_methods_update on public.crm_contact_methods
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
drop policy if exists crm_methods_delete on public.crm_contact_methods;
create policy crm_methods_delete on public.crm_contact_methods
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists crm_contact_orgs_select on public.crm_contact_organizations;
create policy crm_contact_orgs_select on public.crm_contact_organizations
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_contact_orgs_insert on public.crm_contact_organizations;
create policy crm_contact_orgs_insert on public.crm_contact_organizations
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists crm_contact_orgs_update on public.crm_contact_organizations;
create policy crm_contact_orgs_update on public.crm_contact_organizations
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
drop policy if exists crm_contact_orgs_delete on public.crm_contact_organizations;
create policy crm_contact_orgs_delete on public.crm_contact_organizations
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists crm_opportunities_select on public.crm_opportunities;
create policy crm_opportunities_select on public.crm_opportunities
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_opportunities_insert on public.crm_opportunities;
create policy crm_opportunities_insert on public.crm_opportunities
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists crm_opportunities_update on public.crm_opportunities;
create policy crm_opportunities_update on public.crm_opportunities
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists crm_interactions_select on public.crm_interactions;
create policy crm_interactions_select on public.crm_interactions
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_interactions_insert on public.crm_interactions;
create policy crm_interactions_insert on public.crm_interactions
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists crm_interactions_update on public.crm_interactions;
create policy crm_interactions_update on public.crm_interactions
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
drop policy if exists crm_interactions_delete on public.crm_interactions;
create policy crm_interactions_delete on public.crm_interactions
  for delete to authenticated using (public.is_company_member(company_id));

-- §85 e §86 — lo storico si LEGGE e basta. Nessuna policy di scrittura:
-- lo scrivono i trigger, che sono `security definer` e non passano di qui.
drop policy if exists crm_events_select on public.crm_events;
create policy crm_events_select on public.crm_events
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists crm_org_documents_select on public.crm_organization_documents;
create policy crm_org_documents_select on public.crm_organization_documents
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_org_documents_insert on public.crm_organization_documents;
create policy crm_org_documents_insert on public.crm_organization_documents
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists crm_org_documents_update on public.crm_organization_documents;
create policy crm_org_documents_update on public.crm_organization_documents
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
drop policy if exists crm_org_documents_delete on public.crm_organization_documents;
create policy crm_org_documents_delete on public.crm_organization_documents
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists crm_org_emails_select on public.crm_organization_emails;
create policy crm_org_emails_select on public.crm_organization_emails
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_org_emails_insert on public.crm_organization_emails;
create policy crm_org_emails_insert on public.crm_organization_emails
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists crm_org_emails_delete on public.crm_organization_emails;
create policy crm_org_emails_delete on public.crm_organization_emails
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists crm_contact_emails_select on public.crm_contact_emails;
create policy crm_contact_emails_select on public.crm_contact_emails
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_contact_emails_insert on public.crm_contact_emails;
create policy crm_contact_emails_insert on public.crm_contact_emails
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists crm_contact_emails_delete on public.crm_contact_emails;
create policy crm_contact_emails_delete on public.crm_contact_emails
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists crm_opp_documents_select on public.crm_opportunity_documents;
create policy crm_opp_documents_select on public.crm_opportunity_documents
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_opp_documents_insert on public.crm_opportunity_documents;
create policy crm_opp_documents_insert on public.crm_opportunity_documents
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists crm_opp_documents_delete on public.crm_opportunity_documents;
create policy crm_opp_documents_delete on public.crm_opportunity_documents
  for delete to authenticated using (public.is_company_member(company_id));

-- §21 — i suggerimenti si LEGGONO e si RISOLVONO. Non si creano dal browser:
-- li produce il codice server-side che ha visto la email o la fattura.
drop policy if exists crm_suggestions_select on public.crm_link_suggestions;
create policy crm_suggestions_select on public.crm_link_suggestions
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_suggestions_update on public.crm_link_suggestions;
create policy crm_suggestions_update on public.crm_link_suggestions
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));


-- ---------------------------------------------------------------------------
-- 24. I PERMESSI
--
-- ⚠️⚠️ `REVOKE ALL` PRIMA DI OGNI GRANT, SEMPRE.
-- Supabase esegue una volta per tutte `alter default privileges in schema
-- public grant all on tables to anon, authenticated, service_role`: OGNI
-- TABELLA NUOVA di `public` nasce con i privilegi di TABELLA completi. Un
-- `grant (colonna)` scritto dopo AGGIUNGE privilegi, non ne toglie. È il
-- difetto misurato della 0013 — un membro poteva riscrivere l'oggetto e il
-- corpo delle email della propria azienda — riparato dalla 0014, e non si
-- ripete qui.
--
-- ⚠️ Le colonne timbrate dal database NON compaiono in nessun grant:
-- created_by, created_at, updated_at, archived_by, uid_norm, website_domain,
-- last_contact_at, merged_into_id, normalized_value, won_at, lost_at,
-- confirmed_by, added_by, resolved_at, resolved_by. Senza permesso un
-- tentativo di scriverle FALLISCE, invece di essere ignorato in silenzio dal
-- trigger: un rifiuto si vede, un'omissione no.
-- ---------------------------------------------------------------------------
revoke all on public.crm_organizations          from anon, authenticated, public;
revoke all on public.crm_organization_roles     from anon, authenticated, public;
revoke all on public.crm_contacts               from anon, authenticated, public;
revoke all on public.crm_contact_methods        from anon, authenticated, public;
revoke all on public.crm_contact_organizations  from anon, authenticated, public;
revoke all on public.crm_opportunities          from anon, authenticated, public;
revoke all on public.crm_interactions           from anon, authenticated, public;
revoke all on public.crm_events                 from anon, authenticated, public;
revoke all on public.crm_organization_documents from anon, authenticated, public;
revoke all on public.crm_organization_emails    from anon, authenticated, public;
revoke all on public.crm_contact_emails         from anon, authenticated, public;
revoke all on public.crm_opportunity_documents  from anon, authenticated, public;
revoke all on public.crm_link_suggestions       from anon, authenticated, public;

grant select on public.crm_organizations          to authenticated;
grant select on public.crm_organization_roles     to authenticated;
grant select on public.crm_contacts               to authenticated;
grant select on public.crm_contact_methods        to authenticated;
grant select on public.crm_contact_organizations  to authenticated;
grant select on public.crm_opportunities          to authenticated;
grant select on public.crm_interactions           to authenticated;
grant select on public.crm_events                 to authenticated;
grant select on public.crm_organization_documents to authenticated;
grant select on public.crm_organization_emails    to authenticated;
grant select on public.crm_contact_emails         to authenticated;
grant select on public.crm_opportunity_documents  to authenticated;
grant select on public.crm_link_suggestions       to authenticated;

grant insert (company_id, display_name, legal_name, uid_che, vat_number, website,
              street, postal_code, city, canton, country_code, relationship_status,
              account_owner_user_id, source, source_detail, notes, archived_at)
  on public.crm_organizations to authenticated;
grant update (display_name, legal_name, uid_che, vat_number, website,
              street, postal_code, city, canton, country_code, relationship_status,
              account_owner_user_id, source_detail, notes, archived_at)
  on public.crm_organizations to authenticated;

grant insert (company_id, organization_id, role) on public.crm_organization_roles to authenticated;
grant delete on public.crm_organization_roles to authenticated;

grant insert (company_id, first_name, last_name, display_name, preferred_language,
              notes, archived_at) on public.crm_contacts to authenticated;
grant update (first_name, last_name, display_name, preferred_language,
              notes, archived_at) on public.crm_contacts to authenticated;

grant insert (company_id, contact_id, organization_id, type, value, label, is_primary)
  on public.crm_contact_methods to authenticated;
grant update (type, value, label, is_primary) on public.crm_contact_methods to authenticated;
grant delete on public.crm_contact_methods to authenticated;

grant insert (company_id, contact_id, organization_id, job_title, department,
              is_primary, active_from, active_until)
  on public.crm_contact_organizations to authenticated;
grant update (job_title, department, is_primary, active_from, active_until)
  on public.crm_contact_organizations to authenticated;
grant delete on public.crm_contact_organizations to authenticated;

grant insert (company_id, organization_id, primary_contact_id, title, stage,
              owner_user_id, value_amount, value_currency, expected_close_date,
              next_step, next_step_due_date, lost_reason, archived_at)
  on public.crm_opportunities to authenticated;
grant update (primary_contact_id, title, stage, owner_user_id, value_amount,
              value_currency, expected_close_date, next_step, next_step_due_date,
              lost_reason, archived_at)
  on public.crm_opportunities to authenticated;

grant insert (company_id, organization_id, contact_id, opportunity_id, type,
              occurred_at, subject, notes) on public.crm_interactions to authenticated;
grant update (type, occurred_at, subject, notes) on public.crm_interactions to authenticated;
grant delete on public.crm_interactions to authenticated;

grant insert (company_id, organization_id, document_id, relation)
  on public.crm_organization_documents to authenticated;
grant update (relation) on public.crm_organization_documents to authenticated;
grant delete on public.crm_organization_documents to authenticated;

grant insert (company_id, organization_id, email_message_id)
  on public.crm_organization_emails to authenticated;
grant delete on public.crm_organization_emails to authenticated;

grant insert (company_id, contact_id, email_message_id)
  on public.crm_contact_emails to authenticated;
grant delete on public.crm_contact_emails to authenticated;

grant insert (company_id, opportunity_id, document_id)
  on public.crm_opportunity_documents to authenticated;
grant delete on public.crm_opportunity_documents to authenticated;

-- Un suggerimento si risolve, non si scrive.
grant update (status) on public.crm_link_suggestions to authenticated;

-- Le colonne di collegamento sulle tabelle degli altri moduli.
-- ⚠️ Su `contracts` e `finance_items` i grant sono di COLONNA (0024, 0021):
-- senza queste due righe la colonna sarebbe leggibile ma non scrivibile dal
-- browser, e il pulsante «Collega controparte» fallirebbe con un errore di
-- permessi. Su `tasks` non serve nulla — i grant sono di tabella dalla 0004 —
-- ed è proprio per questo che là la difesa è un trigger.
grant insert (counterparty_organization_id) on public.contracts to authenticated;
grant update (counterparty_organization_id) on public.contracts to authenticated;
grant update (supplier_organization_id) on public.finance_items to authenticated;

-- Le funzioni. La firma va ripetuta per intero: i permessi sono legati a essa.
revoke all on function public.crm_norm_email(text) from public, anon;
revoke all on function public.crm_norm_domain(text) from public, anon;
revoke all on function public.crm_norm_phone(text) from public, anon;
revoke all on function public.crm_norm_uid(text) from public, anon;
revoke all on function public.crm_is_public_domain(text) from public, anon;
grant execute on function public.crm_norm_email(text) to authenticated;
grant execute on function public.crm_norm_domain(text) to authenticated;
grant execute on function public.crm_norm_phone(text) to authenticated;
grant execute on function public.crm_norm_uid(text) to authenticated;
grant execute on function public.crm_is_public_domain(text) to authenticated;

revoke all on function public.list_crm_organizations(uuid, text, public.crm_organization_role, uuid, public.crm_relationship_status, public.crm_opportunity_stage, integer, boolean, boolean, boolean, text, integer, integer, uuid) from public, anon;
grant execute on function public.list_crm_organizations(uuid, text, public.crm_organization_role, uuid, public.crm_relationship_status, public.crm_opportunity_stage, integer, boolean, boolean, boolean, text, integer, integer, uuid) to authenticated;

revoke all on function public.list_crm_opportunities(uuid, text, public.crm_opportunity_stage, uuid, uuid, boolean, boolean, boolean, text, integer, integer, uuid) from public, anon;
grant execute on function public.list_crm_opportunities(uuid, text, public.crm_opportunity_stage, uuid, uuid, boolean, boolean, boolean, text, integer, integer, uuid) to authenticated;

revoke all on function public.crm_pipeline_summary(uuid) from public, anon;
grant execute on function public.crm_pipeline_summary(uuid) to authenticated;

revoke all on function public.crm_home_summary(uuid, integer) from public, anon;
grant execute on function public.crm_home_summary(uuid, integer) to authenticated;

revoke all on function public.crm_timeline(uuid, uuid, integer, integer) from public, anon;
grant execute on function public.crm_timeline(uuid, uuid, integer, integer) to authenticated;

revoke all on function public.crm_duplicate_candidates(uuid, uuid, integer) from public, anon;
grant execute on function public.crm_duplicate_candidates(uuid, uuid, integer) to authenticated;

revoke all on function public.crm_match_email(uuid, text) from public, anon;
grant execute on function public.crm_match_email(uuid, text) to authenticated;

revoke all on function public.crm_organization_options(uuid, text, integer) from public, anon;
grant execute on function public.crm_organization_options(uuid, text, integer) to authenticated;

revoke all on function public.crm_merge_organizations(uuid, uuid) from public, anon;
grant execute on function public.crm_merge_organizations(uuid, uuid) to authenticated;

-- ⚠️ NON concesse ad `authenticated`, e non è una dimenticanza:
-- `crm_refresh_last_contact` scrive una colonna che nessun utente deve poter
-- toccare, e `crm_emit_follow_up_due` emette eventi di automazione — la
-- gemella `automation_emit` è revocata per la stessa ragione. Le chiama il
-- worker con il service role.
revoke all on function public.crm_refresh_last_contact(uuid) from public, anon, authenticated;
revoke all on function public.crm_emit_follow_up_due(integer, integer) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 25. AUTOVERIFICA
--
-- Il file non si limita a dichiarare le proprie garanzie: le prova, e se non
-- tornano l'applicazione FALLISCE invece di riuscire a metà. È la disciplina
-- della 0014 (che interroga information_schema per accorgersi dei permessi
-- inattesi) e della 0024 (che verifica il RISULTATO dell'aritmetica delle date,
-- non la sua sintassi).
--
-- ⚠️ QUESTO BLOCCO NON NOMINA NESSUNO DEGLI OTTO VALORI AGGIUNTI AGLI ENUM
-- ESISTENTI nella sezione 2 — nemmeno dentro un commento, perché il controllo
-- che sorveglia questa promessa cerca il letterale fra apici e non sa
-- distinguere un commento da un'istruzione. Nominarli qui produrrebbe 55P04 su
-- ogni installazione da zero, dato che `full-setup.sql` concatena tutte le
-- migrazioni in una transazione sola. La verifica sta in `test:crm-unit`.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad  text;
  v_text text;
  v_n    integer;
begin
  -- (a) La RLS è accesa su tutte e tredici le tabelle.
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('crm_organizations', 'crm_organization_roles', 'crm_contacts',
                       'crm_contact_methods', 'crm_contact_organizations',
                       'crm_opportunities', 'crm_interactions', 'crm_events',
                       'crm_organization_documents', 'crm_organization_emails',
                       'crm_contact_emails', 'crm_opportunity_documents',
                       'crm_link_suggestions')
     and c.relrowsecurity = false;
  if v_bad is not null then
    raise exception 'RLS non attiva su: %', v_bad;
  end if;

  -- (b) ⚠️ LO STORICO NON È SCRIVIBILE DAL CLIENT. È la garanzia del §86: se
  --     un giorno qualcuno concedesse un insert su crm_events, si potrebbe
  --     firmare un'azione a nome di un collega e questa migrazione smetterebbe
  --     di applicarsi. È la stessa autoverifica che la 0016 fa su task_events.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ') into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name = 'crm_events'
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'lo storico del CRM risulta scrivibile dal client: %', v_bad;
  end if;

  -- (c) Le anagrafiche non sono cancellabili: si archiviano (§123, §125).
  select string_agg(format('%s.%s', table_name, privilege_type), ', ') into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name in ('crm_organizations', 'crm_contacts', 'crm_opportunities')
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
     and privilege_type = 'DELETE';
  if v_bad is not null then
    raise exception 'un''anagrafica del CRM risulta cancellabile dal client: %', v_bad;
  end if;

  -- (d) Le colonne timbrate dal database non sono scrivibili colonna per
  --     colonna. È il controllo che rende vera la promessa della sezione 24.
  select string_agg(format('%s.%s', table_name, column_name), ', ') into v_bad
    from information_schema.column_privileges
   where table_schema = 'public'
     and ((table_name = 'crm_organizations'
           and column_name in ('uid_norm', 'website_domain', 'last_contact_at',
                               'merged_into_id', 'created_by', 'created_at',
                               'updated_at', 'archived_by', 'workflow_run_id'))
       or (table_name = 'crm_opportunities'
           and column_name in ('won_at', 'lost_at', 'created_by', 'created_at',
                               'updated_at', 'archived_by', 'workflow_run_id'))
       or (table_name = 'crm_contact_methods'
           and column_name in ('normalized_value', 'created_by', 'created_at'))
       or (table_name = 'crm_link_suggestions'
           and column_name in ('resolved_at', 'resolved_by', 'dedupe_key', 'reason')))
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
     and privilege_type in ('INSERT', 'UPDATE');
  if v_bad is not null then
    raise exception 'colonne del CRM che il database deve timbrare risultano scrivibili dal client: %', v_bad;
  end if;

  -- (d-bis) ⚠️ DUE REGOLE DIVERSE, E CONFONDERLE HA FATTO FALLIRE QUESTA
  --     MIGRAZIONE ALLA PRIMA APPLICAZIONE REALE.
  --     `company_id` e `organization_id` DEVONO essere scrivibili all'INSERT:
  --     sono `not null` senza default, e senza quel permesso non si potrebbe
  --     creare nessuna opportunità. Ciò che non deve essere possibile è
  --     CAMBIARLE dopo — spostare una trattativa su un'altra controparte
  --     riscriverebbe la storia di due relazioni invece di una. Il guardiano le
  --     ripristina già da `old`; qui si verifica che il permesso non ci sia
  --     nemmeno, così un tentativo FALLISCE invece di riuscire senza effetto.
  --     La prima versione di questo controllo le vietava a entrambe le
  --     operazioni mentre i grant ne concedevano l'insert: una contraddizione
  --     interna al file, trovata eseguendolo e non rileggendolo.
  select string_agg(format('%s.%s', table_name, column_name), ', ') into v_bad
    from information_schema.column_privileges
   where table_schema = 'public'
     and ((table_name = 'crm_opportunities' and column_name in ('company_id', 'organization_id'))
       or (table_name = 'crm_organizations' and column_name = 'company_id')
       or (table_name = 'crm_contacts' and column_name = 'company_id')
       or (table_name = 'crm_interactions' and column_name in ('company_id', 'organization_id')))
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
     and privilege_type = 'UPDATE';
  if v_bad is not null then
    raise exception 'colonne di appartenenza del CRM risultano MODIFICABILI dal client: %', v_bad;
  end if;

  -- (e) I guardiani sono `security definer`: senza, «se la funzione gira come
  --     il chiamante, allora la funzione È il chiamante, e il permesso che
  --     manca al client manca anche a lei» (0019). Un `create or replace` che
  --     dimenticasse la parola riporterebbe il difetto che la 0019 ha chiuso.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('crm_organizations_guard', 'crm_org_child_guard',
                       'crm_contacts_guard', 'crm_contact_methods_guard',
                       'crm_contact_organizations_guard', 'crm_opportunities_guard',
                       'crm_interactions_guard', 'crm_org_document_guard',
                       'crm_org_email_guard', 'crm_contact_email_guard',
                       'crm_opportunity_document_guard', 'crm_link_suggestions_guard',
                       'crm_log_org_entity_link', 'crm_log_contact_entity_link',
                       'tasks_crm_guard', 'contracts_crm_guard', 'finance_items_crm_guard',
                       'crm_refresh_last_contact', 'crm_merge_organizations',
                       'crm_emit_follow_up_due')
     and p.prosecdef = false;
  if v_bad is not null then
    raise exception 'funzioni del CRM che devono essere security definer non lo sono: %', v_bad;
  end if;

  -- (f) ⚠️ LA CIFRA DI CONTROLLO DELL'IDI FA QUELLO CHE IL FILE DICHIARA.
  --     Non si verifica la sintassi della funzione: si verifica il RISULTATO,
  --     perché §25 grado 1 dice che un IDI valido AUTORIZZA UN COLLEGAMENTO
  --     AUTOMATICO. Se questo algoritmo sbagliasse, due imprese diverse
  --     verrebbero unite senza che nessuno lo abbia chiesto.
  --     CHE-107.721.785 è un IDI reale, lo stesso provato contro l'API Zefix
  --     viva il 2026-07-28.
  v_text := public.crm_norm_uid('CHE-107.721.785');
  if v_text is distinct from 'CHE107721785' then
    raise exception 'IDI valido non normalizzato: atteso CHE107721785, ottenuto %', coalesce(v_text, '<null>');
  end if;
  -- Scritto senza punteggiatura deve dare lo stesso risultato, altrimenti
  -- l'indice unico non riconoscerebbe il duplicato.
  if public.crm_norm_uid('che107721785') is distinct from 'CHE107721785' then
    raise exception 'la forma senza punti non produce la stessa chiave';
  end if;
  -- ⚠️ Il caso che conta di più: una cifra di controllo sbagliata NON deve
  --    produrre una chiave. Se la producesse, un IDI inventato collegherebbe.
  if public.crm_norm_uid('CHE-107.721.786') is not null then
    raise exception 'un IDI con la cifra di controllo errata non deve identificare nessuno';
  end if;
  if public.crm_norm_uid('CHE-107.721') is not null then
    raise exception 'un IDI incompleto non deve identificare nessuno';
  end if;
  if public.crm_norm_uid(null) is not null then
    raise exception 'un IDI assente non deve identificare nessuno';
  end if;

  -- (g) Il dominio, nelle tre forme che arrivano davvero.
  if public.crm_norm_domain('laura@rossi.ch') is distinct from 'rossi.ch' then
    raise exception 'dominio da indirizzo email: atteso rossi.ch, ottenuto %',
      coalesce(public.crm_norm_domain('laura@rossi.ch'), '<null>');
  end if;
  if public.crm_norm_domain('https://www.rossi.ch/chi-siamo') is distinct from 'rossi.ch' then
    raise exception 'dominio da URL con www e percorso: atteso rossi.ch, ottenuto %',
      coalesce(public.crm_norm_domain('https://www.rossi.ch/chi-siamo'), '<null>');
  end if;
  if public.crm_norm_domain('  ROSSI.CH  ') is distinct from 'rossi.ch' then
    raise exception 'dominio scritto a mano in maiuscolo non normalizzato';
  end if;

  -- (h) ⚠️ L'EMAIL NON VIENE ALTERATA. §15 — se un giorno qualcuno
  --     «migliorasse» questa funzione togliendo i punti di Gmail o il +tag,
  --     due persone diverse diventerebbero la stessa e il collegamento
  --     automatico del §22 le unirebbe. Queste tre righe lo impediscono.
  if public.crm_norm_email('  Laura@Rossi.CH ') is distinct from 'laura@rossi.ch' then
    raise exception 'l''email non è normalizzata a minuscolo';
  end if;
  if public.crm_norm_email('l.a.u.r.a@gmail.com') is distinct from 'l.a.u.r.a@gmail.com' then
    raise exception 'i punti di Gmail NON vanno rimossi: sono un''altra identità (§15)';
  end if;
  if public.crm_norm_email('laura+contabilita@rossi.ch') is distinct from 'laura+contabilita@rossi.ch' then
    raise exception 'il +tag NON va rimosso: è un''altra identità (§15)';
  end if;

  -- (i) I domini pubblici non collegano nessuno (§24).
  if not public.crm_is_public_domain('gmail.com') then
    raise exception 'gmail.com deve essere riconosciuto come dominio pubblico';
  end if;
  if not public.crm_is_public_domain('bluewin.ch') then
    raise exception 'bluewin.ch deve essere riconosciuto come dominio pubblico';
  end if;
  if public.crm_is_public_domain('rossi.ch') then
    raise exception 'un dominio aziendale non deve essere trattato come pubblico';
  end if;

  -- (j) Il telefono conserva il prefisso e non lo inventa (§16).
  if public.crm_norm_phone('+41 91 123 45 67') is distinct from '+41911234567' then
    raise exception 'il prefisso internazionale va conservato';
  end if;
  if public.crm_norm_phone('091 123 45 67') is distinct from '0911234567' then
    raise exception 'un numero senza prefisso non deve riceverne uno inventato';
  end if;

  -- (k) I tre vincoli di entità sono stati allargati: se ne manca uno,
  --     l'azione «notifica» di un'automazione CRM fallirebbe a runtime con un
  --     23514 — «un guasto tecnico al posto di una funzione» (0020).
  select count(*) into v_n
    from pg_constraint
   where conname in ('notifications_entity_type_check',
                     'automation_events_entity_type_check',
                     'workflow_runs_entity_type_check')
     and pg_get_constraintdef(oid) like '%crm_opportunity%';
  if v_n <> 3 then
    raise exception 'i vincoli entity_type allargati sono %, attesi 3', v_n;
  end if;

  raise notice '0026 applicata: 13 tabelle, RLS attiva, permessi verificati, cifra di controllo IDI e normalizzazioni provate.';
end $$;
