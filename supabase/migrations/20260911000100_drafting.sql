-- =============================================================================
-- Phase 4 / 01 - drafting with Claude
--
-- Drafts are email_activity rows in the drafting stage:
--   drafted   -> the owner is still working on it
--   approved  -> the owner marked it ready (no separate approval step)
--   cancelled -> discarded; final
-- They have no sent_at, so they never count toward the frequency cap or
-- last-activity, which both read sent_at.
--
-- A signed-in user can only ever write drafting-stage rows. Every status past
-- 'approved' (queued, sent, opened...) and every delivery field is written by
-- the sending service, which runs without a JWT subject. Before this migration
-- an owner could insert a 'sent' row through the REST API and fake contact with
-- an account.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. What a draft was built from, and Claude's advisory review of it.
--
-- draft_context  { source: "claude" | "template", model, instruction,
--                  collateral_ids[], notes_for_owner[], recent_email_count,
--                  generated_at }
-- presend_review { digest, reviewed_at, summary, flags[{ severity, kind, note }] }
--                  digest is a hash of the subject and body that were reviewed,
--                  so the page can tell when the draft changed afterwards.
--
-- Collateral stays a list of ids inside draft_context until Skott's data shape
-- decides whether collateral goes out as links or attachments.
-- -----------------------------------------------------------------------------
alter table public.email_activity
  add column draft_context  jsonb,
  add column presend_review jsonb;

-- One open draft per person per contact, so a double click can't create two.
-- Campaign rows (Phase 6) are excluded: a broadcast fans out separately.
create unique index email_activity_one_open_draft
  on public.email_activity (contact_id, sender_id)
  where status in ('drafted', 'approved')
    and deleted_at is null
    and campaign_id is null;

-- -----------------------------------------------------------------------------
-- 2. Write guard for signed-in users. RLS still decides which accounts they can
-- touch; this decides what they may write there.
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
  -- Sync and sending jobs have no JWT subject.
  if auth.uid() is null then
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

  if new.direction <> 'outbound' then
    raise exception 'Only outbound drafts can be written from the app.'
      using errcode = '42501';
  end if;

  if new.status not in ('drafted', 'approved', 'cancelled') then
    raise exception 'Emails are marked as sent by the sending service, not by hand.'
      using errcode = '42501';
  end if;

  if new.sent_at is not null or new.opened_at is not null or new.replied_at is not null
     or new.bounced_at is not null or new.scheduled_for is not null
     or new.provider is not null or new.provider_message_id is not null
     or new.governor_decision is not null or new.error_message is not null
     or new.deleted_at is not null then
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

  -- Marking ready is the owner's own sign-off, stamped here rather than trusted
  -- from the client.
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

create trigger email_activity_guard_write
  before insert or update on public.email_activity
  for each row execute function app.guard_email_activity_write();

-- -----------------------------------------------------------------------------
-- 3. Clearing an opt-out is the lead's call. Owners can edit their contacts
-- (Phase 1 contact_update policy), which until now included quietly setting
-- is_opted_out back to false. Recording a new opt-out stays open to everyone.
-- -----------------------------------------------------------------------------
create or replace function app.guard_contact_opt_out()
returns trigger
language plpgsql
as $$
begin
  if old.is_opted_out and not new.is_opted_out
     and auth.uid() is not null and not app.is_admin() then
    raise exception 'Only the post-sales lead can clear an opt-out.'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger contact_guard_opt_out
  before update on public.contact
  for each row execute function app.guard_contact_opt_out();

-- -----------------------------------------------------------------------------
-- 4. Drafting rules, as policy data.
-- -----------------------------------------------------------------------------
insert into public.app_policy (key, value, description) values
(
  'drafting_rules',
  jsonb_build_object('recent_contact_warn_days', 14),
  'The pre-send check warns when the same contact was emailed within this many days.'
)
on conflict (key) do nothing;
