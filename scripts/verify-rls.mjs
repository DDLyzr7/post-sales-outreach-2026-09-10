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

    // user_metadata is editable by the user; it must never grant admin or change
    // the sending address (the 20260910000200 migration closed this).
    await supabase.auth.updateUser({
      data: { is_admin: true, default_role: "pm", warm_sender_address: "spoofed@example.com" },
    });
    const { data: profile } = await supabase
      .from("app_user")
      .select("is_admin, warm_sender_address")
      .eq("id", me.user?.id)
      .maybeSingle();
    check("editing their own metadata does not make them admin", profile?.is_admin === false,
      profile ? `is_admin=${profile.is_admin}` : "no profile row");
    check("editing their own metadata does not change their sending address",
      !!profile && profile.warm_sender_address !== "spoofed@example.com",
      profile ? profile.warm_sender_address : "no profile row");
    const { data: stillVisible } = await supabase.from("account").select("name");
    check("still sees only their own accounts afterwards",
      (stillVisible ?? []).length === expected.accounts.length, `${(stillVisible ?? []).length} account(s)`);
    await supabase.auth.updateUser({ data: { is_admin: null, default_role: null, warm_sender_address: null } });
  }

  await supabase.auth.signOut();
}

// Phase 4 drafting guards (20260911000100). A signed-in user writes only their own
// drafting-stage rows: no faked sends, no edits to sent history, no marking an
// opted-out contact's email ready. Test rows use a "verify-rls:" subject and the
// lead deletes them at the end.
{
  const PRIYA = "44444444-0000-4000-8000-000000000101"; // Northwind, engaged
  const SANA = "44444444-0000-4000-8000-000000000103"; // Northwind, engaged
  const NADIA = "44444444-0000-4000-8000-000000000301"; // Brightline, Riya's other account
  const KOFI = "44444444-0000-4000-8000-000000000501"; // Juniper, not Riya's
  const COBALT = "11111111-0000-4000-8000-000000000004";
  const PETER = "44444444-0000-4000-8000-000000000402"; // Cobalt, opted out
  const SENT_EMAIL = "77777777-0000-4000-8000-000000000001"; // Riya's sent email to Priya
  const TAG = "verify-rls:";

  async function session(email) {
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`sign in ${email}: ${error.message}`);
    return { client, id: data.user.id };
  }

  const draftRow = (accountId, contactId, senderId, extra = {}) => ({
    account_id: accountId,
    contact_id: contactId,
    sender_id: senderId,
    email_type: "product_update",
    send_path: "warm",
    subject: `${TAG} draft`,
    body_text: "Test draft written by scripts/verify-rls.mjs.",
    ...extra,
  });

  console.log("\nDrafting guards (Phase 4)");
  const riya = await session("pm@example.com");
  const elena = await session("csm@example.com");
  const marcus = await session("cal@example.com");
  const lead = await session("lead@example.com");

  // Leftovers from an interrupted run.
  await lead.client.from("email_activity").delete().like("subject", `${TAG}%`);

  const sendsNow = async () =>
    (await riya.client.from("account_overview").select("sends_this_month").eq("account_id", NORTHWIND).single())
      .data?.sends_this_month;
  const sendsBefore = await sendsNow();

  const { data: draft, error: draftError } = await riya.client
    .from("email_activity")
    .insert(draftRow(NORTHWIND, PRIYA, riya.id))
    .select("id")
    .single();
  check("owner can save a draft on their own account", !draftError,
    draftError
      ? draftError.code === "23505"
        ? "Riya already has an open draft for Priya Raman; discard it in the app and re-run"
        : draftError.message
      : "saved");

  const { error: dupError } = await riya.client.from("email_activity").insert(draftRow(NORTHWIND, PRIYA, riya.id));
  check("a second open draft for the same contact is refused", dupError?.code === "23505",
    dupError ? dupError.message : "SAVED A DUPLICATE");

  const { error: fakeSendError } = await riya.client
    .from("email_activity")
    .insert(draftRow(NORTHWIND, SANA, riya.id, { status: "sent", sent_at: new Date().toISOString() }));
  check("cannot insert a fake sent email", !!fakeSendError, fakeSendError ? fakeSendError.message : "INSERTED");

  if (draft) {
    const { error: toSentError } = await riya.client
      .from("email_activity")
      .update({ status: "sent", sent_at: new Date().toISOString() })
      .eq("id", draft.id);
    check("cannot mark their own draft as sent", !!toSentError, toSentError ? toSentError.message : "MARKED SENT");
  }

  // Writes the subject back unchanged, so the seeded history is safe even if the
  // guard were missing. The trigger refuses the write whatever it changes.
  const { data: sentEmail } = await riya.client.from("email_activity").select("subject").eq("id", SENT_EMAIL).single();
  const { data: editedSent, error: editSentError } = await riya.client
    .from("email_activity")
    .update({ subject: sentEmail?.subject ?? "unchanged" })
    .eq("id", SENT_EMAIL)
    .select("id");
  check("cannot edit an email that was already sent", !!editSentError || !editedSent?.length,
    editSentError ? editSentError.message : `EDITED ${editedSent?.length ?? 0} row(s)`);

  const { error: otherAccountError } = await riya.client.from("email_activity").insert(draftRow(JUNIPER, KOFI, riya.id));
  check("cannot draft on another owner's account", !!otherAccountError,
    otherAccountError ? otherAccountError.message : "INSERTED");

  const { error: spoofError } = await riya.client.from("email_activity").insert(draftRow(NORTHWIND, SANA, elena.id));
  check("cannot write a draft under a teammate's name", !!spoofError, spoofError ? spoofError.message : "INSERTED");

  const { error: mismatchError } = await riya.client.from("email_activity").insert(draftRow(NORTHWIND, NADIA, riya.id));
  check("cannot address a draft to a contact on a different account", !!mismatchError,
    mismatchError ? mismatchError.message : "INSERTED");

  if (draft) {
    const { data: coOwnerEdit, error: coOwnerError } = await elena.client
      .from("email_activity")
      .update({ subject: `${TAG} edited by co-owner` })
      .eq("id", draft.id)
      .select("id");
    check("a co-owner cannot edit someone else's draft", !!coOwnerError || !coOwnerEdit?.length,
      coOwnerError ? coOwnerError.message : `EDITED ${coOwnerEdit?.length ?? 0} row(s)`);

    const { error: readyError } = await riya.client
      .from("email_activity")
      .update({ status: "approved", approved_by: elena.id })
      .eq("id", draft.id);
    const { data: readyRow } = await riya.client
      .from("email_activity")
      .select("status, approved_by")
      .eq("id", draft.id)
      .single();
    check("marking ready records the author, not a name sent by the client",
      !readyError && readyRow?.status === "approved" && readyRow?.approved_by === riya.id,
      readyError ? readyError.message : `status=${readyRow?.status}, approved_by is ${readyRow?.approved_by === riya.id ? "Riya" : "SOMEONE ELSE"}`);

    const { error: editReadyError } = await riya.client
      .from("email_activity")
      .update({ subject: `${TAG} edited while ready` })
      .eq("id", draft.id);
    check("cannot edit an email marked ready without moving it back to draft", !!editReadyError,
      editReadyError ? editReadyError.message : "EDITED");

    check("drafts don't count toward the monthly cap", (await sendsNow()) === sendsBefore,
      `sends_this_month ${sendsBefore} -> ${await sendsNow()}`);

    const { error: cancelError } = await riya.client
      .from("email_activity")
      .update({ status: "cancelled" })
      .eq("id", draft.id);
    const { error: reopenError } = await riya.client
      .from("email_activity")
      .update({ status: "drafted" })
      .eq("id", draft.id);
    check("a discarded draft stays discarded", !cancelError && !!reopenError,
      cancelError ? cancelError.message : reopenError ? reopenError.message : "REOPENED");
  }

  const { data: optedOutDraft, error: optedOutInsertError } = await marcus.client
    .from("email_activity")
    .insert(draftRow(COBALT, PETER, marcus.id))
    .select("id")
    .single();
  if (optedOutInsertError) {
    check("cannot mark an opted-out contact's email ready", false, `setup failed: ${optedOutInsertError.message}`);
  } else {
    const { error: optedOutReadyError } = await marcus.client
      .from("email_activity")
      .update({ status: "approved" })
      .eq("id", optedOutDraft.id);
    check("cannot mark an opted-out contact's email ready", !!optedOutReadyError,
      optedOutReadyError ? optedOutReadyError.message : "MARKED READY");
  }

  const { data: optIn, error: optInError } = await marcus.client
    .from("contact")
    .update({ is_opted_out: false })
    .eq("id", PETER)
    .select("id");
  check("an owner cannot clear a contact's opt-out", !!optInError || !optIn?.length,
    optInError ? optInError.message : `CLEARED on ${optIn?.length ?? 0} row(s)`);
  if (!optInError && optIn?.length) {
    await lead.client.from("contact").update({ is_opted_out: true, opted_out_at: new Date().toISOString() }).eq("id", PETER);
  }

  const { error: cleanupError } = await lead.client.from("email_activity").delete().like("subject", `${TAG}%`);
  const { count: leftover } = await lead.client
    .from("email_activity")
    .select("id", { count: "exact", head: true })
    .like("subject", `${TAG}%`);
  check("test drafts cleaned up", !cleanupError && leftover === 0,
    cleanupError ? cleanupError.message : `${leftover ?? "?"} left`);

  for (const s of [riya, elena, marcus, lead]) await s.client.auth.signOut();
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
