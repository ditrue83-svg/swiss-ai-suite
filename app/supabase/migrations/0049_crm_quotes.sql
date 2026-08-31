-- ============================================================================
-- 0049 — PREVENTIVI PDF DAL CRM (FASE 1.2)
--
-- Un preventivo appartiene a una trattativa, ha un numero progressivo per
-- azienda e versioni. Una versione inviata non si riscrive: la successiva
-- nasce con `crm_new_quote_version`, sul modello di contract_term_versions.
--
-- Il PDF è un Documento generato e la sua provenienza è dichiarata dalla
-- coppia `documents.source_type = generated` + `crm_quote_documents`.
-- L'invio resta quello della 0048: Resend, gesto umano, nessuna Gmail API.
-- ============================================================================

alter type public.document_source_type add value if not exists 'generated';

-- Tra la creazione idempotente della riga e la risposta di Resend una email
-- uscente è intenzionalmente senza esito. La 0048 pretendeva subito `sent`,
-- che in caso di crash avrebbe trasformato un tentativo in un invio riuscito.
-- `null` significa soltanto "in corso"; i tre esiti visibili restano invariati.
alter table public.email_messages
  drop constraint if exists email_messages_direction_source;
alter table public.email_messages
  add constraint email_messages_direction_source check (
    (direction = 'in' and connection_id is not null and delivery_status is null)
    or (direction = 'out' and connection_id is null)
  );
comment on column public.email_messages.delivery_status is
  'Email CRM uscente: null durante il tentativo idempotente; sent quando il provider accetta, delivered al webhook, failed in caso di rifiuto. last_contact_at usa solo delivered.';

