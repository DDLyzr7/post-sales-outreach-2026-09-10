@AGENTS.md

# Post-Sales Outreach — working notes

Internal app for the post-sales team to own outbound communication to the existing
client base. Replaces ad-hoc CEO emails with governed, owned, frequency-capped
outreach, and extends reach to functional leaders (CHRO, CMO…) we don't sell to yet.

Setup, seed users and the full data-model rationale live in `README.md`. This file is
the working guide: current state, invariants, and what not to break.

The walkthrough feature list is `docs/feature-list.html`, published at
https://claude.ai/code/artifact/63eeac62-b178-4065-8831-366c3f2171c7. It has 48 features,
each with an ID, status and phase. When a phase lands, update its statuses and counts,
then republish from the same file path.

This folder holds **two separate apps**. The root (`src/`, `supabase/`, `scripts/`) is
Post-Sales Outreach, built here. `comms-tracker/` is an older Lyzr app handed over by
its previous owner. It has its own `package.json`, Supabase project and conventions. See
[the comms-tracker section](#comms-tracker--inherited-handover) at the bottom. Keep
the two codebases apart, and don't carry either one's invariants across without asking.

_Last updated 2026-09-10._

## Status — Phases 1–2 built, Phase 3 search and Microsoft sign-in built; all awaiting review

The phases were re-sequenced on 2026-09-10, when the user added five features:
collateral search, reporting, one-click Claude drafting, a per-user targets view and
global broadcast.
- **Drafting now comes before sending,** so Claude's drafts can be reviewed without any
  risk of an email going out.
- **Helix, Compass and enrichment moved to their own track,** because they are waiting
  on answers.

| Phase | State |
| --- | --- |
| 1 — foundation: schema, auth, RLS, read-only two-pane view | **done, unreviewed** |
| 2 — accounts and targeting: lifecycle, My targets, Team coverage, owner assignment | **done, unreviewed** |
| 3 — collateral search: natural-language search, Skott API feed | **search built, unreviewed**; the Skott feed waits on its API docs and a key; how collateral goes into emails is parked until Skott's data shape is known |
| 4 — one-click drafting with Claude, collateral in drafts, pre-send check | not started |
| 5 — sending: warm and cold paths, cap and opt-outs enforced, delivery tracking | not started. Sends through users' existing mailboxes; mail system and cold-path handling to confirm |
| 6 — global broadcast to all accounts | not started. Needs the priority rule |
| 7 — reporting: outreach consistency, account coverage, relevant material | not started |
| Track — integrations: Cortex sync (Helix: accounts and status; Compass: owners and account mapping), leadership enrichment | waiting on Cortex SDK docs and access |
| P1 — Lyzr sign-in with Microsoft | built and migration pushed; waiting on the user's Azure and Supabase dashboard settings (open question 8) |

Build phase by phase. Complete one, stop for review, do not scaffold ahead. Surface a
phase's open questions before writing code that depends on them.

### Verification state (2026-09-10)

- **Build:** `npx tsc --noEmit`, `npx eslint .` and `npx next build` all pass. Routes:
  `/`, `/accounts/[id]`, `/targets`, `/team`, `/collateral`, `/login`, `/auth/callback`.
- **Signed-in screens:** checked on the dev server (`:3001`) by signing in as the lead and
  as Riya and fetching each page from the server.
  - **The lead:** `/`, `/targets`, `/team` and `/accounts/[id]` all render with the right
    data.
  - **Riya:** her dashboard shows only her 3 accounts. `/team` and another owner's
    account return 404, and her nav hides Team coverage.
  - The server log has no errors. The user hasn't clicked through in a browser yet.
- **SQL:** all 10 SQL files (9 migrations plus the seed) parse with libpg_query, using
  pglast 8.3 in a scratchpad venv. To recreate it:
  `python3 -m venv <dir> && <dir>/bin/pip install pglast`. pglast 8.4 fails to build
  on this Mac's Python 3.9, but 8.3 installs from a wheel.
- **Live Supabase project**, created by the user in the dashboard:
  - All 9 migrations are applied (`npx supabase db push --db-url … --yes`).
  - `npm run db:seed-users` created the 4 users.
  - `db push --db-url … --include-seed --yes` loaded `seed.sql`
    (`supabase/config.toml` now has `[db.seed]`).
  - **`npm run db:verify-rls` passed every check:**
    - Each owner sees exactly their own accounts and contacts, can't fetch anyone
      else's, and can't change lifecycle or make themselves an owner.
    - Editing their own metadata can't make them admin or change their sending
      address.
    - The lead sees all 8 accounts.
    - The anon key sees nothing.

## Progress log

**2026-09-07:** Phase 1 built (schema, auth, RLS, read-only views, UI prototype).

**2026-09-10, in order:**

1. **Reviewed `comms-tracker/`,** the inherited Lyzr app. Found 16 files missing from
   disk and restored them from its local `.git`.
2. **Moved Comms Tracker to our GitHub.** Made an SSH deploy key, pointed the repo at
   `DDLyzr7/Post-Sales-Comms-Tool`, kept the previous owner's handover commit, merged
   the GitHub README, and pushed (fast-forward, no force).
3. **Built Comms Tracker locally,** after fixing a build break caused by the folder
   nesting (`turbopack.root`). Excluded it from the root app's `tsconfig`/eslint, which
   it had broken.
4. **Audited Comms Tracker** (UI, data pipeline, security) and probed its live site and
   database read-only. Findings are in the comms-tracker section below. The live
   dashboard views leak metadata to the anon key.
5. **The user added features to Post-Sales Outreach:**
   - Natural-language collateral search with Skott as the source.
   - Reporting.
   - Role-based access, where the lead sees all.
   - One-click Claude drafting.
   - A per-user targets view (existing and churned).
   - Global broadcast.
6. **Decisions:** build here, Skott via API, trackable links, send from the app.
   Re-sequenced the phases.
7. **Wrote and published the walkthrough feature list** (`docs/feature-list.html`).
8. **Built Phase 2:**
   - The lifecycle migration and owner functions.
   - `/targets` and `/team`.
   - Seed accounts for Meridian (churned) and Tidewater (unassigned).
   - The `verify-rls` write-guard checks.
9. **Applied the Lyzr brand** from lyzr.ai/opencontroller to the app and the feature
   list, at the user's request.
10. **Answered "do we need a Cortex API link?"** Not for Phase 2, which runs on seed
    data. Yes for real use, because there's no way to create accounts in the app.
11. **The user corrected the collateral tool's name to Skott** (not Skoot or Scoot). It
    is fixed everywhere. The earlier web search used the misspelling and found nothing,
    so search again under "Skott" once docs arrive.
12. **Delivered the prioritised build list** (P0–P7) and a timeline to the user.
13. **The user confirmed domains and email infrastructure already exist.** For now, the
    app connects each user's current mailbox for sending. That removes domain warm-up and
    cuts the sending phase from 3–5 weeks to about 1–2.
    - **Revised estimate:** about 8–10 weeks in total. A usable version without sending
      takes about 4–6 weeks, and the first real sends land around week 6–7.
    - **Still open:** which mail system, and how to handle cold emails (open questions 3
      and 4).
14. **Put Post-Sales Outreach under git.** The user chose **a new repo named with today's
    date**, separate from Comms Tracker's.
    - **Local repo:** `git init -b main` in this folder, with identity
      `Deepankar Dimri <deepankar.dimri@lyzr.com>` set for this repo only.
    - **First commit:** `0a8c8cd` "Post-Sales Outreach: phases 1 and 2", 58 files.
    - **`.gitignore` fixes:**
      - `!.env.example`, because `.env*` had been hiding the template the setup steps
        tell you to copy.
      - `/comms-tracker/`, because it is a separate repo.
    - **Checked before committing:** no `.env.local`, no secrets, nothing from
      `comms-tracker/`, and no literal secrets in `supabase/config.toml`.
    - **SSH:** a second deploy key, `~/.ssh/id_ed25519_post_sales` (no passphrase,
      fingerprint `SHA256:SxvKT9HSIuDOhcYEWkU8jvSUgjRf6QJ9LzdIeUfgLRc`). A host alias in
      `~/.ssh/config`, `Host github-post-sales`, uses that key, so the remote will be
      `git@github-post-sales:DDLyzr7/<repo>.git`. GitHub allows a key on only one repo,
      and `~/.ssh/id_ed25519` belongs to `Post-Sales-Comms-Tool`.
    - **Pushed 2026-09-10** to **`DDLyzr7/post-sales-outreach-2026-09-10`** (private)
      over SSH: `git@github-post-sales:DDLyzr7/post-sales-outreach-2026-09-10.git`.
      - GitHub had created a one-line README commit (`c127e78`). It was merged in
        (`99ddac9`), keeping our README. Files were unchanged, and there was no force-push.
      - Local `main` tracks `origin/main`.
      - The key is a deploy key with write access on this repo only.
    - **Supabase:** gave the user detailed setup steps. Once `.env.local` has real keys:
      the user runs the CLI link and push (both interactive), then I run
      `db:seed-users` and `db:verify-rls`, and they paste `seed.sql` in the SQL editor
      (no psql here).
15. **Cortex answer from Krish (Cortex team).** Helix (accounts and status) and Compass
    (owner info and account mapping) are separate Cortex subtools, each with its own
    endpoint through the Cortex SDK. This corrects "Helix is Cortex". Krish asked what
    we need, so I drafted the reply for the user (open question 1). The Cortex sync
    becomes P1's first real-data step: Helix fills accounts and lifecycle, and Compass
    fills owners.
16. **The Supabase project is live for Post-Sales Outreach.** The user created it in the
    dashboard.
    - **`.env.local`:** the URL, publishable key and secret key. The user had pasted only
      the pooler host into `SUPABASE_DB_URL`, so the full connection string was built
      from that host plus `SUPABASE_DB_PASSWORD`.
    - **Database:** pushed all 7 migrations, created the 4 sample users and loaded
      `seed.sql`. `db:verify-rls` passed every check.
    - **Screens:** the signed-in page checks passed for the lead and for Riya. The app
      runs at http://localhost:3001.
    - **P0 steps 1 and 2 are done.** Next, the user reviews Phases 1–2 in the browser.
17. **Built Microsoft sign-in.** The user's choices: Lyzr's Microsoft 365 organisation
    only, reuse the "Lyzr Comms Tracker" Azure app, nobody becomes the lead on first
    sign-in, and password sign-in for the sample users on localhost only.
    - **Found and fixed a Phase 1 privilege escalation.** The profile trigger copied
      `is_admin`, `default_role` and `warm_sender_address` from user-editable
      metadata, so any signed-in user could make themselves the lead. Those fields
      now come from `app_metadata`, set only when the profile is created;
      `seed-users` writes them there, and `verify-rls` proves it.
    - **Migration `20260910000200_microsoft_sign_in.sql`** (the trigger fix,
      `sign_in_rules`, `hook_restrict_sign_up`) is pushed to the live project.
      `db:verify-rls` passes every check, including the new ones.
    - **Login page:** "Continue with Microsoft" above the local-only sample-user form.
      `/auth/callback` exchanges the code and sends errors back to the login page, and
      `next` redirects stay on this site.
    - **Watch for:** one `PGRST303 "JWT issued at future"` appeared in the dev log right
      after a browser sign-in, and the next request worked. If it recurs, it's clock
      skew to report to Supabase.
    - **Not yet working end to end:** it needs the user's Azure and Supabase dashboard
      settings (open question 8).
18. **Built Phase 3's collateral search.** The user's choices: database search plus
    Claude, no editing until Skott is connected, no click tracking, and links parked until
    Skott.
    - **Migration `20260910000300_collateral_search.sql`:** a weighted `tsvector` on
      collateral, and `search_collateral()`, which OR-matches words and boosts matches on
      product, role and content type. Pushed to the live project.
    - **`/collateral`:** you type a request, and Claude's reading appears as "Read as"
      chips. Results link to the collateral itself.
      - Opened from a contact's "Find collateral" link, the search adds that contact's role
        and fitting products: products in use for engaged contacts, not-yet-used ones for
        leadership.
    - **Verified live:**
      - The RPC checks pass: sentence OR-matching, boosts, content type, the empty
        listing, and anon denied.
      - Signed in as Riya, Claude read "something for a CFO worried about duplicate vendor
        spend" as vendor-spend keywords, Spend Intelligence and Finance. Spend
        Intelligence material ranked first.
      - Another owner's contact is ignored, and the log has no errors.
    - **The status check found the Microsoft sign-in dashboard steps not done yet.** The
      Azure provider is off, and so is the sign-up hook: a non-Lyzr test account could be
      created (it was deleted). Email sign-ups stay open until the hook is on.
19. **Status snapshot and final feature list.**
    - **Feature list:** added "Automatic checks on GitHub" (GV-04) and "Hosted on Vercel"
      (GV-05, the last step). It now totals **48 features: 22 built, 19 planned, 7 waiting
      on input**, and is republished at the same link.
    - **This file:** the Status heading and the priority table now show the status of each
      stage, and it records where we stopped and what's next.
    - **Git:** the Post-Sales Outreach repo is clean and in sync with GitHub; the last
      commit before this entry is `cc2ce96`. Comms Tracker's repo still
      holds its one uncommitted change, `next.config.ts`.
    - **Local servers:** both were running, then the system stopped them for low memory.
      Restart commands are under "Local servers" below.
    - **Next without waiting on anyone:** Phase 4 (Claude drafting) and CI. The Cortex
      sync and the Skott feed start when their answers arrive, and Vercel comes last.
20. **Shareable status report** at `docs/status-report-2026-09-10.html`, published at
    https://claude.ai/code/artifact/1838089d-55e2-4643-b0a1-55bf7ef3f488.
    - **Contents:** 22 of 48 features built, where each phase stands, progress by area,
      what works today, and what's next. At the user's request it ends at "What's next";
      the waiting-on, decisions and timeline sections were removed.
    - **Audience:** written for people outside the build, so it leaves out internal
      to-dos such as the sign-up hook.
    - **Chart colours:** the progress bars use one mahogany ramp (built, then waiting,
      then planned), validated as an ordinal ramp for light and dark. An earlier
      green/amber/grey status palette failed the colour-vision and chroma checks.
    - **Keep it current:** for the next report, copy the file with a new date and republish
      it. Keep its numbers in step with the feature list.
    - **Standalone copy to send around:**
      `~/Desktop/Post-Sales-Outreach-Status-Report-10-Sep-2026.html`, outside the repo. It
      wraps the report in a full HTML document (doctype, head, body) so it opens in any
      browser. Regenerate it whenever the report changes.
21. **Share versions of the status report.**
    - **Cortex now reads "Pending"** everywhere in the report, at the user's request: the
      phase status, the What's next label and the progress table. It replaced "When inputs
      arrive" and "Waiting on inputs". The count label "waiting on inputs" in the key stays,
      because it's a feature status, not the Cortex wording. Committed `b29851c`,
      republished at the same link, and the Desktop HTML copy was regenerated.
    - **Word file:** `~/Desktop/Post-Sales-Outreach-Status-10-Sep-2026.docx`. It holds the
      report's content as bullet points and was made with macOS
      `textutil -convert docx` from simple HTML. A copy-paste Slack message went to the
      user in the chat only; it isn't saved anywhere.
    - **PDF:** `~/Desktop/Post-Sales-Outreach-Status-Report-10-Sep-2026.pdf`, 4 A4 pages
      with a page footer. No section breaks across pages:
      - Page 1: title and At a glance.
      - Page 2: phases.
      - Page 3: the progress table.
      - Page 4: What works today and What's next.
    - **How the PDF is made:** `scripts/report-pdf.mjs`.
      - It embeds the report's Google Fonts, adds print CSS (block flow, whole sections,
        fixed table columns), and prints with headless Chrome.
      - It then reads each page's text back through PDFKit (`osascript`), and copies the
        PDF out only if no section is split.
      - Run it with
        `node scripts/report-pdf.mjs docs/status-report-2026-09-10.html <out.pdf> <scratch dir>`.
      - For a new report, update the footer date and the section markers in the script.
      - Headless Chrome writes the PDF but may not exit, so the script waits for the file
        and then stops Chrome.
      - The PDF hasn't been checked visually, because this Mac has no PDF-to-image tool.
    - **User preference:** for documents to share, deliver the plain format asked for,
      quickly, without extra rendering or verification steps.

