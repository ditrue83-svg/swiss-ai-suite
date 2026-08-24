-- ============================================================================
-- AI-Swisse — 0045 IL GESTO DI PROMOZIONE (D-13, PARTE B)
--
-- È il punto preciso in cui la posta diventa un dato aziendale: prima non
-- conta, dopo è tracciabile. Tre cose, e nient'altro:
--
--   1. «Ignora» diventa una decisione UMANA registrata (chi, quando), distinta
--      dal giudizio della macchina — il valore è nato nella 0044;
--   2. il trigger che sorveglia `attention_status` impara le due decisioni
--      nuove, e continua a rifiutare tutto il resto;
--   3. la promozione stessa: `email_promote_message`, che crea il legame che
--      il client NON può scrivere.
--
-- ⚠️⚠️ PERCHÉ LA PROMOZIONE È UNA FUNZIONE DEL DATABASE E NON TRE SCRITTURE
-- DAL SERVIZIO. Il client ha `grant select` e basta su
-- `email_message_documents` (0014): il legame non può scriverlo, ed è giusto
-- così — quella tabella è il verbale di che cosa è entrato in azienda. Ma
-- soprattutto le tre scritture devono stare in UNA transazione: un documento
-- creato e un legame mancante è precisamente il caso che rende la promozione
-- non idempotente, perché il secondo clic non troverebbe niente e creerebbe un
-- secondo documento.
--
-- ⚠️ L'IDEMPOTENZA (B3) NON È UN `if` NEL CODICE: è l'indice unico parziale
-- `uq_email_msg_doc_body` della 0013. Due clic simultanei arrivano entrambi
-- all'insert; uno vince, l'altro prende 23505, rilegge e restituisce lo stesso
-- identificativo. Un controllo «esiste già?» prima dell'insert non basterebbe,
-- perché fra la lettura e la scrittura ci sta un'altra richiesta.
--
-- ⚠️ IL REGISTRO NON SI SCRIVE QUI. `audit_logs` lo scrive il trigger
-- `trg_audit_document_insert` (0039) sulla tabella che possiede il fatto, con
-- `coalesce(auth.uid(), new.uploaded_by)` come autore. Scrivere una seconda
-- riga da questa funzione creerebbe due verbali dello stesso evento — ed è la
-- regola che la 0039 dichiara in testa. Questa funzione si limita a valorizzare
-- `uploaded_by`, così l'autore c'è anche quando a chiamare è il service role.
--
-- Requisiti: 0002 (documents), 0013 (Inbox), 0014 (permessi), 0039 (registro),
-- 0044 (il valore `dismissed`). Idempotente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Chi ha ignorato, e quando
--
-- ⚠️ COLONNE PROPRIE E NON `handled_by`/`handled_at`. «L'ho messa via» e «non
-- ci riguarda» sono due decisioni diverse, e un domani si vorrà sapere quante
-- comunicazioni una casella produce che l'azienda dichiara non sue — che è la
-- misura di quanto il filtro dei domini (0043) sia tarato bene. Con una colonna
-- sola quella domanda non ha risposta.
-- ---------------------------------------------------------------------------
alter table public.email_messages
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by uuid references auth.users (id) on delete set null;

comment on column public.email_messages.dismissed_at is
  'Quando una PERSONA ha dichiarato che questa comunicazione non riguarda l''azienda. Distinto da handled_at: «messa via» e «non ci riguarda» non sono la stessa decisione.';