do $$ begin
  create type public.crm_quote_status as enum (
    'draft', 'sent', 'accepted', 'rejected', 'expired'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_quote_language as enum ('it', 'de', 'fr');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. Dati dell'azienda che devono comparire sul documento.
--
-- Sono sull'azienda, non sulla preferenza dell'utente: il preventivo deve
-- restare uguale per chiunque lo generi. La versione ne salva poi uno snapshot,
-- così un trasloco non cambia retroattivamente un PDF già inviato.
-- ---------------------------------------------------------------------------
alter table public.companies add column if not exists street text;
alter table public.companies add column if not exists postal_code text;
alter table public.companies add column if not exists city text;
alter table public.companies add column if not exists country_code text;
alter table public.companies add column if not exists logo_storage_path text;
alter table public.companies add column if not exists logo_mime_type text;

create or replace function public.companies_quote_identity_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.street := nullif(btrim(new.street), '');
  new.postal_code := nullif(btrim(new.postal_code), '');
  new.city := nullif(btrim(new.city), '');
  new.country_code := upper(nullif(btrim(new.country_code), ''));
  if new.country_code is not null and length(new.country_code) <> 2 then
    raise exception 'company_country_invalid' using errcode = '23514';
  end if;
  if new.logo_storage_path is not null then
    if new.logo_storage_path <> (new.id::text || '/company/logo') then
      raise exception 'company_logo_path_invalid' using errcode = '23514';
    end if;
    if new.logo_mime_type not in ('image/png', 'image/jpeg') then
      raise exception 'company_logo_type_invalid' using errcode = '23514';
    end if;
  else
    new.logo_mime_type := null;
  end if;
  return new;
end $$;

drop trigger if exists trg_companies_quote_identity_guard on public.companies;
create trigger trg_companies_quote_identity_guard
  before insert or update of street, postal_code, city, country_code,
    logo_storage_path, logo_mime_type on public.companies
  for each row execute function public.companies_quote_identity_guard();

-- ---------------------------------------------------------------------------
-- 2. Numero, versioni, righe e provenienza del PDF.
-- ---------------------------------------------------------------------------
create table if not exists public.crm_quotes (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  opportunity_id    uuid not null references public.crm_opportunities(id) on delete cascade,
  organization_id   uuid not null references public.crm_organizations(id) on delete cascade,
  sequence_number   integer not null,
  quote_number      text not null,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  constraint crm_quote_sequence_positive check (sequence_number > 0),
  constraint crm_quote_number_not_blank check (btrim(quote_number) <> ''),
  constraint uq_crm_quote_sequence unique (company_id, sequence_number),
  constraint uq_crm_quote_number unique (company_id, quote_number)
);

create table if not exists public.crm_quote_versions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  quote_id          uuid not null references public.crm_quotes(id) on delete cascade,
  opportunity_id    uuid not null references public.crm_opportunities(id) on delete cascade,
  organization_id   uuid not null references public.crm_organizations(id) on delete cascade,
  version           integer not null,
  status            public.crm_quote_status not null default 'draft',
  language          public.crm_quote_language not null,
  issued_on         date not null default current_date,
  valid_until       date not null,
  currency          text not null,
  title             text not null,
  introduction      text,
  notes             text,

  -- Totali scritti solo da crm_quote_refresh_totals(), mai dal browser.
  subtotal_amount   numeric(14,2) not null default 0,
  vat_amount        numeric(14,2) not null default 0,
  total_amount      numeric(14,2) not null default 0,

  -- Snapshot dell'emittente.
  company_legal_name text not null,
  company_uid_che    text,
  company_street     text,
  company_postal_code text,
  company_city       text,
  company_country_code text,
  company_logo_storage_path text,
  company_logo_mime_type text,

  -- Snapshot del destinatario.
  customer_display_name text not null,
  customer_legal_name text,
  customer_vat_number text,
  customer_street text,
  customer_postal_code text,
  customer_city text,
  customer_country_code text,

  based_on_version_id uuid references public.crm_quote_versions(id) on delete set null,
  document_id       uuid references public.documents(id) on delete set null,
  pdf_generated_at  timestamptz,
  sent_at           timestamptz,
  sent_by           uuid references auth.users(id) on delete set null,
  sent_email_id     uuid references public.email_messages(id) on delete set null,
  accepted_at       timestamptz,
  accepted_by       uuid references auth.users(id) on delete set null,
  rejected_at       timestamptz,
  rejected_by       uuid references auth.users(id) on delete set null,
  expired_at        timestamptz,
  expired_by        uuid references auth.users(id) on delete set null,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint uq_crm_quote_version unique (quote_id, version),
  constraint crm_quote_version_positive check (version > 0),
  constraint crm_quote_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint crm_quote_title_not_blank check (btrim(title) <> ''),
  constraint crm_quote_validity check (valid_until >= issued_on),
  constraint crm_quote_totals_nonnegative check (
    subtotal_amount >= 0 and vat_amount >= 0 and total_amount >= 0
    and total_amount = subtotal_amount + vat_amount
  ),
  -- Una bozza modificata conserva il riferimento al file da SOVRASCRIVERE ma
  -- perde `pdf_generated_at`: quel file è obsoleto e send-crm-email lo rifiuta.
  constraint crm_quote_pdf_pair check (
    pdf_generated_at is null or document_id is not null
  ),
  constraint crm_quote_sent_stamp check (
    (status = 'draft') = (sent_at is null)
  ),
  constraint crm_quote_accepted_stamp check (
    (status = 'accepted') = (accepted_at is not null)
  ),
  constraint crm_quote_rejected_stamp check (
    (status = 'rejected') = (rejected_at is not null)
  ),
  constraint crm_quote_expired_stamp check (
    (status = 'expired') = (expired_at is not null)
  )
);

create table if not exists public.crm_quote_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  quote_id          uuid not null references public.crm_quotes(id) on delete cascade,
  quote_version_id  uuid not null references public.crm_quote_versions(id) on delete cascade,
  line_number       integer not null,
  description       text not null,
  quantity          numeric(14,3) not null,
  unit_price        numeric(14,2) not null,
  vat_rate_id       uuid not null references public.finance_vat_rates(id),
  vat_rate          numeric not null,
  vat_source_url    text not null,
  vat_source_title  text,
  vat_checked_at    date not null,
  net_amount        numeric(14,2) generated always as (
    round(quantity * unit_price, 2)
  ) stored,
  vat_amount        numeric(14,2) generated always as (
    round(round(quantity * unit_price, 2) * vat_rate / 100, 2)
  ) stored,
  total_amount      numeric(14,2) generated always as (
    round(quantity * unit_price, 2)
    + round(round(quantity * unit_price, 2) * vat_rate / 100, 2)
  ) stored,
  created_at        timestamptz not null default now(),
  constraint uq_crm_quote_line unique (quote_version_id, line_number),
  constraint crm_quote_line_positive check (line_number > 0),
  constraint crm_quote_item_description check (btrim(description) <> ''),
  constraint crm_quote_item_quantity check (quantity > 0),
  constraint crm_quote_item_price check (unit_price >= 0),
  constraint crm_quote_item_vat check (vat_rate >= 0 and vat_rate <= 100)
);

