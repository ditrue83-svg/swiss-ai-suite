-- ============================================================================
-- AI-Swisse — 0017 SMART DOCUMENT HUB (Documenti)
--
-- L'Archivio diventa «Documenti»: non una cartella di file, ma il posto in cui
-- si ritrova ciò che l'azienda sa. Le domande a cui deve rispondere sono
-- concrete — «dov'è il contratto Swisscom?», «cosa ci ha mandato l'AFC
-- quest'anno?», «da quale email è arrivato questo PDF?» — e nessuna di esse si
-- risponde con un elenco ordinato per data.
--
-- ⚠️ QUESTA MIGRAZIONE NON CREA UNA SECONDA VERITÀ SUI DOCUMENTI.
-- Mittente, tipo, scadenza, importi, citazioni e incertezze restano dove sono:
-- in `document_analyses`, che è immutabile dalla 0010, e in
-- `analysis_corrections` per ciò che una persona ha corretto. Qui si aggiunge
-- SOLO l'organizzazione aziendale — categoria, etichette, archiviazione, note —
-- che è l'unica cosa che l'azienda può cambiare liberamente senza toccare
-- l'analisi. La lettura combinata la fa `list_documents`, che compone; non
-- copia.
--
-- COSA CONTIENE
--   1. Due tipi nuovi: `document_category` e `document_category_source`.
--   2. Colonne di organizzazione su `documents` (categoria, archiviazione, note).
--   3. Etichette aziendali: `document_tags` + `document_tag_links`.
--   4. Ricerca full-text sul testo estratto (configurazione `simple`).
--   5. Classificazione DETERMINISTICA da tipo documento e tipo di ente.
--   6. `list_documents` / `document_category_counts` / le tre azioni di gruppo.
--   7. RLS, permessi e autoverifica.
--
-- ⚠️ VINCOLO SUI VALORI ENUM (lezione della 0015, ricordata dalla 0016)
-- `alter type … add value` rende l'etichetta inutilizzabile fino alla fine
-- della transazione, e `full-setup.sql` concatena tutto in una transazione
-- sola. Qui NON si aggiungono valori a enum esistenti: i due tipi nuovi
-- nascono con `create type … as enum (…)`, e quelli sono utilizzabili subito.
-- `npm run db:bundle` lo verifica.
--
-- Riesecuzione: sicura. Ogni oggetto è idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Categoria documentale
--
-- ⚠️ LA CATEGORIA NON È IL TIPO DI DOCUMENTO. `document_type` dice CHE COSA è
-- un documento (un sollecito, una decisione, una fattura); la categoria dice
-- DOVE STA nell'organizzazione dell'azienda. Un sollecito dell'AFC è di tipo
-- «sollecito» e di categoria «imposte»: chi lo cerca fra sei mesi lo cerca
-- fra le imposte, non fra i solleciti.
--
-- Perché `social_insurance` è una categoria a sé e non sta dentro
-- «assicurazioni» né dentro «personale»: in Svizzera AVS/AI/IPG, LPP e LAINF
-- sono il flusso amministrativo più regolare di una PMI, arrivano da enti
-- diversi dalle assicurazioni private e si conservano separati. Metterli
-- altrove avrebbe significato decidere al posto dell'utente una cosa che il
-- dominio non decide.
--
-- Nessun valore «da classificare»: quello è l'ASSENZA di categoria (NULL).
-- Un documento che il sistema non sa classificare non è «altro» — «altro» è
-- una scelta che una persona può fare, NULL è il fatto che nessuno ha ancora
-- scelto. Confonderli farebbe sparire dalla vista ciò che va sistemato.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.document_category as enum (
    'administration',     -- autorità, permessi, decisioni, controlli
    'taxes',              -- imposte dirette e IVA
    'social_insurance',   -- AVS/AI/IPG, LPP, LAINF
    'invoices',           -- fatture e richieste di pagamento
    'contracts',          -- contratti e documenti contrattuali
    'insurance',          -- polizze private
    'banking',            -- banche e mezzi di pagamento
    'employees',          -- personale, salari, certificati
    'clients',            -- documenti riferiti a un cliente
    'suppliers',          -- documenti riferiti a un fornitore
    'subsidies',          -- incentivi e sussidi
    'other'               -- scelta esplicita di una persona, non un ripiego
  );
exception when duplicate_object then null; end $$;

-- Da dove viene la categoria. Due valori soli, e non tre: non esiste `ai`
-- perché nessuna chiamata AI viene fatta per classificare — dichiarare un
-- valore che il codice non produce sarebbe descrivere una funzione che non c'è.
do $$ begin
  create type public.document_category_source as enum ('rule', 'manual');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. Organizzazione aziendale sul documento
--
-- Colonne su `documents` e non una tabella `document_catalog` a fianco: sono
-- attributi DEL documento, non di un'altra entità, e ogni riga della lista li
-- filtra e li ordina. Una tabella uno-a-uno avrebbe aggiunto un join a ogni
-- interrogazione e una riga da creare per ogni documento, in cambio di niente.
-- ---------------------------------------------------------------------------
alter table public.documents
  add column if not exists category           public.document_category,
  add column if not exists category_source    public.document_category_source,
  add column if not exists category_set_by    uuid references auth.users (id) on delete set null,
  add column if not exists category_set_at    timestamptz,
  add column if not exists archived_at        timestamptz,
  add column if not exists archived_by        uuid references auth.users (id) on delete set null,
  add column if not exists internal_notes     text,
  add column if not exists notes_updated_at   timestamptz,
  add column if not exists notes_updated_by   uuid references auth.users (id) on delete set null;

do $$ begin
  alter table public.documents
    add constraint documents_internal_notes_len check (length(internal_notes) <= 4000);
exception when duplicate_object then null; end $$;

comment on column public.documents.category is
  'Dove il documento sta nell''organizzazione aziendale. NULL = nessuno ha ancora '
  'classificato, che è diverso da «other» (scelta esplicita di una persona).';
comment on column public.documents.category_source is
  'Chi ha deciso la categoria: «rule» una regola deterministica sul tipo di documento '
  'e sul tipo di ente, «manual» una persona. Lo scrive il trigger, non il client.';
comment on column public.documents.archived_at is
  'Archiviato: fuori dalle viste correnti, ancora nel sistema con analisi, email '
  'di provenienza e attività intatte. Non è la cancellazione.';
