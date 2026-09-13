-- =============================================================================
-- Phase 5 / 01 - sending through the owner's Microsoft 365 mailbox
--
-- Decided 2026-09-13:
--   * Microsoft 365 only. Every email leaves from its author's own mailbox, on
--     both paths. send_path stays a classification; send_path_routing.providers
--     maps each path to a provider so cold can move to its own service later.
--   * Broadcasts sit outside the monthly limit: they neither count toward it nor
--     are blocked by it.
--
-- The flow:
--   approved --send_email()--> queued --send job--> sent --tracking job--> replied / bounced
--                                     \--send job--> failed (after max_attempts)
--   queued --cancel_queued_email()--> approved   (only before the job picks it up)
--
-- send_email() is the only way a signed-in user moves an email past 'approved'.
-- It runs the governor (opt-out, address, sending mode, mailbox, monthly limit)
-- under an advisory lock on the account, so two sends can't both take the last
-- slot. Everything from 'sent' onwards is written by jobs on the service-role
-- key, which have no JWT subject.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Policy
-- -----------------------------------------------------------------------------
update public.app_policy
   set value = value || jsonb_build_object(
         'counts_campaign_sends', false,
         'excluded_email_types', jsonb_build_array('launch_broadcast'),
         'counts_queued', true
       ),
       description = 'Cap on routine outbound emails per account per calendar month, counted across every sender and both send paths. Queued emails hold a slot. Broadcasts sit outside the cap (decided 2026-09-13).'
 where key = 'frequency_cap';

update public.app_policy
   set value = value || jsonb_build_object(
         'providers', jsonb_build_object('warm', 'microsoft_graph', 'cold', 'microsoft_graph')
       ),
       description = 'Maps (email_type, contact_type) to a send path, and each path to a provider. Both paths send from the author''s own Microsoft 365 mailbox (decided 2026-09-13); the path is still shown before send and drives the unsubscribe footer.'
 where key = 'send_path_routing';

update public.app_policy
   set value = jsonb_build_object(
         'status', 'CONFIRMED_2026_09_13',
         'strategy', 'broadcast_outside_cap',
         'broadcast_counts_toward_cap', false,
         'broadcast_blocked_by_cap', false
       ),
       description = 'Broadcasts sit outside the monthly cap: they do not count toward it and are not blocked by it. Routine emails count only other routine emails.'
 where key = 'broadcast_vs_routine_priority';

insert into public.app_policy (key, value, description) values
(
  'sending',
  jsonb_build_object(
    -- dry_run: the send job records emails as sent without contacting Microsoft.
    -- live: real email. paused: nothing new can be queued and the job sends nothing.
    'mode', 'dry_run',
    'max_attempts', 3,
    'batch_size', 25,
    'lock_minutes', 10,
    'unsubscribe_footer_email_types', jsonb_build_array('cross_sell_intro', 'friend_account', 'launch_broadcast'),
    'unsubscribe_footer_text', 'If you''d rather not hear from us about this, let us know here: {{unsubscribe_url}}'
  ),
  'Sending mode (dry_run, live or paused), retry limits, and which email types carry an unsubscribe line. Starts in dry_run; the post-sales lead switches to live.'
)
on conflict (key) do nothing;

-- -----------------------------------------------------------------------------
-- 2. The monthly count excludes broadcasts. Same columns, one appended.
-- -----------------------------------------------------------------------------
create or replace view public.account_monthly_send_count
with (security_invoker = on) as
select
  ea.account_id,
  (count(*) filter (where ea.email_type <> 'launch_broadcast'))::integer                           as sends_this_month,
  (count(*) filter (where ea.email_type <> 'launch_broadcast' and ea.send_path = 'warm'))::integer as warm_sends_this_month,
  (count(*) filter (where ea.email_type <> 'launch_broadcast' and ea.send_path = 'cold'))::integer as cold_sends_this_month,
  (count(*) filter (where ea.campaign_id is not null))::integer                                    as campaign_sends_this_month,
  (count(*) filter (where ea.email_type = 'launch_broadcast'))::integer                            as broadcast_sends_this_month
