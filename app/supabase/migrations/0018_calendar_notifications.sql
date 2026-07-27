-- ============================================================================
-- AI-Swisse — 0018 CALENDARIO E NOTIFICHE
--
-- Il Work Hub sa CHE COSA c'è da fare. Questa migrazione aggiunge QUANDO lo si
-- vede nel tempo e CHE COSA non si può permettere di dimenticare.
--
-- IL PRINCIPIO, E CIÒ CHE NE DERIVA PER LO SCHEMA
-- La fonte di verità del lavoro resta `tasks`. Il calendario è una PROIEZIONE:
-- qui non esiste nessuna tabella che contenga titolo, scadenza o stato di
-- un'attività. `calendar_event_links` contiene solo la CORRISPONDENZA fra una
-- task e l'evento che la rappresenta presso un provider — un identificativo e
-- un'impronta, non una copia. Se domani qualcuno volesse leggere «quali
-- scadenze ha l'azienda» da queste tabelle non ci riuscirebbe, ed è voluto:
-- due posti in cui vive una scadenza sono due scadenze che possono divergere.
--
-- LE GARANZIE CHE STANNO QUI E NON NEL BROWSER
--   1. I TOKEN del calendario sono irraggiungibili dal client: nessun GRANT e
--      nessuna policy su `calendar_connection_secrets`, esattamente come per la
--      posta (0013).
--   2. UNA NOTIFICA È PERSONALE. La RLS filtra per `user_id = auth.uid()`, non
--      per azienda: due colleghi della stessa azienda non si leggono le
--      notifiche a vicenda.
--   3. LE PREFERENZE SONO PERSONALI E LE SCRIVE SOLO IL LORO PROPRIETARIO. Un
--      amministratore non può accendere le email a un collega: il consenso a
--      essere contattati non è delegabile, e qui non lo è tecnicamente.
--   4. NESSUNO SI FABBRICA UNA NOTIFICA. Il client non ha alcun permesso di
--      scrittura su `notifications`: le creano i trigger e il worker. «Segna
--      come letta» passa da una funzione, non da un update.
--   5. LA CODA DI SINCRONIZZAZIONE È DEL SERVER. Il client non la vede e non la
--      scrive: la riempiono i trigger su `tasks`, la svuota una Edge Function.
--   6. L'IDEMPOTENZA È UN VINCOLO, NON UNA CONDIZIONE NEL CODICE.
--      `unique (connection_id, task_id)` su `calendar_event_links` e
--      `unique (task_id)` su `calendar_sync_queue`: un worker eseguito due
--      volte non può creare due eventi, qualunque cosa faccia il codice.
--
-- ⚠️ VINCOLO SUI VALORI ENUM (lezione della 0015, sorvegliata da `db:bundle`)
-- Tutti gli enum di questo file nascono con `create type … as enum (…)`, quindi
-- sono utilizzabili subito. NESSUN `alter type … add value` compare qui: un
-- valore aggiunto non sarebbe usabile nella stessa transazione, e `full-setup.sql`
-- concatena le migrazioni in una transazione sola.
--
-- ⚠️ REVOKE PRIMA DEI GRANT (lezione della 0014)
-- Su Supabase ogni tabella nuova di `public` nasce con i permessi di TABELLA
-- completi per `anon` e `authenticated`. Un grant scritto dopo AGGIUNGE
-- privilegi: non ne toglie. Ogni tabella qui sotto passa da `revoke all`.
--
-- Questa migrazione è RIESEGUIBILE.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Enum
-- ---------------------------------------------------------------------------

-- Provider di calendario. Enum PROPRIO e non riuso di `email_provider`: sono
-- due domini diversi che oggi hanno gli stessi due valori per coincidenza.
-- Legarli significherebbe che aggiungere CalDAV al calendario aggiunge CalDAV
-- anche alla posta.
do $$ begin create type public.calendar_provider as enum ('google', 'microsoft');
exception when duplicate_object then null; end $$;

do $$ begin create type public.calendar_connection_status as enum
  ('active', 'reauth_required', 'error', 'disconnected');
exception when duplicate_object then null; end $$;

-- Stato della corrispondenza fra una task e il suo evento presso il provider.
-- `pending` = la task è cambiata e l'evento non è ancora allineato; è uno stato
-- normale, non un guasto.
do $$ begin create type public.calendar_link_status as enum ('pending', 'synced', 'failed');
exception when duplicate_object then null; end $$;

-- I tipi di notifica della versione 1. Sette, non cinquanta: ognuno corrisponde
-- a una frase che una persona può leggere e a un'azione che può compiere.
do $$ begin create type public.notification_type as enum (
  'task_assigned',
  'task_due_soon',
  'task_due_today',
  'task_overdue',
  'unassigned_task_due_soon',
  'calendar_sync_failed',
  'calendar_reauth_required'
);
exception when duplicate_object then null; end $$;

-- Canali di CONSEGNA. L'in-app non compare: l'in-app È la notifica, la riga di
-- `notifications`. Elencarlo come canale creerebbe una consegna che non ha
-- niente da consegnare.
do $$ begin create type public.notification_channel as enum ('email');
exception when duplicate_object then null; end $$;

do $$ begin create type public.notification_delivery_status as enum
  ('pending', 'sending', 'sent', 'failed', 'cancelled');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. notifications — il segnale
