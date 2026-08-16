-- ============================================================================
-- 0040 — UNA DATA DICHIARA CHE COSA È
--
-- ⚠️⚠️ IL CASO. «Comune di Lugano — Controllo tassa rifiuti» mostrava
-- «Scadenza 10.09.2026 · fra 26 giorni · affidabilità ALTA». La citazione a
-- supporto era esatta e verificata: «Il sopralluogo è previsto per il
-- 10.09.2026 presso la vostra sede». La data era giusta, la citazione era
-- giusta, il campo era sbagliato — una data di sopralluogo è il giorno in cui
-- un evento ACCADE, non il termine entro cui l'azienda deve agire. Da quel
-- campo sono nate tre attività, tutte datate 10.09.2026.
--
-- Le due guardie esistenti non potevano vederlo: "deadline_type" dice che
-- FORMA ha la data (assoluta/relativa), "obligesCompany" (2026-08-11) dice CHI
-- è obbligato — e da un sopralluogo l'azienda è coinvolta davvero. Mancava la
-- terza domanda: CHE COSA è quella data.
--
--   deadline_kind      term | event | reference | none  — null = mai dichiarato
--   appointment_date   la data in cui accade l'evento, in una colonna SUA
--
-- ⚠️ PERCHÉ UNA COLONNA SUA E NON UN FLAG ACCANTO A "deadline": un flag lo si
-- dimentica. "deadline" è letta da list_documents, dalle automazioni
-- (analysis.deadline), da Finanze, dall'assistente e da chi crea un'attività da
-- un documento: basta un lettore che ignori il flag perché la data
-- dell'appuntamento torni a essere un termine. Una colonna diversa non si
-- legge per sbaglio.
--
-- ⚠️ NESSUN AGGIORNAMENTO DELLE RIGHE ESISTENTI, ED È DELIBERATO. L'analisi è
-- un verbale immutabile (0010): scrivere oggi deadline_kind = 'event' su una
-- riga del 26 luglio metterebbe in bocca al modello una risposta che il modello
-- non ha mai dato. Le righe anteriori restano con deadline_kind NULL, e la
-- LETTURA sa che cosa farne: deadlineNature.ts dichiara «da verificare» ogni
-- scadenza la cui natura non è mai stata stabilita. È la lezione già pagata due
-- volte — una regola applicata solo in scrittura non protegge i dati già
-- scritti.
--
-- ⚠️⚠️ ORDINE DI APPLICAZIONE — PRIMA QUESTA, POI LA FUNZIONE.
-- `analyze-document` è l'unica Edge Function che scrive un'analisi, e da questo
-- lavoro in poi la sua riga contiene `deadline_kind` e `appointment_date`.
-- Deployarla PRIMA di applicare questa migrazione fa fallire OGNI analisi con
-- un errore di colonna inesistente (verificato il 2026-08-15: la colonna oggi
-- non c'è, e PostgREST risponde 42703). Non è un guasto silenzioso — l'analisi
-- si dichiara fallita e il documento resta — ma è un fermo evitabile.
-- Il frontend invece regge in entrambi gli ordini: legge con `select *` e con
-- `list_documents`, e una colonna assente vale «natura non dichiarata», cioè
-- «da verificare».
-- ============================================================================

alter table public.document_analyses add column if not exists deadline_kind text;              -- term | event | reference | none
alter table public.document_analyses add column if not exists appointment_date date;
alter table public.document_analyses add column if not exists appointment_evidence jsonb;
alter table public.document_analyses add column if not exists appointment_source_text text;

comment on column public.document_analyses.deadline_kind is
  'Natura della data estratta: term | event | reference | none. NULL = analisi anteriore al 2026-08-15, natura mai dichiarata: in lettura vale «da verificare», non «termine».';
comment on column public.document_analyses.appointment_date is
  'Data in cui accade un evento che coinvolge l''azienda (sopralluogo, udienza, ritiro). NON è una scadenza e non deve mai alimentare un termine.';

-- Un appuntamento si cerca come si cerca una scadenza: per data.
create index if not exists idx_analyses_appointment on public.document_analyses (appointment_date);

-- ---------------------------------------------------------------------------
-- list_documents — due colonne in più.
--
-- ⚠️ "drop" e non "create or replace": cambia la RETURNS TABLE, e Postgres non
-- sostituisce una funzione che cambia tipo di ritorno. I permessi se ne vanno
-- col drop e vanno riassegnati sotto — dimenticarlo lascerebbe la lista
-- documenti muta per chiunque.
--
-- ⚠️ QUI SI PORTANO GLI INGREDIENTI, NON SI CALCOLA LA REGOLA.
-- "deadline_requires_verification" resta il flag GREZZO scritto dal validatore;
-- il «da verificare» effettivo (grezzo OPPURE natura mai dichiarata) lo calcola
-- deadlineNature.ts, in un posto solo, per tutti i lettori. Riscriverlo anche
-- qui creerebbe una seconda fonte di verità, e due copie della stessa regola
-- col tempo divergono.
-- ---------------------------------------------------------------------------
drop function if exists public.list_documents(uuid, text, public.document_category, boolean, public.document_source_type, text, uuid[], date, date, boolean, boolean, text, integer, integer, uuid);

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
  deadline_kind text,
  appointment_date date,
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
      good.deadline_kind     as a_deadline_kind,
      good.appointment_date  as a_appointment,
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
    b.a_deadline_kind as deadline_kind,
    b.a_appointment   as appointment_date,
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
