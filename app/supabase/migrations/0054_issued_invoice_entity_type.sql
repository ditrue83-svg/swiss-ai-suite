-- 0054 — L'entità «fattura emessa» entra nei vincoli condivisi.
--
-- La 0053 ha introdotto l'innesco `finance_issued_invoice_overdue` con entità
-- `finance_issued_invoice`, ma i tre vincoli CHECK che presidiano gli entity_type
-- ammessi (ultima riscrittura: 0051) non la conoscono. Finché nessuna regola
-- ascolta l'innesco, `automation_emit` non scrive nulla e il buco resta
-- invisibile; alla prima regola attiva l'INSERT fallirebbe con 23514 — la
-- scansione risulterebbe rotta proprio quando serve. Stesso intervento che la
-- 0026 fece per le entità CRM: i vincoli si riscrivono, non si aggirano.

begin;

alter table public.automation_events drop constraint if exists automation_events_entity_type_check;
alter table public.workflow_runs drop constraint if exists workflow_runs_entity_type_check;
alter table public.notifications drop constraint if exists notifications_entity_type_check;

alter table public.automation_events
  add constraint automation_events_entity_type_check
  check (entity_type in ('document', 'email_message', 'task', 'contract',
                         'crm_organization', 'crm_opportunity',
                         'finance_issued_invoice'));
alter table public.workflow_runs
  add constraint workflow_runs_entity_type_check
  check (entity_type in ('document', 'email_message', 'task', 'contract',
                         'crm_organization', 'crm_opportunity',
                         'finance_issued_invoice'));
alter table public.notifications
  add constraint notifications_entity_type_check
  check (entity_type in ('task', 'calendar_connection', 'document', 'email_message',
                         'contract', 'crm_organization', 'crm_opportunity',
                         'finance_issued_invoice'));

-- Autoverifica: i tre vincoli devono ammettere la nuova entità. Si legge la
-- definizione dal catalogo, non si inserisce nessuna riga.
do $$
declare
  v_def text;
begin
  for v_def in
    select pg_get_constraintdef(c.oid)
      from pg_constraint c
      join pg_class t on t.oid = c.conrelid
      join pg_namespace n on n.oid = t.relnamespace
     where n.nspname = 'public'
       and c.conname in ('automation_events_entity_type_check',
                         'workflow_runs_entity_type_check',
                         'notifications_entity_type_check')
  loop
    if v_def not like '%finance_issued_invoice%' then
      raise exception '0054 autoverifica fallita: vincolo senza finance_issued_invoice: %', v_def;
    end if;
  end loop;
  if not found then
    raise exception '0054 autoverifica fallita: nessun vincolo entity_type trovato';
  end if;
end $$;

commit;
