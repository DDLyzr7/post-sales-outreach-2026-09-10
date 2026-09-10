-- =============================================================================
-- Phase 1 seed - FICTIONAL data only. No real client information.
--
-- Prerequisite: the four auth users must exist. Run `npm run db:seed-users`
-- first; this file resolves them by email and will refuse to run otherwise.
--
-- Idempotent: safe to re-run.
-- =============================================================================

do $$
declare
  found_users integer;
begin
  select count(*) into found_users
  from public.app_user
  where lower(email) in ('pm@example.com', 'cal@example.com', 'csm@example.com', 'lead@example.com');

  if found_users < 4 then
    raise exception using
      message = format('Seed users missing (found %s of 4).', found_users),
      hint    = 'Run `npm run db:seed-users` before applying supabase/seed.sql.';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Products
-- -----------------------------------------------------------------------------
insert into public.product (id, key, name, description, value_prop, target_functions, sort_order) values
('22222222-0000-4000-8000-000000000001', 'workforce_analytics', 'Workforce Analytics',
 'Headcount, attrition and skills reporting for people teams.',
 'See attrition risk by team six months before it shows up in a resignation.',
 '{hr,executive}', 10),
('22222222-0000-4000-8000-000000000002', 'campaign_studio', 'Campaign Studio',
 'Multi-channel campaign planning and attribution.',
 'One view of spend to pipeline across every channel, without a spreadsheet.',
 '{marketing,executive}', 20),
('22222222-0000-4000-8000-000000000003', 'spend_intelligence', 'Spend Intelligence',
 'Vendor spend consolidation and renewal forecasting.',
 'Catch duplicate vendor spend before the renewal, not after it.',
 '{finance,executive}', 30),
('22222222-0000-4000-8000-000000000004', 'ops_command', 'Ops Command',
 'Operational workflow orchestration and SLA tracking.',
 'Every exception routed to an owner with an SLA clock on it.',
 '{operations,it}', 40),
('22222222-0000-4000-8000-000000000005', 'risk_shield', 'Risk Shield',
 'Policy, audit-trail and regulatory-change monitoring.',
 'Evidence for an audit assembled continuously instead of in a panic.',
 '{legal,finance}', 50)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Accounts  (mirrored from Helix / Compass in production; fictional here)
-- -----------------------------------------------------------------------------
insert into public.account
  (id, source_system, external_id, synced_at, name, domain, tier, health_status,
   owning_team, contract_start, contract_end, renewal_date, arr_cents, is_friend_account, notes) values
('11111111-0000-4000-8000-000000000001', 'helix', 'HLX-1041', now() - interval '6 hours',
 'Northwind Logistics', 'northwindlogistics.com', 'enterprise', 'green',
 'Enterprise East', date '2024-02-01', date '2027-01-31', date '2027-01-31', 42000000, false,
 'Multi-site rollout completed Q2. Ops team is the strongest advocate.'),
('11111111-0000-4000-8000-000000000002', 'helix', 'HLX-1077', now() - interval '6 hours',
 'Vertex Health Group', 'vertexhealth.org', 'strategic', 'yellow',
 'Strategic', date '2023-07-01', date '2026-06-30', date '2026-06-30', 78000000, false,
 'Renewal inside 12 months. Compliance review slowed the last expansion.'),
('11111111-0000-4000-8000-000000000003', 'compass', 'CMP-2210', now() - interval '6 hours',
 'Brightline Retail', 'brightlineretail.com', 'mid_market', 'green',
 'Commercial', date '2025-03-15', date '2027-03-14', date '2027-03-14', 16500000, false,
 'Marketing ops is the only team live. Wide expansion surface.'),
('11111111-0000-4000-8000-000000000004', 'helix', 'HLX-1188', now() - interval '6 hours',
 'Cobalt Financial', 'cobaltfinancial.com', 'enterprise', 'red',
 'Enterprise West', date '2023-11-01', date '2026-10-31', date '2026-10-31', 55000000, false,
 'Two escalations open. Keep outbound light until the support plan lands.'),
('11111111-0000-4000-8000-000000000005', 'compass', 'CMP-2318', now() - interval '6 hours',
 'Juniper Media', 'junipermedia.co', 'smb', 'green',
 'Commercial', date '2025-09-01', date '2026-08-31', date '2026-08-31', 4200000, false,
 'Small but growing fast. No one has contacted them since onboarding.'),
