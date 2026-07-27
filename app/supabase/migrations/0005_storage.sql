-- ============================================================================
-- SwissAI Suite — 0005 STORAGE
-- Bucket PRIVATO per i documenti aziendali. Accesso via signed URL temporanei.
-- Path convenzione: <company_id>/<document_id>/<original_filename>
-- La prima cartella del path (company_id) determina l'accesso via membership.
-- ============================================================================

-- Bucket privato (public = false)
insert into storage.buckets (id, name, public)
values ('company-documents', 'company-documents', false)
on conflict (id) do nothing;

-- Policy su storage.objects, ristrette al bucket e alla company del path.
-- (storage.foldername(name))[1] = primo segmento del path = company_id.
--
-- ⚠️ `drop policy if exists` PRIMA di ogni create, aggiunto il 2026-07-27 (secondo
-- giro). `create policy` non ha una forma `if not exists`: su un database che le
-- ha già fallisce con 42710 e — siccome il SQL editor esegue tutto in una
-- transazione sola — fa fallire l'INTERO file.
-- Le stesse quattro policy erano sfuggite alla correzione del 2026-07-27, e il
-- controllo di `npm run db:bundle` non le aveva viste perché i loro nomi sono
-- fra VIRGOLETTE e la sua espressione cercava `create policy <parola>`. Ora il
-- controllo le vede, e ha un caso di autoverifica che lo dimostra.
drop policy if exists "company_documents_select" on storage.objects;
create policy "company_documents_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'company-documents'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "company_documents_insert" on storage.objects;
create policy "company_documents_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'company-documents'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "company_documents_update" on storage.objects;
create policy "company_documents_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'company-documents'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  )
  with check (
    bucket_id = 'company-documents'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "company_documents_delete" on storage.objects;
create policy "company_documents_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'company-documents'
    and public.is_company_member(((storage.foldername(name))[1])::uuid)
  );