--
-- `payload` contiene SOLO ciò che serve a scrivere la frase: titolo
-- dell'attività, scadenza, priorità. Mai il corpo di un documento, mai il testo
-- di una email, mai un allegato, mai un prompt. La regola non è una convenzione
-- del codice: una notifica finisce in un'email, e un'email esce dal perimetro.
--
-- `dedupe_key` è NULLABILE, e l'unicità è un indice PARZIALE. Le due famiglie
-- di notifiche hanno bisogni opposti:
--   · quelle generate da un CRON (i promemoria) devono poter essere ritentate
--     senza duplicare: hanno una chiave, e l'unicità la impone il database;
--   · quelle generate da un EVENTO (una riassegnazione) non si ritentano mai —
--     il trigger scatta una volta per UPDATE — e due assegnazioni successive
--     sono due fatti distinti che meritano due notifiche.
-- Dare una chiave finta anche alle seconde avrebbe significato inventarla con
-- un timestamp, cioè scrivere un vincolo che non vincola niente.
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies (id) on delete cascade,
  -- Il DESTINATARIO. Una notifica appartiene a una persona, non a un'azienda:
  -- è la ragione per cui la RLS qui filtra su `user_id` e non su membership.
  user_id      uuid not null references auth.users (id) on delete cascade,
  type         public.notification_type not null,
  -- A che cosa si riferisce. Testo e non enum: `entity_type` non governa alcuna
  -- decisione di autorizzazione, serve solo a comporre il collegamento.
  entity_type  text not null check (entity_type in ('task', 'calendar_connection')),
  entity_id    uuid not null,
  payload      jsonb not null default '{}'::jsonb,
  dedupe_key   text,
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);

-- L'idempotenza dei promemoria. Un job eseguito due volte non crea due righe.
create unique index if not exists uq_notifications_dedupe
  on public.notifications (user_id, dedupe_key) where dedupe_key is not null;
-- La lista della campanella: le mie, di questa azienda, dalla più recente.
create index if not exists idx_notifications_inbox
  on public.notifications (user_id, company_id, created_at desc);
-- Il conteggio del badge, che si fa a ogni caricamento di pagina.
create index if not exists idx_notifications_unread
  on public.notifications (user_id, company_id) where read_at is null;

comment on table public.notifications is
  'Notifiche PERSONALI. La RLS filtra per user_id: due colleghi della stessa azienda non si leggono le notifiche a vicenda. Il client non ha alcun permesso di scrittura.';
comment on column public.notifications.payload is
  'Solo metadati per comporre la frase (titolo, scadenza, priorità). MAI corpo di documenti o email: una notifica può uscire dal perimetro via email.';
comment on column public.notifications.dedupe_key is
  'Chiave di deduplicazione per le notifiche generate da un job periodico. NULL per quelle generate da un evento, che non si ritentano e non vanno deduplicate.';

-- ---------------------------------------------------------------------------
-- 3. notification_preferences — il consenso, per persona e per azienda
--
-- Chiave composta (company_id, user_id): la stessa persona può volere le email
-- per il mandato che segue da vicino e non per l'altro. È lo stesso principio
-- per cui una connessione di calendario è personale E aziendale.
--
-- Il default è dichiarato QUI e non nel codice applicativo: in-app acceso,
-- email SPENTA. L'email è un canale che esce dal prodotto e richiede una scelta
-- esplicita; accenderla per impostazione predefinita significherebbe decidere
-- al posto di qualcuno.
-- ---------------------------------------------------------------------------
create table if not exists public.notification_preferences (
  company_id            uuid not null references public.companies (id) on delete cascade,
  user_id               uuid not null references auth.users (id) on delete cascade,

  in_app_enabled        boolean not null default true,
  email_enabled         boolean not null default false,

  remind_7_days         boolean not null default true,
  remind_1_day          boolean not null default true,
  remind_due_day        boolean not null default true,
  remind_overdue        boolean not null default true,

  -- Fuso IANA. Il default è quello del mercato, ma è un DEFAULT e non una
  -- costante sparsa nel codice: chi lavora da altrove lo cambia qui, e tutto il
  -- motore dei promemoria lo legge da questa colonna.
  timezone              text not null default 'Europe/Zurich',

  -- La lingua in cui il SERVER scrive ciò che esce dal prodotto: la descrizione
  -- dell'evento sul calendario esterno e il testo delle email di promemoria.
  -- Non è una preferenza in più da compilare — la imposta l'interfaccia con la
  -- lingua in uso — ma deve stare nel database: un worker che gira alle 8 del
  -- mattino non ha una sessione da cui dedurla, e scrivere in italiano a un
  -- cliente germanofono perché «l'italiano è la lingua di riferimento» sarebbe
  -- un ripiego silenzioso.
  locale                text not null default 'it' check (locale in ('it', 'de', 'fr')),

  -- §96 — il titolo dell'attività nel calendario ESTERNO. Acceso: un evento che
  -- non dice cosa c'è da fare non serve a niente. Chi tiene il calendario
  -- condiviso con un assistente può spegnerlo, e l'evento diventa generico.
  show_task_title       boolean not null default true,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),

  primary key (company_id, user_id)
);

comment on table public.notification_preferences is
  'Preferenze PERSONALI per azienda. Solo il proprietario le scrive: un amministratore non può accendere le email a un collega, perché il consenso a essere contattati non è delegabile.';
comment on column public.notification_preferences.timezone is
  'Fuso orario IANA. I promemoria si generano al mattino LOCALE di questa zona, non a un''ora fissa UTC.';

