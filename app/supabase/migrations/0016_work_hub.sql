-- ============================================================================
-- AI-Swisse — 0016 WORK HUB (Attività)
--
-- Lo Scadenziario diventa il posto in cui il lavoro viene assegnato, seguito e
-- concluso. Non è un task manager generico: è il punto in cui ciò che
-- AI-Swisse ha capito — da un documento, da una comunicazione, da un incentivo
-- — diventa lavoro di qualcuno, con una scadenza e una traccia.
--
-- SI EVOLVE `tasks`, NON SI CREA UNA TABELLA PARALLELA. Le attività esistenti
-- restano valide senza toccarle: una task legacy ha assegnatario nullo,
-- nessuna checklist e nessun commento, e questo è uno stato legittimo.
--
-- QUATTRO GARANZIE, TUTTE IMPOSTE DAL DATABASE E NON DAL BROWSER
--   1. L'ASSEGNATARIO è un membro della stessa azienda. Non un dropdown
--      filtrato lato client: un trigger che rifiuta l'inserimento.
--   2. CHI HA COMPLETATO e QUANDO li scrive il database da `auth.uid()` e
--      `now()`. Il client può mandare quello che vuole: viene sovrascritto.
--   3. L'AUTORE DI UN COMMENTO è `auth.uid()`: la policy lo impone in scrittura
--      e il trigger RIFIUTA — non corregge in silenzio — chi prova a firmare a
--      nome di un collega.
--   4. LO STORICO lo scrivono i trigger. `task_events` non è scrivibile dal
--      client — un registro che l'interessato può riscrivere non è un registro.
--
-- Questa migrazione è RIESEGUIBILE: ogni oggetto viene ricreato in modo
-- idempotente (`if not exists`, `create or replace`, `drop … if exists` prima
-- di policy e trigger). Applicarla due volte non fa danni e non duplica nulla.
--
-- ⚠️ VINCOLO SUI VALORI ENUM NUOVI (lezione della 0015)
-- `alter type … add value` non rende l'etichetta utilizzabile finché la
-- transazione non è chiusa, e il SQL editor esegue tutto in una transazione;
-- `full-setup.sql` concatena le migrazioni, quindi spezzare in due file non
-- risolverebbe — romperebbe ogni installazione da zero. Per questo
-- `in_progress` e `waiting` sono AGGIUNTI qui e non compaiono in nessun'altra
-- istruzione di questo file: trigger e indici parlano solo di `completed`, che
-- esiste dalla 0004.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Stati nuovi. Nessun'altra istruzione di questo file può nominarli.
-- ---------------------------------------------------------------------------
alter type public.task_status add value if not exists 'in_progress';
alter type public.task_status add value if not exists 'waiting';

comment on type public.task_status is
  'Stato di un''attività. «open» = da fare (nome storico, mostrato come «Da fare»), '
  '«in_progress» = qualcuno ci sta lavorando, «waiting» = dipende da terzi o da un evento '
  'esterno, «completed» = conclusa. L''archiviazione NON è uno stato: è `archived_at`, '
  'perché un''attività archiviata conserva lo stato che aveva.';