**Priority order the user follows, with status (2026-09-10):**

| Stage | Scope | Status |
|---|---|---|
| **P0** | Git repo for the root app; Supabase project, run it, review Phases 1–2; Comms Tracker leak fix; the answers | Repo and live Supabase **done**. User review of Phases 1–3 and the Comms Tracker housekeeping still open |
| **P1** | Cortex sync; customer-status source; Lyzr sign-in; deploy and CI | Microsoft sign-in **built**, but the dashboard settings are pending. Cortex sync waits on Krish. CI not started. Hosting on Vercel comes **last** |
| **P2** | Skott connector; collateral search; collateral in emails | Search **built**. Skott feed waits on API docs. Collateral in emails parked until Skott |
| **P3** | Claude drafting | Not started. Nothing blocks it |
| **P4** | Sending via connected mailboxes; enforced rules; unsubscribe; delivery status | Not started. Needs the mail system and cold-path answers |
| **P5** | Global broadcast | Not started. Needs the priority rule |
| **P6** | Reporting | Not started |
| **P7** | Compass; enrichment; Comms Tracker's future | Waiting on answers |

**Stopped for review after Phase 3's search.**
- **Next when answers arrive:** the Cortex sync once Krish replies, and the Skott feed once
  its API docs arrive.
- **Can start any time:** Phase 4 (Claude drafting) and CI, since neither is blocked.
- **Last:** Vercel hosting on the company account.

