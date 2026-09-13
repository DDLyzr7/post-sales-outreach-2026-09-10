-- =============================================================================
-- Phase 6 / 01 - global broadcast
--
-- The post-sales lead writes one campaign (subject, body with merge fields,
-- audience filters), previews who it reaches and who is skipped and why, then
-- launches it. Launching fans out one email_activity row per contact:
--   queued     -> the send job delivers it from the account's primary owner's mailbox
--   cancelled  -> skipped, with the reason in governor_decision.skip_reason
-- Broadcasts sit outside the monthly cap (decided 2026-09-13), so launch never
-- checks or consumes it. Opt-outs are checked at launch and again at send time.
--
-- Merge fields: {{contact_first_name}} {{account_name}} {{sender_first_name}}
-- {{sender_full_name}}. Launch refuses leftover {{fields}} or [[markers]].
--
-- audience (jsonb), every key optional, an empty list means "no filter":
--   { "lifecycle": ["existing"], "tiers": [...], "health": [...],
--     "product_keys": [...], "contact_types": ["engaged","committee"] }
-- =============================================================================

alter table public.campaign
  add column subject              text not null default '',
  add column body_text            text not null default '',
  add column audience             jsonb not null default jsonb_build_object('lifecycle', jsonb_build_array('existing')),
  add column template_version_id  uuid references public.template_version (id),
  add column launched_by          uuid references public.app_user (id),
  add column cancelled_at         timestamptz;

create trigger campaign_stamp_audit_actor
  before insert or update on public.campaign
  for each row execute function app.stamp_audit_actor();

-- A launched campaign's content is what went out; it can't be rewritten.
create or replace function app.guard_campaign_write()
returns trigger
language plpgsql
as $$
begin
  if auth.uid() is null or current_user <> 'authenticated' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'New broadcasts start as drafts.' using errcode = '42501';
    end if;
    new.email_type := 'launch_broadcast';
    return new;
  end if;
  if new.status is distinct from old.status then
    raise exception 'Launch or cancel a broadcast with its buttons.' using errcode = '42501';
  end if;
  if old.status <> 'draft'
     and (new.subject is distinct from old.subject
          or new.body_text is distinct from old.body_text
          or new.audience is distinct from old.audience
          or new.scheduled_at is distinct from old.scheduled_at
          or new.name is distinct from old.name) then
    raise exception 'A launched broadcast can''t be edited.' using errcode = '42501';
  end if;
  new.email_type := 'launch_broadcast';
  return new;
end;
$$;

create trigger campaign_guard_write
  before insert or update on public.campaign
  for each row execute function app.guard_campaign_write();

-- -----------------------------------------------------------------------------
-- Audience resolution. Internal; the public wrappers check for the lead.
-- -----------------------------------------------------------------------------
create or replace function app.jsonb_text_array(p_value jsonb)
returns text[]
language sql
immutable
as $$
  select case
    when p_value is null or jsonb_typeof(p_value) <> 'array' or jsonb_array_length(p_value) = 0 then null
    else array(select jsonb_array_elements_text(p_value))
  end;
$$;