-- ---------------------------------------------------------------------------
-- 2. Tipi di evento dello storico.
--    Dichiarati con CREATE TYPE, quindi utilizzabili subito in questo file.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.task_event_kind as enum (
    'created', 'status_changed', 'assignee_changed', 'priority_changed',
    'due_date_changed', 'completed', 'reopened', 'archived', 'restored',
    'checklist_item_completed', 'comment_added'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 3. Colonne nuove su `tasks`
-- ---------------------------------------------------------------------------
alter table public.tasks
  add column if not exists assignee_user_id uuid references auth.users (id) on delete set null,
  add column if not exists completed_at     timestamptz,
  add column if not exists completed_by     uuid references auth.users (id) on delete set null,
  add column if not exists archived_at      timestamptz,
  add column if not exists archived_by      uuid references auth.users (id) on delete set null;

comment on column public.tasks.assignee_user_id is
  'Chi è responsabile. NULL = non assegnata, che è uno stato legittimo e non un dato mancante. '
  'L''appartenenza all''azienda la verifica il trigger `trg_tasks_guard`, non il client.';
comment on column public.tasks.completed_at is
  'Scritto dal database quando lo stato passa a «completed». Un valore mandato dal client viene ignorato.';
comment on column public.tasks.archived_at is
  'Archiviata: fuori dalle viste correnti, ancora nello storico. Sostituisce la cancellazione '
  'a un clic, che su un prodotto B2B faceva sparire il lavoro senza lasciare traccia.';

-- Un'attività si può assegnare solo a chi ha un utente: se l'assegnatario viene
-- rimosso dall'azienda la riga resta, con `assignee_user_id` che punta a un
-- utente non più membro. Lo si scopre in lettura (il nome non si risolve) e lo
-- si corregge riassegnando — cancellare l'attività sarebbe peggio.

-- ---------------------------------------------------------------------------
-- 4. Checklist: i sotto-passaggi operativi di un'attività.
--
--    ⚠️ NON è `action_progress`, e la distinzione è deliberata:
--      · `action_progress` (0010) sono le azioni ESTRATTE dall'analisi di un
--        documento. Appartengono all'analisi, che è immutabile, e dicono cosa
--        il documento chiede. Non si inventano e non si riscrivono.
--      · `task_checklist_items` sono i passaggi che una persona decide per
--        portare a termine un'attività. Si aggiungono, si riordinano, si
--        cancellano.
--    Convertire un'azione suggerita in attività ne usa il testo per titolo e
--    descrizione; NON si travasa automaticamente ogni azione in checklist,
--    perché sarebbero gli stessi dati in due posti con due cicli di vita.
-- ---------------------------------------------------------------------------
create table if not exists public.task_checklist_items (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies (id) on delete cascade,
  task_id     uuid not null references public.tasks (id) on delete cascade,
  text        text not null check (length(btrim(text)) between 1 and 500),
  position    integer not null default 0,
  done        boolean not null default false,
  done_at     timestamptz,
  done_by     uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_checklist_task on public.task_checklist_items (task_id, position, created_at);
create index if not exists idx_checklist_company on public.task_checklist_items (company_id);

-- ---------------------------------------------------------------------------
-- 5. Commenti. Testo semplice: il corpo non viene mai interpretato come markup,
--    né qui né alla lettura. Non esiste HTML da sanificare perché non esiste
--    HTML — la stessa scelta fatta per il corpo delle email (§54/§98).
-- ---------------------------------------------------------------------------
create table if not exists public.task_comments (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies (id) on delete cascade,
  task_id         uuid not null references public.tasks (id) on delete cascade,
  author_user_id  uuid not null references auth.users (id) on delete cascade,
  body            text not null check (length(btrim(body)) between 1 and 4000),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_comments_task on public.task_comments (task_id, created_at desc);
create index if not exists idx_comments_company on public.task_comments (company_id);

-- ---------------------------------------------------------------------------
-- 6. Storico. Lo scrivono i trigger; il client può solo leggerlo.
-- ---------------------------------------------------------------------------
create table if not exists public.task_events (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  task_id        uuid not null references public.tasks (id) on delete cascade,
  actor_user_id  uuid references auth.users (id) on delete set null,
  kind           public.task_event_kind not null,
  -- Solo ciò che serve a raccontare il cambiamento: valori da/a, mai testi
  -- liberi provenienti dal client.
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_events_task on public.task_events (task_id, created_at desc);
create index if not exists idx_events_company on public.task_events (company_id);

-- ---------------------------------------------------------------------------
-- 7. Indici sulle interrogazioni che la lista fa davvero
-- ---------------------------------------------------------------------------
-- «Cosa c'è da fare»: tutto ciò che non è concluso, per scadenza.
create index if not exists idx_tasks_open_due
  on public.tasks (company_id, due_date, id)
  where status <> 'completed' and archived_at is null;
-- «Le mie attività».
create index if not exists idx_tasks_assignee
  on public.tasks (company_id, assignee_user_id, due_date);
-- Ricerca testuale su titolo e descrizione (stessa estensione già usata dalla 0013).
create index if not exists idx_tasks_search
  on public.tasks using gin ((coalesce(title, '') || ' ' || coalesce(description, '') || ' ' || coalesce(authority, '')) gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- 8. Il guardiano di `tasks`: assegnatario valido, completamento e archiviazione
--    scritti dal server.
-- ---------------------------------------------------------------------------
create or replace function public.tasks_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- (a) L'assegnatario deve essere membro DELL'AZIENDA DELLA TASK. Senza questo
  --     controllo un membro potrebbe assegnare lavoro a un utente di un'altra
  --     azienda, e quel nome comparirebbe in una schermata che non gli
  --     appartiene. Non è un vincolo esprimibile con un CHECK: serve la lettura
  --     di un'altra tabella.
  if new.assignee_user_id is not null and not exists (
    select 1 from public.company_members m
    where m.company_id = new.company_id and m.user_id = new.assignee_user_id
  ) then
    raise exception 'assignee_not_member'
      using errcode = '23514',
            hint = 'La persona selezionata non appartiene a questa azienda.';
  end if;

  -- (b) Completamento: lo timbra il database. Se l'attività era già conclusa e
  --     resta tale, i valori originali non si toccano — chi ha completato una
  --     cosa non cambia perché qualcuno ha corretto il titolo.
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from 'completed' then
      new.completed_at := now();
      new.completed_by := auth.uid();
    else
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    end if;
  else
    -- Riaperta: il completamento non è più un fatto, e i suoi campi si svuotano.
    -- Che sia stata completata in passato resta scritto in `task_events`, che è
    -- il posto giusto per la storia.
    new.completed_at := null;
    new.completed_by := null;
  end if;

  -- (c) Archiviazione: stesso principio. Il client dichiara l'intenzione
  --     valorizzando `archived_at`; il valore vero lo mette il database.
  if new.archived_at is not null then
    if tg_op = 'INSERT' or old.archived_at is null then
      new.archived_at := now();
      new.archived_by := auth.uid();
    else
      new.archived_at := old.archived_at;
      new.archived_by := old.archived_by;
    end if;
  else
    new.archived_by := null;
  end if;

  return new;
end $$;

drop trigger if exists trg_tasks_guard on public.tasks;
create trigger trg_tasks_guard
  before insert or update on public.tasks
  for each row execute function public.tasks_guard();

-- ---------------------------------------------------------------------------
-- 9. Storico automatico su `tasks`
-- ---------------------------------------------------------------------------
create or replace function public.tasks_record_events()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
begin
  if tg_op = 'INSERT' then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor, 'created',
            jsonb_build_object('source', new.source, 'priority', new.priority));
    return new;
  end if;

  if new.status is distinct from old.status then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor,
            case
              when new.status = 'completed' then 'completed'::public.task_event_kind
              when old.status = 'completed' then 'reopened'::public.task_event_kind
              else 'status_changed'::public.task_event_kind
            end,
            jsonb_build_object('from', old.status, 'to', new.status));
  end if;

  if new.assignee_user_id is distinct from old.assignee_user_id then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor, 'assignee_changed',
            jsonb_build_object('from', old.assignee_user_id, 'to', new.assignee_user_id));
  end if;

  if new.priority is distinct from old.priority then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor, 'priority_changed',
            jsonb_build_object('from', old.priority, 'to', new.priority));
  end if;

  if new.due_date is distinct from old.due_date then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor, 'due_date_changed',
            jsonb_build_object('from', old.due_date, 'to', new.due_date));
  end if;

  if (new.archived_at is not null) is distinct from (old.archived_at is not null) then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.id, v_actor,
            case when new.archived_at is not null then 'archived'::public.task_event_kind
                 else 'restored'::public.task_event_kind end,
            '{}'::jsonb);
  end if;

  return new;