**Waiting on the user:**
- **Post-Sales Outreach:** switch on the Before User Created hook now (email sign-ups stay
  open until it is on), add the rest of the Microsoft sign-in settings (open question 8),
  review Phases 1–3 in the browser at http://localhost:3001,
  send Skott API docs and a key, and pass on the Cortex answers from Krish (open
  question 1).
- **Comms Tracker:**
  - Confirm the GitHub "Comms Tracker refresh" workflow is disabled.
  - OK to commit and push `comms-tracker/next.config.ts`. It's the only uncommitted
    change.
  - Decide on the live view leak.

**Local servers:** none running. The system stopped both dev servers for low memory on
2026-09-10. Restart Post-Sales Outreach with `npm run dev -- -p 3001`, and Comms Tracker
with `cd comms-tracker && npm run dev`, which serves `http://localhost:3000/abm-tracker/`.

## Commands

```bash
npm run dev              # Next dev server (comms-tracker's dev server may already hold :3000)
npm run build            # next build (needs the two NEXT_PUBLIC_ vars set)
npx tsc --noEmit         # types
npx eslint .             # lint

npm run db:link          # SUPABASE_PROJECT_REF=<ref> npm run db:link
npm run db:push          # apply supabase/migrations/ to the hosted project
# What was actually used, with no CLI login: pass SUPABASE_DB_URL from .env.local
#   npx supabase db push --db-url "<SUPABASE_DB_URL>" --yes            migrations
#   npx supabase db push --db-url "<SUPABASE_DB_URL>" --include-seed --yes   seed.sql
npm run db:seed-users    # create the 4 auth users (service-role key)
npm run db:seed          # apply supabase/seed.sql (needs psql + SUPABASE_DB_URL)
npm run db:verify-rls    # THE check that proves the ownership model and write guards
```

There is no local Postgres, Docker or psql on this machine, so SQL can't run locally.
- **It reaches the hosted project** through the Supabase CLI over `SUPABASE_DB_URL`.
  That's the session pooler with a percent-encoded password, and the CLI builds it from
  `SUPABASE_DB_PASSWORD`.
