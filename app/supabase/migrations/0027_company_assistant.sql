-- ============================================================================
-- 0027 — COMPANY ASSISTANT: «CHIEDI AD AI-SWISSE»
--
-- Come posso interrogare tutto questo con una sola domanda? È l'unica cosa che
-- questo modulo aggiunge. Fino alla 0026 il prodotto sapeva che cosa è arrivato
-- (Inbox), che cosa sappiamo (Documenti), che cosa dobbiamo fare (Attività),
-- quando (Calendario), che cosa non dimenticare (Notifiche), che cosa può fare
-- da sé (Automazioni), quali operazioni finanziarie richiedono attenzione
-- (Finanze), a quali impegni siamo legati (Contratti) e con chi stiamo
-- lavorando (Clienti). Nove risposte, nove schermate da aprire a mano.
--
-- ⚠️ QUESTO MODULO NON CONTIENE DATI AZIENDALI. È la regola che governa ogni
-- riga di questo file. Nessuna tabella qui dentro contiene il titolo di
-- un'attività, l'importo di una fattura, il testo di una clausola, il nome di
-- un cliente o il corpo di una email. Contiene DOMANDE, RISPOSTE e RIFERIMENTI.
-- La risposta dell'assistente è testo che una persona ha letto e che va
-- conservato tale e quale; la citazione è un puntatore alla fonte, con quel
-- tanto di istantanea (`value_snapshot`, `cited_text`) che serve a capire su
-- quale stato della fonte la risposta si basava — non una copia della fonte.
-- È la stessa regola della 0026, sezione «COLLEGARE, NON COPIARE», e qui è
-- ancora più stringente: l'assistente attraversa TUTTI i moduli, e una copia
-- fatta qui sarebbe una seconda verità per l'intera azienda.
--
-- ⚠️ NESSUN RAGIONAMENTO PRIVATO DEL MODELLO VIENE MEMORIZZATO. Non esiste una
-- colonna `reasoning`, `thinking` o `chain_of_thought`, e non deve esistere.
-- Si conservano: la domanda, gli strumenti invocati con i parametri ripuliti,
-- il numero di risultati, la risposta finale, le citazioni, le metriche e gli
-- errori. Ciò che il modello ha pensato per arrivarci non è un fatto aziendale
-- e non è verificabile: conservarlo darebbe a una deliberazione interna la
-- stessa dignità di una fonte.
--
-- ⚠️ IL MODELLO NON VEDE QUESTO SCHEMA E NON INTERROGA IL DATABASE. Non ci sono
-- funzioni di query generiche, niente SQL generato, niente nomi di tabella nel
-- prompt. Il modello può chiamare solo strumenti tipizzati dichiarati nel
-- registro server-side, e ogni strumento passa dalle RPC che già esistono
-- (`list_tasks`, `list_documents`, `list_finance_items`, `list_contracts`,
-- `list_crm_organizations`, `list_crm_opportunities`, `crm_timeline`…), cioè
-- dalle stesse letture che l'interfaccia usa da mesi, con la stessa RLS.
--
-- ⚠️ LA CONVERSAZIONE È PRIVATA DI CHI L'HA SCRITTA. Le policy di select
-- richiedono `is_company_member(company_id) AND created_by = auth.uid()`, e non
-- la sola appartenenza all'azienda. La ragione è che una domanda è una domanda:
-- «che cosa devo fare oggi», «quali fatture ho dimenticato», «perché questo
-- cliente non risponde» dicono di chi le scrive quanto dicono dell'azienda.
-- I DATI restano aziendali e si leggono nei moduli; la CONVERSAZIONE no.
-- Questo soddisfa anche la revoca dell'accesso: tolta la membership, la prima
-- condizione cade e i thread non sono più apribili — messaggi, citazioni e
-- fonti comprese, perché ereditano la stessa condizione.
--
-- ⚠️ UN THREAD NON CAMBIA AZIENDA. `assistant_threads_guard` blocca la modifica
-- di `company_id` e `created_by`. Senza quel guardiano, cambiare azienda
-- attiva mentre una conversazione è aperta trascinerebbe le risposte di
-- un'impresa dentro il contesto di un'altra — che è esattamente la fuga di dati
-- che l'intero modulo esiste per non fare.
--
--   DOMANDA → PERMESSI → DATI STRUTTURATI → FONTI → RISPOSTA → CITAZIONI
--
-- Requisiti: 0001–0026 applicate.
-- Documento di modulo: docs/company-assistant.md
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. I tipi
--
-- Tutti con `create type … as enum (…)`: i valori dichiarati alla creazione
-- sono utilizzabili SUBITO, anche nella stessa transazione — la differenza con
-- `alter type … add value`, che rende l'etichetta inservibile fino al commit
-- (55P04, lezione della 0015 e poi della 0022).
-- ---------------------------------------------------------------------------

