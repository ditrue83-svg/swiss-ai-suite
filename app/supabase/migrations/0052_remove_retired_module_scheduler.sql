-- 0052 — chiude il residuo operativo del modulo rimosso dalla 0051.
--
-- La Edge Function non esiste più, ma il job pg_cron vive nel database e non
-- dipende dal suo bersaglio: senza questa migrazione continuerebbe ad accodare
-- una richiesta destinata a fallire ogni quindici minuti.

begin;

do $remove_retired_scheduler$
declare
  v_job record;
begin
  -- Si usa il jobid per rimuovere anche eventuali duplicati omonimi. La forma
  -- per nome ne eliminerebbe uno solo e lascerebbe il difetto invisibile nella
  -- mappa usata dai controlli operativi.
  for v_job in
    select jobid from cron.job where jobname = 'subsidy-worker'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end $remove_retired_scheduler$;

do $verify_retired_scheduler_removed$
begin
  if exists (select 1 from cron.job where jobname = 'subsidy-worker') then
    raise exception '0052: lo scheduler del modulo rimosso esiste ancora';
  end if;
end $verify_retired_scheduler_removed$;

commit;