('11111111-0000-4000-8000-000000000006', 'manual', 'FRIEND-004', null,
 'Halcyon Energy', 'halcyonenergy.com', 'mid_market', 'unknown',
 'Commercial', null, null, null, null, true,
 'Friend account - warm intro via the Brightline CMO, not yet a customer.')
on conflict (id) do nothing;

-- Products in use per account
insert into public.account_product (account_id, product_id, status, activated_on) values
('11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000004', 'active', date '2024-02-15'),
('11111111-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000003', 'active', date '2024-09-01'),
('11111111-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001', 'active', date '2023-08-01'),
('11111111-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000005', 'active', date '2024-01-10'),
('11111111-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000002', 'active', date '2025-04-01'),
('11111111-0000-4000-8000-000000000004', '22222222-0000-4000-8000-000000000005', 'active', date '2023-11-15'),
('11111111-0000-4000-8000-000000000004', '22222222-0000-4000-8000-000000000003', 'active', date '2024-06-01'),
('11111111-0000-4000-8000-000000000005', '22222222-0000-4000-8000-000000000002', 'active', date '2025-09-15'),
('11111111-0000-4000-8000-000000000005', '22222222-0000-4000-8000-000000000001', 'trial',  date '2026-08-01')
on conflict (account_id, product_id) do nothing;

-- -----------------------------------------------------------------------------
-- Assignments  <- this is what RLS reads
--   Riya  (PM)    -> Northwind, Brightline                (2 accounts)
--   Marcus (CAL)  -> Vertex, Cobalt, Halcyon              (3 accounts)
--   Elena (CSM)   -> Northwind, Vertex, Juniper           (3 accounts)
--   Dana  (admin) -> everything, by policy not assignment (6 accounts)
-- -----------------------------------------------------------------------------
insert into public.account_assignment (account_id, user_id, role, is_primary)
select v.account_id, u.id, v.role, v.is_primary
from (values
  ('11111111-0000-4000-8000-000000000001'::uuid, 'pm@example.com',  'pm'::public.assignment_role,  true),
  ('11111111-0000-4000-8000-000000000001'::uuid, 'csm@example.com', 'csm'::public.assignment_role, false),
  ('11111111-0000-4000-8000-000000000002'::uuid, 'cal@example.com', 'cal'::public.assignment_role, true),
  ('11111111-0000-4000-8000-000000000002'::uuid, 'csm@example.com', 'csm'::public.assignment_role, false),
  ('11111111-0000-4000-8000-000000000003'::uuid, 'pm@example.com',  'pm'::public.assignment_role,  true),
  ('11111111-0000-4000-8000-000000000004'::uuid, 'cal@example.com', 'cal'::public.assignment_role, true),
  ('11111111-0000-4000-8000-000000000005'::uuid, 'csm@example.com', 'csm'::public.assignment_role, true),
  ('11111111-0000-4000-8000-000000000006'::uuid, 'cal@example.com', 'cal'::public.assignment_role, true)
) as v(account_id, email, role, is_primary)
join public.app_user u on lower(u.email) = v.email
on conflict (account_id, user_id, role) do nothing;

-- -----------------------------------------------------------------------------
-- Contacts
--   type = 'engaged'   -> pane 1
--   type = 'committee' -> pane 2 (source = enrichment, as they will be in Phase 2)
-- -----------------------------------------------------------------------------
insert into public.contact
  (id, account_id, type, full_name, title, business_function, email, relationship_status,
   source, is_opted_out, opt_out_reason, enrichment_provider, enrichment_confidence, enriched_at, synced_at) values
-- Northwind Logistics
('44444444-0000-4000-8000-000000000101', '11111111-0000-4000-8000-000000000001', 'engaged',
 'Priya Raman', 'VP Operations', 'operations', 'priya.raman@northwindlogistics.com', 'champion',
 'internal_sync', false, null, null, null, null, now() - interval '6 hours'),
('44444444-0000-4000-8000-000000000102', '11111111-0000-4000-8000-000000000001', 'engaged',
 'Tom Alvarez', 'Director of IT', 'it', 'tom.alvarez@northwindlogistics.com', 'active',
 'internal_sync', false, null, null, null, null, now() - interval '6 hours'),
