"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { writeDraft } from "@/lib/ai/draft-email";
import { reviewDraft } from "@/lib/ai/draft-review";
import { MODEL } from "@/lib/ai/client";
import { getCurrentUser } from "@/lib/db/queries";
import { getDraft, getDraftingSubject, UUID, type DraftingSubject } from "@/lib/db/drafts";
import { firstName, FUNCTION_LABEL } from "@/lib/format";
import { emailTypeFor, loadPolicies, resolveSendPath, type Policies } from "@/lib/policy";
import { blockers, draftDigest, runPresendChecks } from "@/lib/presend";
import { createClient } from "@/lib/supabase/server";
import { fillTemplate } from "@/lib/template";
import type { AppUser, DraftContext, DraftReview, SendPath } from "@/lib/types";

/**
 * Drafting actions. Nothing is sent from here: the furthest a draft goes is
 * 'approved', which means the owner marked it ready.
 *
 * Postgres is the boundary. RLS limits drafts to accounts the caller can see, and
 * app.guard_email_activity_write lets a signed-in user write only their own
 * drafting-stage rows, refuses to mark an opted-out contact's email ready and
 * stamps who marked it. These actions validate input, run the pre-send rules so
 * the owner gets a clear reason, and turn database errors into sentences.
 */

export type DraftActionState = { error: string | null; notice: string | null };

const MAX_INSTRUCTION = 500;
const MAX_SUBJECT = 300;
const MAX_BODY = 20_000;

function fail(error: string): DraftActionState {
  return { error, notice: null };
}

function explain(err: { code?: string; message: string }): string {
  if (err.code === "23505") return "You already have an open draft for this contact.";
  if (err.code === "42501") {
    return err.message.startsWith("new row violates")
      ? "You can't write drafts on that account."
      : err.message;
  }
  return `Not saved: ${err.message}`;
}

function refresh(accountId: string, draftId?: string) {
  revalidatePath(`/accounts/${accountId}`);
  revalidatePath("/drafts");
  if (draftId) revalidatePath(`/drafts/${draftId}`);
}

function readInstruction(formData: FormData): string | null {
  const text = String(formData.get("instruction") ?? "").trim();
  return text ? text.slice(0, MAX_INSTRUCTION) : null;
}

function sendPathFor(
  routing: Policies["sendPathRouting"],
  contactType: "engaged" | "committee",
  isFriendAccount: boolean,
): SendPath {
  return resolveSendPath(routing, {
    email_type: emailTypeFor(contactType, isFriendAccount),
    contact_type: contactType,
  });
}

/** The template with every known fact filled in, for when Claude is unavailable. */
function templateDraft(subject: DraftingSubject, sender: AppUser): { subject: string; body: string } {
  const { contact, account, template } = subject;
  const inUse = subject.products.filter((p) => p.in_use);
  // For an update, the product in use that's meant for this person's function.
  const featured =
    contact.type === "engaged"
      ? (inUse.find((p) => p.target_functions.includes(contact.business_function)) ?? inUse[0])
      : null;
  const productName = subject.crossSell?.product_name ?? featured?.name ?? null;
  const persona = `${contact.business_function}:${contact.type}`;
  const collateral =
    subject.collateral.find((c) => c.personas.includes(persona) && (!productName || c.product_names.includes(productName))) ??
    subject.collateral.find((c) => c.personas.includes(persona)) ??
    null;
  // "HR" and "IT" stay capitalised; "Operations" reads as "operations" mid-sentence.
  const teams = [
    ...new Set(
      subject.engagedContacts.map((c) => {
        const label = FUNCTION_LABEL[c.business_function];
        return label.length <= 2 ? label : label.toLowerCase();
      }),
    ),
  ];

  const values: Record<string, string | null> = {
    contact_first_name: firstName(contact.full_name),
    account_name: account.name,
    sender_first_name: firstName(sender.full_name),
    sender_full_name: sender.full_name,
    product_name: productName,
    value_prop: subject.crossSell?.value_prop ?? featured?.value_prop ?? null,
    collateral_title: collateral?.title ?? null,
    existing_team: teams.length > 1 ? `${teams.slice(0, -1).join(", ")} and ${teams.at(-1)}` : (teams[0] ?? null),
  };

  if (!template) {
    return {
      subject: "[[subject]]",
      body: `Hi ${values.contact_first_name},\n\n[[message]]\n\n${values.sender_first_name}`,
    };
  }
  return {
    subject: fillTemplate(template.subject_template, values),
    body: fillTemplate(template.body_template, values),
  };
}

