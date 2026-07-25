-- ============================================================================
-- SwissAI Suite — 0010 IMMUTABILITÀ DELL'ANALISI
--
-- Il problema che chiude. `document_analyses` era insieme due cose:
--   · lo SNAPSHOT dell'analisi AI, che il README dichiara immutabile;
--   · lo STATO MUTABILE dell'utente (spunte della checklist, bozza di risposta).
-- Per permettere la seconda, la 0002 concedeva update e delete sull'INTERA
-- tabella a ogni membro. Conseguenza: chiunque, con la sola chiave anon e una
-- sessione valida, poteva riscrivere via API scadenza, mittente e importi di
-- un'analisi — cioè proprio i campi su cui poggia la promessa di verificabilità.
-- L'immutabilità era un'affermazione della documentazione, non un vincolo.
--
-- Cosa fa questa migrazione:
--   1. action_progress — lo stato della checklist esce dall'analisi e va in una
--      tabella propria;
--   2. le bozze di risposta vivono solo in document_replies (che esiste dalla
--      0006); reply_draft/reply_language/reply_tone diventano deprecate;
--   3. MIGRA i dati esistenti e SOLO DOPO revoca update e delete;
--   4. l'insert dal client resta, ma vincolato al motore locale: un membro non
--      può più fabbricare una riga che si spaccia per analisi AI;
--   5. document_extractions torna in sola lettura per il client, che non l'ha
--      mai scritta (la scrive la pipeline con service role).
--
-- ORDINE DI MESSA IN OPERA — questa migrazione va applicata PRIMA di deployare
-- il codice che la accompagna, non dopo. Nell'intervallo il frontend vecchio,
-- che scrive ancora sull'analisi, riceve un errore esplicito sulla spunta della
-- checklist: un guasto visibile, non un salvataggio che sembra riuscito. Il
-- percorso inverso (codice nuovo su schema vecchio) darebbe lo stesso errore su
-- una tabella inesistente. Non esiste un ordine indolore: si sceglie quello che
-- fallisce in modo dichiarato, coerente con §60 (nessun fallback silenzioso).
--
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. action_progress — la checklist dell'utente, separata dallo snapshot
--
-- Perché una tabella nuova e non un'estensione di `tasks`: sono due oggetti
-- diversi. Un task dello scadenziario è creato deliberatamente dall'utente,
-- ha titolo, priorità e scadenza proprie e SOPRAVVIVE all'analisi (resta anche
-- se il documento viene rianalizzato). La spunta di una checklist è invece
-- legata a UNA specifica analisi, identificata dalla posizione dell'azione in
-- quello snapshot: usare `tasks` significherebbe o creare una voce di
-- scadenziario a ogni spunta — inquinando la lista delle scadenze vere — o
-- aggiungere a `tasks` colonne che valgono solo per le azioni. Le due cose
-- restano collegate dal pulsante "aggiungi allo scadenziario", che continua a
-- creare un task vero.
--
-- Chiave (analysis_id, action_index): `action_index` è la posizione dell'azione
-- nell'array `document_analyses.actions`, che coincide sempre con il campo `id`
-- dell'oggetto perché entrambi i motori rinumerano le azioni dopo l'ordinamento
-- finale (engine.ts e _shared/persist.ts). Poiché ogni rianalisi crea una NUOVA
-- riga in document_analyses, il progresso non può mai riferirsi a un'azione
-- diversa da quella spuntata.
-- ---------------------------------------------------------------------------
create table if not exists public.action_progress (
  id            uuid primary key default gen_random_uuid(),
  analysis_id   uuid not null references public.document_analyses (id) on delete cascade,
  company_id    uuid not null references public.companies (id) on delete cascade,
  action_index  integer not null check (action_index >= 0),
  -- Copia del testo dell'azione al momento della spunta. Non è usata per
  -- leggere il progresso: serve a poter DIMOSTRARE, rileggendo lo snapshot, che
  -- l'indice punta ancora all'azione che l'utente aveva davanti. Se un giorno
  -- l'ordinamento cambiasse, la divergenza sarebbe rilevabile invece che muta.
  action_text   text,
  done          boolean not null default false,
  -- NULL quando `done` è false, e anche per le righe importate da questa
  -- migrazione: di quelle spunte non conosciamo né autore né momento, e un
  -- valore di ripiego sarebbe un dato inventato (§60).
  done_by       uuid references auth.users (id) on delete set null,
  done_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (analysis_id, action_index)
);
create index if not exists idx_action_progress_analysis on public.action_progress (analysis_id);
create index if not exists idx_action_progress_company  on public.action_progress (company_id);

comment on table public.action_progress is
  'Stato della checklist per singola azione di una analisi. Separata da document_analyses, che è uno snapshot immutabile.';
comment on column public.action_progress.action_index is
  'Posizione dell''azione in document_analyses.actions, uguale al campo id dell''oggetto azione.';