comment on column public.documents.internal_notes is
  'Annotazione interna dell''azienda («verificato con la fiduciaria il 12 agosto»). '
  'Testo semplice, mai interpretato come markup, e mai confuso con l''analisi AI.';

-- ---------------------------------------------------------------------------
-- 3. Etichette aziendali
--
-- Categoria e etichette rispondono a domande diverse: la categoria è una sola
-- e dice dove sta il documento, le etichette sono molte e dicono a cosa si
-- riferisce («IVA», «2026», «Sede Lugano», «Veicoli»). Per questo non si è
-- fatto un albero di cartelle: una gerarchia costringe a scegliere un solo
-- ramo e produce lavoro amministrativo invece di ridurlo.
-- ---------------------------------------------------------------------------
create table if not exists public.document_tags (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  name        text not null check (length(btrim(name)) between 1 and 40),
  created_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);

-- Unicità senza distinzione di maiuscole: «IVA» e «Iva» sono la stessa
-- etichetta, e vederle entrambe nell'elenco farebbe dubitare di quale usare.
create unique index if not exists uq_document_tags_name
  on public.document_tags (company_id, lower(btrim(name)));

create table if not exists public.document_tag_links (
  company_id   uuid not null references public.companies (id) on delete cascade,
  document_id  uuid not null references public.documents (id) on delete cascade,
  tag_id       uuid not null references public.document_tags (id) on delete cascade,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  primary key (document_id, tag_id)
);
create index if not exists idx_tag_links_tag on public.document_tag_links (tag_id);
create index if not exists idx_tag_links_company on public.document_tag_links (company_id);

-- ---------------------------------------------------------------------------
-- 4. Indici sulle interrogazioni che la lista fa DAVVERO
--
-- Non si aggiungono indici «per sicurezza»: ognuno di questi corrisponde a una
-- clausola che `list_documents` scrive sempre o quasi sempre.
-- ---------------------------------------------------------------------------
-- La lista predefinita: documenti non archiviati di un'azienda, dal più recente.
create index if not exists idx_documents_active
  on public.documents (company_id, created_at desc, id desc)
  where archived_at is null;
-- La barra laterale delle categorie e il filtro per categoria.
create index if not exists idx_documents_category
  on public.documents (company_id, category)
  where archived_at is null;
-- La vista «archiviati».
create index if not exists idx_documents_archived
  on public.documents (company_id, archived_at desc)
  where archived_at is not null;
-- Ricerca sui metadati del documento (titolo e nome del file originale).
create index if not exists idx_documents_text_trgm
  on public.documents using gin (
    (coalesce(title, '') || ' ' || coalesce(original_filename, '')) gin_trgm_ops
  );
-- «L'ultima analisi di questo documento», che la lista chiede per ogni riga.
create index if not exists idx_analyses_document_created
  on public.document_analyses (document_id, created_at desc);
-- Ricerca su mittente e oggetto, che stanno sull'analisi e non sul documento.
create index if not exists idx_analyses_text_trgm
  on public.document_analyses using gin (
    (coalesce(sender, '') || ' ' || coalesce(subject, '') || ' ' || coalesce(recipient, '')) gin_trgm_ops
  );
-- Le correzioni umane di un documento, lette per ogni riga della lista.
create index if not exists idx_corrections_document
  on public.analysis_corrections (document_id, corrected_at);
-- Le attività collegate a un documento.
create index if not exists idx_tasks_document
  on public.tasks (document_id) where document_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Ricerca nel testo estratto
--
-- ⚠️ CONFIGURAZIONE `simple`, E LA RAGIONE VA DICHIARATA.
-- I documenti di una PMI svizzera arrivano in italiano, tedesco e francese,
-- spesso nella stessa settimana. Una configurazione con radici (`italian`,
-- `german`…) migliora una lingua e PEGGIORA le altre due, perché applica a
-- tutti i testi le regole di una sola. `simple` non taglia le desinenze e non
-- toglie parole comuni: cerca esattamente le parole scritte.
--
-- IL PREZZO, dichiarato qui e nel README: cercando «Rechnung» non si trovano i
-- documenti che dicono «Rechnungen». È un limite reale, ed è preferibile a una
-- ricerca che funziona bene in una lingua e male nelle altre due. La ricerca
-- sui metadati resta a sottostringa (trigram), quindi «Rechnung» trova
-- comunque «Rechnungen» in titolo, mittente e oggetto.
--
-- ⚠️ IL TESTO INDICIZZATO È TRONCATO A 500'000 CARATTERI. Non è un
-- arrotondamento: un `tsvector` non può superare 1 MB, e una colonna generata
-- che solleva un'eccezione farebbe fallire il salvataggio dell'ESTRAZIONE,
-- cioè spegnerebbe l'analisi dei documenti molto lunghi. Cinquecentomila
-- caratteri sono circa duecentocinquanta pagine di testo; oltre quella soglia
-- la ricerca full-text non copre la coda del documento, e questo è scritto
-- anche in `docs/document-hub.md`.
-- ---------------------------------------------------------------------------
alter table public.document_extractions
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector('simple'::regconfig, left(coalesce(full_text, ''), 500000))
  ) stored;

create index if not exists idx_extractions_search
  on public.document_extractions using gin (search_tsv);

comment on column public.document_extractions.search_tsv is
  'Indice di ricerca del testo estratto, configurazione «simple» (nessuna radice, '
  'nessuna parola esclusa): i documenti arrivano in tre lingue e le regole di una '
  'sola peggiorerebbero le altre due. Copre i primi 500''000 caratteri.';

-- ---------------------------------------------------------------------------
-- 6. Conversioni difensive
--
-- Le correzioni umane sono salvate come JSON dal browser: una data corretta è
-- una stringa. Convertirla con `::date` dentro la lista significherebbe che una
-- sola correzione malformata fa fallire l'INTERA ricerca dell'azienda — un
-- guasto totale causato da un campo secondario. Queste due funzioni tornano
-- NULL invece di sollevare: il valore non convertibile viene ignorato e resta
-- quello dell'analisi, che è un dato vero.
-- ---------------------------------------------------------------------------
create or replace function public.try_date(p_text text)
returns date
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  return btrim(p_text)::date;
exception when others then
  return null;
end $$;

create or replace function public.try_numeric(p_text text)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_text is null or btrim(p_text) = '' then return null; end if;
  return btrim(p_text)::numeric;
