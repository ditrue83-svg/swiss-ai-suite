-- ============================================================================
-- 0041 — UN'ATTIVITÀ PUÒ AVERE UN APPUNTAMENTO SENZA AVERE UN TERMINE
--
-- ⚠️⚠️ IL SEGUITO DELLA 0040. Là si è stabilito che la data di un sopralluogo
-- non è una scadenza e le si è dato un posto suo sull'ANALISI. Restava scoperto
-- il pezzo di mondo in cui il difetto si era manifestato davvero: le ATTIVITÀ.
-- Dal sopralluogo del Comune di Lugano ne erano nate tre, tutte datate
-- 10.09.2026, che è la data in cui il Comune si presenta — non il giorno entro
-- cui l'azienda deve aver preparato i giustificativi.
--
-- Tolta quella data (2026-08-15), le tre attività sono diventate «Nessuna
-- scadenza»: non mentivano più, e avevano perso un'informazione vera. Un lavoro
-- che va fatto PRIMA del 10.09.2026 non è un lavoro senza tempo.
--
--   appointment_date   il giorno dell'evento a cui il lavoro si riferisce.
--                      NON è un termine e non deve mai comportarsi come tale.
--
-- ⚠️ NON POPOLA LE FASCE DELLO SCADENZIARIO. «Entro 30 giorni», «In scadenza
-- oggi», l'ordinamento per termine e il conto dei ritardi continuano a leggere
-- SOLO "due_date". Se questa colonna vi entrasse anche solo per comodità di
-- ordinamento, avremmo rifatto il difetto con un nome nuovo.
--
-- ⚠️ IL CALENDARIO RESTA FUORI, per scelta e non per dimenticanza.
-- "calendar_tasks" seleziona, ordina e raggruppa per "due_date": farvi entrare
-- gli appuntamenti vuol dire decidere come una casella-giorno mostri due
-- generi di data, ed è una decisione sul calendario, non una correzione di
-- questo difetto. Oggi quelle attività nel calendario non compaiono affatto —
-- il che è corretto: non hanno un termine.
--
-- ⚠️ UNA COPIA, NON UNA SECONDA FONTE. Il valore arriva da
-- "document_analyses.appointment_date" al momento in cui l'attività nasce, ed è
-- una derivazione UNA TANTUM esattamente come "due_date" lo è già da
-- "document_analyses.deadline": da lì in poi le due liste non si inseguono. È
-- il disegno che questo prodotto ha scelto per le attività, non una deroga
-- introdotta qui.
-- ============================================================================

alter table public.tasks add column if not exists appointment_date date;

comment on column public.tasks.appointment_date is
  'Giorno dell''evento a cui il lavoro si riferisce (sopralluogo, udienza, ritiro). NON è un termine: non entra nelle fasce dello scadenziario né nel conto dei ritardi.';

-- Si cerca come si cerca un termine: per data.
create index if not exists idx_tasks_appointment on public.tasks (appointment_date)
  where appointment_date is not null;

-- ---------------------------------------------------------------------------
-- Il registro sorveglia anche questa data.
--
-- ⚠️ Se non la sorvegliasse, spostare un appuntamento sarebbe l'unico modo di
-- cambiare quando un lavoro va fatto senza lasciare traccia — e le tre righe
-- del Comune sono già state corrette una volta a mano.
-- "create or replace" basta: la firma non cambia, il trigger resta agganciato.
-- ---------------------------------------------------------------------------
create or replace function public.audit_on_task_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  if new.title is distinct from old.title then
    v_changes := v_changes || jsonb_build_object('title', public.audit_pair(old.title, new.title));
  end if;
  if new.status is distinct from old.status then
    v_changes := v_changes || jsonb_build_object('status', public.audit_pair(old.status::text, new.status::text));
  end if;
  if new.priority is distinct from old.priority then
    v_changes := v_changes || jsonb_build_object('priority', public.audit_pair(old.priority::text, new.priority::text));
  end if;
  if new.due_date is distinct from old.due_date then
    v_changes := v_changes || jsonb_build_object('due_date', public.audit_pair(old.due_date::text, new.due_date::text));
  end if;
  if new.appointment_date is distinct from old.appointment_date then
    v_changes := v_changes || jsonb_build_object('appointment_date', public.audit_pair(old.appointment_date::text, new.appointment_date::text));
  end if;
  if new.assignee_user_id is distinct from old.assignee_user_id then
    v_changes := v_changes || jsonb_build_object('assignee', public.audit_pair(old.assignee_user_id::text, new.assignee_user_id::text));
  end if;
  if new.archived_at is distinct from old.archived_at then
    v_changes := v_changes || jsonb_build_object('archived_at', public.audit_pair(old.archived_at::text, new.archived_at::text));
  end if;

  if v_changes = '{}'::jsonb then
    return new;
  end if;

  perform public.audit_log_write(
    new.company_id,
    auth.uid(),
    'task_updated'::public.audit_action,
    'task'::public.audit_entity_type,
    new.id,
    v_changes,
    new.id
  );
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- list_tasks — una colonna in più.
--
-- ⚠️ "drop" e non "create or replace": cambia la RETURNS TABLE. I permessi se
-- ne vanno col drop e vanno riassegnati sotto — dimenticarlo lascerebbe muto
-- l'elenco delle attività per chiunque.
--
-- ⚠️ NESSUN FILTRO E NESSUN ORDINAMENTO usa la colonna nuova: entra solo fra i
-- valori restituiti. "p_view = 'overdue'", l'ordinamento per termine e il
-- conteggio continuano a guardare "due_date", che è l'unica data che obbliga.
-- ---------------------------------------------------------------------------
drop function if exists public.list_tasks(uuid, text, public.task_status, public.task_priority, public.task_source, uuid, text, integer, integer);

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
  title text, description text, authority text, due_date date, appointment_date date,
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
    f.title, f.description, f.authority, f.due_date, f.appointment_date,
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
