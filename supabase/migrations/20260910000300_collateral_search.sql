-- =============================================================================
-- Phase 3 / 01 - natural-language collateral search
--
-- Claude turns a request ("something for a CFO worried about vendor spend")
-- into keywords, product keys, personas and content types; this function ranks
-- the library against them. Works on the sample collateral today; the Skott
-- feed will fill the same table later.
--
-- No click tracking: collateral goes to people we are already in conversation
-- with, and tracked links are parked until Skott's data shape is known.
-- =============================================================================

alter table public.collateral
  add column search_tsv tsvector generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(summary, '')), 'B') ||
    setweight(to_tsvector('english', replace(content_type, '_', ' ')), 'C')
  ) stored;

create index collateral_search_idx on public.collateral using gin (search_tsv);

-- SECURITY INVOKER: the caller's RLS on collateral, product and the persona
-- tables still applies. Every filter is a boost, not a hard filter, so a request
-- Claude reads slightly wrong still returns the closest material.
create or replace function public.search_collateral(
  p_query          text default null,
  p_product_keys   text[] default null,
  p_functions      public.business_function[] default null,
  p_content_types  text[] default null,
  p_limit          integer default 20
)
returns table (
  collateral_id  uuid,
  title          text,
  summary        text,
  content_type   text,
  asset_url      text,
  product_names  text[],
  product_keys   text[],
  personas       text[],
  score          real
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
    s.product_names, s.product_keys, s.personas, s.score::real
  from scored s
  where s.score > 0
     or ((select tsq from q) is null
         and p_product_keys is null
         and p_functions is null
         and p_content_types is null)
  order by s.score desc, s.title
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$$;

revoke all on function public.search_collateral(text, text[], public.business_function[], text[], integer) from public, anon;
grant execute on function public.search_collateral(text, text[], public.business_function[], text[], integer) to authenticated;
