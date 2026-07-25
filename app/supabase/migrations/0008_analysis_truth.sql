-- ============================================================================
-- 0008 — "verità dell'analisi": correzioni di correttezza e sicurezza.
--
-- 1) ai_request_log: chiudere la falla per cui un membro poteva falsificare il
--    log e bloccare l'AI dell'intera azienda (rate limit avvelenato).
-- 2) document_analyses.amount_type: il tipo dell'importo principale, per non
--    presentare mai una multa come "importo dovuto" (§12).
-- 3) document_extractions.truncated: dichiarare quando il testo inviato al
--    modello è stato tagliato, invece di spacciare l'analisi per completa (§28).
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) ai_request_log — un membro poteva inserire righe a nome di ALTRI utenti e
--    con `created_at` arbitrario (anche futuro). Con 12 righe nella finestra si
--    rendeva il rate limit un 429 permanente per tutti i colleghi, e l'audit
--    diventava inaffidabile perché `user_id` non era attribuibile.
--    Le policy gemelle (replies, corrections) vincolavano già l'identità: qui
--    mancava. Si allinea, e si impedisce di retrodatare/postdatare la riga.
-- ---------------------------------------------------------------------------
alter table public.ai_request_log
  alter column created_at set default now();

drop policy if exists ai_log_insert_member on public.ai_request_log;
create policy ai_log_insert_member on public.ai_request_log
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and user_id = auth.uid()                                   -- non si scrive a nome d'altri
    and created_at between now() - interval '5 minutes'        -- niente righe retrodatate
                       and now() + interval '1 minute'         -- né postdatate (rate limit avvelenato)
  );

-- La colonna `created_at` non deve poter essere scelta liberamente dal client:
-- il default `now()` vale quando non viene passata, la policy blocca il resto.
comment on policy ai_log_insert_member on public.ai_request_log is
  'Un membro può registrare solo le PROPRIE chiamate, con timestamp coerente: impedisce di avvelenare il rate limit altrui e mantiene il log attribuibile.';

-- ---------------------------------------------------------------------------
-- 2) Tipo dell'importo principale (§12).
--    `amount` conserva l'importo "di testa": se il documento non contiene un
--    importo DOVUTO si ripiega sul più rilevante, ma il tipo va dichiarato
--    perché una multa non è una richiesta di pagamento.
-- ---------------------------------------------------------------------------
alter table public.document_analyses
  add column if not exists amount_type text;

comment on column public.document_analyses.amount_type is
  'Tipo dell''importo in `amount`: due | fine | fee | contribution | other. NULL = nessun importo rilevato.';

-- ---------------------------------------------------------------------------
-- 3) Troncamento del testo dichiarato (§28).
--    Oltre il limite di caratteri il modello vede solo l'inizio del documento:
--    va registrato, altrimenti un'analisi parziale sembra completa.
-- ---------------------------------------------------------------------------
alter table public.document_extractions
  add column if not exists truncated boolean not null default false;

comment on column public.document_extractions.truncated is
  'true = il testo inviato al modello è stato tagliato al limite: l''analisi può non coprire la parte finale del documento.';
