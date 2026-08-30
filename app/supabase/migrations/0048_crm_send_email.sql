-- ============================================================================
-- AI-Swisse — 0048 INVIO EMAIL DAL CRM (Fase 1.1)
--
-- La casella collegata resta un'integrazione di SOLA LETTURA: le righe `in`
-- arrivano soltanto dalla sincronizzazione Gmail/Microsoft. Questa migrazione
-- aggiunge invece le righe `out`, inviate dal provider transazionale del
-- progetto. Non esiste, e non viene richiesto, alcuno scope Gmail di invio.
--
-- Un destinatario uscente è sempre un recapito email già registrato nel CRM.
-- Non è possibile scrivere a un indirizzo libero: una relazione commerciale
-- deve prima avere un'anagrafica verificabile e cancellabile.
-- ============================================================================

do $$ begin
  create type public.email_direction as enum ('in', 'out');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.crm_email_delivery_status as enum ('sent', 'delivered', 'failed');
exception when duplicate_object then null; end $$;

-- Le email importate mantengono la loro connessione readonly; le uscenti non
-- provengono da una casella OAuth e quindi non ne hanno una.
alter table public.email_messages alter column connection_id drop not null;
alter table public.email_messages
  add column if not exists direction public.email_direction not null default 'in',
  add column if not exists delivery_status public.crm_email_delivery_status,
  add column if not exists delivery_error_safe text,
  add column if not exists delivery_provider_id text,
  add column if not exists send_idempotency_key uuid,
  add column if not exists sent_by uuid references auth.users(id) on delete set null;

alter table public.email_messages
  drop constraint if exists email_messages_direction_source;
alter table public.email_messages
  add constraint email_messages_direction_source check (
    (direction = 'in' and connection_id is not null and delivery_status is null)
    or (direction = 'out' and connection_id is null and delivery_status is not null)
  );

create unique index if not exists uq_email_messages_outgoing_idempotency
  on public.email_messages (company_id, send_idempotency_key)
  where direction = 'out';
create index if not exists idx_email_messages_outgoing_delivery
  on public.email_messages (company_id, delivery_status, sent_at desc, id desc)
  where direction = 'out';

comment on column public.email_messages.direction is
  'in = importata dalla casella OAuth readonly; out = inviata dal CRM via provider transazionale, mai Gmail API.';
comment on column public.email_messages.delivery_status is
  'Solo email CRM uscenti: sent (accettata dal provider), delivered (webhook provider), failed. last_contact_at usa solo delivered.';

-- Una trattativa ha il suo collegamento, distinto dai documenti: una email non
-- e' un documento e non va forzata nel ponte crm_opportunity_documents.
create table if not exists public.crm_opportunity_emails (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  opportunity_id uuid not null references public.crm_opportunities(id) on delete cascade,
  email_message_id uuid not null references public.email_messages(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint uq_crm_opportunity_email unique (opportunity_id, email_message_id)
);

create table if not exists public.crm_outgoing_email_recipients (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email_message_id uuid not null references public.email_messages(id) on delete cascade,
  contact_method_id uuid not null references public.crm_contact_methods(id) on delete restrict,
  email_address text not null,
  created_at timestamptz not null default now(),
  constraint uq_crm_outgoing_recipient unique (email_message_id, contact_method_id)
);

create table if not exists public.crm_outgoing_email_attachments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  email_message_id uuid not null references public.email_messages(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint uq_crm_outgoing_attachment unique (email_message_id, document_id)
);

-- Un modello e' una famiglia con una variante per lingua; cancellarlo
-- distruggerebbe i riferimenti, quindi si archivia come le altre anagrafiche.
create table if not exists public.crm_email_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null check (btrim(name) <> ''),
  archived_at timestamptz,
  archived_by uuid references auth.users(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists uq_crm_email_template_name_active
  on public.crm_email_templates(company_id, lower(name)) where archived_at is null;

create table if not exists public.crm_email_template_translations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  template_id uuid not null references public.crm_email_templates(id) on delete cascade,
  locale text not null check (locale in ('it', 'de', 'fr')),
  subject text not null check (btrim(subject) <> ''),
  body_text text not null check (btrim(body_text) <> ''),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint uq_crm_email_template_locale unique(template_id, locale)
);

create table if not exists public.crm_user_email_signatures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  locale text not null check (locale in ('it', 'de', 'fr')),
  body_text text not null default '',
  updated_at timestamptz not null default now(),
  constraint uq_crm_user_email_signature unique(company_id, user_id, locale)
);

