-- ============================================================================
-- 0042 — IL CALENDARIO SA CHE UN APPUNTAMENTO NON È UNA SCADENZA
--
-- ⚠️⚠️ IL TERZO PEZZO. La 0040 ha dato una natura alle date estratte, la 0041
-- ha dato alle attività un appuntamento che non è un termine. Restava il
-- calendario, che è il posto in cui un riferimento temporale dovrebbe vedersi
-- più che altrove — e dove invece le tre attività del sopralluogo del Comune di
-- Lugano non comparivano affatto, perché `calendar_tasks` selezionava,
-- ordinava e raggruppava per "due_date" e loro non ne hanno.
--
-- ⚠️ LA DECISIONE CHE QUESTA MIGRAZIONE PRENDE, e va detta: una riga per
-- (attività, genere di data). Un'attività che ha un termine il 5 e un
-- sopralluogo il 10 compare DUE volte, una per giorno, ciascuna col proprio
-- segno. Un calendario risponde a «che cosa succede questo giorno», e in quei
-- due giorni succedono due cose vere e diverse. Sceglierne una avrebbe
-- significato nascondere l'altra proprio nella schermata fatta per vederla.
--
--   on_date     il giorno in cui la riga va collocata
--   date_kind   'deadline' | 'appointment' — PERCHÉ è finita in quel giorno
--
-- ⚠️ Il chiamante non deve dedurre il genere confrontando le date: lo riceve
-- scritto. Dedurlo vorrebbe dire riscrivere questa scelta in ogni lettore, e
-- due copie della stessa deduzione col tempo divergono.
--
-- ⚠️ GLI APPUNTAMENTI NON HANNO RITARDO, e la differenza sta nella clausola:
-- il ramo dei termini raccoglie anche le scadute fuori finestra (è la ragione
-- per cui "p_include_overdue" esiste), quello degli appuntamenti no. Un
-- sopralluogo passato è passato, non mancato: tirarlo dentro la finestra come
-- si fa con una scadenza lo trasformerebbe nell'allarme che non è.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Le attività del calendario, per giorno e per genere di data.
--
-- ⚠️ "drop" e non "create or replace": cambia la RETURNS TABLE. I permessi se
-- ne vanno col drop e vanno riassegnati sotto.
-- ---------------------------------------------------------------------------
drop function if exists public.calendar_tasks(uuid, date, date, boolean, public.task_status, public.task_priority, uuid, boolean, integer);

create or replace function public.calendar_tasks(
  p_company_id      uuid,
  p_from            date,
  p_to              date,
  p_mine            boolean default false,
  p_status          public.task_status default null,
  p_priority        public.task_priority default null,
  p_assignee        uuid default null,
  p_include_overdue boolean default true,
  p_limit           integer default 500
)
returns table (
  id uuid, title text, due_date date, appointment_date date,
  on_date date, date_kind text,
  priority public.task_priority, status public.task_status, source public.task_source,
  assignee_user_id uuid, assignee_name text, document_id uuid
)
language sql
stable
set search_path = ''
as $$
  with base as (
    select
      t.id, t.title, t.due_date, t.appointment_date, t.priority, t.status, t.source,
      t.assignee_user_id, t.document_id, t.created_at,
      nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as assignee_name
    from public.tasks t
    left join public.profiles p on p.id = t.assignee_user_id
    where t.company_id = p_company_id
      and t.archived_at is null
      and (not coalesce(p_mine, false) or t.assignee_user_id = auth.uid())
      and (p_status   is null or t.status = p_status)
      and (p_priority is null or t.priority = p_priority)
      and (p_assignee is null or t.assignee_user_id = p_assignee)
  ),
  placed as (
    -- I TERMINI: la finestra, più le scadute che restano pertinenti.
    select b.*, b.due_date as on_date, 'deadline'::text as date_kind
    from base b
    where b.due_date is not null
      and (
        (b.due_date >= p_from and b.due_date <= p_to)
        -- ⚠️ "<=" e non "<". Il database vive in UTC, l'utente in Europe/Zurich:
        -- alle 00:30 locali di giovedì, per Postgres è ancora mercoledì, e
        -- un'attività scaduta mercoledì non rientrerebbe in "due_date <
        -- current_date". Un giorno di margine costa una riga in più e chiude la
        -- finestra. Qui si SELEZIONA soltanto: che cosa sia «in ritardo» lo
        -- decide "isOverdue()" in taskFormat, la stessa funzione che usano
        -- Attività e Panoramica. Due definizioni di «scaduta» sono due
        -- schermate che prima o poi si contraddicono.
        or (coalesce(p_include_overdue, true)
            and b.status <> 'completed'
            and b.due_date <= current_date)
      )

    union all

    -- GLI APPUNTAMENTI: la finestra e basta. Nessun recupero del passato.
    select b.*, b.appointment_date as on_date, 'appointment'::text as date_kind
    from base b
    where b.appointment_date is not null
      and b.appointment_date >= p_from
      and b.appointment_date <= p_to
  )
  select
    u.id, u.title, u.due_date, u.appointment_date,
    u.on_date, u.date_kind,
    u.priority, u.status, u.source,
    u.assignee_user_id, u.assignee_name, u.document_id
  from placed u
  order by u.on_date asc,
    case u.priority when 'high' then 0 when 'medium' then 1 else 2 end,
    u.created_at desc
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

revoke all on function public.calendar_tasks(uuid, date, date, boolean, public.task_status, public.task_priority, uuid, boolean, integer) from public, anon;
grant execute on function public.calendar_tasks(uuid, date, date, boolean, public.task_status, public.task_priority, uuid, boolean, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- «Senza data» vuol dire senza NESSUNA delle due.
--
-- ⚠️ Il pannello che usa questo conteggio dice «N attività senza scadenza, non
-- compaiono nel calendario» e rimanda ad Attività. Da adesso un'attività con un
-- appuntamento nel calendario ci compare eccome: continuare a contarla qui
-- farebbe dire alla stessa schermata due cose incompatibili, e quella scritta
-- vincerebbe su quella disegnata.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_undated_count(
  p_company_id uuid,
  p_mine       boolean default true
)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.tasks t
  where t.company_id = p_company_id
    and t.archived_at is null
    and t.due_date is null
    and t.appointment_date is null
    and t.status <> 'completed'
    and (not coalesce(p_mine, false) or t.assignee_user_id = auth.uid());
$$;
