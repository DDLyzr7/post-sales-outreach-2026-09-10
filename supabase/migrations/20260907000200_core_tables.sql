-- =============================================================================
-- Phase 1 / 02 - core tables: users, accounts, assignments, contacts, products
-- =============================================================================

-- -----------------------------------------------------------------------------
-- app_user : profile mirror of auth.users
-- -----------------------------------------------------------------------------
create table public.app_user (
  id                     uuid primary key references auth.users (id) on delete cascade,
  email                  text not null,
  full_name              text not null,
  title                  text,
  -- Post-sales lead. Admins bypass the account-ownership rule in RLS.
  is_admin               boolean not null default false,
  -- Usual hat this person wears; the authoritative role is per-assignment.
  default_role           public.assignment_role,
  -- Warm path (Phase 3): the real mailbox we send from on our real domain.
  warm_sender_address    text,
  is_active              boolean not null default true,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  deleted_at             timestamptz
);
create unique index app_user_email_key on public.app_user (lower(email));
create index app_user_is_admin_idx on public.app_user (is_admin) where deleted_at is null;

create trigger app_user_touch_updated_at
  before update on public.app_user
  for each row execute function app.touch_updated_at();

-- Auto-provision a profile whenever a Supabase Auth user is created.
create or replace function app.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.app_user (id, email, full_name, title, is_admin, default_role, warm_sender_address)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data ->> 'title',
    coalesce((new.raw_user_meta_data ->> 'is_admin')::boolean, false),
    nullif(new.raw_user_meta_data ->> 'default_role', '')::public.assignment_role,
    coalesce(new.raw_user_meta_data ->> 'warm_sender_address', new.email)
  )
  on conflict (id) do update
    set email        = excluded.email,
        full_name    = excluded.full_name,
        title        = coalesce(excluded.title, public.app_user.title),
        is_admin     = excluded.is_admin,
        default_role = coalesce(excluded.default_role, public.app_user.default_role),
        updated_at   = now();
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function app.handle_new_auth_user();

-- -----------------------------------------------------------------------------
-- product : what we sell. Drives collateral mapping and cross-sell targeting.
-- -----------------------------------------------------------------------------
create table public.product (
  id                uuid primary key default gen_random_uuid(),
  key               text not null unique,
  name              text not null,
  description       text,
  value_prop        text,
  -- Which functional leaders this product is pitched to (pane 2 targeting).
  target_functions  public.business_function[] not null default '{}',
  sort_order        integer not null default 100,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
create trigger product_touch_updated_at
  before update on public.product
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- account : synced mirror of Helix / Compass, plus app-only fields
-- -----------------------------------------------------------------------------
create table public.account (
  id                 uuid primary key default gen_random_uuid(),
  -- Sync identity. Source of truth is external; this table is a mirror.
  source_system      public.data_source_system not null default 'helix',
  external_id        text,
  synced_at          timestamptz,

  name               text not null,
  domain             text,
  tier               public.account_tier not null default 'mid_market',
  health_status      public.health_status not null default 'unknown',
  owning_team        text,

  contract_start     date,
  contract_end       date,
  renewal_date       date,
  arr_cents          bigint check (arr_cents is null or arr_cents >= 0),

  -- App-only fields (not overwritten by sync).
  is_friend_account  boolean not null default false,
  notes              text,

  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.app_user (id),
  updated_by         uuid references public.app_user (id),
  deleted_at         timestamptz,

  constraint account_external_identity_key unique (source_system, external_id)
);
create index account_name_idx on public.account (lower(name)) where deleted_at is null;
create index account_tier_idx on public.account (tier) where deleted_at is null;

create trigger account_touch_updated_at
  before update on public.account
  for each row execute function app.touch_updated_at();
create trigger account_stamp_audit_actor
  before insert or update on public.account
  for each row execute function app.stamp_audit_actor();

-- Products the account currently uses.
create table public.account_product (
  account_id    uuid not null references public.account (id) on delete cascade,
  product_id    uuid not null references public.product (id) on delete cascade,
  status        text not null default 'active' check (status in ('active', 'trial', 'churned')),
  activated_on  date,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  primary key (account_id, product_id)
);
create index account_product_product_idx on public.account_product (product_id);
create trigger account_product_touch_updated_at
  before update on public.account_product
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- account_assignment : THE table that drives RLS visibility
-- -----------------------------------------------------------------------------
create table public.account_assignment (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.account (id) on delete cascade,
  user_id      uuid not null references public.app_user (id) on delete cascade,
  role         public.assignment_role not null,
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.app_user (id),
  updated_by   uuid references public.app_user (id),
  deleted_at   timestamptz,

  constraint account_assignment_unique unique (account_id, user_id, role)
);
-- Hot path for every RLS check.
create index account_assignment_user_idx on public.account_assignment (user_id, account_id)
  where deleted_at is null;
create index account_assignment_account_idx on public.account_assignment (account_id)
  where deleted_at is null;

create trigger account_assignment_touch_updated_at
  before update on public.account_assignment
  for each row execute function app.touch_updated_at();
create trigger account_assignment_stamp_audit_actor
  before insert or update on public.account_assignment
  for each row execute function app.stamp_audit_actor();

-- -----------------------------------------------------------------------------
-- contact : engaged stakeholders (pane 1) and committee execs (pane 2)
-- -----------------------------------------------------------------------------
create table public.contact (
  id                     uuid primary key default gen_random_uuid(),
  account_id             uuid not null references public.account (id) on delete cascade,

  -- The pane-defining field.
  type                   public.contact_type not null,

  full_name              text not null,
  title                  text,
  business_function      public.business_function not null default 'other',
  email                  text,
  phone                  text,
  linkedin_url           text,
  relationship_status    public.relationship_status not null default 'unknown',

  -- Respected on every send path, both warm and cold.
  is_opted_out           boolean not null default false,
  opted_out_at           timestamptz,
  opt_out_reason         text,

  source                 public.contact_source not null default 'internal_sync',
  external_id            text,
  enrichment_provider    text,
  enrichment_confidence  numeric(3, 2) check (enrichment_confidence is null
                            or enrichment_confidence between 0 and 1),
  enriched_at            timestamptz,
  synced_at              timestamptz,

  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  created_by             uuid references public.app_user (id),
  updated_by             uuid references public.app_user (id),
  deleted_at             timestamptz,

  constraint contact_opt_out_timestamp check (not is_opted_out or opted_out_at is not null)
);
create index contact_account_type_idx on public.contact (account_id, type) where deleted_at is null;
create unique index contact_account_email_key on public.contact (account_id, lower(email))
  where email is not null and deleted_at is null;

create trigger contact_touch_updated_at
  before update on public.contact
  for each row execute function app.touch_updated_at();
create trigger contact_stamp_audit_actor
  before insert or update on public.contact
  for each row execute function app.stamp_audit_actor();

-- Keep opted_out_at honest without asking every caller to remember.
create or replace function app.stamp_contact_opt_out()
returns trigger
language plpgsql
as $$
begin
  if new.is_opted_out and new.opted_out_at is null then
    new.opted_out_at := now();
  elsif not new.is_opted_out then
    new.opted_out_at := null;
    new.opt_out_reason := null;
  end if;
  return new;
end;
$$;
create trigger contact_stamp_opt_out
  before insert or update on public.contact
  for each row execute function app.stamp_contact_opt_out();