-- Ogni ponte dichiara i tre tenant coinvolti: la RLS protegge il browser, il
-- guardiano protegge anche l'Edge Function e il service role da un id errato.
create or replace function public.crm_guard_outgoing_email_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_email_company uuid; v_method_company uuid; v_method_type public.crm_contact_method_type;
begin
  select company_id into v_email_company from public.email_messages where id = new.email_message_id;
  if v_email_company is distinct from new.company_id then raise exception 'crm_email_company_mismatch' using errcode = '23514'; end if;
  if tg_table_name = 'crm_opportunity_emails' then
    if not exists (select 1 from public.crm_opportunities where id = new.opportunity_id and company_id = new.company_id)
    then raise exception 'crm_opportunity_email_company_mismatch' using errcode = '23514'; end if;
  elsif tg_table_name = 'crm_outgoing_email_recipients' then
    select company_id, type into v_method_company, v_method_type from public.crm_contact_methods where id = new.contact_method_id;
    if v_method_company is distinct from new.company_id or v_method_type is distinct from 'email'::public.crm_contact_method_type
    then raise exception 'crm_email_recipient_not_registered' using errcode = '23514'; end if;
  elsif tg_table_name = 'crm_outgoing_email_attachments' then
    if not exists (select 1 from public.documents where id = new.document_id and company_id = new.company_id)
    then raise exception 'crm_email_attachment_company_mismatch' using errcode = '23514'; end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_crm_opportunity_emails_guard on public.crm_opportunity_emails;
create trigger trg_crm_opportunity_emails_guard before insert or update on public.crm_opportunity_emails for each row execute function public.crm_guard_outgoing_email_link();
drop trigger if exists trg_crm_outgoing_email_recipients_guard on public.crm_outgoing_email_recipients;
create trigger trg_crm_outgoing_email_recipients_guard before insert or update on public.crm_outgoing_email_recipients for each row execute function public.crm_guard_outgoing_email_link();
drop trigger if exists trg_crm_outgoing_email_attachments_guard on public.crm_outgoing_email_attachments;
create trigger trg_crm_outgoing_email_attachments_guard before insert or update on public.crm_outgoing_email_attachments for each row execute function public.crm_guard_outgoing_email_link();