-- Stato di una conversazione. Nessun `deleted`: l'eliminazione è una DELETE
-- vera, perché §95 promette all'utente che la conversazione sparisce. Uno stato
-- «eliminato» sarebbe una promessa non mantenuta con un'etichetta sopra.
do $$ begin
  create type public.assistant_thread_status as enum ('active', 'archived');
exception when duplicate_object then null; end $$;

-- Chi ha scritto il messaggio. Nessun ruolo `system`: gli eventi di sistema non
-- sono messaggi di una conversazione, e mescolarli renderebbe ambiguo che cosa
-- l'utente ha davvero chiesto — che è il dato più importante di questa tabella.
do $$ begin
  create type public.assistant_message_role as enum ('user', 'assistant');
exception when duplicate_object then null; end $$;

-- Come è finita l'elaborazione.
do $$ begin
  create type public.assistant_run_status as enum ('running', 'succeeded', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

-- CHE COSA la risposta è, e non solo se è arrivata. §27, §28 e §29 chiedono che
-- «non ho trovato», «serve che tu scelga quale» e «questa domanda non riguarda
-- i dati aziendali» siano esiti DICHIARATI, non prosa da interpretare: è
-- l'unico modo perché l'interfaccia possa comportarsi diversamente e perché una
-- valutazione possa misurare il tasso di non-risposta senza leggere il testo.
do $$ begin
  create type public.assistant_answer_status as enum (
    'answered',                -- risposta sostenuta dalle fonti citate
    'partial',                 -- §144 — uno strumento ha fallito, il resto regge
    'insufficient_evidence',   -- §27 — nei dati accessibili non c'è abbastanza
    'needs_disambiguation',    -- §29 — più entità possibili, sceglie l'utente
    'out_of_scope'             -- §5  — non è una domanda sui dati dell'azienda
  );
exception when duplicate_object then null; end $$;

-- Esito di una singola chiamata a uno strumento. `empty` è distinto da `ok`
-- perché «ho cercato e non c'era niente» e «ho cercato e ho trovato» portano a
-- due frasi diverse (§28), e distinguerli qui evita di dedurlo dai conteggi.
do $$ begin
  create type public.assistant_tool_status as enum ('ok', 'empty', 'denied', 'error', 'timeout');
exception when duplicate_object then null; end $$;

-- A che cosa può puntare una citazione. L'elenco è CHIUSO ed è la controparte
-- del registro degli strumenti: un tipo che non è qui non può essere citato, e
-- uno strumento che restituisse un tipo non previsto fallirebbe la validazione
-- invece di produrre un collegamento che non porta da nessuna parte.
-- ⚠️ Non c'è `subsidy_match`: i match del modulo Incentivi non sono persistiti
-- con le fonti ufficiali collegate, e citarli significherebbe presentare come
-- verificabile ciò che non lo è. Non c'è `accounting_export`: il modulo delle
-- integrazioni contabili non esiste in questo repository.
do $$ begin
  create type public.assistant_source_type as enum (
    'document',
    'document_evidence',
    'email_message',
    'task',
    'finance_item',
    'contract',
    'contract_milestone',
    'contract_term',
    'crm_organization',
    'crm_opportunity',
    'workflow_run',
    'workflow_definition',
    'company_overview'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.assistant_feedback_rating as enum ('helpful', 'not_helpful');
exception when duplicate_object then null; end $$;

-- Perché non è utile. Elenco chiuso e volutamente breve: §128 vuole una
-- motivazione, non un campo di testo libero — un campo libero raccoglierebbe
-- dati aziendali dentro la tabella del feedback, che è esattamente ciò che
-- l'intestazione di questo file vieta.
do $$ begin
  create type public.assistant_feedback_reason as enum (
    'wrong_data',        -- il dato riportato è sbagliato
    'wrong_source',      -- la fonte non è quella giusta
    'incomplete',        -- manca qualcosa
    'misunderstood'      -- non ha capito la domanda
  );
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- 2. assistant_threads — la conversazione
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_threads (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  created_by   uuid not null references auth.users (id) on delete cascade,
  -- Il titolo è la prima domanda accorciata dal server. Non è generato dal
  -- modello: una chiamata in più al modello per riassumere una riga costerebbe
  -- quanto la risposta, e la prima domanda È già il titolo migliore possibile.
  title        text not null default '',
  -- Lingua della conversazione, decisa alla creazione (§68). Sta sul thread e
  -- non sull'utente perché la stessa persona può chiedere in tedesco oggi e in
  -- italiano domani, e le risposte già date restano nella lingua in cui sono
  -- state lette.
  locale       text not null default 'it' check (locale in ('it', 'de', 'fr')),
  status       public.assistant_thread_status not null default 'active',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz,
  constraint assistant_threads_title_len check (char_length(title) <= 200),
  -- Lo stato e la data di archiviazione non possono contraddirsi: sono due
  -- rappresentazioni dello stesso fatto e l'interfaccia legge ora l'una ora
  -- l'altra.
  constraint assistant_threads_archived_coherent check (
    (status = 'archived' and archived_at is not null)
    or (status = 'active' and archived_at is null)
  )
);

comment on table public.assistant_threads is
  'Conversazioni di «Chiedi ad AI-Swisse». Nessun dato aziendale: domande, risposte e riferimenti. Privata di chi l''ha scritta (created_by), dentro la propria azienda.';
comment on column public.assistant_threads.locale is
  'Lingua della conversazione: le risposte già date restano nella lingua in cui sono state lette.';

drop trigger if exists trg_assistant_threads_updated on public.assistant_threads;
create trigger trg_assistant_threads_updated before update on public.assistant_threads
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 3. assistant_messages — che cosa è stato chiesto e che cosa è stato risposto
--
-- `company_id` è ripetuto qui e in tutte le tabelle figlie invece di risalire
-- al thread con una join. È denormalizzazione, ed è deliberata: la policy RLS
-- di ogni tabella deve poter decidere da SOLA, senza sottointerrogare il padre.
-- Una policy che fa una subquery su un'altra tabella dipende anche dalla RLS di
-- quella, e una catena di dipendenze è il posto in cui gli errori di isolamento
-- fra aziende si nascondono. Il guardiano della sezione 8 garantisce che la
-- copia non possa divergere dall'originale.
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_messages (
  id             uuid primary key default gen_random_uuid(),
  thread_id      uuid not null references public.assistant_threads (id) on delete cascade,
  company_id     uuid not null references public.companies (id) on delete cascade,
  role           public.assistant_message_role not null,
  content        text not null,
  -- Chi ha scritto: valorizzato per i messaggi dell'utente, nullo per quelli
  -- dell'assistente. Un messaggio dell'assistente con un autore umano sarebbe
  -- una firma falsa.
  created_by     uuid references auth.users (id) on delete set null,
  -- Solo sui messaggi dell'assistente ---------------------------------------
  answer_status  public.assistant_answer_status,
  -- §25 — quando la risposta si appoggia a un dato non verificato, l'incertezza
  -- è un campo, non una frase dentro il testo: l'interfaccia deve poterla
  -- mostrare come tale e una valutazione deve poterla contare.
  uncertainty    text,
  -- §127 — al massimo tre, e strettamente pertinenti. Il limite è nel vincolo
  -- perché una regola scritta solo nel prompt è una regola che il modello può
  -- disattendere senza che nessuno se ne accorga.
  follow_ups     text[] not null default '{}',
  model          text,
  prompt_version text,
  run_id         uuid,          -- FK aggiunta nella sezione 4 (dipendenza circolare)
  created_at     timestamptz not null default now(),
  constraint assistant_messages_content_len check (char_length(content) <= 20000),
  constraint assistant_messages_follow_ups_len check (array_length(follow_ups, 1) is null or array_length(follow_ups, 1) <= 3),
  -- Le due forme ammesse, dichiarate invece che sperate.
  constraint assistant_messages_shape check (
    (role = 'user'      and created_by is not null and answer_status is null and uncertainty is null
                        and follow_ups = '{}' and model is null and prompt_version is null)
    or
    (role = 'assistant' and created_by is null     and answer_status is not null)
  )
);

comment on table public.assistant_messages is
  'Messaggi di una conversazione. Nessun ragionamento privato del modello: domanda, risposta, esito dichiarato, incertezza.';
comment on column public.assistant_messages.answer_status is
  'Esito DICHIARATO (§27–§29): risposta, parziale, prove insufficienti, serve disambiguare, fuori ambito.';


-- ---------------------------------------------------------------------------
-- 4. assistant_runs — che cosa è costato arrivarci
--
-- Una riga per elaborazione, non per messaggio: una domanda può fallire, essere
-- interrotta e poi riuscire, e le tre cose vanno misurate separatamente.
-- §135 — le versioni sono QUATTRO campi distinti e non uno. Prompt, registro
-- degli strumenti, recupero e strategia di citazione cambiano in momenti
-- diversi e per ragioni diverse; una sola stringa costringerebbe a indovinare
-- quale delle quattro ha causato una regressione.
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_runs (
  id                    uuid primary key default gen_random_uuid(),
  thread_id             uuid not null references public.assistant_threads (id) on delete cascade,
  company_id            uuid not null references public.companies (id) on delete cascade,
  user_id               uuid references auth.users (id) on delete set null,
  status                public.assistant_run_status not null default 'running',
  model                 text not null,
  prompt_version        text not null,
  tool_registry_version text not null,
  retrieval_version     text not null,
  citation_strategy     text not null,
  started_at            timestamptz not null default now(),
  completed_at          timestamptz,
  input_tokens          integer,
  output_tokens         integer,
  cache_read_tokens     integer,
  cache_write_tokens    integer,
  tool_call_count       integer not null default 0,
  error_code            text,
  duration_ms           integer,
  constraint assistant_runs_tool_calls_nonneg check (tool_call_count >= 0)
);

comment on table public.assistant_runs is
  'Una riga per elaborazione: modello, versioni, token, numero di strumenti invocati, esito. Nessun contenuto.';
comment on column public.assistant_runs.citation_strategy is
  'Quale strategia di citazione era attiva. Serve a rileggere una risposta storica sapendo come erano state costruite le sue fonti.';

-- La FK del messaggio verso la run si aggiunge qui: le due tabelle si
-- riferiscono a vicenda (la run appartiene al thread, il messaggio alla run) e
-- una delle due deve nascere senza il vincolo.
-- `on delete set null`: cancellare le metriche di una vecchia elaborazione per
-- retention non deve portarsi via la risposta che l'utente ha letto.
alter table public.assistant_messages
  drop constraint if exists assistant_messages_run_id_fkey;
alter table public.assistant_messages
  add constraint assistant_messages_run_id_fkey
  foreign key (run_id) references public.assistant_runs (id) on delete set null;


-- ---------------------------------------------------------------------------
-- 5. assistant_tool_calls — quali strumenti, con quali parametri ripuliti
--
-- §90 — NON si salvano i risultati. Il risultato di `list_finance_items` sono
-- fatture: metterlo qui sarebbe la copia dei dati aziendali che l'intestazione
-- vieta. Si salva quanti ne sono tornati, perché è ciò che serve a capire se la
-- risposta era sostenuta.
-- `sanitized_input` è ripulito dal server prima di arrivare qui: restano i
-- filtri (intervallo di date, stato, limite), non i termini di ricerca liberi
-- che possono contenere il nome di una persona.
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_tool_calls (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.assistant_runs (id) on delete cascade,
  company_id      uuid not null references public.companies (id) on delete cascade,
  seq             integer not null,
  tool_key        text not null,
  sanitized_input jsonb not null default '{}'::jsonb,
  result_count    integer,
  status          public.assistant_tool_status not null,
  duration_ms     integer,
  error_code      text,
  created_at      timestamptz not null default now(),
  constraint assistant_tool_calls_seq_nonneg check (seq >= 0),
  constraint assistant_tool_calls_unique_seq unique (run_id, seq)
);

comment on table public.assistant_tool_calls is
  'Strumenti invocati durante un''elaborazione. Parametri RIPULITI e conteggio dei risultati: mai i risultati.';


-- ---------------------------------------------------------------------------
-- 6. assistant_citations — da dove viene ogni affermazione
--
-- §60 — l'indice della citazione e il collegamento profondo li costruisce il
-- SERVER a partire dai risultati degli strumenti. Il modello non scrive mai un
-- identificativo di fonte: se lo facesse, l'affermazione «fonte 123» avrebbe
-- lo stesso aspetto sia quando la fonte esiste sia quando è inventata.
--
-- §57 — una citazione può essere un GRUPPO. «Hai 3 fatture in scadenza» non
-- deve produrre tre pastiglie in mezzo alla frase: produce una citazione con
-- `group_size = 3` e una rotta che apre l'elenco già filtrato. `source_id` è
-- nullo in quel caso, e `source_ids` porta gli identificativi per la verifica.
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_citations (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references public.assistant_messages (id) on delete cascade,
  company_id     uuid not null references public.companies (id) on delete cascade,
  citation_index integer not null,
  source_type    public.assistant_source_type not null,
  source_id      uuid,
  source_ids     uuid[],
  group_size     integer,
  -- Rotta interna già costruita (`/finanze/<id>`, `/documenti/<id>?pagina=3`).
  -- ⚠️ Solo percorsi interni: nessun URL firmato dello storage, nessun indirizzo
  -- esterno. §106 — un URL firmato messo qui finirebbe in una tabella che
  -- sopravvive alla sua scadenza e che si può leggere per intero.
  route          text not null,
  title          text not null,
  subtitle       text,
  evidence_id    uuid,
  page_number    integer,
  field_name     text,
  -- §62 — se mostri una citazione testuale deve venire DALLA FONTE. Il server
  -- copia qui il testo preso dall'evidenza registrata; il modello non può
  -- riscriverlo, perché non è lui a scrivere questa riga.
  cited_text     text,
  -- §92 — il minimo che serve a sapere su quale stato della fonte la risposta si
  -- basava: l'importo e la data che erano quelli, non il documento intero.
  value_snapshot jsonb,
  source_version text,
  created_at     timestamptz not null default now(),
  constraint assistant_citations_unique_index unique (message_id, citation_index),
  constraint assistant_citations_index_nonneg check (citation_index >= 0),
  constraint assistant_citations_route_internal check (route like '/%' and route not like '//%'),
  constraint assistant_citations_cited_text_len check (cited_text is null or char_length(cited_text) <= 2000),
  -- O è una fonte singola, o è un gruppo. Le due forme si comportano in modo
  -- diverso nell'interfaccia e confonderle produrrebbe pastiglie che non si sa
  -- se aprono un record o un elenco.
  constraint assistant_citations_single_or_group check (
    (source_id is not null and group_size is null)
    or (source_id is null and group_size is not null and group_size > 0 and source_ids is not null)
  )
);

comment on table public.assistant_citations is
  'Fonti di una risposta. Indice e rotta costruiti dal SERVER dai risultati degli strumenti: il modello non scrive identificativi di fonte.';
comment on column public.assistant_citations.group_size is
  '§57 — citazione aggregata: quanti elementi, con la rotta che apre l''elenco già filtrato.';
comment on column public.assistant_citations.source_version is
  '§92/§93 — su quale stato della fonte la risposta si basava, per poter dire «alcuni dati potrebbero essere cambiati».';


-- ---------------------------------------------------------------------------
-- 7. assistant_feedback — utile / non utile
--
-- Un voto per persona e per messaggio: `unique (message_id, user_id)`. Senza il
-- vincolo, chi clicca due volte conterebbe due volte, e la metrica di §147
-- misurerebbe la nervosità del dito invece della qualità della risposta.
-- ---------------------------------------------------------------------------
create table if not exists public.assistant_feedback (
  id             uuid primary key default gen_random_uuid(),
  message_id     uuid not null references public.assistant_messages (id) on delete cascade,
  run_id         uuid references public.assistant_runs (id) on delete set null,
  company_id     uuid not null references public.companies (id) on delete cascade,
  user_id        uuid not null references auth.users (id) on delete cascade,
  rating         public.assistant_feedback_rating not null,
  reason         public.assistant_feedback_reason,
  prompt_version text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint assistant_feedback_unique unique (message_id, user_id),
  -- Un motivo su un voto positivo non vuol dire niente: i motivi previsti sono
  -- tutti forme di «non va bene».
  constraint assistant_feedback_reason_only_negative check (
    reason is null or rating = 'not_helpful'
  )
);

comment on table public.assistant_feedback is
  'Utile / non utile, con motivo a scelta chiusa. Nessun testo libero: un campo libero raccoglierebbe dati aziendali in una tabella di metriche.';

drop trigger if exists trg_assistant_feedback_updated on public.assistant_feedback;
create trigger trg_assistant_feedback_updated before update on public.assistant_feedback
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------------
-- 8. I guardiani
--
-- La RLS dice CHI può scrivere; il guardiano dice CHE COSA può scrivere. Sono
-- difese diverse e servono entrambe: una policy con `with check` non impedisce
-- a un membro legittimo di spostare una propria riga sotto un'altra azienda di
-- cui è anch'egli membro — cosa che nel caso di una fiduciaria è la norma.
-- ---------------------------------------------------------------------------

-- Un thread non cambia azienda né autore dopo la creazione (§34).
create or replace function public.assistant_threads_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' then
    if new.company_id is distinct from old.company_id then
      raise exception 'assistant_threads.company_id è immutabile' using errcode = '42501';
    end if;
    if new.created_by is distinct from old.created_by then
      raise exception 'assistant_threads.created_by è immutabile' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_assistant_threads_guard on public.assistant_threads;
create trigger trg_assistant_threads_guard before update on public.assistant_threads
  for each row execute function public.assistant_threads_guard();

-- La copia di `company_id` nelle tabelle figlie non può divergere dal thread.
-- ⚠️ Il guardiano NON si fida del valore inviato: lo IMPONE. Un client che
-- scrivesse una company diversa da quella del thread non riceve un errore —
-- riceve la company giusta. La riga risultante è comunque corretta, e il caso
-- non diventa un errore da gestire nell'interfaccia per una condizione che un
-- client onesto non produce mai.
create or replace function public.assistant_child_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  select t.company_id into v_company
    from public.assistant_threads t
   where t.id = new.thread_id;
  if v_company is null then
    raise exception 'thread inesistente' using errcode = '23503';
  end if;
  new.company_id := v_company;
  return new;
end;
$$;

drop trigger if exists trg_assistant_messages_company on public.assistant_messages;
create trigger trg_assistant_messages_company before insert or update on public.assistant_messages
  for each row execute function public.assistant_child_company();

drop trigger if exists trg_assistant_runs_company on public.assistant_runs;
create trigger trg_assistant_runs_company before insert or update on public.assistant_runs
  for each row execute function public.assistant_child_company();

-- Per le citazioni e i tool call il padre non è il thread ma il messaggio o la
-- run: stessa regola, catena diversa.
create or replace function public.assistant_citation_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  select m.company_id into v_company
    from public.assistant_messages m
   where m.id = new.message_id;
  if v_company is null then
    raise exception 'messaggio inesistente' using errcode = '23503';
  end if;
  new.company_id := v_company;
  return new;
end;
$$;

drop trigger if exists trg_assistant_citations_company on public.assistant_citations;
create trigger trg_assistant_citations_company before insert or update on public.assistant_citations
  for each row execute function public.assistant_citation_company();

drop trigger if exists trg_assistant_feedback_company on public.assistant_feedback;
create trigger trg_assistant_feedback_company before insert or update on public.assistant_feedback
  for each row execute function public.assistant_citation_company();

create or replace function public.assistant_tool_call_company()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
begin
  select r.company_id into v_company
    from public.assistant_runs r
   where r.id = new.run_id;
  if v_company is null then
    raise exception 'elaborazione inesistente' using errcode = '23503';
  end if;
  new.company_id := v_company;
  return new;
end;
$$;

drop trigger if exists trg_assistant_tool_calls_company on public.assistant_tool_calls;
create trigger trg_assistant_tool_calls_company before insert or update on public.assistant_tool_calls
  for each row execute function public.assistant_tool_call_company();

-- I messaggi non si riscrivono (§93). Una risposta storica è il testo che una
-- persona ha letto e su cui ha deciso: modificarla a posteriori — anche per
-- «aggiornarla» a una fonte cambiata — cancellerebbe la ragione per cui quella
-- decisione era stata presa. Il thread può essere archiviato o eliminato per
-- intero; il singolo messaggio no.
create or replace function public.assistant_messages_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'i messaggi dell''assistente non si modificano: una risposta storica è il testo su cui una persona ha deciso'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_assistant_messages_immutable on public.assistant_messages;
create trigger trg_assistant_messages_immutable before update on public.assistant_messages
  for each row execute function public.assistant_messages_immutable();


-- ---------------------------------------------------------------------------
-- 9. Quota e limiti — per UTENTE e per AZIENDA (§141)
--
-- `try_consume_ai_quota` (0009) limita per azienda e basta. Per l'assistente
-- non è sufficiente: una domanda costa più di un'analisi documentale, chiunque
-- può porne una dietro l'altra, e in un'azienda di dieci persone il tetto
-- aziendale lascerebbe a una sola persona la possibilità di consumarlo tutto.
-- Questa funzione aggiunge la finestra per persona e riusa `ai_request_log`:
-- una seconda tabella di log avrebbe significato due posti in cui guardare per
-- rispondere a «quanto ci costa l'AI».
--
-- ⚠️ SECURITY DEFINER scavalca la RLS: la membership va verificata QUI DENTRO.
-- È la stessa lezione della 0009, ripetuta perché è quella che, se saltata, non
-- dà alcun errore visibile.
--
-- ⚠️ I DUE CONTEGGI NON FILTRANO PER `kind`, ed è deliberato. La 0009 conta
-- tutte le richieste AI dell'azienda nell'ultimo minuto, qualunque sia il tipo:
-- è la spesa complessiva che va tenuta sotto controllo, non quella di una
-- singola funzione. Filtrare qui per `kind = 'assistant'` creerebbe un secondo
-- rubinetto indipendente dal primo, e la somma dei due non sarebbe più il tetto
-- che qualcuno ha deciso. Il tetto per persona segue la stessa regola.
-- ---------------------------------------------------------------------------
create or replace function public.assistant_reserve_slot(
  p_company_id    uuid,
  p_company_limit int default 30,
  p_user_limit    int default 10,
  p_provider      text default null,
  p_model         text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_count int;
  v_user_count int;
  v_id uuid;
begin
  if auth.uid() is null or not public.is_company_member(p_company_id) then
    raise exception 'not a member of company %', p_company_id using errcode = '42501';
  end if;

  -- Serializza le richieste concorrenti della stessa azienda: senza il lock,
  -- dieci domande inviate insieme leggono tutte lo stesso conteggio e passano
  -- tutte. Stesso rimedio della 0009.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 0));

  select count(*) into v_company_count
    from public.ai_request_log
   where company_id = p_company_id
     and created_at > now() - interval '1 minute';
  if v_company_count >= p_company_limit then
    return null;
  end if;

  select count(*) into v_user_count
    from public.ai_request_log
   where company_id = p_company_id
     and user_id = auth.uid()
     and created_at > now() - interval '1 minute';
  if v_user_count >= p_user_limit then
    return null;
  end if;

  -- `kind` resta 'assistant_answer' per l'osservabilità (§146): serve a sapere
  -- QUANTO costa questa funzione, anche se il LIMITE è complessivo.
  insert into public.ai_request_log (company_id, user_id, kind, provider, model, status)
  values (p_company_id, auth.uid(), 'assistant_answer', p_provider, p_model, 'pending')
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.assistant_reserve_slot(uuid, int, int, text, text) is
  'Prenota uno slot per una domanda all''assistente: limite per azienda E per persona (§141). Riusa ai_request_log. Ritorna null se la quota è esaurita.';

revoke all on function public.assistant_reserve_slot(uuid, int, int, text, text) from public;
grant execute on function public.assistant_reserve_slot(uuid, int, int, text, text) to authenticated;


-- ---------------------------------------------------------------------------
-- 10. Retention (§94)
--
-- Non si conserva più del necessario. La funzione elimina i thread inattivi da
-- più di N giorni; messaggi, run, chiamate agli strumenti, citazioni e feedback
-- se ne vanno in cascata. Il valore è un PARAMETRO e non una costante scritta
-- nel corpo: la retention è una decisione di prodotto e cambia senza una
-- migrazione.
--
-- ⚠️ Non tocca NESSUNA fonte aziendale. Cancella conversazioni, non documenti.
-- ---------------------------------------------------------------------------
create or replace function public.assistant_purge_expired(p_days int default 180)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  if p_days is null or p_days < 7 then
    raise exception 'retention troppo breve: %', p_days using errcode = '22023';
  end if;

  delete from public.assistant_threads
   where updated_at < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.assistant_purge_expired(int) is
  'Elimina le conversazioni inattive da più di N giorni. Non tocca alcuna fonte aziendale.';

revoke all on function public.assistant_purge_expired(int) from public;
-- Solo il ruolo di servizio: è una manutenzione pianificata, non un'azione
-- che un utente compie dall'interfaccia.
grant execute on function public.assistant_purge_expired(int) to service_role;


-- ---------------------------------------------------------------------------
-- 11. Indici
--
-- §166 — solo indici giustificati da interrogazioni reali. Ognuno qui sotto
-- corrisponde a una lettura che l'interfaccia o la Edge Function fa davvero.
-- ---------------------------------------------------------------------------

-- Elenco delle conversazioni nella colonna di sinistra: le mie, in questa
-- azienda, dalla più recente.
create index if not exists idx_assistant_threads_company_user_updated
  on public.assistant_threads (company_id, created_by, updated_at desc);

-- Messaggi di una conversazione in ordine di lettura.
create index if not exists idx_assistant_messages_thread_created
  on public.assistant_messages (thread_id, created_at);

-- Metriche per azienda (§147) e ripresa di un'elaborazione in corso.
create index if not exists idx_assistant_runs_company_started
  on public.assistant_runs (company_id, started_at desc);
create index if not exists idx_assistant_runs_thread
  on public.assistant_runs (thread_id, started_at desc);

-- Chiamate di una elaborazione, in ordine.
create index if not exists idx_assistant_tool_calls_run
  on public.assistant_tool_calls (run_id, seq);

-- Fonti di una risposta: è la lettura che apre il pannello di destra, e senza
-- indice sarebbe una scansione della tabella a ogni messaggio aperto.
create index if not exists idx_assistant_citations_message
  on public.assistant_citations (message_id, citation_index);

-- Feedback aggregato per versione di prompt (§129).
create index if not exists idx_assistant_feedback_message
  on public.assistant_feedback (message_id);
create index if not exists idx_assistant_feedback_company_created
  on public.assistant_feedback (company_id, created_at desc);


-- ---------------------------------------------------------------------------
-- 12. RLS
--
-- La condizione è SEMPRE la stessa e sempre completa: membro dell'azienda E
-- autore della conversazione. Sulle tabelle figlie l'autore si legge risalendo
-- al thread, ed è l'unico punto in cui una subquery è inevitabile — la si
-- accetta qui, dove è una lettura per chiave primaria, e non nella condizione
-- sull'azienda, che resta locale grazie alla colonna copiata.
--
-- ⚠️ Nessuna policy di UPDATE sui messaggi: sono immutabili (sezione 8). Nessuna
-- policy di DELETE sulle citazioni e sulle chiamate: se ne vanno con il loro
-- padre e cancellarle da sole lascerebbe una risposta senza fonti — cioè
-- esattamente ciò che l'intero modulo esiste per rendere impossibile.
-- ---------------------------------------------------------------------------
alter table public.assistant_threads    enable row level security;
alter table public.assistant_messages   enable row level security;
alter table public.assistant_runs       enable row level security;
alter table public.assistant_tool_calls enable row level security;
alter table public.assistant_citations  enable row level security;
alter table public.assistant_feedback   enable row level security;

-- Conversazioni ------------------------------------------------------------
drop policy if exists assistant_threads_select on public.assistant_threads;
create policy assistant_threads_select on public.assistant_threads
  for select to authenticated
  using (public.is_company_member(company_id) and created_by = auth.uid());

drop policy if exists assistant_threads_insert on public.assistant_threads;
create policy assistant_threads_insert on public.assistant_threads
  for insert to authenticated
  with check (public.is_company_member(company_id) and created_by = auth.uid());

-- Si può rinominare e archiviare; il guardiano impedisce di cambiare azienda.
drop policy if exists assistant_threads_update on public.assistant_threads;
create policy assistant_threads_update on public.assistant_threads
  for update to authenticated
  using (public.is_company_member(company_id) and created_by = auth.uid())
  with check (public.is_company_member(company_id) and created_by = auth.uid());

-- §95 — «Elimina conversazione» è una cancellazione vera.
drop policy if exists assistant_threads_delete on public.assistant_threads;
create policy assistant_threads_delete on public.assistant_threads
  for delete to authenticated
  using (public.is_company_member(company_id) and created_by = auth.uid());

-- Messaggi -----------------------------------------------------------------
drop policy if exists assistant_messages_select on public.assistant_messages;
create policy assistant_messages_select on public.assistant_messages
  for select to authenticated
  using (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.assistant_threads t
       where t.id = thread_id and t.created_by = auth.uid()
    )
  );