from public.email_activity ea
where ea.deleted_at is null
  and ea.direction = 'outbound'
  and ea.sent_at is not null
  and ea.sent_at >= date_trunc('month', now())
  and ea.sent_at <  date_trunc('month', now()) + interval '1 month'
group by ea.account_id;

-- -----------------------------------------------------------------------------
-- 3. Delivery bookkeeping on email_activity
-- -----------------------------------------------------------------------------
alter table public.email_activity
  add column provider_thread_id  text,
  add column send_attempts       integer not null default 0,
  add column locked_at           timestamptz,
  add column unsubscribe_token   uuid;

create unique index email_activity_unsubscribe_token_key
  on public.email_activity (unsubscribe_token) where unsubscribe_token is not null;
create index email_activity_queue_idx
  on public.email_activity (scheduled_for) where status = 'queued' and deleted_at is null;
create index email_activity_thread_idx
  on public.email_activity (sender_id, provider_thread_id) where provider_thread_id is not null;

-- -----------------------------------------------------------------------------
-- 4. Mailbox connections.
--
-- mailbox_connection is what the app shows: readable by its owner and the lead,
-- written only by the functions below and the jobs.
-- mailbox_token holds the Microsoft refresh token, encrypted in Node with
-- MAILBOX_TOKEN_KEY before it reaches Postgres. RLS on and no policies: no
-- signed-in user can read it, not even their own. Only the jobs (service role) do.
-- -----------------------------------------------------------------------------
create table public.mailbox_connection (
  user_id           uuid primary key references public.app_user (id) on delete cascade,
  provider          text not null default 'microsoft' check (provider in ('microsoft')),
  email_address     text not null,
  status            text not null default 'connected'
                      check (status in ('connected', 'needs_reconnect', 'disconnected')),
  scopes            text[] not null default '{}',
  connected_at      timestamptz not null default now(),
  -- Tracking cursor: inbox messages received after this have been checked.
  inbox_checked_at  timestamptz,
  last_error        text,
  updated_at        timestamptz not null default now()
);
create trigger mailbox_connection_touch_updated_at
  before update on public.mailbox_connection
  for each row execute function app.touch_updated_at();

create table public.mailbox_token (
  user_id     uuid primary key references public.app_user (id) on delete cascade,
  ciphertext  text not null,
  updated_at  timestamptz not null default now()
);

alter table public.mailbox_connection enable row level security;
alter table public.mailbox_token      enable row level security;

create policy mailbox_connection_select on public.mailbox_connection
  for select to authenticated
  using (user_id = auth.uid() or app.is_admin());

revoke all on public.mailbox_connection from anon;
revoke insert, update, delete on public.mailbox_connection from authenticated;
grant select on public.mailbox_connection to authenticated;
revoke all on public.mailbox_token from anon, authenticated;