create table if not exists public.crm_quote_documents (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  quote_id          uuid not null references public.crm_quotes(id) on delete cascade,
  quote_version_id  uuid not null references public.crm_quote_versions(id) on delete cascade,
  document_id       uuid not null references public.documents(id) on delete cascade,
  created_at        timestamptz not null default now(),
  constraint uq_crm_quote_version_document unique (quote_version_id),
  constraint uq_crm_quote_document unique (document_id)
);

create index if not exists idx_crm_quotes_opportunity
  on public.crm_quotes (company_id, opportunity_id, created_at desc);
create index if not exists idx_crm_quote_versions_quote
  on public.crm_quote_versions (quote_id, version desc);
create index if not exists idx_crm_quote_items_version
  on public.crm_quote_items (quote_version_id, line_number);
create index if not exists idx_crm_quote_documents_document
  on public.crm_quote_documents (document_id);

comment on table public.crm_quotes is
  'Preventivo CRM: numero progressivo stabile per azienda e collegamento alla trattativa.';
comment on table public.crm_quote_versions is
  'Versioni del preventivo. Dopo l invio i contenuti e il PDF sono immutabili; una modifica crea una nuova versione.';
comment on table public.crm_quote_items is
  'Voci del preventivo. La valuta vive sulla versione: due valute non possono entrare nello stesso totale.';
comment on table public.crm_quote_documents is
  'Provenienza dichiarata dei PDF generati dal CRM dentro Documenti.';

-- ---------------------------------------------------------------------------
-- 3. Guardiani cross-tenant e immutabilità.
-- ---------------------------------------------------------------------------
create or replace function public.crm_quotes_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_opp record;
begin
  if tg_op = 'UPDATE' then
    raise exception 'crm_quote_immutable' using errcode = '42501';
  end if;
  select o.company_id, o.organization_id into v_opp
    from public.crm_opportunities o where o.id = new.opportunity_id;
  if v_opp.company_id is null
     or v_opp.company_id is distinct from new.company_id
     or v_opp.organization_id is distinct from new.organization_id then
    raise exception 'crm_quote_cross_tenant' using errcode = '23514';
  end if;
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  return new;
end $$;

drop trigger if exists trg_crm_quotes_guard on public.crm_quotes;
create trigger trg_crm_quotes_guard before insert or update on public.crm_quotes
  for each row execute function public.crm_quotes_guard();

create or replace function public.crm_quote_versions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote record;
  v_mode text := coalesce(current_setting('ai_swisse.quote_write', true), '');
begin
  select q.company_id, q.opportunity_id, q.organization_id into v_quote
    from public.crm_quotes q where q.id = new.quote_id;
  if v_quote.company_id is null
     or v_quote.company_id is distinct from new.company_id
     or v_quote.opportunity_id is distinct from new.opportunity_id
     or v_quote.organization_id is distinct from new.organization_id then
    raise exception 'crm_quote_version_cross_tenant' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'crm_quote_version_must_start_draft' using errcode = '23514';
    end if;
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    new.sent_at := null; new.sent_by := null; new.sent_email_id := null;
    new.accepted_at := null; new.accepted_by := null;
    new.rejected_at := null; new.rejected_by := null;
    new.expired_at := null; new.expired_by := null;
    new.created_at := now(); new.updated_at := now();
    return new;
  end if;

  new.company_id := old.company_id;
  new.quote_id := old.quote_id;
  new.opportunity_id := old.opportunity_id;
  new.organization_id := old.organization_id;
  new.version := old.version;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if v_mode in ('totals', 'pdf') then
    if old.status <> 'draft' then
      raise exception 'crm_quote_version_immutable' using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if v_mode = 'send' then
    if old.status = 'sent' and new.status = 'sent' then return old; end if;
    if old.status <> 'draft' or new.status <> 'sent' or old.pdf_generated_at is null then
      raise exception 'crm_quote_cannot_send' using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if v_mode = 'lifecycle' then
    if old.status <> 'sent' or new.status not in ('accepted', 'rejected', 'expired') then
      raise exception 'crm_quote_status_transition_invalid' using errcode = '42501';
    end if;
    new.updated_at := now();
    return new;
  end if;

  if old.status <> 'draft' then
    raise exception 'crm_quote_version_immutable'
      using errcode = '42501', hint = 'Un preventivo inviato non si modifica: si crea una nuova versione.';
  end if;
  if new.status <> 'draft' then
    raise exception 'crm_quote_status_path_required' using errcode = '42501';
  end if;
  -- Qualunque modifica commerciale rende il PDF precedente obsoleto.
  new.pdf_generated_at := null;
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists trg_crm_quote_versions_guard on public.crm_quote_versions;
create trigger trg_crm_quote_versions_guard
  before insert or update on public.crm_quote_versions
  for each row execute function public.crm_quote_versions_guard();