-- L'INSERIMENTO NON PASSA DAL CLIENT. La risposta dell'assistente la scrive la
-- Edge Function con il ruolo di servizio, dopo aver validato le citazioni: un
-- client che potesse inserire un messaggio con ruolo `assistant` potrebbe
-- fabbricare una risposta e le sue fonti. La domanda dell'utente, invece, la
-- scrive il client — è sua.
drop policy if exists assistant_messages_insert_own_question on public.assistant_messages;
create policy assistant_messages_insert_own_question on public.assistant_messages
  for insert to authenticated
  with check (
    role = 'user'
    and created_by = auth.uid()
    and public.is_company_member(company_id)
    and exists (
      select 1 from public.assistant_threads t
       where t.id = thread_id and t.created_by = auth.uid() and t.status = 'active'
    )
  );

-- Elaborazioni e chiamate: sola lettura per l'utente (le scrive il server) ---
drop policy if exists assistant_runs_select on public.assistant_runs;
create policy assistant_runs_select on public.assistant_runs
  for select to authenticated
  using (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.assistant_threads t
       where t.id = thread_id and t.created_by = auth.uid()
    )
  );

drop policy if exists assistant_tool_calls_select on public.assistant_tool_calls;
create policy assistant_tool_calls_select on public.assistant_tool_calls
  for select to authenticated
  using (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.assistant_runs r
        join public.assistant_threads t on t.id = r.thread_id
       where r.id = run_id and t.created_by = auth.uid()
    )
  );

