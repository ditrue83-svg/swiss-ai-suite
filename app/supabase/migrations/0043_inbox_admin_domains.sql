-- ============================================================================
-- AI-Swisse — 0043 LA POSTA È DEL CLIENTE: chi entra, e chi decide «Da gestire»
--
-- ⚠️ CHE COSA CHIUDE, misurato sulla casella reale il 2026-08-23 (148 messaggi,
-- una sola casella `@gmail.com` personale):
--
--   · 22 messaggi stavano in «Da gestire». Venivano da `stripe.com` (15) e
--     `mail.anthropic.com` (7): 22 su 22 da domini fornitore, ZERO da un
--     dominio amministrativo. «Da gestire» non descriveva il lavoro
--     dell'azienda, descriveva le fatture del titolare;
--   · 130 messaggi su 148 non hanno mai prodotto niente, e non lo produrranno:
--     sono newsletter, spedizioni, promozioni. Finché la casella porta quel
--     rumore, la scelta manuale non è selezione — è lavoro di scarto.
--
-- LE DUE DECISIONI, che questa migrazione rende regole del database:
--
--   A1  Entra in `email_messages` solo chi proviene da un dominio dichiarato
--       amministrativo. L'elenco è una TABELLA — si interroga, si corregge
--       aggiungendo una riga, e si può mostrare a un revisore. Non è
--       un'inferenza sul testo, non è un punteggio, non è una soglia.
--
--   A2  Nessun messaggio finisce in «Da gestire» per mano del classificatore.
--       Lo stato di attenzione lo decide una persona. `likely_actionable`
--       porta a `to_verify`: «qualcuno deve guardarla», che è la verità —
--       non «l'azienda deve occuparsene», che il classificatore non sa.
--
-- ⚠️⚠️ IL FILTRO NON PUÒ ESSERE MUTO, e questa è la parte che costa. Un
-- messaggio scartato alla radice non lascerebbe alcuna traccia: la lettera del
-- nuovo assicuratore, mai vista, sarebbe indistinguibile da una lettera mai
-- spedita. Perciò `email_excluded_senders` tiene il DOMINIO e un contatore —
-- mai l'oggetto, mai il mittente per esteso, mai il corpo. È strettamente MENO
-- dato di quello che si conserva oggi (oggi il messaggio intero entra), ed è
-- abbastanza per rispondere a «che cosa sto perdendo?».
--
-- ⚠️ PERCHÉ NON SI TOCCA LA CASELLA REMOTA. Niente qui cancella, archivia o
-- etichetta su Gmail: un messaggio escluso resta nella casella del cliente,
-- intatto. AI-Swisse decide solo che cosa acquisisce (§2.2).
--
-- Requisiti: 0001 (helper RLS), 0013 (Inbox), 0014 (la regola del `revoke all`).
-- Idempotente: si può rieseguire senza danni.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. L'ELENCO CHIUSO
--
-- ⚠️ `company_id` NULLABILE, e i due valori dicono due cose diverse:
--     NULL          catalogo GLOBALE — vale per ogni azienda del prodotto.
--                   Ci sta solo ciò che è amministrativo per CHIUNQUE in
--                   Svizzera, e nient'altro.
--     un'azienda    la riga vale per quella sola: il suo comune, la sua banca,
--                   la sua fiduciaria, il suo assicuratore. Sono dati suoi e
--                   muoiono con lei (cascata).
--
-- ⚠️⚠️ DUE INDICI UNICI PARZIALI, NON UN `unique (company_id, domain)`: in SQL
-- due NULL non sono uguali, quindi quel vincolo NON impedirebbe affatto due
-- righe globali per lo stesso dominio. È la stessa trappola già pagata dalla
-- 0013 su `email_message_documents`, e si evita nello stesso modo.
--
-- ⚠️ `archived_at` E NON UNA `delete`: togliere un dominio dall'elenco è una
-- decisione che cambia che cosa entra, e va potuta leggere dopo. È la stessa
-- grammatica di 0016/0017 — mettere via non è cancellare.
--
-- ⚠️ `note` NON È UN ORNAMENTO. «Verificabile» significa che un revisore deve
-- poter capire PERCHÉ un dominio è in elenco senza chiederlo a chi ce l'ha
-- messo. Un catalogo di domini senza motivazioni, fra sei mesi, è un elenco di
-- stringhe che nessuno osa toccare.
-- ---------------------------------------------------------------------------
create table if not exists public.email_admin_domains (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid references public.companies (id) on delete cascade,
  domain      text not null,
  note        text,
  added_by    uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  archived_at timestamptz,

  -- ⚠️⚠️ ALMENO DUE ETICHETTE. Una riga `ch` ammetterebbe l'intera Svizzera,
  -- cioè trasformerebbe l'elenco chiuso in nessun filtro — e lo farebbe in
  -- silenzio, che è il modo peggiore. Un elenco che può contenere la propria
  -- negazione non è chiuso. La stessa regola vive in `adminDomains.ts`
  -- (`dominioUtilizzabile`): qui è il vincolo, là la seconda serratura.
  constraint email_admin_domain_shape check (
    domain = lower(domain)
    and domain !~ '\s'
    and domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
    and position('.' in domain) > 0
  )
);

