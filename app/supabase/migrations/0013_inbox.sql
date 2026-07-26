-- ============================================================================
-- AI-Swisse — 0013 INBOX
--
-- Acquisizione della posta aziendale (Google Workspace / Microsoft 365) come
-- punto d'ingresso del back-office. NON è un secondo motore di analisi: una
-- email amministrativamente rilevante diventa un `documents` normale e passa
-- dalla pipeline Admin AI già esistente. Qui si modella solo ciò che la posta
-- ha in più: la connessione al provider, il messaggio, i suoi allegati e la
-- RELAZIONE fra messaggio e documento.
--
-- Le tre separazioni che reggono lo schema
--   1. CONNESSIONE ≠ SEGRETI. `email_connections` contiene metadati che un
--      membro può vedere; i token OAuth stanno in `email_connection_secrets`,
--      che NON ha alcuna policy e a cui il ruolo `authenticated` non ha alcun
--      permesso. Un client con la chiave anon non può leggerli in nessun modo,
--      nemmeno per errore di programmazione lato applicazione.
--   2. STATO DELLA MACCHINA ≠ STATO DELL'UTENTE. `processing_status` racconta
--      dove è arrivata la pipeline; `attention_status` racconta cosa deve fare
--      una persona. Confonderli significa che un guasto tecnico si traveste da
--      «niente da fare» — esattamente il falso negativo che qui è più pericoloso
--      del falso positivo.
--   3. STATO LOCALE ≠ STATO DEL PROVIDER. Niente in questo schema descrive
--      Gmail o Outlook: `handled_at` significa «tolto dalla vista operativa di
--      AI-Swisse», non «archiviato su Gmail». La versione 1 è in sola lettura
--      verso il provider e lo schema non offre nemmeno il posto dove annotare
--      il contrario.
--
-- Cancellazioni (§79). `email_messages.connection_id` cascata sulla connessione,
-- ma **disconnettere non cancella**: `email-disconnect` porta la connessione a
-- `disconnected` e distrugge i segreti, senza toccare una riga di posta. La
-- cascata esiste solo per la cancellazione dell'azienda, dove tutto deve sparire.
-- Un eventuale «elimina dati importati» sarà un'azione separata e dichiarata.
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- Ricerca testuale server-side (§10): trigram, così `ilike '%…%'` usa un indice
-- invece di scaricare la Inbox nel browser per filtrarla lì.
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------------------
-- 1. Enum
--
-- Enum e non testo libero dove il valore governa una decisione (routing della
-- pipeline, visibilità in Inbox, autorizzazioni): un refuso in una stringa
-- libera diventerebbe una categoria nuova e silenziosa. Restano testo i campi
-- puramente descrittivi (error_code, importance), dove il valore arriva dal
-- provider e inventarne un enum significherebbe rifiutare valori legittimi.
-- ---------------------------------------------------------------------------
do $$ begin create type public.email_provider as enum ('google', 'microsoft');
exception when duplicate_object then null; end $$;

do $$ begin create type public.email_connection_status as enum
  ('active', 'reauth_required', 'error', 'disconnected');
exception when duplicate_object then null; end $$;

do $$ begin create type public.email_sync_type as enum
  ('initial', 'incremental', 'manual', 'reconciliation');
exception when duplicate_object then null; end $$;

do $$ begin create type public.email_sync_status as enum
  ('running', 'ok', 'partial', 'failed');
exception when duplicate_object then null; end $$;

-- Stato della PIPELINE su un messaggio. Descrive il lavoro della macchina.
do $$ begin create type public.email_processing_status as enum
  ('pending', 'classifying', 'importing', 'analyzing', 'done', 'failed');
exception when duplicate_object then null; end $$;

-- Stato di ATTENZIONE per una persona. Descrive cosa c'è da fare.
-- `ignored` = il classificatore l'ha giudicata non amministrativa: la riga
-- resta e resta recuperabile, non viene nascosta per sempre.
do $$ begin create type public.email_attention_status as enum
  ('needs_attention', 'to_verify', 'informational', 'ignored', 'handled');
exception when duplicate_object then null; end $$;

-- Esito del classificatore. Deliberatamente CONSERVATIVO: `clearly_irrelevant`
-- richiede segnali forti e concordi, perché una comunicazione amministrativa
-- persa costa molto più di una newsletter mostrata di troppo.
do $$ begin create type public.email_relevance as enum
  ('likely_actionable', 'possibly_actionable', 'informational', 'clearly_irrelevant');
