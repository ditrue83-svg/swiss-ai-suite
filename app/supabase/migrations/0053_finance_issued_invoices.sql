-- ============================================================================
-- 0053 — FATTURE EMESSE CON QR-FATTURA SVIZZERA
--
-- AI-Swisse EMETTE fatture clienti (PDF con polizza di pagamento QR svizzera)
-- ma non muove denaro: niente pagamenti, niente pain.001, niente letture
-- bancarie. La riconciliazione è manuale: è l'utente a marcare «pagata».
--
-- La fattura vive nel modulo Finanze e il cliente resta un riferimento CRM:
-- collegamento, non copia — sul documento vanno gli snapshot, così un
-- trasloco non cambia retroattivamente un PDF già emesso.
--
-- Nessuna versione e nessuna modifica dopo l'emissione: le correzioni
-- avvengono per annullo (`voided`) + nota di credito, numerata a parte.
--
-- Invarianti:
-- - i totali li scrive solo finance_issued_invoice_refresh_totals(), in SQL
--   decimale, mai il browser;
-- - ogni scrittura fuori bozza dichiara la sua modalità nel GUC
--   `ai_swisse.invoice_write` (totals|pdf|issue|send|lifecycle|overdue);
-- - il PDF è un Documento generato e la sua provenienza è dichiarata dalla
--   coppia documents.source_type = generated + finance_issued_invoice_documents;
-- - qualunque modifica commerciale a una bozza invalida il PDF generato.
-- ============================================================================

-- Il valore enum è aggiunto qui ma NON usato in nessuna riga di questa
-- migrazione (55P04): lo citano solo i corpi delle funzioni, letti a runtime.
alter type public.automation_event_type add value if not exists 'finance_issued_invoice_overdue';