end $$;

drop trigger if exists trg_tasks_events on public.tasks;
create trigger trg_tasks_events
  after insert or update on public.tasks
  for each row execute function public.tasks_record_events();

-- ---------------------------------------------------------------------------
-- 10. Checklist: spunta timbrata dal server + evento
-- ---------------------------------------------------------------------------
create or replace function public.checklist_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  -- La riga deve appartenere all'azienda della propria attività: senza questo
  -- controllo un membro potrebbe agganciare una voce a una task altrui
  -- dichiarando la PROPRIA company_id, e la RLS non se ne accorgerebbe.
  select t.company_id into v_company from public.tasks t where t.id = new.task_id;
  if v_company is null or v_company is distinct from new.company_id then
    raise exception 'checklist_company_mismatch'
      using errcode = '23514', hint = 'La voce non appartiene all''attività indicata.';
  end if;

  if new.done then
    if tg_op = 'INSERT' or not old.done then
      new.done_at := now();
      new.done_by := auth.uid();
    else
      new.done_at := old.done_at;
      new.done_by := old.done_by;
    end if;
  else
    new.done_at := null;
    new.done_by := null;
  end if;

  return new;
end $$;

drop trigger if exists trg_checklist_guard on public.task_checklist_items;
create trigger trg_checklist_guard
  before insert or update on public.task_checklist_items
  for each row execute function public.checklist_guard();