exception when duplicate_object then null; end $$;

do $$ begin create type public.email_document_relation as enum ('body', 'attachment');
exception when duplicate_object then null; end $$;

-- Perché un allegato non è stato importato: la ragione è un dato, non un log.
-- L'utente deve poter capire che quel PDF non è stato letto e perché.
do $$ begin create type public.email_attachment_import_status as enum
  ('pending', 'imported', 'skipped_inline', 'skipped_unsupported', 'skipped_too_large', 'failed');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. email_connections — la casella collegata
--
-- `provider_account_id` è l'identità STABILE del provider (Google `sub`,
-- Microsoft `id` della mailbox), non l'indirizzo: un indirizzo può essere un
-- alias o cambiare, e usarlo come identità farebbe apparire lo stesso account
-- come due connessioni diverse dopo una rinomina (§127). L'indirizzo resta,
-- perché è ciò che l'utente riconosce.
--
-- Il vincolo è per AZIENDA, non globale: una fiduciaria può legittimamente
-- collegare la stessa casella a due mandati, e vietarlo qui significherebbe
-- decidere un modello commerciale dentro uno schema (§74).
-- ---------------------------------------------------------------------------
create table if not exists public.email_connections (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies (id) on delete cascade,
  connected_by              uuid references auth.users (id) on delete set null,
  provider                  public.email_provider not null,
  provider_account_id       text not null,
  email_address             text not null,
  display_name              text,
  status                    public.email_connection_status not null default 'active',
  -- Scope realmente concessi dal provider, così la schermata «Account email»
  -- può dire cosa AI-Swisse può fare invece di quello che ha chiesto.
  scopes                    text[] not null default '{}',
  sync_enabled              boolean not null default true,

  -- Cursore di sincronizzazione incrementale: `historyId` per Gmail, `deltaLink`
  -- per Microsoft Graph. Opaco per l'applicazione, che non lo interpreta mai.
  sync_cursor               text,
  -- Confine inferiore dell'import iniziale (§44): oltre questa data non si
  -- risale. Serve alla riconciliazione per sapere cosa NON è un buco.
  history_floor_at          timestamptz,

  initial_sync_completed_at timestamptz,
  last_sync_at              timestamptz,
  last_successful_sync_at   timestamptz,
  last_error_code           text,
  last_error_at             timestamptz,

  -- Push: `watch_resource_id` è la subscription Graph o il topic watch Gmail.
  watch_resource_id         text,
  watch_expires_at          timestamptz,
  watch_last_renewed_at     timestamptz,
  watch_last_error_code     text,

  -- §125 — lock di sincronizzazione a SCADENZA, non booleano. Un `is_syncing`
  -- senza scadenza resta true per sempre se il processo muore, e la casella non
  -- si sincronizza più senza che nessuno sappia perché.
  sync_lease_id             uuid,
  sync_lease_until          timestamptz,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  unique (company_id, provider, provider_account_id)
);
create index if not exists idx_email_conn_company on public.email_connections (company_id);
-- Selezione delle connessioni da rinnovare/riconciliare, per il job periodico.
create index if not exists idx_email_conn_due on public.email_connections (status, sync_enabled, watch_expires_at)
  where status = 'active' and sync_enabled;

comment on table public.email_connections is
  'Casella di posta collegata a un''azienda. I token NON stanno qui: vedi email_connection_secrets.';
comment on column public.email_connections.sync_lease_until is
  'Scadenza del lock di sincronizzazione. A scadenza, non booleano: un processo morto non deve bloccare la casella per sempre.';
comment on column public.email_connections.history_floor_at is
  'Data più antica importata. La riconciliazione non cerca buchi prima di questo istante: là non c''è un buco, c''è un confine dichiarato.';

