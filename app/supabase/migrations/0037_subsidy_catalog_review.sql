-- ============================================================================
-- 0037 — La revisione del catalogo incentivi: chi può deciderla, e come.
--
-- IL PROBLEMA. `subsidy_catalog_reviews` accumula le schede che il rilevatore di
-- cambiamenti produce quando una fonte ufficiale si muove. Al 2026-08-05 ce ne
-- sono SETTE, ferme dal 2026-07-30, e nessuno le ha mai potute guardare da
-- dentro il prodotto: la 0032 le ha lasciate con `revoke all` e senza policy, di
-- proposito, perché contengono proposte non verificate.
--
-- ⚠️⚠️ PERCHÉ NON BASTAVA APRIRLE A `authenticated`, ed è la decisione centrale
-- di questa migrazione. **Il catalogo è GLOBALE**: non ha `company_id`, e ciò
-- che dice vale per tutti i tenant insieme. `member_role` (owner/admin/member)
-- è invece per AZIENDA, quindi non può esprimere «può modificare il catalogo
-- condiviso». Concedere la lettura o la scrittura a `authenticated` avrebbe
-- significato che il cliente di un'azienda approva modifiche che TUTTI gli altri
-- clienti vedono — un'escalation fra tenant, e l'esatto contrario della ragione
-- per cui quel `revoke all` esiste.
--
-- LA SCELTA: un elenco esplicito di operatori del catalogo. Non è un ruolo, non
-- è un permesso per azienda: è un elenco di persone che possono decidere sul
-- catalogo del prodotto. Chi non c'è dentro non vede niente di diverso da oggi.
--
-- ⚠️ NESSUNA POLICY, NEMMENO QUI. Le due tabelle restano irraggiungibili dal
-- client: si passa SOLO dalle due funzioni qui sotto, che sono `security
-- definer` e controllano l'appartenenza PRIMA di qualsiasi cosa. Una policy in
-- più sarebbe una seconda porta da sorvegliare.
--
-- ⚠️ NON C'È NIENTE DA «APPLICARE» IN QUESTE SETTE SCHEDE, e il disegno lo
-- rispecchia. I loro `proposed_values` non sono campi di catalogo: sono impronte
-- della fonte (`textLength`, `contentHash`, `declaredUpdatedAt`,
-- `deadlineCandidateCount`). Dicono «la pagina è cambiata», non «il nome del
-- programma adesso è X». Quindi approvare significa «ho guardato la fonte, ciò
-- che diciamo resta vero» → si aggiorna `last_checked_at`; respingere significa
-- «il catalogo è sbagliato» → serve una nota che dica cosa, e la correzione vera
-- resta nel seed, che è come questo catalogo è scritto oggi. Nessun editor di
-- catalogo dentro l'app: sarebbe un sistema di redazione, e non è ciò che serve.
--
-- ⚠️ RIPETIBILE PER COSTRUZIONE: `if not exists`, `create or replace`, `revoke`,
-- `do $$`. Applicarla due volte non cambia nulla.
-- ============================================================================

-- ---- Chi può decidere sul catalogo -----------------------------------------

create table if not exists public.subsidy_catalog_editors (
  user_id  uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now(),
  -- Perché questa persona è qui. Un elenco di uuid senza motivo diventa un
  -- elenco che nessuno osa più toccare.
  note     text
);

comment on table public.subsidy_catalog_editors is
  'Le persone che possono revisionare il catalogo incentivi. NON è un ruolo per azienda: il catalogo è globale. Si legge e si scrive solo via funzioni security definer.';

alter table public.subsidy_catalog_editors enable row level security;

-- ⚠️ Su `public` un grant non restringe nulla senza un `revoke all` che lo
-- preceda: Supabase concede i privilegi pieni per default.
revoke all on public.subsidy_catalog_editors from anon, authenticated, public;
revoke all on public.subsidy_catalog_reviews from anon, authenticated, public;

/**
 * `true` se chi sta chiamando è un operatore del catalogo.
 *
 * ⚠️ `security definer` perché deve poter leggere una tabella che nessun client
 * può leggere. `stable`, non `volatile`: dentro una stessa istruzione la
 * risposta non cambia.
 * ⚠️ Con `auth.uid()` nullo — service role, o SQL editor — torna `false`, e va
 * bene così: i worker non passano di qui, usano il service role sulle tabelle.
 */
create or replace function public.subsidy_is_catalog_editor()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.subsidy_catalog_editors e
     where e.user_id = auth.uid()
  );
$$;

-- ---- Leggere la coda -------------------------------------------------------

