-- =============================================================================
-- Phase 1 / 05 - Row Level Security
--
-- The account-ownership rule is enforced HERE, at the data layer. A PM/CAL/CSM
-- can only read rows belonging to accounts they are assigned to; the post-sales
-- lead (is_admin) sees everything. UI filters are convenience only.
--
-- The helpers below are SECURITY DEFINER so that a policy on `account` may
-- consult `account_assignment` without re-entering that table's own policy
-- (which would recurse).
-- =============================================================================

create or replace function app.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.app_user u
    where u.id = auth.uid()
      and u.is_admin
      and u.is_active
      and u.deleted_at is null
  );
$$;

create or replace function app.has_account_access(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select app.is_admin() or exists (
    select 1
    from public.account_assignment aa
    where aa.account_id = p_account_id
      and aa.user_id = auth.uid()
      and aa.deleted_at is null
  );
$$;

revoke all on function app.is_admin(), app.has_account_access(uuid) from public, anon;
grant execute on function app.is_admin(), app.has_account_access(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Enable RLS everywhere. No table in public is left open.
-- -----------------------------------------------------------------------------
alter table public.app_user            enable row level security;
alter table public.account             enable row level security;
alter table public.account_product     enable row level security;
alter table public.account_assignment  enable row level security;
alter table public.contact             enable row level security;
alter table public.product             enable row level security;
alter table public.collateral          enable row level security;
alter table public.collateral_product  enable row level security;
alter table public.collateral_persona  enable row level security;
alter table public.template            enable row level security;
alter table public.template_version    enable row level security;
alter table public.campaign            enable row level security;
alter table public.email_activity      enable row level security;
alter table public.app_policy          enable row level security;

-- -----------------------------------------------------------------------------
-- app_user
-- -----------------------------------------------------------------------------
-- The internal colleague directory is readable by any signed-in teammate.
-- This is deliberate and is NOT the access-control surface: no client data
-- lives here, and an earlier draft that scoped app_user to shared accounts
-- broke the sender join on account_last_activity (an owner could see an email
-- the post-sales lead had sent to their own account, but not who sent it).
-- Client contact data lives in `contact`, which is scoped by account access.
create policy app_user_select on public.app_user
  for select to authenticated
  using (true);

create policy app_user_update_self on public.app_user
  for update to authenticated
  using (id = auth.uid() or app.is_admin())
  with check (id = auth.uid() or app.is_admin());

create policy app_user_admin_insert on public.app_user
  for insert to authenticated with check (app.is_admin());

create policy app_user_admin_delete on public.app_user
  for delete to authenticated using (app.is_admin());

-- -----------------------------------------------------------------------------
-- account  <- the rule the whole app hangs off
-- -----------------------------------------------------------------------------
create policy account_select on public.account
  for select to authenticated
  using (app.has_account_access(id));

-- Owners may edit app-only fields on their own accounts. Sync writes arrive on
-- the service-role key, which bypasses RLS by design.
create policy account_update on public.account
  for update to authenticated
  using (app.has_account_access(id))
  with check (app.has_account_access(id));

create policy account_admin_insert on public.account
  for insert to authenticated with check (app.is_admin());

create policy account_admin_delete on public.account
  for delete to authenticated using (app.is_admin());

-- -----------------------------------------------------------------------------
-- account_assignment  <- readable so owners can see their co-owners;
--                        writable by the post-sales lead only.
-- -----------------------------------------------------------------------------
create policy account_assignment_select on public.account_assignment
  for select to authenticated
  using (app.has_account_access(account_id));

create policy account_assignment_admin_insert on public.account_assignment
  for insert to authenticated with check (app.is_admin());

create policy account_assignment_admin_update on public.account_assignment
  for update to authenticated
  using (app.is_admin()) with check (app.is_admin());

create policy account_assignment_admin_delete on public.account_assignment
  for delete to authenticated using (app.is_admin());

-- -----------------------------------------------------------------------------
-- account_product
-- -----------------------------------------------------------------------------
create policy account_product_select on public.account_product
  for select to authenticated
  using (app.has_account_access(account_id));

create policy account_product_admin_write on public.account_product
  for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- -----------------------------------------------------------------------------
-- contact
-- -----------------------------------------------------------------------------
create policy contact_select on public.contact
  for select to authenticated
  using (app.has_account_access(account_id));

create policy contact_insert on public.contact
  for insert to authenticated
  with check (app.has_account_access(account_id));

create policy contact_update on public.contact
  for update to authenticated
  using (app.has_account_access(account_id))
  with check (app.has_account_access(account_id));

create policy contact_admin_delete on public.contact
  for delete to authenticated using (app.is_admin());

-- -----------------------------------------------------------------------------
-- email_activity  <- same ownership rule; every send is logged here
-- -----------------------------------------------------------------------------
create policy email_activity_select on public.email_activity
  for select to authenticated
  using (app.has_account_access(account_id));

-- A sender may only log mail under their own name, on an account they own.
create policy email_activity_insert on public.email_activity
  for insert to authenticated
  with check (
    app.has_account_access(account_id)
    and (sender_id = auth.uid() or app.is_admin())
  );

create policy email_activity_update on public.email_activity
  for update to authenticated
  using (app.has_account_access(account_id))
  with check (app.has_account_access(account_id));

create policy email_activity_admin_delete on public.email_activity
  for delete to authenticated using (app.is_admin());

-- -----------------------------------------------------------------------------
-- Shared reference data: readable by any signed-in teammate, admin-managed.
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'product', 'collateral', 'collateral_product', 'collateral_persona',
    'template', 'template_version', 'campaign', 'app_policy'
  ]
  loop
    execute format(
      'create policy %1$s_select on public.%1$s for select to authenticated using (true)', t);
    execute format(
      'create policy %1$s_admin_write on public.%1$s for all to authenticated
         using (app.is_admin()) with check (app.is_admin())', t);
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Grants. Nothing in this app is reachable with the anon key alone: policies
-- target the `authenticated` role and anon holds no table privileges.
-- -----------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on public.account_last_activity,
                public.account_monthly_send_count,
                public.account_team_member,
                public.account_overview,
                public.contact_suggested_collateral,
                public.contact_cross_sell_intro
  to authenticated;

revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