-- ---------------------------------------------------------------------------
-- 3. email_connection_secrets — token OAuth, SOLO server
--
-- MODELLO DI MINACCIA (§18), esplicito perché la sicurezza di questa tabella è
-- l'unica cosa che separa un bug applicativo dalla lettura della posta altrui.
--
--   · Client con chiave anon e sessione valida — bloccato due volte: nessun
--     GRANT al ruolo `authenticated` e RLS attiva senza policy. Anche un
--     `select('*')` scritto per errore in un service non restituisce nulla:
--     PostgREST risponde 42501, non una riga vuota.
--   · Chiave anon rubata — identico al caso sopra: la chiave anon non conferisce
--     alcun accesso a questa tabella.
--   · Dump del database — i token sono cifrati con AES-256-GCM e la chiave NON
--     è nel database: vive come secret della Edge Function (EMAIL_TOKEN_KEY).
--     Un dump da solo non basta per leggere la posta.
--   · Service role compromessa — NON è mitigato da questo schema: chi ha la
--     service role E la chiave di cifratura ha i token. È il limite dichiarato,
--     e vale già oggi per l'intero database.
--
-- Sono `bytea` e non `text` perché sono byte, non testo: nessuna codifica
-- intermedia da sbagliare, e nessuna tentazione di leggerli «tanto per vedere».
-- ---------------------------------------------------------------------------
create table if not exists public.email_connection_secrets (
  connection_id             uuid primary key references public.email_connections (id) on delete cascade,
  company_id                uuid not null references public.companies (id) on delete cascade,

  access_token_ct           bytea,
  access_token_iv           bytea,
  access_token_expires_at   timestamptz,
  refresh_token_ct          bytea,
  refresh_token_iv          bytea,
  -- Microsoft: `clientState` con cui si autentica la notifica in arrivo. È un
  -- segreto condiviso, quindi sta qui e non nella tabella dei metadati.
  webhook_state_ct          bytea,
  webhook_state_iv          bytea,

  -- Versione della chiave di cifratura: permette una rotazione futura senza
  -- dover indovinare con quale chiave è stato cifrato ogni record.
  key_version               integer not null default 1,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

comment on table public.email_connection_secrets is
  'Token OAuth cifrati (AES-256-GCM). Nessuna policy e nessun GRANT: irraggiungibile dal ruolo authenticated. La chiave di cifratura è un secret della Edge Function, non sta nel database.';

-- ---------------------------------------------------------------------------
-- 4. email_oauth_states — stato anti-CSRF del flusso OAuth (§72)
--
-- Lo `state` non viaggia firmato ma OPACO: il client riceve un valore casuale e
-- il server ritrova qui il contesto. Così il callback non si fida mai di un
-- `company_id` arrivato dalla query string — che sarebbe la via più diretta per
-- collegare la casella di qualcun altro alla propria azienda.
--
-- In tabella sta lo SHA-256 del valore, non il valore: chi leggesse questa
-- tabella non otterrebbe uno state utilizzabile. Il `code_verifier` PKCE è
-- cifrato come i token, perché è a tutti gli effetti un segreto di sessione.
-- ---------------------------------------------------------------------------
create table if not exists public.email_oauth_states (
  id                uuid primary key default gen_random_uuid(),
  state_hash        text not null unique,
  company_id        uuid not null references public.companies (id) on delete cascade,
  user_id           uuid not null references auth.users (id) on delete cascade,
  provider          public.email_provider not null,
  code_verifier_ct  bytea,
  code_verifier_iv  bytea,
  key_version       integer not null default 1,
  redirect_path     text,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  consumed_at       timestamptz
);
create index if not exists idx_email_oauth_states_expiry on public.email_oauth_states (expires_at);

comment on table public.email_oauth_states is
  'Stato OAuth monouso e a scadenza breve. Contiene lo SHA-256 dello state, non lo state: leggere questa tabella non permette di fabbricarne uno valido.';

-- ---------------------------------------------------------------------------
-- 5. email_messages — il messaggio normalizzato
--
-- Non si conserva l'HTML del provider. Il corpo viene ridotto server-side a
-- TESTO con un tokenizzatore che scarta script, stile, gestori di evento e
-- risorse remote; i collegamenti vengono estratti a parte, con la loro
-- destinazione reale. Conseguenze volute:
--   · non esiste HTML non fidato da sanificare al momento del render, quindi
--     non esiste il bug in cui la sanificazione viene dimenticata (§54);
--   · nessun pixel di tracciamento può partire, perché non c'è nulla da
--     caricare: la privacy non dipende da un'opzione lasciata spenta (§55);
--   · il testo su cui l'AI ragiona è lo stesso che l'utente legge, quindi una
--     citazione resta verificabile.
-- Il prezzo è che la posta non si vede impaginata. In una Inbox che serve a
-- decidere cosa richiede attenzione, è un prezzo che vale la pena pagare.
-- ---------------------------------------------------------------------------
create table if not exists public.email_messages (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  connection_id          uuid not null references public.email_connections (id) on delete cascade,

  provider_message_id    text not null,
  provider_thread_id     text,
  internet_message_id    text,

  subject                text,
  sender_name            text,
  sender_email           text,
  -- To/CC come jsonb: [{ "name": "...", "email": "..." }]. Normalizzarli in
  -- tabelle separate darebbe la possibilità di interrogarli, che qui non serve
  -- a nessuna schermata; il costo sarebbero due join per ogni riga di lista.
  to_recipients          jsonb not null default '[]'::jsonb,
  cc_recipients          jsonb not null default '[]'::jsonb,

  received_at            timestamptz not null,
  sent_at                timestamptz,

  body_text              text,
  body_preview           text,
  -- Collegamenti estratti dal corpo: [{ "url": "...", "label": "...", "host": "..." }].
  -- Solo http/https, validati server-side: l'interfaccia mostra il dominio vero,
  -- non il testo che il mittente ha scelto di far vedere (§56).
  body_links             jsonb not null default '[]'::jsonb,
  body_char_count        integer,
  -- Il corpo depurato di firme e storico citato, usato per la classificazione.
  -- Deriva da `body_text`, che resta intatto: quando il taglio è dubbio non si
  -- taglia, e in nessun caso si perde l'originale normalizzato (§115/§116).
  body_clean             text,
  quoted_removed         boolean not null default false,

  has_attachments        boolean not null default false,
  attachment_count       integer not null default 0,
  importance             text,
  -- Segnale di posta di massa (List-Unsubscribe, Precedence: bulk). È un FATTO
  -- letto dagli header, non un giudizio: il giudizio è `relevance`.
  is_bulk                boolean not null default false,

  processing_status      public.email_processing_status not null default 'pending',
  attention_status       public.email_attention_status not null default 'to_verify',
  relevance              public.email_relevance,
  relevance_confidence   numeric(4,3),
  relevance_reason       text,
  -- §118 — riproducibilità della decisione: con quale regola e quale modello è
  -- stata presa. Senza questi campi, «perché questa email è finita fra le
  -- irrilevanti?» non ha risposta.
  classifier_version     text,
  classifier_provider    text,
  classifier_model       text,
  classifier_prompt_version text,
  classified_at          timestamptz,

  error_code             text,
  error_message_safe     text,

  seen_at                timestamptz,
  handled_at             timestamptz,
  handled_by             uuid references auth.users (id) on delete set null,

  -- §117 — impronta della fonte al momento dell'acquisizione. Una
  -- risincronizzazione che trovasse un contenuto diverso NON riscrive in
  -- silenzio ciò che è già stato analizzato: la divergenza è rilevabile.
  source_fingerprint     text,

  -- COPIA della scadenza trovata dall'analisi collegata, al solo scopo di
  -- filtrare e ordinare la lista senza join (§9/§104). La fonte di verità
  -- resta `document_analyses`: qui non c'è la citazione, non c'è la fiducia,
  -- non c'è il tipo di scadenza, e la schermata di dettaglio legge sempre
  -- dall'analisi. La scrive solo la pipeline, dopo un'analisi riuscita.
  analysis_deadline      date,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- §26 — l'idempotenza non è una condizione nel codice applicativo ma un
  -- vincolo del database: un webhook consegnato due volte non può creare due
  -- righe, qualunque cosa faccia il codice.
  unique (connection_id, provider_message_id)
);

-- Ricerca (§10). Colonna generata + indice trigram: la ricerca resta sul
-- server anche con decine di migliaia di messaggi.
alter table public.email_messages
  add column if not exists search_text text
  generated always as (
    lower(coalesce(subject, '') || ' ' || coalesce(sender_name, '') || ' '
          || coalesce(sender_email, '') || ' ' || coalesce(body_preview, ''))
  ) stored;

-- Ordinamento stabile della lista e paginazione keyset (§76).
create index if not exists idx_email_msg_company_recv
  on public.email_messages (company_id, received_at desc, id desc);
create index if not exists idx_email_msg_company_attention
  on public.email_messages (company_id, attention_status, received_at desc, id desc);
create index if not exists idx_email_msg_connection on public.email_messages (connection_id);
create index if not exists idx_email_msg_thread on public.email_messages (company_id, provider_thread_id)
  where provider_thread_id is not null;
create index if not exists idx_email_msg_search on public.email_messages using gin (search_text gin_trgm_ops);
-- Ripresa del lavoro rimasto indietro: poche righe, quindi indice parziale.
create index if not exists idx_email_msg_pending on public.email_messages (company_id, processing_status, received_at)
  where processing_status in ('pending', 'failed');
create index if not exists idx_email_msg_internet_id on public.email_messages (company_id, internet_message_id)
  where internet_message_id is not null;
-- Filtro «con una scadenza vicina»: poche righe, indice parziale.
create index if not exists idx_email_msg_deadline on public.email_messages (company_id, analysis_deadline)
  where analysis_deadline is not null;

comment on column public.email_messages.body_text is
  'Testo normalizzato del messaggio. L''HTML del provider non viene conservato: viene ridotto a testo server-side, quindi non esiste HTML non fidato da rendere.';
comment on column public.email_messages.attention_status is
  'Stato per una persona. Indipendente da processing_status: un guasto tecnico non deve mai apparire come "niente da fare".';

-- ---------------------------------------------------------------------------
-- 6. email_attachments
--
-- `declared_mime_type` è quello che DICE il provider, `mime_type` quello che il
-- server ha accettato dopo la validazione. Tenerli separati permette di non
-- fidarsi del primo (§15) senza perderlo: se un giorno la politica cambia, si
-- sa cosa era stato dichiarato.
-- ---------------------------------------------------------------------------
create table if not exists public.email_attachments (
  id                      uuid primary key default gen_random_uuid(),
  company_id              uuid not null references public.companies (id) on delete cascade,
  email_message_id        uuid not null references public.email_messages (id) on delete cascade,
  provider_attachment_id  text not null,

  filename                text,
  safe_filename           text,
  declared_mime_type      text,
  mime_type               text,
  size_bytes              bigint,
  content_id              text,
  is_inline               boolean not null default false,

  storage_path            text,
  file_hash               text,
  import_status           public.email_attachment_import_status not null default 'pending',
  skip_reason             text,
  error_code              text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),

  unique (email_message_id, provider_attachment_id)
);
create index if not exists idx_email_att_message on public.email_attachments (email_message_id);
create index if not exists idx_email_att_company on public.email_attachments (company_id);
create index if not exists idx_email_att_hash on public.email_attachments (company_id, file_hash)
  where file_hash is not null;