- **It's the user's live project,** so parse new SQL with `libpg_query` (pglast in a
  venv) first, say before you push, and say plainly whether it has been pushed.
- **`npm run db:verify-rls` is what proves RLS against it.**
- **Never print values from `.env.local`.**

## Invariants — do not break these

1. **Access control lives in Postgres, not React.** Every `public` table has RLS on;
   policies target `authenticated`; `anon` holds no table privileges. No query in
   `src/lib/db/queries.ts` filters by user id — if you find yourself adding
   `.eq("user_id", …)` to enforce visibility, the fix belongs in a policy instead.
   Policies call `app.is_admin()` / `app.has_account_access()`, which are
   `SECURITY DEFINER` in the private `app` schema so a policy on `account` can consult
   `account_assignment` without recursing.
2. **Every view is `WITH (security_invoker = on)`.** A view is never an RLS escape hatch.
   Needs Postgres 15+. Comms Tracker's live project shows what happens without this:
   see its "Live state" section. `create or replace view` must restate the option.
3. **One service-role client in the whole repo**, in `scripts/seed-users.mjs`. Never in
   a request path. Sync jobs (integrations track) may use it — deliberately, to bypass RLS.
4. **`email_activity` is the single read-source** for last-activity, the frequency count
   and analytics. Derive on read via the views; never store a copy on `account`.
5. **Governance is data, not code.** The cap, send-path routing, broadcast priority,
   staleness thresholds and targeting rules live in `app_policy`. `resolveSendPath()`
   in `src/lib/policy.ts` reads the routing rules; don't branch on contact type inline.
6. **The two send paths are separate implementations of one interface**, never one
   implementation with a flag. Warm = owner's real mailbox on our real domain. Cold =
   dedicated bought domains, never the master domain.
7. **Respect `contact.is_opted_out` on every path**, warm and cold.
8. **Templates are versioned.** Pin `template_version_id` on every `email_activity` row
   so editing a template never rewrites what we actually said.
9. **Lifecycle is the lead's call, enforced in Postgres.** `app.guard_account_lifecycle`
   refuses a lifecycle change from any signed-in non-admin, even on an account they own.
   Sync jobs have no JWT subject, so they pass. It also stamps `lifecycle_changed_at`.
   Don't recreate the check in React.
10. **Owners change only through `assign_account_owner` / `remove_account_owner`.**
    - Both are SECURITY INVOKER, so `account_assignment`'s RLS still applies inside.
    - Both are atomic: setting a primary owner demotes the old one in the same
      transaction.
    - Removal is a soft delete, and re-adding someone revives their old row, because the
      unique key also covers soft-deleted rows.
    - The app calls them via `supabase.rpc`. Don't write `account_assignment` directly.
11. **"My targets" thresholds come from policy.** Buckets read the monthly cap, the
    staleness windows and `app_policy.targeting_rules.renewal_window_days`.
    `src/lib/targeting.ts` only decides the order the rules are checked in.
12. **Access-granting profile fields come only from `app_metadata`.**
    `raw_user_meta_data` is editable by the user.
    - `app.handle_new_auth_user` reads `is_admin`, `default_role` and
      `warm_sender_address` from `raw_app_meta_data`, which only the service role can
      write, and only when the profile is created.
    - Never copy access or sending fields from user metadata. `db:verify-rls` checks
      this.
13. **Only Lyzr accounts can be created.**
    - The Before User Created hook, `public.hook_restrict_sign_up`, checks
      `app_policy.sign_in_rules`: Microsoft allows lyzr.com and lyzr.ai, and password
      allows only example.com, the sample users. It fails closed.
    - Password sign-in is refused outside `NODE_ENV=development` inside `signIn`
      itself, not just hidden on the page.
14. **Claude only chooses from lists it's given, and only on the server.**
    - `src/lib/ai/collateral-search.ts` constrains products, roles and content types to
      enums through structured output, and drops unknown product keys.
    - It returns null on any refusal, error or missing key, and search falls back to
      word matching.
    - `ANTHROPIC_API_KEY` is server-only. Never import that module into a client
      component.

## Layout

```
supabase/migrations/    01 enums+helpers · 02 core tables · 03 collateral/templates/email
                        04 views · 05 RLS · 06 policy defaults
                        20260910000100 lifecycle, account_overview v2, owner functions,
                                       targeting_rules
                        20260910000200 Microsoft sign-in: trusted profile fields,
                                       sign-up hook, sign_in_rules
                        20260910000300 collateral search: tsvector index, search_collateral()
supabase/seed.sql       fictional: 8 accounts (incl. churned Meridian Travel, unassigned
                        Tidewater Foods), contacts, collateral, templates, 7 historical sends
scripts/                seed-users.mjs · apply-sql.mjs · verify-rls.mjs ·
                        report-pdf.mjs (status report to an A4 PDF, sections kept whole)
src/lib/supabase/       server.ts (JWT-bearing) · client.ts · proxy.ts
src/lib/db/queries.ts   all reads; no owner filtering by design
src/lib/policy.ts       reads app_policy; resolveSendPath()
src/lib/targeting.ts    My targets buckets: win back · going quiet · renewal · warm up ·
                        at cap · on track
src/lib/providers/      SendProvider + EnrichmentProvider — interfaces only, nothing calls them
src/app/(app)/          dashboard · accounts/[id] two-pane · targets · team (+ team/actions.ts) ·
                        collateral (natural-language search)
src/app/auth/callback/  Microsoft sign-in return: exchanges the PKCE code, errors go to /login
src/lib/auth.ts         password-sign-in gate (localhost only), same-site redirects, origin
src/lib/ai/             collateral-search.ts: Claude reads a request into search terms
src/lib/db/collateral.ts  search_collateral RPC, plus the contact a search is for
src/components/         ui · account-status-header · contact-pane · owner-forms (client) ·
                        nav-links (client)
docs/feature-list.html  walkthrough feature list (published artifact)
docs/status-report-2026-09-10.html  shareable status report (published artifact)
docs/ui-prototype.html  Phase 1 clickable mockup, pre-brand palette
comms-tracker/          SEPARATE inherited app — see the section at the bottom
```

The root `tsconfig.json` excludes `comms-tracker`, and `eslint.config.mjs` ignores
`comms-tracker/**`. Keep both. Without them, the root `**/*.ts` include picks up
comms-tracker's files, and its `@/` imports resolve to the root `src/`.

Next 16 renamed `middleware` to `proxy` — the entry point is `src/proxy.ts`. It gates
non-public routes as a convenience redirect; it is **not** the security boundary. The
same goes for `/team`'s `notFound()` for non-admins and the hidden nav link.