create or replace function public.crm_quote_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version record;
begin
  select v.company_id, v.quote_id, v.status into v_version
    from public.crm_quote_versions v where v.id = coalesce(new.quote_version_id, old.quote_version_id);
  if v_version.company_id is null or v_version.status <> 'draft' then
    raise exception 'crm_quote_item_version_immutable' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and (
    new.company_id is distinct from v_version.company_id
    or new.quote_id is distinct from v_version.quote_id
  ) then
    raise exception 'crm_quote_item_cross_tenant' using errcode = '23514';
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists trg_crm_quote_items_guard on public.crm_quote_items;
create trigger trg_crm_quote_items_guard
  before insert or update or delete on public.crm_quote_items
  for each row execute function public.crm_quote_items_guard();

create or replace function public.crm_quote_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_version record;
  v_doc_company uuid;
  v_source text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'crm_quote_document_immutable' using errcode = '42501';
  end if;
  select v.company_id, v.quote_id into v_version
    from public.crm_quote_versions v where v.id = new.quote_version_id;
  select d.company_id, d.source_type::text into v_doc_company, v_source
    from public.documents d where d.id = new.document_id;
  if v_version.company_id is null or v_doc_company is null or v_source <> 'generated'
     or new.company_id is distinct from v_version.company_id
     or new.quote_id is distinct from v_version.quote_id
     or new.company_id is distinct from v_doc_company then
    raise exception 'crm_quote_document_cross_tenant' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_quote_documents_guard on public.crm_quote_documents;
create trigger trg_crm_quote_documents_guard
  before insert or update on public.crm_quote_documents
  for each row execute function public.crm_quote_documents_guard();