comment on column public.action_progress.done_at is
  'NULL = spunta importata dalla 0010 (momento reale ignoto) oppure azione non spuntata. Mai un valore di ripiego.';

-- ---------------------------------------------------------------------------
-- 2. Attribuzione decisa dal database, non dal client
--
-- `done_by` e `done_at` non vengono letti dalla richiesta: li imposta questo
-- trigger. Così un membro non può attribuire una spunta a un collega né datarla
-- a piacere, e il client non deve ricordarsi di farlo.
--
-- Quando `auth.uid()` è NULL (migrazione dei dati, service role) i valori
-- passati NON vengono sovrascritti: è il caso delle righe storiche, che restano
-- con done_at NULL invece di ricevere il timestamp della migrazione.
-- ---------------------------------------------------------------------------
create or replace function public.set_action_progress_actor()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();

  if not new.done then
    new.done_by := null;
    new.done_at := null;
    return new;
  end if;

  if auth.uid() is null then
    return new;                                    -- import/service role: nessuna attribuzione inventata
  end if;

  -- NB: su INSERT il record OLD non esiste, e in plpgsql non si può contare sulla
  -- valutazione pigra di un OR per evitarlo: i due casi restano separati.
  if tg_op = 'INSERT' then
    new.done_by := auth.uid();
    new.done_at := now();
  elsif not coalesce(old.done, false) then
    new.done_by := auth.uid();                     -- transizione a "fatto": chi la compie è chi la firma
    new.done_at := now();
  else
    new.done_by := coalesce(old.done_by, auth.uid());
    new.done_at := coalesce(old.done_at, now());   -- già spuntata: si conserva la prima firma
  end if;
  return new;
end $$;

drop trigger if exists trg_action_progress_actor on public.action_progress;
create trigger trg_action_progress_actor
  before insert or update on public.action_progress
  for each row execute function public.set_action_progress_actor();

-- ---------------------------------------------------------------------------
-- 3. RLS di action_progress
--
-- Oltre alla membership si verifica che l'analisi appartenga alla STESSA
-- azienda indicata nella riga: senza questo controllo un membro potrebbe
-- agganciare righe di progresso ad analisi di un'altra azienda passando il
-- proprio company_id. La sottoquery è a sua volta soggetta alla RLS di
-- document_analyses, quindi non rivela nulla di ciò che l'utente non può già
-- leggere: se l'analisi non è sua, l'exists è semplicemente falso.
--
-- Nessuna policy di DELETE: per togliere una spunta si aggiorna `done` a false.
-- Le righe spariscono solo in cascata con l'analisi.
-- ---------------------------------------------------------------------------
alter table public.action_progress enable row level security;

drop policy if exists action_progress_select_member on public.action_progress;
create policy action_progress_select_member on public.action_progress
  for select to authenticated using (public.is_company_member(company_id));

drop policy if exists action_progress_insert_member on public.action_progress;
create policy action_progress_insert_member on public.action_progress
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.document_analyses a
      where a.id = action_progress.analysis_id
        and a.company_id = action_progress.company_id
    )
  );

drop policy if exists action_progress_update_member on public.action_progress;
create policy action_progress_update_member on public.action_progress
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (
    public.is_company_member(company_id)
    and exists (
      select 1 from public.document_analyses a
      where a.id = action_progress.analysis_id
        and a.company_id = action_progress.company_id
    )
  );

grant select, insert, update on public.action_progress to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Bozze di risposta: document_replies è l'unica sede
--
-- Le colonne restano in tabella per non perdere i dati storici già copiati
-- sotto, ma nessuno le scrive più e nessuno le legge più.
-- ---------------------------------------------------------------------------
comment on column public.document_analyses.reply_draft is
  'DEPRECATA (0010): la bozza corrente vive in document_replies. Conservata per i dati storici, non più scritta né letta.';
comment on column public.document_analyses.reply_language is
  'DEPRECATA (0010): vedi document_replies.language.';
comment on column public.document_analyses.reply_tone is
  'DEPRECATA (0010): vedi document_replies.tone.';

-- ---------------------------------------------------------------------------
-- 5. MIGRAZIONE DEI DATI — prima di togliere qualunque permesso
-- ---------------------------------------------------------------------------

-- 5a. Spunte della checklist → action_progress.
--     Si importano solo le azioni realmente spuntate: una riga per ogni `done`
--     a true. Le azioni non spuntate non hanno bisogno di riga (assenza = non
--     fatta). `action_index` viene dal campo `id` dell'oggetto quando è un
--     intero, altrimenti dalla posizione nell'array: i due valori coincidono
--     per costruzione, ma non si dà per scontato un dato storico.
insert into public.action_progress (analysis_id, company_id, action_index, action_text, done, done_by, done_at)
select
  a.id,
  a.company_id,
  case when elem->>'id' ~ '^[0-9]+$' then (elem->>'id')::int else (ord - 1)::int end,
  nullif(elem->>'text', ''),
  true,
  null,                                            -- autore ignoto: non si inventa
  null                                             -- momento ignoto: non si inventa