/**
 * Le revisioni del catalogo, con accanto ciò che il catalogo dice OGGI.
 *
 * ⚠️ Chi non è operatore riceve un ERRORE, non un elenco vuoto. Un elenco vuoto
 * è una risposta plausibile a «non ci sono revisioni», e usarlo per dire «non
 * puoi guardare» significherebbe rispondere il falso a chi ha diritto di sapere
 * che esiste qualcosa che non può vedere.
 */
create or replace function public.list_subsidy_catalog_reviews(
  p_include_resolved boolean default false,
  p_limit integer default 100
)
returns table (
  id                 uuid,
  program_id         text,
  program_name       text,
  program_authority  text,
  last_checked_at    date,
  data_status        text,
  change_type        public.subsidy_review_change_type,
  risk_level         public.subsidy_review_risk,
  status             public.subsidy_review_status,
  previous_values    jsonb,
  proposed_values    jsonb,
  source_url         text,
  created_at         timestamptz,
  reviewed_at        timestamptz,
  reviewed_by        uuid,
  notes              text
)
language plpgsql
security definer
stable
set search_path = ''
as $$
begin
  if not public.subsidy_is_catalog_editor() then
    raise exception 'NOT_CATALOG_EDITOR'
      using errcode = '42501',
            hint = 'Solo gli operatori del catalogo possono leggere le revisioni.';
  end if;

  return query
    select r.id,
           r.program_id,
           p.name,
           p.authority,
           p.last_checked_at,
           p.data_status::text,
           r.change_type,
           r.risk_level,
           r.status,
           r.previous_values,
           r.proposed_values,
           s.url,
           r.created_at,
           r.reviewed_at,
           r.reviewed_by,
           r.notes
      from public.subsidy_catalog_reviews r
      left join public.subsidy_programs p on p.id = r.program_id
      left join public.subsidy_source_fetches f on f.id = r.source_fetch_id
      left join public.subsidy_sources s on s.id = f.source_id
     where p_include_resolved or r.status = 'pending'
     -- Le più rischiose e le più vecchie per prime: è l'ordine in cui una
     -- persona le smaltisce, non l'ordine in cui sono arrivate.
     order by (r.status = 'pending') desc,
              case r.risk_level when 'high' then 0 when 'medium' then 1 else 2 end,
              r.created_at
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

-- ---- Decidere --------------------------------------------------------------

/**
 * Chiude una revisione, e scrive CHI ha deciso e QUANDO.
 *
 * `p_decision`:
 *   · `accepted` — «ho guardato la fonte, ciò che il catalogo dice resta vero».
 *     Aggiorna `subsidy_programs.last_checked_at` a oggi: è il solo effetto
 *     sul catalogo, ed è quello che serve perché la freschezza riparta.
 *   · `rejected` — «il catalogo è sbagliato». RICHIEDE una nota: una revisione
 *     respinta senza dire cosa non va lascia il lavoro esattamente dov'era.
 *   · `ignored`  — «cambiamento irrilevante, non riguarda ciò che pubblichiamo».
 *     Non tocca `last_checked_at`, perché nessuno ha verificato il contenuto.
 *
 * ⚠️ Una revisione GIÀ DECISA non si ridecide: `raise`, non un aggiornamento
 * silenzioso. Due persone sulla stessa coda devono accorgersi di essersi
 * pestate i piedi, non sovrascriversi a vicenda.
 */
create or replace function public.resolve_subsidy_catalog_review(
  p_id       uuid,
  p_decision text,
  p_note     text default null
)
returns table (
  id              uuid,
  status          public.subsidy_review_status,
  reviewed_at     timestamptz,
  reviewed_by     uuid,
  last_checked_at date
)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_actor   uuid := auth.uid();
  v_program text;
  v_status  public.subsidy_review_status;
  v_checked date;