do $$ begin
  create type public.finance_issued_invoice_status as enum (
    'draft', 'issued', 'sent', 'paid', 'overdue', 'voided'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.finance_issued_invoice_doc_kind as enum (
    'invoice', 'credit_note', 'reminder'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.finance_issued_invoice_language as enum ('it', 'de', 'fr');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- 1. L'IBAN dell'azienda, che finisce nella polizza QR.
--
-- Sta sull'azienda come gli altri dati del documento (0049): la fattura deve
-- restare uguale per chiunque la generi, e la riga ne salva uno snapshot.
-- La cifra di controllo la verifica finance_iban_valid() (0021), la stessa
-- usata per le fatture fornitore: il numero è trascritto bene, non detto vero.
-- ---------------------------------------------------------------------------
alter table public.companies add column if not exists bank_iban text;

create or replace function public.companies_bank_iban_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.bank_iban := nullif(upper(regexp_replace(btrim(coalesce(new.bank_iban, '')), '\s+', '', 'g')), '');
  if new.bank_iban is not null and not public.finance_iban_valid(new.bank_iban) then
    raise exception 'company_bank_iban_invalid' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_companies_bank_iban_guard on public.companies;
create trigger trg_companies_bank_iban_guard
  before insert or update of bank_iban on public.companies
  for each row execute function public.companies_bank_iban_guard();

-- ---------------------------------------------------------------------------
-- 2. Registro, righe e provenienza dei PDF.
-- ---------------------------------------------------------------------------
create table if not exists public.finance_issued_invoices (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  organization_id   uuid not null references public.crm_organizations(id) on delete cascade,
  opportunity_id    uuid references public.crm_opportunities(id) on delete cascade,
  quote_version_id  uuid references public.crm_quote_versions(id) on delete set null,
  created_by        uuid not null,
  created_at        timestamptz not null default now(),

  sequence_number   integer not null,
  invoice_number    text not null,
  credit_note_sequence_number integer,
  credit_note_number text,

  status            public.finance_issued_invoice_status not null default 'draft',
  language          public.finance_issued_invoice_language not null,
  currency          text not null,
  title             text not null,
  notes             text,
  issued_on         date not null,
  due_date          date not null,

  -- Totali scritti solo da finance_issued_invoice_refresh_totals().
  subtotal_amount   numeric(14,2) not null default 0,
  vat_amount        numeric(14,2) not null default 0,
  total_amount      numeric(14,2) not null default 0,

  -- Snapshot dell'emittente, IBAN compreso.
  company_legal_name text not null,
  company_uid_che    text,
  company_street     text,
  company_postal_code text,
  company_city       text,
  company_country_code text,
  company_logo_storage_path text,
  company_logo_mime_type text,
  company_bank_iban  text,

  -- Snapshot del destinatario.
  customer_display_name text not null,
  customer_street text,
  customer_postal_code text,
  customer_city text,
  customer_country_code text,

  -- Riferimento di pagamento della polizza QR (QRR, SCOR o nessuno).
  payment_reference_type text,
  payment_reference text,

  document_id       uuid references public.documents(id) on delete set null,
  pdf_generated_at  timestamptz,

  issued_at         timestamptz,
  issued_by         uuid references auth.users(id) on delete set null,
  sent_at           timestamptz,
  sent_by           uuid references auth.users(id) on delete set null,
  sent_email_id     uuid references public.email_messages(id) on delete set null,
  paid_at           timestamptz,
  paid_by           uuid references auth.users(id) on delete set null,
  paid_on           date,
  overdue_at        timestamptz,
  voided_at         timestamptz,
  voided_by         uuid references auth.users(id) on delete set null,
  void_reason       text,

  constraint finance_issued_invoice_sequence_positive check (sequence_number > 0),
  constraint finance_issued_invoice_number_not_blank check (btrim(invoice_number) <> ''),
  constraint finance_issued_invoice_cn_sequence_positive check (credit_note_sequence_number > 0),
  constraint uq_finance_issued_invoice_sequence unique (company_id, sequence_number),
  constraint uq_finance_issued_invoice_number unique (company_id, invoice_number),
  constraint uq_finance_issued_invoice_cn_number unique (company_id, credit_note_number),
  constraint finance_issued_invoice_currency_iso check (currency ~ '^[A-Z]{3}$'),
  constraint finance_issued_invoice_title_not_blank check (btrim(title) <> ''),
  constraint finance_issued_invoice_due_date check (due_date >= issued_on),
  constraint finance_issued_invoice_totals_nonnegative check (
    subtotal_amount >= 0 and vat_amount >= 0 and total_amount >= 0
    and total_amount = subtotal_amount + vat_amount
  ),
  constraint finance_issued_invoice_reference_pair check (
    (payment_reference_type is null) = (payment_reference is null)
    and (payment_reference is null or btrim(payment_reference) <> '')
  ),
  constraint finance_issued_invoice_reference_type check (
    payment_reference_type is null or payment_reference_type in ('QRR', 'SCOR', 'NON')
  ),
  constraint finance_issued_invoice_pdf_pair check (
    pdf_generated_at is null or document_id is not null
  ),
  -- Implicazioni a senso unico: i timbri storici sopravvivono ai cambi di
  -- stato. Solo la bozza è una doppia implicazione: nessun timbro, mai.
  constraint finance_issued_invoice_draft_stamp check (
    (status = 'draft') = (issued_at is null)
  ),
  constraint finance_issued_invoice_sent_stamp check (
    status <> 'sent' or (sent_at is not null and sent_by is not null)
  ),
  constraint finance_issued_invoice_paid_stamp check (
    status <> 'paid' or (paid_at is not null and paid_on is not null)
  ),
  constraint finance_issued_invoice_overdue_stamp check (
    status <> 'overdue' or overdue_at is not null
  ),
  constraint finance_issued_invoice_voided_stamp check (
    status <> 'voided' or (
      voided_at is not null and btrim(coalesce(void_reason, '')) <> ''
      and credit_note_number is not null
    )
  )
);

create table if not exists public.finance_issued_invoice_items (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  invoice_id        uuid not null references public.finance_issued_invoices(id) on delete cascade,
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
  constraint uq_finance_issued_invoice_line unique (invoice_id, line_number),
  constraint finance_issued_invoice_line_positive check (line_number > 0),
  constraint finance_issued_invoice_item_description check (btrim(description) <> ''),
  constraint finance_issued_invoice_item_quantity check (quantity > 0),
  constraint finance_issued_invoice_item_price check (unit_price >= 0),
  constraint finance_issued_invoice_item_vat check (vat_rate >= 0 and vat_rate <= 100)
);

-- Ponte di provenienza: fattura, nota di credito e fino a tre solleciti,
-- ciascuno un Documento generato. Un documento non si sposta mai di fattura.
create table if not exists public.finance_issued_invoice_documents (
  id                uuid primary key default gen_random_uuid(),
  invoice_id        uuid not null references public.finance_issued_invoices(id) on delete cascade,
  kind              public.finance_issued_invoice_doc_kind not null,
  level             smallint,
  document_id       uuid not null unique references public.documents(id) on delete restrict,
  created_by        uuid not null,
  created_at        timestamptz not null default now(),
  constraint finance_issued_invoice_doc_level check (level between 1 and 3),
  constraint finance_issued_invoice_doc_kind_level check (
    (kind = 'reminder') = (level is not null)
  )
);

create index if not exists idx_finance_issued_invoices_org
  on public.finance_issued_invoices (company_id, organization_id, created_at desc);
create index if not exists idx_finance_issued_invoices_status_due
  on public.finance_issued_invoices (company_id, status, due_date);
create index if not exists idx_finance_issued_invoices_due
  on public.finance_issued_invoices (company_id, due_date);
create index if not exists idx_finance_issued_invoice_items_invoice
  on public.finance_issued_invoice_items (invoice_id, line_number);

-- Un solo PDF per tipo: una fattura, una nota di credito, un sollecito per livello.
create unique index if not exists uq_finance_issued_invoice_documents_invoice
  on public.finance_issued_invoice_documents (invoice_id) where kind = 'invoice';
create unique index if not exists uq_finance_issued_invoice_documents_credit_note
  on public.finance_issued_invoice_documents (invoice_id) where kind = 'credit_note';
create unique index if not exists uq_finance_issued_invoice_documents_reminder
  on public.finance_issued_invoice_documents (invoice_id, level) where kind = 'reminder';

comment on table public.finance_issued_invoices is
  'Fattura emessa verso un cliente CRM. Dopo l emissione è immutabile: le correzioni passano per annullo + nota di credito. Nessun movimento di denaro.';
comment on table public.finance_issued_invoice_items is
  'Righe della fattura. La valuta vive sulla testata: due valute non possono entrare nello stesso totale.';
comment on table public.finance_issued_invoice_documents is
  'Provenienza dichiarata dei PDF (fattura, nota di credito, solleciti) dentro Documenti.';

-- ---------------------------------------------------------------------------
-- 3. Guardiani cross-tenant, immutabilità e totali.
-- ---------------------------------------------------------------------------
create or replace function public.finance_issued_invoices_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_mode text := coalesce(current_setting('ai_swisse.invoice_write', true), '');
  v_new  public.finance_issued_invoices%rowtype;
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.crm_organizations g
       where g.id = new.organization_id and g.company_id = new.company_id
    ) then
      raise exception 'finance_issued_invoice_cross_tenant' using errcode = '23514';
    end if;
    if new.opportunity_id is not null and not exists (
      select 1 from public.crm_opportunities o
       where o.id = new.opportunity_id and o.company_id = new.company_id
         and o.organization_id = new.organization_id
    ) then
      raise exception 'finance_issued_invoice_cross_tenant' using errcode = '23514';
    end if;
    if new.quote_version_id is not null and not exists (
      select 1 from public.crm_quote_versions qv
       where qv.id = new.quote_version_id and qv.company_id = new.company_id
    ) then
      raise exception 'finance_issued_invoice_cross_tenant' using errcode = '23514';
    end if;
    if new.status <> 'draft' then
      raise exception 'finance_issued_invoice_must_start_draft' using errcode = '23514';
    end if;
    if auth.uid() is not null then new.created_by := auth.uid(); end if;
    -- Totali, timbri e documento nascono vuoti: li scrivono solo i percorsi
    -- con modalità. La bozza si costruisce da sola.
    new.subtotal_amount := 0; new.vat_amount := 0; new.total_amount := 0;
    new.credit_note_sequence_number := null; new.credit_note_number := null;
    new.document_id := null; new.pdf_generated_at := null;
    new.issued_at := null; new.issued_by := null;
    new.sent_at := null; new.sent_by := null; new.sent_email_id := null;
    new.paid_at := null; new.paid_by := null; new.paid_on := null;
    new.overdue_at := null;
    new.voided_at := null; new.voided_by := null; new.void_reason := null;
    new.created_at := now();
    return new;
  end if;

  -- Identità bloccata in qualunque modalità.
  new.id := old.id;
  new.company_id := old.company_id;
  new.organization_id := old.organization_id;
  new.opportunity_id := old.opportunity_id;
  new.quote_version_id := old.quote_version_id;
  new.sequence_number := old.sequence_number;
  new.invoice_number := old.invoice_number;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if v_mode = 'totals' then
    if old.status <> 'draft' then
      raise exception 'finance_issued_invoice_immutable' using errcode = '42501';
    end if;
    v_new := new; new := old;
    new.subtotal_amount := v_new.subtotal_amount;
    new.vat_amount := v_new.vat_amount;
    new.total_amount := v_new.total_amount;
    return new;
  end if;

  if v_mode = 'pdf' then
    if old.status <> 'draft' then
      raise exception 'finance_issued_invoice_immutable' using errcode = '42501';
    end if;
    v_new := new; new := old;
    new.document_id := v_new.document_id;
    new.pdf_generated_at := v_new.pdf_generated_at;
    new.payment_reference_type := v_new.payment_reference_type;
    new.payment_reference := v_new.payment_reference;
    return new;
  end if;

  if v_mode = 'issue' then
    if old.status <> 'draft' or new.status <> 'issued' then
      raise exception 'finance_issued_invoice_cannot_issue' using errcode = '42501';
    end if;
    if old.pdf_generated_at is null then
      raise exception 'finance_issued_invoice_pdf_required' using errcode = '23514';
    end if;
    if btrim(coalesce(old.company_bank_iban, '')) = '' then
      raise exception 'finance_issued_invoice_iban_required' using errcode = '23514';
    end if;
    if old.currency not in ('CHF', 'EUR') then
      raise exception 'finance_issued_invoice_currency_invalid' using errcode = '23514';
    end if;
    -- L'esistenza delle righe la impone la RPC finance_issue_invoice: il
    -- guardiano non rifà una query per riga a ogni transizione.
    v_new := new; new := old;
    new.status := 'issued';
    new.issued_at := v_new.issued_at;
    new.issued_by := v_new.issued_by;
    return new;
  end if;

  if v_mode = 'send' then
    if old.status = 'sent' and new.status = 'sent' then return old; end if;
    if old.status <> 'issued' or new.status <> 'sent' then
      raise exception 'finance_issued_invoice_cannot_send' using errcode = '42501';
    end if;
    v_new := new; new := old;
    new.status := 'sent';
    new.sent_at := v_new.sent_at;
    new.sent_by := v_new.sent_by;
    new.sent_email_id := v_new.sent_email_id;
    return new;
  end if;

  if v_mode = 'lifecycle' then
    if old.status not in ('issued', 'sent', 'overdue')
       or new.status not in ('paid', 'voided') then
      raise exception 'finance_issued_invoice_status_transition_invalid' using errcode = '42501';
    end if;
    v_new := new; new := old;
    if v_new.status = 'paid' then
      new.status := 'paid';
      new.paid_at := v_new.paid_at;
      new.paid_by := v_new.paid_by;
      new.paid_on := v_new.paid_on;
    else
      new.status := 'voided';
      new.voided_at := v_new.voided_at;
      new.voided_by := v_new.voided_by;
      new.void_reason := v_new.void_reason;
      new.credit_note_sequence_number := v_new.credit_note_sequence_number;
      new.credit_note_number := v_new.credit_note_number;
    end if;
    return new;
  end if;

  if v_mode = 'overdue' then
    if old.status not in ('issued', 'sent') or new.status <> 'overdue' then
      raise exception 'finance_issued_invoice_status_transition_invalid' using errcode = '42501';
    end if;
    v_new := new; new := old;
    new.status := 'overdue';
    new.overdue_at := v_new.overdue_at;
    return new;
  end if;

  -- Nessuna modalità: è il percorso bozze. Fuori da `draft` niente si tocca.
  if old.status <> 'draft' then
    raise exception 'finance_issued_invoice_immutable'
      using errcode = '42501',
            hint = 'Una fattura emessa non si modifica: si annulla e si emette una nota di credito.';
  end if;
  if new.status <> 'draft' then
    raise exception 'finance_issued_invoice_status_path_required' using errcode = '42501';
  end if;
  -- Cambiano solo i campi commerciali e gli snapshot; totali, documento,
  -- riferimenti e timbri restano quelli.
  new.subtotal_amount := old.subtotal_amount;
  new.vat_amount := old.vat_amount;
  new.total_amount := old.total_amount;
  new.credit_note_sequence_number := old.credit_note_sequence_number;
  new.credit_note_number := old.credit_note_number;
  new.document_id := old.document_id;
  new.payment_reference_type := old.payment_reference_type;
  new.payment_reference := old.payment_reference;
  new.issued_at := old.issued_at; new.issued_by := old.issued_by;
  new.sent_at := old.sent_at; new.sent_by := old.sent_by; new.sent_email_id := old.sent_email_id;
  new.paid_at := old.paid_at; new.paid_by := old.paid_by; new.paid_on := old.paid_on;
  new.overdue_at := old.overdue_at;
  new.voided_at := old.voided_at; new.voided_by := old.voided_by; new.void_reason := old.void_reason;
  -- Qualunque modifica commerciale rende il PDF precedente obsoleto.
  new.pdf_generated_at := null;
  return new;
end $$;

drop trigger if exists trg_finance_issued_invoices_guard on public.finance_issued_invoices;
create trigger trg_finance_issued_invoices_guard
  before insert or update on public.finance_issued_invoices
  for each row execute function public.finance_issued_invoices_guard();

create or replace function public.finance_issued_invoice_items_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice record;
begin
  select f.company_id, f.status into v_invoice
    from public.finance_issued_invoices f where f.id = new.invoice_id;
  if v_invoice.company_id is null or v_invoice.status <> 'draft' then
    raise exception 'finance_issued_invoice_item_immutable' using errcode = '42501';
  end if;
  if new.company_id is distinct from v_invoice.company_id then
    raise exception 'finance_issued_invoice_item_cross_tenant' using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_finance_issued_invoice_items_guard on public.finance_issued_invoice_items;
create trigger trg_finance_issued_invoice_items_guard
  -- DELETE resta protetta dai privilegi (authenticated ha solo SELECT) e deve
  -- poter avvenire per cascata quando si elimina l'azienda o la fattura.
  before insert or update on public.finance_issued_invoice_items
  for each row execute function public.finance_issued_invoice_items_guard();

create or replace function public.finance_issued_invoice_documents_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice_company uuid;
  v_doc_company uuid;
  v_source text;
begin
  if tg_op = 'UPDATE' then
    raise exception 'finance_issued_invoice_document_immutable' using errcode = '42501';
  end if;
  select f.company_id into v_invoice_company
    from public.finance_issued_invoices f where f.id = new.invoice_id;
  select d.company_id, d.source_type::text into v_doc_company, v_source
    from public.documents d where d.id = new.document_id;
  if v_invoice_company is null or v_doc_company is null or v_source <> 'generated'
     or v_doc_company is distinct from v_invoice_company then
    raise exception 'finance_issued_invoice_document_cross_tenant' using errcode = '23514';
  end if;
  if (new.kind = 'reminder') <> (new.level is not null) then
    raise exception 'finance_issued_invoice_document_invalid' using errcode = '23514';
  end if;
  if auth.uid() is not null then new.created_by := auth.uid(); end if;
  return new;
end $$;

drop trigger if exists trg_finance_issued_invoice_documents_guard on public.finance_issued_invoice_documents;
create trigger trg_finance_issued_invoice_documents_guard
  before insert or update on public.finance_issued_invoice_documents
  for each row execute function public.finance_issued_invoice_documents_guard();

-- Totali SQL decimali, mai JavaScript in virgola mobile.
create or replace function public.finance_issued_invoice_refresh_totals(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform set_config('ai_swisse.invoice_write', 'totals', true);
  update public.finance_issued_invoices f set
    subtotal_amount = x.subtotal,
    vat_amount = x.vat,
    total_amount = x.total
  from (
    select coalesce(sum(i.net_amount), 0)::numeric(14,2) as subtotal,
           coalesce(sum(i.vat_amount), 0)::numeric(14,2) as vat,
           coalesce(sum(i.total_amount), 0)::numeric(14,2) as total
      from public.finance_issued_invoice_items i where i.invoice_id = p_invoice_id
  ) x
  where f.id = p_invoice_id;
end $$;

create or replace function public.finance_issued_invoice_items_refresh_totals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.finance_issued_invoice_refresh_totals(coalesce(new.invoice_id, old.invoice_id));
  return coalesce(new, old);
end $$;

drop trigger if exists trg_finance_issued_invoice_items_refresh_totals on public.finance_issued_invoice_items;
create trigger trg_finance_issued_invoice_items_refresh_totals
  after insert or update or delete on public.finance_issued_invoice_items
  for each row execute function public.finance_issued_invoice_items_refresh_totals();

-- ---------------------------------------------------------------------------
-- 4. RPC: bozza, emissione, ciclo di vita, payload e registrazione PDF.
-- ---------------------------------------------------------------------------
create or replace function public.finance_save_issued_invoice_draft(
  p_company_id uuid,
  p_invoice_id uuid default null,
  p_organization_id uuid default null,
  p_opportunity_id uuid default null,
  p_quote_version_id uuid default null,
  p_language public.finance_issued_invoice_language default null,
  p_currency text default null,
  p_title text default null,
  p_notes text default null,
  p_issued_on date default null,
  p_due_date date default null,
  p_items jsonb default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.finance_issued_invoices%rowtype;
  v_company public.companies%rowtype;
  v_org public.crm_organizations%rowtype;
  v_item jsonb;
  v_rate public.finance_vat_rates%rowtype;
  v_line integer := 0;
  v_sequence integer;
  v_currency text := upper(btrim(coalesce(p_currency, '')));
begin
  if auth.uid() is null then raise exception 'finance_issued_invoice_unauthenticated' using errcode = '28000'; end if;
  if not public.is_company_member(p_company_id) then raise exception 'finance_issued_invoice_forbidden' using errcode = '42501'; end if;
  if p_organization_id is null or p_language is null or p_issued_on is null or p_due_date is null
     or btrim(coalesce(p_title, '')) = '' or v_currency !~ '^[A-Z]{3}$'
     or p_due_date < p_issued_on
     or p_items is null or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) < 1 or jsonb_array_length(p_items) > 100 then
    raise exception 'finance_issued_invoice_invalid' using errcode = '22023';
  end if;

  select * into v_org from public.crm_organizations g
   where g.id = p_organization_id and g.company_id = p_company_id;
  if v_org.id is null then raise exception 'finance_issued_invoice_cross_tenant' using errcode = '23514'; end if;
  if p_opportunity_id is not null and not exists (
    select 1 from public.crm_opportunities o
     where o.id = p_opportunity_id and o.company_id = p_company_id
       and o.organization_id = p_organization_id
  ) then raise exception 'finance_issued_invoice_cross_tenant' using errcode = '23514'; end if;
  if p_quote_version_id is not null and not exists (
    select 1 from public.crm_quote_versions qv
     where qv.id = p_quote_version_id and qv.company_id = p_company_id
       and (p_opportunity_id is null or qv.opportunity_id = p_opportunity_id)
  ) then raise exception 'finance_issued_invoice_cross_tenant' using errcode = '23514'; end if;
  select * into v_company from public.companies where id = p_company_id;

  if p_invoice_id is null then
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 0));
    select coalesce(max(f.sequence_number), 0) + 1 into v_sequence
      from public.finance_issued_invoices f where f.company_id = p_company_id;
    insert into public.finance_issued_invoices (
      company_id, organization_id, opportunity_id, quote_version_id,
      sequence_number, invoice_number, language, currency, title, notes,
      issued_on, due_date,
      company_legal_name, company_uid_che, company_street, company_postal_code,
      company_city, company_country_code, company_logo_storage_path, company_logo_mime_type,
      company_bank_iban,
      customer_display_name, customer_street, customer_postal_code, customer_city,
      customer_country_code, created_by
    ) values (
      p_company_id, p_organization_id, p_opportunity_id, p_quote_version_id,
      v_sequence, 'F-' || lpad(v_sequence::text, 6, '0'), p_language, v_currency,
      btrim(p_title), nullif(btrim(p_notes), ''), p_issued_on, p_due_date,
      v_company.legal_name, v_company.uid_che, v_company.street, v_company.postal_code,
      coalesce(v_company.city, v_company.municipality), coalesce(v_company.country_code, 'CH'),
      v_company.logo_storage_path, v_company.logo_mime_type, v_company.bank_iban,
      v_org.display_name, v_org.street, v_org.postal_code, v_org.city, v_org.country_code,
      auth.uid()
    ) returning * into v_invoice;
  else
    select * into v_invoice from public.finance_issued_invoices f
      where f.id = p_invoice_id and f.company_id = p_company_id
      for update;
    if v_invoice.id is null then raise exception 'finance_issued_invoice_cross_tenant' using errcode = '23514'; end if;
    if v_invoice.status <> 'draft' then
      raise exception 'finance_issued_invoice_immutable' using errcode = '42501';
    end if;
    if p_organization_id is distinct from v_invoice.organization_id
       or p_opportunity_id is distinct from v_invoice.opportunity_id
       or p_quote_version_id is distinct from v_invoice.quote_version_id then
      raise exception 'finance_issued_invoice_cross_tenant' using errcode = '23514';
    end if;
    update public.finance_issued_invoices set
      language = p_language, currency = v_currency, title = btrim(p_title),
      notes = nullif(btrim(p_notes), ''), issued_on = p_issued_on, due_date = p_due_date,
      company_legal_name = v_company.legal_name, company_uid_che = v_company.uid_che,
      company_street = v_company.street, company_postal_code = v_company.postal_code,
      company_city = coalesce(v_company.city, v_company.municipality),
      company_country_code = coalesce(v_company.country_code, 'CH'),
      company_logo_storage_path = v_company.logo_storage_path,
      company_logo_mime_type = v_company.logo_mime_type,
      company_bank_iban = v_company.bank_iban,
      customer_display_name = v_org.display_name, customer_street = v_org.street,
      customer_postal_code = v_org.postal_code, customer_city = v_org.city,
      customer_country_code = v_org.country_code
    where id = v_invoice.id returning * into v_invoice;
    delete from public.finance_issued_invoice_items where invoice_id = v_invoice.id;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_line := v_line + 1;
    if btrim(coalesce(v_item->>'description', '')) = ''
       or coalesce((v_item->>'quantity')::numeric, 0) <= 0
       or coalesce((v_item->>'unitPrice')::numeric, -1) < 0 then
      raise exception 'finance_issued_invoice_item_invalid' using errcode = '22023';
    end if;
    select * into v_rate from public.finance_vat_rates r
      where r.id = (v_item->>'vatRateId')::uuid and r.country_code = 'CH'
        and r.valid_from <= p_issued_on and (r.valid_to is null or r.valid_to >= p_issued_on);
    if v_rate.id is null then raise exception 'finance_issued_invoice_vat_rate_invalid' using errcode = '22023'; end if;
    insert into public.finance_issued_invoice_items (
      company_id, invoice_id, line_number, description,
      quantity, unit_price, vat_rate_id, vat_rate, vat_source_url,
      vat_source_title, vat_checked_at
    ) values (
      p_company_id, v_invoice.id, v_line,
      left(btrim(v_item->>'description'), 500), (v_item->>'quantity')::numeric,
      (v_item->>'unitPrice')::numeric, v_rate.id, v_rate.rate,
      v_rate.source_url, v_rate.source_title, v_rate.checked_at
    );
  end loop;
  return v_invoice.id;
