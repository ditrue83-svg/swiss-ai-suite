-- ============================================================================
-- AI-Swisse — 0047 CAMPI PERSONALIZZATI DEL CRM (Fase 0.4)
--
-- Fino a qui il CRM sapeva rispondere a «con chi stiamo lavorando?» solo con i
-- campi decisi dalla 0026: identificativi, indirizzo, recapiti, ruoli, note.
-- Ogni azienda però tiene la propria contabilità di relazione — il numero
-- cliente nel gestionale precedente, la data del prossimo rinnovo, la fascia
-- di fatturato — e un elenco di colonne fissato dal fornitore non la copre.
-- Questa migrazione aggiunge i campi personalizzati: definizioni decise
-- DALL'AZIENDA (non dal tenant, non dal codice), valori su organizzazioni e
-- opportunità, tipo controllato dal database.
--
-- IL MODELLO, in tre affermazioni:
--
-- 1. LA DEFINIZIONE È DELL'AZIENDA. `crm_field_definitions` porta `company_id`
--    come ogni altra tabella del modulo: i campi di un'azienda non esistono
--    per un'altra, né in lettura né in scrittura.
--
-- 2. UN VALORE È UNA RIGA, E IL TIPO È UN FATTO DEL DATABASE. Niente colonna
--    `value jsonb` da interpretare a schermo: `value_text`, `value_number` e
--    `value_date` sono tre colonne e il guardiano pretende che sia piena
--    ESATTAMENTE quella del tipo dichiarato dalla definizione. Un numero che
--    non si può sommare, una data che non si può ordinare, un'opzione che la
--    lista non contiene: non entrano. Chi tenta riceve un rifiuto esplicito
--    (23514 con sentinella), non un dato plausibile.
--
-- 3. I CAMPI PERSONALIZZATI SONO ATTRIBUTI, NON IDENTITÀ. Non entrano nella
--    deduplicazione (`crm_duplicate_candidates`), non entrano nell'abbinamento
--    (`crm_match_email`, `crm_scan_link_suggestions`), non entrano nella
--    normalizzazione. Un «numero cliente» identico su due schede NON le rende
--    doppioni: l'identità restano l'IDI e l'email, come da §25 del modello.
--    Questo file non tocca quelle funzioni proprio per questo, e
--    `docs/crm-light.md` lo dichiara.
--
-- CHE COSA NON FA, per scelta:
--   · nessuna cancellazione dura delle definizioni: si archiviano
--     (`archived_at`), come ogni anagrafica del modulo (§123/§125). I valori
--     di un campo archiviato restano nel database e tornano visibili se il
--     campo viene ripristinato;
--   · l'obbligatorietà (`is_required`) è una promessa della SCHERMATA, non un
--     vincolo del database: il database non può pretendere una riga che non
--     esiste su un'entità che nasce senza valori, e un vincolo del genere
--     impedirebbe di creare un'organizzazione finché il campo non è compilato.
--     Ciò che il database garantisce è che nessun valore salvato sia vuoto o
--     del tipo sbagliato — il resto lo dichiara la documentazione;
--   · nessuno storico in `crm_events`: un campo personalizzato è un attributo
--     corrente, non un passaggio di relazione. Se un giorno servirà, sarà una
--     migrazione a sé.
--
-- ⚠️ I DUE ENUM SONO CREATI QUI, non estesi: i valori dichiarati alla
-- creazione sono utilizzabili subito, anche nella stessa transazione (è la
-- differenza con `alter type … add value`, che renderebbe l'etichetta
-- inservibile fino al commit — 55P04, lezione della 0015, della 0022 e della
-- 0046). L'autoverifica in coda può quindi nominarli, e lo fa.
--
-- Requisiti: 0026 (il modulo, le guardie, `is_company_member`,
-- `is_company_admin`, la fusione). Idempotente dove il linguaggio lo consente.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. I TIPI
-- ---------------------------------------------------------------------------