create or replace function app.campaign_audience(p_audience jsonb)
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
  with f as (
    select
      app.jsonb_text_array(p_audience -> 'lifecycle')     as lifecycle,
      app.jsonb_text_array(p_audience -> 'tiers')         as tiers,
      app.jsonb_text_array(p_audience -> 'health')        as health,
      app.jsonb_text_array(p_audience -> 'product_keys')  as product_keys,
      app.jsonb_text_array(p_audience -> 'contact_types') as contact_types,
      app.sending_mode()                                  as mode
  ),
  accounts as (
    select a.*
      from public.account a, f
     where a.deleted_at is null
       and (f.lifecycle is null or a.lifecycle_status::text = any (f.lifecycle))
       and (f.tiers     is null or a.tier::text            = any (f.tiers))
       and (f.health    is null or a.health_status::text   = any (f.health))
       and (f.product_keys is null or exists (
             select 1 from public.account_product ap
               join public.product p on p.id = ap.product_id
              where ap.account_id = a.id and ap.status = 'active' and p.key = any (f.product_keys)))
  ),
  owners as (
    select distinct on (aa.account_id)
           aa.account_id, u.id as user_id, u.full_name, u.email, u.warm_sender_address
      from public.account_assignment aa
      join public.app_user u on u.id = aa.user_id and u.is_active and u.deleted_at is null
     where aa.deleted_at is null
     order by aa.account_id, aa.is_primary desc, aa.created_at
  )
  select
    a.id,
    a.name,
    c.id,
    c.full_name,
    c.email,
    c.type,
    o.user_id,
    o.full_name,
    case when mc.status = 'connected' then mc.email_address
         else coalesce(o.warm_sender_address, o.email) end,
    app.resolve_send_path('launch_broadcast', c.type),
    case
      when c.is_opted_out then 'opted_out'
      when c.email is null then 'no_email'
      when o.user_id is null then 'no_owner'
      when f.mode = 'live' and coalesce(mc.status, '') <> 'connected' then 'owner_mailbox_not_connected'
      else null
    end
  from accounts a
  cross join f
  join public.contact c
    on c.account_id = a.id and c.deleted_at is null
   and (f.contact_types is null or c.type::text = any (f.contact_types))
  left join owners o on o.account_id = a.id
  left join public.mailbox_connection mc on mc.user_id = o.user_id
  order by a.name, c.type, c.full_name;
$$;

revoke all on function app.jsonb_text_array(jsonb), app.campaign_audience(jsonb) from public, anon, authenticated;

