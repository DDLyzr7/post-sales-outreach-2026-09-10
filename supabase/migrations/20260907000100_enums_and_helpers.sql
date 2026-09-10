-- =============================================================================
-- Phase 1 / 01 - schemas, enums, shared trigger helpers
-- =============================================================================
-- The `app` schema holds security-definer helpers used by RLS policies. Keeping
-- them out of `public` means they are never exposed through PostgREST.
create schema if not exists app;

revoke all on schema app from public, anon, authenticated;
grant usage on schema app to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
create type public.assignment_role     as enum ('pm', 'cal', 'csm');
create type public.account_tier        as enum ('strategic', 'enterprise', 'mid_market', 'smb');
create type public.health_status       as enum ('green', 'yellow', 'red', 'unknown');
create type public.data_source_system  as enum ('helix', 'compass', 'enrichment', 'manual');

create type public.contact_type        as enum ('engaged', 'committee');
create type public.contact_source      as enum ('internal_sync', 'enrichment', 'manual');
create type public.relationship_status as enum ('champion', 'active', 'dormant', 'cold', 'detractor', 'unknown');
create type public.business_function   as enum (
  'hr', 'marketing', 'finance', 'sales', 'operations',
  'it', 'legal', 'product', 'executive', 'other'
);

-- The four email types from the brief's taxonomy.
create type public.email_type          as enum (
  'product_update',      -- engaged stakeholders (pane 1)
  'cross_sell_intro',    -- leadership committee (pane 2)
  'friend_account',      -- warm-but-not-yet-customer accounts
  'launch_broadcast'     -- everyone, fanned out as a campaign
);
-- Two send paths. Deliberately distinct types, never collapsed into one.
create type public.send_path           as enum ('warm', 'cold');
create type public.email_direction     as enum ('outbound', 'inbound');
create type public.email_status        as enum (
  'drafted', 'pending_approval', 'approved', 'queued',
  'sent', 'opened', 'replied', 'bounced', 'failed', 'cancelled'
);
create type public.campaign_status     as enum ('draft', 'scheduled', 'running', 'completed', 'cancelled');
create type public.template_audience   as enum ('engaged', 'committee', 'friend_account', 'all');

-- -----------------------------------------------------------------------------
-- Shared trigger helpers
-- -----------------------------------------------------------------------------
create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Stamps updated_by (and created_by on insert) from the calling JWT.
create or replace function app.stamp_audit_actor()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(new.created_by, auth.uid());
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;
