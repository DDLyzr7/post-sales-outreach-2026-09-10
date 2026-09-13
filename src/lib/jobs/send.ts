import type { SupabaseClient } from "@supabase/supabase-js";
import type { SendingPolicy, SendPathRoutingPolicy } from "@/lib/policy";
import type { SendProvider } from "@/lib/providers";
import { dryRunProvider, microsoftGraphProvider } from "@/lib/providers/send";

/**
 * The send job. Claims due queued emails, re-checks each one at the moment of
 * sending, and records the result. Runs on the service-role key with no JWT
 * subject, so it is the only writer of sent_at and the delivery fields.
 *
 * Re-checked here, because time passes between Send and the job:
 *   - sending mode (paused stops everything; dry_run contacts nobody)
 *   - the contact's opt-out (invariant 7)
 *   - a broadcast that was cancelled meanwhile
 * The monthly cap is not re-checked: a queued email already holds its slot.
 */

type QueuedEmail = {
  id: string;
  account_id: string;
  contact_id: string | null;
  sender_id: string | null;
  campaign_id: string | null;
  email_type: string;
  send_path: "warm" | "cold";
  subject: string;
  body_text: string | null;
  to_email: string | null;
  send_attempts: number;
  unsubscribe_token: string | null;
  governor_decision: Record<string, unknown> | null;
};

export type SendJobSummary = {
  mode: string;
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  skipped: number;
  campaignsCompleted: number;
};

async function policyRow<T>(service: SupabaseClient, key: string): Promise<T | null> {
  const { data } = await service.from("app_policy").select("value").eq("key", key).maybeSingle();
  return (data?.value as T) ?? null;
}

export function withUnsubscribeFooter(
  email: Pick<QueuedEmail, "email_type" | "body_text" | "unsubscribe_token">,
  sending: SendingPolicy,
  baseUrl: string | null,
): string {
  const body = email.body_text ?? "";
  if (!sending.unsubscribe_footer_email_types?.includes(email.email_type) || !email.unsubscribe_token || !baseUrl) {
    return body;
  }
  const url = `${baseUrl.replace(/\/$/, "")}/unsubscribe/${email.unsubscribe_token}`;
  const line = (sending.unsubscribe_footer_text || "Unsubscribe: {{unsubscribe_url}}").replace("{{unsubscribe_url}}", url);
  return `${body.trimEnd()}\n\n--\n${line}`;
}

