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

// Phases 5-7 (20260913000100-300): the send queue, mailbox tokens, broadcasts,
// reports and unsubscribe links. Needs app_policy.sending.mode = 'dry_run' or
// 'live'. Test rows use the same "verify-rls:" subject and are removed at the end.
{
  const TAG = "verify-rls:";
  const TOM = "44444444-0000-4000-8000-000000000102"; // Northwind, engaged, Riya + Elena
  const PRIYA = "44444444-0000-4000-8000-000000000101"; // Northwind, engaged
  const SANA = "44444444-0000-4000-8000-000000000103"; // Northwind, engaged

  async function session(email) {
    const client = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`sign in ${email}: ${error.message}`);
    return { client, id: data.user.id };
  }

  console.log("\nSending, broadcasts and reports (Phases 5-7)");
  const riya = await session("pm@example.com");
  const elena = await session("csm@example.com");
  const lead = await session("lead@example.com");

  const cleanup = async () => {
    const { data: campaigns } = await lead.client.from("campaign").select("id").like("name", `${TAG}%`);
    const ids = (campaigns ?? []).map((c) => c.id);
    if (ids.length) await lead.client.from("email_activity").delete().in("campaign_id", ids);
    await lead.client.from("email_activity").delete().like("subject", `${TAG}%`);
    if (ids.length) await lead.client.from("campaign").delete().in("id", ids);
  };
  await cleanup();

  const { data: sendingPolicy } = await lead.client.from("app_policy").select("value").eq("key", "sending").maybeSingle();
  const mode = sendingPolicy?.value?.mode;
  check("sending policy exists and isn't paused", mode === "dry_run" || mode === "live", `mode=${mode}`);

  const readyDraft = async (who, contactId) => {
    const { data, error } = await who.client
      .from("email_activity")
      .insert({
        account_id: NORTHWIND, contact_id: contactId, sender_id: who.id, email_type: "product_update",
        send_path: "warm", subject: `${TAG} send`, body_text: "Test email written by scripts/verify-rls.mjs.",
      })
      .select("id")
      .single();
    if (error) throw new Error(`draft setup: ${error.message}`);
    const { error: readyError } = await who.client.from("email_activity").update({ status: "approved" }).eq("id", data.id);
    if (readyError) throw new Error(`ready setup: ${readyError.message}`);
    return data.id;
  };
  const slots = async () => {
    const { data } = await lead.client.from("account_overview").select("sends_this_month").eq("account_id", NORTHWIND).single();
    const { count } = await lead.client.from("email_activity").select("id", { count: "exact", head: true })
      .eq("account_id", NORTHWIND).eq("status", "queued").neq("email_type", "launch_broadcast");
    return (data?.sends_this_month ?? 0) + (count ?? 0);
  };

  const riyaEmail = await readyDraft(riya, TOM);

  const { error: directQueue } = await riya.client.from("email_activity").update({ status: "queued" }).eq("id", riyaEmail);
  check("cannot queue an email by writing status directly", !!directQueue, directQueue ? directQueue.message : "QUEUED");

  const { error: elenaSendsRiya } = await elena.client.rpc("send_email", { p_email_id: riyaEmail });
  check("a co-owner cannot send someone else's email", !!elenaSendsRiya, elenaSendsRiya ? elenaSendsRiya.message : "SENT");

  const { error: broadcastType } = await riya.client.from("email_activity").insert({
    account_id: NORTHWIND, contact_id: SANA, sender_id: riya.id, email_type: "launch_broadcast",
    send_path: "warm", subject: `${TAG} fake broadcast`, body_text: "x",
  });
  check("cannot write a draft typed as a broadcast (to dodge the cap)", !!broadcastType,
    broadcastType ? broadcastType.message : "INSERTED");

  // Fill Northwind up to the cap, then one more must be refused.
  const cap = 2;
  const before = await slots();
  let queuedByRiya = null;
  if (before < cap) {
    const { data: decision, error: sendError } = await riya.client.rpc("send_email", { p_email_id: riyaEmail });
    check("owner can send their own ready email (it queues)", !sendError && !!decision,
      sendError ? sendError.message : `mode=${decision?.mode}, slots ${before} -> ${await slots()}`);
    queuedByRiya = sendError ? null : riyaEmail;
  }
  while ((await slots()) < cap) {
    const filler = await readyDraft(elena, SANA);
    const { error } = await elena.client.rpc("send_email", { p_email_id: filler });
    if (error) break;
  }
  const overCap = await readyDraft(elena, PRIYA);
  const { error: capError } = await elena.client.rpc("send_email", { p_email_id: overCap });
  check("the monthly cap refuses a send once sent + queued reach it", !!capError && /this month/.test(capError.message),
    capError ? capError.message : "SENT OVER THE CAP");

  if (queuedByRiya) {
    const { error: stopError } = await riya.client.rpc("cancel_queued_email", { p_email_id: queuedByRiya });
    const { data: stopped } = await riya.client.from("email_activity").select("status").eq("id", queuedByRiya).single();
    check("the author can stop a queued email before it sends", !stopError && stopped?.status === "approved",
      stopError ? stopError.message : `status=${stopped?.status}`);
  }

  const { data: tokens, error: tokenError } = await riya.client.from("mailbox_token").select("user_id");
  check("mailbox tokens can't be read by a signed-in user", !!tokenError || (tokens ?? []).length === 0,
    tokenError ? tokenError.message : `${(tokens ?? []).length} rows`);

  const { error: foreignMailbox } = await riya.client.rpc("save_mailbox_connection", {
    p_email_address: "someone.else@example.com", p_ciphertext: "v1.x.y.z", p_scopes: ["Mail.Send"],
  });
  check("cannot connect a mailbox that isn't your own address", !!foreignMailbox,
    foreignMailbox ? foreignMailbox.message : "CONNECTED");

  const { error: claimError } = await riya.client.rpc("claim_send_batch", { p_limit: 1 });
  check("a signed-in user cannot run the send job's claim", !!claimError, claimError ? claimError.message : "CLAIMED");

  const { error: ownerPreview } = await riya.client.rpc("preview_campaign_audience", { p_audience: {} });
  check("an owner cannot preview a broadcast audience", !!ownerPreview, ownerPreview ? ownerPreview.message : "PREVIEWED");

  const { data: ownerCampaign, error: ownerCampaignError } = await riya.client
    .from("campaign").insert({ name: `${TAG} owner broadcast` }).select("id");
  check("an owner cannot create a broadcast", !!ownerCampaignError || !ownerCampaign?.length,
    ownerCampaignError ? ownerCampaignError.message : "CREATED");

  // The lead launches a broadcast to engaged contacts at existing customers.
  const sendsBefore = (await lead.client.from("account_overview").select("sends_this_month").eq("account_id", NORTHWIND).single()).data?.sends_this_month;
  const { data: campaign, error: campaignError } = await lead.client
    .from("campaign")
    .insert({
      name: `${TAG} broadcast`, subject: `${TAG} broadcast for {{account_name}}`,
      body_text: "Hi {{contact_first_name}}, test broadcast from {{sender_first_name}}.",
      audience: { lifecycle: ["existing"], contact_types: ["engaged"] },
    })
    .select("id")
    .single();
  check("the lead can create a broadcast", !campaignError, campaignError?.message ?? "created");

  if (campaign) {
    const { data: preview } = await lead.client.rpc("preview_campaign_audience", {
      p_audience: { lifecycle: ["existing"], contact_types: ["engaged"] },
    });
    const peter = (preview ?? []).find((r) => r.contact_id === "44444444-0000-4000-8000-000000000402");
    check("the audience preview skips an opted-out contact with the reason", peter?.skip_reason === "opted_out",
      `Peter Vance: ${peter?.skip_reason ?? "not in preview"}`);

    const { error: ownerLaunch } = await riya.client.rpc("launch_campaign", { p_campaign_id: campaign.id });
    check("an owner cannot launch a broadcast", !!ownerLaunch, ownerLaunch ? ownerLaunch.message : "LAUNCHED");

    const { data: launched, error: launchError } = await lead.client.rpc("launch_campaign", { p_campaign_id: campaign.id });
    check("the lead can launch it", !launchError && launched?.queued > 0,
      launchError ? launchError.message : `queued ${launched?.queued}, skipped ${launched?.skipped}`);

    const { data: rows } = await lead.client.from("email_activity")
      .select("subject, status, sender_id, unsubscribe_token, contact_id").eq("campaign_id", campaign.id);
    const northwind = (rows ?? []).find((r) => r.subject?.includes("Northwind Logistics"));
    check("merge fields are filled per recipient", !!northwind && !(rows ?? []).some((r) => r.subject.includes("{{")),
      northwind?.subject ?? "no Northwind row");

    const sendsAfter = (await lead.client.from("account_overview").select("sends_this_month").eq("account_id", NORTHWIND).single()).data?.sends_this_month;
    check("broadcasts don't count toward the monthly cap", sendsAfter === sendsBefore, `sends_this_month ${sendsBefore} -> ${sendsAfter}`);

    const { error: editLaunched } = await lead.client.from("campaign").update({ subject: `${TAG} rewritten` }).eq("id", campaign.id);
    check("a launched broadcast can't be rewritten", !!editLaunched, editLaunched ? editLaunched.message : "EDITED");

    const { data: riyaSees } = await riya.client.from("email_activity").select("account_id").eq("campaign_id", campaign.id);
    const riyaAccounts = new Set((riyaSees ?? []).map((r) => r.account_id));
    check("owners see broadcast rows only on their own accounts",
      [...riyaAccounts].every((a) => ["11111111-0000-4000-8000-000000000001", "11111111-0000-4000-8000-000000000003", "11111111-0000-4000-8000-000000000007"].includes(a)),
      `${riyaSees?.length ?? 0} rows on ${riyaAccounts.size} account(s)`);

    // Unsubscribe by link, as the anon key: a real token opts that one contact out.
    const target = (rows ?? []).find((r) => r.status === "queued" && r.unsubscribe_token);
    if (target) {
      const anonClient = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: bogus } = await anonClient.rpc("opt_out_by_token", { p_token: "00000000-0000-4000-8000-000000000000" });
      const { data: optedEmail, error: optError } = await anonClient.rpc("opt_out_by_token", { p_token: target.unsubscribe_token });
      const { data: contactAfter } = await lead.client.from("contact").select("is_opted_out").eq("id", target.contact_id).single();
      check("an unsubscribe link opts out its one contact, and a made-up token does nothing",
        bogus === null && !optError && !!optedEmail && contactAfter?.is_opted_out === true,
        optError ? optError.message : `bogus=${bogus}, opted out=${contactAfter?.is_opted_out}`);
      await lead.client.from("contact").update({ is_opted_out: false }).eq("id", target.contact_id);
    }

    const { data: cancelled, error: cancelError } = await lead.client.rpc("cancel_campaign", { p_campaign_id: campaign.id });
    check("the lead can cancel a running broadcast", !cancelError, cancelError ? cancelError.message : `cancelled ${cancelled?.cancelled}`);
  }

  const { data: riyaReport, error: reportError } = await riya.client.rpc("report_people", { p_weeks: 4 });
  check("an owner's report has only their own row", !reportError && (riyaReport ?? []).length === 1 && riyaReport[0].user_id === riya.id,
    reportError ? reportError.message : `${(riyaReport ?? []).length} row(s)`);
  const { data: leadReport } = await lead.client.rpc("report_people", { p_weeks: 4 });
  check("the lead's report covers the team", (leadReport ?? []).length >= 3, `${(leadReport ?? []).length} row(s)`);

  await cleanup();
  const { count: leftover } = await lead.client.from("email_activity").select("id", { count: "exact", head: true }).like("subject", `${TAG}%`);
  check("sending test rows cleaned up", leftover === 0, `${leftover ?? "?"} left`);

  for (const s of [riya, elena, lead]) await s.client.auth.signOut();
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
