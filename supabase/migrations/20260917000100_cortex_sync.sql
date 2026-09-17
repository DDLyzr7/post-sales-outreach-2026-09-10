-- =============================================================================
-- Integrations / 01 - Cortex sync: Helix (clients, projects, contacts) and
-- Compass (lifecycle, CSM owners, health, commercials, use cases, contacts)
--
-- The sync job runs on the service-role key through /api/jobs/sync, so every
-- write below arrives with no JWT subject: RLS is bypassed on purpose, the
-- lifecycle guard lets it through (invariant 9) and nothing here is writable by a
-- signed-in user.
--
--   * account_source      which Helix client and Compass account each row mirrors.
--                         The two systems share no id, so they are joined by name,
--                         or by app_policy.cortex_sync.account_matches.
--   * account_context     Compass's CS picture of the account (one row each).
--   * account_engagement  Helix projects and Compass use cases.
--   * account_assignment.source_system marks owners the sync added. Only those are
--                         ever retired by the sync; owners the lead added stay.
--   * contact             stakeholder role, influence, sentiment, last interaction.
-- =============================================================================

alter table public.account
  add column industry text,
  add column region   text;

-- -----------------------------------------------------------------------------
-- account_source
-- -----------------------------------------------------------------------------
create table public.account_source (
  source_system    public.data_source_system not null,
  external_id      text not null,
  account_id       uuid not null references public.account (id) on delete cascade,
  source_name      text not null,
  first_synced_at  timestamptz not null default now(),
  synced_at        timestamptz not null default now(),
  primary key (source_system, external_id)
);
create index account_source_account_idx on public.account_source (account_id);

-- -----------------------------------------------------------------------------
-- account_context  (Compass)
-- -----------------------------------------------------------------------------
create table public.account_context (
  account_id             uuid primary key references public.account (id) on delete cascade,
  health_score           integer,
  health_label           text,
  health_narrative       text,
  renewal_posture        text,
  motion                 text,
  is_plg                 boolean,
  lifecycle_stages       text[] not null default '{}',
  project_stage          text,
  agents_deployed        integer,
  live_use_cases         integer,
  client_brief           text,
  current_state          text,
  expansion_opportunity  text,
  recommended_strategy   text,
  delivery_concern       text,
  commercial_concern     text,
  cs_notes               text,
  upsell_notes           text,
  -- [{title, description, status, owner, due_date}]
  top_risks              jsonb not null default '[]'::jsonb,
  open_decisions         jsonb not null default '[]'::jsonb,
  next_actions           jsonb not null default '[]'::jsonb,
  -- newest first: [{summary, sentiment, event_at}]
  recent_updates         jsonb not null default '[]'::jsonb,
  source_updated_at      timestamptz,
  synced_at              timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- account_engagement  (Helix projects, Compass use cases)
-- -----------------------------------------------------------------------------
create table public.account_engagement (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references public.account (id) on delete cascade,
  source_system      public.data_source_system not null,
  external_id        text not null,
  kind               text not null check (kind in ('project', 'use_case')),
  name               text not null,
  description        text,
  status             text,
  stage              text,
  health             text,
  owner_name         text,
  blocker            text,
  start_date         date,
  end_date           date,
  source_updated_at  timestamptz,
  synced_at          timestamptz not null default now(),
  constraint account_engagement_source_key unique (source_system, external_id)
);
create index account_engagement_account_idx on public.account_engagement (account_id);

-- -----------------------------------------------------------------------------
-- Owners and contacts
-- -----------------------------------------------------------------------------
-- null = added by the lead; otherwise the system the sync took the owner from.
alter table public.account_assignment
  add column source_system public.data_source_system;

alter table public.contact
  add column stakeholder_role     text,
  add column influence_level      text,
  add column sentiment            text,
  add column last_interaction_at  timestamptz;

-- -----------------------------------------------------------------------------
-- The sync job is a job_run like send and track.
-- -----------------------------------------------------------------------------
alter table public.job_run drop constraint job_run_job_check;
alter table public.job_run add constraint job_run_job_check check (job in ('send', 'track', 'sync'));

-- -----------------------------------------------------------------------------
-- RLS: readable by whoever can see the account; written only by the sync job.
-- -----------------------------------------------------------------------------
alter table public.account_source     enable row level security;
alter table public.account_context    enable row level security;
alter table public.account_engagement enable row level security;

create policy account_source_select on public.account_source
  for select to authenticated using (app.has_account_access(account_id));
create policy account_context_select on public.account_context
  for select to authenticated using (app.has_account_access(account_id));
create policy account_engagement_select on public.account_engagement
  for select to authenticated using (app.has_account_access(account_id));

revoke all on public.account_source, public.account_context, public.account_engagement from anon;
revoke insert, update, delete, truncate
  on public.account_source, public.account_context, public.account_engagement from authenticated;
grant select on public.account_source, public.account_context, public.account_engagement to authenticated;

-- -----------------------------------------------------------------------------
-- Sync rules: data, not code (invariant 5).
-- -----------------------------------------------------------------------------
insert into public.app_policy (key, value, description) values
(
  'cortex_sync',
  jsonb_build_object(
    'lifecycle', jsonb_build_object(
      'compass', jsonb_build_object('active', 'existing', 'churned', 'churned'),
      'helix',   jsonb_build_object('active', 'existing', 'inactive', 'churned'),
      'default', 'existing'
    ),
    'health', jsonb_build_object(
      'compass', jsonb_build_object('healthy', 'green', 'needs_attention', 'yellow', 'at_risk', 'red', 'critical', 'red'),
      'helix',   jsonb_build_object('on_track', 'green', 'at_risk', 'yellow', 'off_track', 'red')
    ),
    'tier', jsonb_build_object('enterprise', 'enterprise', 'mid-market', 'mid_market', 'smb', 'smb'),
    'owners', jsonb_build_object(
      'compass_csm', jsonb_build_object('role', 'csm', 'primary', true),
      'helix_project_manager', jsonb_build_object('role', 'pm', 'primary', false)
    ),
    -- Helix projects that count as current: their PMs become owners, and their
    -- health stands in for an account Compass doesn't cover.
    'active_project_statuses', jsonb_build_array('in_progress', 'on_hold', 'draft'),
    'internal_email_domains', jsonb_build_array('lyzr.ai', 'lyzr.com'),
    'recent_updates_kept', 10,
    -- Compass account_id -> Helix client id, for pairs the name match misses.
    'account_matches', '{}'::jsonb
  ),
  'How the Cortex sync maps Helix and Compass into accounts, lifecycle, health, owners and contacts. account_matches pairs a Compass account id with a Helix client id when their names differ.'
)
on conflict (key) do nothing;
