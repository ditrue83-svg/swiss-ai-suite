-- ============================================================================
-- AI-Swisse — 0014 INBOX: i permessi di colonna diventano davvero restrittivi
--
-- COSA È ANDATO STORTO NELLA 0013
-- La 0013 concedeva `grant select (colonne…)` e `grant update (seen_at,
-- attention_status)` convinta di RESTRINGERE. Non restringeva nulla: un GRANT
-- aggiunge privilegi, non li toglie, e su Supabase ogni tabella nuova dello
-- schema `public` nasce già con i permessi di TABELLA completi per `anon` e
-- `authenticated` — è l'effetto di
--     alter default privileges in schema public grant all on tables to …
-- che il progetto imposta una volta e che si applica a ogni tabella creata da
-- lì in avanti. I permessi di colonna della 0013 erano quindi ridondanti.
--
-- Conseguenza concreta, misurata da `npm run test:inbox` sul database reale:
-- un membro dell'azienda poteva eseguire
--     update email_messages set subject = '…', body_text = '…', relevance = '…'
-- sui messaggi della PROPRIA azienda. La policy RLS lo autorizzava (è pensata
-- per far passare `seen_at`) e nessun permesso di colonna lo fermava. La riga
-- di posta non era il verbale immutabile di ciò che era arrivato: era un campo
-- libero. E poiché il ripristino di un messaggio «messo via» ricalcola lo stato
-- da `relevance`, riscrivere la classificazione permetteva anche di spostare un
-- messaggio in una categoria a piacere — aggirando il controllo che il trigger
-- fa proprio per impedirlo.
--
-- Perché per i segreti aveva funzionato: là la 0013 scriveva `revoke all`
-- prima. Mancava dappertutto altrove.
--
-- LA REGOLA CHE NE DERIVA
-- Su questo progetto, un permesso di colonna non significa niente finché non è
-- preceduto da un `revoke all` sulla stessa tabella. Vale per ogni tabella
-- futura dello schema `public`.
--
-- Perché una migrazione nuova e non una correzione della 0013: la 0013 è già
-- stata applicata in produzione. Un file di migrazione è il verbale di ciò che
-- è stato eseguito; riscriverlo dopo l'applicazione significherebbe che il
-- repository e il database raccontano due storie diverse.
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Prima si toglie tutto
--
-- `service_role` NON compare: è il ruolo con cui scrivono le Edge Function, e
-- deve conservare i suoi permessi. Si revoca anche da `public` (lo pseudo-ruolo
-- che comprende tutti) per non lasciare una via laterale.
-- ---------------------------------------------------------------------------
revoke all on public.email_connections        from anon, authenticated, public;
revoke all on public.email_connection_secrets from anon, authenticated, public;
revoke all on public.email_oauth_states       from anon, authenticated, public;
revoke all on public.email_messages           from anon, authenticated, public;
revoke all on public.email_attachments        from anon, authenticated, public;
revoke all on public.email_message_documents  from anon, authenticated, public;
revoke all on public.email_sync_runs          from anon, authenticated, public;
revoke all on public.email_webhook_events     from anon, authenticated, public;
revoke all on public.email_audit_log          from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 2. Poi si concede esattamente quello che serve
--
-- CONNESSIONI — sola lettura, e solo le colonne che una schermata mostra.
-- `sync_cursor`, `history_floor_at`, `watch_resource_id`, `watch_last_error_code`
-- e `sync_lease_id` restano fuori: non sono segreti, ma non servono a nessuna
-- vista, e ciò che non è concesso non può essere esposto da una `select('*')`
-- scritta distrattamente.
--
-- ⚠️ Da qui in avanti `select('*')` su questa tabella FALLISCE con «permission
-- denied for column». È voluto, ed è il motivo per cui `emailConnectionService`
-- elenca le colonne una per una.
-- ---------------------------------------------------------------------------
grant select (
  id, company_id, connected_by, provider, provider_account_id, email_address, display_name,
  status, scopes, sync_enabled, initial_sync_completed_at, last_sync_at, last_successful_sync_at,
  last_error_code, last_error_at, watch_expires_at, sync_lease_until, created_at, updated_at
) on public.email_connections to authenticated;

-- MESSAGGI — lettura completa (non c'è nulla di riservato in una riga di posta
-- che il membro non possa già leggere), ma scrittura sulle sole due colonne
-- che rappresentano una decisione UMANA: «l'ho visto» e «l'ho messo via».
-- Tutto il resto — oggetto, mittente, corpo, classificazione, stato della
-- pipeline, impronta della fonte — è il verbale di ciò che è arrivato, e da
-- qui in avanti il client non ha alcun modo di riscriverlo.
grant select on public.email_messages to authenticated;
grant update (seen_at, attention_status) on public.email_messages to authenticated;

-- ALLEGATI, RELAZIONI, REGISTRI — sola lettura. Le righe visibili le decide la
-- RLS (membri per gli allegati e le relazioni, owner/admin per i registri).
grant select on public.email_attachments       to authenticated;
grant select on public.email_message_documents to authenticated;
grant select on public.email_sync_runs         to authenticated;
grant select on public.email_audit_log         to authenticated;

-- SEGRETI, STATI OAUTH, EVENTI WEBHOOK — nessun permesso, per nessuno.
-- Il `revoke` del punto 1 è già sufficiente; non si concede nulla qui.

-- ---------------------------------------------------------------------------
-- 3. Verifica in migrazione
--
-- Il controllo sta QUI dentro e non solo nella suite di test: se un domani
-- qualcuno riapplicasse per errore un `grant all`, questa migrazione rieseguita
-- lo direbbe subito. Un permesso di scrittura su una colonna del verbale è il
-- genere di regressione che non produce alcun sintomo visibile finché qualcuno
-- non la sfrutta.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s.%s (%s)', table_name, column_name, privilege_type), ', ')
    into v_bad
    from information_schema.column_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and table_name = 'email_messages'
     and privilege_type in ('INSERT', 'UPDATE')
     and column_name not in ('seen_at', 'attention_status');

  if v_bad is not null then
    raise exception 'Permessi di scrittura inattesi su email_messages: %', v_bad;
  end if;

  select string_agg(format('%s (%s)', table_name, privilege_type), ', ')
    into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and grantee in ('anon', 'authenticated')
     and table_name in ('email_connection_secrets', 'email_oauth_states', 'email_webhook_events');

  if v_bad is not null then
    raise exception 'Le tabelle di servizio non devono avere alcun permesso: %', v_bad;
  end if;

  raise notice 'Permessi Inbox verificati: il verbale non è riscrivibile dal client.';
end $$;
