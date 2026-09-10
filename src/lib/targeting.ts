import { relativeDays } from "@/lib/format";
import { stalenessOf, type Policies } from "@/lib/policy";
import type { AccountOverview } from "@/lib/types";

/**
 * Sorts each account into the "My targets" group that says what it needs next.
 *
 * Every threshold comes from app_policy - the monthly cap, the staleness
 * windows and the renewal window. This file only decides the order the rules
 * are checked in: lifecycle first, then the cap (nothing else matters if we
 * cannot send), then renewal, then silence.
 */
export type TargetBucket =
  | "win_back" | "going_quiet" | "renewal" | "warm_up" | "at_cap" | "on_track";

export type Target = {
  bucket: TargetBucket;
  reason: string;
  daysToRenewal: number | null;
};

export type TargetRow = { account: AccountOverview; target: Target };

/** Display order on the page, most urgent first. */
export const TARGET_BUCKETS: { key: TargetBucket; title: string; blurb: (p: Policies) => string }[] = [
  {
    key: "win_back",
    title: "Win back",
    blurb: () => "Churned accounts. Reach out when something they cared about has shipped.",
  },
  {
    key: "going_quiet",
    title: "Going quiet",
    blurb: (p) => `Existing customers with no email in ${p.staleness.warn_days} days or more, or none at all.`,
  },
  {
    key: "renewal",
    title: "Renewal coming up",
    blurb: (p) => `Existing customers renewing in the next ${p.targeting.renewal_window_days} days.`,
  },
  {
    key: "warm_up",
    title: "Warm up",
    blurb: () => "Prospects and friend accounts that are not customers yet.",
  },
  {
    key: "at_cap",
    title: "At the monthly cap",
    blurb: (p) =>
      `Already sent ${p.frequencyCap.max_sends_per_account_per_month} emails this month. They open up again on the 1st.`,
  },
  {
    key: "on_track",
    title: "On track",
    blurb: (p) => `Emailed within the last ${p.staleness.warn_days} days. Nothing due.`,
  },
];

const DAY_MS = 86_400_000;

function daysUntil(isoDate: string | null, today: Date): number | null {
  if (!isoDate) return null;
  const [year, month, day] = isoDate.slice(0, 10).split("-").map(Number);
  const target = Date.UTC(year, month - 1, day);
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((target - start) / DAY_MS);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function targetOf(account: AccountOverview, policies: Policies, today = new Date()): Target {
  const days = account.days_since_last_send;
  const lastEmail = days === null ? "never emailed from the app" : `last email ${relativeDays(days)}`;
  const cap = policies.frequencyCap.max_sends_per_account_per_month;
  const toRenewal = daysUntil(account.renewal_date, today);

  if (account.lifecycle_status === "churned") {
    return { bucket: "win_back", reason: `Churned, ${lastEmail}`, daysToRenewal: null };
  }

  if (account.lifecycle_status === "prospect") {
    const kind = account.is_friend_account ? "Friend account" : "Prospect";
    return { bucket: "warm_up", reason: `${kind}, ${lastEmail}`, daysToRenewal: null };
  }

  if (account.sends_this_month >= cap) {
    return {
      bucket: "at_cap",
      reason: `${account.sends_this_month} of ${cap} emails sent this month`,
      daysToRenewal: toRenewal,
    };
  }

  if (toRenewal !== null && toRenewal >= 0 && toRenewal <= policies.targeting.renewal_window_days) {
    return {
      bucket: "renewal",
      reason: `Renews in ${toRenewal} day${toRenewal === 1 ? "" : "s"}, ${lastEmail}`,
      daysToRenewal: toRenewal,
    };
  }

  if (stalenessOf(days, policies.staleness) !== "current") {
    return { bucket: "going_quiet", reason: capitalise(lastEmail), daysToRenewal: toRenewal };
  }

  return { bucket: "on_track", reason: capitalise(lastEmail), daysToRenewal: toRenewal };
}

/** Soonest renewal first; everywhere else the longest silence first. */
export function compareTargets(a: TargetRow, b: TargetRow): number {
  if (a.target.bucket === "renewal" && b.target.bucket === "renewal") {
    const byRenewal = (a.target.daysToRenewal ?? 0) - (b.target.daysToRenewal ?? 0);
    if (byRenewal !== 0) return byRenewal;
  } else {
    // Never emailed counts as the longest silence.
    const silenceA = a.account.days_since_last_send ?? Number.POSITIVE_INFINITY;
    const silenceB = b.account.days_since_last_send ?? Number.POSITIVE_INFINITY;
    if (silenceA !== silenceB) return silenceB - silenceA;
  }
  return a.account.name.localeCompare(b.account.name);
}
