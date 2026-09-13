-- =============================================================================
-- Phase 7 / 01 - reporting
--
-- Every report is a SECURITY INVOKER function, so RLS on email_activity, account
-- and account_assignment still applies inside. On top of that, each one returns
-- only the caller's own row unless the caller is the post-sales lead (RP-05).
-- Nothing is stored: every number is read from email_activity (invariant 4).
--
-- Opens aren't tracked (decided 2026-09-10), so no report counts them.
-- Outreach consistency and coverage count routine emails a person sent
-- themselves; broadcasts are reported per campaign instead.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RP-01 + RP-02: outreach consistency and account coverage, one row per person.
-- -----------------------------------------------------------------------------
create or replace function public.report_people(p_weeks integer default 12)
returns table (
  user_id          uuid,
  full_name        text,
  title            text,
  accounts_owned   integer,
  emails_in_window integer,
  active_weeks     integer,
  weekly_counts    integer[],
  emailed_30d      integer,
  emailed_60d      integer,
  quiet_accounts   integer,
  never_emailed    integer,
  replies          integer,
  bounces          integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with params as (
    select
      greatest(1, least(coalesce(p_weeks, 12), 52)) as weeks,
      coalesce((select (value ->> 'warn_days')::integer  from public.app_policy where key = 'staleness_thresholds'), 30) as warn_days,
      coalesce((select (value ->> 'alert_days')::integer from public.app_policy where key = 'staleness_thresholds'), 60) as alert_days
  ),
  people as (
    select u.id, u.full_name, u.title, u.is_admin
      from public.app_user u
     where u.deleted_at is null and u.is_active
       and (app.is_admin() or u.id = auth.uid())
  ),
  owned as (
    select distinct aa.user_id, aa.account_id
      from public.account_assignment aa
      join public.account a on a.id = aa.account_id and a.deleted_at is null
     where aa.deleted_at is null
  ),
  routine as (
    select ea.*
      from public.email_activity ea
     where ea.deleted_at is null
       and ea.direction = 'outbound'
       and ea.sent_at is not null
       and ea.email_type <> 'launch_broadcast'
  ),
  weeks as (
    select generate_series(0, (select weeks from params) - 1) as n
  ),
  weekly as (
    select p.id as user_id,
           array_agg(
             (select count(*)::integer from routine r
               where r.sender_id = p.id
                 and r.sent_at >= date_trunc('week', now()) - make_interval(weeks => w.n)
                 and r.sent_at <  date_trunc('week', now()) - make_interval(weeks => w.n) + interval '1 week')
             order by w.n desc) as counts
      from people p cross join weeks w
     group by p.id
  ),
  last_by_account as (
    select r.account_id, max(r.sent_at) as last_any
      from routine r group by r.account_id
  ),
  last_by_person_account as (
    select r.sender_id, r.account_id, max(r.sent_at) as last_mine
      from routine r group by r.sender_id, r.account_id
  )
  select
    p.id,
    p.full_name,
    p.title,
    (select count(*)::integer from owned o where o.user_id = p.id),
    (select count(*)::integer from routine r, params
      where r.sender_id = p.id
        and r.sent_at >= date_trunc('week', now()) - make_interval(weeks => params.weeks - 1)),
    (select count(*)::integer from unnest(wk.counts) c where c > 0),
    wk.counts,
    (select count(*)::integer from owned o
       join last_by_person_account lp on lp.sender_id = p.id and lp.account_id = o.account_id
      where o.user_id = p.id and lp.last_mine >= now() - make_interval(days => 30)),
    (select count(*)::integer from owned o
       join last_by_person_account lp on lp.sender_id = p.id and lp.account_id = o.account_id
      where o.user_id = p.id and lp.last_mine >= now() - make_interval(days => 60)),
    (select count(*)::integer from owned o
       join last_by_account la on la.account_id = o.account_id, params
      where o.user_id = p.id and la.last_any < now() - make_interval(days => params.warn_days)),
    (select count(*)::integer from owned o
       left join last_by_account la on la.account_id = o.account_id
      where o.user_id = p.id and la.last_any is null),
    (select count(*)::integer from routine r, params
      where r.sender_id = p.id and r.replied_at is not null
        and r.sent_at >= date_trunc('week', now()) - make_interval(weeks => params.weeks - 1)),
    (select count(*)::integer from routine r, params
      where r.sender_id = p.id and r.bounced_at is not null
        and r.sent_at >= date_trunc('week', now()) - make_interval(weeks => params.weeks - 1))
  from people p
  join weekly wk on wk.user_id = p.id
  -- The lead sees every account by policy; list them only if they own or sent something.
  where not p.is_admin
     or exists (select 1 from owned o where o.user_id = p.id)
     or exists (select 1 from routine r where r.sender_id = p.id)
  order by p.full_name;
$$;

-- -----------------------------------------------------------------------------
-- RP-03: relevant material. One row per collateral item named in a sent email.
--   engaged contact    -> relevant when the item's product is in use at the account
--   committee contact  -> relevant when the product is NOT in use and is pitched to
--                         the contact's function
-- Items without a product tag are "untagged".
-- -----------------------------------------------------------------------------
create or replace function public.report_material(p_days integer default 90)
returns table (
  email_id         uuid,
  sent_at          timestamptz,
  sender_id        uuid,
  sender_name      text,
  account_id       uuid,
  account_name     text,
  contact_name     text,
  contact_type     public.contact_type,
  collateral_id    uuid,
  collateral_title text,
  product_names    text[],
  verdict          text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with sent as (
    select ea.id, ea.sent_at, ea.sender_id, ea.account_id, ea.contact_id,
           jsonb_array_elements_text(coalesce(ea.draft_context -> 'collateral_ids', '[]'::jsonb)) as collateral_text
      from public.email_activity ea
     where ea.deleted_at is null
       and ea.direction = 'outbound'
       and ea.sent_at is not null
       and ea.sent_at >= now() - make_interval(days => greatest(1, least(coalesce(p_days, 90), 730)))
       and (app.is_admin() or ea.sender_id = auth.uid())
  ),
  items as (
    select s.*, col.id as col_id, col.title as col_title
      from sent s
      join public.collateral col
        on s.collateral_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       and col.id = s.collateral_text::uuid
  )
  select
    i.id,
    i.sent_at,
    i.sender_id,
    u.full_name,
    i.account_id,
    a.name,
    c.full_name,
    c.type,
    i.col_id,
    i.col_title,
    coalesce((select array_agg(p.name order by p.name)
                from public.collateral_product cp join public.product p on p.id = cp.product_id
               where cp.collateral_id = i.col_id), '{}'),
    case
      when not exists (select 1 from public.collateral_product cp where cp.collateral_id = i.col_id) then 'untagged'
      when c.type = 'engaged' and exists (
        select 1 from public.collateral_product cp
          join public.account_product ap on ap.product_id = cp.product_id
                                        and ap.account_id = i.account_id and ap.status = 'active'
         where cp.collateral_id = i.col_id) then 'relevant'
      when c.type = 'committee' and exists (
        select 1 from public.collateral_product cp
          join public.product p on p.id = cp.product_id
         where cp.collateral_id = i.col_id
           and c.business_function = any (p.target_functions)
           and not exists (select 1 from public.account_product ap
                            where ap.account_id = i.account_id and ap.product_id = p.id and ap.status = 'active')) then 'relevant'
      else 'off_target'
    end
  from items i
  join public.account a on a.id = i.account_id
  left join public.contact c on c.id = i.contact_id
  left join public.app_user u on u.id = i.sender_id
  order by i.sent_at desc;
$$;

-- -----------------------------------------------------------------------------
-- RP-04: broadcast results. RLS on email_activity scopes an owner to the rows on
-- their own accounts; the lead sees every recipient.
-- -----------------------------------------------------------------------------
create or replace function public.report_campaigns()
returns table (
  campaign_id   uuid,
  name          text,
  status        public.campaign_status,
  started_at    timestamptz,
  completed_at  timestamptz,
  recipients    integer,
  queued        integer,
  sent          integer,
  replied       integer,
  bounced       integer,
  failed        integer,
  skipped       integer,
  skip_reasons  jsonb
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select
    cp.id,
    cp.name,
    cp.status,
    cp.started_at,
    cp.completed_at,
    count(ea.id)::integer,
    (count(ea.id) filter (where ea.status = 'queued'))::integer,
    (count(ea.id) filter (where ea.sent_at is not null))::integer,
    (count(ea.id) filter (where ea.replied_at is not null))::integer,
    (count(ea.id) filter (where ea.bounced_at is not null))::integer,
    (count(ea.id) filter (where ea.status = 'failed'))::integer,
    (count(ea.id) filter (where ea.status = 'cancelled'))::integer,
    coalesce((
      select jsonb_object_agg(reason, n)
        from (select e2.governor_decision ->> 'skip_reason' as reason, count(*)::integer as n
                from public.email_activity e2
               where e2.campaign_id = cp.id and e2.status = 'cancelled' and e2.deleted_at is null
               group by 1) r
       where reason is not null
    ), '{}'::jsonb)
  from public.campaign cp
  left join public.email_activity ea on ea.campaign_id = cp.id and ea.deleted_at is null
  where cp.deleted_at is null and cp.status <> 'draft'
  group by cp.id
  order by cp.started_at desc nulls last;
$$;

revoke all on function public.report_people(integer), public.report_material(integer), public.report_campaigns()
  from public, anon;
grant execute on function public.report_people(integer), public.report_material(integer), public.report_campaigns()
  to authenticated;

-- -----------------------------------------------------------------------------
-- Enrichment rules (Apollo, decided 2026-09-13).
-- -----------------------------------------------------------------------------
insert into public.app_policy (key, value, description) values
(
  'enrichment_rules',
  jsonb_build_object(
    'provider', 'apollo',
    'who_can_enrich', 'owners_and_lead',
    'max_reveals_per_request', 10,
    'seniorities', jsonb_build_array('c_suite', 'vp', 'head'),
    'titles_by_function', jsonb_build_object(
      'hr',         jsonb_build_array('Chief Human Resources Officer', 'Chief People Officer', 'VP People', 'Head of HR'),
      'marketing',  jsonb_build_array('Chief Marketing Officer', 'VP Marketing', 'Head of Marketing'),
      'finance',    jsonb_build_array('Chief Financial Officer', 'VP Finance', 'Head of Finance'),
      'sales',      jsonb_build_array('Chief Revenue Officer', 'Chief Sales Officer', 'VP Sales'),
      'operations', jsonb_build_array('Chief Operating Officer', 'VP Operations', 'Head of Operations'),
      'it',         jsonb_build_array('Chief Information Officer', 'Chief Technology Officer', 'VP IT'),
      'legal',      jsonb_build_array('General Counsel', 'Chief Legal Officer', 'Chief Compliance Officer'),
      'product',    jsonb_build_array('Chief Product Officer', 'VP Product', 'Head of Product'),
      'executive',  jsonb_build_array('Chief Executive Officer', 'President', 'Managing Director')
    )
  ),
  'Leadership enrichment through Apollo: who may run it, how many people one request may reveal (each reveal costs Apollo credits), and the titles searched per function.'
)
on conflict (key) do nothing;

-- One Apollo person per account.
create unique index contact_account_external_key
  on public.contact (account_id, enrichment_provider, external_id)
  where external_id is not null and enrichment_provider is not null and deleted_at is null;
