-- ============================================================================
-- 0021 — FINANCE OPERATIONS
--
-- Fatture fornitori, ricevute e note di credito: acquisire, capire, verificare,
-- organizzare. NON è una contabilità, e la differenza non è di ambizione ma di
-- responsabilità: una contabilità afferma, questo modulo PREPARA.
--
-- ⚠️ CIÒ CHE QUESTA MIGRAZIONE NON FA, E NON PER MANCANZA DI TEMPO:
-- nessun pagamento, nessun file di pagamento, nessuna chiamata a una banca,
-- nessuna scrittura in partita doppia, nessun piano dei conti, nessuna
-- dichiarazione IVA, nessuna riconciliazione bancaria, nessuna determinazione
-- fiscale («questa spesa è deducibile»). Finché non esistono approvazioni
-- mature, integrazione bancaria, permessi granulari e riconciliazione, il
-- prodotto non deve poter muovere denaro. Comprendere e preparare, non muovere.
--
-- ⚠️ NON CREA UNA SECONDA VERITÀ SUI DOCUMENTI.
-- Il file resta del documento (Storage), il testo resta dell'estrazione, la
-- lettura amministrativa resta dell'analisi immutabile, la provenienza resta
-- dell'Inbox, il lavoro resta delle attività. Qui si aggiunge SOLO la lettura
-- finanziaria specializzata e lo stato operativo che ne deriva.
--
--   DOCUMENTO → ESTRAZIONE TESTO → ANALISI (Admin AI) → ESTRAZIONE FINANCE
--             → VERIFICA UMANA → ATTIVITÀ / AUTOMAZIONI
--
-- Requisiti: 0001–0020 applicate.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. I tipi
--
-- Tutti creati con `create type … as enum (…)`: i valori dichiarati alla
-- creazione sono utilizzabili SUBITO, anche nella stessa transazione. È la
-- differenza con `alter type … add value`, che invece rende l'etichetta
-- inservibile fino al commit (55P04) — vedi il punto 2.
-- ---------------------------------------------------------------------------

-- Che cosa è il documento, dal punto di vista finanziario.
-- TRE valori e nessun «altro documento finanziario»: nel dubbio il documento
-- resta FUORI da Finance e lo si dice, invece di creare una fattura incerta che
-- poi qualcuno tratterà come certa.
do $$ begin
  create type public.finance_item_type as enum ('supplier_invoice', 'receipt', 'credit_note');
exception when duplicate_object then null; end $$;

-- A che punto è la MACCHINA. Non dice niente su che cosa debba fare una persona.
do $$ begin
  create type public.finance_processing_status as enum ('pending', 'processing', 'completed', 'failed');
exception when duplicate_object then null; end $$;

-- Che cosa deve fare una PERSONA. Deliberatamente separato dal precedente
-- (§109): «l'estrazione è fallita» e «i dati vanno verificati» sono due cose
-- diverse, e fonderle renderebbe un guasto tecnico indistinguibile dal lavoro.
--
-- ⚠️ `archived` NON è qui, benché il capitolato lo elenchi fra gli stati.
-- L'archiviazione è un `archived_at`, come su `documents` e su `tasks`: se
-- fosse anche uno stato di verifica, archiviare una fattura verificata
-- cancellerebbe l'informazione che era stata verificata.
do $$ begin
  create type public.finance_review_status as enum ('needs_review', 'ready');
exception when duplicate_object then null; end $$;

-- Chi ha deciso che questo documento è un documento finanziario.
-- Stessa forma di `document_category_source`: `rule` è la regola deterministica
-- del prodotto, `manual` una persona, `workflow` una regola scritta dall'azienda.
do $$ begin
  create type public.finance_origin as enum ('rule', 'manual', 'workflow');
exception when duplicate_object then null; end $$;

-- Da dove viene UN SINGOLO CAMPO (§101/§38). Non è una curiosità tecnica: è la
-- differenza fra «l'IBAN è scritto nel codice QR» e «l'ho letto nel testo», e
-- una persona che verifica un pagamento ha diritto di sapere quale delle due.
do $$ begin
  create type public.finance_field_source as enum ('qr', 'deterministic', 'ai', 'human');
exception when duplicate_object then null; end $$;

-- Il tipo di riferimento di pagamento secondo lo standard svizzero:
-- riferimento QR (27 cifre), riferimento creditore ISO 11649, oppure nessuno.
do $$ begin
  create type public.finance_reference_type as enum ('qrr', 'scor', 'non');
exception when duplicate_object then null; end $$;

-- Organizzazione di una spesa (§57). ⚠️ NON è un conto contabile e l'etichetta
-- nell'interfaccia dice «Categoria spesa»: chiamarla «conto» significherebbe
-- promettere una contabilità che non c'è.
do $$ begin
  create type public.finance_expense_category as enum
    ('travel', 'meals', 'office', 'software', 'vehicle', 'other');
exception when duplicate_object then null; end $$;

-- Come è stata pagata una spesa, SE il documento lo dice (§59). Fatto
-- facoltativo: non si deduce, non si presume.
do $$ begin
  create type public.finance_payment_method as enum ('card', 'cash', 'other');
exception when duplicate_object then null; end $$;

-- Esito di un tentativo di estrazione. Due valori: o ha prodotto un verbale
-- leggibile o non l'ha prodotto. Un'estrazione con campi mancanti è
-- `completed` con le sue incertezze — «incompleto» non è «fallito».
do $$ begin
  create type public.finance_extraction_status as enum ('completed', 'failed');
exception when duplicate_object then null; end $$;

-- Le bandiere di qualità (§150). Sono CHIAVI: la frase la scrive l'interfaccia
-- nella lingua di chi legge. Ognuna corrisponde a una verifica che il codice
-- esegue davvero — non esiste una bandiera che nessuno alza.
do $$ begin
  create type public.finance_quality_flag as enum (
    'amount_mismatch',        -- netto + IVA ≠ lordo oltre l'arrotondamento
    'vat_mismatch',           -- il dettaglio IVA non somma al totale IVA
    'qr_text_mismatch',       -- il codice QR e il testo dicono cose diverse
    'missing_currency',
    'missing_total',
    'missing_supplier',
    'duplicate_suspected',
    'low_ocr_confidence',
    'invalid_iban',           -- la cifra di controllo dell'IBAN non torna
    'invalid_reference',      -- il riferimento non supera il proprio controllo
    'reference_type_mismatch',-- QR-IBAN senza riferimento QR, o viceversa
    'inconsistent_due_date',  -- scadenza prima della data fattura, o diversa
                              -- da quella letta dall'analisi generale (§47)
    'ambiguous_date',         -- gg.mm o mm.gg: entrambe ≤ 12 (§118)
    'qr_not_read',            -- c'è un codice QR ma non è stato decodificato
    'negative_amount'         -- importo negativo su un documento che non è
                              -- una nota di credito
  );
exception when duplicate_object then null; end $$;

-- Lo storico (§87). Non si registra ogni visualizzazione: solo ciò che cambia.
do $$ begin
  create type public.finance_event_kind as enum (
    'created', 'extraction_completed', 'extraction_failed', 'corrected',
    'reviewed', 'reopened', 'archived', 'restored', 'type_changed',
    'category_changed', 'retry_requested'
  );
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- 2. I due inneschi nuovi del motore delle automazioni
--
-- ⚠️⚠️ LEGGERE PRIMA DI TOCCARE QUESTE DUE RIGHE.
--
-- `alter type … add value` si esegue dentro una transazione, ma l'etichetta NON
-- è utilizzabile finché quella transazione non è chiusa (Postgres 55P04,
-- «unsafe use of new value»). Il SQL editor di Supabase esegue tutto in
-- un'unica transazione, e `full-setup.sql` concatena TUTTE le migrazioni:
-- basta una riga che VALUTI l'etichetta appena aggiunta per far fallire ogni
-- installazione da zero. È successo con la 0015.
--
-- Qui i due valori compaiono altrove nel file, ma SOLTANTO dentro il corpo di
-- `create function`. Un corpo plpgsql viene depositato come TESTO: Postgres non
-- risolve le etichette che vi compaiono finché la funzione non viene chiamata,
-- cioè dopo il commit. Applicare questo file non le valuta mai.
--
-- ⚠️ LA 0020 SI ERA DATA UNA REGOLA PIÙ SEVERA («nemmeno dentro il corpo di una
-- funzione»), e le costava zero: i suoi tre valori nuovi li scrive il worker in
-- TypeScript, non il SQL. Qui non è possibile — un trigger che emette un evento
-- deve per forza nominare il tipo di quell'evento — e la regola va quindi presa
-- per quello che è: una precauzione prudente, non una legge di Postgres.
--
-- `npm run db:bundle` distingue ora i due casi, e la distinzione è messa alla
-- prova in ENTRAMBE le direzioni (`npm run db:bundle -- --self-test`): un
-- valore nuovo dentro un corpo di funzione passa, lo stesso valore in un indice
-- parziale, in un `insert` o in un blocco `do $$` continua a far fallire.
--
-- ⚠️ CIÒ CHE IL CONTROLLO NON PUÒ VEDERE: un blocco `do $$` che CHIAMA una
-- funzione il cui corpo nomina l'etichetta la valuterebbe comunque. Nessun
-- blocco `do $$` di questo file lo fa, e il blocco di autoverifica in fondo lo
-- rispetta deliberatamente.
--
-- ⚠️ RESTA UNA COSA DA VERIFICARE SUL DATABASE VERO, e non è verificabile qui:
-- che l'applicazione della 0021 non sollevi 55P04. `npm run test:finance`
-- controlla, subito dopo, che le due etichette esistano e che la catena
-- innesco → evento → regola funzioni davvero.
--
-- Entità: `document`. NON `finance_item`, e non per pigrizia — `automation_events`
-- e `workflow_runs` hanno un `check (entity_type in ('document','email_message',
-- 'task'))`, e un'entità nuova andrebbe cambiata in sei punti coordinati.
-- È anche la scelta giusta nel merito: una fattura è una LETTURA di un
-- documento, e una regola che parla di fatture vuole poter guardare anche la
-- categoria, il mittente e la scadenza di quel documento.
-- ---------------------------------------------------------------------------
alter type public.automation_event_type add value if not exists 'finance_item_ready';
alter type public.automation_event_type add value if not exists 'finance_item_needs_review';