-- ---------------------------------------------------------------------------
-- 7. email_message_documents — la relazione email ↔ documento (§16/§59/§60)
--
-- Tabella di relazione e non colonne email dentro `documents`: la stessa email
-- può generare più documenti (corpo + allegati) e lo STESSO documento può
-- essere raggiunto da più email — è precisamente ciò che succede quando la
-- deduplicazione per hash riconosce un PDF già caricato a mano. Deduplicare il
-- documento non deve far perdere la traccia che quel PDF era allegato anche a
-- QUEL messaggio.
--
-- Due indici unici parziali invece di un unique con colonna nullable: in SQL
-- due NULL non sono uguali, quindi `unique (message, relation, attachment_id)`
-- non impedirebbe affatto due righe `body`.
-- ---------------------------------------------------------------------------
create table if not exists public.email_message_documents (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies (id) on delete cascade,
  email_message_id  uuid not null references public.email_messages (id) on delete cascade,
  document_id       uuid not null references public.documents (id) on delete cascade,
  relation          public.email_document_relation not null,
  attachment_id     uuid references public.email_attachments (id) on delete cascade,
  created_at        timestamptz not null default now(),

  -- Un allegato genera un documento, non due; un corpo non ha allegato.
  constraint email_msg_doc_shape check (
    (relation = 'body' and attachment_id is null)
    or (relation = 'attachment' and attachment_id is not null)
  )
);
create unique index if not exists uq_email_msg_doc_body
  on public.email_message_documents (email_message_id) where relation = 'body';
