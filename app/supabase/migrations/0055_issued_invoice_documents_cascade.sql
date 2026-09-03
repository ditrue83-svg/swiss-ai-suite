-- 0055 — Il ponte documenti delle fatture emesse va a cascata.
--
-- La 0053 ha dichiarato `document_id … on delete restrict` sul ponte di
-- provenienza, per impedire che un PDF registrato sparisse portandosi via la
-- traccia. Ma RESTRICT si verifica subito, anche dentro una cascata: eliminando
-- l'azienda il documento non poteva più essere cancellato finché esisteva il
-- ponte, e il ponte esisteva finché la cascata non raggiungeva la fattura.
-- È la classe della 0023 (e l'abbiamo rivista nei preventivi): una garanzia
-- scritta guardando il caso normale va provata contro il caso in cui tutto se
-- ne va. Il primo giro di `test:finance` sulla 0053 lo ha dimostrato: pulizia
-- fallita, due aziende di prova rimaste.
--
-- La protezione vera non cambia: la fattura sopravvive al documento perché la
-- radice ha già `document_id … on delete set null` (0053:126, lo stesso
-- principio di `finance_items.current_extraction_id`). Il ponte segue i
-- preventivi: `crm_quote_documents.document_id` è `on delete cascade`
-- (0049:226) da quando esiste.

begin;

alter table public.finance_issued_invoice_documents
  drop constraint if exists finance_issued_invoice_documents_document_id_fkey;

alter table public.finance_issued_invoice_documents
  add constraint finance_issued_invoice_documents_document_id_fkey
  foreign key (document_id) references public.documents(id) on delete cascade;

-- Autoverifica: il vincolo deve esistere ed essere a cascata (confdeltype 'c').
do $$
declare
  v_deltype "char";
begin
  select c.confdeltype into v_deltype
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
    join pg_namespace n on n.oid = t.relnamespace
   where n.nspname = 'public'
     and t.relname = 'finance_issued_invoice_documents'
     and c.conname = 'finance_issued_invoice_documents_document_id_fkey';
  if v_deltype is null or v_deltype <> 'c' then
    raise exception '0055 autoverifica fallita: il vincolo document_id non è a cascata';
  end if;
end $$;

commit;