-- ---------------------------------------------------------------------------
-- 4. notification_deliveries — la consegna, separata dal segnale
--
-- Perché due tabelle e non una colonna `email_sent`: una notifica È un fatto
-- avvenuto, una consegna è un tentativo che può fallire, essere ritentato e
-- fallire di nuovo. Metterli nella stessa riga significa o perdere la storia
-- dei tentativi o riscrivere il fatto ogni volta che il tentativo cambia stato.
--
-- Il vincolo unico (notification_id, channel) è l'idempotenza: un worker
-- eseguito tre volte non produce tre email.
-- ---------------------------------------------------------------------------
create table if not exists public.notification_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  notification_id     uuid not null references public.notifications (id) on delete cascade,
  channel             public.notification_channel not null,
  status              public.notification_delivery_status not null default 'pending',
  attempts            integer not null default 0,
  next_attempt_at     timestamptz not null default now(),
  -- Identificativo restituito dal provider: è ciò che permette di rispondere a
  -- «questa email è davvero partita?» senza indovinare.
  provider_message_id text,
  error_code          text,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (notification_id, channel)
);
create index if not exists idx_deliveries_due
  on public.notification_deliveries (next_attempt_at)
  where status in ('pending', 'sending');

comment on table public.notification_deliveries is
  'Tentativi di consegna su un canale esterno. Separata da `notifications` perché un fatto avvenuto e un tentativo che può fallire sono cose diverse.';

-- ---------------------------------------------------------------------------
-- 5. calendar_connections — il calendario collegato, di UNA persona
--
-- ⚠️ La differenza più importante rispetto a `email_connections`: là la
-- connessione è dell'AZIENDA (una casella aziendale la collega un
-- amministratore e serve a tutti), qui è della PERSONA. Andrea collega il
-- proprio Google, Marco il proprio Outlook, e ognuno riceve sul proprio
-- calendario le attività di cui è responsabile. Da qui il vincolo unico su
-- (company_id, user_id, provider) e una RLS che filtra su `user_id`.
--
-- `provider_calendar_id` NON è un dettaglio recuperabile: con lo scope a
-- privilegio minimo di Google (`calendar.app.created`) l'applicazione NON può
-- elencare i calendari dell'utente — `calendarList.list` non è fra i metodi che
-- quello scope autorizza. L'unico modo di ritrovare il proprio calendario è
-- averne conservato l'identificativo. Se questa colonna si perdesse, il
-- calendario resterebbe nell'account dell'utente e AI-Swisse ne creerebbe un
-- secondo: è la ragione per cui non è una colonna «di comodo».
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_connections (
  id                       uuid primary key default gen_random_uuid(),
  company_id               uuid not null references public.companies (id) on delete cascade,
  user_id                  uuid not null references auth.users (id) on delete cascade,
  provider                 public.calendar_provider not null,
  -- Identità STABILE dell'account presso il provider (Google `sub`, Microsoft
  -- `id`), non l'indirizzo: un indirizzo può essere un alias o cambiare.
  provider_account_id      text not null,
  email_address            text not null,

  -- Il calendario dedicato. NULL finché non è stato creato: uno stato legittimo
  -- fra il consenso e la prima sincronizzazione, non un dato mancante.
  provider_calendar_id     text,
  calendar_name            text,

  status                   public.calendar_connection_status not null default 'active',
  scopes                   text[] not null default '{}',
  sync_enabled             boolean not null default true,

  initial_sync_completed_at timestamptz,
  last_sync_at             timestamptz,
  last_successful_sync_at  timestamptz,
  last_error_code          text,
  last_error_at            timestamptz,

  -- Lock a SCADENZA, non booleano (stessa lezione della 0013): un processo
  -- morto non deve bloccare la sincronizzazione per sempre.
  sync_lease_id            uuid,
  sync_lease_until         timestamptz,

  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  unique (company_id, user_id, provider)
);
create index if not exists idx_cal_conn_user on public.calendar_connections (user_id, company_id);
create index if not exists idx_cal_conn_active on public.calendar_connections (company_id)
  where status = 'active' and sync_enabled;

comment on table public.calendar_connections is
  'Calendario esterno collegato da UNA persona per UNA azienda. I token non stanno qui: vedi calendar_connection_secrets.';
comment on column public.calendar_connections.provider_calendar_id is
  'Identificativo del calendario dedicato presso il provider. Con lo scope calendar.app.created di Google l''applicazione non può elencare i calendari: senza questo valore il calendario non è più ritrovabile e ne verrebbe creato un secondo.';

