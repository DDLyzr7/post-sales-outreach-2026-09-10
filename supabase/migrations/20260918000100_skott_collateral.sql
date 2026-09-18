-- =============================================================================
-- Skott collateral (CL-04), collateral links in emails (CL-05, CL-06)
--
-- Skott is Lyzr's marketing and sales knowledge base, reached as an MCP server
-- with two read-only tools: list_kb (the library) and search_kb (semantic
-- search). Items are links, never files: public lyzr.ai pages, internal
-- SharePoint files and prototypes built for named clients.
--
-- - The feed job (src/lib/jobs/skott.ts, service role) mirrors list_kb into
--   collateral. list_kb stops at 100 items in some sections, so
--   record_skott_items() also lets a search add the client-shareable items it
--   finds. That function only inserts, and only rows that pass the email rule.
-- - Which items can go in a client email is data: app_policy.collateral_rules
--   lists the content types and link hosts. collateral.client_shareable is
--   computed from it by trigger, and recomputed whenever the rule changes.
-- - app.guard_email_collateral refuses a draft that adds collateral a client
--   can't be sent.
-- =============================================================================

-- Skott's types, alongside the original ones the sample collateral uses.
alter table public.collateral drop constraint collateral_content_type_check;
alter table public.collateral add constraint collateral_content_type_check check (content_type in (
  'one_pager', 'case_study', 'webinar', 'roi_calculator', 'guide', 'release_note',
  'playbook', 'template', 'blog', 'deck', 'research', 'battle_card', 'prototype',
  'glossary', 'comparison', 'web_page', 'other'
));

alter table public.collateral
  add column source_system    text check (source_system in ('skott')),
  add column external_id      text,
  -- Where Skott got it: wordpress (lyzr.ai), sharepoint, pipeline-tracker.
  add column source_origin    text,
  add column published_on     date,
  -- Set by the feed when the item was in list_kb; null for items only a search found.
  add column listed_at        timestamptz,
  -- Can this go in an email to a client? Computed for Skott rows; the lead's call for others.
  add column client_shareable boolean not null default true,
  add constraint collateral_source_unique unique (source_system, external_id),
  add constraint collateral_source_pair check ((source_system is null) = (external_id is null));

