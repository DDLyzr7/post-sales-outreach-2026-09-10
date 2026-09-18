-- =============================================================================
-- Real users beside the sample data (2026-09-18)
--
-- Real Lyzr people now sign in beside the four fictional sample users, and the
-- sample lead (lead@example.com, documented password) must no longer see real
-- clients. So the data is split into two worlds:
--
--   sample world  the 8 fictional accounts (account.is_sample) and the
--                 @example.com users. Kept for db:verify-rls and demos.
--   real world    everything synced from Helix and Compass, and every real user.
--
-- A signed-in user only ever sees rows in their own world. This is enforced by
-- RESTRICTIVE policies, which are ANDed with every existing policy, so admin
-- (the lead) sees every account in their world and nothing in the other.
-- Jobs (service role) see both.
-- =============================================================================

alter table public.account add column is_sample boolean not null default false;
update public.account set is_sample = true where id::text like '11111111-0000-4000-8000-%';

-- Is the caller one of the fictional sample users? False with no JWT (jobs).
create or replace function app.is_sample_user()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select lower(u.email) like '%@example.com' from public.app_user u where u.id = auth.uid()),
    false
  );
$$;

-- Is this account in the caller's world?
create or replace function app.account_in_world(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select a.is_sample from public.account a where a.id = p_account_id), false)
         = app.is_sample_user();
$$;

revoke all on function app.is_sample_user(), app.account_in_world(uuid) from public, anon;
grant execute on function app.is_sample_user(), app.account_in_world(uuid) to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Restrictive policies: every account-scoped table, plus the account itself and
-- the colleague directory.
-- -----------------------------------------------------------------------------
create policy account_same_world on public.account
  as restrictive for all to authenticated
  using (is_sample = app.is_sample_user())
  with check (is_sample = app.is_sample_user());

do $$
declare
  t text;
begin
  foreach t in array array[
    'account_assignment', 'account_context', 'account_engagement', 'account_pending_owner',
    'account_product', 'account_source', 'contact', 'email_activity'
  ]
  loop
    execute format(
      'create policy %1$s_same_world on public.%1$s as restrictive for all to authenticated
         using (app.account_in_world(account_id)) with check (app.account_in_world(account_id))', t);
  end loop;
end;
$$;

-- Real users don't see the fictional colleagues, and the reverse.
create policy app_user_same_world on public.app_user
  as restrictive for all to authenticated
  using ((lower(email) like '%@example.com') = app.is_sample_user())
  with check ((lower(email) like '%@example.com') = app.is_sample_user());

-- -----------------------------------------------------------------------------
-- The broadcast audience runs as SECURITY DEFINER, so RLS doesn't reach it. Keep
-- the original as campaign_audience_all and put a world filter in front of it;
-- preview_campaign_audience() and launch_campaign() call it by name.
-- -----------------------------------------------------------------------------
alter function app.campaign_audience(jsonb) rename to campaign_audience_all;

create function app.campaign_audience(p_audience jsonb)
returns table (
  account_id          uuid,
  account_name        text,
  contact_id          uuid,
  contact_name        text,
  contact_email       text,
  contact_type        public.contact_type,
  sender_id           uuid,
  sender_name         text,
  from_email          text,
  send_path           public.send_path,
  skip_reason         text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.*
    from app.campaign_audience_all(p_audience) r
   where app.account_in_world(r.account_id);
$$;

revoke all on function app.campaign_audience(jsonb), app.campaign_audience_all(jsonb) from public, anon, authenticated;