('44444444-0000-4000-8000-000000000103', '11111111-0000-4000-8000-000000000001', 'engaged',
 'Sana Qureshi', 'Finance Manager', 'finance', 'sana.qureshi@northwindlogistics.com', 'active',
 'internal_sync', false, null, null, null, null, now() - interval '6 hours'),
('44444444-0000-4000-8000-000000000104', '11111111-0000-4000-8000-000000000001', 'committee',
 'Meredith Cole', 'Chief Human Resources Officer', 'hr', 'm.cole@northwindlogistics.com', 'cold',
 'enrichment', false, null, 'placeholder_provider', 0.91, now() - interval '9 days', null),
('44444444-0000-4000-8000-000000000105', '11111111-0000-4000-8000-000000000001', 'committee',
 'Daniel Ofori', 'Chief Marketing Officer', 'marketing', 'd.ofori@northwindlogistics.com', 'cold',
 'enrichment', false, null, 'placeholder_provider', 0.84, now() - interval '9 days', null),

-- Vertex Health Group
('44444444-0000-4000-8000-000000000201', '11111111-0000-4000-8000-000000000002', 'engaged',
 'Grace Lin', 'Director of People Operations', 'hr', 'grace.lin@vertexhealth.org', 'champion',
 'internal_sync', false, null, null, null, null, now() - interval '6 hours'),
('44444444-0000-4000-8000-000000000202', '11111111-0000-4000-8000-000000000002', 'engaged',
 'Owen Brandt', 'Compliance Lead', 'legal', 'owen.brandt@vertexhealth.org', 'active',
 'internal_sync', false, null, null, null, null, now() - interval '6 hours'),
('44444444-0000-4000-8000-000000000203', '11111111-0000-4000-8000-000000000002', 'committee',
 'Rachel Adeyemi', 'Chief Financial Officer', 'finance', 'r.adeyemi@vertexhealth.org', 'cold',
 'enrichment', false, null, 'placeholder_provider', 0.88, now() - interval '12 days', null),
('44444444-0000-4000-8000-000000000204', '11111111-0000-4000-8000-000000000002', 'committee',
 'Victor Hale', 'Chief Marketing Officer', 'marketing', 'v.hale@vertexhealth.org', 'cold',
 'enrichment', false, null, 'placeholder_provider', 0.79, now() - interval '12 days', null),

-- Brightline Retail
('44444444-0000-4000-8000-000000000301', '11111111-0000-4000-8000-000000000003', 'engaged',
 'Nadia Fern', 'Marketing Operations Manager', 'marketing', 'nadia.fern@brightlineretail.com', 'champion',
 'internal_sync', false, null, null, null, null, now() - interval '6 hours'),
('44444444-0000-4000-8000-000000000302', '11111111-0000-4000-8000-000000000003', 'engaged',
 'Chris Okafor', 'Ecommerce Director', 'product', 'chris.okafor@brightlineretail.com', 'active',
 'internal_sync', false, null, null, null, null, now() - interval '6 hours'),
('44444444-0000-4000-8000-000000000303', '11111111-0000-4000-8000-000000000003', 'committee',
 'Laura Beckett', 'Chief Human Resources Officer', 'hr', 'l.beckett@brightlineretail.com', 'cold',
 'enrichment', false, null, 'placeholder_provider', 0.93, now() - interval '4 days', null),
('44444444-0000-4000-8000-000000000304', '11111111-0000-4000-8000-000000000003', 'committee',
 'Simon Trent', 'Chief Financial Officer', 'finance', 's.trent@brightlineretail.com', 'cold',
 'enrichment', false, null, 'placeholder_provider', 0.86, now() - interval '4 days', null),

-- Cobalt Financial
('44444444-0000-4000-8000-000000000401', '11111111-0000-4000-8000-000000000004', 'engaged',
 'Hana Mori', 'Head of Risk', 'legal', 'hana.mori@cobaltfinancial.com', 'dormant',
 'internal_sync', false, null, null, null, null, now() - interval '6 hours'),
('44444444-0000-4000-8000-000000000402', '11111111-0000-4000-8000-000000000004', 'engaged',
 'Peter Vance', 'Controller', 'finance', 'peter.vance@cobaltfinancial.com', 'detractor',
 'internal_sync', true, 'Unsubscribed after the March escalation.', null, null, null, now() - interval '6 hours'),