exception when invalid_text_representation or numeric_value_out_of_range then
  raise exception 'finance_issued_invoice_item_invalid' using errcode = '22023';
end $$;

create or replace function public.finance_issue_invoice(p_company_id uuid, p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice public.finance_issued_invoices%rowtype;
begin
  if auth.uid() is null then raise exception 'finance_issued_invoice_unauthenticated' using errcode = '28000'; end if;
  if not public.is_company_member(p_company_id) then raise exception 'finance_issued_invoice_forbidden' using errcode = '42501'; end if;
  select * into v_invoice from public.finance_issued_invoices f
    where f.id = p_invoice_id and f.company_id = p_company_id
    for update;
  if v_invoice.id is null then raise exception 'finance_issued_invoice_not_found' using errcode = 'P0002'; end if;
  if v_invoice.status <> 'draft' then
    raise exception 'finance_issued_invoice_immutable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.finance_issued_invoice_items i where i.invoice_id = v_invoice.id
  ) then raise exception 'finance_issued_invoice_no_items' using errcode = '23514'; end if;
  perform set_config('ai_swisse.invoice_write', 'issue', true);
  update public.finance_issued_invoices set
    status = 'issued', issued_at = now(), issued_by = auth.uid()
  where id = v_invoice.id;
end $$;