create unique index if not exists uq_email_msg_doc_attachment
  on public.email_message_documents (email_message_id, attachment_id) where relation = 'attachment';
create index if not exists idx_email_msg_doc_document on public.email_message_documents (document_id);
create index if not exists idx_email_msg_doc_company on public.email_message_documents (company_id);

-- ---------------------------------------------------------------------------
-- 8. email_sync_runs — perché questa casella non si aggiorna (§47/§48)
--
-- Audit tecnico, non contenuto: identificatori, conteggi, esito. Mai un oggetto,
-- mai un mittente, mai un token. Serve a rispondere a una domanda di esercizio,
-- e per rispondere non serve sapere cosa c'era scritto nelle email.
-- ---------------------------------------------------------------------------
create table if not exists public.email_sync_runs (
  id                     uuid primary key default gen_random_uuid(),
  company_id             uuid not null references public.companies (id) on delete cascade,
  connection_id          uuid not null references public.email_connections (id) on delete cascade,
  sync_type              public.email_sync_type not null,
  status                 public.email_sync_status not null default 'running',
  triggered_by           text,                       -- user | webhook | schedule | oauth_callback
  started_at             timestamptz not null default now(),
  completed_at           timestamptz,
  duration_ms            integer,
  messages_seen          integer not null default 0,
  messages_new           integer not null default 0,
  messages_updated       integer not null default 0,
  attachments_imported   integer not null default 0,
  documents_created      integer not null default 0,
  analyses_started       integer not null default 0,
  cursor_before          text,
  cursor_after           text,
  error_code             text,
  error_detail_safe      text,
  created_at             timestamptz not null default now()
);
create index if not exists idx_email_sync_runs_conn on public.email_sync_runs (connection_id, started_at desc);
create index if not exists idx_email_sync_runs_company on public.email_sync_runs (company_id, started_at desc);