-- Su quale entità il campo è definito. Due sole: persone e contatti restano
-- fuori per scelta (Fase 0.4: organizzazioni e opportunità, nient'altro).
do $$ begin
  create type public.crm_field_entity as enum ('organization', 'opportunity');
exception when duplicate_object then null; end $$;

-- Il tipo del valore. Quattro e non cinque: niente «sì/no» (è una lista a due
-- opzioni), niente «collegamento» (un URL è testo, e la scheda decide se
-- mostrarlo come link), niente multi-selezione (un elenco di righe per valore
-- è un modello che questa fase non apre).
do $$ begin
  create type public.crm_field_type as enum ('text', 'number', 'date', 'select');
exception when duplicate_object then null; end $$;


-- ---------------------------------------------------------------------------
-- 2. crm_field_definitions — I CAMPI DECISI DALL'AZIENDA
--
-- Una riga per campo: «Fascia di fatturato, lista, obbligatorio, terzo».
-- Il NOME è l'etichetta mostrata; i valori puntano all'`id`, quindi rinominare
-- un campo non stacca niente. `position` decide l'ordine di comparsa fra i
-- campi nativi e non ha bisogno di essere unico: i pareggi si sciolgono in
-- lettura (position, created_at, id) e lo spostamento li riscrive a coppie.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_field_definitions (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  entity      public.crm_field_entity not null,
  name        text not null,
  field_type  public.crm_field_type not null,
  -- Le opzioni della lista, array jsonb di stringhe. NULL per gli altri tipi:
  -- il legame fra tipo e presenza è il vincolo sotto, la FORMA (stringhe non
  -- vuote, nessun doppione) la pretende il guardiano — un check su jsonb la
  -- scriverebbe in una sola riga illeggibile e con un messaggio muto.
  options     jsonb,
  is_required boolean not null default false,
  position    integer not null default 0,

  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,

  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint crm_field_def_name_not_blank check (btrim(name) <> ''),
  -- Le opzioni esistono SE E SOLO SE il tipo è una lista. Il guardiano arriva
  -- prima e dà il messaggio leggibile; questo è il secondo argine.
  constraint crm_field_def_options_belong_to_select
    check ((field_type = 'select') = (options is not null))
);

comment on table public.crm_field_definitions is
  'I campi personalizzati decisi dall''azienda (0047): nome, tipo, opzioni, '
  'obbligatorietà, ordine. Attributi, non identità: non entrano in '
  'deduplicazione né abbinamento. Si archiviano, non si cancellano.';


-- ---------------------------------------------------------------------------
-- 3. crm_field_values — I VALORI, UNO PER RIGA
--
-- ⚠️ TRE COLONNE TIPATE, NON UN JSONB. Un `value jsonb` rimanderebbe il
-- controllo del tipo alla schermata, e ciò che controlla solo la schermata non
-- è controllato: basta un client diverso per scrivere «abc» nel campo
-- «dipendenti». Qui il database rifiuta il tipo sbagliato, e il rifiuto è lo
-- stesso per il browser, per uno script e per il service role.
--
-- ⚠️ LA RIGA ESISTE SOLO SE PORTA UN VALORE. Svuotare un campo CANCELLA la
-- riga: un valore vuoto salvato («  ») e l'assenza del valore direbbero la
-- stessa cosa in due modi, e le due forme finirebbero per divergere.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_field_values (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  field_id        uuid not null references public.crm_field_definitions(id) on delete cascade,

  -- L'entità a cui il valore appartiene: ESATTAMENTE una delle due. Quale sia
  -- quella giusta lo decide la definizione, e il guardiano la confronta.
  organization_id uuid references public.crm_organizations(id) on delete cascade,
  opportunity_id  uuid references public.crm_opportunities(id) on delete cascade,

  value_text      text,
  value_number    numeric,
  value_date      date,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint crm_field_values_one_entity
    check (num_nonnulls(organization_id, opportunity_id) = 1),
  constraint crm_field_values_one_value
    check (num_nonnulls(value_text, value_number, value_date) = 1)
);

comment on table public.crm_field_values is
  'Un valore di un campo personalizzato su una controparte o una trattativa '
  '(0047). La riga esiste solo se porta un valore: svuotare il campo la '
  'cancella. Il tipo lo pretende il guardiano, non la schermata.';


-- ---------------------------------------------------------------------------
-- 4. GLI INDICI
-- ---------------------------------------------------------------------------

-- La schermata delle impostazioni e la scheda dell'entità leggono le
-- definizioni attive di un'azienda, in ordine di comparsa.
create index if not exists idx_crm_field_defs_company
  on public.crm_field_definitions (company_id, entity, position)
  where archived_at is null;

-- ⚠️ Il nome è unico per azienda ed entità FRA I CAMPI ATTIVI: due «Cliente
-- dal» sulla stessa scheda sarebbero indistinguibili a schermo. Archiviato il
-- nome si libera, e un campo nuovo può prenderlo senza ambiguità.
create unique index if not exists uq_crm_field_def_name
  on public.crm_field_definitions (company_id, entity, lower(name))
  where archived_at is null;

-- Un valore per campo ed entità: la seconda riga sullo stesso campo sarebbe
-- una doppia risposta alla stessa domanda. Parziali, come ogni indice di
-- questo modulo che vale solo per metà delle righe.
create unique index if not exists uq_crm_field_values_org
  on public.crm_field_values (field_id, organization_id)
  where organization_id is not null;
create unique index if not exists uq_crm_field_values_opp
  on public.crm_field_values (field_id, opportunity_id)
  where opportunity_id is not null;

create index if not exists idx_crm_field_values_org
  on public.crm_field_values (organization_id) where organization_id is not null;
create index if not exists idx_crm_field_values_opp
  on public.crm_field_values (opportunity_id) where opportunity_id is not null;
create index if not exists idx_crm_field_values_field
  on public.crm_field_values (field_id);


-- ---------------------------------------------------------------------------
-- 5. LA CONVALIDA PURA
--
-- Due funzioni `immutable` che rispondono con la SENTINELLA dell'errore o con
-- NULL: il guardiano le chiama e solleva ciò che ricevono. Stanno fuori dal
-- guardiano per lo stesso motivo per cui la cifra di controllo dell'IDI sta
-- fuori dal suo: ciò che si può sbagliare in silenzio deve poter essere
-- provato senza scrivere una riga — e infatti l'autoverifica in coda le prova
-- sul RISULTATO, non sulla sintassi.
-- ---------------------------------------------------------------------------

-- Le opzioni di una lista, normalizzate: btrim a ogni voce, ordine conservato.
-- Si chiama solo dopo aver verificato che la forma sia un array.
create or replace function public.crm_field_options_norm(p_options jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_agg(btrim(e) order by o), '[]'::jsonb)
    from jsonb_array_elements_text(p_options) with ordinality as u(e, o);
$$;

-- NULL se le opzioni sono valide per il tipo, altrimenti il sentinella.
create or replace function public.crm_field_options_problem(
  p_type    public.crm_field_type,
  p_options jsonb
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_len integer;
begin
  if p_type <> 'select' then
    -- Le opzioni non appartengono agli altri tipi: il guardiano le azzera, e
    -- arrivare qui con un valore sarebbe già il sintomo di un chiamante
    -- diverso.
    return case when p_options is null then null else 'crm_field_options_invalid' end;
  end if;
  if p_options is null or jsonb_typeof(p_options) <> 'array' then
    return 'crm_field_options_invalid';
  end if;
  select count(*) into v_len from jsonb_array_elements(p_options);
  if v_len = 0 or v_len > 200 then
    return 'crm_field_options_invalid';
  end if;
  -- Ogni voce è una stringa non vuota…
  if exists (select 1 from jsonb_array_elements(p_options) e
              where jsonb_typeof(e) <> 'string' or btrim(e #>> '{}') = '') then
    return 'crm_field_options_invalid';
  end if;
  -- …e non ce n'è due volte la stessa: due voci uguali renderebbero il valore
  -- salvato ambiguo a schermo («Altro» e «Altro» sono una scelta sola).
  if (select count(distinct e) from jsonb_array_elements_text(p_options) e) <> v_len then
    return 'crm_field_options_duplicate';
  end if;
  return null;
end $$;

-- NULL se il valore è quello del tipo, altrimenti il sentinella. Le colonne
-- che non c'entrano devono essere NULL — non «ignorate»: un numero scritto
-- nella colonna di un campo testo è un dato che qualcuno leggerebbe sbagliato.
create or replace function public.crm_field_value_problem(
  p_type    public.crm_field_type,
  p_options jsonb,
  p_text    text,
  p_number  numeric,
  p_date    date
)
returns text
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_type = 'text' or p_type = 'select' then
    if p_number is not null or p_date is not null then
      return 'crm_field_type_mismatch';
    end if;
    if p_text is null or btrim(p_text) = '' then
      return 'crm_field_value_empty';
    end if;
    -- La lista accetta solo ciò che elenca: un'opzione scritta a mano fuori
    -- dall'elenco renderebbe il filtro futuro una bugia.
    if p_type = 'select'
       and (p_options is null or jsonb_typeof(p_options) <> 'array'
            or not exists (select 1 from jsonb_array_elements_text(p_options) o
                            where o = p_text)) then
      return 'crm_field_option_not_allowed';
    end if;
    return null;
  end if;
  if p_type = 'number' then
    if p_text is not null or p_date is not null then
      return 'crm_field_type_mismatch';
    end if;
    if p_number is null then
      return 'crm_field_value_empty';
    end if;
    return null;
  end if;
  -- date
  if p_text is not null or p_number is not null then
    return 'crm_field_type_mismatch';
  end if;
  if p_date is null then
    return 'crm_field_value_empty';
  end if;
  return null;
end $$;

comment on function public.crm_field_value_problem(public.crm_field_type, jsonb, text, numeric, date) is
  'NULL se il valore è quello dichiarato dal tipo, altrimenti il sentinella '
  'dell''errore (0047). Pura e immutable: il guardiano la chiama, '
  'l''autoverifica la prova sul risultato.';


-- ---------------------------------------------------------------------------
-- 6. I GUARDIANI
--
-- Stessa disciplina della sezione 16 della 0026: `security definer`, sentinella
-- con `errcode 23514`, tre `company_id` a confronto su ogni valore. La sola RLS
-- lascerebbe passare chi dichiara la propria azienda e aggancia un'entità
-- altrui; il trigger si difende da sé, senza contare su una policy scritta
-- altrove — e `test:crm` lo prova anche con il service role.
-- ---------------------------------------------------------------------------

create or replace function public.crm_field_definitions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_problem text;
begin
  new.name := btrim(new.name);

  -- Le opzioni si normalizzano PRIMA di misurarle: «Verde » e «Verde» sono la
  -- stessa voce, e contarle due volte renderebbe il doppione un falso allarme.
  if new.field_type = 'select' then
    if new.options is null or jsonb_typeof(new.options) <> 'array' then
      raise exception 'crm_field_options_invalid'
        using errcode = '23514',
              hint = 'Un campo a lista richiede le opzioni: un elenco di voci.';
    end if;
    new.options := public.crm_field_options_norm(new.options);
  else
    new.options := null;
  end if;

  v_problem := public.crm_field_options_problem(new.field_type, new.options);
  if v_problem is not null then
    raise exception '%', v_problem
      using errcode = '23514',
            hint = 'Le opzioni devono essere voci di testo, non vuote, senza doppioni.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := now();
    new.updated_at := now();
    new.archived_at := null;   -- un campo nasce attivo: archiviarlo è un gesto
    new.archived_by := null;
    return new;
  end if;

  -- UPDATE — ciò che non cambia mai. Il TIPO e l'ENTITÀ sono congelati alla
  -- nascita: cambiare «numero» in «testo» con i valori già scritti renderebbe
  -- quelle righe false, e spostare un campo dalle organizzazioni alle
  -- opportunità lo staccerebbe dai suoi valori. Un campo diverso è un campo
  -- nuovo. (I grant già non concedono l'update di quelle colonne: questo è il
  -- secondo argine, perché una difesa che vale in un posto solo si dimentica.)
  new.company_id := old.company_id;
  new.entity     := old.entity;
  new.field_type := old.field_type;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  new.updated_at := now();

  -- Archiviare e ripristinare, con il timbro scritto dal database (§124).
  if new.archived_at is not null and old.archived_at is null then
    new.archived_at := now();
    new.archived_by := auth.uid();
  elsif new.archived_at is null then
    new.archived_by := null;
  else
    new.archived_at := old.archived_at;
    new.archived_by := old.archived_by;
  end if;

  return new;
end $$;

drop trigger if exists trg_crm_field_definitions_guard on public.crm_field_definitions;
create trigger trg_crm_field_definitions_guard
  before insert or update on public.crm_field_definitions
  for each row execute function public.crm_field_definitions_guard();


create or replace function public.crm_field_values_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_def            public.crm_field_definitions%rowtype;
  v_entity_company uuid;
  v_problem        text;
  v_internal       boolean;
begin
  -- Il sentinella interno della fusione: sposta i valori sul record principale
  -- e solo quello può riscrivere il collegamento (è la disciplina di
  -- `ai_swisse.crm_internal` su `last_contact_at`, stessa migrazione madre).
  v_internal := coalesce(current_setting('ai_swisse.crm_internal', true), '') = 'on';

  if tg_op = 'INSERT' then
    new.created_at := now();
    new.updated_at := now();
  else
    -- L'appartenenza non si riscrive: un valore che cambiasse campo o entità
    -- sarebbe un altro valore, con un'altra storia.
    if not v_internal then
      new.company_id      := old.company_id;
      new.field_id        := old.field_id;
      new.organization_id := old.organization_id;
      new.opportunity_id  := old.opportunity_id;
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;

  select * into v_def from public.crm_field_definitions d where d.id = new.field_id;
  if not found then
    raise exception 'crm_field_unknown'
      using errcode = '23514', hint = 'Il campo a cui si scrive non esiste.';
  end if;

  -- TRE company_id a confronto: quello dichiarato dalla riga, quello della
  -- definizione, quello dell'entità collegata. Uno solo diverso basta.
  if v_def.company_id is distinct from new.company_id then
    raise exception 'crm_field_value_company_mismatch'
      using errcode = '23514',
            hint = 'Il campo appartiene a un''altra azienda.';
  end if;

  -- UNA entità sola, e del tipo che la definizione dichiara: un campo nato
  -- per le organizzazioni non accetta una trattativa. (Il check
  -- `crm_field_values_one_entity` farebbe lo stesso lavoro DOPO di qui, con un
  -- messaggio muto: il guardiano arriva prima e dice perché.)
  if num_nonnulls(new.organization_id, new.opportunity_id) <> 1
     or (v_def.entity = 'organization') <> (new.organization_id is not null) then
    raise exception 'crm_field_entity_mismatch'
      using errcode = '23514',
            hint = 'Il campo non è definito per questo tipo di scheda.';
  end if;

  if new.organization_id is not null then
    select o.company_id into v_entity_company
      from public.crm_organizations o where o.id = new.organization_id;
  else
    select o.company_id into v_entity_company
      from public.crm_opportunities o where o.id = new.opportunity_id;
  end if;
  if v_entity_company is null or v_entity_company is distinct from new.company_id then
    raise exception 'crm_field_value_company_mismatch'
      using errcode = '23514',
            hint = 'La scheda a cui si scrive appartiene a un''altra azienda.';
  end if;

  -- Un campo archiviato è CONGELATO: i valori esistenti restano leggibili e si
  -- possono cancellare, ma nessuno se ne aggiunge e nessuno si riscrive. La
  -- fusione è l'unica eccezione: sposta la storia, non la riscrive.
  if v_def.archived_at is not null and not v_internal then
    raise exception 'crm_field_archived'
      using errcode = '23514',
            hint = 'Il campo è archiviato: i suoi valori non si modificano.';
  end if;

  -- Normalizza prima di misurare: «  » non è un valore, è l'assenza di un
  -- valore, e l'assenza è una riga cancellata.
  if v_def.field_type = 'text' or v_def.field_type = 'select' then
    new.value_text := nullif(btrim(coalesce(new.value_text, '')), '');
  end if;

  v_problem := public.crm_field_value_problem(
    v_def.field_type, v_def.options, new.value_text, new.value_number, new.value_date);
  if v_problem is not null then
    raise exception '%', v_problem
      using errcode = '23514',
            hint = 'Il valore non è quello che il campo dichiara.';
  end if;

  return new;
end $$;

drop trigger if exists trg_crm_field_values_guard on public.crm_field_values;
create trigger trg_crm_field_values_guard
  before insert or update on public.crm_field_values
  for each row execute function public.crm_field_values_guard();


-- ---------------------------------------------------------------------------
-- 7. LA FUSIONE IMPARA I CAMPI PERSONALIZZATI
--
-- `crm_merge_organizations` (0026, sezione 22) trasferisce ruoli, persone,
-- recapiti, opportunità, interazioni, collegamenti e storico sul record
-- principale. Da oggi anche i VALORI dei campi personalizzati: una fusione che
-- li lasciasse sul secondario li seppellirebbe dentro una scheda archiviata.
-- Dove il principale ha già un valore per lo stesso campo vince il principale,
-- come per i ruoli e i recapiti; il resto sparisce con il secondario.
--
-- ⚠️ IL CORPO È QUELLO DELLA 0026, VERBATIM, con un solo blocco in più — la
-- funzione si riscrive intera perché `create or replace` non conosce le patch.
-- ---------------------------------------------------------------------------
create or replace function public.crm_merge_organizations(
  p_target_id uuid,
  p_source_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_company uuid;
  v_source_company uuid;
begin
  if p_target_id = p_source_id then
    raise exception 'crm_merge_into_self'
      using errcode = '23514', hint = 'Un''organizzazione non si fonde con sé stessa.';
  end if;

  select o.company_id into v_company from public.crm_organizations o where o.id = p_target_id;
  select o.company_id into v_source_company from public.crm_organizations o where o.id = p_source_id;

  if v_company is null or v_source_company is null or v_company is distinct from v_source_company then
    raise exception 'crm_merge_company_mismatch'
      using errcode = '23514',
            hint = 'Le due organizzazioni devono appartenere alla stessa azienda.';
  end if;

  -- §118 — la fusione è irreversibile nei fatti: la decide chi amministra.
  if not public.is_company_admin(v_company) then
    raise exception 'crm_merge_not_admin'
      using errcode = '42501',
            hint = 'Solo un amministratore dell''azienda può unire due anagrafiche.';
  end if;

  perform set_config('ai_swisse.crm_internal', 'on', true);

  -- I ruoli: si sommano, senza duplicarsi.
  insert into public.crm_organization_roles (company_id, organization_id, role, created_by)
  select v_company, p_target_id, r.role, r.created_by
    from public.crm_organization_roles r where r.organization_id = p_source_id
  on conflict (organization_id, role) do nothing;
  delete from public.crm_organization_roles where organization_id = p_source_id;

  -- Le persone: chi lavorava per il secondario lavora per il principale.
  update public.crm_contact_organizations co
     set organization_id = p_target_id
   where co.organization_id = p_source_id
     and not exists (
       select 1 from public.crm_contact_organizations t
        where t.organization_id = p_target_id
          and t.contact_id = co.contact_id
          and t.active_from is not distinct from co.active_from);
  delete from public.crm_contact_organizations where organization_id = p_source_id;

  -- I recapiti: quelli già presenti sul principale non si ripetono.
  delete from public.crm_contact_methods m
   where m.organization_id = p_source_id
     and exists (select 1 from public.crm_contact_methods t
                  where t.organization_id = p_target_id
                    and t.type = m.type
                    and t.normalized_value is not distinct from m.normalized_value);
  update public.crm_contact_methods
     set organization_id = p_target_id, is_primary = false
   where organization_id = p_source_id;

  update public.crm_opportunities set organization_id = p_target_id where organization_id = p_source_id;
  update public.crm_interactions   set organization_id = p_target_id where organization_id = p_source_id;

  -- 0047 — i campi personalizzati: passano al principale, e dove il principale
  -- ha già un valore per lo stesso campo vince il principale (è la semantica
  -- dei recapiti qui sopra). Il guardiano lascia riscrivere il collegamento
  -- perché il sentinella `ai_swisse.crm_internal` è acceso, e accetta anche i
  -- campi archiviati: la fusione sposta la storia, non la riscrive.
  update public.crm_field_values v
     set organization_id = p_target_id
   where v.organization_id = p_source_id
     and not exists (select 1 from public.crm_field_values t
                      where t.field_id = v.field_id
                        and t.organization_id = p_target_id);
  delete from public.crm_field_values where organization_id = p_source_id;

  update public.crm_organization_documents k
     set organization_id = p_target_id
   where k.organization_id = p_source_id
     and not exists (select 1 from public.crm_organization_documents t
                      where t.organization_id = p_target_id and t.document_id = k.document_id);
  delete from public.crm_organization_documents where organization_id = p_source_id;

  update public.crm_organization_emails k
     set organization_id = p_target_id
   where k.organization_id = p_source_id
     and not exists (select 1 from public.crm_organization_emails t
                      where t.organization_id = p_target_id
                        and t.email_message_id = k.email_message_id);
  delete from public.crm_organization_emails where organization_id = p_source_id;

  -- I collegamenti sugli altri moduli.
  update public.tasks set crm_organization_id = p_target_id where crm_organization_id = p_source_id;
  update public.contracts set counterparty_organization_id = p_target_id
   where counterparty_organization_id = p_source_id;
  update public.finance_items set supplier_organization_id = p_target_id
   where supplier_organization_id = p_source_id;

  -- Lo storico si conserva e si sposta: la storia della relazione è una sola,
  -- anche se per un po' è stata scritta su due schede.
  update public.crm_events set organization_id = p_target_id where organization_id = p_source_id;

  update public.crm_organizations
     set archived_at = now(),
         archived_by = auth.uid(),
         merged_into_id = p_target_id,
         relationship_status = 'inactive'
   where id = p_source_id;

  perform set_config('ai_swisse.crm_internal', '', true);

  perform public.crm_refresh_last_contact(p_target_id);

  insert into public.crm_events (company_id, organization_id, kind, detail, actor_user_id)
  values (v_company, p_target_id, 'merged',
          jsonb_build_object('from', p_source_id), auth.uid());
end $$;

comment on function public.crm_merge_organizations(uuid, uuid) is
  'Unisce due anagrafiche: ruoli, persone, recapiti, opportunità, interazioni, '
  'collegamenti, storico e (dal 0047) i valori dei campi personalizzati '
  'passano al principale; il secondario resta archiviato con merged_into_id '
  '(§31). Solo amministratori. Nessuna fusione automatica.';


-- ---------------------------------------------------------------------------
-- 8. RLS
--
-- §112-§117, la stessa condizione del resto del modulo. Con due distinzioni
-- dichiarate:
--   · LE DEFINIZIONI LE SCRIVE CHI AMMINISTRA. Cambiano la forma dei dati di
--     tutta l'azienda, come la fusione (§118): `is_company_admin`. Un membro
--     le legge — deve poter vedere che cosa la scheda gli chiede — ma non le
--     cambia, e la schermata glielo dice invece di offrirgli campi che al
--     salvataggio verrebbero rifiutati;
--   · I VALORI li scrive OGNI MEMBRO, come ogni altro dato del CRM: il modulo
--     non ha permessi granulari per scelta, e i campi personalizzati non
--     inventano un'eccezione.
-- Nessuna policy di DELETE sulle definizioni: si archiviano.
-- ---------------------------------------------------------------------------
alter table public.crm_field_definitions enable row level security;
alter table public.crm_field_values      enable row level security;

drop policy if exists crm_field_defs_select on public.crm_field_definitions;
create policy crm_field_defs_select on public.crm_field_definitions
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_field_defs_insert on public.crm_field_definitions;
create policy crm_field_defs_insert on public.crm_field_definitions
  for insert to authenticated with check (public.is_company_admin(company_id));
drop policy if exists crm_field_defs_update on public.crm_field_definitions;
create policy crm_field_defs_update on public.crm_field_definitions
  for update to authenticated
  using (public.is_company_admin(company_id))
  with check (public.is_company_admin(company_id));

drop policy if exists crm_field_values_select on public.crm_field_values;
create policy crm_field_values_select on public.crm_field_values
  for select to authenticated using (public.is_company_member(company_id));
drop policy if exists crm_field_values_insert on public.crm_field_values;
create policy crm_field_values_insert on public.crm_field_values
  for insert to authenticated with check (public.is_company_member(company_id));
drop policy if exists crm_field_values_update on public.crm_field_values;
create policy crm_field_values_update on public.crm_field_values
  for update to authenticated
  using (public.is_company_member(company_id))
  with check (public.is_company_member(company_id));
drop policy if exists crm_field_values_delete on public.crm_field_values;
create policy crm_field_values_delete on public.crm_field_values
  for delete to authenticated using (public.is_company_member(company_id));


-- ---------------------------------------------------------------------------
-- 9. I PERMESSI
--
-- ⚠️⚠️ `REVOKE ALL` PRIMA DI OGNI GRANT, come ovunque dal 0014 in poi: su
-- `public` ogni tabella nuova nasce con i privilegi di TABELLA completi, e un
-- grant di colonna scritto dopo AGGIUNGE privilegi invece di toglierli.
--
-- Le colonne timbrate dal database NON compaiono in nessun grant: created_by,
-- created_at, updated_at, archived_by. E nelle definizioni non sono concessi
-- in update nemmeno entity e field_type — congelati alla nascita (guardiano,
-- sezione 6) — né in insert archived_at: un campo nasce attivo.
-- ---------------------------------------------------------------------------
revoke all on public.crm_field_definitions from anon, authenticated, public;
revoke all on public.crm_field_values      from anon, authenticated, public;

grant select on public.crm_field_definitions to authenticated;
grant insert (company_id, entity, name, field_type, options, is_required, position)
  on public.crm_field_definitions to authenticated;
grant update (name, options, is_required, position, archived_at)
  on public.crm_field_definitions to authenticated;

grant select on public.crm_field_values to authenticated;
grant insert (company_id, field_id, organization_id, opportunity_id,
              value_text, value_number, value_date)
  on public.crm_field_values to authenticated;
grant update (value_text, value_number, value_date)
  on public.crm_field_values to authenticated;
grant delete on public.crm_field_values to authenticated;

-- La fusione si richiama dal browser: il revoke/grant va rifatto, perché
-- `create or replace` conserva i permessi MA la dichiarazione qui è ciò che
-- l'autoverifica legge.
revoke all on function public.crm_merge_organizations(uuid, uuid) from public, anon;
grant execute on function public.crm_merge_organizations(uuid, uuid) to authenticated;

-- Le funzioni di convalida NON sono concesse al client: le chiamano i
-- guardiani, che sono `security definer` e non hanno bisogno del permesso del
-- chiamante. Come `crm_refresh_last_contact`: nessun uso dal browser, nessun
-- grant.
revoke all on function public.crm_field_options_norm(jsonb) from public, anon, authenticated;
revoke all on function public.crm_field_options_problem(public.crm_field_type, jsonb) from public, anon, authenticated;
revoke all on function public.crm_field_value_problem(public.crm_field_type, jsonb, text, numeric, date) from public, anon, authenticated;


-- ---------------------------------------------------------------------------
-- 10. AUTOVERIFICA
--
-- Il file prova le proprie garanzie, e se non tornano FALLISCE invece di
-- riuscire a metà (disciplina della 0014 e della 0026). I due enum sono nati
-- in QUESTO file con `create type`, quindi nominarne i valori è lecito: il
-- divieto della 0026 riguardava i valori aggiunti con `alter type` nella
-- stessa transazione.
-- ---------------------------------------------------------------------------
do $$
declare
  v_bad  text;
  v_n    integer;
begin
  -- (a) La RLS è accesa su entrambe le tabelle.
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('crm_field_definitions', 'crm_field_values')
     and c.relrowsecurity = false;
  if v_bad is not null then
    raise exception 'RLS non attiva su: %', v_bad;
  end if;

  -- (b) Le definizioni non sono cancellabili dal client: si archiviano.
  select string_agg(format('%s.%s', table_name, privilege_type), ', ') into v_bad
    from information_schema.table_privileges
   where table_schema = 'public'
     and table_name = 'crm_field_definitions'
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
     and privilege_type = 'DELETE';
  if v_bad is not null then
    raise exception 'le definizioni dei campi risultano cancellabili dal client: %', v_bad;
  end if;

  -- (c) Le colonne timbrate dal database non sono scrivibili.
  select string_agg(format('%s.%s', table_name, column_name), ', ') into v_bad
    from information_schema.column_privileges
   where table_schema = 'public'
     and ((table_name = 'crm_field_definitions'
           and column_name in ('created_by', 'created_at', 'updated_at', 'archived_by'))
       or (table_name = 'crm_field_values'
           and column_name in ('created_at', 'updated_at')))
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
     and privilege_type in ('INSERT', 'UPDATE');
  if v_bad is not null then
    raise exception 'colonne dei campi personalizzati che il database deve timbrare risultano scrivibili: %', v_bad;
  end if;

  -- (d) Appartenenza e natura non si riscrivono: nessun UPDATE concesso su
  --     company_id, entity, field_type (definizioni) e company_id, field_id,
  --     organization_id, opportunity_id (valori). È il (d-bis) della 0026:
  --     quelle colonne servono all'INSERT e non devono poter cambiare dopo.
  select string_agg(format('%s.%s', table_name, column_name), ', ') into v_bad
    from information_schema.column_privileges
   where table_schema = 'public'
     and ((table_name = 'crm_field_definitions'
           and column_name in ('company_id', 'entity', 'field_type', 'archived_at'))
       or (table_name = 'crm_field_values'
           and column_name in ('company_id', 'field_id', 'organization_id', 'opportunity_id')))
     and grantee in ('anon', 'authenticated', 'public', 'PUBLIC')
     and privilege_type = 'UPDATE'
     -- archived_at è l'eccezione voluta: archiviare/ripristinare è il gesto
     -- ordinario, e va concesso in update. Si esclude dal controllo, non dai
     -- grant.
     and not (table_name = 'crm_field_definitions' and column_name = 'archived_at');
  if v_bad is not null then
    raise exception 'colonne di appartenenza dei campi personalizzati risultano MODIFICABILI dal client: %', v_bad;
  end if;

  -- (e) I guardiani sono `security definer`: un `create or replace` che
  --     dimenticasse la parola riporterebbe il difetto chiuso dalla 0019.
  select string_agg(p.proname, ', ') into v_bad
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('crm_field_definitions_guard', 'crm_field_values_guard',
                       'crm_merge_organizations')
     and p.prosecdef = false;
  if v_bad is not null then
    raise exception 'funzioni dei campi personalizzati che devono essere security definer non lo sono: %', v_bad;
  end if;

  -- (f) La fusione conosce i valori: la sezione 7 riscrive la funzione INTERA,
  --     e una ricopia a memoria che dimenticasse il blocco nuovo passerebbe
  --     ogni altro controllo seppellendo i valori nelle schede fuse.
  if pg_get_functiondef('public.crm_merge_organizations(uuid, uuid)'::regprocedure)
       not like '%crm_field_values%' then
    raise exception 'crm_merge_organizations non trasferisce i valori dei campi personalizzati';
  end if;

  -- (g) I tre indici unici esistono: nome fra gli attivi, un valore per campo
  --     ed entità, nelle due metà.
  select count(*) into v_n
    from pg_indexes
   where schemaname = 'public'
     and indexname in ('uq_crm_field_def_name', 'uq_crm_field_values_org', 'uq_crm_field_values_opp');
  if v_n <> 3 then
    raise exception 'gli indici unici dei campi personalizzati sono %, attesi 3', v_n;
  end if;

  -- (h) ⚠️ LA CONVALIDA FA QUELLO CHE IL FILE DICHIARA — provata sul
  --     RISULTATO, come la cifra di controllo dell'IDI nella 0026. Ogni caso
  --     è una controprova: se la funzione rispondesse NULL dove deve rispondere
  --     un sentinella, un valore falso entrerebbe nel database.
  if public.crm_field_value_problem('text', null, 'una nota', null, null) is not null then
    raise exception 'un testo pieno deve essere accettato';
  end if;
  if public.crm_field_value_problem('text', null, '   ', null, null) is distinct from 'crm_field_value_empty' then
    raise exception 'un testo di soli spazi NON è un valore';
  end if;
  if public.crm_field_value_problem('number', null, '18000', null, null) is distinct from 'crm_field_type_mismatch' then
    raise exception 'un testo dentro un campo numero deve essere rifiutato';
  end if;
  if public.crm_field_value_problem('number', null, null, 18000.5, null) is not null then
    raise exception 'un numero nella sua colonna deve essere accettato';
  end if;
  if public.crm_field_value_problem('date', null, null, null, date '2026-08-29') is not null then
    raise exception 'una data nella sua colonna deve essere accettata';
  end if;
  if public.crm_field_value_problem('date', null, null, 5, null) is distinct from 'crm_field_type_mismatch' then
    raise exception 'un numero dentro un campo data deve essere rifiutato';
  end if;
  if public.crm_field_value_problem('select', '["Piccola","Media","Grande"]'::jsonb, 'Media', null, null) is not null then
    raise exception 'una voce della lista deve essere accettata';
  end if;
  if public.crm_field_value_problem('select', '["Piccola","Media"]'::jsonb, 'Enorme', null, null) is distinct from 'crm_field_option_not_allowed' then
    raise exception 'una voce fuori lista deve essere rifiutata';
  end if;

  -- (i) Le opzioni: la stessa disciplina, sulla definizione.
  if public.crm_field_options_problem('select', '["una","due"]'::jsonb) is not null then
    raise exception 'un elenco sano deve essere accettato';
  end if;
  if public.crm_field_options_problem('select', '["una","una"]'::jsonb) is distinct from 'crm_field_options_duplicate' then
    raise exception 'due voci uguali devono essere rifiutate';
  end if;
  if public.crm_field_options_problem('select', '[]'::jsonb) is distinct from 'crm_field_options_invalid' then
    raise exception 'una lista senza voci deve essere rifiutata';
  end if;
  if public.crm_field_options_problem('select', '["una",5]'::jsonb) is distinct from 'crm_field_options_invalid' then
    raise exception 'una voce che non è testo deve essere rifiutata';
  end if;
  if public.crm_field_options_problem('text', '["una"]'::jsonb) is distinct from 'crm_field_options_invalid' then
    raise exception 'le opzioni non appartengono a un campo testo';
  end if;
  if public.crm_field_options_norm('["  una ","due"]'::jsonb) is distinct from '["una","due"]'::jsonb then
    raise exception 'la normalizzazione deve togliere gli spazi e tenere l''ordine';
  end if;

  raise notice '0047 applicata: 2 tabelle, RLS attiva, permessi verificati, convalida dei valori provata sul risultato, fusione aggiornata.';
end $$;