-- ---------------------------------------------------------------------------
-- 6. calendar_connection_secrets — token OAuth, SOLO server
--
-- Stesso modello di minaccia della 0013, e stessa conclusione: nessun GRANT,
-- nessuna policy, RLS attiva. Un `select('*')` scritto per errore in un service
-- non restituisce una riga vuota: fallisce con 42501.
-- I token sono cifrati con AES-256-GCM e la chiave vive in un secret della Edge
-- Function, non nel database. L'AAD è l'id della connessione: un ciphertext
-- copiato su un'altra riga non si decifra.
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_connection_secrets (
  connection_id           uuid primary key references public.calendar_connections (id) on delete cascade,
  company_id              uuid not null references public.companies (id) on delete cascade,

  access_token_ct         bytea,
  access_token_iv         bytea,
  access_token_expires_at timestamptz,
  refresh_token_ct        bytea,
  refresh_token_iv        bytea,

  key_version             integer not null default 1,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

comment on table public.calendar_connection_secrets is
  'Token OAuth del calendario, cifrati. Nessuna policy e nessun GRANT: irraggiungibile dal ruolo authenticated. La chiave di cifratura è un secret della Edge Function.';

-- ---------------------------------------------------------------------------
-- 7. calendar_oauth_states — stato anti-CSRF, con TRIPLO legame
--
-- Rispetto alla 0013 c'è un legame in più che qui è indispensabile: l'UTENTE.
-- Una connessione di calendario è personale, quindi il callback deve sapere non
-- solo per quale azienda ma per quale PERSONA è stato dato il consenso — e non
-- può leggerlo dalla query string, che la decide chi chiama.
--
-- In tabella sta lo SHA-256 dello state, non lo state.
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_oauth_states (
  id                uuid primary key default gen_random_uuid(),
  state_hash        text not null unique,
  company_id        uuid not null references public.companies (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  provider          public.calendar_provider not null,
  code_verifier_ct  bytea,
  code_verifier_iv  bytea,
  key_version       integer not null default 1,
  redirect_path     text,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  consumed_at       timestamptz
);
create index if not exists idx_cal_oauth_states_expiry on public.calendar_oauth_states (expires_at);

-- ---------------------------------------------------------------------------
-- 8. calendar_event_links — la corrispondenza, non una copia
--
-- Contiene un identificativo e un'impronta. NON contiene il titolo, la scadenza
-- né la priorità: quelli stanno in `tasks` e da lì si leggono ogni volta.
--
-- `content_hash` è l'impronta di ciò che è stato scritto PRESSO IL PROVIDER
-- l'ultima volta. Serve a non riscrivere un evento identico a ogni giro della
-- riconciliazione: senza, un controllo periodico su cinquanta attività
-- diventerebbe cinquanta chiamate all'API ogni volta.
--
-- `unique (connection_id, task_id)` è l'idempotenza locale: la stessa attività
-- non può avere due eventi sullo stesso calendario, qualunque cosa faccia il
-- codice del worker.
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_event_links (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies (id) on delete cascade,
  -- Ridondante rispetto alla connessione, ma la RLS deve poter filtrare per
  -- persona senza un join: la ridondanza qui è una scelta di sicurezza.
  user_id              uuid not null references auth.users (id) on delete cascade,
  connection_id        uuid not null references public.calendar_connections (id) on delete cascade,
  task_id              uuid not null references public.tasks (id) on delete cascade,

  provider_event_id    text not null,
  provider_calendar_id text not null,

  sync_status          public.calendar_link_status not null default 'pending',
  content_hash         text,
  last_synced_at       timestamptz,
  error_code           text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  unique (connection_id, task_id)
);
create index if not exists idx_cal_links_task on public.calendar_event_links (task_id);
create index if not exists idx_cal_links_conn on public.calendar_event_links (connection_id, sync_status);

comment on table public.calendar_event_links is
  'Corrispondenza fra un''attività e l''evento che la rappresenta presso un provider. Contiene un identificativo e un''impronta, mai una copia del titolo o della scadenza.';

-- ---------------------------------------------------------------------------
-- 9. calendar_sync_queue — l'outbox
--
-- Perché una coda e non una chiamata dentro il salvataggio della task: se la
-- seconda metà di `await updateTask(); await googleUpdate();` fallisce, la task
-- è salvata e il calendario no, e nessuno lo sa. Con la coda la task è salvata
-- SEMPRE e la sincronizzazione è un lavoro che può essere ritentato.
--
-- `unique (task_id)` è la COALESCENZA: un'attività modificata otto volte in un
-- minuto non produce otto chiamate all'API. Non conta quante volte è cambiata,
-- conta com'è adesso.
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_sync_queue (
  task_id         uuid primary key references public.tasks (id) on delete cascade,
  company_id      uuid not null references public.companies (id) on delete cascade,
  requested_at    timestamptz not null default now(),
  attempts        integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  -- Lease a scadenza, come per le connessioni: un worker ucciso a metà non
  -- blocca la riga per sempre.
  locked_until    timestamptz,
  lock_id         uuid,
  last_error      text
);
create index if not exists idx_cal_queue_due on public.calendar_sync_queue (next_attempt_at)
  where locked_until is null;

comment on table public.calendar_sync_queue is
  'Outbox della sincronizzazione. Una riga per attività: chiave primaria su task_id, quindi otto modifiche rapide diventano una sola sincronizzazione.';

-- ---------------------------------------------------------------------------
-- 10. calendar_sync_runs — osservabilità
--
-- Serve a rispondere a «funziona?» con dei numeri invece che con un'impressione.
-- Non contiene titoli di attività né identificativi di evento: contiene conteggi.
-- ---------------------------------------------------------------------------
create table if not exists public.calendar_sync_runs (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid references public.companies (id) on delete cascade,
  connection_id uuid references public.calendar_connections (id) on delete set null,
  provider      public.calendar_provider,
  trigger       text not null,
  status        text not null,
  upserted      integer not null default 0,
  deleted       integer not null default 0,
  failures      integer not null default 0,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  duration_ms   integer,
  error_code    text
);
create index if not exists idx_cal_runs_conn on public.calendar_sync_runs (connection_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 11. Indice per il motore dei promemoria
--
-- Gli indici della 0016 iniziano tutti con `company_id`, perché servono alle
-- liste di UNA azienda. Il worker dei promemoria fa la domanda opposta — «quali
-- attività di CHIUNQUE scadono in questa finestra» — e su quegli indici non
-- potrebbe appoggiarsi. Non è un duplicato: cambia la colonna guida.
-- `assignee_user_id` è nell'indice e non nella condizione perché servono
-- entrambi i casi: il promemoria a chi è responsabile, e l'allarme su
-- un'attività urgente che responsabile non ne ha (§32).
-- ---------------------------------------------------------------------------
create index if not exists idx_tasks_due_global
  on public.tasks (due_date, assignee_user_id)
  where status <> 'completed' and archived_at is null and due_date is not null;

-- ---------------------------------------------------------------------------
-- 12. Il guardiano delle notifiche
--
-- Due cose che il database non può lasciar decidere a chi scrive:
--   · il destinatario dev'essere MEMBRO dell'azienda della notifica. Senza
--     questo controllo una notifica potrebbe raccontare a un estraneo il titolo
--     di un'attività altrui — che è esattamente il dato che il payload contiene;
--   · `read_at` non si sposta all'indietro. «L'ho già letta» è un fatto.
-- ---------------------------------------------------------------------------
create or replace function public.notifications_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.company_members m
    where m.company_id = new.company_id and m.user_id = new.user_id
  ) then
    raise exception 'notification_recipient_not_member'
      using errcode = '23514',
            hint = 'Il destinatario non appartiene a questa azienda.';
  end if;

  if tg_op = 'UPDATE' and old.read_at is not null then
    new.read_at := old.read_at;
  end if;

  return new;
end $$;

drop trigger if exists trg_notifications_guard on public.notifications;
create trigger trg_notifications_guard
  before insert or update on public.notifications
  for each row execute function public.notifications_guard();

-- ---------------------------------------------------------------------------
-- 13. Il guardiano delle preferenze
--
-- Il fuso orario si VALIDA, non si spera. Una stringa come «Europa/Zurigo»
-- passerebbe un check di formato e farebbe fallire ogni calcolo del worker con
-- un errore che nessuno collegherebbe a un campo di testo compilato mesi prima.
-- Qui il database prova a usarla: se non è un fuso IANA, la riga non entra.
--
-- L'identità la impone anche la policy, ma il trigger RIFIUTA invece di
-- correggere in silenzio: è la lezione di `comments_guard` (0016). La
-- condizione lascia passare il service role (`auth.uid()` nullo).
-- ---------------------------------------------------------------------------
create or replace function public.notification_preferences_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_probe timestamp;
begin
  if auth.uid() is not null and new.user_id is distinct from auth.uid() then
    raise exception 'preferences_not_own'
      using errcode = '42501',
            hint = 'Le preferenze di notifica le imposta solo il loro proprietario.';
  end if;

  if not exists (
    select 1 from public.company_members m
    where m.company_id = new.company_id and m.user_id = new.user_id
  ) then
    raise exception 'preferences_not_member'
      using errcode = '23514',
            hint = 'La persona non appartiene a questa azienda.';
  end if;

  begin
    v_probe := now() at time zone new.timezone;
  exception when others then
    raise exception 'invalid_timezone'
      using errcode = '23514',
            hint = 'Il fuso orario deve essere un identificativo IANA, per esempio Europe/Zurich.';
  end;

  return new;
end $$;

drop trigger if exists trg_notification_preferences_guard on public.notification_preferences;
create trigger trg_notification_preferences_guard
  before insert or update on public.notification_preferences
  for each row execute function public.notification_preferences_guard();

drop trigger if exists trg_notification_preferences_updated on public.notification_preferences;
create trigger trg_notification_preferences_updated
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

drop trigger if exists trg_deliveries_updated on public.notification_deliveries;
create trigger trg_deliveries_updated
  before update on public.notification_deliveries
  for each row execute function public.set_updated_at();

drop trigger if exists trg_cal_conn_updated on public.calendar_connections;
create trigger trg_cal_conn_updated
  before update on public.calendar_connections
  for each row execute function public.set_updated_at();

drop trigger if exists trg_cal_secrets_updated on public.calendar_connection_secrets;
create trigger trg_cal_secrets_updated
  before update on public.calendar_connection_secrets
  for each row execute function public.set_updated_at();

drop trigger if exists trg_cal_links_updated on public.calendar_event_links;
create trigger trg_cal_links_updated
  before update on public.calendar_event_links
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 14. Il guardiano dei collegamenti evento
--
-- Un collegamento deve appartenere all'azienda E alla persona della propria
-- connessione. Senza questo controllo, chi potesse scrivere qui potrebbe
-- agganciare l'evento di una task altrui alla propria connessione — e il worker,
-- che gira con il service role, lo scriverebbe sul proprio calendario.
-- È la stessa disciplina della 0017: una funzione che scavalca la RLS deve
-- difendersi da sola, non fidarsi di una policy scritta altrove.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_links_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conn record;
  v_task_company uuid;
begin
  select c.company_id, c.user_id into v_conn
  from public.calendar_connections c where c.id = new.connection_id;

  if v_conn.company_id is null
     or v_conn.company_id is distinct from new.company_id
     or v_conn.user_id is distinct from new.user_id then
    raise exception 'calendar_link_connection_mismatch'
      using errcode = '23514',
            hint = 'Il collegamento non appartiene alla connessione indicata.';
  end if;

  select t.company_id into v_task_company from public.tasks t where t.id = new.task_id;
  if v_task_company is null or v_task_company is distinct from new.company_id then
    raise exception 'calendar_link_task_mismatch'
      using errcode = '23514',
            hint = 'L''attività non appartiene a questa azienda.';
  end if;

  return new;
end $$;

drop trigger if exists trg_cal_links_guard on public.calendar_event_links;
create trigger trg_cal_links_guard
  before insert or update on public.calendar_event_links
  for each row execute function public.calendar_links_guard();

-- ---------------------------------------------------------------------------
-- 15. Il trigger che riempie la coda
--
-- Scatta sui soli campi che cambiano ciò che il calendario deve mostrare.
-- `description` non c'è: la descrizione dell'evento esterno non la contiene
-- (§95 — nel calendario finisce il minimo indispensabile), quindi modificarla
-- non richiede una chiamata all'API.
--
-- Non si accoda nulla per le aziende che non hanno alcun calendario collegato:
-- sarebbero righe che il worker prenderebbe solo per scoprire che non c'è
-- niente da fare. La condizione è una lettura di un indice parziale.
--
-- ⚠️ Il cambio di ASSEGNATARIO produce UNA sola riga, non due. La coda è
-- indicizzata per attività e il worker guarda TUTTI i collegamenti esistenti di
-- quella task più la connessione che dovrebbe averne uno: l'evento del vecchio
-- responsabile viene rimosso e quello del nuovo creato nello stesso passaggio.
-- Una coda per (task, utente) avrebbe richiesto di sapere già qui chi perde
-- l'evento, cioè di duplicare nel trigger la logica dello stato desiderato.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_enqueue_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_relevant boolean;
begin
  if tg_op = 'INSERT' then
    v_relevant := true;
  else
    v_relevant :=
      new.title            is distinct from old.title
      or new.due_date      is distinct from old.due_date
      or new.assignee_user_id is distinct from old.assignee_user_id
      or new.status        is distinct from old.status
      or new.priority      is distinct from old.priority
      or (new.archived_at is not null) is distinct from (old.archived_at is not null);
  end if;

  if not v_relevant then return new; end if;

  if not exists (
    select 1 from public.calendar_connections c
    where c.company_id = new.company_id and c.status = 'active' and c.sync_enabled
  ) then
    return new;
  end if;

  insert into public.calendar_sync_queue (task_id, company_id, requested_at, attempts, next_attempt_at)
  values (new.id, new.company_id, now(), 0, now())
  on conflict (task_id) do update
    set requested_at    = now(),
        -- I tentativi ripartono da zero: il contenuto è cambiato, quindi il
        -- fallimento precedente riguardava una versione che non esiste più.
        attempts        = 0,
        next_attempt_at = now(),
        last_error      = null;

  return new;
end $$;

drop trigger if exists trg_tasks_calendar_enqueue on public.tasks;
create trigger trg_tasks_calendar_enqueue
  after insert or update on public.tasks
  for each row execute function public.calendar_enqueue_task();

-- ---------------------------------------------------------------------------
-- 16. Il trigger che avvisa chi riceve un'attività
--
-- Scatta solo quando il responsabile CAMBIA e diventa qualcuno. Non avvisa chi
-- si assegna un'attività da sé: sa già di averlo fatto, e una notifica per una
-- cosa che si è appena fatti da soli insegna a ignorare la campanella.
--
-- Il `payload` porta titolo e scadenza. Il collegamento lo compone la
-- schermata: mettere qui un URL significherebbe conservare un dominio che
-- domani potrebbe cambiare.
-- ---------------------------------------------------------------------------
create or replace function public.tasks_notify_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prefs boolean;
begin
  if new.assignee_user_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.assignee_user_id is not distinct from old.assignee_user_id then
    return new;
  end if;
  if auth.uid() is not null and auth.uid() = new.assignee_user_id then return new; end if;
  -- Un'attività già conclusa o archiviata non genera lavoro per nessuno.
  if new.status = 'completed' or new.archived_at is not null then return new; end if;

  -- Le preferenze possono non esistere: in quel caso valgono i default, e il
  -- default dell'in-app è ACCESO. `coalesce` su una riga assente, non su un
  -- valore nullo — sono due assenze diverse.
  select p.in_app_enabled into v_prefs
  from public.notification_preferences p
  where p.company_id = new.company_id and p.user_id = new.assignee_user_id;
  if v_prefs is not null and v_prefs = false then return new; end if;

  insert into public.notifications (company_id, user_id, type, entity_type, entity_id, payload)
  values (
    new.company_id, new.assignee_user_id, 'task_assigned', 'task', new.id,
    jsonb_build_object(
      'title', new.title,
      'dueDate', new.due_date,
      'priority', new.priority
    )
  );

  return new;
end $$;

drop trigger if exists trg_tasks_notify_assignment on public.tasks;
create trigger trg_tasks_notify_assignment
  after insert or update on public.tasks
  for each row execute function public.tasks_notify_assignment();

-- ---------------------------------------------------------------------------
-- 17. Il modello di lettura del calendario interno
--
-- Restituisce SOLO ciò che una griglia mensile mostra: niente checklist, niente
-- commenti, niente storico, niente analisi. Una vista mensile con quaranta
-- attività non deve scaricare quaranta analisi documentali per disegnare
-- quaranta righe di testo.
--
-- Le SCADUTE entrano sempre, anche quando cadono fuori dall'intervallo
-- richiesto: un'attività in ritardo non smette di esserlo perché si è girata
-- pagina al mese. È la stessa ragione per cui la Home mostra sempre le priorità
-- alte (§ dedup della 0016): nascondere un problema perché sta in un'altra
-- casella non è filtrare, è perderlo.
--
-- `security invoker` (il default): la RLS di `tasks` continua ad applicarsi.
-- Il filtro esplicito su `company_id` la accompagna, non la sostituisce.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_tasks(
  p_company_id      uuid,
  p_from            date,
  p_to              date,
  p_mine            boolean default true,
  p_status          public.task_status default null,
  p_priority        public.task_priority default null,
  p_assignee        uuid default null,
  p_include_overdue boolean default true,
  p_limit           integer default 500
)
returns table (
  id uuid, title text, due_date date,
  priority public.task_priority, status public.task_status, source public.task_source,
  assignee_user_id uuid, assignee_name text, document_id uuid
)
language sql
stable
set search_path = ''
as $$
  select
    t.id, t.title, t.due_date, t.priority, t.status, t.source,
    t.assignee_user_id,
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '') as assignee_name,
    t.document_id
  from public.tasks t
  left join public.profiles p on p.id = t.assignee_user_id
  where t.company_id = p_company_id
    and t.archived_at is null
    and t.due_date is not null
    and (
      (t.due_date >= p_from and t.due_date <= p_to)
      -- ⚠️ `<=` e non `<`. Il database vive in UTC, l'utente in Europe/Zurich:
      -- alle 00:30 locali di giovedì, per Postgres è ancora mercoledì, e
      -- un'attività scaduta mercoledì non rientrerebbe in `due_date < current_date`.
      -- Un giorno di margine costa una riga in più e chiude la finestra.
      -- Qui si SELEZIONA soltanto: che cosa sia «in ritardo» lo decide
      -- `isOverdue()` in `taskFormat`, la stessa funzione che usano Attività e
      -- Panoramica. Due definizioni di «scaduta» sono due schermate che prima o
      -- poi si contraddicono.
      or (coalesce(p_include_overdue, true)
          and t.status <> 'completed'
          and t.due_date <= current_date)
    )
    and (not coalesce(p_mine, false) or t.assignee_user_id = auth.uid())
    and (p_status   is null or t.status = p_status)
    and (p_priority is null or t.priority = p_priority)
    and (p_assignee is null or t.assignee_user_id = p_assignee)
  order by t.due_date asc, case t.priority when 'high' then 0 when 'medium' then 1 else 2 end, t.created_at desc
  limit greatest(1, least(coalesce(p_limit, 500), 1000));
$$;

revoke all on function public.calendar_tasks(uuid, date, date, boolean, public.task_status, public.task_priority, uuid, boolean, integer) from public, anon;
grant execute on function public.calendar_tasks(uuid, date, date, boolean, public.task_status, public.task_priority, uuid, boolean, integer) to authenticated;

-- Quante attività non hanno scadenza (§21). Si mostra il numero e si rimanda
-- ad Attività: non si inventa una data per farle stare in una casella.
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
    and t.status <> 'completed'
    and (not coalesce(p_mine, false) or t.assignee_user_id = auth.uid());
$$;

revoke all on function public.calendar_undated_count(uuid, boolean) from public, anon;
grant execute on function public.calendar_undated_count(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 18. Notifiche: lettura e conteggio
--
-- «Segna come letta» passa da una funzione e non da un `update`: così il client
-- non ha alcun permesso di scrittura sulla tabella, e non esiste un percorso in
-- cui una notifica venga alterata in qualcosa di diverso da «letta».
-- `security invoker`: la RLS filtra già per utente. Il filtro su `auth.uid()`
-- scritto qui dentro la accompagna — un'ora spesa a scrivere due volte la stessa
-- condizione costa meno di un pomeriggio a capire perché non c'era.
-- ---------------------------------------------------------------------------
create or replace function public.notifications_mark_read(p_ids uuid[])
returns integer
language sql
volatile
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

create or replace function public.notifications_unread_count(p_company_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::integer
  from public.notifications n
  where n.company_id = p_company_id
    and n.user_id = auth.uid()
    and n.read_at is null;
$$;

revoke all on function public.notifications_mark_read(uuid[])     from public, anon;
revoke all on function public.notifications_mark_all_read(uuid)   from public, anon;
revoke all on function public.notifications_unread_count(uuid)    from public, anon;
grant execute on function public.notifications_mark_read(uuid[])   to authenticated;
grant execute on function public.notifications_mark_all_read(uuid) to authenticated;
grant execute on function public.notifications_unread_count(uuid)  to authenticated;

-- ---------------------------------------------------------------------------
-- 19. La coda: prenotazione atomica di un lotto
--
-- `for update skip locked` è ciò che permette a due esecuzioni sovrapposte del
-- worker di lavorare senza pestarsi i piedi e senza che una resti ferma ad
-- aspettare l'altra. Il `locked_until` sopravvive alla transazione: se
-- l'isolate viene ucciso a metà (i 150 secondi di Supabase), la riga si libera
-- da sola alla scadenza invece di restare presa per sempre.
--
-- `security definer` perché la tabella non ha alcun permesso per il client, e
-- l'esecuzione è concessa al solo `service_role`.
-- ---------------------------------------------------------------------------
create or replace function public.calendar_queue_claim(
  p_limit        integer default 20,
  p_lock_seconds integer default 120,
  -- Restringe la prenotazione a un insieme di attività. Serve al pulsante
  -- «Sincronizza ora»: senza, prenoterebbe le righe più VECCHIE della coda —
  -- che possono essere di chiunque — e il messaggio «N eventi aggiornati»
  -- conterebbe il lavoro di qualcun altro. NULL = tutta la coda, che è ciò che
  -- serve allo scheduler.
  p_task_ids     uuid[] default null
)
returns table (task_id uuid, company_id uuid, attempts integer, lock_id uuid)
language sql
security definer
set search_path = ''
as $$
  with candidati as (
    select q.task_id as tid
    from public.calendar_sync_queue q
    where q.next_attempt_at <= now()
      and (q.locked_until is null or q.locked_until < now())
      and (p_task_ids is null or q.task_id = any(p_task_ids))
    order by q.next_attempt_at asc
    limit greatest(1, least(coalesce(p_limit, 20), 100))
    for update skip locked
  ),
  aggiornati as (
    update public.calendar_sync_queue q
       set locked_until = now() + make_interval(secs => greatest(30, least(coalesce(p_lock_seconds, 120), 600))),
           -- Un lock per RIGA, non per lotto: chi rilascia una riga non può
           -- liberare per sbaglio quelle che un'altra esecuzione sta trattando.
           lock_id      = gen_random_uuid()
      from candidati c
     where q.task_id = c.tid
    returning q.task_id, q.company_id, q.attempts, q.lock_id
  )
  select a.task_id, a.company_id, a.attempts, a.lock_id from aggiornati a;
$$;

revoke all on function public.calendar_queue_claim(integer, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.calendar_queue_claim(integer, integer, uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 20. RLS
-- ---------------------------------------------------------------------------
alter table public.notifications                enable row level security;
alter table public.notification_preferences     enable row level security;
alter table public.notification_deliveries      enable row level security;
alter table public.calendar_connections         enable row level security;
alter table public.calendar_connection_secrets  enable row level security;
alter table public.calendar_oauth_states        enable row level security;
alter table public.calendar_event_links         enable row level security;
alter table public.calendar_sync_queue          enable row level security;
alter table public.calendar_sync_runs           enable row level security;

-- Prima si toglie TUTTO. `service_role` non compare: è il ruolo con cui
-- scrivono le Edge Function e deve conservare i propri permessi.
revoke all on public.notifications               from anon, authenticated, public;
revoke all on public.notification_preferences    from anon, authenticated, public;
revoke all on public.notification_deliveries     from anon, authenticated, public;
revoke all on public.calendar_connections        from anon, authenticated, public;
revoke all on public.calendar_connection_secrets from anon, authenticated, public;
revoke all on public.calendar_oauth_states       from anon, authenticated, public;
revoke all on public.calendar_event_links        from anon, authenticated, public;
revoke all on public.calendar_sync_queue         from anon, authenticated, public;
revoke all on public.calendar_sync_runs          from anon, authenticated, public;

-- NOTIFICHE — sola lettura. La marcatura passa dalle funzioni del punto 18.
grant select on public.notifications to authenticated;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own on public.notifications
  for select to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id));
-- L'UPDATE esiste per far passare `read_at` scritto dalle funzioni, che girano
-- `security invoker`. Resta inutilizzabile dal client: non c'è alcun GRANT di
-- UPDATE sulla tabella, quindi la policy da sola non basta ad aprire nulla.
drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own on public.notifications
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- PREFERENZE — lettura e scrittura delle PROPRIE. Nessun DELETE: cancellare le
-- preferenze significherebbe tornare ai default senza dirlo; si modificano.
grant select, insert, update on public.notification_preferences to authenticated;

drop policy if exists prefs_select_own on public.notification_preferences;
create policy prefs_select_own on public.notification_preferences
  for select to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id));
drop policy if exists prefs_insert_own on public.notification_preferences;
create policy prefs_insert_own on public.notification_preferences
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_company_member(company_id));
drop policy if exists prefs_update_own on public.notification_preferences;
create policy prefs_update_own on public.notification_preferences
  for update to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id))
  with check (user_id = auth.uid() and public.is_company_member(company_id));