-- ---------------------------------------------------------------------------
-- 9. email_webhook_events — idempotenza delle notifiche (§26/§49)
--
-- Si conserva un'IMPRONTA dell'evento, non il suo payload: per riconoscere un
-- duplicato basta sapere che quell'evento è già passato. Il vincolo unico fa il
-- lavoro; il codice applicativo non deve ricordarsi di controllare.
-- ---------------------------------------------------------------------------
create table if not exists public.email_webhook_events (
  id                 uuid primary key default gen_random_uuid(),
  provider           public.email_provider not null,
  connection_id      uuid references public.email_connections (id) on delete cascade,
  event_fingerprint  text not null unique,
  received_at        timestamptz not null default now(),
  processed_at       timestamptz,
  status             text not null default 'received',   -- received | processed | ignored | failed
  error_code         text
);
create index if not exists idx_email_webhook_received on public.email_webhook_events (received_at desc);

-- ---------------------------------------------------------------------------
-- 10. email_audit_log — chi ha collegato questa casella (§81)
--
-- Non è un SIEM. Sono le poche azioni per cui «chi è stato» è una domanda
-- legittima: collegare, riconnettere, disconnettere, forzare una sincronizzazione.
-- ---------------------------------------------------------------------------
create table if not exists public.email_audit_log (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  connection_id  uuid references public.email_connections (id) on delete set null,
  actor_user_id  uuid references auth.users (id) on delete set null,
  action         text not null,          -- connected | reconnected | disconnected | sync_requested
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_email_audit_company on public.email_audit_log (company_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 11. Trigger updated_at
-- ---------------------------------------------------------------------------
drop trigger if exists trg_email_conn_updated on public.email_connections;
create trigger trg_email_conn_updated before update on public.email_connections
  for each row execute function public.set_updated_at();

drop trigger if exists trg_email_secrets_updated on public.email_connection_secrets;
create trigger trg_email_secrets_updated before update on public.email_connection_secrets
  for each row execute function public.set_updated_at();

drop trigger if exists trg_email_msg_updated on public.email_messages;
create trigger trg_email_msg_updated before update on public.email_messages
  for each row execute function public.set_updated_at();

drop trigger if exists trg_email_att_updated on public.email_attachments;
create trigger trg_email_att_updated before update on public.email_attachments
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 12. Il client può cambiare solo lo stato UMANO del messaggio
--
-- I permessi di colonna (punto 14) impediscono già di scrivere altrove. Questo
-- trigger aggiunge le due cose che un GRANT non sa esprimere:
--   · verso quali valori `attention_status` può muoversi da un'azione manuale —
--     un membro può dire «gestita» o rimetterla in lista, non può promuovere a
--     `needs_attention` una email che il classificatore ha giudicato altrimenti,
--     perché quella è una conclusione, non una preferenza;
--   · chi e quando, scritti dal database e non dalla richiesta, come già fa
--     `action_progress` (0010).
-- ---------------------------------------------------------------------------
-- Dove va un messaggio quando NON è stato messo via: lo decide la
-- classificazione, non la richiesta. Un'unica funzione, usata sia dalla
-- pipeline sia dal ripristino, così le due strade non possono divergere.
create or replace function public.email_attention_for_relevance(p_rel public.email_relevance)
returns public.email_attention_status
language sql
immutable
as $$
  select case p_rel
    when 'likely_actionable'   then 'needs_attention'
    when 'possibly_actionable' then 'to_verify'
    when 'informational'       then 'informational'
    when 'clearly_irrelevant'  then 'ignored'
    else 'to_verify'                       -- non ancora classificata: si mostra
  end::public.email_attention_status;
$$;

create or replace function public.set_email_message_handled_actor()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();

  if new.attention_status is distinct from old.attention_status then
    if new.attention_status = 'handled' then
      -- «Metti via»: chi e quando li scrive il database, non la richiesta.
      if auth.uid() is not null then
        new.handled_by := auth.uid();
        new.handled_at := now();
      end if;
    elsif old.attention_status = 'handled' then
      -- «Rimetti in lista»: il messaggio torna dove lo aveva messo la
      -- classificazione. Il valore inviato dal client viene IGNORATO — un
      -- ripristino è un annullamento, non l'occasione per riscrivere una
      -- conclusione dell'analisi.
      new.attention_status := public.email_attention_for_relevance(new.relevance);
      new.handled_by := null;
      new.handled_at := null;
    elsif auth.uid() is not null then
      -- Ogni altro cambio è una conclusione della pipeline, non una preferenza:
      -- dal client si può solo mettere via o rimettere in lista.
      raise exception 'attention_status: dal client sono ammessi solo "handled" e il ripristino'
        using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_email_msg_handled on public.email_messages;
create trigger trg_email_msg_handled before update on public.email_messages
  for each row execute function public.set_email_message_handled_actor();

-- ---------------------------------------------------------------------------
-- 13. RLS
--
-- Regola invariata dal 0001: si accede solo ai dati della propria azienda. Le
-- tabelle di servizio (segreti, stati OAuth, eventi webhook) non hanno policy
-- perché non devono avere accesso, e una policy assente è più difficile da
-- allentare per sbaglio di una policy restrittiva.
-- ---------------------------------------------------------------------------
alter table public.email_connections        enable row level security;
alter table public.email_connection_secrets enable row level security;
alter table public.email_oauth_states       enable row level security;
alter table public.email_messages           enable row level security;
alter table public.email_attachments        enable row level security;
alter table public.email_message_documents  enable row level security;
alter table public.email_sync_runs          enable row level security;
alter table public.email_webhook_events     enable row level security;
alter table public.email_audit_log          enable row level security;

-- Connessioni: i membri leggono. Creare e disconnettere passa dalle Edge
-- Function, che verificano il ruolo: al client non serve nessun permesso di
-- scrittura, e non averlo è più solido che averlo e controllarlo altrove.
drop policy if exists email_conn_select_member on public.email_connections;
create policy email_conn_select_member on public.email_connections
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists email_msg_select_member on public.email_messages;
create policy email_msg_select_member on public.email_messages
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists email_msg_update_member on public.email_messages;
create policy email_msg_update_member on public.email_messages
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));