async function compose(
  subject: DraftingSubject,
  user: AppUser,
  sendPath: SendPath,
  instruction: string | null,
) {
  const written = await writeDraft(subject, user, sendPath, instruction);
  const fallback = written ? null : templateDraft(subject, user);

  const context: DraftContext = {
    source: written ? "claude" : "template",
    model: written ? MODEL : null,
    instruction,
    collateral_ids: written?.collateral_ids ?? [],
    notes_for_owner: written?.notes_for_owner ?? [],
    recent_email_count: subject.pastEmails.length,
    generated_at: new Date().toISOString(),
  };

  return {
    subject: (written?.subject ?? fallback!.subject).slice(0, MAX_SUBJECT),
    body: (written?.body ?? fallback!.body).slice(0, MAX_BODY),
    context,
  };
}

export async function startDraft(_prev: DraftActionState, formData: FormData): Promise<DraftActionState> {
  const accountId = String(formData.get("account_id") ?? "");
  const contactId = String(formData.get("contact_id") ?? "");
  const instruction = readInstruction(formData);
  if (!UUID.test(accountId) || !UUID.test(contactId)) {
    return fail("That contact could not be found. Refresh the page.");
  }

  const user = await getCurrentUser();
  if (!user) return fail("Your session has ended. Sign in again.");

  const supabase = await createClient();

  // The caller's own open draft for this contact, if any. Filtering on sender_id
  // picks out their draft; RLS still decides what they can see at all.
  const findOpen = async () =>
    (
      await supabase
        .from("email_activity")
        .select("id")
        .eq("contact_id", contactId)
        .eq("sender_id", user.id)
        .in("status", ["drafted", "approved"])
        .is("deleted_at", null)
        .is("campaign_id", null)
        .maybeSingle()
    ).data as { id: string } | null;

  const existing = await findOpen();
  if (existing) redirect(`/drafts/${existing.id}`);

  const [subject, policies] = await Promise.all([
    getDraftingSubject(accountId, contactId, instruction),
    loadPolicies(supabase),
  ]);
  if (!subject) return fail("That contact could not be found. Refresh the page.");
  if (subject.contact.is_opted_out) {
    return fail(`${subject.contact.full_name} has opted out, so there's nothing to draft.`);
  }

  const sendPath = sendPathFor(policies.sendPathRouting, subject.contact.type, subject.account.is_friend_account);
  const draft = await compose(subject, user, sendPath, instruction);

  const { data, error } = await supabase
    .from("email_activity")
    .insert({
      account_id: accountId,
      contact_id: contactId,
      sender_id: user.id,
      template_version_id: subject.template?.template_version_id ?? null,
      email_type: subject.emailType,
      send_path: sendPath,
      direction: "outbound",
      status: "drafted",
      subject: draft.subject,
      body_text: draft.body,
      to_email: subject.contact.email,
      from_email: sendPath === "warm" ? user.warm_sender_address : null,
      draft_context: draft.context,
    })
    .select("id")
    .single();

  if (error) {
    // A second click that raced the first lands on the draft the first one made.
    if (error.code === "23505") {
      const raced = await findOpen();
      if (raced) redirect(`/drafts/${raced.id}`);
    }
    return fail(explain(error));
  }

  refresh(accountId);
  redirect(`/drafts/${data.id}`);
}