create or replace function public.finance_set_issued_invoice_status(
  p_company_id uuid,
  p_invoice_id uuid,
  p_status text,
  p_paid_on date default null,
  p_void_reason text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cn_sequence integer;
begin
  if auth.uid() is null then raise exception 'finance_issued_invoice_unauthenticated' using errcode = '28000'; end if;
  if not public.is_company_member(p_company_id) then raise exception 'finance_issued_invoice_forbidden' using errcode = '42501'; end if;
  if p_status not in ('paid', 'voided') then
    raise exception 'finance_issued_invoice_status_transition_invalid' using errcode = '22023';
  end if;
  if p_status = 'voided' and btrim(coalesce(p_void_reason, '')) = '' then
    raise exception 'finance_issued_invoice_void_reason_required' using errcode = '22023';
  end if;
  perform set_config('ai_swisse.invoice_write', 'lifecycle', true);
  if p_status = 'paid' then
    update public.finance_issued_invoices set
      status = 'paid', paid_at = now(), paid_by = auth.uid(),
      paid_on = coalesce(p_paid_on, current_date)
    where id = p_invoice_id and company_id = p_company_id
      and status in ('issued', 'sent', 'overdue');
  else
    perform pg_advisory_xact_lock(hashtextextended(p_company_id::text, 0));
    select coalesce(max(f.credit_note_sequence_number), 0) + 1 into v_cn_sequence
      from public.finance_issued_invoices f where f.company_id = p_company_id;
    update public.finance_issued_invoices set
      status = 'voided', voided_at = now(), voided_by = auth.uid(),
      void_reason = btrim(p_void_reason),
      credit_note_sequence_number = v_cn_sequence,
      credit_note_number = 'NC-' || lpad(v_cn_sequence::text, 6, '0')
    where id = p_invoice_id and company_id = p_company_id
      and status in ('issued', 'sent', 'overdue');
  end if;
  if not found then
    raise exception 'finance_issued_invoice_status_transition_invalid' using errcode = '42501';
  end if;
end $$;

-- Payload unico letto dalla Edge Function attraverso il JWT della persona.
-- Le regole di tipo stanno qui: la fattura solo in bozza, la nota di credito
-- solo su annullata, il sollecito solo su emessa/invitta/scaduta con livello.
create or replace function public.finance_issued_invoice_pdf_payload(
  p_company_id uuid,
  p_invoice_id uuid,
  p_kind text default 'invoice',
  p_level integer default null
)
returns jsonb
language sql
security invoker
set search_path = ''
stable
as $$
  select jsonb_build_object(
    'invoiceId', f.id, 'invoiceNumber', f.invoice_number,
    'creditNoteNumber', f.credit_note_number,
    'status', f.status, 'language', f.language, 'currency', f.currency,
    'title', f.title, 'notes', f.notes,
    'issuedOn', f.issued_on, 'dueDate', f.due_date,
    'subtotal', f.subtotal_amount::text, 'vatTotal', f.vat_amount::text,
    'total', f.total_amount::text,
    'organizationId', f.organization_id, 'opportunityId', f.opportunity_id,
    'quoteVersionId', f.quote_version_id, 'documentId', f.document_id,
    'kind', p_kind, 'level', p_level,
    'referenceType', f.payment_reference_type, 'reference', f.payment_reference,
    'company', jsonb_build_object(
      'legalName', f.company_legal_name, 'uidChe', f.company_uid_che,
      'street', f.company_street, 'postalCode', f.company_postal_code,
      'city', f.company_city, 'countryCode', f.company_country_code,
      'logoStoragePath', f.company_logo_storage_path, 'logoMimeType', f.company_logo_mime_type,
      'bankIban', f.company_bank_iban
    ),
    'customer', jsonb_build_object(
      'displayName', f.customer_display_name, 'street', f.customer_street,
      'postalCode', f.customer_postal_code, 'city', f.customer_city,
      'countryCode', f.customer_country_code
    ),
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'lineNumber', i.line_number, 'description', i.description,
        'quantity', i.quantity, 'unitPrice', i.unit_price, 'vatRate', i.vat_rate,
        'vatSourceUrl', i.vat_source_url, 'vatSourceTitle', i.vat_source_title,
        'vatCheckedAt', i.vat_checked_at, 'netAmount', i.net_amount,
        'vatAmount', i.vat_amount, 'totalAmount', i.total_amount
      ) order by i.line_number)
      from public.finance_issued_invoice_items i where i.invoice_id = f.id
    ), '[]'::jsonb)
  )
  from public.finance_issued_invoices f
  where f.id = p_invoice_id and f.company_id = p_company_id
    and public.is_company_member(p_company_id)
    and case p_kind
          when 'invoice' then f.status = 'draft'
          when 'credit_note' then f.status = 'voided'
          when 'reminder' then f.status in ('issued', 'sent', 'overdue')
                            and p_level between 1 and 3
          else false
        end;