exception when others then
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- 7. Classificazione deterministica
--
-- Nessuna chiamata AI: il documento è GIÀ stato analizzato, e da quell'analisi
-- si ricava la categoria quando il segnale è forte. Dove non lo è si torna
-- NULL, e il documento compare fra quelli da classificare — che è la verità.
-- Assegnare «altro» per non lasciare un vuoto sarebbe inventare una certezza.
--
-- L'ordine conta: il tipo di documento vince sul tipo di ente, perché una
-- fattura è una fattura anche se la manda un Comune. Il ripiego sull'ente
-- interviene solo quando il tipo non dice abbastanza.
--
-- Deliberatamente NON classificati: `declaration_request`,
-- `request_for_documents` e `information`. Una dichiarazione da presentare può
-- essere fiscale, sociale o statistica; una richiesta di documenti può venire
-- da chiunque. Il segnale non basta, e chi usa il prodotto se ne accorge
-- subito se la macchina indovina male.
-- ---------------------------------------------------------------------------
create or replace function public.document_category_from_analysis(
  p_document_type text,
  p_authority_type text
)
returns public.document_category
language sql
immutable
set search_path = ''
as $$
  select case
    -- (a) il tipo di documento, quando è già una collocazione
    when p_document_type = 'tax_document'      then 'taxes'::public.document_category
    when p_document_type = 'social_insurance'  then 'social_insurance'::public.document_category
    when p_document_type = 'employment'        then 'employees'::public.document_category
    when p_document_type = 'contract_related'  then 'contracts'::public.document_category
    when p_document_type = 'invoice'           then 'invoices'::public.document_category
    when p_document_type = 'permit'            then 'administration'::public.document_category
    when p_document_type = 'official_decision' then 'administration'::public.document_category
    when p_document_type = 'inspection_notice' then 'administration'::public.document_category

    -- (b) una richiesta di pagamento o un sollecito da un privato è una fattura;
    --     dallo Stato può essere un'imposta, una tassa o un canone, e quale
    --     delle tre non lo dice il tipo.
    when p_document_type in ('payment_request', 'reminder') and p_authority_type = 'private'
      then 'invoices'::public.document_category

    -- (c) il tipo di ente, quando il tipo di documento non ha deciso
    when p_authority_type = 'social_insurance' then 'social_insurance'::public.document_category
    when p_authority_type = 'pension'          then 'social_insurance'::public.document_category
    when p_authority_type = 'insurance'        then 'insurance'::public.document_category
    when p_authority_type in ('federal', 'cantonal', 'municipal')
      then 'administration'::public.document_category

    else null
  end;
$$;

comment on function public.document_category_from_analysis(text, text) is
  'Categoria ricavata da tipo di documento e tipo di ente. Torna NULL quando il '
  'segnale non basta: un documento non classificato è un fatto, una categoria '
  'plausibile ma sbagliata è un errore che nessuno nota.';

-- ---------------------------------------------------------------------------
-- 8. Il guardiano di `documents`
--
-- Come per le attività (0016), i timbri li mette il database. Il client può
-- mandare quello che vuole: chi ha archiviato, chi ha scelto la categoria e
-- quando lo decide `auth.uid()` e `now()`.
--
-- ⚠️ COME SI DISTINGUE UNA PERSONA DAL SISTEMA, e perché serve.
-- Due segnali, entrambi non falsificabili da un browser:
--   · `pg_trigger_depth() > 1` — l'aggiornamento arriva da un altro trigger,
--     cioè dalla classificazione automatica che scatta quando nasce un'analisi;
--   · `auth.uid() is null` — sta scrivendo il service role o una migrazione,
--     che è come lavorano le funzioni server e gli script (stessa condizione
--     già usata dal guardiano dei commenti nella 0016).
-- In quei due casi l'origine dichiarata viene rispettata; in tutti gli altri
-- chi cambia la categoria è una persona, e l'origine diventa «manual» con il
-- suo nome sopra. Così nessun client può spacciare una scelta propria per una
-- classificazione automatica, e viceversa.
-- ---------------------------------------------------------------------------
create or replace function public.documents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor  uuid := auth.uid();
  v_system boolean := v_actor is null or pg_trigger_depth() > 1;
begin
  -- (a) Categoria
  if new.category is null then
    -- Nessuna categoria: non c'è nulla da attribuire a nessuno, né quando la
    -- si toglie né quando non c'è mai stata.
    new.category_source := null;
    new.category_set_by := null;
    new.category_set_at := null;
  elsif v_system then
    -- Il sistema scrive ciò che dichiara. Se ha messo una categoria senza dire
    -- da dove viene, viene dalla regola: è l'unico modo in cui il sistema
    -- classifica.
    if new.category_source is null then
      new.category_source := 'rule';
      new.category_set_at := coalesce(new.category_set_at, now());
    end if;
  elsif tg_op = 'INSERT' or new.category is distinct from old.category then
    new.category_source := 'manual';
    new.category_set_by := v_actor;
    new.category_set_at := now();
  else
    -- Categoria invariata: i timbri restano quelli. Chi ha classificato non
    -- cambia perché qualcuno ha corretto il titolo.
    new.category_source := old.category_source;
    new.category_set_by := old.category_set_by;
    new.category_set_at := old.category_set_at;
  end if;

  -- (b) Archiviazione. Il client dichiara l'intenzione valorizzando
  --     `archived_at`; il valore vero lo mette il database.
  if new.archived_at is not null then
    if tg_op = 'INSERT' or old.archived_at is null then
      new.archived_at := now();
      new.archived_by := v_actor;
    else
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
    end if;
  else
    new.archived_by := null;
  end if;

  -- (c) Nota interna: chi l'ha scritta e quando.
  if tg_op = 'INSERT' then
    if new.internal_notes is not null then
      new.notes_updated_at := now();
      new.notes_updated_by := v_actor;
    else
      new.notes_updated_at := null;
      new.notes_updated_by := null;
    end if;
  elsif new.internal_notes is distinct from old.internal_notes then
    new.notes_updated_at := now();
    new.notes_updated_by := v_actor;
  else
    new.notes_updated_at := old.notes_updated_at;
    new.notes_updated_by := old.notes_updated_by;
  end if;

  return new;
end $$;

drop trigger if exists trg_documents_guard on public.documents;
create trigger trg_documents_guard
  before insert or update on public.documents
  for each row execute function public.documents_guard();

