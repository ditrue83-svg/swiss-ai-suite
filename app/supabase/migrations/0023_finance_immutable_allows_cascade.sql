-- ============================================================================
-- 0023 — UN VERBALE IMMUTABILE DEVE POTER MORIRE CON IL SUO DOCUMENTO
--
-- ⚠️ IL DIFETTO. La 0021 rende immutabili i verbali finanziari e le correzioni
-- con due trigger che sollevano su `update or delete`. Il divieto di UPDATE è
-- giusto e resta. Il divieto di DELETE no, e rompeva due cose insieme:
--
--   1. **un documento con una fattura non si poteva più cancellare.** La
--      cancellazione di un documento porta via per cascata analisi, estrazioni,
--      correzioni e storico (§90/§91): arrivata a `finance_extractions` il
--      trigger sollevava, e l'intera cancellazione falliva. Un documento
--      finanziario diventava indistruttibile — che non è una garanzia, è un
--      guasto: nessuno può più togliere dal sistema una fattura caricata per
--      sbaglio, e nessuna politica di conservazione può funzionare.
--
--   2. **la pulizia dei dati di prova non girava.** `npm run test:finance`
--      cancella le aziende create e verifica che siano sparite: sette aziende
--      di prova sono rimaste nel database di PRODUZIONE. È esattamente
--      l'incidente del 2026-07-26 con l'Inbox, per una causa diversa.
--
-- ⚠️ ALLORA CHE COSA PROTEGGE L'IMMUTABILITÀ, ADESSO?
-- I PERMESSI, che è dove doveva stare fin dall'inizio. Il client autenticato ha
-- `select` su `finance_extractions` e `select, insert` su `finance_corrections`:
-- non ha `delete` su nessuna delle due, e non esiste alcuna policy che glielo
-- conceda. Dal browser un verbale non si cancella, punto.
--
-- Ciò che si può fare è cancellare il DOCUMENTO — che è un'azione riservata ad
-- amministratori e titolari (`documents_delete_admin_or_owner`, 0017) e che
-- porta via tutto quanto insieme. È una scelta diversa e dichiarata: non si
-- cancella il verbale di una fattura tenendo la fattura, si cancella la fattura.
--
-- ⚠️ La lezione generalizzabile: un divieto scritto in un trigger vale anche per
-- la cascata, che non è una scrittura di qualcuno — è la conseguenza di una
-- cancellazione già autorizzata a monte. Prima di vietare in un trigger, chiedersi
-- chi altro passa di lì.
--
-- Trovato da `npm run test:finance` alla SECONDA esecuzione contro il database
-- vero, nella sezione che verifica la cascata tabella per tabella invece di
-- dichiararla.
--
-- Requisiti: 0021 e 0022 applicate.
-- ============================================================================


-- ---------------------------------------------------------------------------
-- 1. I verbali: non si modificano. Si cancellano solo con il documento.
-- ---------------------------------------------------------------------------
create or replace function public.finance_extractions_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'finance_extraction_immutable'
    using errcode = '42501',
          hint = 'Un''estrazione non si modifica: se ne scrive una versione nuova.';
end $$;

drop trigger if exists trg_finance_extractions_immutable on public.finance_extractions;
create trigger trg_finance_extractions_immutable
  -- ⚠️ SOLO `update`. Il `delete` era qui e impediva alla cascata di
  -- funzionare, rendendo indistruttibile ogni documento con una fattura.
  before update on public.finance_extractions
  for each row execute function public.finance_extractions_immutable();


-- ---------------------------------------------------------------------------
-- 2. Le correzioni: si aggiungono. Stesso ragionamento.
-- ---------------------------------------------------------------------------
create or replace function public.finance_corrections_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'finance_correction_append_only'
    using errcode = '42501',
          hint = 'Le correzioni si aggiungono: per cambiare un valore se ne scrive una nuova.';
end $$;

drop trigger if exists trg_finance_corrections_append_only on public.finance_corrections;
create trigger trg_finance_corrections_append_only
  before update on public.finance_corrections
  for each row execute function public.finance_corrections_append_only();


-- ---------------------------------------------------------------------------
-- 3. Autoverifica: i permessi devono reggere da soli
--
-- Ora che il trigger non vieta più il `delete`, l'unica difesa contro una
-- cancellazione dal browser sono i permessi. Se un giorno qualcuno concedesse
-- `delete` a `authenticated` su queste tabelle, la garanzia sparirebbe in
-- silenzio: qui la migrazione si rifiuta di dirsi riuscita.
--
-- ⚠️ Nessuna riga di questo blocco esegue codice che nomini i valori enum
-- aggiunti dalla 0021: si interroga solo il catalogo dei permessi. Vedi la
-- sezione 3 della 0022 per il motivo.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('finance_extractions', 'finance_corrections')
    and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
    and privilege_type = 'DELETE';
  if v_bad is not null then
    raise exception 'senza il divieto nel trigger, i permessi devono reggere: %', v_bad;
  end if;

  select string_agg(format('%s.%s', table_name, privilege_type), ', ')
    into v_bad
  from information_schema.table_privileges
  where table_schema = 'public'
    and table_name in ('finance_extractions', 'finance_corrections')
    and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
    and privilege_type = 'UPDATE';
  if v_bad is not null then
    raise exception 'i verbali e le correzioni risultano modificabili dal client: %', v_bad;
  end if;
end $$;