insert into public.app_policy (key, value, description) values
(
  'collateral_rules',
  jsonb_build_object(
    'skott', jsonb_build_object(
      'type_map', jsonb_build_object(
        'case-study', 'case_study', 'one-pager', 'one_pager', 'playbook', 'playbook',
        'template', 'template', 'blog', 'blog', 'deck', 'deck', 'research', 'research',
        'battle-card', 'battle_card', 'prototype', 'prototype', 'glossary', 'glossary',
        'compare', 'comparison', 'page', 'web_page', 'other', 'other'
      ),
      -- The feed retires items missing from list_kb only when the listing has at
      -- least this share of the items it had before, so a short read retires nothing.
      'retire_min_ratio', 0.5
    ),
    'email', jsonb_build_object(
      -- Case studies, lyzr.ai blueprints, playbooks, templates and use-case lists, blog posts.
      'content_types', jsonb_build_array('case_study', 'one_pager', 'playbook', 'template', 'blog'),
      -- Public pages only. SharePoint links are internal and open in edit mode.
      'link_hosts', jsonb_build_array('www.lyzr.ai', 'lyzr.ai'),
      -- A link to any of these in a draft gets a pre-send warning. Suffix match.
      'internal_link_hosts', jsonb_build_array('sharepoint.com', '1drv.ms', 'onedrive.live.com')
    )
  ),
  'Skott collateral: type mapping, and which collateral can go in a client email.'
)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- The email rule, from policy. Only https links on an allowed host, of an allowed type.
-- -----------------------------------------------------------------------------
create or replace function app.collateral_client_shareable(p_content_type text, p_url text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((
    select p_content_type in (select jsonb_array_elements_text(value -> 'email' -> 'content_types'))
       and lower(substring(p_url from '^https://([^/:?#@]+)'))
           in (select lower(jsonb_array_elements_text(value -> 'email' -> 'link_hosts')))
      from public.app_policy
     where key = 'collateral_rules'
  ), false);
$$;

create or replace function app.set_collateral_shareable()
returns trigger
language plpgsql
as $$
begin
  if new.source_system is not null then
    new.client_shareable := app.collateral_client_shareable(new.content_type, new.asset_url);
  end if;
  return new;
end;
$$;

create trigger collateral_set_shareable
  before insert or update on public.collateral
  for each row execute function app.set_collateral_shareable();

-- Changing the rule re-evaluates every Skott item straight away.
create or replace function app.recompute_collateral_shareable()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.key = 'collateral_rules' then
    update public.collateral
       set client_shareable = app.collateral_client_shareable(content_type, asset_url)
     where source_system is not null;
  end if;
  return null;
end;
$$;

create trigger app_policy_recompute_collateral
  after insert or update on public.app_policy
  for each row execute function app.recompute_collateral_shareable();

-- -----------------------------------------------------------------------------
-- A search can add the client-shareable items it found. Insert only: it never
-- changes a row, so it can't rewrite what the feed or the lead put there, and it
-- only takes items that pass the email rule (public lyzr.ai pages of an allowed type).
-- -----------------------------------------------------------------------------
create or replace function public.record_skott_items(p_items jsonb)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_rules  jsonb;
  v_item   jsonb;
  v_id     text;
  v_title  text;
  v_url    text;
  v_type   text;
  v_date   text;
  v_count  integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'Expected a list of up to 50 items.' using errcode = '22023';
  end if;

  select value into v_rules from public.app_policy where key = 'collateral_rules';
  if v_rules is null then
    return 0;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    continue when jsonb_typeof(v_item) is distinct from 'object';
    v_id    := v_item ->> 'id';
    v_title := btrim(v_item ->> 'title');
    v_url   := btrim(v_item ->> 'url');
    v_type  := coalesce(v_rules -> 'skott' -> 'type_map' ->> (v_item ->> 'type'), 'other');
    v_date  := v_item ->> 'published_on';

    continue when v_id is null or v_id !~ '^[A-Za-z0-9_-]{1,120}$';
    continue when v_title is null or v_title = '' or length(v_title) > 300;
    continue when v_url is null or length(v_url) > 1000;
    continue when not app.collateral_client_shareable(v_type, v_url);

    insert into public.collateral
      (slug, title, asset_url, content_type, source_system, external_id, source_origin, published_on)
    values
      ('skott-' || v_id, v_title, v_url, v_type, 'skott', v_id,
       left(v_item ->> 'source', 40),
       case when v_date ~ '^\d{4}-\d{2}-\d{2}$' then v_date::date end)
    on conflict (source_system, external_id) do nothing;

    if found then
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.record_skott_items(jsonb) from public, anon;
grant execute on function public.record_skott_items(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- A signed-in user can't add collateral to a draft unless a client can be sent
-- it. Only collateral new to the draft is checked, so an item retired later
-- doesn't lock an existing draft. SECURITY INVOKER, so current_user is the caller.
-- -----------------------------------------------------------------------------
create or replace function app.guard_email_collateral()
returns trigger
language plpgsql
as $$
declare
  v_new jsonb := coalesce(new.draft_context -> 'collateral_ids', '[]'::jsonb);
  v_old jsonb := '[]'::jsonb;
  v_bad text;
begin
  if auth.uid() is null or current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    v_old := coalesce(old.draft_context -> 'collateral_ids', '[]'::jsonb);
    if v_new = v_old then
      return new;
    end if;
  end if;
  if jsonb_typeof(v_new) <> 'array' then
    raise exception 'draft_context.collateral_ids must be a list.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_old) <> 'array' then
    v_old := '[]'::jsonb;
  end if;

  select x into v_bad
    from jsonb_array_elements_text(v_new) as x
   where x not in (select jsonb_array_elements_text(v_old))
     and not exists (
       select 1 from public.collateral c
        where c.id::text = x and c.is_active and c.deleted_at is null and c.client_shareable
     )
   limit 1;

  if v_bad is not null then
    raise exception 'That collateral can''t go in a client email: it''s internal, or no longer in the library.'
      using errcode = 'P0002';
  end if;
  return new;
end;
$$;

create trigger email_activity_guard_collateral
  before insert or update of draft_context on public.email_activity
  for each row execute function app.guard_email_collateral();

-- -----------------------------------------------------------------------------
-- search_collateral now says whether each item can go in an email, and can
-- return only those.
-- -----------------------------------------------------------------------------
drop function public.search_collateral(text, text[], public.business_function[], text[], integer);

create function public.search_collateral(
  p_query           text default null,
  p_product_keys    text[] default null,
  p_functions       public.business_function[] default null,
  p_content_types   text[] default null,
  p_limit           integer default 20,
  p_shareable_only  boolean default false
)
returns table (
  collateral_id     uuid,
  title             text,
  summary           text,
  content_type      text,
  asset_url         text,
  product_names     text[],
  product_keys      text[],
  personas          text[],
  score             real,
  client_shareable  boolean,
  source_system     text
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with q as (
    -- Words are OR-ed, so a full sentence still matches the items that share
    -- any of its meaningful words; ranking puts the best overlap first.
    select case
      when nullif(trim(p_query), '') is null then null
      when plainto_tsquery('english', p_query)::text = '' then null
      else replace(plainto_tsquery('english', p_query)::text, '&', '|')::tsquery
    end as tsq
  ),
  base as (
    select
      c.id,
      c.title,
      c.summary,
      c.content_type,
      c.asset_url,
      c.search_tsv,
      c.client_shareable,
      c.source_system,
      coalesce(array_agg(distinct p.name) filter (where p.id is not null), '{}') as product_names,
      coalesce(array_agg(distinct p.key)  filter (where p.id is not null), '{}') as product_keys,
      coalesce(array_agg(distinct cp.business_function::text || ':' || cp.contact_type::text)
               filter (where cp.collateral_id is not null), '{}') as personas,
      coalesce(array_agg(distinct cp.business_function)
               filter (where cp.collateral_id is not null), '{}') as functions,
      to_tsvector('english', coalesce(string_agg(distinct p.name, ' '), '')) as product_tsv
    from public.collateral c
    left join public.collateral_product cprod on cprod.collateral_id = c.id
    left join public.product p
      on p.id = cprod.product_id and p.is_active and p.deleted_at is null
    left join public.collateral_persona cp on cp.collateral_id = c.id
    where c.is_active and c.deleted_at is null
      and (not coalesce(p_shareable_only, false) or c.client_shareable)
    group by c.id
  ),
  scored as (
    select
      b.*,
      (case when q.tsq is null then 0
            else ts_rank_cd(b.search_tsv, q.tsq) + ts_rank_cd(b.product_tsv, q.tsq) end)
      + (case when p_product_keys is not null and b.product_keys && p_product_keys then 0.6 else 0 end)
      + (case when p_functions is not null and b.functions && p_functions then 0.5 else 0 end)
      + (case when p_content_types is not null and b.content_type = any (p_content_types) then 0.3 else 0 end)
      as score
    from base b
    cross join q
  )
  select
    s.id, s.title, s.summary, s.content_type, s.asset_url,
    s.product_names, s.product_keys, s.personas, s.score::real,
    s.client_shareable, s.source_system
  from scored s
  where s.score > 0
     or ((select tsq from q) is null
         and p_product_keys is null
         and p_functions is null
         and p_content_types is null)
  order by s.score desc, s.title
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.search_collateral(text, text[], public.business_function[], text[], integer, boolean) from public, anon;
grant execute on function public.search_collateral(text, text[], public.business_function[], text[], integer, boolean) to authenticated;

-- The feed is a job_run like the others.
alter table public.job_run drop constraint job_run_job_check;
alter table public.job_run add constraint job_run_job_check check (job in ('send', 'track', 'sync', 'skott'));