-- ---------------------------------------------------------------------------
-- 9. Classificazione automatica quando arriva un'analisi
--
-- Si applica SOLO se nessuno ha ancora classificato il documento: una scelta
-- fatta da una persona non viene mai sovrascritta da una rianalisi. È
-- deliberatamente un trigger e non una colonna calcolata, perché la categoria
-- deve poter essere cambiata a mano e restare cambiata.
-- ---------------------------------------------------------------------------
create or replace function public.documents_autoclassify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_category public.document_category;
begin
  -- Un'analisi fallita non descrive niente: non se ne ricava una collocazione.
  if new.analysis_status = 'failed' then return new; end if;

  v_category := public.document_category_from_analysis(new.document_type, new.sender_authority_type);
  if v_category is null then return new; end if;

  -- ⚠️ `d.company_id = new.company_id` NON è ridondante, ed è la riga più
  -- importante di questa funzione.
  --
  -- Questa funzione è `security definer`: scrive su `documents` SENZA passare
  -- dalla RLS. La policy di inserimento delle analisi (0010) verifica che chi
  -- inserisce sia membro dell'azienda dichiarata, ma NON che il documento
  -- indicato appartenga a quella stessa azienda. Senza questo confronto, un
  -- membro dell'azienda A potrebbe inserire un'analisi con la PROPRIA
  -- `company_id` e il `document_id` di un documento dell'azienda B, e questo
  -- trigger avrebbe scritto una categoria su un documento di B.
  -- (La falla di partenza viene chiusa qui sotto, al punto 9bis; questa riga
  -- resta comunque, perché una funzione che scavalca la RLS deve difendersi da
  -- sola e non fidarsi di una policy scritta altrove.)
  update public.documents d
     set category = v_category
   where d.id = new.document_id
     and d.company_id = new.company_id
     and d.category is null
     and d.category_source is distinct from 'manual';

  return new;
end $$;

drop trigger if exists trg_documents_autoclassify on public.document_analyses;
create trigger trg_documents_autoclassify
  after insert on public.document_analyses
  for each row execute function public.documents_autoclassify();

-- ---------------------------------------------------------------------------
-- 9bis. Un'analisi appartiene al documento della PROPRIA azienda
--
-- Falla trovata rileggendo la 0010 con l'occhio di chi vuole abusarne, mentre
-- si scriveva la classificazione automatica. La policy di inserimento verifica
-- che chi scrive sia membro dell'azienda DICHIARATA nella riga, ma nessuno
-- verificava che il `document_id` appartenesse a quella azienda: un membro di A
-- poteva creare righe di analisi agganciate ai documenti di B.
--
-- Da sola non era una fuga di dati — la RLS in lettura filtra per `company_id`,
-- quindi B non vedeva quelle righe e A non vedeva i documenti di B — ma era
-- scrittura in casa d'altri, e la classificazione automatica l'avrebbe resa
-- visibile. Si chiude qui, dove è stata trovata, invece di lasciarla aperta
-- perché «non è di questa migrazione».
-- ---------------------------------------------------------------------------
drop policy if exists analyses_insert_member on public.document_analyses;
create policy analyses_insert_member on public.document_analyses
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and engine like 'deterministic-%'              -- niente righe che si spacciano per AI
    and provider is null
    and model is null
    and prompt_version is null
    and exists (
      select 1 from public.documents d
      where d.id = document_id and d.company_id = company_id
    )
  );

comment on policy analyses_insert_member on public.document_analyses is
  'Il client può inserire solo analisi del motore locale, senza provenienza AI, '
  'e SOLO su documenti della stessa azienda dichiarata nella riga.';

-- ---------------------------------------------------------------------------
-- 10. Etichette: appartenenza verificata dal database
--
-- Il caso obliquo è lo stesso già visto con la checklist delle attività: un
-- membro dichiara la PROPRIA azienda e aggancia l'etichetta a un documento di
-- un'altra. La RLS da sola lascerebbe passare — la company dichiarata è
-- davvero la sua — e per questo il controllo confronta le tre appartenenze.
-- ---------------------------------------------------------------------------
create or replace function public.document_tag_link_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_doc_company uuid;
  v_tag_company uuid;
  v_count integer;
begin
  select d.company_id into v_doc_company from public.documents d where d.id = new.document_id;
  select g.company_id into v_tag_company from public.document_tags g where g.id = new.tag_id;

  if v_doc_company is null or v_tag_company is null
     or v_doc_company is distinct from new.company_id
     or v_tag_company is distinct from new.company_id then
    raise exception 'tag_company_mismatch'
      using errcode = '23514',
            hint = 'Etichetta e documento devono appartenere alla stessa azienda.';
  end if;

  -- Un tetto al numero di etichette per documento: venti sono già molte, e
  -- oltre quella soglia le etichette smettono di aiutare a ritrovare qualcosa.
  select count(*) into v_count from public.document_tag_links l where l.document_id = new.document_id;
  if v_count >= 20 then
    raise exception 'too_many_tags'
      using errcode = '23514', hint = 'Un documento può avere al massimo venti etichette.';
  end if;

  new.created_by := auth.uid();
  return new;
end $$;

drop trigger if exists trg_tag_link_guard on public.document_tag_links;
create trigger trg_tag_link_guard
  before insert on public.document_tag_links
  for each row execute function public.document_tag_link_guard();

create or replace function public.document_tag_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.name := btrim(new.name);
  if tg_op = 'INSERT' then new.created_by := auth.uid(); end if;
  return new;
end $$;

drop trigger if exists trg_document_tag_guard on public.document_tags;
create trigger trg_document_tag_guard
  before insert or update on public.document_tags
  for each row execute function public.document_tag_guard();

