-- =============================================================================
-- Integrations / 02 - owners who haven't signed in yet
--
-- The Cortex sync names every account's owners from Helix and Compass: the
-- Compass CSM (primary), the Compass project manager and sales rep, and Helix
-- project managers. Most of those people haven't signed in, so they have no
-- app_user row and can't hold an account_assignment yet.
--
--   * account_pending_owner  the owners the sync found, by email, until they sign in.
--                            The sync rewrites it every run.
--   * app.claim_pending_owners  runs when an app_user row is created (first sign-in)
--                            and turns that person's pending rows into real
--                            assignments in the same transaction, so their first
--                            page load already shows their accounts. Co-owners all
--                            get access; the CSM becomes the primary owner.
-- =============================================================================

create table public.account_pending_owner (
  account_id     uuid not null references public.account (id) on delete cascade,
  email          text not null check (email = lower(email)),
  full_name      text,
  role           public.assignment_role not null,
  is_primary     boolean not null default false,
  source_system  public.data_source_system not null,
  synced_at      timestamptz not null default now(),
  primary key (account_id, email, role)
);
create index account_pending_owner_email_idx on public.account_pending_owner (email);

alter table public.account_pending_owner enable row level security;
create policy account_pending_owner_select on public.account_pending_owner
  for select to authenticated using (app.has_account_access(account_id));
revoke all on public.account_pending_owner from anon;
revoke insert, update, delete, truncate on public.account_pending_owner from authenticated;
grant select on public.account_pending_owner to authenticated;

-- SECURITY DEFINER: it runs inside the sign-up transaction (as supabase_auth_admin,
-- via app.handle_new_auth_user) and writes account_assignment, which that role
-- can't. It only ever acts on rows whose email is the new user's own.
create or replace function app.claim_pending_owners()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r record;
begin
  for r in
    select * from public.account_pending_owner
     where email = lower(new.email)
     order by is_primary desc
  loop
    if r.is_primary then
      update public.account_assignment
         set is_primary = false
       where account_id = r.account_id
         and is_primary
         and deleted_at is null;
    end if;

    -- A row the lead added keeps its null source, so the sync never retires it.
    insert into public.account_assignment (account_id, user_id, role, is_primary, source_system)
    values (r.account_id, new.id, r.role, r.is_primary, r.source_system)
    on conflict (account_id, user_id, role) do update
      set deleted_at = null,
          is_primary = excluded.is_primary or (public.account_assignment.deleted_at is null and public.account_assignment.is_primary);
  end loop;

  delete from public.account_pending_owner where email = lower(new.email);
  return new;
end;
$$;

revoke all on function app.claim_pending_owners() from public, anon, authenticated;

create trigger app_user_claim_pending_owners
  after insert on public.app_user
  for each row execute function app.claim_pending_owners();

-- -----------------------------------------------------------------------------
-- Owner rules: every owner Helix and Compass name gets access.
-- Compass gives project managers and sales reps by name only; the sync matches a
-- name to an email when exactly one known person fits. `people` maps a name to an
-- email by hand for the rest; `ignore_names` skips placeholders.
-- -----------------------------------------------------------------------------
update public.app_policy
   set value = value
     || jsonb_build_object(
          'owners', jsonb_build_object(
            'compass_csm',             jsonb_build_object('role', 'csm', 'primary', true),
            'compass_project_manager', jsonb_build_object('role', 'pm',  'primary', false),
            'compass_sales_rep',       jsonb_build_object('role', 'cal', 'primary', false),
            'helix_project_manager',   jsonb_build_object('role', 'pm',  'primary', false)
          ),
          'helix_latest_project_manager_if_none_current', true,
          'people', coalesce(value -> 'people', '{}'::jsonb),
          'ignore_names', coalesce(value -> 'ignore_names', jsonb_build_array('tbd', 'n/a', 'na', 'none'))
        ),
       description = 'How the Cortex sync maps Helix and Compass into accounts, lifecycle, health, owners and contacts. account_matches pairs a Compass account id with a Helix client id when their names differ. people maps an owner name (lowercase) to an email when Compass gives only a name.'
 where key = 'cortex_sync';