drop trigger if exists trg_checklist_updated on public.task_checklist_items;
create trigger trg_checklist_updated
  before update on public.task_checklist_items
  for each row execute function public.set_updated_at();

create or replace function public.checklist_record_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.done and (tg_op = 'INSERT' or not old.done) then
    insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
    values (new.company_id, new.task_id, auth.uid(), 'checklist_item_completed',
            jsonb_build_object('item_id', new.id));
  end if;
  return new;
end $$;

drop trigger if exists trg_checklist_events on public.task_checklist_items;
create trigger trg_checklist_events
  after insert or update on public.task_checklist_items
  for each row execute function public.checklist_record_event();

-- ---------------------------------------------------------------------------
-- 11. Commenti: stessa verifica di appartenenza + evento
-- ---------------------------------------------------------------------------
create or replace function public.comments_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
begin
  select t.company_id into v_company from public.tasks t where t.id = new.task_id;
  if v_company is null or v_company is distinct from new.company_id then
    raise exception 'comment_company_mismatch'
      using errcode = '23514', hint = 'Il commento non appartiene all''attività indicata.';
  end if;
  -- L'autore è chi sta scrivendo, sempre.
  --
  -- ⚠️ Qui la prima versione RISCRIVEVA il campo con `auth.uid()`. Il risultato
  -- era sicuro — nessun commento è mai stato firmato a nome d'altri — ma era un
  -- fallback silenzioso: chi provava a firmare come un collega riceveva un
  -- «inserito» e non sapeva che il sistema aveva corretto. Su questo progetto un
  -- guasto si dichiara, non si aggiusta di nascosto. Ora si rifiuta.
  --
  -- La condizione lascia passare il service role (`auth.uid()` nullo), che è
  -- come lavorano le funzioni server e gli script di manutenzione.
  if auth.uid() is not null and new.author_user_id is distinct from auth.uid() then
    raise exception 'comment_author_mismatch'
      using errcode = '42501',
            hint = 'Un commento si firma con la propria identità.';
  end if;
  return new;
end $$;

drop trigger if exists trg_comments_guard on public.task_comments;
create trigger trg_comments_guard
  before insert or update on public.task_comments
  for each row execute function public.comments_guard();

drop trigger if exists trg_comments_updated on public.task_comments;
create trigger trg_comments_updated
  before update on public.task_comments
  for each row execute function public.set_updated_at();

create or replace function public.comments_record_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.task_events (company_id, task_id, actor_user_id, kind, detail)
  values (new.company_id, new.task_id, auth.uid(), 'comment_added',
          jsonb_build_object('comment_id', new.id));
  return new;
end $$;

drop trigger if exists trg_comments_events on public.task_comments;
create trigger trg_comments_events
  after insert on public.task_comments
  for each row execute function public.comments_record_event();

-- ---------------------------------------------------------------------------
-- 11bis. Rubrica dei membri: chi si può assegnare, e come si chiama.
--
-- Serve perché `profiles` è leggibile SOLO dal proprietario
-- (`profiles_select_own`, 0001): senza questa funzione un membro non potrebbe
-- vedere il nome di un collega, e l'interfaccia mostrerebbe identificativi al
-- posto delle persone. Non si allarga la policy di `profiles` — esporrebbe
-- l'intera riga, email compresa, a chiunque condivida un'azienda: si espone
-- solo ciò che serve, cioè come si chiama chi può ricevere un'attività.
--
-- `security definer` legge le tabelle, ma la prima condizione è che il
-- CHIAMANTE sia membro dell'azienda richiesta: senza quella riga la funzione
-- sarebbe una rubrica aperta di tutto il database.
-- ---------------------------------------------------------------------------
create or replace function public.company_member_directory(p_company_id uuid)
returns table (user_id uuid, display_name text, role public.member_role)
language sql
security definer
set search_path = ''
stable
as $$
  select
    m.user_id,
    -- Il nome se c'è; altrimenti l'email, che per un collega della stessa
    -- azienda è comunque un modo di riconoscerlo. Mai una stringa inventata.
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
      as display_name,
    m.role
  from public.company_members m
  left join public.profiles p on p.id = m.user_id
  where m.company_id = p_company_id
    and public.is_company_member(p_company_id)
  order by 2 nulls last;