create unique index if not exists uq_email_admin_domain_global
  on public.email_admin_domains (domain) where company_id is null;
create unique index if not exists uq_email_admin_domain_company
  on public.email_admin_domains (company_id, domain) where company_id is not null;
create index if not exists idx_email_admin_domain_live
  on public.email_admin_domains (company_id) where archived_at is null;

comment on table public.email_admin_domains is
  'Elenco CHIUSO dei domini ammessi in Inbox. company_id NULL = catalogo globale. Un messaggio il cui mittente non corrisponde a nessuna riga viva non viene acquisito.';
comment on column public.email_admin_domains.note is
  'Perché questo dominio è amministrativo. Obbligatorio nella pratica: un catalogo senza motivazioni non è verificabile.';

-- ---------------------------------------------------------------------------
-- 2. IL REGISTRO DEGLI ESCLUSI — perché il filtro non sia muto
--
-- ⚠️ SOLO IL DOMINIO E UN CONTATORE. Non l'oggetto, non l'indirizzo completo,
-- non il corpo, non l'identificativo del provider. È la stessa disciplina di
-- `email_sync_runs` (0013 §8): si registra abbastanza per rispondere a una
-- domanda di esercizio, e non abbastanza per leggere la posta di qualcuno.
--
-- ⚠️ E RESTA MENO DI PRIMA. Fino a oggi quei messaggi entravano INTERI —
-- oggetto, mittente, corpo, allegati. Da qui in avanti di un messaggio escluso
-- resta un dominio e un numero. Il filtro riduce i dati conservati, non li
-- aumenta.
-- ---------------------------------------------------------------------------
create table if not exists public.email_excluded_senders (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies (id) on delete cascade,
  connection_id uuid not null references public.email_connections (id) on delete cascade,
  domain        text not null,
  message_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),

  -- ⚠️ Il dominio NON leggibile del mittente si registra come stringa vuota e
  -- non si scarta: «da un indirizzo che non si è potuto leggere» è un fatto, e
  -- se diventasse frequente vorrebbe dire che la normalizzazione è rotta.
  -- Perciò qui NON c'è il vincolo di forma della tabella qui sopra.
  unique (connection_id, domain)
);
create index if not exists idx_email_excluded_company
  on public.email_excluded_senders (company_id, last_seen_at desc);

comment on table public.email_excluded_senders is
  'Che cosa il filtro dei domini ha scartato: dominio e contatore, mai contenuto. Esiste perché un''esclusione senza traccia è indistinguibile da una lettera mai spedita.';

-- ⚠️ E ANCHE NEL REGISTRO DELLE SINCRONIZZAZIONI. `email_excluded_senders` dice
-- QUALI domini vengono scartati, e cresce nel tempo; questa colonna dice quanti
-- ne ha scartati QUELLA esecuzione. Sono due domande diverse: «da chi non
-- ricevo?» e «questa sincronizzazione ha portato poco perché è arrivato poco o
-- perché il filtro ha stretto?». Senza, una casella improvvisamente muta —
-- catalogo archiviato per sbaglio, dominio che cambia — sembrerebbe soltanto
-- una casella tranquilla.
alter table public.email_sync_runs
  add column if not exists messages_excluded integer not null default 0;

comment on column public.email_sync_runs.messages_excluded is
  'Messaggi visti dal provider e NON acquisiti perché il mittente non è in email_admin_domains.';