export async function runSendJob(service: SupabaseClient): Promise<SendJobSummary> {
  const [sending, routing] = await Promise.all([
    policyRow<SendingPolicy>(service, "sending"),
    policyRow<SendPathRoutingPolicy>(service, "send_path_routing"),
  ]);
  const mode = sending?.mode ?? "paused";
  const summary: SendJobSummary = { mode, claimed: 0, sent: 0, retrying: 0, failed: 0, skipped: 0, campaignsCompleted: 0 };
  if (!sending || mode === "paused") return summary;

  const baseUrl = process.env.APP_BASE_URL ?? null;
  const { data: claimed, error: claimError } = await service.rpc("claim_send_batch", { p_limit: sending.batch_size ?? 25 });
  if (claimError) throw new Error(`claim_send_batch: ${claimError.message}`);
  const emails = (claimed ?? []) as QueuedEmail[];
  summary.claimed = emails.length;
  if (!emails.length) return summary;

  const providers: Record<string, SendProvider> = {
    dry_run: dryRunProvider,
    microsoft_graph: microsoftGraphProvider(service),
  };

  // Contacts and campaigns for the whole batch in two reads.
  const contactIds = [...new Set(emails.map((e) => e.contact_id).filter((id): id is string => !!id))];
  const campaignIds = [...new Set(emails.map((e) => e.campaign_id).filter((id): id is string => !!id))];
  const [{ data: contacts }, { data: campaigns }] = await Promise.all([
    service.from("contact").select("id, full_name, email, is_opted_out, deleted_at").in("id", contactIds.length ? contactIds : ["00000000-0000-0000-0000-000000000000"]),
    campaignIds.length
      ? service.from("campaign").select("id, status").in("id", campaignIds)
      : Promise.resolve({ data: [] as { id: string; status: string }[] }),
  ]);
  const contactById = new Map((contacts ?? []).map((c) => [c.id as string, c]));
  const campaignById = new Map((campaigns ?? []).map((c) => [c.id as string, c]));

  const finish = (email: QueuedEmail, patch: Record<string, unknown>) =>
    service.from("email_activity").update({ locked_at: null, ...patch }).eq("id", email.id).eq("status", "queued");

  for (const email of emails) {
    const contact = email.contact_id ? contactById.get(email.contact_id) : undefined;
    const campaign = email.campaign_id ? campaignById.get(email.campaign_id) : undefined;
    const decision = email.governor_decision ?? {};
    const skip = async (reason: string) => {
      summary.skipped += 1;
      await finish(email, {
        status: "cancelled",
        governor_decision: { ...decision, skip_reason: reason, skipped_at: new Date().toISOString() },
      });
    };

    if (campaign && campaign.status === "cancelled") { await skip("cancelled_by_lead"); continue; }
    if (!contact || contact.deleted_at) { await skip("contact_removed"); continue; }
    if (contact.is_opted_out) { await skip("opted_out_before_send"); continue; }
    if (!email.sender_id || !contact.email) { await skip(!contact.email ? "no_email" : "no_sender"); continue; }

    // An email queued in dry run stays a dry run, and nothing is live while the mode is dry run.
    const providerName =
      mode === "dry_run" || decision.provider === "dry_run"
        ? "dry_run"
        : (routing?.providers?.[email.send_path] ?? "microsoft_graph");
    const provider = providers[providerName];
    const body = withUnsubscribeFooter(email, sending, baseUrl);

    if (!provider) {
      summary.failed += 1;
      await finish(email, { status: "failed", error_message: `No send provider called "${providerName}".` });
      continue;
    }
    if (providerName !== "dry_run" && sending.unsubscribe_footer_email_types?.includes(email.email_type) && !baseUrl) {
      summary.failed += 1;
      await finish(email, { status: "failed", error_message: "APP_BASE_URL isn't set, so the unsubscribe link can't be built." });
      continue;
    }

    const result = await provider.send({
      emailActivityId: email.id,
      senderId: email.sender_id,
      toEmail: contact.email,
      toName: contact.full_name,
      subject: email.subject,
      bodyText: body,
    });

    if (result.ok) {
      summary.sent += 1;
      await finish(email, {
        status: "sent",
        sent_at: result.sentAt,
        provider: result.provider,
        provider_message_id: result.providerMessageId,
        provider_thread_id: result.providerThreadId,
        to_email: contact.email,
        body_text: body,
        error_message: null,
      });
    } else if (result.retryable && email.send_attempts < (sending.max_attempts ?? 3)) {
      summary.retrying += 1;
      // Back off 5, 10, 15... minutes between attempts.
      const retryAt = new Date(Date.now() + email.send_attempts * 5 * 60_000).toISOString();
      await finish(email, { error_message: result.error.slice(0, 1000), scheduled_for: retryAt });
    } else {
      summary.failed += 1;
      await finish(email, { status: "failed", provider: result.provider, error_message: result.error.slice(0, 1000) });
    }
  }

  // A broadcast is complete when nothing of it is left in the queue.
  for (const campaignId of campaignIds) {
    const { count } = await service
      .from("email_activity")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaignId)
      .eq("status", "queued");
    if (count === 0) {
      const { data } = await service
        .from("campaign")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", campaignId)
        .in("status", ["running", "scheduled"])
        .select("id");
      summary.campaignsCompleted += data?.length ?? 0;
    } else {
      await service.from("campaign").update({ status: "running" }).eq("id", campaignId).eq("status", "scheduled");
    }
  }

  return summary;
}
