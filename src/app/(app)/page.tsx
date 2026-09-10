import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, listMyAccounts } from "@/lib/db/queries";
import { loadPolicies, stalenessOf, STALENESS_RANK } from "@/lib/policy";
import { Badge, Card, EmptyState, HEALTH_TONE, LIFECYCLE_TONE } from "@/components/ui";
import {
  EMAIL_STATUS_LABEL, EMAIL_TYPE_LABEL, LIFECYCLE_LABEL, ROLE_SHORT, TIER_LABEL, formatArr,
  formatDate, relativeDays,
} from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();
  const [user, accounts, policies] = await Promise.all([
    getCurrentUser(),
    listMyAccounts(),
    loadPolicies(supabase),
  ]);

  const cap = policies.frequencyCap.max_sends_per_account_per_month;

  // Neglected accounts first - the problem this system exists to solve.
  const sorted = [...accounts].sort((a, b) => {
    const rank =
      STALENESS_RANK[stalenessOf(a.days_since_last_send, policies.staleness)] -
      STALENESS_RANK[stalenessOf(b.days_since_last_send, policies.staleness)];
    return rank !== 0 ? rank : a.name.localeCompare(b.name);
  });

  const needsAttention = sorted.filter(
    (a) => stalenessOf(a.days_since_last_send, policies.staleness) !== "current",
  ).length;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">My accounts</h1>
          <p className="mt-1 text-sm text-muted">
            {user?.is_admin
              ? "You are the post-sales lead, so every account is listed."
              : "Every account you are assigned to. The list is scoped by row-level security in Postgres, not by this page."}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Badge>{accounts.length} accounts</Badge>
          {needsAttention > 0 ? (
            <Badge tone="warn">{needsAttention} need attention</Badge>
          ) : null}
        </div>
      </div>

      <Card className="mt-6 overflow-hidden">
        {sorted.length === 0 ? (
          <div className="p-6">
            <EmptyState>
              No accounts are assigned to you. Ask the post-sales lead for an assignment.
            </EmptyState>
          </div>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-muted text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Account</th>
                <th className="px-4 py-2.5 font-medium">Health</th>
                <th className="px-4 py-2.5 font-medium">My role</th>
                <th className="px-4 py-2.5 font-medium">Contacts</th>
                <th className="px-4 py-2.5 font-medium">Last activity</th>
                <th className="px-4 py-2.5 font-medium">This month</th>
                <th className="px-4 py-2.5 font-medium">Renewal</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((a) => {
                const staleness = stalenessOf(a.days_since_last_send, policies.staleness);
                const atCap = a.sends_this_month >= cap;
                return (
                  <tr key={a.account_id} className="border-b border-line last:border-b-0 align-top">
                    <td className="px-4 py-3">
                      <Link
                        href={`/accounts/${a.account_id}`}
                        className="font-medium hover:text-accent"
                      >
                        {a.name}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        <span className="text-xs text-muted">{TIER_LABEL[a.tier]}</span>
                        <span className="text-xs text-muted">&middot; {formatArr(a.arr_cents)}</span>
                        {/* Existing customers are the norm; only call out the exceptions. */}
                        {a.lifecycle_status !== "existing" ? (
                          <Badge tone={LIFECYCLE_TONE[a.lifecycle_status]}>
                            {LIFECYCLE_LABEL[a.lifecycle_status].toLowerCase()}
                          </Badge>
                        ) : null}
                        {a.is_friend_account ? <Badge tone="cold">friend</Badge> : null}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={HEALTH_TONE[a.health_status]}>
                        {a.health_status === "unknown" ? "unknown" : a.health_status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {a.viewer_role ? ROLE_SHORT[a.viewer_role] : "admin"}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">
                      {a.engaged_contact_count} engaged / {a.committee_contact_count} committee
                    </td>
                    <td className="px-4 py-3">
                      {a.last_sent_at ? (
                        <>
                          <div className="text-xs">
                            {EMAIL_TYPE_LABEL[a.last_email_type!]} to {a.last_contact_name ?? "-"}
                          </div>
                          <div className="mt-0.5 text-xs text-muted">
                            {relativeDays(a.days_since_last_send)}
                            {a.last_status ? ` (${EMAIL_STATUS_LABEL[a.last_status]})` : ""}
                            {a.last_sender_name ? ` · ${a.last_sender_name}` : ""}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-muted">no sends logged</span>
                      )}
                      {staleness !== "current" ? (
                        <div className="mt-1">
                          <Badge tone={staleness === "warn" ? "warn" : "bad"}>
                            {staleness === "never"
                              ? "never contacted"
                              : staleness === "alert"
                                ? `${policies.staleness.alert_days}+ days quiet`
                                : `${policies.staleness.warn_days}+ days quiet`}
                          </Badge>
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs ${atCap ? "font-medium text-bad" : "text-muted"}`}>
                        {a.sends_this_month} of {cap}
                      </span>
                      <div className="mt-1 flex w-16 gap-1" aria-hidden>
                        {Array.from({ length: cap }).map((_, i) => (
                          <span
                            key={i}
                            className={`h-1.5 flex-1 rounded-full ${
                              i < a.sends_this_month
                                ? atCap
                                  ? "bg-bad"
                                  : "bg-accent"
                                : "bg-line-strong"
                            }`}
                          />
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted">{formatDate(a.renewal_date)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted">
        Last activity and the monthly count are read from <code>email_activity</code> on every
        request. Neither is stored on the account row, so the two can never drift apart.
      </p>
    </div>
  );
}