-- ---------------------------------------------------------------------------
-- 3. Registrare un'esclusione, in modo ATOMICO
--
-- ⚠️ Una funzione e non un `upsert` dal codice: il conteggio si INCREMENTA, e
-- `supabase-js` non sa esprimere «+1» in un upsert. Farlo in due passi —
-- leggi, somma, scrivi — perderebbe conteggi appena due sincronizzazioni si
-- sovrappongono, che è precisamente quello che succede quando arriva un
-- webhook mentre la riconciliazione periodica sta girando.
--
-- `security definer` perché la chiama il service role delle Edge Function e
-- nessun ruolo applicativo deve poter scrivere in questo registro.
-- ---------------------------------------------------------------------------
create or replace function public.email_record_excluded_sender(
  p_company_id    uuid,
  p_connection_id uuid,
  p_domain        text
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.email_excluded_senders
    (company_id, connection_id, domain, message_count, first_seen_at, last_seen_at)
  values (p_company_id, p_connection_id, coalesce(lower(trim(p_domain)), ''), 1, now(), now())
  on conflict (connection_id, domain) do update
    set message_count = public.email_excluded_senders.message_count + 1,
        last_seen_at  = now();
$$;

revoke all on function public.email_record_excluded_sender(uuid, uuid, text) from public;

-- ---------------------------------------------------------------------------
-- 4. A2 — «Da gestire» non lo assegna più una macchina
--
-- ⚠️ SI SOSTITUISCE LA FUNZIONE, non si aggiunge un secondo posto in cui
-- decidere. Questa funzione è già l'unica strada per DUE percorsi — la
-- pipeline che classifica e il ripristino di un messaggio «messo via»
-- (trigger `set_email_message_handled_actor`, 0013) — e la 0013 dichiara
-- esplicitamente che le due non devono poter divergere. La copia lato server
-- (`attentionForRelevance` in `_shared/email/contract.ts`) cambia nello stesso
-- commit, e `test:inbox-unit` verifica che le due tabelle coincidano.
--
-- ⚠️ `needs_attention` RESTA NELL'ENUM, e non è un residuo: dalla PARTE B sarà
-- lo stato che una PERSONA produce promuovendo. Toglierlo ora significherebbe
-- rifarlo fra due giorni, e un `alter type ... drop value` in PostgreSQL non
-- esiste.
-- ---------------------------------------------------------------------------
create or replace function public.email_attention_for_relevance(p_rel public.email_relevance)
returns public.email_attention_status
language sql
immutable
as $$
  select case p_rel
    -- ⚠️ ERA `needs_attention`. Un classificatore può dire «questa sembra
    -- azionabile»; non può dire «la tua azienda deve occuparsene», perché non
    -- sa di chi sia il documento né se riguardi l'azienda. `to_verify` è
    -- l'affermazione vera: qualcuno deve guardarla.
    when 'likely_actionable'   then 'to_verify'
    when 'possibly_actionable' then 'to_verify'
    when 'informational'       then 'informational'
    when 'clearly_irrelevant'  then 'ignored'
    else 'to_verify'                       -- non ancora classificata: si mostra
  end::public.email_attention_status;
$$;

comment on function public.email_attention_for_relevance(public.email_relevance) is
  'Dove va un messaggio che non è stato messo via. Dal 2026-08-23 non produce mai "needs_attention": quello stato lo genera una persona, promuovendo (D-13).';

-- ---------------------------------------------------------------------------
-- 5. Le righe che il vecchio classificatore aveva già promosso
--
-- ⚠️ NON È UNA RISCRITTURA DELLA STORIA. `relevance`, `relevance_reason`,
-- `classifier_version` e `classified_at` restano intatti: che cosa il
-- classificatore avesse concluso resta leggibile per intero. Qui si corregge
-- soltanto la CONSEGUENZA che quella conclusione non era autorizzata a trarre.
--
-- ⚠️ SOLO LE RIGHE MAI TOCCATE DA UNA PERSONA (`handled_by is null`). Una
-- riga che qualcuno ha messo via e poi ripristinato porta una decisione umana,
-- e non si sovrascrive una decisione umana con una migrazione. In pratica, sui
-- dati del 2026-08-23, sono 22 righe su 22 — nessuna era stata toccata.
--
-- ⚠️ Il trigger `set_email_message_handled_actor` NON blocca questa update:
-- sta nel ramo `elsif auth.uid() is not null`, e in una migrazione
-- `auth.uid()` è NULL. Verificato leggendo la 0013, non supposto.
-- ---------------------------------------------------------------------------
update public.email_messages
   set attention_status = public.email_attention_for_relevance(relevance)
 where attention_status = 'needs_attention'
   and handled_by is null;

-- ---------------------------------------------------------------------------
-- 6. IL CATALOGO GLOBALE — deliberatamente MINIMO
--
-- ⚠️⚠️ QUI CI STA SOLO CIÒ CHE È AMMINISTRATIVO PER CHIUNQUE IN SVIZZERA, e
-- nient'altro. La tentazione è riempire questa lista di ventisei domini
-- cantonali, di banche e di assicuratori scritti a memoria: sarebbe un elenco
-- non verificato spacciato per catalogo, cioè esattamente ciò che questo
-- progetto chiama un racconto. Un dominio in più scritto a caso apre una porta
-- che nessuno ha deciso di aprire; un dominio in meno si aggiunge con una riga
-- quando serve, e il registro degli esclusi dice QUANDO serve.
--
-- Il comune, il cantone, la banca, la fiduciaria e l'assicuratore di
-- un'azienda sono suoi: vanno in righe con `company_id`, decise da chi quella
-- azienda la conosce. Non da questa migrazione.
--
-- `on conflict do nothing`: rieseguire non duplica, e non riporta in vita un
-- dominio che qualcuno avesse archiviato.
-- ---------------------------------------------------------------------------
insert into public.email_admin_domains (company_id, domain, note) values
  (null, 'admin.ch', 'Confederazione svizzera: tutti gli uffici federali sono sottodomini (estv.admin.ch, bj.admin.ch, zefix.admin.ch, …).'),
  (null, 'suva.ch',  'SUVA — assicurazione infortuni obbligatoria per ogni datore di lavoro.'),
  (null, 'ahv-iv.ch','AVS/AI — assicurazioni sociali obbligatorie.'),
  (null, 'post.ch',  'La Posta Svizzera: raccomandate, notifiche di recapito, fatturazione.')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 7. PERMESSI — prima si toglie tutto (la regola della 0014)
--
-- ⚠️ Su `public`, un grant di colonna non restringe nulla senza un `revoke
-- all` che lo preceda: Supabase concede i privilegi pieni per default a ogni
-- tabella nuova dello schema. Questa è la terza tabella del progetto a
-- ricordarselo, e il commento resta perché la quarta non se ne dimentichi.
-- ---------------------------------------------------------------------------
revoke all on public.email_admin_domains   from anon, authenticated, public;
revoke all on public.email_excluded_senders from anon, authenticated, public;

alter table public.email_admin_domains    enable row level security;
alter table public.email_excluded_senders enable row level security;

-- LETTURA — un membro vede il catalogo globale e le righe della sua azienda.
-- Il catalogo globale è leggibile da chiunque sia autenticato: è la regola in
-- base alla quale la sua posta viene filtrata, e una regola che decide che cosa
-- si vede non può essere segreta per chi la subisce.
grant select on public.email_admin_domains to authenticated;
grant select on public.email_excluded_senders to authenticated;

drop policy if exists email_admin_domains_read on public.email_admin_domains;
create policy email_admin_domains_read on public.email_admin_domains
  for select to authenticated
  using (company_id is null or public.is_company_member(company_id));

-- SCRITTURA — solo owner/admin, e solo sulle righe della PROPRIA azienda.
-- ⚠️ Il catalogo globale NON è scrivibile da nessun ruolo applicativo: cambia
-- il comportamento del prodotto per tutti i clienti, quindi si cambia con una
-- migrazione, che è un fatto tracciato e revisionato.
grant insert (company_id, domain, note, added_by), update (note, archived_at)
  on public.email_admin_domains to authenticated;

drop policy if exists email_admin_domains_write on public.email_admin_domains;
create policy email_admin_domains_write on public.email_admin_domains
  for insert to authenticated
  with check (company_id is not null and public.is_company_admin(company_id));

drop policy if exists email_admin_domains_edit on public.email_admin_domains;
create policy email_admin_domains_edit on public.email_admin_domains
  for update to authenticated
  using (company_id is not null and public.is_company_admin(company_id))
  with check (company_id is not null and public.is_company_admin(company_id));

-- REGISTRO DEGLI ESCLUSI — sola lettura, e solo per chi amministra l'azienda:
-- dice quali domini scrivono alla casella, ed è un'informazione della casella.
drop policy if exists email_excluded_senders_read on public.email_excluded_senders;
create policy email_excluded_senders_read on public.email_excluded_senders
  for select to authenticated
  using (public.is_company_admin(company_id));
