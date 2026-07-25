-- ============================================================================
-- 0009 — Controllo abusi e costi: quota AI atomica + limiti di upload reali.
--
-- 1) Rate limit §50: oggi è "leggi-poi-agisci" (si conta prima del lavoro e si
--    scrive dopo), quindi N richieste concorrenti leggono lo stesso conteggio e
--    passano TUTTE. Qui la verifica e la prenotazione dello slot diventano una
--    sola operazione serializzata per azienda.
-- 2) Il limite di dimensione file si fidava di `documents.file_size`, colonna
--    scritta dal browser: si impone il limite sul BUCKET, dove il client non
--    può mentire, insieme ai tipi MIME ammessi.
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Quota AI atomica.
--    `pg_advisory_xact_lock` serializza le richieste della STESSA azienda per la
--    durata della transazione: due chiamate concorrenti non possono più leggere
--    lo stesso conteggio e passare entrambe. Aziende diverse non si bloccano a
--    vicenda (il lock è sull'id dell'azienda).
--    La riga viene PRENOTATA subito con stato 'pending': una richiesta in corso
--    occupa la sua quota, che è la semantica corretta. `finalize_ai_request` la
--    completa con l'esito reale.
-- ---------------------------------------------------------------------------
create or replace function public.try_consume_ai_quota(
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
  -- Autorizzazione esplicita: SECURITY DEFINER scavalca la RLS, quindi la
  -- membership va verificata qui dentro, non darla per scontata.
  if auth.uid() is null or not public.is_company_member(p_company_id) then
    raise exception 'not a member of company %', p_company_id using errcode = '42501';
  end if;

  -- Serializza le richieste concorrenti della stessa azienda.
  perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 0));

  select count(*) into v_count
    from public.ai_request_log
   where company_id = p_company_id
     and created_at > now() - interval '1 minute';

  if v_count >= p_limit then
    return null;                      -- quota esaurita: il chiamante risponde 429
  end if;

  insert into public.ai_request_log (company_id, user_id, document_id, kind, provider, model, status)
  values (p_company_id, auth.uid(), p_document_id, p_kind, p_provider, p_model, 'pending')
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.try_consume_ai_quota is
  'Verifica e consuma in modo ATOMICO uno slot di quota AI per l''azienda. Ritorna l''id della riga di log prenotata, oppure NULL se il limite è già stato raggiunto.';

-- Completa la riga prenotata con l'esito. SECURITY DEFINER perché al client non
-- viene concesso UPDATE diretto sul log (resta append-only dal suo punto di vista).
create or replace function public.finalize_ai_request(
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
  update public.ai_request_log
     set status        = coalesce(p_status, status),
         duration_ms   = coalesce(p_duration_ms, duration_ms),
         input_tokens  = coalesce(p_input_tokens, input_tokens),
         output_tokens = coalesce(p_output_tokens, output_tokens),
         error_code    = coalesce(p_error_code, error_code),
         model         = coalesce(p_model, model)
   where id = p_id
     and user_id = auth.uid();        -- si completa solo la PROPRIA riga
end;
$$;

comment on function public.finalize_ai_request is
  'Completa con l''esito una riga di ai_request_log prenotata da try_consume_ai_quota. Un utente può aggiornare solo le proprie righe.';

revoke all on function public.try_consume_ai_quota(uuid, text, int, uuid, text, text) from public;
revoke all on function public.finalize_ai_request(uuid, text, int, int, int, text, text) from public;
grant execute on function public.try_consume_ai_quota(uuid, text, int, uuid, text, text) to authenticated;
grant execute on function public.finalize_ai_request(uuid, text, int, int, int, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Limiti di upload imposti dal BUCKET (il client non può aggirarli).
--    `documents.file_size` è scritto dal browser: usarlo come unico controllo
--    significa fidarsi di un valore che l'utente decide. Il bucket invece rifiuta
--    l'oggetto a monte.
--    15 MB = lo stesso tetto già applicato lato Edge Function (MAX_FILE_BYTES).
-- ---------------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 15728640,             -- 15 MB
       allowed_mime_types = array[
         'application/pdf',
         'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/heic', 'image/tiff',
         'text/plain', 'message/rfc822'
       ]
 where id = 'company-documents';