-- ---------------------------------------------------------------------------
-- 11. La lista: ricerca, filtri, ordinamento e paginazione nel database
--
-- Perché una funzione e non query dal client: una riga della lista mette
-- insieme il documento, l'ultima analisi, le correzioni umane, le etichette,
-- le attività collegate e le comunicazioni di provenienza. Fatto dal browser
-- sarebbe una query per documento per relazione — venticinque righe, cento
-- interrogazioni — e per sapere quali venticinque righe mostrare bisognerebbe
-- averle scaricate tutte.
--
-- `security invoker` (il default): la RLS di ogni tabella continua ad
-- applicarsi riga per riga. Il filtro esplicito su `company_id` e il controllo
-- di appartenenza NON la sostituiscono, la accompagnano. Una funzione di
-- ricerca è il posto più facile del mondo per aggirare per sbaglio l'isolamento
-- fra aziende, e qui gli strati sono tre.
--
-- PAGINAZIONE A SCORRIMENTO (offset) e non a cursore, con motivazione: la
-- pagina mostra «venticinque di duecentodiciotto», la barra laterale mostra i
-- conteggi per categoria e l'ordinamento cambia con un menu. Un cursore
-- keyset — che nell'Inbox è la scelta giusta, perché lì si scorre una sola
-- lista sempre nello stesso ordine — qui impedirebbe di dire quanti sono e di
-- saltare avanti. L'ordinamento porta SEMPRE `id` come ultimo criterio: senza,
-- due documenti creati nello stesso istante si scambierebbero di posto fra una
-- pagina e l'altra, e uno dei due non comparirebbe mai.
-- ---------------------------------------------------------------------------
create or replace function public.list_documents(
  p_company_id      uuid,
  p_query           text default null,
  p_category        public.document_category default null,
  p_uncategorized   boolean default false,
  p_source          public.document_source_type default null,
  p_state           text default null,      -- to_verify | analyzed | failed | processing | none
  p_tag_ids         uuid[] default null,
  p_date_from       date default null,
  p_date_to         date default null,
  p_has_deadline    boolean default false,
  p_archived        boolean default false,
  p_sort            text default 'recent',  -- recent | oldest | document_date | title | deadline
  p_limit           integer default 25,
  p_offset          integer default 0,
  -- Un solo documento. Serve al DETTAGLIO, e non è una comodità: la riga della
  -- lista e la testata del dettaglio devono dire la stessa cosa sullo stesso
  -- documento — stessa analisi scelta, stesse correzioni applicate. Con due
  -- implementazioni diverse prima o poi divergono, e a divergere sarebbero
  -- proprio mittente e scadenza.
  p_document_id     uuid default null
)
returns table (
  id uuid,
  title text,
  original_filename text,
  mime_type text,
  file_size bigint,
  storage_path text,
  source_type public.document_source_type,
  status public.document_status,
  page_count integer,
  created_at timestamptz,
  archived_at timestamptz,
  category public.document_category,
  category_source public.document_category_source,
  analysis_id uuid,
  analysis_status public.analysis_status,
  last_attempt_failed boolean,
  error_code text,
  document_type text,
  document_type_corrected boolean,
  sender text,
  sender_corrected boolean,
  sender_authority_type text,
  document_date date,
  deadline date,
  deadline_corrected boolean,
  deadline_requires_verification boolean,
  amount numeric,
  amount_currency text,
  amount_corrected boolean,
  confidence text,
  tags jsonb,
  open_task_count bigint,
  task_count bigint,
  email_count bigint,
  snippet text,
  total_count bigint
)
language sql
stable
set search_path = ''
as $$
  with params as (
    select
      -- I caratteri jolly digitati da una persona devono cercare sé stessi:
      -- un `%` in una ricerca è un per cento, non «qualsiasi cosa».
      nullif(btrim(left(coalesce(p_query, ''), 120)), '') as q,
      replace(replace(replace(
        btrim(left(coalesce(p_query, ''), 120)), '\', '\\'), '%', '\%'), '_', '\_') as q_like
  ),
  base as (
    select
      d.*,
      -- L'ULTIMO tentativo: dice lo STATO, anche quando è un fallimento.
      last_try.id            as try_id,
      last_try.analysis_status as try_status,
      last_try.error_code    as try_error,
      -- L'ultima analisi VALIDA: dice il CONTENUTO. Se l'ultimo tentativo è
      -- fallito ma prima esisteva un risultato buono, quel risultato non
      -- scompare — è la stessa regola di `analysisService.getForDocument`,
      -- e averne due diverse farebbe dire due cose alla stessa schermata.
      good.id                as good_id,
      good.document_type     as a_document_type,
      good.sender            as a_sender,
      good.sender_authority_type as a_authority,
      good.document_date     as a_document_date,
      good.deadline          as a_deadline,
      good.deadline_requires_verification as a_deadline_verify,
      good.amount            as a_amount,
      good.amount_currency   as a_currency,
      good.confidence        as a_confidence,
      corr.v                 as corrections,
      count(*) over ()       as n_total
    from public.documents d
    left join lateral (
      select a.id, a.analysis_status, a.error_code
      from public.document_analyses a
      -- Il confronto sull'azienda accompagna la RLS, non la sostituisce: è la
      -- disciplina di questo progetto, e qui evita anche che un'analisi
      -- agganciata per errore a un documento altrui possa mai essere letta.
      where a.document_id = d.id and a.company_id = d.company_id
      order by a.created_at desc, a.id desc
      limit 1
    ) last_try on true
    left join lateral (
      select a.*
      from public.document_analyses a
      where a.document_id = d.id and a.company_id = d.company_id
        and a.analysis_status <> 'failed'
      order by a.created_at desc, a.id desc
      limit 1
    ) good on true
    left join lateral (
      -- Un solo passaggio sulle correzioni del documento: le più recenti
      -- sovrascrivono le precedenti perché `jsonb_object_agg` tiene l'ultimo
      -- valore di ogni chiave.
      select jsonb_object_agg(c.field, c.corrected_value) as v
      from (
        select c2.field, c2.corrected_value
        from public.analysis_corrections c2
        where c2.document_id = d.id and c2.company_id = d.company_id
        order by c2.corrected_at asc
      ) c
    ) corr on true
    where d.company_id = p_company_id
      -- Sottointerrogazione scalare: l'appartenenza si verifica UNA volta per
      -- interrogazione e non una volta per riga.
      and (select public.is_company_member(p_company_id))
      and (p_document_id is null or d.id = p_document_id)
      -- Chiedendo UN documento non si applica il filtro di archiviazione: il suo
      -- indirizzo deve funzionare anche dopo che è stato archiviato, altrimenti
      -- «archivia» diventerebbe indistinguibile da «fai sparire».
      and (p_document_id is not null
           or (case when p_archived then d.archived_at is not null else d.archived_at is null end))
      and (p_category is null or d.category = p_category)
      and (not p_uncategorized or d.category is null)
      and (p_source is null or d.source_type = p_source)
      and (p_tag_ids is null or array_length(p_tag_ids, 1) is null or exists (
            select 1 from public.document_tag_links l
            where l.document_id = d.id and l.company_id = d.company_id
              and l.tag_id = any (p_tag_ids)
          ))
      and (not p_has_deadline or coalesce(
            public.try_date(corr.v ->> 'deadline'), good.deadline) is not null)
      and (p_date_from is null or coalesce(
            public.try_date(corr.v ->> 'document_date'), good.document_date,
            d.created_at::date) >= p_date_from)
      and (p_date_to is null or coalesce(
            public.try_date(corr.v ->> 'document_date'), good.document_date,
            d.created_at::date) <= p_date_to)
      and (
        p_state is null
        or (p_state = 'failed'     and last_try.analysis_status = 'failed')
        or (p_state = 'to_verify'  and last_try.analysis_status = 'needs_review')
        or (p_state = 'analyzed'   and last_try.analysis_status = 'completed')
        -- «In elaborazione» è uno stato del DOCUMENTO, non dell'analisi: fra il
        -- caricamento e la prima riga di analisi non esiste ancora nulla da
        -- interrogare, ed è proprio il momento in cui una persona si chiede
        -- dove sia finito il suo file.
        or (p_state = 'processing' and d.status in ('extracting', 'analyzing', 'processing'))
        or (p_state = 'none'       and last_try.id is null
              and d.status not in ('extracting', 'analyzing', 'processing'))
      )
      and (
        (select q from params) is null
        or d.title ilike '%' || (select q_like from params) || '%'
        or coalesce(d.original_filename, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(good.sender, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(good.subject, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(good.recipient, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(good.document_type, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(good.reference_numbers::text, '') ilike '%' || (select q_like from params) || '%'
        or coalesce(corr.v::text, '') ilike '%' || (select q_like from params) || '%'
        or exists (
             select 1 from public.document_tag_links l
             join public.document_tags g on g.id = l.tag_id and g.company_id = l.company_id
             where l.document_id = d.id and l.company_id = d.company_id
               and g.name ilike '%' || (select q_like from params) || '%'
           )
        or exists (
             select 1 from public.document_extractions e
             where e.document_id = d.id and e.company_id = d.company_id
               and e.search_tsv @@ plainto_tsquery('simple'::regconfig, (select q from params))
           )
      )
    order by
      case when p_sort = 'oldest' then d.created_at end asc nulls last,
      case when p_sort = 'title' then lower(d.title) end asc nulls last,
      case when p_sort = 'document_date'
           then coalesce(public.try_date(corr.v ->> 'document_date'), good.document_date) end desc nulls last,
      case when p_sort = 'deadline'
           then coalesce(public.try_date(corr.v ->> 'deadline'), good.deadline) end asc nulls last,
      case when p_sort in ('oldest', 'title', 'document_date', 'deadline')
           then null else d.created_at end desc nulls last,
      -- Ultimo criterio SEMPRE presente: senza, due righe uguali possono
      -- scambiarsi di posto fra una pagina e l'altra.
      d.id desc
    limit greatest(1, least(coalesce(p_limit, 25), 100))
    offset greatest(0, coalesce(p_offset, 0))
  )
  select
    b.id, b.title, b.original_filename, b.mime_type, b.file_size, b.storage_path,
    b.source_type, b.status, b.page_count, b.created_at, b.archived_at,
    b.category, b.category_source,
    coalesce(b.good_id, b.try_id) as analysis_id,
    b.try_status as analysis_status,
    -- `coalesce` fino in fondo: senza analisi queste espressioni valgono NULL, e
    -- un NULL che arriva al posto di un «no» diventa, nel browser, un «forse».
    coalesce(b.try_status = 'failed' and b.good_id is not null, false) as last_attempt_failed,
    b.try_error as error_code,
    -- Valore EFFETTIVO: la correzione umana se c'è, altrimenti il dato
    -- dell'analisi. Il valore originale dell'AI non viene toccato e resta
    -- leggibile nel dettaglio: qui si mostra ciò che l'azienda ritiene vero.
    coalesce(b.corrections ->> 'document_type', b.a_document_type) as document_type,
    coalesce(b.corrections ? 'document_type', false) as document_type_corrected,
    coalesce(b.corrections ->> 'sender', b.a_sender) as sender,
    coalesce(b.corrections ? 'sender', false) as sender_corrected,
    b.a_authority as sender_authority_type,
    coalesce(public.try_date(b.corrections ->> 'document_date'), b.a_document_date) as document_date,
    coalesce(public.try_date(b.corrections ->> 'deadline'), b.a_deadline) as deadline,
    coalesce(b.corrections ? 'deadline', false) as deadline_corrected,
    coalesce(b.a_deadline_verify, false) as deadline_requires_verification,
    coalesce(public.try_numeric(b.corrections ->> 'amount'), b.a_amount) as amount,
    b.a_currency as amount_currency,
    coalesce(b.corrections ? 'amount', false) as amount_corrected,
    b.a_confidence as confidence,
    coalesce(tg.v, '[]'::jsonb) as tags,
    coalesce(tk.open_count, 0) as open_task_count,
    coalesce(tk.all_count, 0) as task_count,
    coalesce(em.n, 0) as email_count,
    -- L'estratto si calcola SOLO sulle righe che si mostrano davvero, ed è
    -- testo semplice: i due delimitatori li interpreta React costruendo
    -- elementi, non inserendo HTML. Nel Document Hub non esiste markup
    -- proveniente da un documento.
    case
      when (select q from params) is null then null
      else (
        -- I delimitatori sono fra virgolette perché l'elenco delle opzioni è
        -- separato da virgole: un valore non quotato che contiene caratteri
        -- speciali verrebbe interpretato male.
        select ts_headline('simple'::regconfig, left(coalesce(e.full_text, ''), 500000),
                 plainto_tsquery('simple'::regconfig, (select q from params)),
                 'StartSel="[[", StopSel="]]", MaxWords=22, MinWords=8, MaxFragments=1')
        from public.document_extractions e
        where e.document_id = b.id and e.company_id = b.company_id
          and e.search_tsv @@ plainto_tsquery('simple'::regconfig, (select q from params))
        limit 1
      )
    end as snippet,
    b.n_total as total_count
  from base b
  left join lateral (
    select jsonb_agg(jsonb_build_object('id', g.id, 'name', g.name) order by g.name) as v
    from public.document_tag_links l
    join public.document_tags g on g.id = l.tag_id and g.company_id = l.company_id
    where l.document_id = b.id and l.company_id = b.company_id
  ) tg on true
  left join lateral (
    select
      count(*) filter (where t.status <> 'completed' and t.archived_at is null) as open_count,
      count(*) as all_count
    from public.tasks t where t.document_id = b.id and t.company_id = b.company_id
  ) tk on true
  left join lateral (
    select count(*) as n
    from public.email_message_documents m
    where m.document_id = b.id and m.company_id = b.company_id
  ) em on true
  -- Lo stesso ordine della selezione, espressione per espressione. Ordinare
  -- l'esterno in modo diverso dall'interno vorrebbe dire scegliere venticinque
  -- righe secondo un criterio e mostrarle secondo un altro: la pagina due non
  -- verrebbe dopo la pagina uno.
  order by
    case when p_sort = 'oldest' then b.created_at end asc nulls last,
    case when p_sort = 'title' then lower(b.title) end asc nulls last,
    case when p_sort = 'document_date'
         then coalesce(public.try_date(b.corrections ->> 'document_date'), b.a_document_date) end desc nulls last,
    case when p_sort = 'deadline'
         then coalesce(public.try_date(b.corrections ->> 'deadline'), b.a_deadline) end asc nulls last,
    case when p_sort in ('oldest', 'title', 'document_date', 'deadline')
         then null else b.created_at end desc nulls last,
    b.id desc;
$$;

revoke all on function public.list_documents(uuid, text, public.document_category, boolean, public.document_source_type, text, uuid[], date, date, boolean, boolean, text, integer, integer, uuid) from public, anon;
grant execute on function public.list_documents(uuid, text, public.document_category, boolean, public.document_source_type, text, uuid[], date, date, boolean, boolean, text, integer, integer, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. Conteggi per categoria
--
-- Una aggregazione sola invece di dodici interrogazioni. I conteggi seguono lo
-- stesso filtro di archiviazione della lista: mostrare «Imposte 18» accanto a
-- una lista che ne contiene 12 perché sei sono archiviate sarebbe un numero
-- che non corrisponde a niente di visibile.
-- ---------------------------------------------------------------------------
create or replace function public.document_category_counts(
  p_company_id uuid,
  p_archived   boolean default false
)
returns table (category public.document_category, n bigint)
language sql
stable
set search_path = ''
as $$
  select d.category, count(*)
  from public.documents d
  where d.company_id = p_company_id
    and (select public.is_company_member(p_company_id))
    and (case when p_archived then d.archived_at is not null else d.archived_at is null end)
  group by d.category;
$$;

revoke all on function public.document_category_counts(uuid, boolean) from public, anon;
grant execute on function public.document_category_counts(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Azioni di gruppo: tutte o nessuna
--
-- ⚠️ Un'azione su più documenti che ne trova uno di un'altra azienda NON deve
-- fare metà lavoro. La RLS impedirebbe comunque di toccare il documento altrui,
-- ma il risultato sarebbe «fatto» su quattro righe su cinque, senza che nessuno
-- sappia quale è rimasta indietro. Qui il conteggio viene confrontato PRIMA di
-- scrivere: se non torna, non si scrive niente e si dice perché.
--
-- `security invoker`: la RLS resta in vigore, quindi il conteggio vede solo i
-- documenti che il chiamante può davvero vedere.
-- ---------------------------------------------------------------------------
create or replace function public.documents_assert_all_mine(p_company_id uuid, p_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_found integer;
  v_asked integer := coalesce(array_length(p_ids, 1), 0);
begin
  if v_asked = 0 then
    raise exception 'no_documents_selected'
      using errcode = '23514', hint = 'Nessun documento selezionato.';
  end if;
  if v_asked > 200 then
    raise exception 'too_many_documents'
      using errcode = '23514', hint = 'Al massimo duecento documenti per volta.';
  end if;
  if not public.is_company_member(p_company_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  select count(*) into v_found
  from public.documents d
  where d.id = any (p_ids) and d.company_id = p_company_id;

  if v_found <> v_asked then
    raise exception 'documents_not_all_visible'
      using errcode = '42501',
            hint = 'Alcuni documenti selezionati non appartengono a questa azienda.';
  end if;
end $$;

create or replace function public.documents_bulk_set_category(
  p_company_id uuid,
  p_ids        uuid[],
  p_category   public.document_category
)
returns integer
language plpgsql
set search_path = ''
as $$
declare v_n integer;
begin
  perform public.documents_assert_all_mine(p_company_id, p_ids);
  update public.documents set category = p_category
   where id = any (p_ids) and company_id = p_company_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.documents_bulk_archive(
  p_company_id uuid,
  p_ids        uuid[],
  p_archived   boolean
)
returns integer
language plpgsql
set search_path = ''
as $$
declare v_n integer;
begin
  perform public.documents_assert_all_mine(p_company_id, p_ids);
  update public.documents
     set archived_at = case when p_archived then now() else null end
   where id = any (p_ids) and company_id = p_company_id;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

create or replace function public.documents_bulk_add_tag(
  p_company_id uuid,
  p_ids        uuid[],
  p_tag_id     uuid
)
returns integer
language plpgsql
set search_path = ''
as $$
declare v_n integer;
begin
  perform public.documents_assert_all_mine(p_company_id, p_ids);
  insert into public.document_tag_links (company_id, document_id, tag_id)
  select p_company_id, x, p_tag_id from unnest(p_ids) as x
  on conflict (document_id, tag_id) do nothing;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

revoke all on function public.documents_assert_all_mine(uuid, uuid[]) from public, anon;
revoke all on function public.documents_bulk_set_category(uuid, uuid[], public.document_category) from public, anon;
revoke all on function public.documents_bulk_archive(uuid, uuid[], boolean) from public, anon;
revoke all on function public.documents_bulk_add_tag(uuid, uuid[], uuid) from public, anon;
grant execute on function public.documents_assert_all_mine(uuid, uuid[]) to authenticated;
grant execute on function public.documents_bulk_set_category(uuid, uuid[], public.document_category) to authenticated;
grant execute on function public.documents_bulk_archive(uuid, uuid[], boolean) to authenticated;
grant execute on function public.documents_bulk_add_tag(uuid, uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 14. RLS e permessi
--
-- ⚠️ `revoke all` PRIMA dei grant sulle tabelle nuove. Su Supabase una tabella
-- di `public` nasce con i permessi di tabella completi per `anon` e
-- `authenticated`, quindi un grant scritto dopo AGGIUNGE privilegi invece di
-- restringerli: è la lezione della 0014, dove i permessi di colonna della 0013
-- non restringevano nulla.
-- ---------------------------------------------------------------------------
alter table public.document_tags       enable row level security;
alter table public.document_tag_links  enable row level security;

revoke all on public.document_tags      from anon, authenticated, public;
revoke all on public.document_tag_links from anon, authenticated, public;

grant select, insert, update, delete on public.document_tags to authenticated;
grant select, insert, delete on public.document_tag_links to authenticated;

drop policy if exists document_tags_select on public.document_tags;
create policy document_tags_select on public.document_tags
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists document_tags_insert on public.document_tags;
create policy document_tags_insert on public.document_tags
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists document_tags_update on public.document_tags;
create policy document_tags_update on public.document_tags
  for update to authenticated using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
-- Cancellare un'etichetta la toglie da tutti i documenti (cascade sui
-- collegamenti): è una modifica che riguarda l'intera azienda, quindi resta a
-- chi la amministra.
drop policy if exists document_tags_delete on public.document_tags;
create policy document_tags_delete on public.document_tags
  for delete to authenticated using (public.is_company_admin(company_id));

drop policy if exists document_tag_links_select on public.document_tag_links;
create policy document_tag_links_select on public.document_tag_links
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists document_tag_links_insert on public.document_tag_links;
create policy document_tag_links_insert on public.document_tag_links
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists document_tag_links_delete on public.document_tag_links;
create policy document_tag_links_delete on public.document_tag_links
  for delete to authenticated using (public.is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- 15. Cancellazione definitiva: chi può
--
-- Fino alla 0016 qualunque membro poteva cancellare qualunque documento
-- dell'azienda, e la cancellazione era l'unico modo di togliere qualcosa dalla
-- lista. Ora togliere si fa ARCHIVIANDO — che non perde niente — e la
-- cancellazione definitiva diventa rara e distruttiva: porta via con sé
-- analisi, estrazioni, correzioni, collegamenti alle email e alle attività.
--
-- La regola: la amministra chi amministra l'azienda (owner o admin). Un membro
-- può cancellare soltanto ciò che ha caricato lui — che comprende il caso in
-- cui l'upload del file fallisce e il servizio deve rimuovere il record appena
-- creato. I documenti arrivati dalla posta hanno `uploaded_by` nullo, quindi
-- restano cancellabili solo da un amministratore.
-- ---------------------------------------------------------------------------
drop policy if exists documents_delete_member on public.documents;
drop policy if exists documents_delete_admin_or_owner on public.documents;
create policy documents_delete_admin_or_owner on public.documents
  for delete to authenticated
  using (
    public.is_company_admin(company_id)
    or (public.is_company_member(company_id) and uploaded_by = auth.uid())
  );

comment on policy documents_delete_admin_or_owner on public.documents is
  'La cancellazione definitiva è degli amministratori; un membro può cancellare solo '
  'i documenti che ha caricato. Per togliere un documento dalle viste si archivia.';

-- ---------------------------------------------------------------------------
-- 16. Classificazione dei documenti già presenti
--
-- Derivazione UNA TANTUM: i documenti che hanno già un'analisi ricevono la
-- categoria che la regola sa dedurre, con origine «rule». Quelli su cui la
-- regola non decide restano senza categoria e compaiono fra i documenti da
-- classificare. Nessuna categoria viene inventata per riempire un vuoto.
--
-- ⚠️ L'aggiornamento passa dal trigger `documents_guard`. Qui `auth.uid()` è
-- nullo — la migrazione la esegue chi amministra il database, non un utente —
-- quindi il guardiano riconosce una scrittura di sistema e registra l'origine
-- «rule» invece di attribuire la classificazione a una persona. Se non fosse
-- così, duecento documenti risulterebbero classificati a mano da nessuno.
-- ---------------------------------------------------------------------------
do $$
declare
  v_touched integer;
begin
  with latest as (
    select distinct on (a.document_id)
      a.document_id, a.document_type, a.sender_authority_type
    from public.document_analyses a
    where a.analysis_status <> 'failed'
    order by a.document_id, a.created_at desc, a.id desc
  ),
  guessed as (
    select l.document_id,
           public.document_category_from_analysis(l.document_type, l.sender_authority_type) as cat
    from latest l
  )
  update public.documents d
     set category = g.cat
    from guessed g
   where d.id = g.document_id
     and g.cat is not null
     and d.category is null;
  get diagnostics v_touched = row_count;
  raise notice 'Documenti classificati dalla regola: %', v_touched;
end $$;

-- ---------------------------------------------------------------------------
-- 17. Autoverifica: la migrazione controlla di aver ottenuto ciò che dichiara.
--
-- Non è un ornamento. La 0013 dichiarava nei commenti una garanzia che non
-- esisteva, e lo si è scoperto solo eseguendo i test sul database vero: da
-- allora ogni migrazione che promette qualcosa la verifica prima di dirsi
-- riuscita.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
  v_cat public.document_category;
begin
  -- (a) Le tabelle nuove non devono essere scrivibili oltre quanto concesso.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'document_tag_links'
    and grantee in ('anon', 'authenticated', 'public')
    and privilege_type = 'UPDATE';
  if v_bad is not null then
    raise exception 'i collegamenti delle etichette risultano modificabili: %', v_bad;
  end if;

  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('document_tags', 'document_tag_links')
    and grantee = 'anon';
  if v_bad is not null then
    raise exception 'le etichette risultano accessibili senza autenticazione: %', v_bad;
  end if;

  -- (b) La regola di classificazione fa quello che dice, sui casi che contano.
  v_cat := public.document_category_from_analysis('tax_document', 'federal');
  if v_cat is distinct from 'taxes' then
    raise exception 'la regola non classifica un documento fiscale fra le imposte (ha detto %)', v_cat;
  end if;
  v_cat := public.document_category_from_analysis('reminder', 'private');
  if v_cat is distinct from 'invoices' then
    raise exception 'la regola non classifica un sollecito privato fra le fatture (ha detto %)', v_cat;
  end if;
  v_cat := public.document_category_from_analysis('information', 'unknown');
  if v_cat is not null then
    raise exception 'la regola inventa una categoria dove non ha elementi (ha detto %)', v_cat;
  end if;

  -- (c) Le conversioni difensive non devono sollevare su un valore sbagliato.
  if public.try_date('non è una data') is not null then
    raise exception 'try_date non torna NULL su un testo non convertibile';
  end if;
  if public.try_numeric('12,50 CHF') is not null then
    raise exception 'try_numeric non torna NULL su un testo non convertibile';
  end if;
end $$;
