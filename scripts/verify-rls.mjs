#!/usr/bin/env node
/**
 * Proves the visibility rule is enforced by Postgres, not by the UI.
 *
 * Signs in as each seeded user with the PUBLIC anon key - the same key the
 * browser holds - and queries `account` directly, with no owner filter in the
 * query. Whatever comes back is what RLS allows. Also checks that reading
 * another owner's account by id returns nothing.
 *
 *   npm run db:verify-rls
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const password = process.env.SEED_USER_PASSWORD ?? "PostSales!2026";

if (!url || !anonKey || url.startsWith("https://YOUR-")) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.");
  process.exit(1);
}

const EXPECTED = [
  {
    email: "pm@example.com",
    who: "Riya Kapoor (PM)",
    accounts: ["Brightline Retail", "Meridian Travel Co.", "Northwind Logistics"],
  },
  { email: "cal@example.com", who: "Marcus Webb (CAL)", accounts: ["Cobalt Financial", "Halcyon Energy", "Vertex Health Group"] },
  { email: "csm@example.com", who: "Elena Ortiz (CSM)", accounts: ["Juniper Media", "Northwind Logistics", "Vertex Health Group"] },
  {
    email: "lead@example.com",
    who: "Dana Whitfield (post-sales lead)",
    accounts: [
      "Brightline Retail", "Cobalt Financial", "Halcyon Energy", "Juniper Media",
      "Meridian Travel Co.", "Northwind Logistics", "Tidewater Foods", "Vertex Health Group",
    ],
  },
];

const JUNIPER = "11111111-0000-4000-8000-000000000005"; // Elena's account, not Riya's
const NORTHWIND = "11111111-0000-4000-8000-000000000001"; // Riya's own account
const TIDEWATER = "11111111-0000-4000-8000-000000000008"; // unassigned

let failures = 0;
function check(label, ok, detail) {
  console.log(`${ok ? "  PASS" : "  FAIL"}  ${label}${detail ? ` -> ${detail}` : ""}`);
  if (!ok) failures += 1;
}

for (const expected of EXPECTED) {
  const supabase = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { error: authError } = await supabase.auth.signInWithPassword({
    email: expected.email,
    password,
  });
  if (authError) {
    console.log(`\n${expected.who}`);
    check("sign in", false, authError.message);
    continue;
  }

  console.log(`\n${expected.who}`);

  // No .eq() on any owner column: the filter is entirely RLS's doing.
  const { data, error } = await supabase.from("account").select("name").order("name");
  if (error) {
    check("select accounts", false, error.message);
    continue;
  }

  const names = data.map((r) => r.name);
  check(
    `sees exactly ${expected.accounts.length} account(s)`,
    JSON.stringify(names) === JSON.stringify(expected.accounts),
    names.join(", ") || "(none)",
  );

  // Contacts and email activity must be scoped by the same rule.
  const { count: contactCount } = await supabase
    .from("contact")
    .select("id", { count: "exact", head: true });
  const { data: leaked } = await supabase
    .from("contact")
    .select("account_id, account:account(name)")
    .limit(1000);
  const leakedNames = [...new Set((leaked ?? []).map((r) => r.account?.name).filter(Boolean))];
  check(
    "contacts are limited to visible accounts",
    leakedNames.every((n) => expected.accounts.includes(n)),
    `${contactCount ?? 0} contacts across ${leakedNames.length} account(s)`,
  );

  // Direct id lookup of someone else's account must return nothing.
  const shouldBeBlind = !expected.accounts.includes("Juniper Media");
  const { data: direct } = await supabase
    .from("account")
    .select("name")
    .eq("id", JUNIPER)
    .maybeSingle();
  if (shouldBeBlind) {
    check("direct fetch of an unassigned account returns nothing", direct === null,
      direct ? `LEAKED ${direct.name}` : "null");
  }

  // Phase 2 write guards: only the post-sales lead changes lifecycle or owners.
  // An owner is refused even on their own account.
  if (expected.email !== "lead@example.com") {
    const { data: me } = await supabase.auth.getUser();

    if (expected.accounts.includes("Northwind Logistics")) {
      const { data: changed, error: lifecycleError } = await supabase
        .from("account")
        .update({ lifecycle_status: "churned" })
        .eq("id", NORTHWIND)
        .select("id");
      check("cannot change lifecycle, even on their own account", !!lifecycleError,
        lifecycleError ? lifecycleError.message : `CHANGED ${changed?.length ?? 0} row(s)`);
      if (!lifecycleError && changed?.length) {
        await supabase.from("account").update({ lifecycle_status: "existing" }).eq("id", NORTHWIND);
      }
    }

    const { error: assignError } = await supabase.rpc("assign_account_owner", {
      p_account_id: TIDEWATER,
      p_user_id: me.user?.id,
      p_role: "pm",
      p_is_primary: false,
    });
    check("cannot make themselves owner of an unassigned account", !!assignError,
      assignError ? assignError.message : "ASSIGNED");
  }

  await supabase.auth.signOut();
}

// The anon key with no session must see nothing at all.
{
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await anon.from("account").select("name");
  console.log("\nUnauthenticated (anon key only)");
  check("sees no accounts", !!error || (data ?? []).length === 0,
    error ? error.message : `${(data ?? []).length} rows`);
}

console.log(failures === 0 ? "\nAll RLS checks passed." : `\n${failures} RLS check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