('44444444-0000-4000-8000-000000000403', '11111111-0000-4000-8000-000000000004', 'committee',
 'Adele Marsh', 'Chief Human Resources Officer', 'hr', 'a.marsh@cobaltfinancial.com', 'cold',
 'enrichment', false, null, 'placeholder_provider', 0.90, now() - interval '20 days', null),
('44444444-0000-4000-8000-000000000404', '11111111-0000-4000-8000-000000000004', 'committee',
 'Ibrahim Nasser', 'Chief Operating Officer', 'operations', 'i.nasser@cobaltfinancial.com', 'cold',
 'enrichment', false, null, 'placeholder_provider', 0.82, now() - interval '20 days', null),

-- Juniper Media
('44444444-0000-4000-8000-000000000501', '11111111-0000-4000-8000-000000000005', 'engaged',
 'Kofi Mensah', 'Head of Growth', 'marketing', 'kofi@junipermedia.co', 'active',
 'internal_sync', false, null, null, null, null, now() - interval '6 hours'),
('44444444-0000-4000-8000-000000000502', '11111111-0000-4000-8000-000000000005', 'committee',
 'Elise Dubois', 'Chief Financial Officer', 'finance', 'e.dubois@junipermedia.co', 'cold',
 'enrichment', false, null, 'placeholder_provider', 0.77, now() - interval '2 days', null),

-- Halcyon Energy (friend account)
('44444444-0000-4000-8000-000000000601', '11111111-0000-4000-8000-000000000006', 'engaged',
 'Marta Silva', 'Head of Digital', 'it', 'marta.silva@halcyonenergy.com', 'cold',
 'manual', false, null, null, null, null, null),
('44444444-0000-4000-8000-000000000602', '11111111-0000-4000-8000-000000000006', 'committee',
 'Greg Lindqvist', 'Chief Human Resources Officer', 'hr', 'g.lindqvist@halcyonenergy.com', 'cold',
 'enrichment', false, null, 'placeholder_provider', 0.71, now() - interval '1 day', null)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Collateral, served as trackable links in Phase 2
-- -----------------------------------------------------------------------------
insert into public.collateral (id, slug, title, summary, asset_url, content_type) values
('33333333-0000-4000-8000-000000000001', 'workforce-analytics-chro-brief',
 'Workforce Analytics: the CHRO brief', 'Two pages on attrition prediction and what it changes for a people org.',
 'https://kb.example.com/workforce-analytics/chro-brief', 'one_pager'),
('33333333-0000-4000-8000-000000000002', 'workforce-analytics-q3-release',
 'Workforce Analytics Q3 release notes', 'Skills taxonomy, manager digests and the new attrition model.',
 'https://kb.example.com/workforce-analytics/q3-release', 'release_note'),
('33333333-0000-4000-8000-000000000003', 'campaign-studio-cmo-brief',
 'Campaign Studio: the CMO brief', 'Spend-to-pipeline attribution without a data team.',
 'https://kb.example.com/campaign-studio/cmo-brief', 'one_pager'),
('33333333-0000-4000-8000-000000000004', 'campaign-studio-playbook',
 'Campaign Studio operator playbook', 'How high-performing marketing ops teams run the weekly cycle.',
 'https://kb.example.com/campaign-studio/playbook', 'guide'),
('33333333-0000-4000-8000-000000000005', 'spend-intelligence-cfo-roi',
 'Spend Intelligence ROI calculator', 'Model duplicate-vendor recovery against your own spend.',
 'https://kb.example.com/spend-intelligence/roi', 'roi_calculator'),
('33333333-0000-4000-8000-000000000006', 'spend-intelligence-quarterly-update',
 'Spend Intelligence quarterly update', 'Renewal forecasting and the new approval routing.',
 'https://kb.example.com/spend-intelligence/quarterly', 'release_note'),
('33333333-0000-4000-8000-000000000007', 'ops-command-case-study',
 'Ops Command at a national carrier', 'How a 40-site operation cut SLA breaches by a third.',
 'https://kb.example.com/ops-command/case-study', 'case_study'),
('33333333-0000-4000-8000-000000000008', 'risk-shield-compliance-guide',
 'Risk Shield continuous-audit guide', 'Assembling audit evidence continuously instead of quarterly.',
 'https://kb.example.com/risk-shield/audit-guide', 'guide'),