from public.document_analyses a
cross join lateral jsonb_array_elements(a.actions) with ordinality as t(elem, ord)
where jsonb_typeof(a.actions) = 'array'
  and coalesce(elem->>'done', 'false') = 'true'
on conflict (analysis_id, action_index) do nothing;

-- 5b. Bozze → document_replies, una sola per documento (la più recente), e solo
--     se quel documento non ha già una bozza propria: le bozze generate dall'AI
--     sono la fonte migliore e non vanno scavalcate da una copia legacy.
--     `created_by` NULL identifica le righe importate: nessun utente le ha
--     scritte, e la policy che impone created_by = auth.uid() vale solo per gli
--     insert fatti dal client.
insert into public.document_replies
  (document_id, company_id, analysis_id, created_by, language, tone, content, provider, model, prompt_version, is_edited)
select distinct on (a.document_id)
  a.document_id,
  a.company_id,
  a.id,
  null,
  coalesce(nullif(a.reply_language, ''), nullif(a.language, ''), 'it'),
  coalesce(nullif(a.reply_tone, ''), 'formale'),
  a.reply_draft,
  a.engine,                                        -- provenienza reale: il motore che l'ha prodotta
  null,
  null,
  false                                            -- non sappiamo se fu modificata a mano: non lo si afferma
from public.document_analyses a
where coalesce(a.reply_draft, '') <> ''
  and not exists (
    select 1 from public.document_replies r where r.document_id = a.document_id
  )
order by a.document_id, a.created_at desc;

-- ---------------------------------------------------------------------------
-- 6. SOLO ORA: lo snapshot diventa davvero immutabile
--
-- Restano select e insert. L'insert serve al motore locale, che analizza nel
-- browser (§60) — ma viene vincolato: engine deve essere quello deterministico
-- e i campi di provenienza AI devono restare vuoti. Un membro non può quindi
-- creare una riga che, riletta, sembrerebbe prodotta dal modello.
--
-- ⚠️ PREREQUISITO: la Edge Function `analyze-document` va RIDEPLOYATA insieme a
-- questa migrazione. Fino alla 0009 persisteva l'analisi usando il JWT
-- dell'utente (chiave anon), quindi come ruolo `authenticated`: con queste
-- restrizioni fallirebbe. La versione aggiornata usa un secondo client con
-- service role per le sole scritture, mantenendo il client utente per le letture
-- di autorizzazione, così il controllo cross-tenant (§49) resta dov'era.
--   npx supabase functions deploy analyze-document --project-ref <ref>
-- ---------------------------------------------------------------------------
drop policy if exists analyses_update_member on public.document_analyses;
drop policy if exists analyses_delete_member on public.document_analyses;
revoke update, delete on public.document_analyses from authenticated;

drop policy if exists analyses_insert_member on public.document_analyses;
create policy analyses_insert_member on public.document_analyses
  for insert to authenticated
  with check (
    public.is_company_member(company_id)
    and engine like 'deterministic-%'              -- niente righe che si spacciano per AI
    and provider is null
    and model is null
    and prompt_version is null
  );

comment on policy analyses_insert_member on public.document_analyses is
  'Il client può inserire solo analisi del motore locale, senza campi di provenienza AI. Le analisi AI le scrive la Edge Function con service role.';
comment on table public.document_analyses is
  'Snapshot immutabile dell''analisi. Dalla 0010 il client ha solo select e insert vincolato: niente update, niente delete. Lo stato dell''utente sta in action_progress e document_replies.';

-- ---------------------------------------------------------------------------
-- 7. document_extractions — sola lettura per il client
--
-- Il testo estratto lo scrive la pipeline (supabase/functions/_shared/persist.ts),
-- che dalla versione rideployata insieme a questa migrazione usa il service role;
-- il client fa solo select (documentService.getExtraction).
-- I permessi di insert/update/delete concessi dalla 0006 non sono mai serviti al
-- browser — li usava solo la Edge Function, che ora scrive con service role — e
-- permettevano di riscrivere il testo su cui le citazioni vengono verificate:
-- alterandolo si potrebbe far "verificare" una citazione che il documento non
-- contiene, che è il contrario della garanzia §20.
-- ---------------------------------------------------------------------------
drop policy if exists extractions_insert_member on public.document_extractions;
drop policy if exists extractions_update_member on public.document_extractions;
drop policy if exists extractions_delete_member on public.document_extractions;
revoke insert, update, delete on public.document_extractions from authenticated;

comment on table public.document_extractions is
  'Testo estratto, base della verifica delle citazioni (§20). Scritta solo dalla pipeline con service role; dalla 0010 il client ha la sola select.';
