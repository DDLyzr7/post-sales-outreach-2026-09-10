-- =============================================================================
-- Phase 1 / 03 - collateral, templates (versioned), campaigns, email_activity,
--                and the configurable policy store
-- =============================================================================

-- -----------------------------------------------------------------------------
-- collateral : knowledge-base assets served as trackable links, never attachments
-- -----------------------------------------------------------------------------
create table public.collateral (
  id            uuid primary key default gen_random_uuid(),
  slug          text not null unique,
  title         text not null,
  summary       text,
  -- Canonical destination. Phase 2 wraps this in a per-send trackable redirect.
  asset_url     text not null,
  content_type  text not null default 'one_pager'
                  check (content_type in ('one_pager', 'case_study', 'webinar',
                                          'roi_calculator', 'guide', 'release_note')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.app_user (id),
  updated_by    uuid references public.app_user (id),
  deleted_at    timestamptz
);
create trigger collateral_touch_updated_at
  before update on public.collateral
  for each row execute function app.touch_updated_at();

-- Which product a piece of collateral speaks to.
create table public.collateral_product (
  collateral_id  uuid not null references public.collateral (id) on delete cascade,
  product_id     uuid not null references public.product (id) on delete cascade,
  primary key (collateral_id, product_id)
);
create index collateral_product_product_idx on public.collateral_product (product_id);

-- Which persona (function x pane) a piece of collateral speaks to.
create table public.collateral_persona (
  collateral_id      uuid not null references public.collateral (id) on delete cascade,
  business_function  public.business_function not null,
  contact_type       public.contact_type not null,
  primary key (collateral_id, business_function, contact_type)
);
create index collateral_persona_lookup_idx
  on public.collateral_persona (contact_type, business_function);

-- -----------------------------------------------------------------------------
-- template + template_version
-- Bodies are pinned to a version on every EmailActivity row, so editing a
-- template never rewrites what we actually said.
-- -----------------------------------------------------------------------------
create table public.template (
  id                 uuid primary key default gen_random_uuid(),
  key                text not null unique,
  name               text not null,
  description        text,
  email_type         public.email_type not null,
  audience           public.template_audience not null,
  -- Advisory only; the routing policy in app_policy has the final say.
  default_send_path  public.send_path not null,
  current_version    integer not null default 1,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  created_by         uuid references public.app_user (id),
  updated_by         uuid references public.app_user (id),
  deleted_at         timestamptz
);
create index template_type_audience_idx on public.template (email_type, audience)
  where deleted_at is null;
create trigger template_touch_updated_at
  before update on public.template
  for each row execute function app.touch_updated_at();

create table public.template_version (
  id                uuid primary key default gen_random_uuid(),
  template_id       uuid not null references public.template (id) on delete cascade,
  version           integer not null check (version >= 1),
  subject_template  text not null,
  body_template     text not null,
  -- Declared merge variables, e.g. ["contact_first_name","account_name"].
  variables         jsonb not null default '[]'::jsonb,
  changelog         text,
  created_at        timestamptz not null default now(),
  created_by        uuid references public.app_user (id),

  constraint template_version_unique unique (template_id, version)
);

-- -----------------------------------------------------------------------------
-- campaign : broadcast fan-out (Phase 5), referenced by EmailActivity from day 1
-- -----------------------------------------------------------------------------
create table public.campaign (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  description   text,
  email_type    public.email_type not null default 'launch_broadcast',
  status        public.campaign_status not null default 'draft',
  template_id   uuid references public.template (id),
  -- Lower number wins when the governor resolves a same-window collision.
  priority      integer not null default 100,
  scheduled_at  timestamptz,
  started_at    timestamptz,
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid references public.app_user (id),
  updated_by    uuid references public.app_user (id),
  deleted_at    timestamptz
);
create trigger campaign_touch_updated_at
  before update on public.campaign
  for each row execute function app.touch_updated_at();

-- -----------------------------------------------------------------------------
-- email_activity : the spine.
-- Single read-source for last-activity, the frequency cap, and analytics.
-- Nothing derived from this table is ever stored back onto account.
-- -----------------------------------------------------------------------------
create table public.email_activity (
  id                   uuid primary key default gen_random_uuid(),

  account_id           uuid not null references public.account (id) on delete restrict,
  contact_id           uuid references public.contact (id) on delete set null,
  sender_id            uuid references public.app_user (id) on delete set null,
  campaign_id          uuid references public.campaign (id) on delete set null,

  -- Version pin: what we said is reconstructible even after template edits.
  template_version_id  uuid references public.template_version (id),

  email_type           public.email_type not null,
  send_path            public.send_path not null,
  direction            public.email_direction not null default 'outbound',
  status               public.email_status not null default 'drafted',

  subject              text not null,
  body_text            text,
  body_html            text,
  merge_vars           jsonb not null default '{}'::jsonb,

  to_email             text,
  from_email           text,
  provider             text,
  provider_message_id  text,

  -- What the governor decided at send time, kept for audit.
  governor_decision    jsonb,

  approved_by          uuid references public.app_user (id),
  approved_at          timestamptz,
  scheduled_for        timestamptz,
  sent_at              timestamptz,
  opened_at            timestamptz,
  replied_at           timestamptz,
  bounced_at           timestamptz,
  error_message        text,

  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  created_by           uuid references public.app_user (id),
  updated_by           uuid references public.app_user (id),
  deleted_at           timestamptz,

  -- A row that claims to have left the building must say when.
  constraint email_activity_sent_requires_timestamp check (
    status not in ('sent', 'opened', 'replied', 'bounced') or sent_at is not null
  ),
  constraint email_activity_opened_requires_sent check (opened_at is null or sent_at is not null),
  constraint email_activity_replied_requires_sent check (replied_at is null or sent_at is not null)
);

-- Frequency-cap and last-activity lookups both scan by (account_id, sent_at).
create index email_activity_account_sent_idx
  on public.email_activity (account_id, sent_at desc)
  where deleted_at is null and sent_at is not null;
create index email_activity_account_status_idx
  on public.email_activity (account_id, status) where deleted_at is null;
create index email_activity_contact_idx on public.email_activity (contact_id) where deleted_at is null;
create index email_activity_campaign_idx on public.email_activity (campaign_id) where campaign_id is not null;
create index email_activity_sender_idx on public.email_activity (sender_id) where deleted_at is null;
create unique index email_activity_provider_message_key
  on public.email_activity (provider, provider_message_id)
  where provider_message_id is not null;

create trigger email_activity_touch_updated_at
  before update on public.email_activity
  for each row execute function app.touch_updated_at();
create trigger email_activity_stamp_audit_actor
  before insert or update on public.email_activity
  for each row execute function app.stamp_audit_actor();

-- -----------------------------------------------------------------------------
-- app_policy : frequency cap, broadcast-vs-routine priority, send-path routing.
-- Kept as data so the rules are readable and changeable without a deploy.
-- -----------------------------------------------------------------------------
create table public.app_policy (
  key          text primary key,
  value        jsonb not null,
  description  text,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references public.app_user (id)
);
create trigger app_policy_touch_updated_at
  before update on public.app_policy
  for each row execute function app.touch_updated_at();