drop policy if exists email_att_select_member on public.email_attachments;
create policy email_att_select_member on public.email_attachments
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists email_msg_doc_select_member on public.email_message_documents;
create policy email_msg_doc_select_member on public.email_message_documents
  for select to authenticated using (public.is_company_member(company_id));

-- Diagnostica: la legge chi può agire sulla connessione, non ogni membro.
drop policy if exists email_sync_runs_select_admin on public.email_sync_runs;
create policy email_sync_runs_select_admin on public.email_sync_runs
  for select to authenticated using (public.is_company_admin(company_id));

drop policy if exists email_audit_select_admin on public.email_audit_log;
create policy email_audit_select_admin on public.email_audit_log
  for select to authenticated using (public.is_company_admin(company_id));

-- ---------------------------------------------------------------------------
-- 14. GRANT — permessi di COLONNA, non di tabella
--
-- La RLS decide QUALI righe; il grant decide QUALI COLONNE. Sulla connessione
-- il client non ha bisogno di vedere il cursore di sincronizzazione né
-- l'identificativo della subscription: non sono segreti, ma non servono a
-- nessuna schermata, e ciò che non viene concesso non può essere esposto da una
-- `select('*')` scritta distrattamente.
--
-- Sul messaggio, l'unico UPDATE concesso riguarda due colonne: il resto della
-- riga è il verbale di ciò che è arrivato, e non si riscrive.
-- ---------------------------------------------------------------------------
grant select (
  id, company_id, connected_by, provider, provider_account_id, email_address, display_name,
  status, scopes, sync_enabled, initial_sync_completed_at, last_sync_at, last_successful_sync_at,
  last_error_code, last_error_at, watch_expires_at, sync_lease_until, created_at, updated_at
) on public.email_connections to authenticated;