export async function updateDraft(_prev: DraftActionState, formData: FormData): Promise<DraftActionState> {
  const draftId = String(formData.get("draft_id") ?? "");
  const intent = String(formData.get("intent") ?? "save");
  if (!UUID.test(draftId)) return fail("That draft could not be found. Refresh the page.");
  if (!["save", "ready", "unready", "review"].includes(intent)) return fail("Unknown action.");

  const [user, detail] = await Promise.all([getCurrentUser(), getDraft(draftId)]);
  if (!user) return fail("Your session has ended. Sign in again.");
  if (!detail) return fail("That draft could not be found. It may have been discarded.");
  if (detail.draft.sender_id !== user.id) return fail("Only the person who wrote a draft can change it.");

  const { draft, contact, account } = detail;
  const locked = draft.status === "approved";

  // A draft marked ready is read-only; its saved content is what counts.
  const subjectText = locked
    ? draft.subject
    : String(formData.get("subject") ?? "").trim().slice(0, MAX_SUBJECT);
  const bodyText = locked
    ? (draft.body_text ?? "")
    : String(formData.get("body") ?? "").trim().slice(0, MAX_BODY);

  const supabase = await createClient();
  const policies = await loadPolicies(supabase);
  const sendPath = sendPathFor(policies.sendPathRouting, contact.type, account.is_friend_account);

  const content = locked
    ? {}
    : {
        subject: subjectText,
        body_text: bodyText,
        send_path: sendPath,
        to_email: contact.email,
        from_email: sendPath === "warm" ? user.warm_sender_address : null,
      };

  let status: "drafted" | "approved" = draft.status === "approved" ? "approved" : "drafted";
  let review: DraftReview | null | undefined;
  let notice = "Draft saved.";
  let problem: string | null = null;

  if (intent === "ready") {
    const failing = blockers(
      runPresendChecks({
        contact,
        sendsThisMonth: account.sends_this_month,
        sendPath,
        senderAddress: user.warm_sender_address,
        subject: subjectText,
        body: bodyText,
        daysSinceContactEmailed: detail.daysSinceContactEmailed,
        teammateDraftAuthors: detail.teammateDraftAuthors,
        policies,
      }),
    );
    if (failing.length) {
      problem = `Saved, but not marked ready: ${failing.map((check) => check.label.toLowerCase()).join("; ")}.`;
    } else {
      status = "approved";
      notice = "Marked ready. It will send once sending is switched on.";
    }
  } else if (intent === "unready") {
    status = "drafted";
    notice = "Back to draft. You can edit it again.";
  } else if (intent === "review") {
    const drafting = await getDraftingSubject(account.account_id, contact.id, draft.draft_context?.instruction ?? null);
    if (!drafting) return fail("That contact could not be found. Refresh the page.");
    const result = await reviewDraft(drafting, user, sendPath, detail.collateral, {
      subject: subjectText,
      body: bodyText,
    });
    if (result) {
      review = {
        digest: draftDigest(subjectText, bodyText),
        reviewed_at: new Date().toISOString(),
        ...result,
      };
      notice = result.flags.length ? "Saved and checked. See Claude's notes." : "Saved and checked. No problems found.";
    } else {
      problem = "Saved, but Claude wasn't available to check it. Try again in a minute.";
    }
  } else if (locked) {
    return fail("Move the email back to draft before editing it.");
  }

  // A draft marked ready sends no content changes, so moving it back to draft
  // never trips the guard's "back to draft before editing" rule.
  const { error } = await supabase
    .from("email_activity")
    .update({
      ...content,
      status,
      ...(review !== undefined ? { presend_review: review } : {}),
    })
    .eq("id", draftId);
  if (error) return fail(explain(error));

  refresh(account.account_id, draftId);
  return problem ? fail(problem) : { error: null, notice };
}

export async function redraft(_prev: DraftActionState, formData: FormData): Promise<DraftActionState> {
  const draftId = String(formData.get("draft_id") ?? "");
  const instruction = readInstruction(formData);
  if (!UUID.test(draftId)) return fail("That draft could not be found. Refresh the page.");

  const [user, detail] = await Promise.all([getCurrentUser(), getDraft(draftId)]);
  if (!user) return fail("Your session has ended. Sign in again.");
  if (!detail) return fail("That draft could not be found. It may have been discarded.");
  if (detail.draft.sender_id !== user.id) return fail("Only the person who wrote a draft can change it.");
  if (detail.draft.status === "approved") return fail("Move the email back to draft before redrafting it.");

  const supabase = await createClient();
  const [subject, policies] = await Promise.all([
    getDraftingSubject(detail.account.account_id, detail.contact.id, instruction),
    loadPolicies(supabase),
  ]);
  if (!subject) return fail("That contact could not be found. Refresh the page.");

  const sendPath = sendPathFor(policies.sendPathRouting, subject.contact.type, subject.account.is_friend_account);
  const draft = await compose(subject, user, sendPath, instruction);

  const { error } = await supabase
    .from("email_activity")
    .update({
      subject: draft.subject,
      body_text: draft.body,
      template_version_id: subject.template?.template_version_id ?? null,
      email_type: subject.emailType,
      send_path: sendPath,
      to_email: subject.contact.email,
      from_email: sendPath === "warm" ? user.warm_sender_address : null,
      draft_context: draft.context,
      presend_review: null,
    })
    .eq("id", draftId);
  if (error) return fail(explain(error));

  refresh(detail.account.account_id, draftId);
  return draft.context.source === "claude"
    ? { error: null, notice: "Redrafted." }
    : fail("Claude wasn't available, so this is the template with the known details filled in.");
}

export async function discardDraft(_prev: DraftActionState, formData: FormData): Promise<DraftActionState> {
  const draftId = String(formData.get("draft_id") ?? "");
  if (!UUID.test(draftId)) return fail("That draft could not be found. Refresh the page.");

  const [user, detail] = await Promise.all([getCurrentUser(), getDraft(draftId)]);
  if (!user) return fail("Your session has ended. Sign in again.");
  if (!detail) return fail("That draft could not be found. It may already be discarded.");
  if (detail.draft.sender_id !== user.id) return fail("Only the person who wrote a draft can discard it.");

  const supabase = await createClient();
  const { error } = await supabase
    .from("email_activity")
    .update({ status: "cancelled" })
    .eq("id", draftId);
  if (error) return fail(explain(error));

  refresh(detail.account.account_id, draftId);
  redirect(`/accounts/${detail.account.account_id}`);
}