-- Contatto = email importata, chiamata/incontro, oppure una CONSEGNA riuscita.
-- Un'accettazione dal provider ('sent') non basta: puo' ancora fallire dopo.
create or replace function public.crm_refresh_last_contact(p_organization_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_last timestamptz;
begin
  select max(d) into v_last from (
    select max(coalesce(e.sent_at, e.received_at)) as d
      from public.crm_organization_emails l join public.email_messages e on e.id = l.email_message_id
     where l.organization_id = p_organization_id
       and (e.direction = 'in' or e.delivery_status = 'delivered')
    union all
    select max(i.occurred_at) from public.crm_interactions i
     where i.organization_id = p_organization_id and i.type in ('call', 'meeting')
  ) s;
  perform set_config('ai_swisse.crm_internal', 'on', true);
  update public.crm_organizations set last_contact_at = v_last where id = p_organization_id and last_contact_at is distinct from v_last;
  perform set_config('ai_swisse.crm_internal', '', true);
end $$;

-- L'esito di una mail uscente puo' cambiare dopo l'inserimento; ricalcola tutte
-- le organizzazioni a cui e' collegata senza scrivere contenuto in crm_events.
create or replace function public.crm_touch_last_contact_from_email()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select organization_id from public.crm_organization_emails where email_message_id = new.id loop
    perform public.crm_refresh_last_contact(r.organization_id);
  end loop;
  return null;
end $$;
drop trigger if exists trg_crm_outgoing_email_delivery_touch on public.email_messages;
create trigger trg_crm_outgoing_email_delivery_touch after update of delivery_status on public.email_messages
  for each row when (new.direction = 'out') execute function public.crm_touch_last_contact_from_email();

alter table public.crm_opportunity_emails enable row level security;
alter table public.crm_outgoing_email_recipients enable row level security;
alter table public.crm_outgoing_email_attachments enable row level security;
alter table public.crm_email_templates enable row level security;
alter table public.crm_email_template_translations enable row level security;
alter table public.crm_user_email_signatures enable row level security;

drop policy if exists crm_opp_emails_select on public.crm_opportunity_emails;
create policy crm_opp_emails_select on public.crm_opportunity_emails for select using (public.is_company_member(company_id));
drop policy if exists crm_outgoing_recipients_select on public.crm_outgoing_email_recipients;
create policy crm_outgoing_recipients_select on public.crm_outgoing_email_recipients for select using (public.is_company_member(company_id));
drop policy if exists crm_outgoing_attachments_select on public.crm_outgoing_email_attachments;
create policy crm_outgoing_attachments_select on public.crm_outgoing_email_attachments for select using (public.is_company_member(company_id));
drop policy if exists crm_email_templates_select on public.crm_email_templates;
create policy crm_email_templates_select on public.crm_email_templates for select using (public.is_company_member(company_id));
drop policy if exists crm_email_template_translations_select on public.crm_email_template_translations;
create policy crm_email_template_translations_select on public.crm_email_template_translations for select using (public.is_company_member(company_id));
drop policy if exists crm_email_signatures_select on public.crm_user_email_signatures;
create policy crm_email_signatures_select on public.crm_user_email_signatures for select using (public.is_company_member(company_id));
drop policy if exists crm_email_signatures_write on public.crm_user_email_signatures;
create policy crm_email_signatures_write on public.crm_user_email_signatures for all using (user_id = auth.uid() and public.is_company_member(company_id)) with check (user_id = auth.uid() and public.is_company_member(company_id));
drop policy if exists crm_email_templates_admin on public.crm_email_templates;
create policy crm_email_templates_admin on public.crm_email_templates for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));
drop policy if exists crm_email_template_translations_admin on public.crm_email_template_translations;
create policy crm_email_template_translations_admin on public.crm_email_template_translations for all using (public.is_company_admin(company_id)) with check (public.is_company_admin(company_id));

revoke all on public.crm_opportunity_emails, public.crm_outgoing_email_recipients, public.crm_outgoing_email_attachments, public.crm_email_templates, public.crm_email_template_translations, public.crm_user_email_signatures from anon, authenticated, public;
grant select on public.crm_opportunity_emails, public.crm_outgoing_email_recipients, public.crm_outgoing_email_attachments, public.crm_email_templates, public.crm_email_template_translations, public.crm_user_email_signatures to authenticated;
grant insert, update on public.crm_user_email_signatures to authenticated;
grant insert, update on public.crm_email_templates, public.crm_email_template_translations to authenticated;

-- Il client non puo' creare un'uscente o manipolarne l'esito: passa sempre per
-- send-crm-email, che autorizza l'utente e possiede la chiave del provider.
revoke insert, update, delete on public.email_messages from authenticated;
-- La revoca sopra chiude la nuova superficie di invio, ma conserva le sole due
-- decisioni umane dell'Inbox gia' concesse dalla 0014.
grant update (seen_at, attention_status) on public.email_messages to authenticated;