('33333333-0000-4000-8000-000000000009', 'risk-shield-cfo-brief',
 'Risk Shield: the CFO brief', 'What regulatory-change monitoring is worth on a finance P&L.',
 'https://kb.example.com/risk-shield/cfo-brief', 'one_pager')
on conflict (id) do nothing;

insert into public.collateral_product (collateral_id, product_id) values
('33333333-0000-4000-8000-000000000001', '22222222-0000-4000-8000-000000000001'),
('33333333-0000-4000-8000-000000000002', '22222222-0000-4000-8000-000000000001'),
('33333333-0000-4000-8000-000000000003', '22222222-0000-4000-8000-000000000002'),
('33333333-0000-4000-8000-000000000004', '22222222-0000-4000-8000-000000000002'),
('33333333-0000-4000-8000-000000000005', '22222222-0000-4000-8000-000000000003'),
('33333333-0000-4000-8000-000000000006', '22222222-0000-4000-8000-000000000003'),
('33333333-0000-4000-8000-000000000007', '22222222-0000-4000-8000-000000000004'),
('33333333-0000-4000-8000-000000000008', '22222222-0000-4000-8000-000000000005'),
('33333333-0000-4000-8000-000000000009', '22222222-0000-4000-8000-000000000005')
on conflict do nothing;

insert into public.collateral_persona (collateral_id, business_function, contact_type) values
('33333333-0000-4000-8000-000000000001', 'hr',         'committee'),
('33333333-0000-4000-8000-000000000002', 'hr',         'engaged'),
('33333333-0000-4000-8000-000000000003', 'marketing',  'committee'),
('33333333-0000-4000-8000-000000000004', 'marketing',  'engaged'),
('33333333-0000-4000-8000-000000000004', 'product',    'engaged'),
('33333333-0000-4000-8000-000000000005', 'finance',    'committee'),
('33333333-0000-4000-8000-000000000006', 'finance',    'engaged'),
('33333333-0000-4000-8000-000000000007', 'operations', 'engaged'),
('33333333-0000-4000-8000-000000000007', 'it',         'engaged'),
('33333333-0000-4000-8000-000000000007', 'operations', 'committee'),
('33333333-0000-4000-8000-000000000008', 'legal',      'engaged'),
('33333333-0000-4000-8000-000000000008', 'legal',      'committee'),
('33333333-0000-4000-8000-000000000009', 'finance',    'committee')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Templates. `product_update_engaged` deliberately has two versions so the
-- version pin on email_activity is visible: an email sent before the edit still
-- resolves to v1.
-- -----------------------------------------------------------------------------
insert into public.template (id, key, name, description, email_type, audience, default_send_path, current_version) values
('55555555-0000-4000-8000-000000000001', 'product_update_engaged',
 'Product update - engaged stakeholder',
 'Routine update to someone already using the product.',
 'product_update', 'engaged', 'warm', 2),
('55555555-0000-4000-8000-000000000002', 'cross_sell_intro_committee',
 'Cross-sell intro - leadership committee',
 'First-touch introduction to a functional leader we do not sell to yet.',
 'cross_sell_intro', 'committee', 'cold', 1),
('55555555-0000-4000-8000-000000000003', 'friend_account_outreach',
 'Friend-account outreach',
 'Warm-but-not-yet-customer accounts.',
 'friend_account', 'friend_account', 'cold', 1),
('55555555-0000-4000-8000-000000000004', 'launch_broadcast_all',
 'Launch broadcast - all stakeholders',
 'New-product announcement, fanned out across both send paths as a campaign.',
 'launch_broadcast', 'all', 'warm', 1)
on conflict (id) do nothing;

insert into public.template_version
  (id, template_id, version, subject_template, body_template, variables, changelog) values
('66666666-0000-4000-8000-000000000011', '55555555-0000-4000-8000-000000000001', 1,
 '{{product_name}} update for {{account_name}}',
 E'Hi {{contact_first_name}},\n\nA quick note on what shipped in {{product_name}} this quarter.\n\n{{collateral_link}}\n\nHappy to walk your team through it if useful.\n\n{{sender_first_name}}',
 '["contact_first_name","account_name","product_name","collateral_link","sender_first_name"]',
 'Initial version.'),
