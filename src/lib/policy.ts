import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Governance rules live in the public.app_policy table, not in this file.
 * Code reads them; it never hardcodes them. Changing the cap, the send-path
 * routing or the broadcast-vs-routine priority is a data edit, not a deploy.
 */

export type FrequencyCapPolicy = {
  max_sends_per_account_per_month: number;
  warn_at_sends: number;
  window: string;
  counts_send_paths: string[];
  counts_statuses: string[];
  counts_campaign_sends: boolean;
  counts_across_all_senders: boolean;
  /** Email types outside the cap. Broadcasts, since 2026-09-13. */
  excluded_email_types?: string[];
};

export type StalenessPolicy = { warn_days: number; alert_days: number };

export type SendPathRoutingPolicy = {
  default: "warm" | "cold";
  rules: { when: Record<string, string>; path: "warm" | "cold" }[];
  always_show_path_before_send: boolean;
  /** Which provider serves each path. Both are the owner's Microsoft mailbox today. */
  providers?: Record<"warm" | "cold", string>;
};

export type PriorityPolicy = {
  status: string;
  strategy: string;
  broadcast_counts_toward_cap?: boolean;
  broadcast_blocked_by_cap?: boolean;
};

export type SendingMode = "dry_run" | "live" | "paused";

export type SendingPolicy = {
  mode: SendingMode;
  max_attempts: number;
  batch_size: number;
  lock_minutes: number;
  unsubscribe_footer_email_types: string[];
  unsubscribe_footer_text: string;
};

export type EnrichmentPolicy = {
  provider: string;
  who_can_enrich: "owners_and_lead" | "lead_only";
  max_reveals_per_request: number;
  seniorities: string[];
  titles_by_function: Partial<Record<string, string[]>>;
};

export type TargetingPolicy = { renewal_window_days: number };

export type DraftingPolicy = { recent_contact_warn_days: number };

/** Which collateral can go in a client email. Postgres applies the same row. */
export type CollateralPolicy = {
  skott: { type_map: Record<string, string>; retire_min_ratio: number };
  email: { content_types: string[]; link_hosts: string[]; internal_link_hosts: string[] };
};

export type Policies = {
  frequencyCap: FrequencyCapPolicy;
  staleness: StalenessPolicy;
  sendPathRouting: SendPathRoutingPolicy | null;
  priority: PriorityPolicy | null;
  targeting: TargetingPolicy;
  drafting: DraftingPolicy;
  sending: SendingPolicy;
  enrichment: EnrichmentPolicy;
  collateral: CollateralPolicy;
};

const FALLBACK: Pick<Policies, "frequencyCap" | "staleness" | "targeting" | "drafting" | "sending" | "enrichment" | "collateral"> = {
  // Without the policy row, no Skott item is client-shareable (Postgres agrees).
  collateral: {
    skott: { type_map: {}, retire_min_ratio: 0.5 },
    email: { content_types: [], link_hosts: [], internal_link_hosts: ["sharepoint.com"] },
  },
  targeting: { renewal_window_days: 90 },
  drafting: { recent_contact_warn_days: 14 },
  frequencyCap: {
    max_sends_per_account_per_month: 2,
    warn_at_sends: 1,
    window: "calendar_month",
    counts_send_paths: ["warm", "cold"],
    counts_statuses: ["sent", "opened", "replied", "bounced"],
    counts_campaign_sends: false,
    counts_across_all_senders: true,
    excluded_email_types: ["launch_broadcast"],
  },
  staleness: { warn_days: 30, alert_days: 60 },
  // Without the policy row, nothing sends.
  sending: {
    mode: "paused",
    max_attempts: 3,
    batch_size: 25,
    lock_minutes: 10,
    unsubscribe_footer_email_types: [],
    unsubscribe_footer_text: "",
  },
  enrichment: {
    provider: "apollo",
    who_can_enrich: "lead_only",
    max_reveals_per_request: 10,
    seniorities: ["c_suite", "vp", "head"],
    titles_by_function: {},
  },
};

export async function loadPolicies(supabase: SupabaseClient): Promise<Policies> {
  const { data } = await supabase.from("app_policy").select("key, value");
  const byKey = new Map((data ?? []).map((row) => [row.key as string, row.value]));

  return {
    frequencyCap: (byKey.get("frequency_cap") as FrequencyCapPolicy) ?? FALLBACK.frequencyCap,
    staleness: (byKey.get("staleness_thresholds") as StalenessPolicy) ?? FALLBACK.staleness,
    sendPathRouting: (byKey.get("send_path_routing") as SendPathRoutingPolicy) ?? null,
    priority: (byKey.get("broadcast_vs_routine_priority") as PriorityPolicy) ?? null,
    targeting: (byKey.get("targeting_rules") as TargetingPolicy) ?? FALLBACK.targeting,
    drafting: (byKey.get("drafting_rules") as DraftingPolicy) ?? FALLBACK.drafting,
    sending: (byKey.get("sending") as SendingPolicy) ?? FALLBACK.sending,
    enrichment: (byKey.get("enrichment_rules") as EnrichmentPolicy) ?? FALLBACK.enrichment,
    collateral: (byKey.get("collateral_rules") as CollateralPolicy) ?? FALLBACK.collateral,
  };
}

export type Staleness = "never" | "alert" | "warn" | "current";

export function stalenessOf(days: number | null, policy: StalenessPolicy): Staleness {
  if (days === null) return "never";
  if (days >= policy.alert_days) return "alert";
  if (days >= policy.warn_days) return "warn";
  return "current";
}

/** Sort order for the owner dashboard: neglected accounts float to the top. */
export const STALENESS_RANK: Record<Staleness, number> = {
  never: 0, alert: 1, warn: 2, current: 3,
};

/**
 * The kind of routine email a contact gets. A friend account is not a customer
 * yet, so even its engaged contacts get the friend-account type, which the
 * routing policy sends down the cold path. Without this, an engaged contact at a
 * friend account would route warm and put a non-customer conversation on our
 * real sending domain.
 */
export function emailTypeFor(
  contactType: "engaged" | "committee",
  isFriendAccount: boolean,
): "product_update" | "cross_sell_intro" | "friend_account" {
  if (isFriendAccount) return "friend_account";
  return contactType === "engaged" ? "product_update" : "cross_sell_intro";
}

/**
 * Resolves the send path from the routing policy rather than from a hardcoded
 * branch. The account page shows the answer, and drafts store it. At send time
 * app.resolve_send_path() in Postgres resolves it again from the same policy, and
 * that answer is the one that counts.
 */
export function resolveSendPath(
  policy: SendPathRoutingPolicy | null,
  input: { email_type: string; contact_type: string },
): "warm" | "cold" {
  if (!policy) return "cold";
  for (const rule of policy.rules) {
    const matches = Object.entries(rule.when).every(
      ([key, value]) => input[key as keyof typeof input] === value,
    );
    if (matches) return rule.path;
  }
  return policy.default;
}