## Decisions already made — don't re-litigate

- **Hosted Supabase**, keys supplied by the user in `.env.local`. No local stack.
- **Full email body stored in-app, plus a template version pin.** Not metadata-only.
- **Seed data is fictional.** No real client contact data in the repo.
- **`app_user` is readable by any authenticated teammate.** Deliberate: it is the
  internal colleague directory, not the access-control surface. An earlier draft scoped
  it to shared accounts and broke the sender join on `account_last_activity` (an owner
  could see an email the post-sales lead sent to their own account, but not who sent
  it). Client data lives in `contact`, which is account-scoped.
- **Friend accounts route cold on both panes.** `contact-pane.tsx` types their contacts
  as `friend_account`; routing warm would put a non-customer conversation on our real
  sending domain.
- **Sync-agnostic schema.** `source_system` + `external_id` + `synced_at` on `account`
  and `contact` support either a Helix/Compass API connector or a file/middle-layer
  import, so the blocked question below doesn't block the schema.
- **Built in Post-Sales Outreach, not Comms Tracker** (2026-09-10). Reuse Comms
  Tracker's proven pieces (its Claude drafting, the Cortex adapter) by porting the
  code, never by sharing its Supabase project.
- **No click tracking on collateral** (2026-09-10). This reverses an earlier call for
  trackable links. Collateral goes to people the team is already in conversation with.
  Whether it goes into emails as a link or an attachment is parked until Skott's data
  shape is known.
- **Emails send from the app on the warm and cold paths** (2026-09-10). Not Comms
  Tracker's compose handoff.
- **Skott is the collateral source, fed through its API** (2026-09-10). Don't block
  collateral work on it: build against a provider interface and the existing
  `collateral` table.
- **Collateral search is database ranking plus Claude** (2026-09-10).
  - **Claude reads the request:** Claude Opus 5 (`claude-opus-5`), effort `low`, with
    structured output and `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`).
  - **The database ranks the library:** `search_collateral()` treats every signal as a
    boost, not a filter.
  - **API key:** Comms Tracker's Anthropic key, copied into `.env.local`.
- **Nobody edits collateral in the app until Skott is connected.** Until then the library
  holds the sample collateral.
- **Hosting is Vercel, on Lyzr's company account, as the last step** (2026-09-10). The app
  stays on localhost until the features are in.
- **Lifecycle values are `existing | churned | prospect`.** A friend account is a
  prospect with `is_friend_account = true`. The flag stays because routing reads it.
- **Sign-in is Microsoft, Lyzr accounts only** (2026-09-10).
  - **How:** Supabase's Azure provider on the reused "Lyzr Comms Tracker" app
    registration (client ID `eb37cade-21f4-492e-b3f2-a5656911704a`, tenant
    `4b1018eb-9480-4542-89d0-4e6233aba226`), with the tenant URL restricted to Lyzr,
    plus the sign-up hook.
  - **Admins:** nobody becomes the lead on first sign-in. To promote someone, run
    `update public.app_user set is_admin = true where lower(email) = '<email>';` in the
    SQL editor.
  - **Passwords:** password sign-in exists only for the sample users, on localhost.
- **Lyzr brand throughout** (2026-09-10), taken from lyzr.ai/opencontroller:

  | Role | Value |
  |---|---|
  | Parchment ground | `#FAFAF9` |
  | Ink | `#160F0A` |
  | Actions (mahogany accent) | `#724B4B` |
  | Highlight (roe) | `#C96A5A` |
  | Problems (brick) | `#9B392E` |
  | Lyzr violet (cold path) | `#6E51E4` |

  Type is Playfair Display for headings (`font-display`), Figtree for body text and DM
  Mono for labels. The tokens are in `src/app/globals.css` and the fonts load in
  `src/app/layout.tsx`.

## Design language