('66666666-0000-4000-8000-000000000012', '55555555-0000-4000-8000-000000000001', 2,
 '{{product_name}}: what shipped this quarter',
 E'Hi {{contact_first_name}},\n\nTwo things in {{product_name}} this quarter that change the day-to-day for your team:\n\n{{highlight_one}}\n{{highlight_two}}\n\nFull notes: {{collateral_link}}\n\n{{sender_first_name}}',
 '["contact_first_name","product_name","highlight_one","highlight_two","collateral_link","sender_first_name"]',
 'Tighter subject, two named highlights instead of a generic summary.'),
('66666666-0000-4000-8000-000000000021', '55555555-0000-4000-8000-000000000002', 1,
 'A question about {{function_topic}} at {{account_name}}',
 E'{{contact_first_name}},\n\nWe already work with the {{existing_team}} team at {{account_name}}. {{value_prop}}\n\nWorth a short conversation? I can send the {{collateral_title}} first if you would rather read than meet.\n\n{{sender_full_name}}',
 '["contact_first_name","function_topic","account_name","existing_team","value_prop","collateral_title","sender_full_name"]',
 'Initial version.'),
('66666666-0000-4000-8000-000000000031', '55555555-0000-4000-8000-000000000003', 1,
 '{{intro_source}} suggested I reach out',
 E'Hi {{contact_first_name}},\n\n{{intro_source}} mentioned you are looking at {{topic}}. {{value_prop}}\n\nNo pitch - happy to just share what we have seen work.\n\n{{sender_full_name}}',
 '["contact_first_name","intro_source","topic","value_prop","sender_full_name"]',
 'Initial version.'),
('66666666-0000-4000-8000-000000000041', '55555555-0000-4000-8000-000000000004', 1,
 'Introducing {{product_name}}',
 E'Hi {{contact_first_name}},\n\nWe launched {{product_name}} today. {{value_prop}}\n\n{{collateral_link}}\n\n{{sender_first_name}}',
 '["contact_first_name","product_name","value_prop","collateral_link","sender_first_name"]',
 'Initial version.')
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- Historical email activity.
--
-- These are backfilled records of past sends, not queued mail - Phase 1 sends
-- nothing. They exist so the account status header and the owner dashboard show
-- real derived values instead of placeholders: last-activity and the monthly
-- count below are computed from these rows and stored nowhere else.
--
-- Resulting state (relative to the day the seed is applied):
--   Northwind  1 send this month, last touch 5 days ago (opened)
--   Vertex     2 sends this month -> AT CAP, last touch 1 day ago
--   Brightline 0 this month, last touch 40 days ago  -> stale
--   Cobalt     0 this month, last touch 75 days ago  -> very stale
--   Juniper    never contacted
--   Halcyon    never contacted
-- -----------------------------------------------------------------------------
insert into public.email_activity
  (id, account_id, contact_id, sender_id, template_version_id, email_type, send_path,
   direction, status, subject, body_text, merge_vars, to_email, from_email, provider,
   sent_at, opened_at, replied_at) values
('77777777-0000-4000-8000-000000000001',
 '11111111-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000101',
 (select id from public.app_user where lower(email) = 'pm@example.com'),
 '66666666-0000-4000-8000-000000000011',
 'product_update', 'warm', 'outbound', 'opened',
 'Ops Command update for Northwind Logistics',
 E'Hi Priya,\n\nA quick note on what shipped in Ops Command this quarter.\n\nhttps://kb.example.com/ops-command/case-study\n\nHappy to walk your team through it if useful.\n\nRiya',
 '{"contact_first_name":"Priya","account_name":"Northwind Logistics","product_name":"Ops Command"}',
 'priya.raman@northwindlogistics.com', 'riya.kapoor@example.com', 'google_workspace',
 now() - interval '5 days', now() - interval '5 days' + interval '4 hours', null),

('77777777-0000-4000-8000-000000000002',
 '11111111-0000-4000-8000-000000000001', '44444444-0000-4000-8000-000000000104',
 (select id from public.app_user where lower(email) = 'pm@example.com'),
 '66666666-0000-4000-8000-000000000021',
 'cross_sell_intro', 'cold', 'outbound', 'sent',
 'A question about workforce planning at Northwind Logistics',
 E'Meredith,\n\nWe already work with the operations team at Northwind Logistics. See attrition risk by team six months before it shows up in a resignation.\n\nWorth a short conversation?\n\nRiya Kapoor',
 '{"contact_first_name":"Meredith","account_name":"Northwind Logistics"}',
 'm.cole@northwindlogistics.com', 'riya@outbound-domain-01.example', 'cold_outbound_service',
 now() - interval '20 days', null, null),

