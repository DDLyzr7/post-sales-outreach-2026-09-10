# Post-Sales Outreach

Internal app for the post-sales team to own outbound communication to the existing
client base: who the stakeholders are at each account, which accounts each person
should reach next, what collateral fits them, what has been sent recently, and how
close the account is to its monthly cap.

**Nothing in this build can send an email.** Phases 1 and 2 are read-only apart from two
changes reserved for the post-sales lead: account owners and customer lifecycle.

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
| Two-pane account view, read-only | `src/app/(app)/accounts/[id]/page.tsx` |
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
```

**2. Apply the migrations** (Phase 1 and Phase 2). Either link the CLI:

```bash
SUPABASE_PROJECT_REF=<ref> npm run db:link   # prompts for your DB password
npm run db:push
```

…or paste each file in `supabase/migrations/` into the SQL editor, in filename order.

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
npm run dev
```

### Seed users

All four share `SEED_USER_PASSWORD`.

| Email | Person | Role | Sees |
| --- | --- | --- | --- |
| `pm@example.com` | Riya Kapoor | PM | Northwind, Brightline, Meridian Travel (churned) |
| `cal@example.com` | Marcus Webb | CAL | Vertex, Cobalt, Halcyon |
| `csm@example.com` | Elena Ortiz | CSM | Northwind, Vertex, Juniper |
| `lead@example.com` | Dana Whitfield | Post-sales lead (admin) | all eight, including the unassigned Tidewater Foods |

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
- The app's request path uses only the anon key plus the user's JWT. There is exactly
  one service-role client in the repo, in `scripts/seed-users.mjs`.

**Phase 2 write guards, also in Postgres:**

- **Lifecycle.** A trigger, `app.guard_account_lifecycle`, refuses lifecycle changes
  from any signed-in non-admin, even on an account they own. Sync jobs have no JWT
  subject, so they are allowed.
- **Owners.** Owners change only through `assign_account_owner` and
  `remove_account_owner`. Both functions refuse non-admins and run as the caller, so the
  table's own RLS still applies.
- **UI checks are convenience only.** The Team coverage page's admin check and its
  hidden nav link are not the boundary.

Not one query in `src/lib/db/queries.ts` filters by user id. `npm run db:verify-rls`
demonstrates this from outside the app. It signs in as each user with the same public
key a browser holds and checks five things:
1. `select name from account` with no filter returns exactly the expected accounts.
2. Fetching another owner's account by id returns nothing.
3. An unauthenticated client sees zero rows.
4. A non-admin cannot change lifecycle, even on their own account.
5. A non-admin cannot make themselves an owner.

---

## Data model notes

`email_activity` is the spine. Last-activity, the monthly frequency count and (later)
analytics are all read from it and stored nowhere else, so they cannot drift:

- `account_last_activity` — most recent sent email per account
- `account_monthly_send_count` — sends this calendar month, across every sender, both
  paths and all campaigns
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
  honest. It is shown in both panes today and will gate both send paths once sending
  lands (phase 5).
- **Soft delete and audit** (`deleted_at`, `created_by`/`updated_by`, `created_at`/
  `updated_at`) are on every business table, with triggers stamping the actor from the
  JWT.
- **Governance lives in `app_policy`**, not in code: `frequency_cap`,
  `send_path_routing`, `broadcast_vs_routine_priority`, `staleness_thresholds`,
  `targeting_rules`. `resolveSendPath()` in `src/lib/policy.ts` reads the routing rules
  rather than branching on contact type — which is why the account view can already
  show you which path a compose *would* take.
- **Provider seams** are declared in `src/lib/providers/index.ts`: `SendProvider` (with
  `warm` and `cold` as two separate implementations of one interface, never one
  implementation with a flag) and `EnrichmentProvider`. Interfaces only for now —
  nothing implements or calls them yet.

---

## What is verified, and what is not

**Verified here:**
- `next build`, `tsc` and ESLint pass.
- All eight SQL files (seven migrations and the seed) parse against the real
  PostgreSQL grammar via `libpg_query`.

**Not verified here:**
- **No SQL has been executed.** This machine has no Docker and no Postgres, and
  `.env.local` still holds the placeholder Supabase URL, so this app has no project to
  run against yet.
- **No screen has been opened.** With placeholder keys, `src/lib/env.ts` deliberately
  throws inside the proxy, so every route returns 500 until real keys are set.

So the migrations, the RLS policies, the Phase 2 write guards and the seed have not run
against a live database, and none of the pages has been seen rendering. Run steps 2–5 above against your project. `npm run
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

**Needed before Phase 5 (sending):**

3. **Warm-path mailbox** — send from each owner's individual mailbox, or one shared
   post-sales address? Built on the brief's assumption of the owner's mailbox:
   `app_user.warm_sender_address` is per-user.
4. **Cold sending provider** for the bought outbound domains.

**Needed before Phase 6 (broadcast):**

5. **Broadcast vs routine priority** when both would hit an account in the same month.
   `app_policy.broadcast_vs_routine_priority` is seeded as
   `PLACEHOLDER_AWAITING_CONFIRMATION` with `broadcast_wins_routine_defers` (routine
   sends defer 30 days). Confirm or change the row before the governor goes live.

**Answered:**

6. How much email content to store — **full body plus a template version pin**.
7. On 2026-09-10:
   - Build in Post-Sales Outreach.
   - Collateral goes in as trackable links.
   - Emails send from the app.
   - Skott is fed through its API.
   - Use the Lyzr brand.
