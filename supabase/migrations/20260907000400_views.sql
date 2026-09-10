-- =============================================================================
-- Phase 1 / 04 - derived views
-- Every one of these is `security_invoker = on`, so RLS on the underlying
-- tables applies to the querying user. A view is never an RLS escape hatch.
-- Nothing here is materialised: last-activity and the monthly send count are
-- always read straight out of email_activity.
-- =============================================================================

-- Most recent SENT email per account.
create view public.account_last_activity
with (security_invoker = on) as
select distinct on (ea.account_id)
  ea.account_id,
  ea.id                as email_activity_id,
  ea.contact_id,
  c.full_name          as contact_name,
  c.type               as contact_type,
  ea.sender_id,
  u.full_name          as sender_name,
  ea.email_type,
  ea.send_path,
  ea.status,
  ea.subject,
  ea.sent_at,
  ea.opened_at,
  ea.replied_at
from public.email_activity ea
left join public.contact  c on c.id = ea.contact_id
left join public.app_user u on u.id = ea.sender_id
where ea.deleted_at is null
  and ea.direction = 'outbound'
  and ea.sent_at is not null
order by ea.account_id, ea.sent_at desc, ea.id;

-- Sends this calendar month, counted across every sender, path and campaign.
-- This is the number the frequency governor checks.
create view public.account_monthly_send_count
with (security_invoker = on) as
select
  ea.account_id,
  count(*)::integer                                                     as sends_this_month,
  count(*) filter (where ea.send_path = 'warm')::integer                as warm_sends_this_month,
  count(*) filter (where ea.send_path = 'cold')::integer                as cold_sends_this_month,
  count(*) filter (where ea.campaign_id is not null)::integer           as campaign_sends_this_month
from public.email_activity ea
where ea.deleted_at is null
  and ea.direction = 'outbound'
  and ea.sent_at is not null
  and ea.sent_at >= date_trunc('month', now())
  and ea.sent_at <  date_trunc('month', now()) + interval '1 month'
group by ea.account_id;

-- Who is on an account, with names. Scoped by RLS on account_assignment.
create view public.account_team_member
with (security_invoker = on) as
select
  aa.account_id,
  aa.user_id,
  aa.role,
  aa.is_primary,
  u.full_name,
  u.email,
  u.title
from public.account_assignment aa
join public.app_user u on u.id = aa.user_id
where aa.deleted_at is null
  and u.deleted_at is null;

-- One row per visible account: the shape the dashboard and the account status
-- header both read. days_since_last_send is a plain fact; the staleness
-- thresholds that turn it into a flag live in app_policy, not here.
create view public.account_overview
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

  -- The viewer's own role on this account (null for the admin unless assigned).
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
  )                     as committee_contact_count
from public.account a
left join public.account_monthly_send_count m on m.account_id = a.id
left join public.account_last_activity      la on la.account_id = a.id
where a.deleted_at is null;

-- Collateral suggestions per contact.
--   engaged   -> assets for products the account already uses (reinforce)
--   committee -> assets for products the account does NOT use (cross-sell)
create view public.contact_suggested_collateral
with (security_invoker = on) as
select
  ct.id           as contact_id,
  ct.account_id,
  col.id          as collateral_id,
  col.slug,
  col.title,
  col.summary,
  col.content_type,
  col.asset_url,
  p.name          as product_name,
  'product_in_use'::text as reason
from public.contact ct
join public.collateral_persona cp
  on cp.contact_type = ct.type and cp.business_function = ct.business_function
join public.collateral col
  on col.id = cp.collateral_id and col.is_active and col.deleted_at is null
join public.collateral_product colp on colp.collateral_id = col.id
join public.product p on p.id = colp.product_id and p.is_active and p.deleted_at is null
join public.account_product ap
  on ap.account_id = ct.account_id and ap.product_id = colp.product_id and ap.status = 'active'
where ct.type = 'engaged' and ct.deleted_at is null

union

select
  ct.id,
  ct.account_id,
  col.id,
  col.slug,
  col.title,
  col.summary,
  col.content_type,
  col.asset_url,
  p.name,
  'cross_sell'::text
from public.contact ct
join public.collateral_persona cp
  on cp.contact_type = ct.type and cp.business_function = ct.business_function
join public.collateral col
  on col.id = cp.collateral_id and col.is_active and col.deleted_at is null
join public.collateral_product colp on colp.collateral_id = col.id
join public.product p on p.id = colp.product_id and p.is_active and p.deleted_at is null
where ct.type = 'committee' and ct.deleted_at is null
  and not exists (
    select 1 from public.account_product ap
    where ap.account_id = ct.account_id
      and ap.product_id = colp.product_id
      and ap.status = 'active'
  );

-- The suggested cross-sell intro for each committee exec: the highest-priority
-- product the account does not have that is pitched to that exec's function,
-- paired with the current version of the committee intro template.
create view public.contact_cross_sell_intro
with (security_invoker = on) as
select distinct on (ct.id)
  ct.id            as contact_id,
  ct.account_id,
  p.id             as product_id,
  p.name           as product_name,
  p.value_prop,
  t.id             as template_id,
  tv.id            as template_version_id,
  tv.subject_template,
  t.default_send_path
from public.contact ct
join public.product p
  on p.is_active
  and p.deleted_at is null
  and ct.business_function = any (p.target_functions)
  and not exists (
    select 1 from public.account_product ap
    where ap.account_id = ct.account_id
      and ap.product_id = p.id
      and ap.status = 'active'
  )
left join public.template t
  on t.email_type = 'cross_sell_intro'
  and t.audience = 'committee'
  and t.is_active
  and t.deleted_at is null
left join public.template_version tv
  on tv.template_id = t.id and tv.version = t.current_version
where ct.type = 'committee' and ct.deleted_at is null
order by ct.id, p.sort_order, p.name;