`docs/ui-prototype.html` is a standalone, dependency-free clickable mockup of the Phase 1
screens on the seed data (published:
https://claude.ai/code/artifact/6025378a-ec9b-4497-96eb-ce3cbe16ecd1). It predates the
Lyzr brand, so reuse its structure, not its palette.

Rules the app keeps:
- **Three separate colour axes,** so none of them reads as another:
  - Health: green, amber, red.
  - **Send path:** teal for warm, Lyzr violet for cold.
  - Lifecycle: mahogany for existing, amber for churned, violet for prospect.
- **The frequency cap is a segmented gauge.**
- **Show the actual sending identity,** not just the word "cold".

The prototype's user switcher reimplements the RLS rule in JS for the demo only. That is
a mockup affordance, not a pattern to copy into the app.

## Open questions

**Blocking the integrations track, and therefore real data:**

1. **Cortex access (Helix and Compass).** There is still no way to get real accounts in:
   by design the app has no screens to create accounts or contacts.
   - **Confirmed 2026-09-10 by Krish (Cortex team):** Cortex is the umbrella. Its
     subtools each have their own endpoint, bound through the Cortex SDK.
     - **Helix** holds accounts and their status, so it is the source for `account` rows
       and `lifecycle_status`.
     - **Compass** holds owner info and the account mapping, so it is the source for
       `account_assignment` (owners matched to `app_user` by email).
   - **Correction:** earlier notes said "Helix is Cortex". That was wrong; Helix is one
     Cortex subtool. Comms Tracker's adapter (`comms-tracker/lib/adapters/cortex.ts`)
     calls `https://applied-ai.lyzr.app` `/api/v3/workspace` and `/api/v3/projects`
     with a workspace gateway key (docs: `NeuralgoLyzr/lyzr-PSA/docs/external-api.md`).
     Which subtool that is, and whether it's the SDK's API, is still unknown.
   - **Asked Krish for:**
     - SDK and docs.
     - Per-subtool endpoints and auth.
     - Helix account fields and the full list of status values.
     - Compass owner fields (email, role, primary) and how it joins to Helix.
     - Incremental sync, and how deletes and merges show up.
     - A sample payload from each.
     - OK to store a copy.

**Needed before Phase 3's Skott connector:**

2. **Skott API docs and a key:** the endpoints, how collateral is tagged (product,
   persona, content type), and how authentication works. Also how Skott stores an item
   (a file or a link), which decides how collateral goes into emails.

**Needed before Phase 5:**

3. **Warm-path mailbox. Answered 2026-09-10:** each user connects the mailbox they
   already use. The domains and email infrastructure already exist, so there are no new
   domains to warm up. This matches the per-owner design
   (`app_user.warm_sender_address`).
   - **Still to confirm:** Google Workspace, Microsoft 365, or both? Comms Tracker
     suggests lyzr.ai is on Google and lyzr.com is on Outlook.
   - **Microsoft sending** will likely need a one-time tenant admin consent.
4. **Cold path for now.** With only existing mailboxes connected, cold-routed emails
   (cross-sell intros, friend-account outreach) could:
   - also go from the owner's mailbox,
   - go through the existing cold setup (Lyzr runs Instantly, which Comms Tracker reads),
   - or stay as drafts until that setup is connected.

   The first option changes `send_path_routing` and invariant 6 ("cold never from the
   master domain"), so it needs an explicit decision.

**Needed before Phase 6:**

5. **Broadcast vs routine priority** in the same cap window.
   `app_policy.broadcast_vs_routine_priority` is seeded
   `PLACEHOLDER_AWAITING_CONFIRMATION` with `broadcast_wins_routine_defers`
   (routine defers 30 days). Confirm or change the row before the governor goes live.

**Open:**

6. **What happens to `comms-tracker/`** (live today) once this ships: retire it, merge
   it in, or keep both?
7. **Who sets lifecycle long-term.** Phase 2 makes it lead-only, plus sync jobs. Revisit
   if owners should be able to propose changes.
8. **Finish the Microsoft sign-in setup** (the user, in two dashboards):
   - **Azure, on the "Lyzr Comms Tracker" app registration:**
     - Add the redirect URI `https://srfimixiduliysxngbmd.supabase.co/auth/v1/callback`.
     - Create a client secret for Post-Sales Outreach.
     - Add the `email` optional claim.
   - **Supabase:**
     - Enable the Azure provider with tenant URL
       `https://login.microsoftonline.com/4b1018eb-9480-4542-89d0-4e6233aba226`.
     - Add `http://localhost:3001/**` to Redirect URLs.
     - Point the Before User Created hook at `public.hook_restrict_sign_up`.
   - **If Microsoft says admin approval is needed,** that comes from the reused app's
     pending tenant consent. Either get the consent granted, or register a separate
     sign-in-only app.
9. **Who is the real post-sales lead?** Nobody is promoted automatically.

**Answered:** email content storage (full body plus template version pin). On 2026-09-10:
build in Post-Sales Outreach, collateral as trackable links, send from the app, Skott via
API, Lyzr brand.

---

## comms-tracker — inherited handover

_Last reviewed 2026-09-10._
- **Audit:** docs and code went through three read-only audit passes (UI, data pipeline,
  backend/security), and the top findings were re-checked by hand against the code.
- **Built locally:** the app was installed, built and run here.
- **Live check:** the live site and database were probed read-only, using only the
  public anon key.
- **Not run:** no sync, deploy, migration or `wrangler dev`.

Dropped into this folder on 2026-09-10 as a handover from its previous owner. The full
handover docs are in `comms-tracker/readme/00-…08-` and are more current than
`comms-tracker/README.md`. `08-PROMPT-0.md` is the previous owner's kickoff prompt for
whoever takes over. `deepankar.dimri@lyzr.com` is one of the admins that migration
`015` adds.

### What it is

Internal Lyzr tool. It reconciles **Cortex** (engagement and projects), **HubSpot**
(customer and deal status) and email into one dashboard. The email comes from Instantly
campaigns, HubSpot activity, and each user's connected Gmail/Outlook. It flags projects
**going dark**: no matched email in 15 days, shown in 4 shades, with each account taking
its worst project's shade (`lib/going-dark.ts`). It also drafts the next update with
`claude-sonnet-5`, grounded in a knowledge base. **It never sends.** "Open" builds a
pre-filled Gmail/Outlook compose URL and logs an unconfirmed "sent via app" row, which a
later mailbox read confirms.

### Stack

- Next 16.2 **static export** (`output: "export"`, `basePath: "/abm-tracker"`). The
  browser talks straight to Supabase with the anon key, so RLS is the security boundary.
- One Cloudflare Worker, `worker/index.ts`. It serves `out/` and the `/api/*` routes that
  need a secret, all using the **service-role key**: AI suggest/search/draft, send log,
  Google connect, the Microsoft OAuth start and callback, refresh dispatch, and
  in-process sync.
- **Syncs run on GitHub Actions** (`.github/workflows/comms-tracker-refresh.yml`, daily
  at 18:30 UTC and on dispatch), never inside the Worker, because of its subrequest cap.
  The Refresh buttons only dispatch the workflow.
- Migrations `001`–`015` are pasted into the Supabase SQL Editor one at a time, in order.
  There is no migration runner and no down-migrations. `account_people` is legacy and
  `project_people` replaces it.
- Secrets are set in three places: `.env.local`, `wrangler secret put`, and GitHub
  secrets prefixed `CT_`. What each one is for is in `readme/03`.

### Local build and run (2026-09-10)

```bash
cd comms-tracker
npm ci                # node 26.7 / npm 11.19
npx tsc --noEmit      # 0 errors
npx eslint .          # clean
npx next build        # passes; 11 static routes into out/ (2 MB)
npm run dev           # http://localhost:3000/abm-tracker/
```

- **Dev server:** every route returns 200 and the login page renders "Continue with
  Google".
- **Sign-in:** not tested. It needs `http://localhost:3000/**` in the live Supabase
  project's redirect allowlist, and nobody knows whether it's there.
- **Skipped install scripts:** npm 11 skipped the install scripts for `esbuild`,
  `workerd` and `unrs-resolver`. `wrangler` 4.123 still runs and the `workerd` binary is
  present.
- **Deliberately not run:**
  - `npm run cf:preview` / `wrangler dev`: they would need production secrets copied
    into `.dev.vars`, and their `/api` routes call live services.
  - `scripts/run-*.ts`: they write to the live database.
- **Folder-layout fixes (2026-09-10):**
  - **`comms-tracker/next.config.ts`:** `turbopack: { root: path.resolve(__dirname) }`.
    Without it, Turbopack takes the parent `Post Sales/package-lock.json` as the root,
    resolves the root app's `src/proxy.ts`, and the build fails. **This change is
    uncommitted and unpushed.**
  - **Root `tsconfig.json` and `eslint.config.mjs`:** they now exclude `comms-tracker`
    (see Layout above). The root folder isn't a git repo.

### Live state (probed 2026-09-10, read-only, public anon key)

- **Site:** `https://lyzr.kailash-gm.com/abm-tracker/`, on the previous owner's personal
  domain and Cloudflare account. Every current route returns 200, and the Worker's
  `/api/*` routes exist (they return 401 without sign-in). **The deployed build is
  current.** The "2026-08-19 build missing /projects" note in `comms-tracker/README.md`
  is out of date.
- **Migrations on the live Supabase project** (under the previous owner's account):
  - `011` **not applied**: `communication_events.body_text` is missing.
  - `012` **not applied**: `knowledge_documents.search_tsv` is missing.
  - `014` **not applied**: `is_admin()` and `visible_project_ids()` are absent.
  - `013` and `015` can't be seen over REST; the docs say they are unapplied.
- **Live exposure: all five dashboard views can be read with the public anon key,
  without signing in.** Row counts:
  - `account_last_contact`: 36
  - `account_month_coverage`: 336
  - `project_last_contact`: 21
  - `project_staleness`: 132
  - `account_people_rollup`: 169

  The columns are only UUIDs, timestamps, counts and role keys, with no names, emails or
  bodies. The base tables correctly return 0 rows to anon. The cause is that the views
  aren't `security_invoker` until `014`. A narrow hotfix, without `014`'s change to
  member visibility, is `ALTER VIEW <view> SET (security_invoker = on);` for each of the
  five views. **It has not been applied, and it needs someone with SQL-editor access to
  that project.**
- **Moving off their accounts:** follow `readme/04`. The OAuth apps and third-party keys
  stay the same, and only redirect URIs get added.

### Built, verified against the code

**Verified:**
- Google SSO (with the `hd=lyzr.ai` hint) and the admin/member tiers.
- Account → Projects → Stakeholders, with the manual role-override lock
  (`lib/sync/projects.ts:145-159`).
- Going-dark buckets.
- Generate & Send end to end: 5 suggestions, typed topic plus ranked search with the top
  3 pre-ticked, grounded draft, editable subject and body, compose URL, send log.
- Tasks, with deletion limited to the creator or an admin.
- Needs Review, hidden when empty and read-only.
- Full-email dialog with the snippet fallback.
- Project Roles, Users, and Data & Sync pages.
- Cortex, HubSpot (exact domain match) and Instantly syncs (GET only).
- The internal-domain safety net, in code and via trigger `013`.
- Gmail and Outlook reads.
- Knowledge sources: lyzr.ai, Slack, Drive, Gemini meeting notes, OneDrive delta, siva@
  internal email.

**Partial:**
- **Custom roles** can be created but never display. Only 3 hard-coded keys show up
  (`lib/hooks/use-project-detail.ts:85-87`).
- **Instantly:** if the `ABM` tag isn't found, it syncs the 20 most recent campaigns as
  unclassified. This is logged, not silent (`lib/sync/instantly-sync.ts:57-69`).
- **lyzr.ai re-check:** each run handles 60 pages, the hash covers only the first 6,000
  characters, and a failed summary is never retried. So "re-checked weekly" doesn't
  really hold once the backlog is done.
- **"Sent via app" confirmation** matches recipient and subject only. It isn't scoped to
  the sender and has no time bound.
- **Opening an email from the Review list** works by double-click only, not Enter.
- **Not re-verified:** the PRD's data counts (405 blogs, 199 Drive docs, and so on).

### Code audit: top findings (2026-09-10)

Findings the agents inferred rather than read are marked (inferred).

**Security**, most severe first:
1. **The Worker only checks for a valid Supabase session** (`worker/index.ts:110-121`),
   with no domain, role or visibility check.
   - `hd=lyzr.ai` is only a hint, and `handle_new_user()` gives *any* email a `member`
     row (`001:271-284`, `015:20`). Any Google account can probably sign in, and before
     `014` it can read every table (`001:309-319`, `USING (true)`).
   - The one possible mitigation is a Google consent screen set to "Internal", which
     hasn't been checked.
2. **The sync routes run in-process for any signed-in user:** `/api/sync/*`,
   `/api/knowledge/sync/*` and `/api/mail/sync/*` (`worker/index.ts:481-499`). For
   example, any member can trigger a read of every connected mailbox. Production doesn't
   need these routes, because the workflow runs the scripts directly.
3. **`/api/send/log` writes whatever it is sent** (`worker/index.ts:279-311`). It inserts
   any account, project or person with the service-role key, marks the row `matched`,
   and records no sender. That can fake contact and reset going-dark.
4. **Microsoft OAuth `state` isn't bound to the browser** (`worker/index.ts:380-407`).
   It's `userId.timestamp.hmac`, keyed on the client secret, reusable for 15 minutes,
   and compared in non-constant time. A colleague lured into the flow could have their
   mailbox and Files token stored under the attacker's user.
5. **The AI and refresh routes are open to any signed-in user.** Suggest reveals whether
   a project exists, and Anthropic spend is unbounded.
6. **Still readable by every signed-in user even after `014`:** `people`,
   `account_source_links`, `knowledge_documents`, `ai_generations`, `sync_runs` and
   `users`. Updates to `tasks`/`task_items` also stay open (`001:322-328`), so a member
   could take over a task's `created_by` and then delete it (inferred).
7. **`015` grants admin by exact email match** to @lyzr.com addresses that nobody signs
   in with. That becomes dangerous if email/password sign-up is ever enabled.

**Data correctness:**
8. **Mailbox reads lose email.** The cursor is set to the run start even when the
   300-message cap cut a newest-first read short (`lib/mail/run.ts:252`). Failed message
   downloads are also silently dropped (`lib/mail/google.ts:111`).
9. **OneDrive drops files.** The early-stop check can never trigger
   (`lib/knowledge/onedrive.ts:76`), files beyond the 200-file budget are discarded
   (`:124`), and the delta link still advances (`:157`). Slack and Drive have similar
   cap-versus-cursor problems.
10. **The Cortex sync can crash** on the unescaped `email.ilike` lookup plus
    `.maybeSingle()` (`lib/sync/people.ts:138,145`).
11. **Scheduled runs are logged as `manual`** by every `scripts/run-*.ts`. A run killed
    by the timeout stays `running` forever.
12. **Syncs never retire owners** who changed upstream, so a project collects
    duplicate current owners.
13. **HubSpot re-reads every contact's full email history on every run,** with no 429
    retry. Instantly treats recipient lists as single addresses.

**UI:**
14. **Tracker pill mismatch.** Its colour comes from the worst project, but its "Nd ago"
    label comes from the account's latest email (`lib/hooks/use-data.ts:96-105`,
    `app/(app)/page.tsx:141`).
15. **A new knowledge search replaces earlier, already-ticked results**
    (`components/compose/generate-send-modal.tsx:128`).
16. **`/admin/sync` has no role gate,** so members can click "Refresh all".
17. **Send-log rows don't refresh the timeline,** and their `body_text` is never stored.

### Not built

1. **Microsoft as a sign-in method.** This is different from the existing "Connect
   Outlook". It needs a **product decision before any code**: should Microsoft sign-in
   auto-link that mailbox for reading, or keep that as a separate consent step?
2. Backlog, not requested (raise these before starting any of them):
   - Needs Review has no manual link action.
   - Cortex's richer fields aren't synced: budget, health, dates, and the weekly status
     note.
   - Suspected duplicate Cortex records (Verifone, one WTW project).

### Suggested next steps (awaiting the user's call)

1. **Stop the live metadata leak:** apply the `security_invoker` hotfix to the five
   views, or roll out `014` deliberately. It needs SQL access to the previous owner's
   project.
2. **Decide on the sign-in lock:** confirm whether the Google consent screen is
   "Internal". If it isn't, add a server-side email-domain check (an Auth hook, or both
   the Worker and `handle_new_user()`).
3. **Lock down the Worker:** remove or admin-gate the in-process `/api/*/sync/*` routes,
   scope `/api/send/log` and `/api/ai/suggest` to what the caller can see, and bind the
   Microsoft `state` to the browser.
4. **Fix the data-loss bugs** (8–10) before relying on the mailbox, OneDrive or Cortex
   data.
5. **Commit the `next.config.ts` fix.** Before any push, confirm the "Comms Tracker
   refresh" workflow is disabled on GitHub.
6. **Migrate hosting** to our own Supabase and Cloudflare (`readme/04`).

### Folder and git state (updated 2026-09-10)

1. **The missing files are restored.** When the folder arrived, 16 files were missing
   from disk but intact in the git index: every page under `app/`, plus
   `lib/knowledge/run.ts`, `lib/knowledge/util.ts`, `lib/mail/run.ts`, `lib/mail/types.ts`
   and `lib/supabase/client.ts`. They were restored from the local `.git` without
   overwriting anything. They match the handover commit byte for byte.
2. **The git home is `DDLyzr7/Post-Sales-Comms-Tool`**, over SSH
   (`git@github.com:DDLyzr7/Post-Sales-Comms-Tool.git`). The user chose it as the
   standalone repo from `readme/04` step 1. History on `main`:
   - `9d55355`: the previous owner's "Initial commit: Comms Tracker handover" (120 files,
     no `.env.local`). The copy had lost its branch ref, so it's now the root of `main`
     to keep their authorship.
   - `fadf44c`: the GitHub repo's own one-line README commit.
   - `c4b7e6d`: a merge of the two that keeps comms-tracker's `README.md`. Its files are
     identical to `9d55355`.
   - **Pushed on 2026-09-10** as a plain fast-forward (no force). Local `main` tracks
     `origin/main`. The only uncommitted change since is `next.config.ts` (see above).
   - The user said they would disable the "Comms Tracker refresh" workflow in GitHub
     Actions until the `CT_*` secrets and the Supabase URL are sorted. Confirm that
     before counting on it being off.