begin
  if not public.subsidy_is_catalog_editor() then
    raise exception 'NOT_CATALOG_EDITOR'
      using errcode = '42501',
            hint = 'Solo gli operatori del catalogo possono decidere una revisione.';
  end if;

  if p_decision not in ('accepted', 'rejected', 'ignored') then
    raise exception 'INVALID_DECISION'
      using errcode = '22023',
            hint = 'Ammessi: accepted, rejected, ignored.';
  end if;

  -- ⚠️ La nota è obbligatoria solo per il rifiuto, ed è la ragione per cui
  -- questa funzione esiste invece di un semplice update: è una regola, e le
  -- regole stanno dove non si possono aggirare.
  if p_decision = 'rejected' and coalesce(btrim(p_note), '') = '' then
    raise exception 'NOTE_REQUIRED'
      using errcode = '22023',
            hint = 'Respingere senza dire che cosa non va lascia il lavoro dov''era.';
  end if;

  -- Si blocca la riga PRIMA di leggerne lo stato: senza, due decisioni
  -- simultanee leggerebbero entrambe «pending» e passerebbero entrambe.
  select r.program_id, r.status into v_program, v_status
    from public.subsidy_catalog_reviews r
   where r.id = p_id
     for update;

  if not found then
    raise exception 'REVIEW_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_status <> 'pending' then
    raise exception 'REVIEW_ALREADY_RESOLVED'
      using errcode = '55000',
            hint = 'Questa revisione è già stata decisa da qualcuno.';
  end if;

  update public.subsidy_catalog_reviews r
     set status      = p_decision::public.subsidy_review_status,
         reviewed_by = v_actor,
         reviewed_at = now(),
         notes       = nullif(btrim(coalesce(p_note, '')), '')
   where r.id = p_id;

  -- Solo l'approvazione tocca il catalogo, e tocca UNA cosa sola.
  if p_decision = 'accepted' and v_program is not null then
    update public.subsidy_programs p
       set last_checked_at = current_date
     where p.id = v_program;
  end if;

  select p.last_checked_at into v_checked
    from public.subsidy_programs p where p.id = v_program;

  return query
    select p_id, p_decision::public.subsidy_review_status, now(), v_actor, v_checked;
end;
$$;

-- ---- Superficie concessa ---------------------------------------------------
-- ⚠️ Si concede l'ESECUZIONE delle tre funzioni, non l'accesso alle tabelle. Il
-- cancello è dentro le funzioni: `execute` a `authenticated` significa «puoi
-- chiedere», non «puoi vedere».
revoke all on function public.subsidy_is_catalog_editor() from public;
revoke all on function public.list_subsidy_catalog_reviews(boolean, integer) from public;
revoke all on function public.resolve_subsidy_catalog_review(uuid, text, text) from public;

grant execute on function public.subsidy_is_catalog_editor() to authenticated;
grant execute on function public.list_subsidy_catalog_reviews(boolean, integer) to authenticated;
grant execute on function public.resolve_subsidy_catalog_review(uuid, text, text) to authenticated;

-- ---- Autoverifica ----------------------------------------------------------
-- ⚠️ Una migrazione che si limita a creare oggetti prova soltanto che il DDL è
-- sintatticamente valido. Qui si verifica ciò che conta: che il cancello sia
-- CHIUSO. Nel contesto di una migrazione `auth.uid()` è nullo, quindi chi
-- esegue non è un operatore — ed è esattamente il caso che deve essere respinto.
do $$
declare
  v_ok boolean;
begin
  -- 1. Senza identità non si è operatori.
  if public.subsidy_is_catalog_editor() then
    raise exception '0037: autoverifica fallita — senza auth.uid() risulta operatore';
  end if;

  -- 2. La lettura deve SOLLEVARE, non tornare vuota.
  begin
    perform * from public.list_subsidy_catalog_reviews();
    raise exception '0037: autoverifica fallita — la lettura non ha sollevato per un non-operatore';
  exception
    when insufficient_privilege then null;  -- 42501: atteso
  end;

  -- 3. Anche la decisione deve sollevare, e PRIMA di guardare se la riga esiste:
  --    un non-operatore non deve poter scoprire quali id esistono.
  begin
    perform * from public.resolve_subsidy_catalog_review(
      '00000000-0000-0000-0000-000000000000'::uuid, 'accepted', null);
    raise exception '0037: autoverifica fallita — la decisione non ha sollevato per un non-operatore';
  exception
    when insufficient_privilege then null;  -- 42501: atteso
  end;

  -- 4. Le due tabelle NON devono essere raggiungibili da `authenticated`.
  -- ⚠️ `lower(grantee)`: in `information_schema` il grant a PUBLIC compare come
  -- «PUBLIC», maiuscolo. Un confronto con 'public' minuscolo non lo troverebbe
  -- MAI, e questo controllo direbbe sempre di sì — un verde falso che nasconde
  -- esattamente la concessione più pericolosa delle tre.
  select count(*) = 0 into v_ok
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('subsidy_catalog_editors', 'subsidy_catalog_reviews')
     and lower(grantee) in ('anon', 'authenticated', 'public');
  if not v_ok then
    raise exception '0037: autoverifica fallita — le tabelle sono ancora concesse al client';
  end if;

  raise notice '0037: autoverifica superata (cancello chiuso, tabelle non concesse)';
end;
$$;
