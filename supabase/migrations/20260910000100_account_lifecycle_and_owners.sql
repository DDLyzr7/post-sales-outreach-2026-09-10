-- =============================================================================
-- Phase 2 / 01 - customer lifecycle, targeting rules, owner assignment
--
-- Adds what the "My targets" and "Team coverage" views need:
--   * account.lifecycle_status   existing customer / churned / prospect
--   * a guard so only the post-sales lead (or a sync job) can change it
--   * account_overview gains lifecycle and owner columns (appended, so the
--     Phase 1 column order is untouched)
--   * two functions the lead uses to add and remove owners atomically
--   * the renewal window for targeting, stored as policy data
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Lifecycle
-- A friend account is a prospect with is_friend_account = true; the flag stays
-- because send-path routing reads it.
-- -----------------------------------------------------------------------------
create type public.account_lifecycle as enum ('existing', 'churned', 'prospect');

alter table public.account
  add column lifecycle_status     public.account_lifecycle not null default 'existing',
  add column lifecycle_changed_at timestamptz;

create index account_lifecycle_idx on public.account (lifecycle_status)
  where deleted_at is null;

update public.account
   set lifecycle_status = 'prospect'
 where is_friend_account and lifecycle_status = 'existing';

-- Owners may edit app-only fields on their accounts (Phase 1 account_update
-- policy), but lifecycle is the lead's call. Sync jobs run on the service-role
-- key with no JWT subject, so auth.uid() is null for them and they pass.
create or replace function app.guard_account_lifecycle()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.lifecycle_changed_at := coalesce(new.lifecycle_changed_at, now());
    return new;
  end if;

  if new.lifecycle_status is distinct from old.lifecycle_status then
    if auth.uid() is not null and not app.is_admin() then
      raise exception 'Only the post-sales lead can change an account''s lifecycle.'
        using errcode = '42501';
    end if;
    new.lifecycle_changed_at := now();
  end if;

  return new;
end;
$$;

create trigger account_guard_lifecycle
  before insert or update on public.account
  for each row execute function app.guard_account_lifecycle();

-- -----------------------------------------------------------------------------
-- account_overview, extended. Same body as Phase 1 with four columns appended.
-- -----------------------------------------------------------------------------
create or replace view public.account_overview
with (security_invoker = on) as
select
  a.id            as account_id,
  a.name,
  a.tier,
  a.health_status,
  a.owning_team,
  a.domain,
  a.renewal_date,
  a.arr_cents,
  a.is_friend_account,
  a.source_system,
  a.synced_at,

  coalesce(m.sends_this_month, 0)          as sends_this_month,
  coalesce(m.warm_sends_this_month, 0)     as warm_sends_this_month,
  coalesce(m.cold_sends_this_month, 0)     as cold_sends_this_month,

  la.email_activity_id  as last_email_activity_id,
  la.sent_at            as last_sent_at,
  la.subject            as last_subject,
  la.email_type         as last_email_type,
  la.send_path          as last_send_path,
  la.status             as last_status,
  la.contact_name       as last_contact_name,
  la.sender_name        as last_sender_name,
  case
    when la.sent_at is null then null
    else (current_date - la.sent_at::date)
  end                   as days_since_last_send,

  (
    select aa.role
    from public.account_assignment aa
    where aa.account_id = a.id
      and aa.user_id = auth.uid()
      and aa.deleted_at is null
    order by aa.is_primary desc
    limit 1
  )                     as viewer_role,

  (
    select count(*)::integer
    from public.contact c
    where c.account_id = a.id and c.deleted_at is null and c.type = 'engaged'
  )                     as engaged_contact_count,
  (
    select count(*)::integer
    from public.contact c
    where c.account_id = a.id and c.deleted_at is null and c.type = 'committee'
  )                     as committee_contact_count,

  -- Phase 2 additions
  a.lifecycle_status,
  a.lifecycle_changed_at,
  (
    select count(distinct aa.user_id)::integer
    from public.account_assignment aa
    where aa.account_id = a.id and aa.deleted_at is null
  )                     as owner_count,
  (
    select u.full_name
    from public.account_assignment aa
    join public.app_user u on u.id = aa.user_id
    where aa.account_id = a.id and aa.deleted_at is null and aa.is_primary
    order by aa.created_at
    limit 1
  )                     as primary_owner_name
from public.account a
left join public.account_monthly_send_count m on m.account_id = a.id
left join public.account_last_activity      la on la.account_id = a.id
where a.deleted_at is null;

-- -----------------------------------------------------------------------------
-- Owner assignment. SECURITY INVOKER, so account_assignment's own RLS still
-- applies inside; the explicit is_admin() check only turns a silent zero-row
-- write into a clear error.
-- -----------------------------------------------------------------------------
create or replace function public.assign_account_owner(
  p_account_id uuid,
  p_user_id    uuid,
  p_role       public.assignment_role,
  p_is_primary boolean default false
)
returns uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  if not app.is_admin() then
    raise exception 'Only the post-sales lead can change account owners.'
      using errcode = '42501';
  end if;

  -- One primary owner per account: demote the current one in the same transaction.
  if p_is_primary then
    update public.account_assignment
       set is_primary = false
     where account_id = p_account_id
       and is_primary
       and deleted_at is null;
  end if;

  -- The unique key covers soft-deleted rows, so re-adding someone revives their row.
  insert into public.account_assignment (account_id, user_id, role, is_primary)
  values (p_account_id, p_user_id, p_role, p_is_primary)
  on conflict (account_id, user_id, role) do update
    set is_primary = excluded.is_primary,
        deleted_at = null
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.remove_account_owner(p_assignment_id uuid)
returns void
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  if not app.is_admin() then
    raise exception 'Only the post-sales lead can change account owners.'
      using errcode = '42501';
  end if;

  update public.account_assignment
     set deleted_at = now(),
         is_primary = false
   where id = p_assignment_id
     and deleted_at is null;

  if not found then
    raise exception 'That owner has already been removed.'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.assign_account_owner(uuid, uuid, public.assignment_role, boolean) from public, anon;
revoke all on function public.remove_account_owner(uuid) from public, anon;
grant execute on function public.assign_account_owner(uuid, uuid, public.assignment_role, boolean) to authenticated;
grant execute on function public.remove_account_owner(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Targeting policy: data, not code.
-- -----------------------------------------------------------------------------
insert into public.app_policy (key, value, description) values
(
  'targeting_rules',
  jsonb_build_object('renewal_window_days', 90),
  'How close a renewal date has to be before an existing customer surfaces under "Renewal coming up" in My targets.'
)
on conflict (key) do nothing;