-- CONNESSIONI — solo le PROPRIE, e solo le colonne che una schermata mostra.
-- Un collega non vede la connessione di un altro: nulla nell'interfaccia ne ha
-- bisogno, e ciò che non serve non si espone (§85).
-- ⚠️ Da qui in avanti `select('*')` su questa tabella FALLISCE con «permission
-- denied for column»: è voluto, ed è il motivo per cui il service elenca le
-- colonne una per una.
grant select (
  id, company_id, user_id, provider, email_address, provider_calendar_id, calendar_name,
  status, scopes, sync_enabled, initial_sync_completed_at, last_sync_at,
  last_successful_sync_at, last_error_code, last_error_at, created_at, updated_at
) on public.calendar_connections to authenticated;

drop policy if exists cal_conn_select_own on public.calendar_connections;
create policy cal_conn_select_own on public.calendar_connections
  for select to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id));

-- COLLEGAMENTI EVENTO — sola lettura, e solo i propri: servono a dire «questa
-- attività è sul tuo calendario» e nient'altro.
grant select on public.calendar_event_links to authenticated;

drop policy if exists cal_links_select_own on public.calendar_event_links;
create policy cal_links_select_own on public.calendar_event_links
  for select to authenticated
  using (user_id = auth.uid() and public.is_company_member(company_id));