-- ---------------------------------------------------------------------------
-- 3. finance_items — LO STATO OPERATIVO
--
-- Che cosa sta qui e che cosa no: qui sta ciò che una PERSONA decide (l'ho
-- verificata, l'ho archiviata, è una spesa di viaggio) e ciò che serve per
-- FILTRARE, ORDINARE e SOMMARE. I FATTI letti dal documento stanno in
-- `finance_extractions`, che è immutabile.
--
-- ⚠️ LE COLONNE `eff_*` SONO UNA PROIEZIONE, NON UNA SECONDA VERITÀ.
-- Le scrive soltanto il trigger `finance_refresh_effective`, ricalcolandole per
-- intero dall'ultima estrazione più le correzioni umane. Il client non ha alcun
-- permesso di scrittura su di esse.
--
-- Perché esistono invece di essere ricomposte in lettura come fa
-- `list_documents`: i totali per valuta (§113) sono un `sum() group by`, e
-- l'ordinamento per scadenza e il riconoscimento dei duplicati hanno bisogno di
-- indici. Su un jsonb ricomposto riga per riga non si indicizza niente e ogni
-- KPI diventerebbe una scansione di tutte le fatture dell'azienda.
-- Il precedente nel progetto è dichiarato: `email_messages.analysis_deadline` è
-- «una COPIA sulla riga del messaggio, tenuta per poter filtrare e ordinare
-- senza join». La differenza fra una proiezione e una seconda verità è che la
-- proiezione si ricalcola da sola e qualcuno lo verifica: lo fa `test:finance`.
-- ---------------------------------------------------------------------------
create table if not exists public.finance_items (
  id                    uuid primary key default gen_random_uuid(),
  company_id            uuid not null references public.companies(id) on delete cascade,
  -- Il legame forte con il documento. `on delete cascade`: se il documento
  -- sparisce non deve restare una fattura che rimanda al nulla (§90/§91).
  document_id           uuid not null references public.documents(id) on delete cascade,

  type                  public.finance_item_type not null,
  processing_status     public.finance_processing_status not null default 'pending',
  review_status         public.finance_review_status not null default 'needs_review',
  origin                public.finance_origin not null default 'rule',

  -- L'ultima estrazione RIUSCITA. La chiave esterna verso `finance_extractions`
  -- si aggiunge più sotto, quando quella tabella esiste: qui non si può.
  current_extraction_id uuid,
  extraction_attempts   integer not null default 0,
  error_code            text,

  -- Organizzazione, modificabile liberamente da una persona.
  expense_category      public.finance_expense_category,
  expense_category_set_by uuid references auth.users(id) on delete set null,
  expense_category_set_at timestamptz,
  payment_method        public.finance_payment_method,

  quality_flags         public.finance_quality_flag[] not null default '{}',

  reviewed_at           timestamptz,
  reviewed_by           uuid references auth.users(id) on delete set null,
  archived_at           timestamptz,
  archived_by           uuid references auth.users(id) on delete set null,

  created_by            uuid references auth.users(id) on delete set null,
  -- Valorizzato SOLO se l'elemento nasce lungo una catena causale prodotta da
  -- una regola aziendale. È il filo che impedisce a una catena di girare su sé
  -- stessa: senza, l'evento emesso da qui aprirebbe una catena NUOVA.
  workflow_run_id       uuid references public.workflow_runs(id) on delete set null,

  -- ---- PROIEZIONE (vedi sopra) --------------------------------------------
  eff_supplier_name     text,
  eff_supplier_norm     text,
  eff_invoice_number    text,
  eff_invoice_number_norm text,
  eff_invoice_date      date,
  eff_due_date          date,
  eff_currency          text,
  eff_gross_amount      numeric,
  eff_net_amount        numeric,
  eff_vat_amount        numeric,
  eff_iban              text,
  eff_reference_type    public.finance_reference_type,
  eff_payment_reference text,
  eff_merchant          text,
  eff_expense_date      date,
  -- Impronta per il duplicato SOSPETTO: fornitore normalizzato, numero
  -- normalizzato, importo lordo, valuta. `null` quando manca un pezzo — e in
  -- quel caso non si sospetta niente, perché sospettare su due campi su quattro
  -- produrrebbe accuse a caso.
  dup_key               text,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  -- §6 — in V1 un documento produce AL PIÙ un elemento finanziario. Se un
  -- giorno servisse spezzare un PDF con dieci fatture dentro, questo vincolo è
  -- il punto in cui la decisione andrà presa esplicitamente.
  constraint uq_finance_items_document unique (company_id, document_id),
  -- Una fattura verificata deve avere un'estrazione: «pronta» senza dati letti
  -- sarebbe una dichiarazione a vuoto.
  constraint finance_ready_needs_extraction
    check (review_status <> 'ready' or current_extraction_id is not null)
);

comment on table public.finance_items is
  'Stato operativo di un documento finanziario. I FATTI stanno in '
  'finance_extractions (immutabile) e in finance_corrections; le colonne eff_* '
  'sono una proiezione ricalcolata dal trigger, non una seconda verità.';
comment on column public.finance_items.dup_key is
  'Impronta per il duplicato sospetto. NULL quando i dati non bastano: un '
  'sospetto su informazioni parziali è un''accusa a caso.';
comment on column public.finance_items.quality_flags is
  'Che cosa non torna. Chiavi, non frasi: la frase la scrive l''interfaccia.';


-- ---------------------------------------------------------------------------
-- 4. finance_extractions — IL VERBALE, IMMUTABILE E VERSIONATO
--
-- Stessa disciplina di `document_analyses` dalla 0010: uno snapshot non si
-- corregge, si affianca. Un secondo tentativo produce la versione 2 e la 1
-- resta leggibile — è ciò che permette di rispondere a «prima diceva un altro
-- importo?» con un fatto invece che con un'impressione.
--
-- La CORREZIONE UMANA non tocca questa tabella: vive in `finance_corrections`
-- e vince in lettura (§11). Il valore originariamente letto resta sempre
-- visibile nel dettaglio.
-- ---------------------------------------------------------------------------
create table if not exists public.finance_extractions (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  finance_item_id    uuid not null references public.finance_items(id) on delete cascade,
  document_id        uuid not null references public.documents(id) on delete cascade,
  extraction_version integer not null default 1,
  status             public.finance_extraction_status not null default 'completed',

  -- Come è stato ottenuto il verbale nel suo insieme. Il dettaglio campo per
  -- campo sta in `field_sources`: un'estrazione «ibrida» è la norma, non
  -- l'eccezione — l'IBAN dal codice, il fornitore dal testo, l'IVA dal modello.
  method             text not null default 'ai',
  provider           text,
  model              text,
  prompt_version     text,
  schema_version     integer not null default 1,

  -- ---- I fatti della fattura ----------------------------------------------
  invoice_number     text,
  supplier_name      text,
  supplier_address   text,
  supplier_vat_id    text,          -- IDI/UID, quando presente e valido
  supplier_country   text,
  invoice_date       date,
  due_date           date,
  currency           text,
  -- `numeric` SENZA precisione dichiarata: esatto e senza arrotondamenti
  -- imposti dallo schema. Un `numeric(18,2)` arrotonderebbe IN SILENZIO un
  -- importo con tre decimali, che è esattamente il tipo di modifica invisibile
  -- che questo progetto non fa (§48).
  gross_amount       numeric,
  net_amount         numeric,
  vat_amount         numeric,
  -- [{ "rate": 8.1, "taxableBase": "100.00", "taxAmount": "8.10", "source": "ai" }]
  -- Gli importi sono STRINGHE decimali: passare da un numero JSON
  -- significherebbe farli transitare per un double (§48).
  vat_breakdown      jsonb not null default '[]'::jsonb,

  -- ---- Dati di pagamento ---------------------------------------------------
  -- ⚠️ Si conservano perché servono a PREPARARE il pagamento, che una persona
  -- eseguirà altrove. Non esiste, e non deve esistere, alcun percorso che li
  -- trasformi in un ordine (§43/§123).
  creditor_iban      text,
  iban_is_qr         boolean,       -- QR-IBAN (QR-IID 30000–31999): non è un
                                    -- formato diverso, è un istituto diverso,
                                    -- e determina quale riferimento è ammesso
  reference_type     public.finance_reference_type,
  payment_reference  text,

  -- ---- Codice QR svizzero --------------------------------------------------
  qr_present         boolean not null default false,
  qr_valid           boolean,
  qr_spec_version    text,          -- la versione dichiarata DAL codice letto
  qr_errors          text[] not null default '{}',

  -- ---- Ricevute / spese ----------------------------------------------------
  merchant           text,
  expense_date       date,
  payment_method_detected public.finance_payment_method,

  -- ---- Provenienza, fiducia, citazioni, incertezze -------------------------
  field_sources      jsonb not null default '{}'::jsonb,  -- campo → qr|deterministic|ai
  field_confidence   jsonb not null default '{}'::jsonb,  -- campo → 0..1 (§67)
  evidence           jsonb not null default '{}'::jsonb,  -- campo → {quote,start,end,page}
  uncertainties      jsonb not null default '[]'::jsonb,
  quality_flags      public.finance_quality_flag[] not null default '{}',
  document_language  text,

  error_code         text,
  input_tokens       integer,
  output_tokens      integer,
  duration_ms        integer,
  created_at         timestamptz not null default now(),

  constraint uq_finance_extraction_version unique (finance_item_id, extraction_version)
);

-- ⚠️ Il collegamento all'estrazione corrente si dichiara QUI e non nella
-- definizione di `finance_items`: le due tabelle si riferiscono a vicenda, e
-- alla creazione della prima la seconda non esiste ancora. `set null` e non
-- `cascade`: se un giorno si potassero i verbali vecchi, l'elemento operativo
-- deve sopravvivere alla potatura, non sparire con essa.
do $$ begin
  alter table public.finance_items
    add constraint finance_items_current_extraction_fkey
    foreign key (current_extraction_id) references public.finance_extractions(id)
    on delete set null;
exception when duplicate_object then null; end $$;

comment on table public.finance_extractions is
  'Verbale IMMUTABILE della lettura finanziaria di un documento. Un nuovo '
  'tentativo produce una versione nuova; le correzioni umane vivono altrove.';
comment on column public.finance_extractions.field_sources is
  'Da dove viene ogni campo: qr | deterministic | ai. Mescolare le origini '
  'toglierebbe a chi verifica l''unica cosa che gli serve sapere.';


-- ---------------------------------------------------------------------------
-- 5. finance_corrections — LE CORREZIONI UMANE, IN AGGIUNTA
--
-- ⚠️ PERCHÉ NON SI RIUSA `analysis_corrections`, e non è una preferenza di
-- stile. `list_documents` (0017) aggrega TUTTE le correzioni di un documento in
-- una mappa `jsonb_object_agg(field, corrected_value)` e poi fa
-- `coalesce(corrections->>'amount', a_amount)`. Una correzione finanziaria
-- salvata là con `field = 'amount'` cambierebbe l'importo che il Document Hub
-- mostra per quel documento — un campo che descrive l'analisi amministrativa,
-- non la fattura. Lo stesso vale per `deadline` (termine del documento) contro
-- `due_date` (scadenza di pagamento), che il capitolato vuole esplicitamente
-- distinti e confrontabili fra loro.
--
-- Append-only: si aggiunge, non si riscrive. L'ordine cronologico decide, e
-- l'ultima correzione di un campo vince.
-- ---------------------------------------------------------------------------
create table if not exists public.finance_corrections (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  finance_item_id uuid not null references public.finance_items(id) on delete cascade,
  document_id     uuid not null references public.documents(id) on delete cascade,
  -- Quale verbale era in vigore quando la persona ha corretto. Serve a
  -- distinguere «ha corretto ciò che vedeva» da «ha corretto una versione
  -- precedente»: `set null` perché la correzione sopravvive comunque.
  extraction_id   uuid references public.finance_extractions(id) on delete set null,
  field           text not null,
  original_value  jsonb,
  corrected_value jsonb,
  corrected_by    uuid references auth.users(id) on delete set null,
  corrected_at    timestamptz not null default now(),

  -- I campi correggibili sono un elenco CHIUSO (§152). Un campo fuori elenco
  -- non è «un campo che non conosciamo»: è una scrittura che non deve avvenire,
  -- perché la proiezione non saprebbe che farsene e il dato resterebbe invisibile.
  constraint finance_correction_field_known check (field in (
    'supplier_name', 'supplier_vat_id', 'supplier_address',
    'invoice_number', 'invoice_date', 'due_date',
    'currency', 'gross_amount', 'net_amount', 'vat_amount',
    'creditor_iban', 'payment_reference', 'reference_type',
    'merchant', 'expense_date'
  ))
);

comment on table public.finance_corrections is
  'Correzioni umane, append-only. NON riusa analysis_corrections: là il campo '
  '«amount» descrive l''analisi amministrativa del documento, e scriverci un '
  'importo di fattura cambierebbe ciò che il Document Hub mostra.';


-- ---------------------------------------------------------------------------
-- 6. finance_events — LO STORICO
--
-- Lo scrivono i trigger. Il client non può inserirlo: uno storico che una
-- schermata può fabbricare non è uno storico. Non si registra la lettura: §87
-- chiede espressamente di non tracciare ogni visualizzazione.
-- ---------------------------------------------------------------------------
create table if not exists public.finance_events (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  finance_item_id uuid not null references public.finance_items(id) on delete cascade,
  actor_user_id   uuid references auth.users(id) on delete set null,
  kind            public.finance_event_kind not null,
  detail          jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);


-- ---------------------------------------------------------------------------
-- 7. finance_vat_rates — LE ALIQUOTE COME DATO, NON COME CODICE
--
-- §53: le aliquote ufficiali sono una configurazione aggiornata e versionata,
-- non una costante dentro un componente. Un'aliquota cambia per decisione
-- politica, e il giorno in cui cambierà nessuno dovrà ricompilare niente.
--
-- ⚠️ SONO SUGGERIMENTI, NON UN VALIDATORE. Un'aliquota che non compare qui —
-- una fattura del 2023, una fattura estera — è perfettamente valida e viene
-- accettata così com'è. §52 lo dice esplicitamente: non si trattano le aliquote
-- svizzere correnti come gli unici valori ammessi.
--
-- ⚠️ Le aliquote STORICHE non sono state seminate perché non sono state
-- verificate su una fonte primaria in questa sessione: la pagina dell'AFC che
-- le elenca non era leggibile. Seminarle a memoria avrebbe messo nel database
-- dei numeri fiscali non verificati, che è peggio di non averli.
-- ---------------------------------------------------------------------------
create table if not exists public.finance_vat_rates (
  id            uuid primary key default gen_random_uuid(),
  country_code  text not null,
  kind          text not null,        -- standard | reduced | special
  rate          numeric not null,
  valid_from    date not null,
  valid_to      date,
  source_url    text not null,
  source_title  text,
  checked_at    date not null,
  created_at    timestamptz not null default now(),
  constraint uq_vat_rate unique (country_code, kind, valid_from)
);

insert into public.finance_vat_rates (country_code, kind, rate, valid_from, valid_to, source_url, source_title, checked_at)
values
  ('CH', 'standard', 8.1, date '2024-01-01', null,
   'https://www.estv.admin.ch/estv/de/home/mehrwertsteuer/mwst-steuersaetze.html',
   'Eidgenössische Steuerverwaltung — Schweizer Mehrwertsteuersätze', date '2026-07-27'),
  ('CH', 'reduced', 2.6, date '2024-01-01', null,
   'https://www.estv.admin.ch/estv/de/home/mehrwertsteuer/mwst-steuersaetze.html',
   'Eidgenössische Steuerverwaltung — Schweizer Mehrwertsteuersätze', date '2026-07-27'),
  ('CH', 'special', 3.8, date '2024-01-01', null,
   'https://www.estv.admin.ch/estv/de/home/mehrwertsteuer/mwst-steuersaetze.html',
   'Eidgenössische Steuerverwaltung — Schweizer Mehrwertsteuersätze', date '2026-07-27')
on conflict (country_code, kind, valid_from) do nothing;

comment on table public.finance_vat_rates is
  'Aliquote IVA ufficiali con validità e fonte. Sono SUGGERIMENTI per la '
  'correzione manuale: un''aliquota fuori elenco è accettata, non rifiutata.';


-- ---------------------------------------------------------------------------
-- 8. Indici
--
-- Ognuno corrisponde a una clausola che le funzioni di questo file scrivono
-- davvero. Nessun indice «per sicurezza»: un indice che nessuna query usa è
-- solo scrittura più lenta.
-- ---------------------------------------------------------------------------

-- La lista predefinita: elementi non archiviati di un'azienda, per tipo.
create index if not exists idx_finance_active
  on public.finance_items (company_id, type, created_at desc)
  where archived_at is null;

-- «Che cosa scade nei prossimi sette giorni» e «che cosa è già scaduto»: sono
-- i due numeri della dashboard, e girano su ogni caricamento della pagina.
create index if not exists idx_finance_due
  on public.finance_items (company_id, eff_due_date)
  where archived_at is null;

-- «Che cosa devo ancora verificare»: il primo KPI e il filtro rapido.
create index if not exists idx_finance_review
  on public.finance_items (company_id, review_status)
  where archived_at is null;

-- La coda del worker: quali elementi aspettano di essere letti.
create index if not exists idx_finance_pending
  on public.finance_items (processing_status, created_at)
  where processing_status in ('pending', 'processing');

-- Il duplicato sospetto: si cercano gli altri elementi con la stessa impronta
-- NELLA STESSA AZIENDA. Senza indice sarebbe una scansione per ogni riga della
-- lista.
create index if not exists idx_finance_dup
  on public.finance_items (company_id, dup_key)
  where dup_key is not null and archived_at is null;

-- Ricerca per fornitore e per numero di fattura (§26), sulla forma normalizzata.
create index if not exists idx_finance_supplier
  on public.finance_items (company_id, eff_supplier_norm);
create index if not exists idx_finance_invoice_no
  on public.finance_items (company_id, eff_invoice_number_norm);

-- Dal documento all'elemento finanziario: lo chiede il dettaglio del documento.
create index if not exists idx_finance_document
  on public.finance_items (document_id);

create index if not exists idx_finance_extractions_item
  on public.finance_extractions (finance_item_id, extraction_version desc);
create index if not exists idx_finance_corrections_item
  on public.finance_corrections (finance_item_id, corrected_at);
create index if not exists idx_finance_events_item
  on public.finance_events (finance_item_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 9. Normalizzazione per il confronto
--
-- ⚠️ NORMALIZZARE NON È RIPULIRE. Queste funzioni producono una chiave di
-- CONFRONTO; il valore mostrato all'utente resta quello letto. «Swisscom (Svizzera) SA»
-- si mostra così com'è, e si confronta come «swisscom svizzera sa».
--
-- §157 avverte di non rimuovere caratteri significativi con leggerezza: in un
-- numero di fattura il trattino può separare l'anno dal progressivo, e togliere
-- tutto renderebbe «2026-1» uguale a «20261». Qui si tolgono solo spazi e
-- punteggiatura di contorno, non le cifre né le lettere.
-- ---------------------------------------------------------------------------
create or replace function public.finance_norm_supplier(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- ⚠️ L'elenco delle lettere accentate è COMPLETO per le lingue che il prodotto
  -- incontra. Una versione parziale sarebbe peggio di nessuna: «é» resterebbe
  -- una lettera e «ê» diventerebbe un separatore, e due grafie dello stesso
  -- nome si normalizzerebbero in modi diversi a seconda dell'accento.
  select nullif(
    btrim(regexp_replace(
      regexp_replace(lower(coalesce(p_name, '')), '[^a-z0-9àáâäèéêëìíîïòóôöùúûüçñ]+', ' ', 'g'),
      '\s+', ' ', 'g')),
    '');
$$;

comment on function public.finance_norm_supplier(text) is
  'Chiave di confronto per il nome di un fornitore. NON è un''identità: '
  '«Swisscom» e «Swisscom SA» restano soggetti diversi finché nessuno dice il '
  'contrario (§32). Serve solo a sospettare un duplicato, mai a fondere.';

create or replace function public.finance_norm_invoice_number(p_number text)
returns text
language sql
immutable
set search_path = ''
as $$
  -- Si tolgono spazi e i separatori di contorno, si tengono lettere e cifre.
  -- «N. 847291», «847291» e «847 291» sono lo stesso numero; «2026-1» e «20261»
  -- restano distinti, perché il trattino lì porta informazione.
  select nullif(upper(regexp_replace(coalesce(p_number, ''), '[\s.#]+', '', 'g')), '');
$$;

-- L'impronta del duplicato sospetto (§70).
-- Torna NULL se manca uno qualsiasi dei quattro elementi: con due campi su
-- quattro il sospetto sarebbe casuale, e un falso sospetto insegna a ignorare
-- i sospetti.
create or replace function public.finance_dup_key(
  p_supplier_norm text,
  p_number_norm   text,
  p_gross         numeric,
  p_currency      text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_supplier_norm is null or p_number_norm is null
      or p_gross is null or p_currency is null then null
    else p_supplier_norm || '|' || p_number_norm || '|'
      || trim(to_char(p_gross, 'FM9999999999999990.0999999')) || '|' || upper(p_currency)
  end;
$$;


-- ---------------------------------------------------------------------------
-- 10. Il classificatore deterministico (§62)
--
-- Nessuna chiamata AI: il documento è GIÀ stato analizzato, e da quell'analisi
-- si capisce se è un documento finanziario. Dove il segnale non basta si torna
-- NULL, e il documento NON entra in Finance — §15: nel dubbio non si crea una
-- fattura certa. Chi vuole comunque metterlo dentro usa «Aggiungi a Finanze»,
-- che è un gesto umano ed esplicito.
--
-- ⚠️ Deliberatamente NON classificati: `payment_request` e `reminder` da enti
-- pubblici. Un sollecito dell'AFC è una richiesta di pagamento, ma non è una
-- fattura fornitore: metterlo fra le fatture da verificare mescolerebbe
-- imposte e acquisti, che è proprio la confusione che il modulo deve evitare.
-- Un sollecito PRIVATO invece riguarda quasi sempre una fattura già ricevuta,
-- e infatti la 0017 lo classifica già nella categoria «Fatture».
-- ---------------------------------------------------------------------------
create or replace function public.finance_type_from_analysis(
  p_document_type  text,
  p_authority_type text
)
returns public.finance_item_type
language sql
immutable
set search_path = ''
as $$
  select case
    -- Il segnale più forte: l'analisi dice che è una fattura.
    when p_document_type = 'invoice' then 'supplier_invoice'::public.finance_item_type
    -- Una richiesta di pagamento da un privato è una fattura fornitore.
    when p_document_type = 'payment_request' and p_authority_type = 'private'
      then 'supplier_invoice'::public.finance_item_type
    -- Un sollecito da un privato riguarda una fattura: si tratta come tale, e
    -- la verifica umana dirà se è un doppione di una già registrata.
    when p_document_type = 'reminder' and p_authority_type = 'private'
      then 'supplier_invoice'::public.finance_item_type
    else null
  end;
$$;

comment on function public.finance_type_from_analysis(text, text) is
  'Tipo finanziario dedotto dall''analisi. NULL quando il segnale non basta: '
  'un documento fuori da Finance è un fatto, una fattura inventata è un errore '
  'che qualcuno tratterà come vero.';


-- ---------------------------------------------------------------------------
-- 11. La cifra di controllo dell'IBAN, in SQL
--
-- ⚠️ È UN DOPPIONE DICHIARATO di `checkIban()` in
-- `supabase/functions/_shared/finance/checksums.ts`, e lo è per una ragione che
-- vale la pena scrivere: quando una PERSONA corregge a mano un IBAN (§152/§153,
-- il campo a rischio più alto del modulo), la correzione entra dal client e la
-- bandiera `invalid_iban` va RICALCOLATA. Farlo chiamando il TypeScript
-- vorrebbe dire far ripartire il worker — e quindi una chiamata AI a pagamento —
-- per una modifica che una persona ha già fatto a mano.
--
-- ⚠️ E COME PER `urgencyFrom` DELLE AUTOMAZIONI, LA COPIA NON È LASCIATA ALLA
-- BUONA FEDE: `test:finance` confronta questa funzione con quella TypeScript su
-- una matrice di IBAN validi e non validi, e fallisce se divergono su un caso.
-- ---------------------------------------------------------------------------
create or replace function public.finance_iban_valid(p_iban text)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_clean     text;
  v_rearr     text;
  v_digits    text := '';
  v_ch        text;
  v_remainder integer := 0;
  i           integer;
begin
  v_clean := upper(regexp_replace(coalesce(p_iban, ''), '[\s\-.]', '', 'g'));
  if v_clean !~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]+$' then return false; end if;
  if length(v_clean) < 15 or length(v_clean) > 34 then return false; end if;

  -- Le lunghezze note per paese: dove non si conosce il valore ufficiale non si
  -- inventa un limite, si verifica solo la cifra di controllo.
  if left(v_clean, 2) in ('CH', 'LI') and length(v_clean) <> 21 then return false; end if;
  if left(v_clean, 2) = 'DE' and length(v_clean) <> 22 then return false; end if;
  if left(v_clean, 2) = 'AT' and length(v_clean) <> 20 then return false; end if;
  if left(v_clean, 2) in ('FR', 'IT') and length(v_clean) <> 27 then return false; end if;

  v_rearr := substr(v_clean, 5) || left(v_clean, 4);
  for i in 1 .. length(v_rearr) loop
    v_ch := substr(v_rearr, i, 1);
    if v_ch ~ '[0-9]' then
      v_digits := v_digits || v_ch;
    else
      v_digits := v_digits || (ascii(v_ch) - 55)::text;
    end if;
  end loop;

  -- Modulo 97 a blocchi: il numero intero supererebbe qualunque tipo numerico.
  for i in 1 .. ceil(length(v_digits) / 7.0)::integer loop
    v_remainder := (v_remainder::text || substr(v_digits, (i - 1) * 7 + 1, 7))::bigint % 97;
  end loop;

  return v_remainder = 1;
end $$;

comment on function public.finance_iban_valid(text) is
  'Cifra di controllo IBAN (ISO 7064 MOD 97-10). Doppione DICHIARATO di '
  'checkIban() in _shared/finance/checksums.ts, confrontato dal test. Dice che '
  'il numero è trascritto bene, NON che il conto esista o sia del fornitore.';


-- ---------------------------------------------------------------------------
-- 12. Il guardiano di `finance_items`
--
-- Chi ha verificato, chi ha archiviato, chi ha scelto la categoria di spesa e
-- quando: lo scrive il database da `auth.uid()` e `now()`, mai il client (§85/§94).
-- Il client dichiara l'INTENZIONE — mette un `archived_at` qualsiasi — e il
-- valore vero lo mette qui.
--
-- Il worker gira con il service role e senza utente: `auth.uid()` è NULL, ed è
-- giusto che `reviewed_by` resti NULL invece di essere attribuito a qualcuno.
-- Attribuire a una persona un'azione della macchina è un dato inventato.
-- ---------------------------------------------------------------------------
create or replace function public.finance_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    -- Il documento deve essere dell'azienda dichiarata. La RLS lo impedirebbe
    -- comunque dal client, ma questa funzione è `security definer` e deve
    -- difendersi da sola: è la disciplina della 0017.
    if not exists (
      select 1 from public.documents d
      where d.id = new.document_id and d.company_id = new.company_id
    ) then
      raise exception 'finance_document_company_mismatch'
        using errcode = '23514',
              hint = 'Il documento non appartiene all''azienda indicata.';
    end if;

    new.created_by := auth.uid();

    -- ⚠️ CHI HA DECISO CHE QUESTO DOCUMENTO È UNA FATTURA lo stabilisce il
    -- database, non chi scrive. Il client non ha il permesso di colonna su
    -- `origin`, quindi un inserimento dall'interfaccia prenderebbe il valore
    -- predefinito `rule` — e l'elemento direbbe di essere stato riconosciuto
    -- dalla regola quando invece l'ha aggiunto una persona con «Aggiungi a
    -- Finanze». Sarebbe una provenienza falsa proprio sul campo che serve a
    -- distinguere le due cose.
    --
    -- La distinzione sistema/persona è la stessa di `documents_guard`:
    -- `auth.uid()` da solo non basta, perché in modalità deterministica è il
    -- BROWSER a inserire l'analisi, e la classificazione automatica che ne
    -- deriva scatta quindi con un utente in sessione. `pg_trigger_depth() > 1`
    -- dice che a scrivere è stato un trigger, cioè il prodotto.
    if auth.uid() is not null and pg_trigger_depth() <= 1 then
      new.origin := 'manual';
    end if;
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.archived_by := null;
    if new.archived_at is not null then new.archived_at := now(); end if;
    new.created_at := now();
    new.updated_at := now();
    return new;
  end if;

  -- ---- UPDATE ------------------------------------------------------------
  new.company_id  := old.company_id;
  new.document_id := old.document_id;
  new.created_by  := old.created_by;
  new.created_at  := old.created_at;
  new.updated_at  := now();

  -- Verifica: il timbro si scrive alla transizione, e non si riscrive se lo
  -- stato non cambia. Riaprire cancella il timbro, perché non è più vero che
  -- qualcuno l'abbia verificata.
  if new.review_status is distinct from old.review_status then
    if new.review_status = 'ready' then
      new.reviewed_at := now();
      new.reviewed_by := auth.uid();
    else
      new.reviewed_at := null;
      new.reviewed_by := null;
    end if;
  else
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
  end if;

  -- Archiviazione: solo alla PRIMA, come su `documents`.
  if new.archived_at is not null and old.archived_at is null then
    new.archived_at := now();
    new.archived_by := auth.uid();
  elsif new.archived_at is null then
    new.archived_by := null;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  if new.expense_category is distinct from old.expense_category then
    new.expense_category_set_by := auth.uid();
    new.expense_category_set_at := now();
  else
    new.expense_category_set_by := old.expense_category_set_by;
    new.expense_category_set_at := old.expense_category_set_at;
  end if;

  -- ⚠️ La PROIEZIONE non è scrivibile da nessun percorso applicativo: la
  -- ricalcola `finance_refresh_effective`. Un update che la toccasse — anche
  -- per sbaglio, anche dal service role — viene annullato qui.
  --
  -- ⚠️ LA SENTINELLA È ESPLICITA E NON `pg_trigger_depth()`.
  -- La prima versione confrontava la profondità dei trigger, dando per scontato
  -- che il ricalcolo arrivasse sempre da un altro trigger. Ma
  -- `finance_refresh_effective` è chiamabile anche direttamente — dal worker
  -- con il service role, o da uno script di ripopolamento — e in quel caso il
  -- suo UPDATE fa scattare questo guardiano a profondità 1: la condizione
  -- sarebbe vera e la proiezione appena calcolata verrebbe RIMESSA COM'ERA,
  -- riga per riga, senza alcun errore. I totali della dashboard resterebbero
  -- vuoti e nessuno saprebbe perché. Una sentinella che dipende da COME si
  -- arriva a una funzione, invece che da CHE COSA la funzione sta facendo, è
  -- un difetto in attesa del primo chiamante diverso.
  if coalesce(current_setting('ai_swisse.finance_refresh', true), '') <> '1' then
    new.eff_supplier_name       := old.eff_supplier_name;
    new.eff_supplier_norm       := old.eff_supplier_norm;
    new.eff_invoice_number      := old.eff_invoice_number;
    new.eff_invoice_number_norm := old.eff_invoice_number_norm;
    new.eff_invoice_date        := old.eff_invoice_date;
    new.eff_due_date            := old.eff_due_date;
    new.eff_currency            := old.eff_currency;
    new.eff_gross_amount        := old.eff_gross_amount;
    new.eff_net_amount          := old.eff_net_amount;
    new.eff_vat_amount          := old.eff_vat_amount;
    new.eff_iban                := old.eff_iban;
    new.eff_reference_type      := old.eff_reference_type;
    new.eff_payment_reference   := old.eff_payment_reference;
    new.eff_merchant            := old.eff_merchant;
    new.eff_expense_date        := old.eff_expense_date;
    new.dup_key                 := old.dup_key;
    new.quality_flags           := old.quality_flags;
  end if;

  -- Rimettere in coda è un'azione legittima («Riprova estrazione», §111) e non
  -- richiede una Edge Function: il worker periodico la raccoglie. Ma si può
  -- ripartire solo da uno stato FERMO — rimettere in coda qualcosa che è già in
  -- lavorazione produrrebbe due estrazioni concorrenti sullo stesso documento.
  if new.processing_status = 'pending' and old.processing_status = 'processing' then
    new.processing_status := old.processing_status;
  end if;

  return new;
end $$;

drop trigger if exists trg_finance_items_guard on public.finance_items;
create trigger trg_finance_items_guard
  before insert or update on public.finance_items
  for each row execute function public.finance_items_guard();


-- ---------------------------------------------------------------------------
-- 13. La proiezione dei valori effettivi
--
-- Ricalcola `eff_*`, `dup_key` e le bandiere che dipendono dai valori
-- effettivi, a partire da: ultima estrazione riuscita + tutte le correzioni
-- umane in ordine cronologico (l'ultima di ogni campo vince). È la stessa
-- regola di `list_documents`, e averne una sola è il motivo per cui due
-- schermate non possono dire due importi diversi sulla stessa fattura.
--
-- ⚠️ QUALI BANDIERE SI RICALCOLANO QUI E QUALI NO, e perché.
--   · si RICALCOLANO quelle che sono un confronto fra valori effettivi:
--     importi che non tornano, scadenza prima della fattura, dati mancanti,
--     IBAN che non supera la cifra di controllo, duplicato sospetto.
--     Sono aritmetica e confronti, non algoritmi da duplicare, e devono
--     cambiare quando una persona corregge il dato.
--   · si CONSERVANO dall'estrazione quelle che descrivono COME è andata la
--     lettura: il codice QR in disaccordo col testo, la trascrizione poco
--     leggibile, la data ambigua, il codice QR non decodificato. Nessuna
--     correzione umana le rende false, e cancellarle significherebbe far
--     sparire la ragione per cui qualcuno deve guardare il documento.
-- ---------------------------------------------------------------------------
create or replace function public.finance_refresh_effective(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item    record;
  v_ex      record;
  v_corr    jsonb := '{}'::jsonb;
  v_flags   public.finance_quality_flag[] := '{}';
  v_keep    public.finance_quality_flag[];
  v_supplier text; v_number text; v_currency text;
  v_gross numeric; v_net numeric; v_vat numeric;
  v_invoice_date date; v_due_date date; v_expense_date date;
  v_iban text; v_reference text; v_ref_type public.finance_reference_type;
  v_merchant text;
  v_supplier_norm text; v_number_norm text; v_dup text;
  v_tolerance numeric;
  v_vat_lines integer;
  v_analysis_deadline date;
begin
  select * into v_item from public.finance_items where id = p_item_id;
  if v_item.id is null then return; end if;

  select * into v_ex from public.finance_extractions
   where id = v_item.current_extraction_id and company_id = v_item.company_id;

  -- Le correzioni, in ordine: l'ultima di ogni campo vince.
  select coalesce(jsonb_object_agg(c.field, c.corrected_value), '{}'::jsonb)
    into v_corr
    from (
      select c2.field, c2.corrected_value
        from public.finance_corrections c2
       where c2.finance_item_id = p_item_id and c2.company_id = v_item.company_id
       order by c2.corrected_at asc
    ) c;

  -- ⚠️ `try_date` / `try_numeric` (0017) e non un cast diretto: una correzione
  -- malformata farebbe fallire l'intero ricalcolo, e con esso ogni scrittura
  -- sulla fattura. Il guardiano delle correzioni rifiuta già i valori non
  -- convertibili, quindi qui non dovrebbero arrivarne — ma «non dovrebbero» non
  -- è una garanzia, e il costo di questa difesa è nullo.
  v_supplier      := coalesce(v_corr ->> 'supplier_name', v_ex.supplier_name);
  v_number        := coalesce(v_corr ->> 'invoice_number', v_ex.invoice_number);
  v_currency      := upper(coalesce(v_corr ->> 'currency', v_ex.currency));
  v_gross         := coalesce(public.try_numeric(v_corr ->> 'gross_amount'), v_ex.gross_amount);
  v_net           := coalesce(public.try_numeric(v_corr ->> 'net_amount'), v_ex.net_amount);
  v_vat           := coalesce(public.try_numeric(v_corr ->> 'vat_amount'), v_ex.vat_amount);
  v_invoice_date  := coalesce(public.try_date(v_corr ->> 'invoice_date'), v_ex.invoice_date);
  v_due_date      := coalesce(public.try_date(v_corr ->> 'due_date'), v_ex.due_date);
  v_expense_date  := coalesce(public.try_date(v_corr ->> 'expense_date'), v_ex.expense_date);
  v_iban          := upper(regexp_replace(
                       coalesce(v_corr ->> 'creditor_iban', v_ex.creditor_iban, ''), '[\s\-.]', '', 'g'));
  v_iban          := nullif(v_iban, '');
  v_reference     := coalesce(v_corr ->> 'payment_reference', v_ex.payment_reference);
  v_merchant      := coalesce(v_corr ->> 'merchant', v_ex.merchant);
  v_ref_type      := coalesce(
                       (case when v_corr ? 'reference_type'
                             and (v_corr ->> 'reference_type') in ('qrr', 'scor', 'non')
                             then (v_corr ->> 'reference_type')::public.finance_reference_type end),
                       v_ex.reference_type);

  v_supplier_norm := public.finance_norm_supplier(v_supplier);
  v_number_norm   := public.finance_norm_invoice_number(v_number);
  v_dup           := public.finance_dup_key(v_supplier_norm, v_number_norm, v_gross, v_currency);

  -- ---- Bandiere conservate dall'estrazione --------------------------------
  v_keep := coalesce(v_ex.quality_flags, '{}');
  v_flags := array(
    select f from unnest(v_keep) f
     where f in ('qr_text_mismatch', 'low_ocr_confidence', 'ambiguous_date',
                 'qr_not_read', 'vat_mismatch')
  );

  -- ---- Bandiere ricalcolate ------------------------------------------------
  if v_gross is null then v_flags := v_flags || 'missing_total'::public.finance_quality_flag; end if;
  if v_currency is null then v_flags := v_flags || 'missing_currency'::public.finance_quality_flag; end if;
  if v_supplier_norm is null and v_merchant is null then
    v_flags := v_flags || 'missing_supplier'::public.finance_quality_flag;
  end if;

  -- Coerenza degli importi. La tolleranza è di un centesimo per aliquota:
  -- l'arrotondamento di riga è reale e segnalare una fattura corretta
  -- insegnerebbe a ignorare le segnalazioni (§51).
  if v_gross is not null and v_net is not null and v_vat is not null then
    v_vat_lines := greatest(1, least(coalesce(jsonb_array_length(v_ex.vat_breakdown), 1), 10));
    v_tolerance := v_vat_lines * 0.01;
    if abs(v_gross - (v_net + v_vat)) > v_tolerance then
      v_flags := v_flags || 'amount_mismatch'::public.finance_quality_flag;
    end if;
  end if;

  -- Un importo negativo su una fattura non è una fattura: è una nota di
  -- credito che qualcuno ha classificato male.
  if v_gross is not null and v_gross < 0 and v_item.type <> 'credit_note' then
    v_flags := v_flags || 'negative_amount'::public.finance_quality_flag;
  end if;

  -- Scadenza prima della data di fattura: le due date si contraddicono.
  if v_invoice_date is not null and v_due_date is not null and v_due_date < v_invoice_date then
    v_flags := v_flags || 'inconsistent_due_date'::public.finance_quality_flag;
  end if;

  -- §47 — la scadenza letta dall'analisi amministrativa e quella della fattura
  -- descrivono la stessa cosa: se differiscono NON si sceglie in silenzio, si
  -- dichiara l'incoerenza e la decide una persona.
  if v_due_date is not null then
    select a.deadline into v_analysis_deadline
      from public.document_analyses a
     where a.document_id = v_item.document_id and a.company_id = v_item.company_id
       and a.analysis_status <> 'failed'
     order by a.created_at desc limit 1;
    if v_analysis_deadline is not null and v_analysis_deadline <> v_due_date then
      v_flags := v_flags || 'inconsistent_due_date'::public.finance_quality_flag;
    end if;
  end if;

  if v_iban is not null and not public.finance_iban_valid(v_iban) then
    v_flags := v_flags || 'invalid_iban'::public.finance_quality_flag;
  end if;

  -- ⚠️ IL DUPLICATO SOSPETTO NON SI MEMORIZZA, SI CALCOLA.
  -- Una prima versione lo scriveva fra le bandiere e aggiornava anche la
  -- controparte. Ma il sospetto dipende da CHE COSA C'È INTORNO, e cambia senza
  -- che questa riga venga toccata: basta archiviare l'altra fattura, o
  -- correggerne il numero, perché la bandiera memorizzata resti accesa su un
  -- duplicato che non esiste più. Si calcola dove serve — `list_finance_items`
  -- lo aggiunge alle bandiere di ogni riga — e così non può invecchiare.
  -- L'etichetta resta nell'enum perché è il vocabolario con cui l'interfaccia
  -- spiega perché una fattura va guardata.

  -- Da qui il guardiano sa che a scrivere la proiezione è il ricalcolo, e non
  -- la annulla. `true` = valido per la sola transazione corrente: non resta
  -- acceso e non può essere sfruttato da una scrittura successiva.
  perform set_config('ai_swisse.finance_refresh', '1', true);

  update public.finance_items set
    eff_supplier_name       = v_supplier,
    eff_supplier_norm       = v_supplier_norm,
    eff_invoice_number      = v_number,
    eff_invoice_number_norm = v_number_norm,
    eff_invoice_date        = v_invoice_date,
    eff_due_date            = v_due_date,
    eff_currency            = v_currency,
    eff_gross_amount        = v_gross,
    eff_net_amount          = v_net,
    eff_vat_amount          = v_vat,
    eff_iban                = v_iban,
    eff_reference_type      = v_ref_type,
    eff_payment_reference   = v_reference,
    eff_merchant            = v_merchant,
    eff_expense_date        = v_expense_date,
    dup_key                 = v_dup,
    quality_flags           = (select array(select distinct f from unnest(v_flags) f order by f))
  where id = p_item_id;

  perform set_config('ai_swisse.finance_refresh', '0', true);
end $$;

revoke all on function public.finance_refresh_effective(uuid) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 14. Le estrazioni sono IMMUTABILI
--
-- Stessa disciplina della 0010 sulle analisi. Non basta togliere il permesso al
-- client: il divieto vale anche per il service role, perché il worker gira
-- proprio con quello e un giorno qualcuno potrebbe pensare di «aggiornare»
-- un'estrazione invece di scriverne una nuova. Un verbale che si corregge non
-- è un verbale.
-- ---------------------------------------------------------------------------
create or replace function public.finance_extractions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'finance_extraction_immutable'
    using errcode = '42501',
          hint = 'Un''estrazione non si modifica e non si cancella: se ne scrive una versione nuova.';
end $$;

drop trigger if exists trg_finance_extractions_immutable on public.finance_extractions;
create trigger trg_finance_extractions_immutable
  before update or delete on public.finance_extractions
  for each row execute function public.finance_extractions_immutable();


-- ---------------------------------------------------------------------------
-- 15. L'autore di una correzione è chi la scrive
--
-- ⚠️ RIFIUTA, non riscrive in silenzio. È la lezione dei commenti delle
-- attività (0016): la versione precedente sostituiva l'autore con `auth.uid()`
-- e restituiva «inserito». Il risultato era sicuro — nessuna firma falsa è mai
-- finita nel database — ma chi provava a firmare come un collega riceveva una
-- conferma. Un fallback silenzioso resta un fallback silenzioso anche quando il
-- suo esito è innocuo.
-- ---------------------------------------------------------------------------
create or replace function public.finance_corrections_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item record;
begin
  select f.id, f.company_id, f.document_id, f.current_extraction_id
    into v_item
    from public.finance_items f
   where f.id = new.finance_item_id;

  if v_item.id is null or v_item.company_id is distinct from new.company_id then
    raise exception 'finance_correction_company_mismatch'
      using errcode = '23514',
            hint = 'La correzione non appartiene all''azienda dell''elemento finanziario.';
  end if;

  if auth.uid() is not null and new.corrected_by is not null
     and new.corrected_by is distinct from auth.uid() then
    raise exception 'finance_correction_author_mismatch'
      using errcode = '42501',
            hint = 'Una correzione si firma con il proprio nome.';
  end if;

  -- ⚠️ IL VALORE VA VERIFICATO QUI, NON A VALLE.
  -- Il ricalcolo della proiezione converte con `try_date`/`try_numeric`, che
  -- tornano NULL su un testo non convertibile e fanno quindi ripiegare sul
  -- valore dell'estrazione. Conseguenza: una correzione con un valore
  -- malformato verrebbe SALVATA, comparirebbe fra i «campi corretti a mano», e
  -- la schermata continuerebbe a mostrare il valore vecchio — una persona
  -- convinta di aver corretto un importo, e un importo che non è cambiato.
  -- È esattamente il fallback silenzioso che questo progetto non ammette: si
  -- rifiuta all'ingresso, con un codice che l'interfaccia sa tradurre.
  if new.corrected_value is not null and jsonb_typeof(new.corrected_value) <> 'null' then
    if new.field in ('invoice_date', 'due_date', 'expense_date')
       and public.try_date(new.corrected_value #>> '{}') is null then
      raise exception 'finance_correction_bad_date'
        using errcode = '22007', hint = 'La data non è in un formato riconoscibile.';
    end if;
    if new.field in ('gross_amount', 'net_amount', 'vat_amount')
       and public.try_numeric(new.corrected_value #>> '{}') is null then
      raise exception 'finance_correction_bad_amount'
        using errcode = '22P02', hint = 'L''importo non è un numero.';
    end if;
    if new.field = 'currency'
       and upper(new.corrected_value #>> '{}') !~ '^[A-Z]{3}$' then
      raise exception 'finance_correction_bad_currency'
        using errcode = '22P02', hint = 'La valuta è un codice ISO di tre lettere.';
    end if;
    if new.field = 'reference_type'
       and lower(new.corrected_value #>> '{}') not in ('qrr', 'scor', 'non') then
      raise exception 'finance_correction_bad_reference_type'
        using errcode = '22P02', hint = 'Il tipo di riferimento non è previsto.';
    end if;
    -- L'IBAN corretto a mano deve almeno superare la propria cifra di
    -- controllo: è il campo a rischio più alto del modulo (§153), e un IBAN
    -- che non torna è quasi sempre un refuso di trascrizione.
    if new.field = 'creditor_iban'
       and not public.finance_iban_valid(new.corrected_value #>> '{}') then
      raise exception 'finance_correction_bad_iban'
        using errcode = '22P02', hint = 'L''IBAN non supera la cifra di controllo.';
    end if;
  end if;

  new.corrected_by := coalesce(auth.uid(), new.corrected_by);
  new.corrected_at := now();
  -- Il documento e il verbale di riferimento li stabilisce il database: sono
  -- deducibili dall'elemento, e farli dichiarare al client vorrebbe dire
  -- permettergli di agganciare una correzione al documento sbagliato.
  new.document_id  := v_item.document_id;
  new.extraction_id := v_item.current_extraction_id;
  return new;
end $$;

drop trigger if exists trg_finance_corrections_guard on public.finance_corrections;
create trigger trg_finance_corrections_guard
  before insert on public.finance_corrections
  for each row execute function public.finance_corrections_guard();

-- Una correzione non si modifica e non si cancella: append-only.
create or replace function public.finance_corrections_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'finance_correction_append_only'
    using errcode = '42501',
          hint = 'Le correzioni si aggiungono: per cambiare un valore se ne scrive una nuova.';
end $$;

drop trigger if exists trg_finance_corrections_append_only on public.finance_corrections;
create trigger trg_finance_corrections_append_only
  before update or delete on public.finance_corrections
  for each row execute function public.finance_corrections_append_only();


-- ---------------------------------------------------------------------------
-- 16. Il ricalcolo scatta da solo
--
-- Una nuova estrazione o una nuova correzione cambiano i valori effettivi: la
-- proiezione si aggiorna qui, non nel codice applicativo. Farlo dal servizio
-- coprirebbe solo i percorsi a cui qualcuno ha pensato — e i percorsi che
-- scrivono su queste tabelle sono già tre (worker, interfaccia, script).
-- ---------------------------------------------------------------------------
create or replace function public.finance_after_correction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.finance_refresh_effective(new.finance_item_id);
  insert into public.finance_events (company_id, finance_item_id, actor_user_id, kind, detail)
  values (new.company_id, new.finance_item_id, new.corrected_by, 'corrected',
          jsonb_build_object('field', new.field));
  return new;
end $$;

drop trigger if exists trg_finance_after_correction on public.finance_corrections;
create trigger trg_finance_after_correction
  after insert on public.finance_corrections
  for each row execute function public.finance_after_correction();

create or replace function public.finance_after_extraction()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Solo un'estrazione RIUSCITA diventa quella corrente: un tentativo fallito
  -- non deve sostituire un verbale buono precedente. È la stessa regola di
  -- `markFailed()` per le analisi.
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
    -- alcuna riga: l'elemento resta in coda e si ritenta. Se lo stato finale lo
    -- scrivesse il worker, ci sarebbero due posti in cui ricordarsene, e il
    -- giorno in cui uno dei due dimentica l'elemento resterebbe «in
    -- lavorazione» per sempre — indistinguibile da un lavoro in corso.
    update public.finance_items
       set processing_status = 'failed',
           error_code = new.error_code
     where id = new.finance_item_id;
  end if;

  insert into public.finance_events (company_id, finance_item_id, actor_user_id, kind, detail)
  values (new.company_id, new.finance_item_id, null,
          case when new.status = 'completed' then 'extraction_completed'
               else 'extraction_failed' end,
          jsonb_build_object('version', new.extraction_version, 'method', new.method));
  return new;
end $$;

drop trigger if exists trg_finance_after_extraction on public.finance_extractions;
create trigger trg_finance_after_extraction
  after insert on public.finance_extractions
  for each row execute function public.finance_after_extraction();


-- ---------------------------------------------------------------------------
-- 17. Lo storico degli stati
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
            case when new.review_status = 'ready' then 'reviewed' else 'reopened' end, '{}'::jsonb);
  end if;

  if (new.archived_at is not null) is distinct from (old.archived_at is not null) then
    insert into public.finance_events (company_id, finance_item_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, auth.uid(),
            case when new.archived_at is not null then 'archived' else 'restored' end, '{}'::jsonb);
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
-- 18. L'ingestione automatica (§14)
--
-- Quando arriva un'analisi valida e il classificatore deterministico riconosce
-- una fattura, l'elemento finanziario nasce da solo — in coda, non verificato.
-- Nessun elemento nasce «pronto»: la verifica è un gesto umano.
--
-- ⚠️ `on conflict do nothing`: una RIANALISI dello stesso documento non deve
-- creare un secondo elemento né azzerare il lavoro già fatto su quello che c'è.
-- Se il documento era già in Finance, resta com'è.
--
-- ⚠️ Il filename NON è un segnale (§14): `fattura.pdf` non fa di un documento
-- una fattura, e usarlo produrrebbe elementi finanziari a partire dal modo in
-- cui qualcuno ha salvato un file.
-- ---------------------------------------------------------------------------
create or replace function public.finance_autocreate()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc  record;
  v_type public.finance_item_type;
begin
  if new.analysis_status = 'failed' then return new; end if;

  select d.id, d.company_id, d.category_workflow_run_id
    into v_doc
    from public.documents d
   where d.id = new.document_id;

  -- Una funzione che scavalca la RLS si difende da sola (lezione della 0017).
  if v_doc.id is null or v_doc.company_id is distinct from new.company_id then
    return new;
  end if;

  v_type := public.finance_type_from_analysis(new.document_type, new.sender_authority_type);
  if v_type is null then return new; end if;

  insert into public.finance_items (
    company_id, document_id, type, origin, processing_status, workflow_run_id
  ) values (
    new.company_id, new.document_id, v_type, 'rule', 'pending',
    -- Se il documento è finito in questa categoria per via di una regola
    -- aziendale, l'elemento finanziario appartiene a quella stessa catena
    -- causale: senza questo filo, l'evento che segue ne aprirebbe una nuova e
    -- la protezione contro i cicli non avrebbe appiglio.
    v_doc.category_workflow_run_id
  )
  on conflict (company_id, document_id) do nothing;

  return new;
end $$;

drop trigger if exists trg_finance_autocreate on public.document_analyses;
create trigger trg_finance_autocreate
  after insert on public.document_analyses
  for each row execute function public.finance_autocreate();


-- ---------------------------------------------------------------------------
-- 19. L'emissione degli eventi per il motore delle automazioni
--
-- ⚠️ I DUE VALORI NUOVI DELL'ENUM COMPAIONO SOLO QUI DENTRO, e il corpo di una
-- funzione non viene eseguito quando la funzione viene creata: applicare questo
-- file non li valuta mai. Vedi il punto 2.
--
-- L'entità è il DOCUMENTO, non l'elemento finanziario: così una regola può
-- guardare insieme la fattura e il documento da cui viene, e non serve toccare
-- i vincoli di `automation_events`.
-- ---------------------------------------------------------------------------
create or replace function public.finance_emit_automation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  v_payload := jsonb_build_object(
    'financeItemId', new.id, 'type', new.type, 'reviewStatus', new.review_status);

  -- (a) C'è una fattura nuova da guardare: la lettura è RIUSCITA e nessuno
  --     l'ha ancora verificata.
  --     ⚠️ Una lettura FALLITA non emette niente, come le analisi fallite della
  --     0020: un'estrazione non riuscita non descrive nulla, e far scattare una
  --     regola su di essa significherebbe creare lavoro o classificare sulla
  --     base di dati che non esistono. Il fallimento resta visibile nella
  --     schermata, che è il posto giusto per una persona.
  if new.processing_status = 'completed'
     and old.processing_status is distinct from 'completed'
     and new.review_status = 'needs_review' then
    perform public.automation_emit(
      new.company_id, 'finance_item_needs_review', 'document', new.document_id,
      v_payload, null, new.workflow_run_id);
  end if;

  -- (b) Una persona l'ha verificata: da qui in avanti i dati si possono usare
  --     per far nascere del lavoro.
  if new.review_status = 'ready' and old.review_status is distinct from 'ready' then
    perform public.automation_emit(
      new.company_id, 'finance_item_ready', 'document', new.document_id,
      v_payload, null, new.workflow_run_id);
  end if;

  return new;
end $$;

drop trigger if exists trg_finance_emit_automation on public.finance_items;
create trigger trg_finance_emit_automation
  after update on public.finance_items
  for each row execute function public.finance_emit_automation();


-- ---------------------------------------------------------------------------
-- 20. La lista: filtri, ricerca, ordinamento e paginazione nel database
--
-- Stessa forma di `list_documents` (0017) e per le stesse ragioni: una riga
-- mette insieme l'elemento finanziario, il documento, il sospetto di duplicato,
-- le attività collegate e la provenienza. Fatto dal browser sarebbe una query
-- per riga per relazione, e per sapere quali venticinque righe mostrare
-- bisognerebbe averle scaricate tutte (§27/§112).
--
-- `security invoker` (il default): la RLS di ogni tabella continua ad applicarsi
-- riga per riga. Il filtro esplicito su `company_id` e il controllo di
-- appartenenza NON la sostituiscono, la accompagnano — su una funzione che
-- restituisce IBAN e importi gli strati sono tre.
--
-- ORDINAMENTO PREDEFINITO (§24), e non è opaco: prima ciò che è già scaduto,
-- poi ciò che scade presto, poi ciò che nessuno ha ancora verificato, poi il
-- resto dal più recente. `id desc` chiude SEMPRE la catena: senza, due fatture
-- create nello stesso istante si scambierebbero di posto fra una pagina e
-- l'altra e una delle due non comparirebbe mai.
-- ---------------------------------------------------------------------------
create or replace function public.list_finance_items(
  p_company_id   uuid,
  -- 'invoices' (fatture fornitori e note di credito) | 'expenses' (ricevute).
  p_tab          text default null,
  p_query        text default null,
  p_review       text default null,      -- needs_review | ready
  p_processing   text default null,      -- pending | processing | completed | failed
  p_supplier     text default null,
  p_currency     text default null,
  p_date_from    date default null,      -- sulla data del documento finanziario
  p_date_to      date default null,
  p_due_from     date default null,
  p_due_to       date default null,
  p_source       public.document_source_type default null,
  p_category     public.finance_expense_category default null,
  p_duplicates   boolean default false,  -- solo i possibili duplicati
  p_flagged      boolean default false,  -- solo quelli con qualcosa che non torna
  p_archived     boolean default false,
  p_sort         text default 'default', -- default | due_date | amount | recent | supplier
  p_limit        integer default 25,
  p_offset       integer default 0,
  -- Un solo elemento, per il DETTAGLIO. Come nella 0017: la riga della lista e
  -- la testata del dettaglio devono dire la stessa cosa sullo stesso documento.
  p_item_id      uuid default null
)
returns table (
  id uuid,
  document_id uuid,
  type public.finance_item_type,
  processing_status public.finance_processing_status,
  review_status public.finance_review_status,
  origin public.finance_origin,
  error_code text,
  expense_category public.finance_expense_category,
  payment_method public.finance_payment_method,
  quality_flags public.finance_quality_flag[],
  duplicate_suspected boolean,
  duplicate_count bigint,
  supplier_name text,
  invoice_number text,
  invoice_date date,
  due_date date,
  expense_date date,
  merchant text,
  currency text,
  gross_amount numeric,
  net_amount numeric,
  vat_amount numeric,
  iban text,
  reference_type public.finance_reference_type,
  payment_reference text,
  -- Quali campi ha corretto una persona: senza questo la schermata mostrerebbe
  -- un valore scritto a mano come se l'avesse letto la macchina (§11).
  corrected_fields text[],
  reviewed_at timestamptz,
  reviewed_by uuid,
  archived_at timestamptz,
  created_at timestamptz,
  extraction_id uuid,
  extraction_version integer,
  -- Dal documento: il titolo che una persona riconosce, e da dove è arrivato.
  document_title text,
  document_source public.document_source_type,
  document_status public.document_status,
  storage_path text,
  mime_type text,
  open_task_count bigint,
  task_count bigint,
  email_count bigint,
  total_count bigint
)
language sql
stable
set search_path = ''
as $$
  with params as (
    select
      -- I caratteri jolly digitati da una persona devono cercare sé stessi.
      nullif(btrim(left(coalesce(p_query, ''), 120)), '') as q,
      replace(replace(replace(
        btrim(left(coalesce(p_query, ''), 120)), '\', '\\'), '%', '\%'), '_', '\_') as q_like
  ),
  base as (
    select
      f.*,
      d.title       as d_title,
      d.source_type as d_source,
      d.status      as d_status,
      d.storage_path as d_path,
      d.mime_type   as d_mime,
      ex.extraction_version as ex_version,
      corr.fields   as corr_fields,
      dup.n         as dup_n,
      count(*) over () as n_total
    from public.finance_items f
    -- Il confronto sull'azienda accompagna la chiave esterna: è la disciplina
    -- di questo progetto, e su un join verso i documenti evita che una riga
    -- agganciata per errore possa mai essere letta.
    join public.documents d on d.id = f.document_id and d.company_id = f.company_id
    left join lateral (
      select e.extraction_version
      from public.finance_extractions e
      where e.id = f.current_extraction_id and e.company_id = f.company_id
    ) ex on true
    left join lateral (
      select array_agg(distinct c.field) as fields
      from public.finance_corrections c
      where c.finance_item_id = f.id and c.company_id = f.company_id
    ) corr on true
    left join lateral (
      -- Il duplicato SOSPETTO, calcolato adesso e non memorizzato: dipende da
      -- che cosa c'è intorno, e archiviare la controparte lo fa sparire.
      select count(*) as n
      from public.finance_items f2
      where f.dup_key is not null
        and f2.company_id = f.company_id and f2.dup_key = f.dup_key
        and f2.id <> f.id and f2.archived_at is null
    ) dup on true
    where f.company_id = p_company_id
      -- Sottointerrogazione scalare: l'appartenenza si verifica UNA volta per
      -- interrogazione e non una volta per riga.
      and (select public.is_company_member(p_company_id))
      and (p_item_id is null or f.id = p_item_id)
      -- Chiedendo UN elemento non si applica il filtro di archiviazione: il suo
      -- indirizzo deve funzionare anche dopo, altrimenti «archivia» diventa
      -- indistinguibile da «fai sparire».
      and (p_item_id is not null
           or (case when p_archived then f.archived_at is not null else f.archived_at is null end))
      and (p_tab is null
           or (p_tab = 'invoices' and f.type in ('supplier_invoice', 'credit_note'))
           or (p_tab = 'expenses' and f.type = 'receipt'))
      and (p_review is null or f.review_status::text = p_review)
      and (p_processing is null or f.processing_status::text = p_processing)
      and (p_supplier is null
           or f.eff_supplier_norm = public.finance_norm_supplier(p_supplier))
      and (p_currency is null or f.eff_currency = upper(p_currency))
      and (p_category is null or f.expense_category = p_category)
      and (p_source is null or d.source_type = p_source)
      and (p_date_from is null
           or coalesce(f.eff_invoice_date, f.eff_expense_date, f.created_at::date) >= p_date_from)
      and (p_date_to is null
           or coalesce(f.eff_invoice_date, f.eff_expense_date, f.created_at::date) <= p_date_to)
      and (p_due_from is null or f.eff_due_date >= p_due_from)
      and (p_due_to is null or f.eff_due_date <= p_due_to)
      and (not p_duplicates or dup.n > 0)
      and (not p_flagged or array_length(f.quality_flags, 1) > 0 or dup.n > 0)
      and (
        (select q from params) is null
        or coalesce(f.eff_supplier_name, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(f.eff_merchant, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(f.eff_invoice_number, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(f.eff_payment_reference, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(d.title, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(d.original_filename, '') ilike '%' || (select q_like from params) || '%'
      )
    order by
      case when p_sort = 'due_date' then f.eff_due_date end asc nulls last,
      case when p_sort = 'amount' then f.eff_gross_amount end desc nulls last,
      case when p_sort = 'supplier' then lower(f.eff_supplier_name) end asc nulls last,
      case when p_sort = 'recent' then f.created_at end desc nulls last,
      -- L'ordinamento PREDEFINITO, in quattro gradini dichiarati.
      case when p_sort = 'default' then
        case
          when f.eff_due_date is not null and f.eff_due_date < current_date then 0
          when f.eff_due_date is not null and f.eff_due_date <= current_date + 7 then 1
          when f.review_status = 'needs_review' then 2
          else 3
        end
      end asc nulls last,
      case when p_sort = 'default' then f.eff_due_date end asc nulls last,
      case when p_sort in ('due_date', 'amount', 'supplier', 'recent')
           then null else f.created_at end desc nulls last,
      f.id desc
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    b.id, b.document_id, b.type, b.processing_status, b.review_status, b.origin, b.error_code,
    b.expense_category, b.payment_method,
    -- Le bandiere memorizzate PIÙ il duplicato calcolato adesso: la schermata
    -- riceve un elenco solo di ragioni per cui guardare la fattura.
    (select array(select distinct x from unnest(
        b.quality_flags ||
        case when coalesce(b.dup_n, 0) > 0
             then array['duplicate_suspected']::public.finance_quality_flag[]
             else '{}'::public.finance_quality_flag[] end) x order by x)) as quality_flags,
    coalesce(b.dup_n, 0) > 0 as duplicate_suspected,
    coalesce(b.dup_n, 0) as duplicate_count,
    b.eff_supplier_name, b.eff_invoice_number, b.eff_invoice_date, b.eff_due_date,
    b.eff_expense_date, b.eff_merchant, b.eff_currency,
    b.eff_gross_amount, b.eff_net_amount, b.eff_vat_amount,
    b.eff_iban, b.eff_reference_type, b.eff_payment_reference,
    coalesce(b.corr_fields, '{}') as corrected_fields,
    b.reviewed_at, b.reviewed_by, b.archived_at, b.created_at,
    b.current_extraction_id, b.ex_version,
    b.d_title, b.d_source, b.d_status, b.d_path, b.d_mime,
    coalesce(tk.open_count, 0), coalesce(tk.all_count, 0), coalesce(em.n, 0),
    b.n_total
  from base b
  left join lateral (
    select
      count(*) filter (where t.status <> 'completed' and t.archived_at is null) as open_count,
      count(*) as all_count
    from public.tasks t where t.document_id = b.document_id and t.company_id = b.company_id
  ) tk on true
  left join lateral (
    select count(*) as n
    from public.email_message_documents m
    where m.document_id = b.document_id and m.company_id = b.company_id
  ) em on true
  -- Lo STESSO ordine della selezione interna, espressione per espressione:
  -- sceglierne venticinque con un criterio e mostrarle con un altro vorrebbe
  -- dire che la pagina due non viene dopo la pagina uno.
  order by
    case when p_sort = 'due_date' then b.eff_due_date end asc nulls last,
    case when p_sort = 'amount' then b.eff_gross_amount end desc nulls last,
    case when p_sort = 'supplier' then lower(b.eff_supplier_name) end asc nulls last,
    case when p_sort = 'recent' then b.created_at end desc nulls last,
    case when p_sort = 'default' then
      case
        when b.eff_due_date is not null and b.eff_due_date < current_date then 0
        when b.eff_due_date is not null and b.eff_due_date <= current_date + 7 then 1
        when b.review_status = 'needs_review' then 2
        else 3
      end
    end asc nulls last,
    case when p_sort = 'default' then b.eff_due_date end asc nulls last,
    case when p_sort in ('due_date', 'amount', 'supplier', 'recent')
         then null else b.created_at end desc nulls last,
    b.id desc;
$$;


-- ---------------------------------------------------------------------------
-- 21. Il cruscotto: quattro numeri, RAGGRUPPATI PER VALUTA
--
-- ⚠️ NON SI SOMMANO VALUTE DIVERSE (§22/§113). «CHF 12'400» e «EUR 3'100» sono
-- due fatti; «15'500» non è un fatto, è un'invenzione che richiederebbe un
-- tasso di cambio, una data e una fonte — nessuna delle quali il prodotto ha.
-- La funzione restituisce quindi UNA RIGA PER VALUTA, e l'interfaccia le mostra
-- una sotto l'altra.
--
-- ⚠️ LE NOTE DI CREDITO NON GONFIANO IL «DA PAGARE» (§74): sono escluse dai
-- totali in scadenza e scaduti. Compensarle sottraendole sarebbe peggio —
-- suggerirebbe che l'importo netto sia già stato concordato con il fornitore.
--
-- ⚠️ «Scaduta» qui significa SCADENZA SUPERATA, non «non pagata» (§114). Senza
-- dati bancari il prodotto non sa se una fattura è stata pagata, e dirlo
-- sarebbe la prima affermazione falsa di questo modulo.
-- ---------------------------------------------------------------------------
create or replace function public.finance_summary(
  p_company_id uuid,
  p_due_days   integer default 7
)
returns table (
  bucket text,          -- needs_review | due_soon | overdue | expenses_month
  currency text,        -- NULL sulla riga dei conteggi senza importo
  n bigint,
  total numeric
)
language sql
stable
set search_path = ''
as $$
  with mine as (
    select f.*
    from public.finance_items f
    where f.company_id = p_company_id
      and (select public.is_company_member(p_company_id))
      and f.archived_at is null
  ),
  payable as (
    -- Ciò che l'azienda deve ancora pagare: fatture fornitori, non note di
    -- credito, non ricevute (una ricevuta è una spesa già sostenuta).
    select * from mine where type = 'supplier_invoice'
  )
  -- (a) Quante fatture e spese aspettano una verifica. È un CONTEGGIO: non ha
  --     valuta, perché mettere insieme importi non verificati per farne un
  --     totale significherebbe dare per buoni proprio i numeri incerti.
  select 'needs_review'::text, null::text, count(*)::bigint, null::numeric
  from mine where review_status = 'needs_review'
  union all
  -- (b) In scadenza nei prossimi N giorni, per valuta.
  -- ⚠️ Un importo senza valuta NON è un importo, e sommarlo insieme agli altri
  --    ne inventerebbe una. La fattura resta CONTATA — è comunque in scadenza —
  --    ma il suo totale è `null`, e l'interfaccia dice «di cui una senza valuta»
  --    invece di farla sparire o di attribuirla ai franchi.
  select 'due_soon', p.eff_currency, count(*)::bigint,
         case when p.eff_currency is null then null::numeric else sum(p.eff_gross_amount) end
  from payable p
  where p.eff_due_date is not null
    and p.eff_due_date >= current_date
    and p.eff_due_date <= current_date + greatest(1, least(coalesce(p_due_days, 7), 90))
  group by p.eff_currency
  union all
  -- (c) Scadute, per valuta.
  select 'overdue', p.eff_currency, count(*)::bigint,
         case when p.eff_currency is null then null::numeric else sum(p.eff_gross_amount) end
  from payable p
  where p.eff_due_date is not null and p.eff_due_date < current_date
  group by p.eff_currency
  union all
  -- (d) Le spese del mese in corso, per valuta. La data è quella della spesa
  --     quando c'è: quando una spesa è stata SOSTENUTA non è quando il
  --     documento è stato caricato.
  select 'expenses_month', m.eff_currency, count(*)::bigint,
         case when m.eff_currency is null then null::numeric else sum(m.eff_gross_amount) end
  from mine m
  where m.type = 'receipt'
    and coalesce(m.eff_expense_date, m.eff_invoice_date, m.created_at::date)
        >= date_trunc('month', current_date)::date
  group by m.eff_currency;
$$;


-- ---------------------------------------------------------------------------
-- 22. Le controparti di un possibile duplicato (§71)
--
-- Serve al pulsante «Confronta». NON fonde e non cancella niente: restituisce
-- gli altri elementi con la stessa impronta perché una persona possa guardarli
-- accanto (§72).
-- ---------------------------------------------------------------------------
create or replace function public.finance_duplicates(p_item_id uuid)
returns table (
  id uuid, document_id uuid, supplier_name text, invoice_number text,
  invoice_date date, currency text, gross_amount numeric,
  review_status public.finance_review_status, created_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select f2.id, f2.document_id, f2.eff_supplier_name, f2.eff_invoice_number,
         f2.eff_invoice_date, f2.eff_currency, f2.eff_gross_amount,
         f2.review_status, f2.created_at
  from public.finance_items f1
  join public.finance_items f2
    on f2.company_id = f1.company_id and f2.dup_key = f1.dup_key and f2.id <> f1.id
  where f1.id = p_item_id
    and f1.dup_key is not null
    -- La ricerca è SEMPRE dentro l'azienda: che un'altra impresa abbia la
    -- stessa fattura non deve essere deducibile in alcun modo (§124).
    and (select public.is_company_member(f1.company_id))
    and f2.archived_at is null
  order by f2.created_at asc, f2.id asc
  limit 20;
$$;


-- ---------------------------------------------------------------------------
-- 23. RLS E PERMESSI
--
-- ⚠️⚠️ IL `revoke all` VIENE PRIMA DEI `grant`, E NON È UNA FORMALITÀ.
-- Su Supabase esiste `alter default privileges in schema public grant all on
-- tables to anon, authenticated, service_role`: ogni tabella NUOVA di `public`
-- nasce con i permessi di TABELLA COMPLETI per `authenticated`. Un `grant` di
-- colonna scritto dopo AGGIUNGE privilegi, non ne toglie.
--
-- È la lezione della 0014, e qui pesa il doppio: senza queste righe
-- `finance_extractions` sarebbe scrivibile e cancellabile dal browser da
-- chiunque sia autenticato — una tabella che contiene IBAN, riferimenti di
-- pagamento e importi.
--
-- ⚠️ `service_role` NON viene toccato: il worker deve poter scrivere.
--
-- Che cosa può fare il client, in una riga: LEGGERE tutto ciò che è della
-- propria azienda; CREARE un elemento finanziario da un documento («Aggiungi a
-- Finanze»); CAMBIARE lo stato operativo e l'organizzazione; AGGIUNGERE una
-- correzione. Nient'altro. I verbali non si scrivono, non si modificano e non
-- si cancellano dal browser.
-- ---------------------------------------------------------------------------
alter table public.finance_items       enable row level security;
alter table public.finance_extractions enable row level security;
alter table public.finance_corrections enable row level security;
alter table public.finance_events      enable row level security;
alter table public.finance_vat_rates   enable row level security;

revoke all on public.finance_items       from anon, authenticated, public;
revoke all on public.finance_extractions from anon, authenticated, public;
revoke all on public.finance_corrections from anon, authenticated, public;
revoke all on public.finance_events      from anon, authenticated, public;
revoke all on public.finance_vat_rates   from anon, authenticated, public;

-- Sull'elemento operativo il client scrive SOLO le colonne che descrivono una
-- decisione umana. Tutto il resto — proiezione, bandiere, timbri, estrazione
-- corrente, tentativi — è materia del database e del worker.
grant select on public.finance_items to authenticated;
grant insert (company_id, document_id, type) on public.finance_items to authenticated;
grant update (type, review_status, archived_at, expense_category, payment_method,
              processing_status) on public.finance_items to authenticated;

-- I verbali si leggono e basta. Nessun insert: li scrive il worker con il
-- service role, e nessun update né delete, che i trigger rifiutano comunque —
-- due difese, perché una sola è quella che manca il giorno in cui qualcuno
-- cambia un grant.
grant select on public.finance_extractions to authenticated;

-- Le correzioni si aggiungono e si leggono. Mai modificare, mai cancellare.
grant select, insert on public.finance_corrections to authenticated;

-- Lo storico e il catalogo delle aliquote: sola lettura.
grant select on public.finance_events    to authenticated;
grant select on public.finance_vat_rates to authenticated;

drop policy if exists finance_items_select on public.finance_items;
create policy finance_items_select on public.finance_items
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists finance_items_insert on public.finance_items;
create policy finance_items_insert on public.finance_items
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists finance_items_update on public.finance_items;
create policy finance_items_update on public.finance_items
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

-- ⚠️ Nessuna policy di DELETE, e nessun grant: un elemento finanziario non si
-- cancella (§91). Si archivia, oppure si cancella il DOCUMENTO — e allora la
-- cascata porta via anche questo. Un «cancella» che lasciasse il documento
-- senza la sua lettura finanziaria produrrebbe un archivio in cui una fattura
-- c'è e non c'è insieme.

drop policy if exists finance_extractions_select on public.finance_extractions;
create policy finance_extractions_select on public.finance_extractions
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists finance_corrections_select on public.finance_corrections;
create policy finance_corrections_select on public.finance_corrections
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists finance_corrections_insert on public.finance_corrections;
create policy finance_corrections_insert on public.finance_corrections
  for insert to authenticated with check (public.is_company_member(company_id));

drop policy if exists finance_events_select on public.finance_events;
create policy finance_events_select on public.finance_events
  for select to authenticated using (public.is_company_member(company_id));

-- Il catalogo delle aliquote è comune a tutte le aziende: si legge, non si
-- scrive. Nessun `company_id`, quindi la policy non filtra — dichiara solo che
-- serve un'identità.
drop policy if exists finance_vat_rates_select on public.finance_vat_rates;
create policy finance_vat_rates_select on public.finance_vat_rates
  for select to authenticated using (true);

revoke all on function public.list_finance_items(uuid, text, text, text, text, text, text, date, date, date, date, public.document_source_type, public.finance_expense_category, boolean, boolean, boolean, text, integer, integer, uuid) from public, anon;
grant execute on function public.list_finance_items(uuid, text, text, text, text, text, text, date, date, date, date, public.document_source_type, public.finance_expense_category, boolean, boolean, boolean, text, integer, integer, uuid) to authenticated;
revoke all on function public.finance_summary(uuid, integer) from public, anon;
grant execute on function public.finance_summary(uuid, integer) to authenticated;
revoke all on function public.finance_duplicates(uuid) from public, anon;
grant execute on function public.finance_duplicates(uuid) to authenticated;
revoke all on function public.finance_type_from_analysis(text, text) from public, anon;
grant execute on function public.finance_type_from_analysis(text, text) to authenticated;
revoke all on function public.finance_norm_supplier(text) from public, anon;
grant execute on function public.finance_norm_supplier(text) to authenticated;
revoke all on function public.finance_norm_invoice_number(text) from public, anon;
grant execute on function public.finance_norm_invoice_number(text) to authenticated;
revoke all on function public.finance_iban_valid(text) from public, anon;
grant execute on function public.finance_iban_valid(text) to authenticated;
revoke all on function public.finance_dup_key(text, text, numeric, text) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 24. Autoverifica: la migrazione controlla di aver ottenuto ciò che dichiara.
--
-- Non è un ornamento. La 0013 dichiarava nei commenti una garanzia che non
-- esisteva, e lo si è scoperto solo eseguendo i test sul database vero. Da
-- allora ogni migrazione che promette qualcosa la verifica prima di dirsi
-- riuscita.
--
-- ⚠️ Nessuna riga di questo blocco nomina i due valori enum aggiunti al punto 2
-- e nessuna chiama una funzione che li nomini: il blocco viene ESEGUITO, e
-- valutare qui un'etichetta nuova farebbe fallire l'intera applicazione.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
  v_type public.finance_item_type;
begin
  -- ⚠️ `information_schema` riporta il ruolo PUBLIC in MAIUSCOLO. Cercare solo
  --    'public' lascerebbe scoperto proprio il ruolo che vale per CHIUNQUE —
  --    un controllo che guarda dalla parte sbagliata e dichiara verde. Le
  --    migrazioni precedenti cercano solo la forma minuscola: qui si cercano
  --    entrambe, e se un giorno emergesse una differenza sarebbe questa
  --    migrazione a dirlo per prima.

  -- (a) I verbali NON devono essere scrivibili dal browser. È la garanzia più
  --     importante del modulo: se cade, un membro può riscrivere l'IBAN di una
  --     fattura senza lasciare traccia in nessuna correzione.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('finance_extractions', 'finance_events', 'finance_vat_rates')
    and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'i verbali finanziari risultano scrivibili dal client: %', v_bad;
  end if;

  -- (b) Le correzioni si aggiungono, non si riscrivono.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'finance_corrections'
    and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
    and privilege_type in ('UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'le correzioni finanziarie risultano modificabili o cancellabili: %', v_bad;
  end if;

  -- (c) Un elemento finanziario non si cancella dal browser.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'finance_items'
    and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
    and privilege_type = 'DELETE';
  if v_bad is not null then
    raise exception 'gli elementi finanziari risultano cancellabili dal client: %', v_bad;
  end if;

  -- (d) Niente è raggiungibile senza autenticazione.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name like 'finance\_%'
    and grantee = 'anon';
  if v_bad is not null then
    raise exception 'le tabelle finanziarie risultano accessibili senza autenticazione: %', v_bad;
  end if;

  -- (e) La RLS è accesa su tutte e cinque.
  select string_agg(c.relname, ', ') into v_bad
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname like 'finance\_%' and c.relkind = 'r'
    and not c.relrowsecurity;
  if v_bad is not null then
    raise exception 'RLS non attiva su: %', v_bad;
  end if;

  -- (f) Il classificatore fa quello che dice, sui casi che contano.
  v_type := public.finance_type_from_analysis('invoice', 'private');
  if v_type is distinct from 'supplier_invoice' then
    raise exception 'una fattura non viene riconosciuta come tale (ha detto %)', v_type;
  end if;
  v_type := public.finance_type_from_analysis('payment_request', 'federal');
  if v_type is not null then
    raise exception 'una richiesta di pagamento di un ente pubblico non è una fattura fornitore (ha detto %)', v_type;
  end if;
  v_type := public.finance_type_from_analysis('information', 'unknown');
  if v_type is not null then
    raise exception 'il classificatore inventa un tipo dove non ha elementi (ha detto %)', v_type;
  end if;

  -- (g) La cifra di controllo dell'IBAN funziona in entrambe le direzioni.
  if not public.finance_iban_valid('CH9300762011623852957') then
    raise exception 'finance_iban_valid rifiuta un IBAN valido';
  end if;
  if public.finance_iban_valid('CH9300762011623852958') then
    raise exception 'finance_iban_valid accetta un IBAN con cifra di controllo sbagliata';
  end if;
  if public.finance_iban_valid('DE89370400440532013000') is not true then
    raise exception 'finance_iban_valid rifiuta un IBAN estero valido';
  end if;

  -- (h) L'impronta del duplicato tace quando i dati non bastano.
  if public.finance_dup_key('acme', null, 100, 'CHF') is not null then
    raise exception 'l''impronta del duplicato si forma anche senza il numero di fattura';
  end if;
  if public.finance_dup_key('acme', 'F1', 100, 'CHF') is null then
    raise exception 'l''impronta del duplicato non si forma quando i dati ci sono tutti';
  end if;

  -- (i) La normalizzazione non butta via ciò che distingue due numeri diversi.
  --
  -- ⚠️ CHE COSA GARANTISCE E CHE COSA NO. Toglie spazi, punti e cancelletti —
  -- che sono ornamenti tipografici — e NON tocca lettere né trattini, che nei
  -- numeri di fattura portano informazione: `2026-1` e `20261` sono due numeri
  -- diversi, e anche `N847291` e `847291` potrebbero esserlo.
  --
  -- Conseguenza dichiarata: se un'estrazione legge «N. 847291» e un'altra
  -- «847291», il duplicato NON viene sospettato. È il prezzo della prudenza, ed
  -- è il verso giusto in cui sbagliare: un sospetto mancato costa una verifica
  -- in più, un sospetto sbagliato insegna a ignorare i sospetti.
  if public.finance_norm_invoice_number('2026-1')
     = public.finance_norm_invoice_number('20261') then
    raise exception 'la normalizzazione del numero di fattura confonde 2026-1 con 20261';
  end if;
  if public.finance_norm_invoice_number('847 291')
     is distinct from public.finance_norm_invoice_number('847291') then
    raise exception 'la normalizzazione non ignora gli spazi dentro un numero di fattura';
  end if;
  if public.finance_norm_invoice_number('N847291')
     = public.finance_norm_invoice_number('847291') then
    raise exception 'la normalizzazione toglie le lettere: due numeri diversi diventerebbero uguali';
  end if;
  if public.finance_norm_supplier('Swisscom (Svizzera) SA')
     is distinct from public.finance_norm_supplier('swisscom  svizzera   sa') then
    raise exception 'la normalizzazione del fornitore non ignora punteggiatura e spazi ripetuti';
  end if;
end $$;