grant select on public.email_messages to authenticated;
grant update (seen_at, attention_status) on public.email_messages to authenticated;
grant select on public.email_attachments to authenticated;
grant select on public.email_message_documents to authenticated;
grant select on public.email_sync_runs to authenticated;
grant select on public.email_audit_log to authenticated;

-- Esplicito, anche se è già il default: queste tabelle non sono raggiungibili.
revoke all on public.email_connection_secrets from authenticated, anon;
revoke all on public.email_oauth_states       from authenticated, anon;
revoke all on public.email_webhook_events     from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 15. Quota AI per il lavoro SENZA utente
--
-- `try_consume_ai_quota` (0009) pretende `auth.uid()` e verifica la membership:
-- è giusto, perché nasce per una richiesta fatta da una persona. La
-- sincronizzazione della posta però non ha una persona dietro — è un webhook o
-- un job — e con quella funzione fallirebbe.
--
-- La tentazione sarebbe contare le righe e poi inserirne una: è esattamente
-- l'errore che la 0009 è stata scritta per riparare, perché due sincronizzazioni
-- concorrenti leggono lo stesso conteggio e passano entrambe. Qui si riusa lo
-- STESSO lock consultivo per azienda, e si lascia cadere solo il controllo che
-- non ha senso senza un utente. Il ruolo `service_role` è l'unico che può
-- eseguirla, quindi la verifica di appartenenza è già stata fatta a monte da
-- chi possiede la connessione.
-- ---------------------------------------------------------------------------
create or replace function public.try_consume_ai_quota_system(
  p_company_id uuid,
  p_kind text,
  p_limit int,
  p_document_id uuid default null,
  p_provider text default null,
  p_model text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count int;
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 0));

  select count(*) into v_count
    from public.ai_request_log
   where company_id = p_company_id
     and created_at > now() - interval '1 minute';

  if v_count >= p_limit then
    return null;
  end if;

  -- `user_id` resta NULL: nessuna persona ha chiesto questo lavoro, e
  -- attribuirlo a chi ha collegato la casella sarebbe un dato inventato (§80).
  insert into public.ai_request_log (company_id, user_id, document_id, kind, provider, model, status)
  values (p_company_id, null, p_document_id, p_kind, p_provider, p_model, 'pending')
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.finalize_ai_request_system(
  p_id uuid,
  p_status text,
  p_duration_ms int default null,
  p_input_tokens int default null,
  p_output_tokens int default null,
  p_error_code text default null,
  p_model text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Solo righe di sistema: `finalize_ai_request` non potrebbe toccarle
  -- (confronta con auth.uid(), che qui è NULL), e questa non può toccare quelle
  -- di un utente. Le due funzioni restano disgiunte.
  update public.ai_request_log
     set status        = coalesce(p_status, status),
         duration_ms   = coalesce(p_duration_ms, duration_ms),
         input_tokens  = coalesce(p_input_tokens, input_tokens),
         output_tokens = coalesce(p_output_tokens, output_tokens),
         error_code    = coalesce(p_error_code, error_code),
         model         = coalesce(p_model, model)
   where id = p_id
     and user_id is null;
end;
$$;

revoke all on function public.try_consume_ai_quota_system(uuid, text, int, uuid, text, text) from public, anon, authenticated;
revoke all on function public.finalize_ai_request_system(uuid, text, int, int, int, text, text) from public, anon, authenticated;
grant execute on function public.try_consume_ai_quota_system(uuid, text, int, uuid, text, text) to service_role;
grant execute on function public.finalize_ai_request_system(uuid, text, int, int, int, text, text) to service_role;

comment on function public.try_consume_ai_quota_system is
  'Quota AI per il lavoro server-side senza utente (sincronizzazione Inbox). Stesso lock per azienda della 0009; eseguibile solo da service_role.';

-- ---------------------------------------------------------------------------
-- 16. Deduplicazione documentale (§59)
--
-- La ricerca per hash esiste già come indice dalla 0006
-- (`idx_documents_company_hash`): l'import da Inbox la riusa così com'è, senza
-- aggiungere una seconda nozione di «documento uguale». Qui si aggiunge solo
-- l'indice che serve alla provenienza inversa — «da quale email arriva questo
-- documento?» — che l'archivio userà per mostrarne l'origine.
-- ---------------------------------------------------------------------------
create index if not exists idx_documents_company_source on public.documents (company_id, source_type)
  where source_type = 'email';