create or replace function public.preview_campaign_audience(p_audience jsonb)
returns table (
  account_id uuid, account_name text, contact_id uuid, contact_name text, contact_email text,
  contact_type public.contact_type, sender_id uuid, sender_name text, from_email text,
  send_path public.send_path, skip_reason text
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not app.is_admin() then
    raise exception 'Only the post-sales lead can build broadcasts.' using errcode = '42501';
  end if;
  return query select * from app.campaign_audience(coalesce(p_audience, '{}'::jsonb));
end;
$$;

create or replace function app.merge_broadcast(
  p_text text, p_contact_name text, p_account_name text, p_sender_name text
)
returns text
language sql
immutable
as $$
  select replace(replace(replace(replace(coalesce(p_text, ''),
    '{{contact_first_name}}', coalesce(split_part(p_contact_name, ' ', 1), '')),
    '{{account_name}}',       coalesce(p_account_name, '')),
    '{{sender_first_name}}',  coalesce(split_part(p_sender_name, ' ', 1), '')),
    '{{sender_full_name}}',   coalesce(p_sender_name, ''));
$$;

revoke all on function app.merge_broadcast(text, text, text, text) from public, anon, authenticated;

create or replace function public.launch_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign public.campaign;
  v_mode     text := app.sending_mode();
  v_when     timestamptz;
  v_queued   integer;
  v_skipped  integer;
begin
  if not app.is_admin() then
    raise exception 'Only the post-sales lead can launch a broadcast.' using errcode = '42501';
  end if;

  select * into v_campaign from public.campaign
   where id = p_campaign_id and deleted_at is null
   for update;
  if v_campaign.id is null then
    raise exception 'That broadcast could not be found.' using errcode = 'P0002';
  end if;
  if v_campaign.status <> 'draft' then
    raise exception 'This broadcast has already been launched.' using errcode = '55000';
  end if;
  if v_mode = 'paused' then
    raise exception 'Sending is paused. Switch it back on in Settings first.' using errcode = '55000';
  end if;
  if trim(v_campaign.subject) = '' or trim(v_campaign.body_text) = '' then
    raise exception 'Write a subject and a body before launching.' using errcode = '22023';
  end if;
  if app.merge_broadcast(v_campaign.subject || v_campaign.body_text, 'x', 'x', 'x') ~ '\{\{|\[\[' then
    raise exception 'The broadcast still has an unknown {{field}} or a [[marker]] to fill in.' using errcode = '22023';
  end if;

  v_when := greatest(coalesce(v_campaign.scheduled_at, now()), now());

  insert into public.email_activity (
    account_id, contact_id, sender_id, campaign_id, template_version_id,
    email_type, send_path, direction, status, subject, body_text,
    to_email, from_email, scheduled_for, governor_decision, unsubscribe_token,
    approved_by, approved_at
  )
  select
    r.account_id, r.contact_id, r.sender_id, v_campaign.id, v_campaign.template_version_id,
    'launch_broadcast', r.send_path, 'outbound',
    case when r.skip_reason is null then 'queued'::public.email_status else 'cancelled'::public.email_status end,
    left(app.merge_broadcast(v_campaign.subject, r.contact_name, r.account_name, r.sender_name), 300),
    app.merge_broadcast(v_campaign.body_text, r.contact_name, r.account_name, r.sender_name),
    r.contact_email, r.from_email,
    case when r.skip_reason is null then v_when end,
    jsonb_build_object(
      'decided_at', now(), 'decided_by', auth.uid(), 'mode', v_mode, 'broadcast', true,
      'counts_toward_cap', false, 'skip_reason', r.skip_reason,
      'provider', case when v_mode = 'dry_run' then 'dry_run' else 'microsoft_graph' end
    ),
    case when r.skip_reason is null then gen_random_uuid() end,
    auth.uid(), now()
  from app.campaign_audience(v_campaign.audience) r;

  select count(*) filter (where status = 'queued'), count(*) filter (where status = 'cancelled')
    into v_queued, v_skipped
    from public.email_activity where campaign_id = v_campaign.id;

  update public.campaign
     set status       = case when v_queued = 0 then 'completed'::public.campaign_status
                             when v_when > now() + interval '1 minute' then 'scheduled'::public.campaign_status
                             else 'running'::public.campaign_status end,
         scheduled_at = v_when,
         started_at   = now(),
         completed_at = case when v_queued = 0 then now() end,
         launched_by  = auth.uid()
   where id = v_campaign.id;

  return jsonb_build_object('queued', v_queued, 'skipped', v_skipped, 'mode', v_mode, 'scheduled_for', v_when);
end;
$$;

create or replace function public.cancel_campaign(p_campaign_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_campaign  public.campaign;
  v_cancelled integer;
begin
  if not app.is_admin() then
    raise exception 'Only the post-sales lead can cancel a broadcast.' using errcode = '42501';
  end if;

  select * into v_campaign from public.campaign where id = p_campaign_id and deleted_at is null for update;
  if v_campaign.id is null then
    raise exception 'That broadcast could not be found.' using errcode = 'P0002';
  end if;
  if v_campaign.status in ('completed', 'cancelled') then
    raise exception 'This broadcast has already finished.' using errcode = '55000';
  end if;

  update public.email_activity
     set status = 'cancelled',
         governor_decision = coalesce(governor_decision, '{}'::jsonb)
                             || jsonb_build_object('skip_reason', 'cancelled_by_lead', 'cancelled_at', now())
   where campaign_id = v_campaign.id
     and status = 'queued'
     and (locked_at is null or locked_at < now() - interval '10 minutes');
  get diagnostics v_cancelled = row_count;

  update public.campaign
     set status = 'cancelled', cancelled_at = now(), completed_at = coalesce(completed_at, now())
   where id = v_campaign.id;

  return jsonb_build_object('cancelled', v_cancelled);
end;
$$;

revoke all on function public.preview_campaign_audience(jsonb),
                       public.launch_campaign(uuid),
                       public.cancel_campaign(uuid)
  from public, anon;
grant execute on function public.preview_campaign_audience(jsonb),
                          public.launch_campaign(uuid),
                          public.cancel_campaign(uuid)
  to authenticated;