('77777777-0000-4000-8000-000000000003',
 '11111111-0000-4000-8000-000000000002', '44444444-0000-4000-8000-000000000201',
 (select id from public.app_user where lower(email) = 'cal@example.com'),
 '66666666-0000-4000-8000-000000000012',
 'product_update', 'warm', 'outbound', 'replied',
 'Workforce Analytics: what shipped this quarter',
 E'Hi Grace,\n\nTwo things in Workforce Analytics this quarter that change the day-to-day for your team:\n\nSkills taxonomy import\nManager digests\n\nFull notes: https://kb.example.com/workforce-analytics/q3-release\n\nMarcus',
 '{"contact_first_name":"Grace","product_name":"Workforce Analytics"}',
 'grace.lin@vertexhealth.org', 'marcus.webb@example.com', 'google_workspace',
 now() - interval '3 days', now() - interval '3 days' + interval '1 hour',
 now() - interval '3 days' + interval '5 hours'),

('77777777-0000-4000-8000-000000000004',
 '11111111-0000-4000-8000-000000000002', '44444444-0000-4000-8000-000000000203',
 (select id from public.app_user where lower(email) = 'cal@example.com'),
 '66666666-0000-4000-8000-000000000021',
 'cross_sell_intro', 'cold', 'outbound', 'sent',
 'A question about vendor spend at Vertex Health Group',
 E'Rachel,\n\nWe already work with the people operations team at Vertex Health Group. Catch duplicate vendor spend before the renewal, not after it.\n\nWorth a short conversation?\n\nMarcus Webb',
 '{"contact_first_name":"Rachel","account_name":"Vertex Health Group"}',
 'r.adeyemi@vertexhealth.org', 'marcus@outbound-domain-02.example', 'cold_outbound_service',
 now() - interval '1 day', null, null),

('77777777-0000-4000-8000-000000000005',
 '11111111-0000-4000-8000-000000000003', '44444444-0000-4000-8000-000000000301',
 (select id from public.app_user where lower(email) = 'pm@example.com'),
 '66666666-0000-4000-8000-000000000011',
 'product_update', 'warm', 'outbound', 'sent',
 'Campaign Studio update for Brightline Retail',
 E'Hi Nadia,\n\nA quick note on what shipped in Campaign Studio this quarter.\n\nhttps://kb.example.com/campaign-studio/playbook\n\nRiya',
 '{"contact_first_name":"Nadia","account_name":"Brightline Retail"}',
 'nadia.fern@brightlineretail.com', 'riya.kapoor@example.com', 'google_workspace',
 now() - interval '40 days', null, null),

('77777777-0000-4000-8000-000000000006',
 '11111111-0000-4000-8000-000000000004', '44444444-0000-4000-8000-000000000401',
 (select id from public.app_user where lower(email) = 'cal@example.com'),
 '66666666-0000-4000-8000-000000000011',
 'product_update', 'warm', 'outbound', 'opened',
 'Risk Shield update for Cobalt Financial',
 E'Hi Hana,\n\nA quick note on what shipped in Risk Shield this quarter.\n\nhttps://kb.example.com/risk-shield/audit-guide\n\nMarcus',
 '{"contact_first_name":"Hana","account_name":"Cobalt Financial"}',
 'hana.mori@cobaltfinancial.com', 'marcus.webb@example.com', 'google_workspace',
 now() - interval '75 days', now() - interval '75 days' + interval '2 days', null)
on conflict (id) do nothing;

-- =============================================================================
-- Phase 2 - lifecycle and targeting examples (needs the 20260910000100 migration)
--
--   Halcyon Energy     prospect (friend account)
--   Meridian Travel    churned in April, Riya's win-back target, last email 150 days ago
--   Tidewater Foods    existing customer with NO owner and a renewal in November,
--                      so Team coverage has a real gap to show
-- =============================================================================
update public.account
   set lifecycle_status = 'prospect'
 where id = '11111111-0000-4000-8000-000000000006'
   and lifecycle_status <> 'prospect';

