import { createClient } from "@/lib/supabase/server";
import type { AccountLifecycle, AccountTier, ContactType, EmailStatus, HealthStatus, SendPath } from "@/lib/types";

/**
 * Reads for broadcasts. Campaigns are readable by every teammate (Phase 1 RLS);
 * the recipients behind them are email_activity rows, scoped by account access.
 * Audience preview runs preview_campaign_audience(), which only the lead may call.
 */

export type Audience = {
  lifecycle?: AccountLifecycle[];
  tiers?: AccountTier[];
  health?: HealthStatus[];
  product_keys?: string[];
  contact_types?: ContactType[];
};

export type Campaign = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "scheduled" | "running" | "completed" | "cancelled";
  subject: string;
  body_text: string;
  audience: Audience;
  scheduled_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AudienceRow = {
  account_id: string;
  account_name: string;
  contact_id: string;
  contact_name: string;
  contact_email: string | null;
  contact_type: ContactType;
  sender_id: string | null;
  sender_name: string | null;
  from_email: string | null;
  send_path: SendPath;
  skip_reason: string | null;
};

export type CampaignRecipient = {
  id: string;
  account_id: string;
  account_name: string;
  contact_name: string;
  sender_name: string | null;
  status: EmailStatus;
  send_path: SendPath;
  sent_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  provider: string | null;
  error_message: string | null;
  skip_reason: string | null;
};

const CAMPAIGN_FIELDS =
  "id, name, description, status, subject, body_text, audience, scheduled_at, started_at, completed_at, cancelled_at, created_at, updated_at";

export const CAMPAIGN_STATUS: Record<string, { label: string; tone: "neutral" | "accent" | "ok" | "warn" | "bad" }> = {
  draft: { label: "Draft", tone: "neutral" },
  scheduled: { label: "Scheduled", tone: "accent" },
  running: { label: "Sending", tone: "accent" },
  completed: { label: "Completed", tone: "ok" },
  cancelled: { label: "Cancelled", tone: "bad" },
};

export const SKIP_REASON_LABEL: Record<string, string> = {
  opted_out: "Opted out",
  opted_out_before_send: "Opted out before it sent",
  no_email: "No email address",
  no_owner: "Account has no owner",
  no_sender: "No sender",
  owner_mailbox_not_connected: "Owner's mailbox not connected",
  cancelled_by_lead: "Broadcast cancelled",
  contact_removed: "Contact removed",
};

export async function listCampaigns(): Promise<Campaign[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("campaign")
    .select(CAMPAIGN_FIELDS)
    .eq("email_type", "launch_broadcast")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as Campaign[];
}

export async function getCampaign(id: string): Promise<Campaign | null> {
  const supabase = await createClient();
  const { data } = await supabase.from("campaign").select(CAMPAIGN_FIELDS).eq("id", id).is("deleted_at", null).maybeSingle();
  return (data as Campaign) ?? null;
}

export async function previewAudience(audience: Audience): Promise<{ rows: AudienceRow[]; error: string | null }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_campaign_audience", { p_audience: audience });
  return { rows: (data ?? []) as AudienceRow[], error: error?.message ?? null };
}

export async function listCampaignRecipients(campaignId: string): Promise<CampaignRecipient[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("email_activity")
    .select(
      "id, account_id, status, send_path, sent_at, replied_at, bounced_at, provider, error_message, governor_decision, account:account(name), contact:contact(full_name), sender:app_user!email_activity_sender_id_fkey(full_name)",
    )
    .eq("campaign_id", campaignId)
    .is("deleted_at", null)
    .order("created_at");
  if (error) throw error;

  type Row = Omit<CampaignRecipient, "account_name" | "contact_name" | "sender_name" | "skip_reason"> & {
    governor_decision: { skip_reason?: string } | null;
    account: { name: string } | null;
    contact: { full_name: string } | null;
    sender: { full_name: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map(({ account, contact, sender, governor_decision, ...row }) => ({
    ...row,
    account_name: account?.name ?? "Unknown account",
    contact_name: contact?.full_name ?? "Unknown contact",
    sender_name: sender?.full_name ?? null,
    skip_reason: governor_decision?.skip_reason ?? null,
  }));
}

export async function listProductOptions(): Promise<{ key: string; name: string }[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("product")
    .select("key, name")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("sort_order");
  return (data ?? []) as { key: string; name: string }[];
}

/** The body as one recipient would read it. Mirrors app.merge_broadcast(). */
export function mergeBroadcast(text: string, row: Pick<AudienceRow, "contact_name" | "account_name" | "sender_name">): string {
  return text
    .replaceAll("{{contact_first_name}}", row.contact_name.split(" ")[0] ?? "")
    .replaceAll("{{account_name}}", row.account_name)
    .replaceAll("{{sender_first_name}}", (row.sender_name ?? "").split(" ")[0] ?? "")
    .replaceAll("{{sender_full_name}}", row.sender_name ?? "");
}