$$;

-- Solo la funzione server registra il file realmente caricato nello Storage.
create or replace function public.finance_register_issued_invoice_pdf(
  p_company_id uuid,
  p_invoice_id uuid,
  p_kind text,
  p_level integer,
  p_document_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_invoice record;
  v_existing uuid;
begin
  select f.id, f.organization_id, f.opportunity_id, f.status, f.created_by,
         d.company_id as document_company, d.source_type::text as source_type
    into v_invoice
    from public.finance_issued_invoices f
    join public.documents d on d.id = p_document_id
   where f.id = p_invoice_id and f.company_id = p_company_id;
  if v_invoice.id is null or v_invoice.document_company is distinct from p_company_id
     or v_invoice.source_type <> 'generated' then
    raise exception 'finance_issued_invoice_document_cross_tenant' using errcode = '23514';
  end if;
  if p_kind = 'invoice' then
    if v_invoice.status <> 'draft' then
      raise exception 'finance_issued_invoice_document_invalid' using errcode = '23514';
    end if;
  elsif p_kind = 'credit_note' then
    if v_invoice.status <> 'voided' then
      raise exception 'finance_issued_invoice_document_invalid' using errcode = '23514';
    end if;
  elsif p_kind = 'reminder' then
    if v_invoice.status not in ('issued', 'sent', 'overdue')
       or p_level is null or p_level not between 1 and 3 then
      raise exception 'finance_issued_invoice_document_invalid' using errcode = '23514';
    end if;
  else
    raise exception 'finance_issued_invoice_document_invalid' using errcode = '23514';
  end if;
  -- Un documento DIVERSO già registrato per lo stesso tipo/livello è un
  -- conflitto; lo stesso documento registrato due volte è un retry.
  select fd.document_id into v_existing
    from public.finance_issued_invoice_documents fd
   where fd.invoice_id = p_invoice_id
     and fd.kind = p_kind::public.finance_issued_invoice_doc_kind
     and (p_kind <> 'reminder' or fd.level = p_level)
   limit 1;
  if v_existing is not null and v_existing <> p_document_id then
    raise exception 'finance_issued_invoice_document_conflict' using errcode = '23514';
  end if;
  -- created_by: con il service role auth.uid() è NULL e la macchina non si
  -- attribuisce a una persona; resta il creatore della fattura come origine
  -- della riga, sostituito da auth.uid() quando la chiamata porta un utente.
  insert into public.finance_issued_invoice_documents (
    invoice_id, kind, level, document_id, created_by
  ) values (
    p_invoice_id, p_kind::public.finance_issued_invoice_doc_kind,
    case when p_kind = 'reminder' then p_level else null end,
    p_document_id, coalesce(auth.uid(), v_invoice.created_by)
  )
  on conflict do nothing;
  -- Il PDF vive anche nella scheda CRM del cliente, come i preventivi (0049).
  insert into public.crm_organization_documents (
    company_id, organization_id, document_id, relation, match_reason
  ) values (p_company_id, v_invoice.organization_id, p_document_id, 'customer', 'manual')
  on conflict (organization_id, document_id) do nothing;
  if v_invoice.opportunity_id is not null then
    insert into public.crm_opportunity_documents (
      company_id, opportunity_id, document_id
    ) values (p_company_id, v_invoice.opportunity_id, p_document_id)
    on conflict (opportunity_id, document_id) do nothing;
  end if;
  if p_kind = 'invoice' then
    perform set_config('ai_swisse.invoice_write', 'pdf', true);
    update public.finance_issued_invoices set
      document_id = p_document_id, pdf_generated_at = now()
    where id = p_invoice_id;
  end if;
end $$;

-- Chiamata da send-crm-email DOPO l'accettazione del provider, sul modello di
-- crm_mark_attached_quotes_sent (0049): i documenti arrivano dagli allegati
-- della email registrata, non dal body del browser.
create or replace function public.finance_mark_attached_invoices_sent(
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
  ) then raise exception 'finance_issued_invoice_email_not_sent' using errcode = '23514'; end if;
  perform set_config('ai_swisse.invoice_write', 'send', true);
  update public.finance_issued_invoices f set
    status = 'sent', sent_at = now(), sent_by = m.sent_by, sent_email_id = m.id
  from public.finance_issued_invoice_documents fd
  join public.crm_outgoing_email_attachments a on a.document_id = fd.document_id
  join public.email_messages m on m.id = a.email_message_id
  where f.id = fd.invoice_id and f.company_id = p_company_id
    and fd.kind = 'invoice'
    and a.email_message_id = p_email_message_id and f.status = 'issued'
    and f.pdf_generated_at is not null and f.document_id = fd.document_id;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Scadenza superata: lo stato cambia una volta e l'evento parte una volta —
-- la chiave di deduplicazione rende l'emissione idempotente, sul modello di
-- automation_emit_overdue (0020). Chi paga una fattura già scaduta la porta
-- da `overdue` a `paid` senza rientrare mai in questa scansione.
create or replace function public.finance_emit_issued_invoice_overdue(
  p_lookback_days integer default 3,
  p_limit integer default 200
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_id uuid;
  v_count integer := 0;
begin
  for r in
    select f.id, f.company_id, f.invoice_number, f.organization_id,
           f.due_date, f.total_amount, f.currency
      from public.finance_issued_invoices f
     where f.status in ('issued', 'sent')
       and f.due_date < current_date
       and f.due_date >= current_date - greatest(1, least(coalesce(p_lookback_days, 3), 30))
     order by f.due_date desc
     limit greatest(1, least(coalesce(p_limit, 200), 1000))
  loop
    perform set_config('ai_swisse.invoice_write', 'overdue', true);
    update public.finance_issued_invoices f set
      status = 'overdue', overdue_at = now()
    where f.id = r.id and f.status in ('issued', 'sent');
    if not found then continue; end if;
    v_id := public.automation_emit(
      r.company_id, 'finance_issued_invoice_overdue', 'finance_issued_invoice', r.id,
      jsonb_build_object(
        'invoice_number', r.invoice_number, 'organization_id', r.organization_id,
        'due_date', r.due_date, 'total_amount', r.total_amount, 'currency', r.currency
      ),
      'fininv:' || r.id::text || ':overdue:' || r.due_date::text,
      null
    );
    if v_id is not null then v_count := v_count + 1; end if;
  end loop;
  return v_count;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS, permessi minimi e autoverifica.
-- ---------------------------------------------------------------------------
alter table public.finance_issued_invoices enable row level security;
alter table public.finance_issued_invoice_items enable row level security;
alter table public.finance_issued_invoice_documents enable row level security;

revoke all on public.finance_issued_invoices from anon, authenticated, public;
revoke all on public.finance_issued_invoice_items from anon, authenticated, public;
revoke all on public.finance_issued_invoice_documents from anon, authenticated, public;

grant select on public.finance_issued_invoices to authenticated;
grant select on public.finance_issued_invoice_items to authenticated;
grant select on public.finance_issued_invoice_documents to authenticated;

drop policy if exists finance_issued_invoices_select_member on public.finance_issued_invoices;
create policy finance_issued_invoices_select_member on public.finance_issued_invoices for select to authenticated
  using ((select public.is_company_member(company_id)));
drop policy if exists finance_issued_invoice_items_select_member on public.finance_issued_invoice_items;
create policy finance_issued_invoice_items_select_member on public.finance_issued_invoice_items for select to authenticated
  using ((select public.is_company_member(company_id)));
-- Il ponte non ha company_id: il tenant si legge dalla fattura padre.
drop policy if exists finance_issued_invoice_documents_select_member on public.finance_issued_invoice_documents;
create policy finance_issued_invoice_documents_select_member on public.finance_issued_invoice_documents for select to authenticated
  using (exists (
    select 1 from public.finance_issued_invoices f
     where f.id = invoice_id
       and (select public.is_company_member(f.company_id))
  ));

revoke all on function public.finance_issued_invoice_refresh_totals(uuid) from public, anon, authenticated;
revoke all on function public.finance_save_issued_invoice_draft(uuid, uuid, uuid, uuid, uuid, public.finance_issued_invoice_language, text, text, text, date, date, jsonb) from public, anon;
revoke all on function public.finance_issue_invoice(uuid, uuid) from public, anon;
revoke all on function public.finance_set_issued_invoice_status(uuid, uuid, text, date, text) from public, anon;
revoke all on function public.finance_issued_invoice_pdf_payload(uuid, uuid, text, integer) from public, anon;
revoke all on function public.finance_register_issued_invoice_pdf(uuid, uuid, text, integer, uuid) from public, anon, authenticated;
revoke all on function public.finance_mark_attached_invoices_sent(uuid, uuid) from public, anon, authenticated;
revoke all on function public.finance_emit_issued_invoice_overdue(integer, integer) from public, anon, authenticated;

grant execute on function public.finance_save_issued_invoice_draft(uuid, uuid, uuid, uuid, uuid, public.finance_issued_invoice_language, text, text, text, date, date, jsonb) to authenticated;
grant execute on function public.finance_issue_invoice(uuid, uuid) to authenticated;
grant execute on function public.finance_set_issued_invoice_status(uuid, uuid, text, date, text) to authenticated;
grant execute on function public.finance_issued_invoice_pdf_payload(uuid, uuid, text, integer) to authenticated;
grant execute on function public.finance_register_issued_invoice_pdf(uuid, uuid, text, integer, uuid) to service_role;
grant execute on function public.finance_mark_attached_invoices_sent(uuid, uuid) to service_role;
grant execute on function public.finance_emit_issued_invoice_overdue(integer, integer) to service_role;
grant execute on function public.finance_issued_invoice_refresh_totals(uuid) to service_role;

do $$
declare
  v_bad text;
begin
  select string_agg(c.relname, ', ') into v_bad
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('finance_issued_invoices', 'finance_issued_invoice_items', 'finance_issued_invoice_documents')
     and not c.relrowsecurity;
  if v_bad is not null then raise exception '0053: RLS non attiva su %', v_bad; end if;

  select string_agg(p.table_name || ':' || p.privilege_type, ', ') into v_bad
    from information_schema.role_table_grants p
   where p.table_schema = 'public'
     and p.table_name in ('finance_issued_invoices', 'finance_issued_invoice_items', 'finance_issued_invoice_documents')
     and lower(p.grantee) in ('anon', 'public');
  if v_bad is not null then raise exception '0053: privilegi anon/public inattesi: %', v_bad; end if;

  select string_agg(p.table_name || ':' || p.privilege_type, ', ') into v_bad
    from information_schema.role_table_grants p
   where p.table_schema = 'public'
     and p.table_name in ('finance_issued_invoices', 'finance_issued_invoice_items', 'finance_issued_invoice_documents')
     and lower(p.grantee) = 'authenticated' and p.privilege_type <> 'SELECT';
  if v_bad is not null then raise exception '0053: il client può scrivere le tabelle fatture: %', v_bad; end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'companies' and column_name = 'bank_iban'
  ) then raise exception '0053: companies.bank_iban mancante'; end if;

  -- Il valore enum aggiunto in testa NON si può asserire qui: nominare
  -- l'etichetta in un blocco `do` è esattamente l'uso 55P04 che il generatore
  -- del bundle (scripts/bundle-migrations.mjs) vieta nello stesso file.
end $$;