insert into public.account
  (id, source_system, external_id, synced_at, name, domain, tier, health_status,
   owning_team, contract_start, contract_end, renewal_date, arr_cents, is_friend_account, notes,
   lifecycle_status, lifecycle_changed_at) values
('11111111-0000-4000-8000-000000000007', 'compass', 'CMP-1987', now() - interval '6 hours',
 'Meridian Travel Co.', 'meridiantravel.co', 'mid_market', 'red',
 'Commercial', date '2024-04-01', date '2026-03-31', null, null, false,
 'Did not renew in March after a budget freeze. A new COO joined in July.',
 'churned', timestamptz '2026-04-02 09:00:00+00'),
('11111111-0000-4000-8000-000000000008', 'helix', 'HLX-1203', now() - interval '6 hours',
 'Tidewater Foods', 'tidewaterfoods.com', 'smb', 'green',
 'Commercial', date '2025-11-16', date '2026-11-15', date '2026-11-15', 3100000, false,
 'Owner left in August and the account was never reassigned.',
 'existing', timestamptz '2025-11-16 09:00:00+00')
on conflict (id) do nothing;

insert into public.account_product (account_id, product_id, status, activated_on) values
('11111111-0000-4000-8000-000000000007', '22222222-0000-4000-8000-000000000002', 'churned', date '2024-04-15'),
('11111111-0000-4000-8000-000000000008', '22222222-0000-4000-8000-000000000003', 'active',  date '2025-12-01')
on conflict (account_id, product_id) do nothing;

-- Meridian stays with Riya for the win-back. Tidewater is deliberately unassigned.
insert into public.account_assignment (account_id, user_id, role, is_primary)
select '11111111-0000-4000-8000-000000000007'::uuid, u.id, 'pm'::public.assignment_role, true
from public.app_user u
where lower(u.email) = 'pm@example.com'
on conflict (account_id, user_id, role) do nothing;

insert into public.contact
  (id, account_id, type, full_name, title, business_function, email, relationship_status,
   source, is_opted_out, opt_out_reason, enrichment_provider, enrichment_confidence, enriched_at, synced_at) values
('44444444-0000-4000-8000-000000000701', '11111111-0000-4000-8000-000000000007', 'engaged',
 'Ana Duarte', 'Marketing Director', 'marketing', 'ana.duarte@meridiantravel.co', 'dormant',
 'internal_sync', false, null, null, null, null, now() - interval '6 hours'),
('44444444-0000-4000-8000-000000000702', '11111111-0000-4000-8000-000000000007', 'committee',
 'Joel Park', 'Chief Operating Officer', 'operations', 'joel.park@meridiantravel.co', 'cold',
 'enrichment', false, null, 'placeholder_provider', 0.87, now() - interval '30 days', null),
('44444444-0000-4000-8000-000000000801', '11111111-0000-4000-8000-000000000008', 'engaged',
 'Ben Carter', 'Finance Director', 'finance', 'ben.carter@tidewaterfoods.com', 'active',
 'internal_sync', false, null, null, null, null, now() - interval '6 hours')
on conflict (id) do nothing;

insert into public.email_activity
  (id, account_id, contact_id, sender_id, template_version_id, email_type, send_path,
   direction, status, subject, body_text, merge_vars, to_email, from_email, provider,
   sent_at, opened_at, replied_at) values
('77777777-0000-4000-8000-000000000007',
 '11111111-0000-4000-8000-000000000007', '44444444-0000-4000-8000-000000000701',
 (select id from public.app_user where lower(email) = 'pm@example.com'),
 '66666666-0000-4000-8000-000000000012',
 'product_update', 'warm', 'outbound', 'sent',
 'Campaign Studio: what shipped this quarter',
 E'Hi Ana,\n\nTwo things in Campaign Studio this quarter that change the day-to-day for your team:\n\nChannel-level attribution\nBudget pacing alerts\n\nFull notes: https://kb.example.com/campaign-studio/playbook\n\nRiya',
 '{"contact_first_name":"Ana","product_name":"Campaign Studio"}',
 'ana.duarte@meridiantravel.co', 'riya.kapoor@example.com', 'google_workspace',
 now() - interval '150 days', null, null)
on conflict (id) do nothing;
