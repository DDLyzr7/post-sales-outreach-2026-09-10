import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, listMyAccounts } from "@/lib/db/queries";
import { loadPolicies } from "@/lib/policy";
import {
  TARGET_BUCKETS, compareTargets, targetOf, type TargetBucket, type TargetRow,
} from "@/lib/targeting";
import { Badge, Card, EmptyState, LIFECYCLE_TONE } from "@/components/ui";
import { LIFECYCLE_LABEL, TIER_LABEL, formatArr, formatDate } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TargetsPage() {
  const supabase = await createClient();
  const [user, accounts, policies] = await Promise.all([
    getCurrentUser(),
    listMyAccounts(),
    loadPolicies(supabase),
  ]);

  const cap = policies.frequencyCap.max_sends_per_account_per_month;

  const groups = new Map<TargetBucket, TargetRow[]>();
  for (const account of accounts) {
    const row = { account, target: targetOf(account, policies) };
    const list = groups.get(row.target.bucket) ?? [];
    list.push(row);
    groups.set(row.target.bucket, list);
  }
  for (const list of groups.values()) list.sort(compareTargets);

  const waiting = (groups.get("on_track")?.length ?? 0) + (groups.get("at_cap")?.length ?? 0);
  const toReach = accounts.length - waiting;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">My targets</h1>
          <p className="mt-1 text-sm text-muted">
            {user?.is_admin
              ? "Every account, grouped by what it needs next. As the post-sales lead you see all of them."
              : "The accounts you own, grouped by what each one needs next."}
          </p>
        </div>
        <Badge tone={toReach > 0 ? "warn" : "ok"}>
          {toReach} to reach out to
        </Badge>
      </div>

      {accounts.length === 0 ? (
        <div className="mt-6">
          <EmptyState>
            You don&apos;t own any accounts yet. Ask the post-sales lead to add you as an owner.
          </EmptyState>
        </div>
      ) : (
        <>
          <nav aria-label="Target groups" className="mt-5 flex flex-wrap gap-2">
            {TARGET_BUCKETS.map(({ key, title }) => {
              const count = groups.get(key)?.length ?? 0;
              return (
                <a
                  key={key}
                  href={`#${key}`}
                  className={`rounded-md border px-2.5 py-1 text-xs ${
                    count
                      ? "border-line-strong bg-surface hover:border-accent"
                      : "pointer-events-none border-line text-muted"
                  }`}
                >
                  {title} <span className="ml-1 text-muted">{count}</span>
                </a>
              );
            })}
          </nav>

          {TARGET_BUCKETS.map(({ key, title, blurb }) => {
            const rows = groups.get(key) ?? [];
            if (rows.length === 0) return null;
            return (
              <section key={key} id={key} className="mt-8 scroll-mt-6">
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <h2 className="text-sm font-semibold">
                    {title} <span className="font-normal text-muted">{rows.length}</span>
                  </h2>
                  <p className="text-xs text-muted">{blurb(policies)}</p>
                </div>

                <Card className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[780px] border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-line bg-surface-muted text-left text-[11px] uppercase tracking-wide text-muted">
                        <th className="px-4 py-2.5 font-medium">Account</th>
                        <th className="px-4 py-2.5 font-medium">Status</th>
                        <th className="px-4 py-2.5 font-medium">Why now</th>
                        <th className="px-4 py-2.5 font-medium">Primary owner</th>
                        <th className="px-4 py-2.5 font-medium">This month</th>
                        <th className="px-4 py-2.5 font-medium">Renewal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map(({ account: a, target }) => (
                        <tr key={a.account_id} className="border-b border-line align-top last:border-b-0">
                          <td className="px-4 py-3">
                            <Link href={`/accounts/${a.account_id}`} className="font-medium hover:text-accent">
                              {a.name}
                            </Link>
                            <div className="mt-0.5 text-xs text-muted">
                              {TIER_LABEL[a.tier]} &middot; {formatArr(a.arr_cents)}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1.5">
                              <Badge tone={LIFECYCLE_TONE[a.lifecycle_status]}>
                                {LIFECYCLE_LABEL[a.lifecycle_status]}
                              </Badge>
                              {a.is_friend_account ? <Badge tone="cold">friend</Badge> : null}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-xs">{target.reason}</td>
                          <td className="px-4 py-3 text-xs">
                            {a.primary_owner_name ? (
                              a.primary_owner_name
                            ) : a.owner_count === 0 ? (
                              <Badge tone="warn">no owner</Badge>
                            ) : (
                              <span className="text-muted">no primary set</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <span className={a.sends_this_month >= cap ? "font-medium text-bad" : "text-muted"}>
                              {a.sends_this_month} of {cap}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-muted">{formatDate(a.renewal_date)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
