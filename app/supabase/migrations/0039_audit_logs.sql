-- ============================================================================
-- AI-Swisse — 0039 REGISTRO ATTIVITÀ (audit_logs)
--
-- ⚠️ CHE COSA CHIUDE. La vetrina promette che si possa risalire a che cosa il
-- sistema aveva letto e a chi ha corretto che cosa. Oggi quella promessa è vera
-- solo per le analisi documento, grazie alla 0010 (`analysis_corrections` è
-- append-only e attribuita) e per l'Inbox (`email_audit_log`, 0013). Per tutto
-- il resto non esiste un posto in cui leggere, in ordine di tempo, che cosa è
-- successo in azienda e per mano di chi.
--
-- ⚠️⚠️ NON È UNA SECONDA FONTE DI VERITÀ, ED È LA DECISIONE CHE GOVERNA TUTTO
-- IL FILE. `task_events`, `contract_events`, `crm_events`, `email_audit_log`,
-- `analysis_corrections` continuano a esistere e restano i proprietari dei loro
-- fatti: là c'è il DETTAGLIO (i valori corretti, il verbale, la cronologia di
-- una scheda). Qui c'è l'INDICE TRASVERSALE: chi, quando, che cosa, su quale
-- entità — una riga per fatto, la stessa forma per tutti i moduli. Perché non
-- diverga da ciò che indicizza, questo registro NON viene scritto da un
-- servizio: lo scrivono i TRIGGER delle tabelle che possiedono il fatto, nella
-- stessa transazione della scrittura che lo produce.
--
-- È la regola già scritta nella 0020 e qui applicata di nuovo:
--   «Ognuno emette dalla TABELLA che possiede il fatto, e non da un servizio:
--    così l'evento e il fatto stanno nella stessa transazione qualunque sia il
--    percorso che ha scritto il fatto — l'interfaccia, una Edge Function, uno
--    script di manutenzione o una migrazione. Un evento emesso dal codice
--    applicativo avrebbe coperto solo i percorsi a cui qualcuno ha pensato.»
-- Ed è anche il modo in cui «scrittura solo lato server» smette di essere una
-- promessa del client: il client non ha alcun permesso di scrittura su questa
-- tabella, e non può né saltare la registrazione né fabbricarne una.
--
-- ⚠️ CHE COSA NON ENTRA MAI QUI. Niente token, niente password, niente segreti,
-- niente contenuto di documenti. Il payload `changes` non è costruito da un
-- ciclo sulle colonne ma campo per campo, a mano, in ogni trigger: è una LISTA
-- DI AMMESSI e non una lista di vietati. La differenza conta il giorno che
-- qualcuno aggiunge una colonna `access_token` a una tabella sorvegliata — con
-- una lista di vietati finirebbe nel registro finché nessuno se ne accorge, con
-- una lista di ammessi non ci finisce perché nessuno l'ha ammessa.
--
-- ⚠️ IMMUTABILITÀ: DOVE STA DAVVERO. L'UPDATE è vietato da un trigger, e vale
-- per chiunque — service role compreso. Il DELETE NO, ed è una lezione già
-- pagata: la 0023 ha dovuto togliere un divieto di DELETE identico perché
-- rendeva un documento con una fattura INDISTRUTTIBILE (la cascata di
-- cancellazione di un'azienda passa di lì) e perché faceva restare in
-- produzione le aziende dei test. Qui il DELETE è vietato dai PERMESSI: nessun
-- ruolo applicativo — né `anon` né `authenticated` — ha `delete` su questa
-- tabella, e non esiste policy che glielo conceda. Una riga muore solo con la
-- sua azienda, per cascata.
--   Detto senza girarci intorno: la garanzia è «nessun UTENTE può modificare o
--   cancellare una riga». Il service role, che è il server stesso, può
--   cancellare — e affermare il contrario sarebbe falso.
--
-- Requisiti: 0001 (ruoli e helper RLS), 0002 (documenti e analisi), 0006
-- (correzioni e `ai_request_log`), 0016 (attività).
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Il vocabolario: che cosa può essere registrato, e nient'altro
--
-- Enum e non `text`: l'elenco degli eventi è una decisione, e un enum la rende
-- verificabile dal database invece che dalla buona volontà di chi scrive il
-- prossimo trigger. Un'azione non prevista non entra: solleva.
--
-- ⚠️ «Esito analisi» sono DUE azioni e non una con un campo dentro, perché la
-- domanda che le persone fanno al registro è «che cosa è fallito»: un filtro
-- deve poterci rispondere senza aprire il payload di ogni riga.
--
-- ⚠️ Trappola già pagata (0027): un valore aggiunto a un enum NON è usabile
-- nella stessa transazione che lo aggiunge. Qui gli enum NASCONO, e i loro
-- valori compaiono solo dentro corpi di funzione — che vengono analizzati
-- all'esecuzione, non alla creazione. Chi un giorno aggiungerà un'azione ricordi
-- che l'`alter type` va in una migrazione PROPRIA, prima di quella che la usa.
-- ---------------------------------------------------------------------------
do $$ begin
  create type public.audit_action as enum (
    'document_uploaded',
    'document_deleted',
    'analysis_started',
    'analysis_completed',
    'analysis_failed',
    'correction_saved',
    'reply_generated',
    'task_created',
    'task_updated',
    'member_added',
    'member_removed',
    'member_role_changed'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.audit_entity_type as enum (
    'document',
    'analysis',
    'correction',
    'reply',
    'task',
    'membership'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 2. La tabella
--
-- ⚠️ NESSUNA CHIAVE ESTERNA SU `entity_id`, `correlation_id` E `actor_user_id`,
-- e non è una dimenticanza. Un registro conserva FATTI STORICI, non puntatori
-- vivi: l'evento «documento eliminato» deve sopravvivere al documento, o
-- registra esattamente l'unica cosa che non potrà più raccontare. Con una
-- chiave esterna la riga sparirebbe in cascata insieme a ciò che descrive.
-- Per la stessa ragione l'autore è l'identificativo che AVEVA chi ha agito:
-- resta leggibile anche se quell'utenza viene cancellata.
--
-- `company_id` invece la chiave esterna ce l'ha, con cascata: il registro è
-- dato del tenant e muore con il tenant. È anche l'unico modo di cancellare
-- davvero un'azienda (§ la lezione della 0023).
--
-- ⚠️ `actor_user_id` NULL significa UNA COSA SOLA: ha scritto il sistema, cioè
-- nessun utente autenticato era in sessione (un worker, una Edge Function con
-- service role, una manutenzione). Non significa «non lo sappiamo». È la stessa
-- disciplina di `action_progress.done_by` nella 0010: un valore di ripiego
-- sarebbe un dato inventato.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies (id) on delete cascade,
  actor_user_id  uuid,
  action         public.audit_action not null,
  entity_type    public.audit_entity_type not null,
  entity_id      uuid not null,
  -- Forma UNIFORME per ogni evento: { "campo": { "before": …, "after": … } }.
  -- Un campo comparso ha `before` nullo, uno sparito ha `after` nullo — la
  -- stessa convenzione che la schermata di revisione del catalogo già usa per
  -- dire «comparso» e «sparito». Uniforme perché la pagina possa renderlo senza
  -- conoscere l'evento: dodici forme diverse sarebbero dodici rami da tenere
  -- allineati con i trigger.
  changes        jsonb not null default '{}'::jsonb,
  -- Il filo a cui l'evento appartiene: il documento per tutta la sua catena
  -- (caricato → analisi avviata → esito → correzione → risposta → eliminato),
  -- l'attività per la sua, la persona per i cambi di membership. Serve a
  -- leggere una storia invece di una lista, ed è anche la destinazione del
  -- collegamento nella pagina.
  correlation_id uuid not null,
  created_at     timestamptz not null default now()
);

-- La lettura vera della pagina: un'azienda, in ordine di tempo, eventualmente
-- filtrata per azione e per periodo.
create index if not exists idx_audit_company_time on public.audit_logs (company_id, created_at desc);
create index if not exists idx_audit_company_action_time on public.audit_logs (company_id, action, created_at desc);
create index if not exists idx_audit_correlation on public.audit_logs (correlation_id, created_at);

comment on table public.audit_logs is
  'Registro attività trasversale, append-only. Indice dei fatti: il dettaglio resta nelle tabelle che li possiedono (analysis_corrections, task_events, email_audit_log…). Scritto SOLO dai trigger delle tabelle sorgente, mai dal client.';
comment on column public.audit_logs.actor_user_id is
  'Chi ha agito. NULL = il sistema (nessun utente autenticato), mai «non lo sappiamo». Nessuna chiave esterna: è un fatto storico, non un puntatore vivo.';
comment on column public.audit_logs.changes is
  'Solo campi AMMESSI esplicitamente da ciascun trigger, nella forma {campo:{before,after}}. Mai segreti, mai contenuto di documenti.';
comment on column public.audit_logs.correlation_id is
  'Il filo dell''evento: documento, attività o persona. Lega fra loro avvio e esito di una stessa analisi.';

-- ---------------------------------------------------------------------------
-- 3. Non si modifica. Per chiunque, service role compreso.
--
-- Il divieto di UPDATE sta in un trigger e non nei permessi perché deve valere
-- anche per il server: un registro che il server può riscrivere non è un
-- registro. Il DELETE invece NON è qui — vedi l'intestazione: un divieto di
-- DELETE in un trigger vale anche per la cascata, che non è la scrittura di
-- qualcuno ma la conseguenza di una cancellazione già autorizzata a monte
-- (0023). Il DELETE lo fermano i permessi del punto 4.
-- ---------------------------------------------------------------------------
create or replace function public.audit_logs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_log_immutable'
    using errcode = '42501',
          hint = 'Una riga del registro non si modifica: se un fatto nuovo accade, se ne scrive uno nuovo.';
end $$;

drop trigger if exists trg_audit_logs_immutable on public.audit_logs;
create trigger trg_audit_logs_immutable
  before update on public.audit_logs
  for each row execute function public.audit_logs_immutable();

-- ---------------------------------------------------------------------------
-- 4. Permessi e RLS — leggono solo titolari e amministratori
--
-- ⚠️⚠️ `revoke all` PRIMA dei grant, e non è una formalità: su Supabase lo
-- schema `public` ha privilegi predefiniti che concedono tutto ad `anon` e
-- `authenticated`, quindi una `grant select` da sola NON toglie insert, update
-- e delete — li lascia dov'erano. È la trappola del 2026-07-26, e l'unico modo
-- di sapere che è chiusa è provare a scrivere con la chiave anon (lo fa
-- `npm run test:audit`).
--
-- La lettura è di owner e admin, non di ogni membro: il registro dice chi ha
-- fatto che cosa, ed è una informazione sulle PERSONE. `is_company_admin`
-- risponde vero per 'owner' e 'admin' (0001).
-- ---------------------------------------------------------------------------
alter table public.audit_logs enable row level security;

revoke all on public.audit_logs from public;
revoke all on public.audit_logs from anon;
revoke all on public.audit_logs from authenticated;
grant select on public.audit_logs to authenticated;

drop policy if exists audit_select_admin on public.audit_logs;
create policy audit_select_admin on public.audit_logs
  for select to authenticated
  using (public.is_company_admin(company_id));

comment on policy audit_select_admin on public.audit_logs is
  'Solo titolari e amministratori dell''azienda leggono il registro: dice chi ha fatto che cosa, ed è informazione sulle persone.';

-- ---------------------------------------------------------------------------
-- 5. L'unico punto di scrittura
--
-- ⚠️ `security invoker` (predefinito) e `revoke all` dal pubblico: la funzione
-- NON deve essere raggiungibile via PostgREST, o il registro diventerebbe
-- scrivibile dal browser — cioè falsificabile. Funziona lo stesso perché la
-- chiamano solo i trigger del punto 6, che sono `security definer` e quindi
-- girano come proprietario.
--
-- ⚠️⚠️ LA GUARDIA SULLA CASCATA, che è il difetto che questo file avrebbe avuto
-- senza la 0023. Quando si cancella un'AZIENDA, la riga di `companies` sparisce
-- PRIMA che le cascate cancellino documenti, attività e membership: i trigger
-- di quelle tabelle scattano quando l'azienda non c'è più, e il loro insert qui
-- violerebbe la chiave esterna facendo FALLIRE l'intera cancellazione. Il
-- risultato sarebbe un'azienda indistruttibile e, di nuovo, aziende di prova
-- lasciate in produzione. Quindi: se l'azienda non esiste più, non si registra
-- niente — il registro sta morendo con lei in questa stessa transazione.
--   Questa guardia sta QUI, in un posto solo, e non nei sette trigger: la stessa
--   condizione ripetuta sette volte è la stessa condizione dimenticata all'ottavo.
-- ---------------------------------------------------------------------------
create or replace function public.audit_log_write(
  p_company_id     uuid,
  p_actor_user_id  uuid,
  p_action         public.audit_action,
  p_entity_type    public.audit_entity_type,
  p_entity_id      uuid,
  p_changes        jsonb,
  p_correlation_id uuid
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_company_id is null or p_entity_id is null or p_correlation_id is null then
    return;                                  -- un fatto senza soggetto non è un fatto
  end if;

  if not exists (select 1 from public.companies c where c.id = p_company_id) then
    return;                                  -- l'azienda si sta cancellando: vedi sopra
  end if;

  insert into public.audit_logs
    (company_id, actor_user_id, action, entity_type, entity_id, changes, correlation_id)
  values
    (p_company_id, p_actor_user_id, p_action, p_entity_type, p_entity_id,
     coalesce(p_changes, '{}'::jsonb), p_correlation_id);
end $$;

revoke all on function public.audit_log_write(uuid, uuid, public.audit_action, public.audit_entity_type, uuid, jsonb, uuid) from public;

comment on function public.audit_log_write(uuid, uuid, public.audit_action, public.audit_entity_type, uuid, jsonb, uuid) is
  'Unico punto di scrittura del registro. Non eseguibile dai ruoli applicativi: la chiamano i trigger, che girano come proprietario.';

-- Coppia prima/dopo nella forma uniforme. Il testo viene TRONCATO: un registro
-- si legge a colpo d'occhio, e una descrizione di duemila caratteri dentro una
-- riga non la legge nessuno. Il valore corrente resta sulla sua tabella.
create or replace function public.audit_pair(p_before text, p_after text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'before', case when p_before is null then null::jsonb else to_jsonb(left(p_before, 160)) end,
    'after',  case when p_after  is null then null::jsonb else to_jsonb(left(p_after,  160)) end
  );
$$;

comment on function public.audit_pair(text, text) is
  'Coppia {before,after} troncata a 160 caratteri: il registro racconta il cambiamento, non conserva il contenuto.';

-- ---------------------------------------------------------------------------
-- 6. I trigger, uno per fatto
--
-- Tutti `security definer`: il ruolo che scrive il fatto (`authenticated` dal
-- browser, `service_role` da una Edge Function) non ha e non deve avere
-- permessi su `audit_logs`. Tutti con `set search_path = ''`, e ognuno
-- costruisce a mano il proprio payload.
--
-- ⚠️ Perché non un unico trigger generico su tutte le tabelle: un trigger
-- generico dovrebbe decidere a runtime quali colonne sono pubblicabili, cioè
-- proprio la decisione che qui si vuole scritta e leggibile una per una.
-- ---------------------------------------------------------------------------

-- (a) Documento caricato.
--     Autore: chi è in sessione; se scrive il sistema (sincronizzazione email),
--     l'autore è quello che il documento stesso dichiara.
create or replace function public.audit_on_document_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.audit_log_write(
    new.company_id,
    coalesce(auth.uid(), new.uploaded_by),
    'document_uploaded'::public.audit_action,
    'document'::public.audit_entity_type,
    new.id,
    jsonb_build_object(
      'title',       public.audit_pair(null, new.title),
      'filename',    public.audit_pair(null, new.original_filename),
      'mime_type',   public.audit_pair(null, new.mime_type),
      'file_size',   public.audit_pair(null, new.file_size::text),
      'source_type', public.audit_pair(null, new.source_type::text)
    ),
    new.id
  );
  return new;
end $$;

drop trigger if exists trg_audit_document_insert on public.documents;
create trigger trg_audit_document_insert
  after insert on public.documents
  for each row execute function public.audit_on_document_insert();

-- (b) Documento eliminato. È l'evento per cui il registro NON può avere una
--     chiave esterna verso i documenti: il soggetto non esiste più.
create or replace function public.audit_on_document_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.audit_log_write(
    old.company_id,
    auth.uid(),
    'document_deleted'::public.audit_action,
    'document'::public.audit_entity_type,
    old.id,
    jsonb_build_object(
      'title',    public.audit_pair(old.title, null),
      'filename', public.audit_pair(old.original_filename, null)
    ),
    old.id
  );
  return old;
end $$;

drop trigger if exists trg_audit_document_delete on public.documents;
create trigger trg_audit_document_delete
  after delete on public.documents
  for each row execute function public.audit_on_document_delete();

-- (c) Analisi AVVIATA.
--     La riga di `ai_request_log` prenotata da `try_consume_ai_quota` (0009) è
--     il momento in cui l'analisi comincia, e porta con sé chi l'ha chiesta:
--     quella funzione rifiuta se `auth.uid()` è nullo, quindi l'autore c'è
--     sempre. L'entità è il DOCUMENTO e non l'analisi, perché in questo istante
--     l'analisi non esiste ancora e non ha identità: darle quella della riga di
--     log significherebbe indicare un oggetto che nella pagina non si può aprire.
--
--     ⚠️ CONFINE DICHIARATO: il motore locale deterministico (§60) NON passa da
--     qui — calcola nel browser e scrive direttamente l'analisi. Per quel
--     percorso esiste l'esito e non l'avvio, e i due istanti coincidono. Meglio
--     dirlo che inventare un avvio che nessuno ha registrato.
create or replace function public.audit_on_ai_request_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.kind is distinct from 'analysis' or new.document_id is null then
    return new;
  end if;

  perform public.audit_log_write(
    new.company_id,
    new.user_id,
    'analysis_started'::public.audit_action,
    'document'::public.audit_entity_type,
    new.document_id,
    jsonb_build_object(
      'provider', public.audit_pair(null, new.provider),
      'model',    public.audit_pair(null, new.model)
    ),
    new.document_id
  );
  return new;
end $$;

drop trigger if exists trg_audit_ai_request_insert on public.ai_request_log;
create trigger trg_audit_ai_request_insert
  after insert on public.ai_request_log
  for each row execute function public.audit_on_ai_request_insert();

-- (d) ESITO dell'analisi — riuscita o fallita.
--     Qui l'entità è l'analisi, che ora esiste. Copre ENTRAMBI i motori, perché
--     entrambi scrivono su questa tabella: è di nuovo la regola della 0020.
--     L'autore è nullo quando scrive la Edge Function con service role: chi
--     aveva chiesto l'analisi sta nell'evento di avvio, legato dallo stesso
--     `correlation_id`.
create or replace function public.audit_on_analysis_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.audit_log_write(
    new.company_id,
    auth.uid(),
    case when new.analysis_status = 'failed'::public.analysis_status
      then 'analysis_failed'::public.audit_action
      else 'analysis_completed'::public.audit_action
    end,
    'analysis'::public.audit_entity_type,
    new.id,
    jsonb_build_object(
      'status',     public.audit_pair(null, new.analysis_status::text),
      'engine',     public.audit_pair(null, new.engine),
      'provider',   public.audit_pair(null, new.provider),
      'model',      public.audit_pair(null, new.model),
      -- Il CODICE dell'errore, non il messaggio: il codice è un vocabolario
      -- chiuso e traducibile, il messaggio è testo che nessuno ha sanificato.
      'error_code', public.audit_pair(null, new.error_code)
    ),
    new.document_id
  );
  return new;
end $$;

drop trigger if exists trg_audit_analysis_insert on public.document_analyses;
create trigger trg_audit_analysis_insert
  after insert on public.document_analyses
  for each row execute function public.audit_on_analysis_insert();

-- (e) Correzione manuale.
--     ⚠️ SI REGISTRA QUALE CAMPO È STATO CORRETTO, NON I DUE VALORI. I valori
--     di una correzione sono dati LETTI DAL DOCUMENTO — mittente, scadenza,
--     importo — e questo registro non conserva contenuto di documenti. Restano
--     dove sono sempre stati e dove la scheda del documento li mostra già:
--     `analysis_corrections`, append-only e attribuita dalla 0010. Il registro
--     dice chi, quando e su che cosa; il «da → a» si legge un clic più in là.
create or replace function public.audit_on_correction_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.audit_log_write(
    new.company_id,
    coalesce(auth.uid(), new.corrected_by),
    'correction_saved'::public.audit_action,
    'correction'::public.audit_entity_type,
    new.id,
    jsonb_build_object('field', public.audit_pair(null, new.field)),
    new.document_id
  );
  return new;
end $$;

drop trigger if exists trg_audit_correction_insert on public.analysis_corrections;
create trigger trg_audit_correction_insert
  after insert on public.analysis_corrections
  for each row execute function public.audit_on_correction_insert();

-- (f) Risposta generata. Mai il testo: solo come è stata prodotta.
--     Le modifiche a mano di una bozza NON sono in elenco e non producono
--     eventi: l'elenco degli eventi è quello deciso, e allargarlo di nascosto
--     sarebbe la stessa cosa che restringerlo.
create or replace function public.audit_on_reply_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.audit_log_write(
    new.company_id,
    coalesce(auth.uid(), new.created_by),
    'reply_generated'::public.audit_action,
    'reply'::public.audit_entity_type,
    new.id,
    jsonb_build_object(
      'language', public.audit_pair(null, new.language),
      'tone',     public.audit_pair(null, new.tone),
      'provider', public.audit_pair(null, new.provider),
      'model',    public.audit_pair(null, new.model)
    ),
    new.document_id
  );
  return new;
end $$;

drop trigger if exists trg_audit_reply_insert on public.document_replies;
create trigger trg_audit_reply_insert
  after insert on public.document_replies
  for each row execute function public.audit_on_reply_insert();

-- (g) Attività creata.
create or replace function public.audit_on_task_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.audit_log_write(
    new.company_id,
    coalesce(auth.uid(), new.created_by),
    'task_created'::public.audit_action,
    'task'::public.audit_entity_type,
    new.id,
    jsonb_build_object(
      'title',    public.audit_pair(null, new.title),
      'status',   public.audit_pair(null, new.status::text),
      'priority', public.audit_pair(null, new.priority::text),
      'due_date', public.audit_pair(null, new.due_date::text),
      'assignee', public.audit_pair(null, new.assignee_user_id::text)
    ),
    new.id
  );
  return new;
end $$;

drop trigger if exists trg_audit_task_insert on public.tasks;
create trigger trg_audit_task_insert
  after insert on public.tasks
  for each row execute function public.audit_on_task_insert();

-- (h) Attività modificata.
--     ⚠️ SOLO SE È CAMBIATO QUALCOSA CHE SI SORVEGLIA. Un update che tocca solo
--     `updated_at` non è un fatto, e registrarlo riempirebbe il registro di
--     righe che non raccontano niente — che è il modo in cui un registro smette
--     di essere letto.
--     ⚠️ `description` NON è sorvegliata, ed è una scelta: è testo libero e
--     lungo, illeggibile dentro una riga di registro. Il testo corrente sta
--     sull'attività.
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

drop trigger if exists trg_audit_task_update on public.tasks;
create trigger trg_audit_task_update
  after update on public.tasks
  for each row execute function public.audit_on_task_update();

-- (i) Membership e ruoli.
--     Il filo (`correlation_id`) è la PERSONA e non la riga di membership:
--     chi viene tolto e poi rimesso ha una riga nuova ma è la stessa persona, e
--     la storia che interessa è la sua.
create or replace function public.audit_on_member_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit_log_write(
      new.company_id, auth.uid(),
      'member_added'::public.audit_action,
      'membership'::public.audit_entity_type,
      new.id,
      jsonb_build_object(
        'user', public.audit_pair(null, new.user_id::text),
        'role', public.audit_pair(null, new.role::text)
      ),
      new.user_id
    );
    return new;
  end if;

  if tg_op = 'DELETE' then
    perform public.audit_log_write(
      old.company_id, auth.uid(),
      'member_removed'::public.audit_action,
      'membership'::public.audit_entity_type,
      old.id,
      jsonb_build_object(
        'user', public.audit_pair(old.user_id::text, null),
        'role', public.audit_pair(old.role::text, null)
      ),
      old.user_id
    );
    return old;
  end if;

  -- UPDATE: solo il ruolo è un fatto. Cambiare azienda o persona a una riga di
  -- membership non è previsto da nessun percorso, e se accadesse non sarebbe un
  -- «cambio di ruolo»: non si registra sotto un nome che non gli appartiene.
  if new.role is distinct from old.role then
    perform public.audit_log_write(
      new.company_id, auth.uid(),
      'member_role_changed'::public.audit_action,
      'membership'::public.audit_entity_type,
      new.id,
      jsonb_build_object(
        'user', public.audit_pair(new.user_id::text, new.user_id::text),
        'role', public.audit_pair(old.role::text, new.role::text)
      ),
      new.user_id
    );
  end if;
  return new;
end $$;

drop trigger if exists trg_audit_member_change on public.company_members;
create trigger trg_audit_member_change
  after insert or update or delete on public.company_members
  for each row execute function public.audit_on_member_change();