3. **Access from this Mac:** the SSH key `~/.ssh/id_ed25519` has no passphrase
   (fingerprint `SHA256:efMiFbp0WgzUDa+EJAe7dJuVQppO4jhRcBrTb61F8Lg`). It is registered
   as a **deploy key with write access on `DDLyzr7/Post-Sales-Comms-Tool` only**. `gh`
   and Homebrew aren't installed. Git identity is set for this repo only:
   `Deepankar Dimri <deepankar.dimri@lyzr.com>`.
4. **`node_modules` is installed** (`npm ci`), and `out/` and `.next/` exist; all three
   are gitignored. See "Local build and run" above.
5. **`.env.local` is present with all 15 keys set** (only the key names were checked).
   It is gitignored and was never staged. These are **live production secrets**: never
   print, commit or copy the values, and refer to them by name only.

### Doc vs code discrepancies found

- **Repo location.** `readme/02` says the code lives in the `kailcodes02-gif/lyzr`
  monorepo. The handover's `.git/config` pointed to a standalone
  `kailcodes02-gif/comms-tracker`. It now lives in `DDLyzr7/Post-Sales-Comms-Tool`.
  `dispatchRefresh()` in `worker/index.ts` still defaults `GH_REPO` to
  `kailcodes02-gif/lyzr`, on `ref: "main"`. **Set the `GH_REPO` Worker var to
  `DDLyzr7/Post-Sales-Comms-Tool` when deploying, or the Refresh buttons will dispatch to
  the old repo.** `readme/04` doesn't mention this.
