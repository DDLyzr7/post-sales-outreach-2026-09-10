-- =============================================================================
-- Phase 1 / 06 - default governance policy
--
-- These are the knobs the brief asks to keep configurable rather than buried in
-- send logic. Phase 3 reads them; Phase 1 only displays the cap. Change the row,
-- not the code.
--
-- NOTE: `broadcast_vs_routine_priority` is a PLACEHOLDER default awaiting
-- confirmation (open question 3). Confirm before Phase 3 goes live.
-- =============================================================================

insert into public.app_policy (key, value, description) values
(
  'frequency_cap',
  jsonb_build_object(
    'max_sends_per_account_per_month', 2,
    'warn_at_sends', 1,
    'window', 'calendar_month',
    'counts_send_paths', jsonb_build_array('warm', 'cold'),
    'counts_statuses',   jsonb_build_array('sent', 'opened', 'replied', 'bounced'),
    'counts_campaign_sends', true,
    'counts_across_all_senders', true
  ),
  'Hard cap on outbound emails per account per calendar month, counted across every sender, both send paths and all campaign types.'
),
(
  'send_path_routing',
  jsonb_build_object(
    'default', 'cold',
    'rules', jsonb_build_array(
      jsonb_build_object('when', jsonb_build_object('email_type', 'product_update',   'contact_type', 'engaged'),   'path', 'warm'),
      jsonb_build_object('when', jsonb_build_object('email_type', 'cross_sell_intro', 'contact_type', 'committee'), 'path', 'cold'),
      jsonb_build_object('when', jsonb_build_object('email_type', 'friend_account'),                                'path', 'cold'),
      jsonb_build_object('when', jsonb_build_object('email_type', 'launch_broadcast', 'contact_type', 'engaged'),   'path', 'warm'),
      jsonb_build_object('when', jsonb_build_object('email_type', 'launch_broadcast', 'contact_type', 'committee'), 'path', 'cold')
    ),
    'always_show_path_before_send', true
  ),
  'Maps (email_type, contact_type) to a send path. Warm = owner mailbox on the real domain; cold = dedicated outbound domains. The chosen path is always shown to the sender before send.'
),
(
  'broadcast_vs_routine_priority',
  jsonb_build_object(
    'status', 'PLACEHOLDER_AWAITING_CONFIRMATION',
    'strategy', 'broadcast_wins_routine_defers',
    'ranks', jsonb_build_object(
      'launch_broadcast', 10,
      'cross_sell_intro', 20,
      'product_update',   30,
      'friend_account',   40
    ),
    'on_conflict', 'defer_lower_priority',
    'defer_window_days', 30,
    'allow_owner_override_with_reason', true
  ),
  'Which email wins when a broadcast and a routine send would both hit an account inside the cap window. Lower rank wins. PLACEHOLDER - confirm with the post-sales lead before Phase 3.'
),
(
  'staleness_thresholds',
  jsonb_build_object('warn_days', 30, 'alert_days', 60),
  'Days without an outbound touch before an account is flagged on the owner dashboard.'
)
on conflict (key) do nothing;
