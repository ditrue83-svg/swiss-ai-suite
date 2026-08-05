-- ============================================================================
-- 0038 — `list_subsidy_catalog_reviews` interrogava una colonna che non esiste.
--
-- IL DIFETTO. La 0037 faceva `left join public.subsidy_sources s … select s.url`.
-- `subsidy_sources` non ha una colonna `url`: ha **`canonical_url`**. Alla prima
-- chiamata vera la funzione rispondeva `42703 column s.url does not exist`.
--
-- ⚠️⚠️ E LA PARTE CHE VALE LA PENA RICORDARE NON È IL REFUSO: È PERCHÉ
-- L'AUTOVERIFICA DELLA 0037 NON POTEVA VEDERLO. Quel blocco provava che il
-- cancello fosse CHIUSO — chiamava la funzione senza `auth.uid()` e verificava
-- che sollevasse 42501. Ma il controllo sull'operatore sta in cima al corpo:
-- sollevando lì, l'esecuzione **non arriva mai al `return query`**. E il corpo di
-- una funzione plpgsql non viene pianificato alla creazione, solo alla prima
-- esecuzione. Quindi quella query non è mai stata né pianificata né eseguita, e
-- l'autoverifica è passata senza toccare la cosa che doveva proteggere.
-- **Un controllo che si ferma prima del codice che verifica è un verde falso.**
--
-- LA CORREZIONE, che toglie il problema invece di correggere la riga. La query
-- diventa una **VISTA**, e una vista PostgreSQL la valida alla creazione: una
-- colonna inesistente fa fallire la migrazione, subito, senza bisogno che
-- qualcuno la chiami. La funzione resta il cancello e non fa altro che leggere
-- dalla vista, così la query esiste in un posto solo.
--
-- ⚠️ La 0037 NON viene modificata: è già applicata, e riscriverla farebbe
-- divergere il file dallo stato reale del database senza che nessuno se ne
-- accorga — `db push` non la rieseguirebbe.
--
-- ⚠️ Ripetibile per costruzione (`create or replace`, `revoke`, `do $$`).
-- ============================================================================

-- ---- La query, in un posto solo e validata alla creazione -------------------

create or replace view public.subsidy_catalog_reviews_expanded as
  select r.id,
         r.program_id,
         p.name              as program_name,
         p.authority         as program_authority,
         p.last_checked_at,
         p.data_status::text as data_status,
         r.change_type,
         r.risk_level,
         r.status,
         r.previous_values,
         r.proposed_values,
         -- ⚠️ `canonical_url`, non `url`: è il nome vero della colonna, e il
         -- fatto che questa vista non si crei se sbaglio è tutta la ragione per
         -- cui la query sta qui e non dentro un corpo plpgsql.
         s.canonical_url     as source_url,
         r.created_at,
         r.reviewed_at,
         r.reviewed_by,
         r.notes
    from public.subsidy_catalog_reviews r
    left join public.subsidy_programs p on p.id = r.program_id
    left join public.subsidy_source_fetches f on f.id = r.source_fetch_id
    left join public.subsidy_sources s on s.id = f.source_id;

comment on view public.subsidy_catalog_reviews_expanded is
  'Uso interno: la query di list_subsidy_catalog_reviews, isolata perché una vista viene validata alla creazione. NON concessa al client.';

-- ⚠️ La vista eredita le colonne di tabelle che il client non può leggere:
-- concederla equivarrebbe a concedere quelle. Resta interna.
revoke all on public.subsidy_catalog_reviews_expanded from anon, authenticated, public;

-- ---- Il cancello, che ora non contiene più la query ------------------------

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
    select v.id, v.program_id, v.program_name, v.program_authority,
           v.last_checked_at, v.data_status, v.change_type, v.risk_level,
           v.status, v.previous_values, v.proposed_values, v.source_url,
           v.created_at, v.reviewed_at, v.reviewed_by, v.notes
      from public.subsidy_catalog_reviews_expanded v
     where p_include_resolved or v.status = 'pending'
     order by (v.status = 'pending') desc,
              case v.risk_level when 'high' then 0 when 'medium' then 1 else 2 end,
              v.created_at
     limit greatest(1, least(coalesce(p_limit, 100), 500));
end;
$$;

revoke all on function public.list_subsidy_catalog_reviews(boolean, integer) from public;
grant execute on function public.list_subsidy_catalog_reviews(boolean, integer) to authenticated;

-- ---- Autoverifica ----------------------------------------------------------
-- ⚠️ Questa volta ESEGUE la query, che è precisamente ciò che la 0037 non
-- faceva. La vista è già stata validata dalla `create view` qui sopra; qui la
-- si legge davvero, così anche un errore che si manifesta solo in esecuzione
-- (un cast, un tipo) fa fallire la migrazione invece di aspettare un utente.
do $$
declare
  v_n bigint;
  v_ok boolean;
begin
  -- 1. La query si risolve E si esegue.
  select count(*) into v_n from public.subsidy_catalog_reviews_expanded;
  raise notice '0038: la vista si legge — % righe', v_n;

  -- 2. Le colonne che il difetto riguardava esistono e arrivano fino in fondo.
  select count(*) > 0 into v_ok
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'subsidy_catalog_reviews_expanded'
     and column_name = 'source_url';
  if not v_ok then
    raise exception '0038: autoverifica fallita — la vista non espone source_url';
  end if;

  -- 3. Il cancello è ancora chiuso: la correzione non lo ha allargato.
  begin
    perform * from public.list_subsidy_catalog_reviews();
    raise exception '0038: autoverifica fallita — la lettura non ha sollevato per un non-operatore';
  exception
    when insufficient_privilege then null;  -- 42501: atteso
  end;

  -- 4. Né la vista né le due tabelle sono concesse al client.
  select count(*) = 0 into v_ok
    from information_schema.role_table_grants
   where table_schema = 'public'
     and table_name in ('subsidy_catalog_editors', 'subsidy_catalog_reviews',
                        'subsidy_catalog_reviews_expanded')
     and lower(grantee) in ('anon', 'authenticated', 'public');
  if not v_ok then
    raise exception '0038: autoverifica fallita — qualcosa è concesso al client';
  end if;

  raise notice '0038: autoverifica superata';
end;
$$;
