-- ============================================================================
-- AI-Swisse — 0019 «SEGNA COME LETTA» NON FUNZIONAVA
--
-- COSA È ANDATO STORTO NELLA 0018
-- `notifications_mark_read` e `notifications_mark_all_read` erano `security
-- invoker`, cioè giravano con i permessi di CHI LE CHIAMA. Sulla tabella
-- `notifications` il ruolo `authenticated` ha soltanto `SELECT` — di proposito,
-- perché una notifica non deve essere riscrivibile dal browser — quindi l'UPDATE
-- dentro la funzione veniva respinto:
--
--     42501: permission denied for table notifications
--
-- Il risultato era che la campanella non riusciva a segnare niente come letto e
-- il badge non scendeva mai.
--
-- IL RAGIONAMENTO SBAGLIATO, PERCHÉ È LA PARTE CHE VALE LA PENA RICORDARE
-- Nella 0018 c'era scritto: «l'UPDATE esiste per far passare `read_at` scritto
-- dalle funzioni, che girano security invoker. Resta inutilizzabile dal client:
-- non c'è alcun GRANT di UPDATE sulla tabella, quindi la policy da sola non
-- basta ad aprire nulla.» La seconda metà è vera. La prima no: se la funzione
-- gira come il chiamante, allora la funzione È il chiamante, e il permesso che
-- manca al client manca anche a lei. Una policy senza il GRANT corrispondente
-- non apre niente — nemmeno a chi vorremmo che aprisse.
--
-- COME È EMERSO: `npm run test:calendar` alla PRIMA esecuzione sul database
-- reale, 3 fallimenti su 57. Non leggendo il codice e non facendo la revisione:
-- eseguendo. È la stessa lezione della 0014, dove i permessi di colonna della
-- 0013 dichiaravano nei commenti una garanzia che non era in vigore.
--
-- ⚠️ E IL TEST LO AVEVA QUASI NASCOSTO. Il controllo «Andrea non può segnare
-- come letta una notifica di Marco» PASSAVA — ma per il motivo sbagliato: la
-- chiamata falliva con 42501, `data` tornava `null`, e `Number(null)` è zero.
-- Un test che scarta l'errore e guarda solo il risultato non distingue «zero
-- righe» da «non ho potuto provarci». Corretto anche quello.
--
-- LA CORREZIONE
-- Le due funzioni diventano `security definer`. Da quel momento la RLS non le
-- filtra più, quindi la condizione `user_id = auth.uid()` scritta dentro non è
-- più una ridondanza: è L'UNICA difesa, ed è esattamente la disciplina già
-- fissata nella 0017 — una funzione che scavalca la RLS deve difendersi da sola
-- e non fidarsi di una policy scritta altrove.
--
-- Il client continua a NON avere alcun permesso di scrittura su `notifications`.
--
-- Perché una migrazione nuova e non una correzione della 0018: la 0018 è già
-- stata applicata. Un file di migrazione è il verbale di ciò che è stato
-- eseguito; riscriverlo dopo l'applicazione significherebbe che il repository e
-- il database raccontano due storie diverse. È la stessa ragione per cui la
-- 0014 esiste accanto alla 0013 invece di sostituirla.
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Le due funzioni, ora `security definer`
--
-- `set search_path = ''` resta indispensabile: una funzione `security definer`
-- gira con i privilegi del proprietario, e un search_path manipolabile dal
-- chiamante le farebbe eseguire codice altrui con quei privilegi.
--
-- Ogni condizione ha una ragione:
--   · `n.id = any(…)`      soltanto le righe indicate;
--   · `n.user_id = auth.uid()`  soltanto le PROPRIE. Senza questa riga la
--     funzione segnerebbe come lette le notifiche di chiunque, perché in
--     `security definer` la RLS non c'è più;
--   · `n.read_at is null`  «già letta» non si conta due volte, e il valore
--     originale non si sposta.
-- ---------------------------------------------------------------------------
create or replace function public.notifications_mark_read(p_ids uuid[])
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with updated as (
    update public.notifications n
       set read_at = now()
     where n.id = any(coalesce(p_ids, '{}'::uuid[]))
       and n.user_id = auth.uid()
       and n.read_at is null
    returning n.id
  )
  select count(*)::integer from updated;
$$;

create or replace function public.notifications_mark_all_read(p_company_id uuid)
returns integer
language sql
volatile
security definer
set search_path = ''
as $$
  with updated as (
    update public.notifications n
       set read_at = now()
     where n.company_id = p_company_id
       and n.user_id = auth.uid()
       and n.read_at is null
    returning n.id
  )
  select count(*)::integer from updated;
$$;

-- `security definer` con `auth.uid()` nullo — cioè chiamata dal service role o
-- da uno script — non aggiorna nulla, perché nessuna riga ha `user_id` nullo.
-- È il comportamento voluto: non esiste un modo di segnare come lette le
-- notifiche «di tutti».

revoke all on function public.notifications_mark_read(uuid[])   from public, anon;
revoke all on function public.notifications_mark_all_read(uuid) from public, anon;
grant execute on function public.notifications_mark_read(uuid[])   to authenticated;
grant execute on function public.notifications_mark_all_read(uuid) to authenticated;

-- `notifications_unread_count` resta `security invoker` e NON si tocca: legge
-- soltanto, e per una lettura la RLS è la difesa giusta — è già in vigore e
-- filtra riga per riga. Renderla `definer` sposterebbe quella difesa dentro una
-- condizione scritta a mano, senza guadagnarci niente.

-- ---------------------------------------------------------------------------
-- 2. Via la policy che non apriva niente
--
-- `notifications_update_own` era stata scritta per far passare l'UPDATE delle
-- funzioni. Non serviva già allora — senza GRANT una policy non apre nulla — e
-- ora che le funzioni sono `security definer` la RLS non le riguarda affatto.
-- Si toglie invece di lasciarla: una policy che sembra concedere una scrittura
-- che non esiste è un invito a concedere, un domani, anche il GRANT che la
-- renderebbe vera.
-- ---------------------------------------------------------------------------
drop policy if exists notifications_update_own on public.notifications;

-- ---------------------------------------------------------------------------
-- 3. Autoverifica
--
-- Due affermazioni, entrambe controllate qui e non solo nella suite di test:
-- le funzioni sono davvero `security definer`, e il client continua a non avere
-- alcuna scrittura sulla tabella. La seconda è la garanzia che la prima non
-- deve costare.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(p.proname, ', ')
    into v_bad
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('notifications_mark_read', 'notifications_mark_all_read')
     and not p.prosecdef;
  if v_bad is not null then
    raise exception 'Queste funzioni devono essere security definer, altrimenti l''UPDATE viene respinto: %', v_bad;
  end if;

  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name = 'notifications'
     and grantee in ('anon', 'authenticated', 'public')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'Le notifiche non devono essere scrivibili dal client: %', v_bad;
  end if;

  raise notice '0019 verificata: «segna come letta» funziona e le notifiche restano non riscrivibili dal client.';
end $$;
