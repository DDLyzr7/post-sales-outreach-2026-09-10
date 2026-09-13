# Post-Sales Outreach

Internal app for the post-sales team to own outbound communication to the existing
client base: who the stakeholders are at each account, which accounts each person
should reach next, what collateral fits them, what has been sent recently, and how
close the account is to its monthly cap.

Owners draft with Claude, mark emails ready and send them from their own Microsoft 365
mailbox (Phases 4–5). The post-sales lead also runs broadcasts (Phase 6), and everyone
gets reports scoped to their role (Phase 7). **Sending starts in test mode:** Send
records an email as sent without delivering it, until the lead switches sending to live
in Settings.

Every feature, with its ID, status and phase, is listed in `docs/feature-list.html`
(published walkthrough copy:
https://claude.ai/code/artifact/63eeac62-b178-4065-8831-366c3f2171c7).

---

## What Phase 1 delivers

| Brief item | Where it lives |
| --- | --- |
| Data model, migrations, seed data | `supabase/migrations/`, `supabase/seed.sql` |
| Supabase Auth for the four users | `scripts/seed-users.mjs` |
| **RLS enforcing account ownership** | `supabase/migrations/20260907000500_rls.sql` |
| Two-pane account view | `src/app/(app)/accounts/[id]/page.tsx` |
| Owner dashboard with last-activity | `src/app/(app)/page.tsx` |

Two things go beyond the literal Phase 1 scope because leaving them out would have
cost a migration later:

- **Last-activity and the monthly count are real, not placeholders.** They are derived
  from `email_activity` by SQL views on every read. The seed backfills historical
  send records so the dashboard shows genuine derived values.
- **The frequency cap, send-path routing and broadcast priority are seeded as data**
  in `app_policy`. The app only reads and displays them for now; sending (phase 5)
  enforces them.

## What Phase 2 delivers

| Feature | Where it lives |
| --- | --- |
| Customer lifecycle: existing customer, churned, prospect | `supabase/migrations/20260910000100_account_lifecycle_and_owners.sql` |
| **My targets**: every visible account grouped by what it needs next | `src/app/(app)/targets/page.tsx`, `src/lib/targeting.ts` |
| **Team coverage**: per-person coverage and accounts without an owner (lead only) | `src/app/(app)/team/page.tsx` |
| Owner assignment and removal by the lead | `assign_account_owner` / `remove_account_owner` in the migration, `src/app/(app)/team/actions.ts` |
| Lyzr brand palette and type | `src/app/globals.css`, `src/app/layout.tsx` |

The My targets groups, most urgent first:

| Group | Accounts in it |
| --- | --- |
| **Win back** | Churned accounts |
| **Going quiet** | Existing customers with no email in 30 days or more, or never emailed |
| **Renewal coming up** | Existing customers renewing within `targeting_rules.renewal_window_days` (90) |
| **Warm up** | Prospects and friend accounts |
| **At the monthly cap** | Accounts already at the limit |
| **On track** | Everything else |

Every threshold is read from `app_policy`.

## What Phase 3 delivers so far

| Feature | Where it lives |
| --- | --- |
| Natural-language collateral search | `src/app/(app)/collateral/page.tsx`, `supabase/migrations/20260910000300_collateral_search.sql` |
| Claude reads the request into keywords, products, roles and content types | `src/lib/ai/collateral-search.ts` (Claude Opus 5, structured output) |
| "Find collateral" for a specific contact | the contact rows on each account page |

- **Works without Claude:** if `ANTHROPIC_API_KEY` is missing or the call fails, the page
  falls back to a plain word search.
- **Nothing is tracked** when someone opens collateral.
- **Still to come:** the Skott feed, and how collateral goes into emails, both wait on
  Skott's API.

## What Phase 4 delivers

| Feature | Where it lives |
| --- | --- |
| **Draft with Claude** on every contact, with an optional note for Claude | `src/components/draft-forms.tsx`, `src/app/(app)/drafts/actions.ts` |
| Claude writes from the template, the account's recent emails and the collateral library | `src/lib/ai/draft-email.ts`, `src/lib/ai/brief.ts` |
| Draft editor: save, redraft, mark ready, discard | `src/app/(app)/drafts/[id]/page.tsx` |
| **Pre-send check**: cap, opt-out, send path and sender, placeholders, recent contact, teammates' drafts | `src/lib/presend.ts` |
| Claude's review of the wording (advice only) | `src/lib/ai/draft-review.ts` |
| Drafts list | `src/app/(app)/drafts/page.tsx` |
| Database guard on drafts and opt-outs | `supabase/migrations/20260911000100_drafting.sql` |

- **Drafts live in `email_activity`** as `drafted` (being written), `approved` (the owner
  marked it ready; there's no separate approval) or `cancelled` (discarded). They have no
  `sent_at`, so they never count toward the cap or last activity.
- **A signed-in user can only write their own drafts.** Postgres refuses any other status,
  any delivery field, edits to sent email, and marking an opted-out contact's email ready.
  `npm run db:verify-rls` checks each of these.
- **Claude never invents specifics.** Where it lacks a fact, such as what shipped this
  quarter, it leaves a `[[marker]]`, and the pre-send check won't mark the draft ready
  until the owner fills it in.
- **Works without Claude:** the draft is the template with the known facts filled in.

## What Phase 5 delivers: sending

| Feature | Where it lives |
| --- | --- |
| **Send** on a ready email; **Stop sending** while it's queued | `src/app/(app)/drafts/[id]/page.tsx`, `src/app/(app)/drafts/actions.ts` |
| The governor: opt-out, address, sending mode, mailbox and monthly cap, checked at Send under a lock on the account | `public.send_email()` in `supabase/migrations/20260913000100_sending.sql` |
| Connect your Microsoft 365 mailbox (OAuth, PKCE, token encrypted before storage) | `/settings`, `src/app/mailbox/connect`, `src/app/mailbox/callback`, `src/lib/microsoft/` |
| The send job: delivers queued email through Microsoft Graph, retries, records the result | `src/lib/jobs/send.ts`, `src/lib/providers/send.ts` |
| The tracking job: replies and bounces from each sender's inbox | `src/lib/jobs/track.ts` |
| Both jobs behind one secret-protected endpoint | `src/app/api/jobs/[job]/route.ts`, `npm run jobs` locally |
| Sending mode (test, live, paused) and job health for the lead | `/settings` |
| Record an opt-out on any contact; unsubscribe link in cold and broadcast emails | contact rows, `src/app/unsubscribe/[token]` |

- **Both paths send from the author's own mailbox** (decided 2026-09-13). `send_path`
  still classifies each email, drives the unsubscribe line, and maps to a provider in
  `app_policy.send_path_routing.providers`, so cold can move to its own service later.
- **The cap counts sent plus queued routine emails.** Broadcasts sit outside it.
- **Nothing past "ready" is written by a signed-in user.** `send_email()` queues;
  only the jobs, on the service-role key, write `sent` and delivery fields.
- **Opens aren't tracked.** Replies and bounces are read from inbox senders, subjects and
  thread ids (`Mail.ReadBasic`, never bodies).

## What Phase 6 delivers: broadcast

| Feature | Where it lives |
| --- | --- |
| Write a broadcast with merge fields; filter by lifecycle, tier, health, product and contact type | `/broadcasts`, `src/app/(app)/broadcasts/` |
| Live audience preview with skip reasons, and the email as one recipient reads it | `public.preview_campaign_audience()` |
| Launch (now or scheduled) and cancel; progress per recipient | `public.launch_campaign()`, `public.cancel_campaign()` in `20260913000200_broadcast.sql` |

Each email goes from the account's primary owner's mailbox. Broadcasts neither count
toward nor are blocked by the monthly cap; opt-outs are checked at launch and again at send.
Lead only, enforced in Postgres.

## What Phase 7 delivers: reporting

`/reports`, backed by `report_people()`, `report_material()` and `report_campaigns()` in
`20260913000300_reporting.sql`: outreach consistency week by week, account coverage at
30 and 60 days, whether the collateral sent fits the account, and broadcast results.
Owners see their own numbers; the lead sees the team. Every function runs as the caller,
so RLS still applies.

## Leadership enrichment (Apollo)

**Find leaders** on an account's leadership pane searches Apollo for functional leaders at
the account's domain (free), and adds the people you tick as leadership contacts. Adding
someone reveals their email and uses Apollo credits, capped by
`app_policy.enrichment_rules.max_reveals_per_request`. Code: `src/lib/providers/apollo.ts`,
`src/app/(app)/accounts/[id]/leaders/`. It needs `APOLLO_API_KEY`.

A standalone clickable mockup of the Phase 1 screens is at `docs/ui-prototype.html`.
Open it in a browser; no server is required. It predates the Lyzr brand.

---

## Setup

You need a hosted Supabase project (this machine has no Docker, so the local
Supabase stack is not an option). Postgres 15 or newer — the views rely on
`security_invoker`.

**1. Create a Supabase project** at [supabase.com](https://supabase.com), then fill in
`.env.local` (already copied from `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://<ref>.supabase.co     # Settings -> API
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon / publishable key> # Settings -> API
SUPABASE_SERVICE_ROLE_KEY=<service role key>           # Settings -> API (keep secret)
SUPABASE_DB_URL=<session pooler connection string>     # Settings -> Database (optional)
SEED_USER_PASSWORD=PostSales!2026
ANTHROPIC_API_KEY=<Anthropic API key>                  # optional: Claude reads collateral searches
APP_BASE_URL=http://localhost:3001                     # for unsubscribe links
CRON_SECRET=<random, 16+ chars>                        # protects /api/jobs
MAILBOX_TOKEN_KEY=<32 random bytes, base64>            # encrypts Microsoft refresh tokens
MICROSOFT_CLIENT_ID / MICROSOFT_TENANT_ID / MICROSOFT_CLIENT_SECRET   # mailbox connection
APOLLO_API_KEY=<Apollo API key>                        # optional: leadership enrichment
```

`.env.example` shows how to generate `CRON_SECRET` and `MAILBOX_TOKEN_KEY`.

**2. Apply the migrations** (Phase 1 and Phase 2). Either link the CLI:

```bash
SUPABASE_PROJECT_REF=<ref> npm run db:link   # prompts for your DB password
npm run db:push
```

…or paste each file in `supabase/migrations/` into the SQL editor, in filename order.

No CLI login? Put the Session pooler connection string in `SUPABASE_DB_URL` (with the
password percent-encoded) and run `npx supabase db push --db-url "<it>" --yes`. After
step 3, add `--include-seed` to that command to load the seed instead of step 4.

**3. Create the four auth users:**

```bash
npm run db:seed-users
```

**4. Seed the fictional business data:**

```bash
npm run db:seed        # uses psql if SUPABASE_DB_URL is set
```

…or paste `supabase/seed.sql` into the SQL editor. It refuses to run before step 3.

**5. Prove RLS works, then run the app:**

```bash
npm run db:verify-rls
npm run dev -- -p 3001
npm run jobs            # in a second terminal: the send and tracking jobs
```

### Seed users

All four share `SEED_USER_PASSWORD`.

| Email | Person | Role | Sees |
| --- | --- | --- | --- |
| `pm@example.com` | Riya Kapoor | PM | Northwind, Brightline, Meridian Travel (churned) |
| `cal@example.com` | Marcus Webb | CAL | Vertex, Cobalt, Halcyon |
| `csm@example.com` | Elena Ortiz | CSM | Northwind, Vertex, Juniper |
| `lead@example.com` | Dana Whitfield | Post-sales lead (admin) | all eight, including the unassigned Tidewater Foods |

The password form exists for these fictional users only, and only on localhost
(`npm run dev`). Any deployed build refuses it.

### Microsoft sign-in (real users)

Real users sign in with their Lyzr Microsoft account. That needs three dashboard settings:

1. **Azure** (Entra ID → App registrations → the app used for sign-in):
   - Add the Web redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`.
   - Create a client secret.
   - Add the `email` optional claim to the ID token.
2. **Supabase → Authentication → Sign In / Providers → Azure:**
   - Enable it with the client ID and the secret's *Value*.
   - Set the Azure Tenant URL to `https://login.microsoftonline.com/<tenant-id>`, so only
     Lyzr's tenant can sign in.
   - Under **URL Configuration**, add `http://localhost:3001/**` (and your deployed URL)
     to Redirect URLs.
3. **Supabase → Authentication → Hooks → Before User Created:** choose Postgres and
   `public.hook_restrict_sign_up`. It refuses any account outside the domains listed in
   `app_policy.sign_in_rules`.

### Sending from Microsoft 365 mailboxes

To send for real, each user connects their mailbox in **Settings**. That needs, on the
same Azure app registration:

1. A **Web redirect URI** `http://localhost:3001/mailbox/callback` (and the deployed URL's
   `/mailbox/callback`).
2. **Delegated Microsoft Graph permissions:** `Mail.Send`, `Mail.ReadBasic`, `User.Read`,
   `offline_access`. An Entra admin should **grant admin consent** for Lyzr.
3. A **client secret** in `MICROSOFT_CLIENT_SECRET`.

Then the lead switches **Settings → Sending** from test mode to live. Once hosted,
schedule `GET /api/jobs/send` about every minute and `GET /api/jobs/track` every few
minutes, with `Authorization: Bearer $CRON_SECRET` (Vercel Cron sends this header).

Nobody becomes the post-sales lead automatically. To promote someone, run this in the SQL
editor: `update public.app_user set is_admin = true where lower(email) = '<their email>';`

---

## The visibility model

The rule — *an owner sees only their assigned accounts; the post-sales lead sees
everything* — is enforced in Postgres, not in React.

- Every table in `public` has RLS enabled and policies targeting the `authenticated`
  role. The `anon` role holds no table privileges at all, so the public key on its own
  reads nothing.
- Policies call two `SECURITY DEFINER` helpers in the private `app` schema:
  `app.is_admin()` and `app.has_account_access(uuid)`. They are security-definer so a
  policy on `account` can consult `account_assignment` without re-entering that table's
  own policy and recursing.
- `account_assignment` is the single source of the rule. Adding a row grants access;
  soft-deleting it removes access. No application code participates.
- Every view is `WITH (security_invoker = on)`, so a view is never an RLS escape hatch.
- The app's request path uses only the anon key plus the user's JWT. The service-role
  key is used in `scripts/seed-users.mjs` and by the send and tracking jobs
  (`src/lib/supabase/service.ts`), which are reachable only through `/api/jobs` with
  `CRON_SECRET`.

**Phase 2 write guards, also in Postgres:**

- **Lifecycle.** A trigger, `app.guard_account_lifecycle`, refuses lifecycle changes
  from any signed-in non-admin, even on an account they own. Sync jobs have no JWT
  subject, so they are allowed.
- **Owners.** Owners change only through `assign_account_owner` and
  `remove_account_owner`. Both functions refuse non-admins and run as the caller, so the
  table's own RLS still applies.
- **UI checks are convenience only.** The Team coverage page's admin check and its
  hidden nav link are not the boundary.
- **Access fields come only from `app_metadata`.** Users can edit their own
  `user_metadata`, so `is_admin`, `default_role` and `warm_sender_address` are read from
  `app_metadata` (service role only), and only when the profile is created.
- **Only Lyzr accounts can be created.** The Before User Created hook
  `public.hook_restrict_sign_up` checks `app_policy.sign_in_rules`.

Not one query in `src/lib/db/queries.ts` filters by user id. `npm run db:verify-rls`
demonstrates this from outside the app. It signs in as each user with the same public
key a browser holds and checks five things:
1. `select name from account` with no filter returns exactly the expected accounts.
2. Fetching another owner's account by id returns nothing.
3. An unauthenticated client sees zero rows.
4. A non-admin cannot change lifecycle, even on their own account.
5. A non-admin cannot make themselves an owner.
6. Editing your own metadata cannot make you an admin or change your sending address.
7. The drafting, sending, broadcast, report and unsubscribe guards (Phases 4–7): no faked
   sends or queue entries, the cap refusing a send, no reading mailbox tokens, broadcasts
   lead-only and outside the cap, reports scoped by role.

---

## Data model notes

`email_activity` is the spine. Last-activity, the monthly frequency count and (later)
analytics are all read from it and stored nowhere else, so they cannot drift:

- `account_last_activity` — most recent sent email per account
- `account_monthly_send_count` — routine sends this calendar month, across every sender
  and both paths. Broadcasts are counted separately and sit outside the cap
- `account_overview` — one row per visible account; what the dashboard, the account
  header, My targets and Team coverage read. Phase 2 appends lifecycle, owner count and
  primary owner.

Other decisions worth knowing:

- **Full body + template version pin** (your call on the open question). Each
  `email_activity` row stores the rendered `subject`/`body_text`/`body_html` *and*
  `template_version_id`. Templates are versioned in `template_version`, so editing a
  template never rewrites history. The seed ships `product_update_engaged` at v2 with
  a historical email still pinned to v1, so you can see the mechanism working.
- **Lifecycle.**
  - It lives on `account.lifecycle_status`, and a trigger stamps `lifecycle_changed_at`.
  - A friend account is a prospect with `is_friend_account = true`. The flag stays
    because send-path routing reads it.
  - Where "churned" ultimately comes from (a Helix/Compass sync, or the lead) is an open
    question. For now the lead sets it on Team coverage.
- **Sync mirror fields.** `account` and `contact` carry `source_system`, `external_id`
  and `synced_at`, and `account.external_id` is unique per source system. This works
  for either Helix/Compass ingestion path — a live API connector or a file/middle-layer
  import — so the blocked open question below does not block the schema.
- **App-only fields** (`notes`, `is_friend_account`) sit on `account` alongside synced
  fields and are not overwritten by sync.
- **Opt-out** is a first-class flag on `contact`, with a trigger keeping `opted_out_at`
  honest. Both send paths and broadcasts refuse an opted-out contact, at Send, at launch
  and again when the job sends.
- **Soft delete and audit** (`deleted_at`, `created_by`/`updated_by`, `created_at`/
  `updated_at`) are on every business table, with triggers stamping the actor from the
  JWT.
- **Governance lives in `app_policy`**, not in code: `frequency_cap`,
  `send_path_routing`, `broadcast_vs_routine_priority`, `staleness_thresholds`,
  `targeting_rules`. `resolveSendPath()` in `src/lib/policy.ts` reads the routing rules
  rather than branching on contact type — which is why the account view can already
  show you which path a compose *would* take.
- **Provider seams** are declared in `src/lib/providers/index.ts`. `SendProvider` has two
  implementations, `microsoft_graph` and `dry_run`; `send_path_routing.providers` picks
  one per path. `EnrichmentProvider` (search, then reveal) is implemented by Apollo.

---

## What is verified, and what is not

**Verified against the live Supabase project (2026-09-13):**
- All 13 migrations and the seed applied cleanly.
- `npm run db:verify-rls` passes every check, including the Phase 2 write guards and the
  Phases 4–7 guards.
- In test mode, through the running app: Send, the send job, a broadcast from launch to
  completion, the unsubscribe page, and every new page for the right roles.
- The Microsoft Graph and Apollo calls against simulated responses (no live keys yet).
- Signed in as the lead and as a PM, every page renders with the right accounts. For
  the PM, Team coverage and other owners' accounts return 404.
- `next build`, `tsc` and ESLint pass.

**Not verified yet:** a person clicking through the screens in a browser; a real Microsoft
mailbox connection and live send (needs the Azure settings above); a real Apollo search
(needs a key). Run steps 2–5 above against your project. `npm run
db:verify-rls` is the check that actually proves the ownership model, and it is the
first thing to run.

---

## Open questions

**Blocking the integrations track (and real data):**

1. **Cortex access.** The app has no screens to create accounts or contacts, so real
   data needs a sync from Cortex. Its subtools each have their own endpoint through the
   Cortex SDK:
   - **Helix** holds accounts and their status.
   - **Compass** holds owner info and the account mapping.
   - We're waiting on SDK docs, access, and field details from the Cortex team.

**Needed before Phase 3's Skott connector:**

2. **Skott API docs and a key** — which endpoints list collateral, how items are tagged,
   and how to authenticate.

**Needed before live sending:**

3. **Azure mailbox settings** — the redirect URI, delegated `Mail.Send` and
   `Mail.ReadBasic` with admin consent, and a client secret (see "Sending from Microsoft
   365 mailboxes").
4. **An Apollo API key** for leadership enrichment.

**Answered:**

6. How much email content to store — **full body plus a template version pin**.
7. On 2026-09-10:
   - Build in Post-Sales Outreach.
   - Collateral goes in as trackable links.
   - Emails send from the app.
   - Skott is fed through its API.
   - Use the Lyzr brand.
8. On 2026-09-13: Microsoft 365 mailboxes only; cold emails also from the owner's own
   mailbox; broadcasts sit outside the monthly cap; Apollo for enrichment.