-- Citazioni ----------------------------------------------------------------
drop policy if exists assistant_citations_select on public.assistant_citations;
create policy assistant_citations_select on public.assistant_citations
  for select to authenticated
  using (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.assistant_messages m
        join public.assistant_threads t on t.id = m.thread_id
       where m.id = message_id and t.created_by = auth.uid()
    )
  );

-- Feedback -----------------------------------------------------------------
drop policy if exists assistant_feedback_select on public.assistant_feedback;
create policy assistant_feedback_select on public.assistant_feedback
  for select to authenticated
  using (public.is_company_member(company_id) and user_id = auth.uid());

drop policy if exists assistant_feedback_insert on public.assistant_feedback;
create policy assistant_feedback_insert on public.assistant_feedback
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and public.is_company_member(company_id)
    and exists (
      select 1 from public.assistant_messages m
        join public.assistant_threads t on t.id = m.thread_id
       where m.id = message_id and t.created_by = auth.uid() and m.role = 'assistant'
    )
  );

-- Si può cambiare idea sul proprio voto.
drop policy if exists assistant_feedback_update on public.assistant_feedback;
create policy assistant_feedback_update on public.assistant_feedback
  for update to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id))
  with check (user_id = auth.uid() and public.is_company_member(company_id));


-- ---------------------------------------------------------------------------
-- 13. Grant
--
-- ⚠️ Supabase applica `alter default privileges … grant all on tables` a
-- `anon`, `authenticated` e `service_role`: OGNI tabella nuova nasce con tutti
-- i privilegi concessi, e un `grant` scritto dopo AGGIUNGE, non toglie. Perciò
-- si REVOCA per prima cosa e si riconcede il minimo — è la stessa procedura
-- della 0026, sezione 20, e l'unica che produce davvero il risultato scritto.
-- ---------------------------------------------------------------------------
revoke all on public.assistant_threads    from anon, authenticated;
revoke all on public.assistant_messages   from anon, authenticated;
revoke all on public.assistant_runs       from anon, authenticated;
revoke all on public.assistant_tool_calls from anon, authenticated;
revoke all on public.assistant_citations  from anon, authenticated;
revoke all on public.assistant_feedback   from anon, authenticated;

grant select, insert, update, delete on public.assistant_threads   to authenticated;
-- Solo select e insert: i messaggi non si modificano né si cancellano da soli.
grant select, insert                  on public.assistant_messages  to authenticated;
grant select                          on public.assistant_runs      to authenticated;
grant select                          on public.assistant_tool_calls to authenticated;
grant select                          on public.assistant_citations to authenticated;
grant select, insert, update          on public.assistant_feedback  to authenticated;

-- `anon` non ha nulla da fare qui: non esiste una conversazione senza sessione.