$$;

revoke all on function public.company_member_directory(uuid) from public, anon;
grant execute on function public.company_member_directory(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11ter. La lista delle attività: filtri, ordinamento e paginazione nel database.
--
-- Perché una funzione e non tre `.order()` dal client: l'ordine che serve —
-- prima le scadute, poi la priorità alta, poi la scadenza più vicina, in fondo
-- quelle senza scadenza — non è esprimibile con una sequenza di colonne, e
-- ordinare in memoria richiederebbe di scaricare tutte le attività prima di
-- sapere quali contano. Con mille attività sarebbe un'applicazione che si
-- ferma; qui la pagina la compone il database.
--
-- `security invoker` (il default): la RLS di `tasks` continua ad applicarsi
-- riga per riga. Il filtro esplicito su `company_id` non la sostituisce — la
-- accompagna, com'è disciplina di questo progetto.
-- ---------------------------------------------------------------------------
create or replace function public.list_tasks(
  p_company_id  uuid,
  p_view        text default 'todo',      -- todo | mine | overdue | completed | archived | all
  p_status      public.task_status default null,
  p_priority    public.task_priority default null,
  p_source      public.task_source default null,
  p_assignee    uuid default null,
  p_search      text default null,
  p_limit       integer default 25,
  p_offset      integer default 0
)
returns table (
  id uuid, company_id uuid, created_by uuid, document_id uuid, subsidy_case_id uuid,
  title text, description text, authority text, due_date date,
  priority public.task_priority, status public.task_status, source public.task_source,
  assignee_user_id uuid, completed_at timestamptz, completed_by uuid,
  archived_at timestamptz, archived_by uuid, created_at timestamptz, updated_at timestamptz,
  assignee_name text, email_message_id uuid, total_count bigint
)
language sql
stable
set search_path = ''
as $$
  with filtered as (
    select t.*
    from public.tasks t
    where t.company_id = p_company_id
      -- Le viste. «archived» è l'unica che mostra le archiviate: ovunque
      -- altrove restano fuori, che è il senso dell'archiviazione.
      and case p_view
            when 'todo'      then t.status <> 'completed' and t.archived_at is null
            when 'mine'      then t.assignee_user_id = auth.uid() and t.status <> 'completed' and t.archived_at is null
            when 'overdue'   then t.status <> 'completed' and t.archived_at is null
                                  and t.due_date is not null and t.due_date < current_date
            when 'completed' then t.status = 'completed' and t.archived_at is null
            when 'archived'  then t.archived_at is not null
            else t.archived_at is null
          end
      and (p_status   is null or t.status = p_status)
      and (p_priority is null or t.priority = p_priority)
      and (p_source   is null or t.source = p_source)
      and (p_assignee is null or t.assignee_user_id = p_assignee)
      and (
        p_search is null or btrim(p_search) = ''
        or t.title ilike '%' || btrim(p_search) || '%'
        or coalesce(t.description, '') ilike '%' || btrim(p_search) || '%'
        or coalesce(t.authority, '') ilike '%' || btrim(p_search) || '%'
      )
  )
  select
    f.id, f.company_id, f.created_by, f.document_id, f.subsidy_case_id,
    f.title, f.description, f.authority, f.due_date,
    f.priority, f.status, f.source,
    f.assignee_user_id, f.completed_at, f.completed_by,
    f.archived_at, f.archived_by, f.created_at, f.updated_at,
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as assignee_name,
    -- La comunicazione da cui nasce, quando il documento collegato viene dalla
    -- posta. Non serve una colonna su `tasks`: la relazione esiste già.
    (select d.email_message_id
       from public.email_message_documents d
      where d.document_id = f.document_id
      order by d.created_at asc
      limit 1) as email_message_id,
    count(*) over () as total_count
  from filtered f
  left join public.profiles p on p.id = f.assignee_user_id
  order by
    -- 1. scadute
    case when f.status <> 'completed' and f.due_date is not null and f.due_date < current_date
         then 0 else 1 end,
    -- 2. priorità alta
    case f.priority when 'high' then 0 when 'medium' then 1 else 2 end,
    -- 3. scadenza più vicina, 4. senza scadenza in fondo
    f.due_date asc nulls last,
    -- 5. a parità di tutto, le più recenti
    f.created_at desc
  limit greatest(1, least(coalesce(p_limit, 25), 100))
  offset greatest(0, coalesce(p_offset, 0));
$$;

revoke all on function public.list_tasks(uuid, text, public.task_status, public.task_priority, public.task_source, uuid, text, integer, integer) from public, anon;
grant execute on function public.list_tasks(uuid, text, public.task_status, public.task_priority, public.task_source, uuid, text, integer, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. RLS
--
-- ⚠️ `revoke all` PRIMA dei grant, su ogni tabella nuova: su Supabase una
-- tabella di `public` nasce con i permessi di tabella completi per `anon` e
-- `authenticated` (`alter default privileges … grant all on tables`), quindi un
-- grant scritto dopo AGGIUNGE privilegi invece di restringerli. È la lezione
-- della 0014, dove i permessi di colonna della 0013 non restringevano nulla.
-- ---------------------------------------------------------------------------
alter table public.task_checklist_items enable row level security;
alter table public.task_comments        enable row level security;
alter table public.task_events          enable row level security;

revoke all on public.task_checklist_items from anon, authenticated, public;
revoke all on public.task_comments        from anon, authenticated, public;
revoke all on public.task_events          from anon, authenticated, public;

grant select, insert, update, delete on public.task_checklist_items to authenticated;
-- I commenti non si cancellano: una conversazione con dei buchi è peggio di una
-- conversazione con un errore. Si possono correggere entro i limiti della policy.
grant select, insert, update on public.task_comments to authenticated;
-- Lo storico è in SOLA LETTURA per il client: lo scrivono i trigger, che girano
-- come `security definer` e non passano da questi permessi.
grant select on public.task_events to authenticated;

drop policy if exists checklist_select_member on public.task_checklist_items;
create policy checklist_select_member on public.task_checklist_items
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists checklist_insert_member on public.task_checklist_items;
create policy checklist_insert_member on public.task_checklist_items
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists checklist_update_member on public.task_checklist_items;
create policy checklist_update_member on public.task_checklist_items
  for update to authenticated using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
drop policy if exists checklist_delete_member on public.task_checklist_items;
create policy checklist_delete_member on public.task_checklist_items
  for delete to authenticated using (public.is_company_member(company_id));

drop policy if exists comments_select_member on public.task_comments;
create policy comments_select_member on public.task_comments
  for select to authenticated using (public.is_company_member(company_id));
-- `author_user_id = auth.uid()` nella WITH CHECK: nessuno può firmare a nome
-- d'altri, e non è una convenzione del servizio ma una regola del database.
drop policy if exists comments_insert_author on public.task_comments;
create policy comments_insert_author on public.task_comments
  for insert to authenticated
  with check (public.is_company_member(company_id) and author_user_id = auth.uid());
drop policy if exists comments_update_author on public.task_comments;
create policy comments_update_author on public.task_comments
  for update to authenticated
  using (public.is_company_member(company_id) and author_user_id = auth.uid())
  with check (public.is_company_member(company_id) and author_user_id = auth.uid());

drop policy if exists events_select_member on public.task_events;
create policy events_select_member on public.task_events
  for select to authenticated using (public.is_company_member(company_id));

-- ---------------------------------------------------------------------------
-- 13. Autoverifica: la migrazione controlla di aver ottenuto ciò che dichiara.
--     Se domani qualcuno concede per sbaglio la scrittura sullo storico, questa
--     migrazione fallisce all'applicazione invece di lasciar passare la falla.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'task_events'
    and grantee in ('anon', 'authenticated', 'public')
    and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'lo storico delle attività risulta scrivibile dal client: %', v_bad;
  end if;

  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name = 'task_comments'
    and grantee in ('anon', 'authenticated', 'public')
    and privilege_type = 'DELETE';
  if v_bad is not null then
    raise exception 'i commenti risultano cancellabili dal client: %', v_bad;
  end if;
end $$;
