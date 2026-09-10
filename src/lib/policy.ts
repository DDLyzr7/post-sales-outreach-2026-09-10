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
};

export type StalenessPolicy = { warn_days: number; alert_days: number };

export type SendPathRoutingPolicy = {
  default: "warm" | "cold";
  rules: { when: Record<string, string>; path: "warm" | "cold" }[];
  always_show_path_before_send: boolean;
};

export type PriorityPolicy = {
  status: string;
  strategy: string;
  ranks: Record<string, number>;
  on_conflict: string;
  defer_window_days: number;
  allow_owner_override_with_reason: boolean;
};

export type TargetingPolicy = { renewal_window_days: number };

export type Policies = {
  frequencyCap: FrequencyCapPolicy;
  staleness: StalenessPolicy;
  sendPathRouting: SendPathRoutingPolicy | null;
  priority: PriorityPolicy | null;
  targeting: TargetingPolicy;
};

const FALLBACK: Pick<Policies, "frequencyCap" | "staleness" | "targeting"> = {
  targeting: { renewal_window_days: 90 },
  frequencyCap: {
    max_sends_per_account_per_month: 2,
    warn_at_sends: 1,
    window: "calendar_month",
    counts_send_paths: ["warm", "cold"],
    counts_statuses: ["sent", "opened", "replied", "bounced"],
    counts_campaign_sends: true,
    counts_across_all_senders: true,
  },
  staleness: { warn_days: 30, alert_days: 60 },
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
 * Resolves the send path from the routing policy rather than from a hardcoded
 * branch. Phase 3's send flow calls the same function; Phase 1 only displays
 * the answer, so the sender can see which path a compose would take.
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