-- Saves a connection for the caller. The address must be the caller's own sign-in
-- or sending address, so a connection can never put someone else's name on email.
create or replace function public.save_mailbox_connection(
  p_email_address text,
  p_ciphertext    text,
  p_scopes        text[]
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid  uuid := auth.uid();
  v_user public.app_user;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select * into v_user from public.app_user where id = v_uid and deleted_at is null;
  if v_user.id is null then
    raise exception 'Your profile could not be found.' using errcode = '42501';
  end if;

  if lower(coalesce(p_email_address, '')) not in (lower(v_user.email), lower(coalesce(v_user.warm_sender_address, ''))) then
    raise exception 'That Microsoft mailbox (%) isn''t yours in this app. Connect the mailbox for %.',
      p_email_address, v_user.email
      using errcode = '42501';
  end if;

  if coalesce(p_ciphertext, '') = '' then
    raise exception 'Microsoft didn''t return a token. Try connecting again.' using errcode = '22023';
  end if;

  insert into public.mailbox_token (user_id, ciphertext, updated_at)
  values (v_uid, p_ciphertext, now())
  on conflict (user_id) do update set ciphertext = excluded.ciphertext, updated_at = now();

  insert into public.mailbox_connection (user_id, provider, email_address, status, scopes, connected_at, last_error)
  values (v_uid, 'microsoft', lower(p_email_address), 'connected', coalesce(p_scopes, '{}'), now(), null)
  on conflict (user_id) do update
    set email_address = excluded.email_address,
        status        = 'connected',
        scopes        = excluded.scopes,
        connected_at  = now(),
        last_error    = null;
end;
$$;

create or replace function public.disconnect_mailbox()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  delete from public.mailbox_token where user_id = auth.uid();
  update public.mailbox_connection
     set status = 'disconnected', last_error = null
   where user_id = auth.uid();
end;
$$;

revoke all on function public.save_mailbox_connection(text, text, text[]) from public, anon;
revoke all on function public.disconnect_mailbox() from public, anon;
grant execute on function public.save_mailbox_connection(text, text, text[]) to authenticated;
grant execute on function public.disconnect_mailbox() to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Governor helpers. These mirror emailTypeFor() and resolveSendPath() in
-- src/lib/policy.ts; at send time the database's answer is the one that counts.
-- -----------------------------------------------------------------------------
create or replace function app.email_type_for(p_contact_type public.contact_type, p_is_friend boolean)
returns public.email_type
language sql
immutable
as $$
  select case
    when p_is_friend then 'friend_account'::public.email_type
    when p_contact_type = 'engaged' then 'product_update'::public.email_type
    else 'cross_sell_intro'::public.email_type
  end;
$$;

create or replace function app.resolve_send_path(p_email_type public.email_type, p_contact_type public.contact_type)
returns public.send_path
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_policy jsonb;
  v_rule   jsonb;
begin
  select value into v_policy from public.app_policy where key = 'send_path_routing';
  if v_policy is null then
    return 'cold';
  end if;
  for v_rule in select * from jsonb_array_elements(coalesce(v_policy -> 'rules', '[]'::jsonb)) loop
    if (v_rule -> 'when' ->> 'email_type' is null or v_rule -> 'when' ->> 'email_type' = p_email_type::text)
       and (v_rule -> 'when' ->> 'contact_type' is null or v_rule -> 'when' ->> 'contact_type' = p_contact_type::text) then
      return (v_rule ->> 'path')::public.send_path;
    end if;
  end loop;
  return coalesce(v_policy ->> 'default', 'cold')::public.send_path;
end;
$$;

create or replace function app.sending_mode()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce((select value ->> 'mode' from public.app_policy where key = 'sending'), 'paused');
$$;

-- Routine emails holding a slot this month: sent, plus queued (a queued email has
-- already passed the governor and will send).
create or replace function app.routine_slots_used(p_account_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
  from public.email_activity ea
  where ea.account_id = p_account_id
    and ea.deleted_at is null
    and ea.direction = 'outbound'
    and ea.email_type <> 'launch_broadcast'
    and (
      (ea.sent_at is not null
        and ea.sent_at >= date_trunc('month', now())
        and ea.sent_at <  date_trunc('month', now()) + interval '1 month')
      or ea.status = 'queued'
    );
$$;

revoke all on function app.email_type_for(public.contact_type, boolean),
                       app.resolve_send_path(public.email_type, public.contact_type),
                       app.sending_mode(),
                       app.routine_slots_used(uuid)
  from public, anon;
grant execute on function app.email_type_for(public.contact_type, boolean),
                          app.resolve_send_path(public.email_type, public.contact_type),
                          app.sending_mode(),
                          app.routine_slots_used(uuid)
  to authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. The write guard, extended.
--
-- Functions in this migration run as their owner, not as `authenticated`, so the
-- guard steps aside for them exactly as it does for jobs. A signed-in user writing
-- through the REST API still gets every Phase 4 rule, plus: no broadcast type, no
-- campaign, and none of the new delivery fields.
-- -----------------------------------------------------------------------------
create or replace function app.guard_email_activity_write()
returns trigger
language plpgsql
as $$
declare
  v_contact_account uuid;
  v_opted_out       boolean;
  v_email           text;
begin
  -- Jobs have no JWT subject; the SECURITY DEFINER functions (send_email,
  -- launch_campaign...) run as their owner and do their own checks.
  if auth.uid() is null or current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.sender_id is distinct from auth.uid() then
      raise exception 'A draft is always written under your own name.'
        using errcode = '42501';
    end if;
    if new.status <> 'drafted' then
      raise exception 'New emails start as drafts.'
        using errcode = '42501';
    end if;
    if new.campaign_id is not null then
      raise exception 'Broadcast emails are created by launching the broadcast.'
        using errcode = '42501';
    end if;
  else
    if old.status not in ('drafted', 'approved') then
      raise exception 'This email is past the drafting stage and can''t be changed.'
        using errcode = '42501';
    end if;
    if old.sender_id is distinct from auth.uid() then
      raise exception 'Only the person who wrote a draft can change it.'
        using errcode = '42501';
    end if;
    if new.account_id  is distinct from old.account_id
       or new.contact_id  is distinct from old.contact_id
       or new.sender_id   is distinct from old.sender_id
       or new.campaign_id is distinct from old.campaign_id then
      raise exception 'A draft''s account, recipient and author can''t be changed.'
        using errcode = '42501';
    end if;
    if old.status = 'approved' and new.status = 'approved'
       and (new.subject is distinct from old.subject
            or new.body_text is distinct from old.body_text
            or new.body_html is distinct from old.body_html) then
      raise exception 'Move the email back to draft before editing it.'
        using errcode = '42501';
    end if;
  end if;

  if new.email_type = 'launch_broadcast' then
    raise exception 'Broadcast emails are created by launching the broadcast.'
      using errcode = '42501';
  end if;

  if new.direction <> 'outbound' then
    raise exception 'Only outbound drafts can be written from the app.'
      using errcode = '42501';
  end if;

  if new.status not in ('drafted', 'approved', 'cancelled') then
    raise exception 'Emails are queued with Send and marked as sent by the sending service, not by hand.'
      using errcode = '42501';
  end if;

  if new.sent_at is not null or new.opened_at is not null or new.replied_at is not null
     or new.bounced_at is not null or new.scheduled_for is not null
     or new.provider is not null or new.provider_message_id is not null
     or new.provider_thread_id is not null or new.locked_at is not null
     or new.governor_decision is not null or new.error_message is not null
     or new.deleted_at is not null
     or new.send_attempts is distinct from (case when tg_op = 'UPDATE' then old.send_attempts else 0 end)
     or new.unsubscribe_token is distinct from (case when tg_op = 'UPDATE' then old.unsubscribe_token end) then
    raise exception 'Delivery fields are written by the sending service only.'
      using errcode = '42501';
  end if;

  -- The recipient must be a live contact on this same account.
  select c.account_id, c.is_opted_out, c.email
    into v_contact_account, v_opted_out, v_email
  from public.contact c
  where c.id = new.contact_id and c.deleted_at is null;

  if v_contact_account is null or v_contact_account <> new.account_id then
    raise exception 'That contact isn''t on this account.'
      using errcode = '42501';
  end if;

  -- Opt-outs are respected on both paths (invariant 7).
  if new.status = 'approved' then
    if v_opted_out then
      raise exception 'This contact has opted out, so the email can''t be marked ready.'
        using errcode = '42501';
    end if;
    if v_email is null then
      raise exception 'This contact has no email address on file.'
        using errcode = '42501';
    end if;
  end if;

  if new.status = 'approved' then
    if tg_op = 'UPDATE' and old.status = 'approved' then
      new.approved_by := old.approved_by;
      new.approved_at := old.approved_at;
    else
      new.approved_by := auth.uid();
      new.approved_at := now();
    end if;
  else
    new.approved_by := null;
    new.approved_at := null;
  end if;

  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. Send and cancel, for the author of a ready email.
-- -----------------------------------------------------------------------------
create or replace function public.send_email(p_email_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid       uuid := auth.uid();
  v_row       public.email_activity;
  v_contact   public.contact;
  v_account   public.account;
  v_user      public.app_user;
  v_mailbox   public.mailbox_connection;
  v_mode      text := app.sending_mode();
  v_cap       integer;
  v_used      integer;
  v_type      public.email_type;
  v_path      public.send_path;
  v_from      text;
  v_decision  jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select * into v_row from public.email_activity
   where id = p_email_id and deleted_at is null
   for update;
  if v_row.id is null or not app.has_account_access(v_row.account_id) then
    raise exception 'That email could not be found.' using errcode = 'P0002';
  end if;
  if v_row.sender_id is distinct from v_uid then
    raise exception 'Only the person who wrote an email can send it.' using errcode = '42501';
  end if;
  if v_row.campaign_id is not null then
    raise exception 'Broadcast emails send with their broadcast.' using errcode = '42501';
  end if;
  if v_row.status = 'queued' then
    raise exception 'This email is already queued.' using errcode = '55000';
  end if;
  if v_row.status <> 'approved' then
    raise exception 'Mark the email ready before sending it.' using errcode = '55000';
  end if;

  if v_mode = 'paused' then
    raise exception 'Sending is paused by the post-sales lead.' using errcode = '55000';
  end if;

  select * into v_contact from public.contact where id = v_row.contact_id and deleted_at is null;
  select * into v_account from public.account where id = v_row.account_id and deleted_at is null;
  select * into v_user    from public.app_user where id = v_uid;

  if v_contact.id is null or v_contact.account_id <> v_row.account_id then
    raise exception 'That contact isn''t on this account any more.' using errcode = '42501';
  end if;
  if v_contact.is_opted_out then
    raise exception '% has opted out, so this email can''t be sent.', v_contact.full_name using errcode = '42501';
  end if;
  if v_contact.email is null then
    raise exception '% has no email address on file.', v_contact.full_name using errcode = '42501';
  end if;

  select * into v_mailbox from public.mailbox_connection where user_id = v_uid;
  if v_mode = 'live' and coalesce(v_mailbox.status, '') <> 'connected' then
    raise exception 'Connect your Microsoft mailbox in Settings before sending.' using errcode = '55000';
  end if;
  v_from := case
    when v_mailbox.status = 'connected' then v_mailbox.email_address
    else coalesce(v_user.warm_sender_address, v_user.email)
  end;

  -- Resolve type and path again rather than trust what the draft stored.
  v_type := app.email_type_for(v_contact.type, v_account.is_friend_account);
  v_path := app.resolve_send_path(v_type, v_contact.type);

  -- One governor decision per account at a time.
  perform pg_advisory_xact_lock(hashtextextended('send:' || v_row.account_id::text, 0));
  v_cap  := coalesce((select (value ->> 'max_sends_per_account_per_month')::integer
                        from public.app_policy where key = 'frequency_cap'), 2);
  v_used := app.routine_slots_used(v_row.account_id);
  if v_used >= v_cap then
    raise exception '% already has % of % emails this month (sent or queued). It can take another next month.',
      v_account.name, v_used, v_cap
      using errcode = '55000';
  end if;

  v_decision := jsonb_build_object(
    'decided_at', now(),
    'decided_by', v_uid,
    'mode', v_mode,
    'slots_used_before', v_used,
    'cap', v_cap,
    'email_type', v_type,
    'send_path', v_path,
    'provider', case when v_mode = 'dry_run' then 'dry_run'
                     else coalesce((select value -> 'providers' ->> v_path::text
                                      from public.app_policy where key = 'send_path_routing'), 'microsoft_graph') end
  );

  update public.email_activity
     set status            = 'queued',
         email_type        = v_type,
         send_path         = v_path,
         from_email        = v_from,
         to_email          = v_contact.email,
         scheduled_for     = now(),
         governor_decision = v_decision,
         error_message     = null,
         locked_at         = null,
         send_attempts     = 0,
         unsubscribe_token = coalesce(unsubscribe_token, gen_random_uuid())
   where id = v_row.id;

  return v_decision;
end;
$$;

create or replace function public.cancel_queued_email(p_email_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_row public.email_activity;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  select * into v_row from public.email_activity
   where id = p_email_id and deleted_at is null
   for update;
  if v_row.id is null or not app.has_account_access(v_row.account_id) then
    raise exception 'That email could not be found.' using errcode = 'P0002';
  end if;
  if v_row.sender_id is distinct from auth.uid() or v_row.campaign_id is not null then
    raise exception 'Only the person who wrote an email can stop it.' using errcode = '42501';
  end if;
  if v_row.status <> 'queued' then
    raise exception 'This email isn''t queued any more.' using errcode = '55000';
  end if;
  if v_row.locked_at is not null and v_row.locked_at > now() - interval '10 minutes' then
    raise exception 'This email is being sent right now and can''t be stopped.' using errcode = '55000';
  end if;

  update public.email_activity
     set status            = 'approved',
         scheduled_for     = null,
         governor_decision = null,
         error_message     = null,
         provider          = null,
         locked_at         = null,
         send_attempts     = 0
   where id = v_row.id;
end;
$$;

revoke all on function public.send_email(uuid), public.cancel_queued_email(uuid) from public, anon;
grant execute on function public.send_email(uuid), public.cancel_queued_email(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. For the send job only: claim a batch of due emails.
-- -----------------------------------------------------------------------------
create or replace function public.claim_send_batch(p_limit integer default 25)
returns setof public.email_activity
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.email_activity ea
     set locked_at = now(),
         send_attempts = ea.send_attempts + 1
   where ea.id in (
     select q.id
       from public.email_activity q
      where q.status = 'queued'
        and q.deleted_at is null
        and coalesce(q.scheduled_for, now()) <= now()
        and (q.locked_at is null
             or q.locked_at < now() - make_interval(mins => coalesce(
                  (select (value ->> 'lock_minutes')::integer from public.app_policy where key = 'sending'), 10)))
      order by q.scheduled_for nulls first, q.created_at
      limit greatest(1, least(coalesce(p_limit, 25), 200))
      for update skip locked
   )
  returning ea.*;
$$;

revoke all on function public.claim_send_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_send_batch(integer) to service_role;

-- -----------------------------------------------------------------------------
-- 9. Unsubscribe by link. The token is a random uuid per sent email; anyone
-- holding it can record an opt-out for that one contact, and nothing else.
-- -----------------------------------------------------------------------------
create or replace function public.opt_out_by_token(p_token uuid, p_reason text default null)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_contact_id uuid;
  v_email      text;
begin
  select ea.contact_id into v_contact_id
    from public.email_activity ea
   where ea.unsubscribe_token = p_token and ea.deleted_at is null;
  if v_contact_id is null then
    return null;
  end if;

  update public.contact
     set is_opted_out   = true,
         opt_out_reason = coalesce(nullif(left(trim(p_reason), 300), ''), opt_out_reason, 'Unsubscribed by link.')
   where id = v_contact_id
  returning email into v_email;

  return v_email;
end;
$$;

revoke all on function public.opt_out_by_token(uuid, text) from public;
grant execute on function public.opt_out_by_token(uuid, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. Job runs, so the lead can see the send and tracking jobs are alive.
-- -----------------------------------------------------------------------------
create table public.job_run (
  id           uuid primary key default gen_random_uuid(),
  job          text not null check (job in ('send', 'track')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  summary      jsonb not null default '{}'::jsonb
);
create index job_run_job_started_idx on public.job_run (job, started_at desc);

alter table public.job_run enable row level security;
create policy job_run_admin_select on public.job_run
  for select to authenticated using (app.is_admin());
revoke all on public.job_run from anon;
revoke insert, update, delete on public.job_run from authenticated;
grant select on public.job_run to authenticated;