-- ---------------------------------------------------------------------------
-- 2. Il trigger impara le decisioni umane nuove
--
-- ⚠️ LA FORMA RESTA QUELLA DELLA 0013: dal client si può solo DICHIARARE una
-- decisione, mai riscrivere una conclusione della pipeline. Cambia l'elenco
-- delle decisioni ammesse, non il principio — e ogni altro cambio continua a
-- sollevare.
--
-- ⚠️ IL RIPRISTINO DA `dismissed` NON RICALCOLA DA `relevance`, e questa è la
-- differenza che conta rispetto a `handled`. Rimettere in lista una messa via è
-- un ANNULLAMENTO, e la classificazione è l'unica cosa che resta da cui
-- ripartire. Ma un messaggio ignorato da una persona che torna in lista non
-- deve ripresentarsi con l'etichetta che la macchina gli aveva dato prima che
-- qualcuno la contraddicesse: torna a «da verificare», cioè «qualcuno lo
-- guardi», che è l'unica affermazione vera dopo un ripensamento.
-- ---------------------------------------------------------------------------
create or replace function public.set_email_message_handled_actor()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();

  if new.attention_status is distinct from old.attention_status then
    if new.attention_status = 'handled' then
      -- «Metti via»: chi e quando li scrive il database, non la richiesta.
      if auth.uid() is not null then
        new.handled_by := auth.uid();
        new.handled_at := now();
      end if;

    elsif new.attention_status = 'dismissed' then
      -- «Ignora»: una decisione della persona, non un giudizio della macchina.
      -- Non cancella niente — né qui né sulla casella remota.
      if auth.uid() is not null then
        new.dismissed_by := auth.uid();
        new.dismissed_at := now();
      end if;

    elsif old.attention_status = 'handled' then
      -- «Rimetti in lista»: il messaggio torna dove lo aveva messo la
      -- classificazione. Il valore inviato dal client viene IGNORATO — un
      -- ripristino è un annullamento, non l'occasione per riscrivere una
      -- conclusione dell'analisi.
      new.attention_status := public.email_attention_for_relevance(new.relevance);
      new.handled_by := null;
      new.handled_at := null;

    elsif old.attention_status = 'dismissed' then
      -- Ripensamento su un «Ignora»: vedi il commento qui sopra.
      new.attention_status := 'to_verify';
      new.dismissed_by := null;
      new.dismissed_at := null;

    elsif auth.uid() is not null then
      raise exception 'attention_status: dal client sono ammessi solo "handled", "dismissed" e il ripristino'
        using errcode = '22023';
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------------
-- 3. LA PROMOZIONE
--
-- Dato un messaggio e un documento appena creato (o già esistente), scrive il
-- legame e porta il messaggio a «Da gestire». Restituisce l'identificativo del
-- documento in vigore per quel messaggio — lo stesso a ogni chiamata.
--
-- ⚠️ IL DOCUMENTO NON LO CREA QUESTA FUNZIONE, e non è una divisione arbitraria:
-- un documento senza il suo file in Storage è «una promessa non mantenuta»
-- (parole di `createOrReuseDocument`, che per questo cancella la riga se il
-- caricamento fallisce), e da SQL lo Storage non si tocca. Chi chiama crea il
-- documento con il file, poi passa di qui per il legame. Se il legame c'è già,
-- questa funzione lo dice PRIMA che il chiamante crei alcunché.
--
-- ⚠️ `p_document_id` NULL = «dimmi solo se è già promosso». È la lettura che
-- rende B3 possibile senza sprecare un caricamento su Storage a ogni clic.
-- ---------------------------------------------------------------------------
create or replace function public.email_promote_message(
  p_message_id  uuid,
  p_document_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_existing uuid;
begin
  select company_id into v_company
    from public.email_messages where id = p_message_id;
  if v_company is null then
    raise exception 'messaggio non trovato' using errcode = 'P0002';
  end if;

  -- ⚠️ L'AUTORIZZAZIONE NON LA EREDITA `security definer`. La funzione salta la
  -- RLS per poter scrivere il legame; l'appartenenza all'azienda va quindi
  -- chiesta esplicitamente. `auth.uid()` NULL = service role, che è il server e
  -- ha già autenticato a monte.
  if auth.uid() is not null and not public.is_company_member(v_company) then
    raise exception 'non autorizzato' using errcode = '42501';
  end if;

  select document_id into v_existing
    from public.email_message_documents
   where email_message_id = p_message_id and relation = 'body';
  if v_existing is not null then
    return v_existing;                         -- B3: già promosso, stesso esito
  end if;
  if p_document_id is null then
    return null;                               -- sola lettura: non c'è ancora
  end if;

  begin
    insert into public.email_message_documents
      (company_id, email_message_id, document_id, relation)
    values (v_company, p_message_id, p_document_id, 'body');
  exception when unique_violation then
    -- Due clic simultanei: l'altro ha vinto. Non è un errore, è l'esito voluto.
    select document_id into v_existing
      from public.email_message_documents
     where email_message_id = p_message_id and relation = 'body';
    return v_existing;
  end;

  -- «Da gestire» lo produce una PERSONA promuovendo (A2, 0043): è l'unico
  -- modo in cui quello stato può nascere da qui in avanti.
  update public.email_messages
     set attention_status = 'needs_attention'
   where id = p_message_id
     and attention_status not in ('handled', 'dismissed');

  return p_document_id;
end $$;

revoke all on function public.email_promote_message(uuid, uuid) from public;
grant execute on function public.email_promote_message(uuid, uuid) to authenticated;

comment on function public.email_promote_message(uuid, uuid) is
  'D-13: scrive il legame messaggio→documento e porta il messaggio a «Da gestire». Idempotente per costruzione (uq_email_msg_doc_body). Con p_document_id NULL è una sola lettura: «è già promosso?».';