-- Totali SQL decimali, mai JavaScript in virgola mobile.
create or replace function public.crm_quote_refresh_totals(p_version_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('ai_swisse.quote_write', 'totals', true);
  update public.crm_quote_versions v set
    subtotal_amount = x.subtotal,
    vat_amount = x.vat,
    total_amount = x.total
  from (
    select coalesce(sum(i.net_amount), 0)::numeric(14,2) as subtotal,
           coalesce(sum(i.vat_amount), 0)::numeric(14,2) as vat,
           coalesce(sum(i.total_amount), 0)::numeric(14,2) as total
      from public.crm_quote_items i where i.quote_version_id = p_version_id
  ) x
  where v.id = p_version_id;
end $$;

create or replace function public.crm_quote_items_refresh_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.crm_quote_refresh_totals(coalesce(new.quote_version_id, old.quote_version_id));
  return coalesce(new, old);
end $$;

drop trigger if exists trg_crm_quote_items_refresh_totals on public.crm_quote_items;
create trigger trg_crm_quote_items_refresh_totals
  after insert or update or delete on public.crm_quote_items
  for each row execute function public.crm_quote_items_refresh_totals();

-- ---------------------------------------------------------------------------
-- 4. RPC: crea/aggiorna bozza e crea una nuova versione.
-- ---------------------------------------------------------------------------
create or replace function public.crm_save_quote_draft(
  p_company_id uuid,
  p_opportunity_id uuid,
  p_quote_id uuid,
  p_language public.crm_quote_language,
  p_valid_until date,
  p_currency text,
  p_title text,
  p_introduction text,
  p_notes text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_quote public.crm_quotes%rowtype;
  v_version public.crm_quote_versions%rowtype;
  v_opp record;
  v_company public.companies%rowtype;
  v_org public.crm_organizations%rowtype;
  v_item jsonb;
  v_rate public.finance_vat_rates%rowtype;
  v_line integer := 0;
  v_sequence integer;
  v_currency text := upper(btrim(coalesce(p_currency, '')));
begin
  if auth.uid() is null then raise exception 'crm_quote_unauthenticated' using errcode = '28000'; end if;
  if not public.is_company_member(p_company_id) then raise exception 'crm_quote_forbidden' using errcode = '42501'; end if;
  if btrim(coalesce(p_title, '')) = '' or v_currency !~ '^[A-Z]{3}$'
     or p_valid_until is null or p_valid_until < current_date
     or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) < 1
     or jsonb_array_length(p_items) > 100 then
    raise exception 'crm_quote_invalid' using errcode = '22023';
  end if;

  select o.*, g.display_name as organization_name into v_opp
    from public.crm_opportunities o
    join public.crm_organizations g on g.id = o.organization_id
   where o.id = p_opportunity_id and o.company_id = p_company_id;
  if v_opp.id is null then raise exception 'crm_quote_cross_tenant' using errcode = '23514'; end if;
  select * into v_company from public.companies where id = p_company_id;
  select * into v_org from public.crm_organizations where id = v_opp.organization_id;

  if p_quote_id is null then
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 0));
    select coalesce(max(q.sequence_number), 0) + 1 into v_sequence
      from public.crm_quotes q where q.company_id = p_company_id;
    insert into public.crm_quotes (
      company_id, opportunity_id, organization_id, sequence_number, quote_number, created_by
    ) values (
      p_company_id, p_opportunity_id, v_opp.organization_id, v_sequence,
      'P-' || lpad(v_sequence::text, 6, '0'), auth.uid()
    ) returning * into v_quote;
    insert into public.crm_quote_versions (
      company_id, quote_id, opportunity_id, organization_id, version, language,
      issued_on, valid_until, currency, title, introduction, notes,
      company_legal_name, company_uid_che, company_street, company_postal_code,
      company_city, company_country_code, company_logo_storage_path, company_logo_mime_type,
      customer_display_name, customer_legal_name, customer_vat_number, customer_street,
      customer_postal_code, customer_city, customer_country_code, created_by
    ) values (
      p_company_id, v_quote.id, p_opportunity_id, v_opp.organization_id, 1, p_language,
      current_date, p_valid_until, v_currency, btrim(p_title), nullif(btrim(p_introduction), ''),
      nullif(btrim(p_notes), ''), v_company.legal_name, v_company.uid_che,
      v_company.street, v_company.postal_code, coalesce(v_company.city, v_company.municipality),
      coalesce(v_company.country_code, 'CH'), v_company.logo_storage_path, v_company.logo_mime_type,
      v_org.display_name, v_org.legal_name, v_org.vat_number, v_org.street,
      v_org.postal_code, v_org.city, v_org.country_code, auth.uid()
    ) returning * into v_version;
  else
    select * into v_quote from public.crm_quotes q
      where q.id = p_quote_id and q.company_id = p_company_id
        and q.opportunity_id = p_opportunity_id;
    if v_quote.id is null then raise exception 'crm_quote_cross_tenant' using errcode = '23514'; end if;
    select * into v_version from public.crm_quote_versions v
      where v.quote_id = v_quote.id order by v.version desc limit 1 for update;
    if v_version.status <> 'draft' then
      raise exception 'crm_quote_new_version_required' using errcode = '42501';
    end if;
    update public.crm_quote_versions set
      language = p_language, issued_on = current_date, valid_until = p_valid_until,
      currency = v_currency, title = btrim(p_title),
      introduction = nullif(btrim(p_introduction), ''), notes = nullif(btrim(p_notes), ''),
      company_legal_name = v_company.legal_name, company_uid_che = v_company.uid_che,
      company_street = v_company.street, company_postal_code = v_company.postal_code,
      company_city = coalesce(v_company.city, v_company.municipality),
      company_country_code = coalesce(v_company.country_code, 'CH'),
      company_logo_storage_path = v_company.logo_storage_path,
      company_logo_mime_type = v_company.logo_mime_type,
      customer_display_name = v_org.display_name, customer_legal_name = v_org.legal_name,
      customer_vat_number = v_org.vat_number, customer_street = v_org.street,
      customer_postal_code = v_org.postal_code, customer_city = v_org.city,
      customer_country_code = v_org.country_code
    where id = v_version.id returning * into v_version;
    delete from public.crm_quote_items where quote_version_id = v_version.id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    if btrim(coalesce(v_item->>'description', '')) = ''
       or coalesce((v_item->>'quantity')::numeric, 0) <= 0
       or coalesce((v_item->>'unitPrice')::numeric, -1) < 0 then
      raise exception 'crm_quote_item_invalid' using errcode = '22023';
    end if;
    select * into v_rate from public.finance_vat_rates r
      where r.id = (v_item->>'vatRateId')::uuid and r.country_code = 'CH'
        and r.valid_from <= current_date and (r.valid_to is null or r.valid_to >= current_date);
    if v_rate.id is null then raise exception 'crm_quote_vat_rate_invalid' using errcode = '22023'; end if;
    insert into public.crm_quote_items (
      company_id, quote_id, quote_version_id, line_number, description,
      quantity, unit_price, vat_rate_id, vat_rate, vat_source_url,
      vat_source_title, vat_checked_at
    ) values (
      p_company_id, v_quote.id, v_version.id, v_line,
      left(btrim(v_item->>'description'), 500), (v_item->>'quantity')::numeric,
      (v_item->>'unitPrice')::numeric, v_rate.id, v_rate.rate,
      v_rate.source_url, v_rate.source_title, v_rate.checked_at
    );
  end loop;
  return v_version.id;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'crm_quote_item_invalid' using errcode = '22023';
