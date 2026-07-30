-- ============================================================================
-- 0031 — LA RETENTION DELL'ASSISTENTE VIENE ESEGUITA DAVVERO
--
-- La 0027 ha scritto `assistant_purge_expired`, la 0029 l'ha chiusa a chiunque
-- non sia il ruolo di servizio. Restava il pezzo che rende vera la parola
-- «retention»: qualcuno che la chiami. Senza questo job la funzione esiste,
-- è documentata, è provata — e non elimina niente, mai. Una conversazione del
-- 2026 sarebbe ancora là nel 2030.
--
-- ⚠️ NON CONTRADDICE LA REGOLA DELLA 0024 («si riusa lo scheduler già
-- esistente, non si crea un secondo sistema di cron»). Quella regola parla
-- degli EVENTI di prodotto — follow-up scaduti, attività in scadenza — che
-- vanno emessi nello stesso giro del worker perché appartengono allo stesso
-- flusso. Questa è manutenzione del database: nessuna Edge Function da
-- svegliare, nessun evento da emettere, nessuna rete di mezzo. È una `delete`
-- che il database sa fare da solo, e legarla al worker delle automazioni
-- significherebbe che una pausa del worker allunga silenziosamente la
-- retention — cioè proprio la cosa che una politica di conservazione non può
-- permettersi.
--
-- Ogni notte alle 04:00 (fuso del server, UTC su Supabase): l'ora è scelta
-- fuori dall'orario di lavoro svizzero in ogni stagione.
--
-- ⚠️ 180 GIORNI È IL VALORE DICHIARATO in docs/company-assistant.md §11 ed è
-- il default della funzione. È ripetuto qui in chiaro invece di affidarsi al
-- default: un job che dice `assistant_purge_expired()` non lascerebbe vedere,
-- leggendo `cron.job`, quanto a lungo le conversazioni restano.
--
-- Requisiti: 0027 e 0029 applicate.
-- Documento di modulo: docs/company-assistant.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. L'estensione
--
-- Su Supabase `pg_cron` vive nello schema `cron` e su molti progetti è già
-- attiva. `if not exists` la rende innocua nei due casi.
-- ---------------------------------------------------------------------------
create extension if not exists pg_cron with schema cron;

-- ---------------------------------------------------------------------------
-- 2. Il job
--
-- ⚠️ Si toglie PRIMA di rimettere. `cron.schedule` con lo stesso nome
-- aggiorna il job sulle versioni recenti di pg_cron, ma non su tutte: senza la
-- rimozione, riapplicare questa migrazione su un progetto più vecchio
-- fallirebbe con una violazione di unicità e lascerebbe la migrazione a metà.
-- `cron.unschedule` su un nome inesistente solleva un errore, quindi si guarda
-- prima se c'è.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'assistant-purge') then
    perform cron.unschedule('assistant-purge');
  end if;

  perform cron.schedule(
    'assistant-purge',
    '0 4 * * *',
    $job$select public.assistant_purge_expired(180);$job$
  );
end $$;

-- ---------------------------------------------------------------------------
-- 3. Autoverifica
--
-- Come la 0029: una manutenzione che si spera sia pianificata non è
-- pianificata. Se il job non c'è, o non è attivo, o non chiama la funzione
-- giusta, questa migrazione FALLISCE — invece di lasciare una retention che
-- esiste solo nella documentazione.
-- ---------------------------------------------------------------------------
do $$
declare
  v_schedule text;
  v_command  text;
  v_active   boolean;
begin
  select schedule, command, active
    into v_schedule, v_command, v_active
    from cron.job
   where jobname = 'assistant-purge';

  if not found then
    raise exception 'il job assistant-purge non è stato creato';
  end if;
  if not v_active then
    raise exception 'il job assistant-purge esiste ma non è attivo';
  end if;
  if v_schedule <> '0 4 * * *' then
    raise exception 'il job assistant-purge ha una pianificazione inattesa: %', v_schedule;
  end if;
  if v_command not like '%assistant_purge_expired(180)%' then
    raise exception 'il job assistant-purge non chiama la retention dichiarata: %', v_command;
  end if;
end $$;

comment on extension pg_cron is
  'Pianificazione dentro il database. Job del prodotto: assistant-purge (0031), retention delle conversazioni dell''assistente.';
