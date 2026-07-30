-- ============================================================================
-- 0029 — LA RETENTION DELL'ASSISTENTE NON È DI CHI PASSA
--
-- ⚠️⚠️ IL DIFETTO CHE QUESTA MIGRAZIONE CHIUDE NON L'HA TROVATO UNA RILETTURA:
-- l'ha trovato `npm run test:assistant` alla PRIMA esecuzione contro il
-- database vero, sezione 7, con una riga sola:
--
--     ✗ la retention NON è invocabile da un utente
--
-- Che cosa accadeva. La 0027 scriveva, per `assistant_purge_expired`:
--
--     revoke all on function public.assistant_purge_expired(int) from public;
--     grant execute on function public.assistant_purge_expired(int) to service_role;
--
-- e sembrava sufficiente, perché per le FUNZIONI PostgreSQL concede EXECUTE a
-- `public` per impostazione predefinita e quella riga glielo toglie. Ma Supabase
-- applica anche `alter default privileges in schema public grant all on
-- functions to anon, authenticated, service_role`: `authenticated` riceve il
-- privilegio DIRETTAMENTE, non attraverso `public`, e una revoca a `public` non
-- lo tocca.
--
-- Conseguenza reale, e non teorica: la funzione è `security definer`, non filtra
-- per azienda, e cancella `assistant_threads` inattivi da più di N giorni. Un
-- qualunque utente autenticato — di QUALUNQUE azienda — poteva chiamare
--
--     select public.assistant_purge_expired(7);
--
-- e cancellare le conversazioni di TUTTE le imprese del sistema.
--
-- ⚠️ È ESATTAMENTE LA CLASSE DELLA 0014 e della sezione 20 della 0026, dove i
-- privilegi predefiniti di Supabase rendevano inutile una restrizione scritta
-- con cura. La 0027 CITA quella lezione — nella sezione 13, per le tabelle — e
-- non l'ha applicata alle funzioni. Una regola conosciuta e applicata a metà è
-- il modo più comune in cui questo difetto ritorna.
--
-- Due rimedi, e servono entrambi:
--   1. la revoca esplicita ad `anon` e `authenticated`, non solo a `public`;
--   2. un controllo DENTRO la funzione, perché una difesa fatta di soli
--      privilegi è a una `grant` di distanza dal disastro — e la `grant` la può
--      riaggiungere il prossimo `alter default privileges`, senza che nessuno
--      la scriva.
--
-- Requisiti: 0027 applicata.
-- Documento di modulo: docs/company-assistant.md
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Il controllo interno
--
-- `auth.uid()` è NULL quando la funzione gira con il ruolo di servizio, da un
-- job di `pg_cron` o dall'editor SQL come `postgres`; è valorizzato quando la
-- chiama una persona con la propria sessione. È quindi il discrimine giusto, e
-- non richiede di conoscere il nome del ruolo corrente — che cambia a seconda
-- di come la connessione è stata aperta.
-- ---------------------------------------------------------------------------
create or replace function public.assistant_purge_expired(p_days int default 180)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  -- ⚠️ Questa funzione NON filtra per azienda: cancella le conversazioni
  -- scadute di tutte. È corretto per una manutenzione pianificata ed è
  -- catastrofico per chiunque altro, quindi chiunque altro viene fermato qui.
  if auth.uid() is not null then
    raise exception 'assistant_purge_expired è una manutenzione, non un''azione dall''interfaccia'
      using errcode = '42501';
  end if;

  if p_days is null or p_days < 7 then
    raise exception 'retention troppo breve: %', p_days using errcode = '22023';
  end if;

  delete from public.assistant_threads
   where updated_at < now() - make_interval(days => p_days);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

comment on function public.assistant_purge_expired(int) is
  'Elimina le conversazioni inattive da più di N giorni, di TUTTE le aziende. Manutenzione pianificata: rifiuta se auth.uid() non è nullo. Non tocca alcuna fonte aziendale.';

-- ---------------------------------------------------------------------------
-- 2. I privilegi
--
-- ⚠️ `from public` NON basta: `authenticated` e `anon` hanno il privilegio per
-- via dei privilegi predefiniti di Supabase, che lo concedono direttamente.
-- Vanno nominati.
-- ---------------------------------------------------------------------------
revoke all on function public.assistant_purge_expired(int) from public, anon, authenticated;
grant execute on function public.assistant_purge_expired(int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Autoverifica
--
-- La migrazione controlla il proprio esito, come la 0014 e la 0026: una regola
-- che si spera sia in vigore non è una regola. Se il privilegio è ancora lì,
-- questa migrazione FALLISCE invece di lasciare il difetto aperto.
-- ---------------------------------------------------------------------------
do $$
begin
  if has_function_privilege('authenticated', 'public.assistant_purge_expired(int)', 'execute') then
    raise exception 'assistant_purge_expired è ancora eseguibile da authenticated';
  end if;
  if has_function_privilege('anon', 'public.assistant_purge_expired(int)', 'execute') then
    raise exception 'assistant_purge_expired è ancora eseguibile da anon';
  end if;
  if not has_function_privilege('service_role', 'public.assistant_purge_expired(int)', 'execute') then
    raise exception 'assistant_purge_expired non è più eseguibile dal ruolo di servizio';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. La stessa verifica sulle altre funzioni della 0027
--
-- `assistant_reserve_slot` DEVE restare eseguibile da `authenticated`: è la
-- prenotazione della quota, la chiama la Edge Function con il JWT dell'utente e
-- verifica la membership al proprio interno. Qui si controlla che sia così, per
-- non scoprire il contrario il giorno in cui qualcuno «mette in ordine» i
-- privilegi guardando solo questa migrazione.
-- ---------------------------------------------------------------------------
do $$
begin
  if not has_function_privilege('authenticated', 'public.assistant_reserve_slot(uuid, int, int, text, text)', 'execute') then
    raise exception 'assistant_reserve_slot non è più eseguibile da authenticated: la quota smetterebbe di funzionare';
  end if;
end $$;