end $$;

create or replace function public.crm_new_quote_version(p_company_id uuid, p_quote_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.crm_quote_versions%rowtype;
  v_new_id uuid;
begin
  if auth.uid() is null or not public.is_company_member(p_company_id) then
    raise exception 'crm_quote_forbidden' using errcode = '42501';
  end if;
  select v.* into v_old from public.crm_quote_versions v
    join public.crm_quotes q on q.id = v.quote_id
   where v.quote_id = p_quote_id and q.company_id = p_company_id
   order by v.version desc limit 1 for update;
  if v_old.id is null then raise exception 'crm_quote_not_found' using errcode = 'P0002'; end if;
  if v_old.status = 'draft' then return v_old.id; end if;

  insert into public.crm_quote_versions (
    company_id, quote_id, opportunity_id, organization_id, version, language,
    issued_on, valid_until, currency, title, introduction, notes,
    company_legal_name, company_uid_che, company_street, company_postal_code,
    company_city, company_country_code, company_logo_storage_path, company_logo_mime_type,
    customer_display_name, customer_legal_name, customer_vat_number, customer_street,
    customer_postal_code, customer_city, customer_country_code,
    based_on_version_id, created_by
  ) select
    company_id, quote_id, opportunity_id, organization_id, version + 1, language,
    current_date, greatest(current_date, valid_until), currency, title, introduction, notes,
    company_legal_name, company_uid_che, company_street, company_postal_code,
    company_city, company_country_code, company_logo_storage_path, company_logo_mime_type,
    customer_display_name, customer_legal_name, customer_vat_number, customer_street,
    customer_postal_code, customer_city, customer_country_code,
    id, auth.uid()
  from public.crm_quote_versions where id = v_old.id
  returning id into v_new_id;

  insert into public.crm_quote_items (
    company_id, quote_id, quote_version_id, line_number, description, quantity,
    unit_price, vat_rate_id, vat_rate, vat_source_url, vat_source_title, vat_checked_at
  ) select company_id, quote_id, v_new_id, line_number, description, quantity,
      unit_price, vat_rate_id, vat_rate, vat_source_url, vat_source_title, vat_checked_at
    from public.crm_quote_items where quote_version_id = v_old.id order by line_number;
  return v_new_id;
end $$;

create or replace function public.crm_set_quote_status(
  p_company_id uuid, p_quote_version_id uuid, p_status public.crm_quote_status
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_company_member(p_company_id) then
    raise exception 'crm_quote_forbidden' using errcode = '42501';
  end if;
  if p_status not in ('accepted', 'rejected', 'expired') then
    raise exception 'crm_quote_status_transition_invalid' using errcode = '22023';
  end if;
  perform set_config('ai_swisse.quote_write', 'lifecycle', true);
  update public.crm_quote_versions set
    status = p_status,
    accepted_at = case when p_status = 'accepted' then now() else null end,
    accepted_by = case when p_status = 'accepted' then auth.uid() else null end,
    rejected_at = case when p_status = 'rejected' then now() else null end,
    rejected_by = case when p_status = 'rejected' then auth.uid() else null end,
    expired_at = case when p_status = 'expired' then now() else null end,
    expired_by = case when p_status = 'expired' then auth.uid() else null end
  where id = p_quote_version_id and company_id = p_company_id and status = 'sent';
  if not found then raise exception 'crm_quote_status_transition_invalid' using errcode = '42501'; end if;
end $$;

-- Payload unico letto dalla Edge Function attraverso il JWT della persona.
create or replace function public.crm_quote_pdf_payload(
  p_company_id uuid, p_quote_version_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'quoteId', q.id, 'quoteNumber', q.quote_number,
    'versionId', v.id, 'version', v.version, 'status', v.status,
    'opportunityId', v.opportunity_id, 'organizationId', v.organization_id,
    'language', v.language, 'issuedOn', v.issued_on, 'validUntil', v.valid_until,
    'currency', v.currency, 'title', v.title, 'introduction', v.introduction,
    'notes', v.notes, 'subtotal', v.subtotal_amount, 'vatTotal', v.vat_amount,
    'total', v.total_amount, 'documentId', v.document_id,
    'company', jsonb_build_object(
      'legalName', v.company_legal_name, 'uidChe', v.company_uid_che,
      'street', v.company_street, 'postalCode', v.company_postal_code,
      'city', v.company_city, 'countryCode', v.company_country_code,
      'logoStoragePath', v.company_logo_storage_path, 'logoMimeType', v.company_logo_mime_type
    ),
    'customer', jsonb_build_object(
      'displayName', v.customer_display_name, 'legalName', v.customer_legal_name,
      'vatNumber', v.customer_vat_number, 'street', v.customer_street,
      'postalCode', v.customer_postal_code, 'city', v.customer_city,
      'countryCode', v.customer_country_code
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lineNumber', i.line_number, 'description', i.description,
        'quantity', i.quantity, 'unitPrice', i.unit_price, 'vatRate', i.vat_rate,
        'vatSourceUrl', i.vat_source_url, 'vatSourceTitle', i.vat_source_title,
        'vatCheckedAt', i.vat_checked_at, 'netAmount', i.net_amount,
        'vatAmount', i.vat_amount, 'totalAmount', i.total_amount
      ) order by i.line_number)
      from public.crm_quote_items i where i.quote_version_id = v.id
    ), '[]'::jsonb)
  )
  from public.crm_quote_versions v
  join public.crm_quotes q on q.id = v.quote_id
  where v.id = p_quote_version_id and v.company_id = p_company_id
    and v.status = 'draft' and public.is_company_member(p_company_id);