-- SEGRETI, STATI OAUTH, CODA, ESECUZIONI, CONSEGNE — nessun permesso, per
-- nessuno. Il `revoke` di sopra è già sufficiente; qui non si concede nulla.
-- Le consegne email restano fuori dalla portata del client di proposito: sapere
-- che un'email è stata inviata è un dato di esercizio, non una schermata.

-- ---------------------------------------------------------------------------
-- 21. Autoverifica
--
-- La migrazione controlla di aver ottenuto ciò che dichiara. Se un domani
-- qualcuno concedesse per sbaglio la scrittura sulle notifiche o un permesso
-- qualsiasi sui token, questa migrazione rieseguita lo direbbe subito — invece
-- di lasciar passare una falla che non produce alcun sintomo visibile finché
-- qualcuno non la sfrutta. È la lezione della 0014.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s (%s)', table_name, privilege_type), ', ')
    into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated', 'public')
     and table_name in (
       'calendar_connection_secrets', 'calendar_oauth_states',
       'calendar_sync_queue', 'calendar_sync_runs', 'notification_deliveries'
     );
  if v_bad is not null then
    raise exception 'Le tabelle di servizio del calendario non devono avere alcun permesso: %', v_bad;
  end if;

  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated', 'public')
     and table_name in ('notifications', 'calendar_event_links')
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'Notifiche e collegamenti evento non devono essere scrivibili dal client: %', v_bad;
  end if;

  select string_agg(format('calendar_connections.%s (%s)', column_name, privilege_type), ', ')
    into v_bad
    from information_schema.column_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and table_name = 'calendar_connections'
     and privilege_type in ('INSERT', 'UPDATE', 'DELETE');
  if v_bad is not null then
    raise exception 'Le connessioni di calendario non devono essere scrivibili dal client: %', v_bad;
  end if;

  raise notice 'Permessi 0018 verificati: token irraggiungibili, notifiche non fabbricabili, coda del solo server.';
end $$;