- **The refresh workflow goes live on push.** `.github/workflows/comms-tracker-refresh.yml`
  runs on a daily schedule (18:30 UTC), so once `main` is on GitHub it runs nightly in
  `DDLyzr7/Post-Sales-Comms-Tool`. Until the `CT_*` secrets exist, it fails without
  doing anything, because the keys are blank. Its `NEXT_PUBLIC_SUPABASE_URL` is still
  hardcoded to the previous owner's project, so change it before adding real secrets.
- **Dead cron handler.** `worker/index.ts` still exports a `scheduled()` cron handler.
  `README.md` and `SETUP_INTEGRATIONS.md` describe a weekly or "Sunday" Worker cron, but
  `wrangler.jsonc` deliberately has no cron trigger. The handler is dead code and those
  docs are stale.
- **In-process sync routes.** `readme/02` says `/api/sync/*`, `/api/knowledge/sync/*`
  and `/api/mail/sync/*` are "called by the GitHub Actions job". They aren't: the
  workflow runs the scripts directly.
- **Outlook consent.** `SETUP_INTEGRATIONS.md` says Outlook needs no tenant-wide admin
  consent and lists only `Mail.Read`. The PRD says it's blocked on exactly that consent,
  and the code requests `Files.Read.All` and `Sites.Read.All` as well.
- **Unused secret.** The comments in `wrangler.jsonc` list
  `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON`, but Drive moved to per-user OAuth and the secret
  is unused.
- **Stale README.** `comms-tracker/README.md` calls internal-email "still scaffolded"
  (the PRD says it's live), says the live Worker is an old build (it isn't), and links a
  plan file on the previous owner's machine (`/Users/apple/.claude/plans/…`). Treat
  `readme/` as authoritative.
- **Sign-in domain lock.** It is only the `hd=lyzr.ai` hint (`app/login/page.tsx:29`) and
  isn't enforced on the server. See audit finding 1.

### Rules when working in `comms-tracker/`

These come from its handover prompt, and they match the global defaults.

- Say what you're about to do, and why, before any of these: pushing git, deploying the
  Worker, applying a migration to a database with real data, or rotating a shared
  credential.
- Never decommission the previous owner's Worker, Supabase project or repo. That call is
  the user's, made after they've verified the new setup.
- Get the Microsoft sign-in product decision before building it. Raise any backlog item
  before starting it.
- When a doc is wrong compared with the code, fix the doc and say so. Don't quietly work
  around it.
- Never run `scripts/run-*.ts` or the `/api/*/sync/*` routes casually: they write to the
  live production database.