$$;

-- Solo la funzione server registra il file realmente caricato nello Storage.
create or replace function public.crm_register_quote_pdf(
  p_company_id uuid, p_quote_version_id uuid, p_document_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
begin
  select v.quote_id, v.opportunity_id, v.organization_id, v.status,
         d.company_id as document_company, d.source_type::text as source_type
    into v
    from public.crm_quote_versions v
    join public.documents d on d.id = p_document_id
   where v.id = p_quote_version_id and v.company_id = p_company_id;
  if v.quote_id is null or v.document_company is distinct from p_company_id
     or v.source_type <> 'generated' or v.status <> 'draft' then
    raise exception 'crm_quote_document_cross_tenant' using errcode = '23514';
  end if;
  insert into public.crm_quote_documents (
    company_id, quote_id, quote_version_id, document_id
  ) values (p_company_id, v.quote_id, p_quote_version_id, p_document_id)
  on conflict (quote_version_id) do nothing;
  if not exists (
    select 1 from public.crm_quote_documents qd
     where qd.quote_version_id = p_quote_version_id and qd.document_id = p_document_id
  ) then
    raise exception 'crm_quote_document_version_mismatch' using errcode = '23514';
  end if;
  insert into public.crm_organization_documents (
    company_id, organization_id, document_id, relation, match_reason
  ) values (p_company_id, v.organization_id, p_document_id, 'customer', 'manual')
  on conflict (organization_id, document_id) do nothing;
  insert into public.crm_opportunity_documents (
    company_id, opportunity_id, document_id
  ) values (p_company_id, v.opportunity_id, p_document_id)
  on conflict (opportunity_id, document_id) do nothing;
  perform set_config('ai_swisse.quote_write', 'pdf', true);
  update public.crm_quote_versions set document_id = p_document_id, pdf_generated_at = now()
    where id = p_quote_version_id;
end $$;

-- Chiamata da send-crm-email DOPO l'accettazione del provider. I documenti
-- arrivano dalla tabella allegati della email registrata, non dal body del
-- browser: riusare una chiave idempotente con altri id non può marcare preventivi.
create or replace function public.crm_mark_attached_quotes_sent(
  p_company_id uuid, p_email_message_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  if not exists (
    select 1 from public.email_messages m
     where m.id = p_email_message_id and m.company_id = p_company_id
       and m.direction = 'out' and m.delivery_status = 'sent'
  ) then raise exception 'crm_quote_email_not_sent' using errcode = '23514'; end if;
  perform set_config('ai_swisse.quote_write', 'send', true);
  update public.crm_quote_versions v set
    status = 'sent', sent_at = now(), sent_by = m.sent_by, sent_email_id = m.id
  from public.crm_quote_documents qd
  join public.crm_outgoing_email_attachments a on a.document_id = qd.document_id
  join public.email_messages m on m.id = a.email_message_id
  where v.id = qd.quote_version_id and v.company_id = p_company_id
    and a.email_message_id = p_email_message_id and v.status = 'draft'
    and v.pdf_generated_at is not null and v.document_id = qd.document_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS, permessi minimi e autoverifica.
-- ---------------------------------------------------------------------------
alter table public.crm_quotes enable row level security;
alter table public.crm_quote_versions enable row level security;
alter table public.crm_quote_items enable row level security;
alter table public.crm_quote_documents enable row level security;

revoke all on public.crm_quotes from anon, authenticated, public;
revoke all on public.crm_quote_versions from anon, authenticated, public;
revoke all on public.crm_quote_items from anon, authenticated, public;
revoke all on public.crm_quote_documents from anon, authenticated, public;

grant select on public.crm_quotes to authenticated;
grant select on public.crm_quote_versions to authenticated;
grant select on public.crm_quote_items to authenticated;
grant select on public.crm_quote_documents to authenticated;

drop policy if exists crm_quotes_select_member on public.crm_quotes;
create policy crm_quotes_select_member on public.crm_quotes for select to authenticated
  using ((select public.is_company_member(company_id)));
drop policy if exists crm_quote_versions_select_member on public.crm_quote_versions;
create policy crm_quote_versions_select_member on public.crm_quote_versions for select to authenticated
  using ((select public.is_company_member(company_id)));
drop policy if exists crm_quote_items_select_member on public.crm_quote_items;
create policy crm_quote_items_select_member on public.crm_quote_items for select to authenticated
  using ((select public.is_company_member(company_id)));
drop policy if exists crm_quote_documents_select_member on public.crm_quote_documents;
create policy crm_quote_documents_select_member on public.crm_quote_documents for select to authenticated
  using ((select public.is_company_member(company_id)));

revoke all on function public.crm_quote_refresh_totals(uuid) from public, anon, authenticated;
revoke all on function public.crm_save_quote_draft(uuid, uuid, uuid, public.crm_quote_language, date, text, text, text, text, jsonb) from public, anon;
revoke all on function public.crm_new_quote_version(uuid, uuid) from public, anon;
revoke all on function public.crm_set_quote_status(uuid, uuid, public.crm_quote_status) from public, anon;
revoke all on function public.crm_quote_pdf_payload(uuid, uuid) from public, anon;
revoke all on function public.crm_register_quote_pdf(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.crm_mark_attached_quotes_sent(uuid, uuid) from public, anon, authenticated;

grant execute on function public.crm_save_quote_draft(uuid, uuid, uuid, public.crm_quote_language, date, text, text, text, text, jsonb) to authenticated;
grant execute on function public.crm_new_quote_version(uuid, uuid) to authenticated;
grant execute on function public.crm_set_quote_status(uuid, uuid, public.crm_quote_status) to authenticated;
grant execute on function public.crm_quote_pdf_payload(uuid, uuid) to authenticated;
grant execute on function public.crm_register_quote_pdf(uuid, uuid, uuid) to service_role;
grant execute on function public.crm_mark_attached_quotes_sent(uuid, uuid) to service_role;

do $$
declare
  v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('crm_quotes', 'crm_quote_versions', 'crm_quote_items', 'crm_quote_documents')
     and not c.relrowsecurity;
  if v_bad is not null then raise exception '0049: RLS non attiva su %', v_bad; end if;

  select string_agg(p.table_name || ':' || p.privilege_type, ', ') into v_bad
    from information_schema.role_table_grants p
   where p.table_schema = 'public'
     and p.table_name in ('crm_quotes', 'crm_quote_versions', 'crm_quote_items', 'crm_quote_documents')
     and lower(p.grantee) in ('anon', 'public');
  if v_bad is not null then raise exception '0049: privilegi anon/public inattesi: %', v_bad; end if;

  select string_agg(p.table_name || ':' || p.privilege_type, ', ') into v_bad
    from information_schema.role_table_grants p
   where p.table_schema = 'public'
     and p.table_name in ('crm_quotes', 'crm_quote_versions', 'crm_quote_items', 'crm_quote_documents')
     and lower(p.grantee) = 'authenticated' and p.privilege_type <> 'SELECT';
  if v_bad is not null then raise exception '0049: il client può scrivere le tabelle preventivi: %', v_bad; end if;
end $$;
