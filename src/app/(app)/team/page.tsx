import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getCurrentUser, listAssignments, listMyAccounts, listTeammates,
} from "@/lib/db/queries";
import { loadPolicies, stalenessOf } from "@/lib/policy";
import { Badge, Card, EmptyState, LIFECYCLE_TONE } from "@/components/ui";
import { AddOwnerForm, LifecycleForm, RemoveOwnerButton } from "@/components/owner-forms";
import { LIFECYCLE_LABEL, ROLE_SHORT, formatDate, relativeDays } from "@/lib/format";
import type { Assignment, Teammate } from "@/lib/types";

export const dynamic = "force-dynamic";

const LIFECYCLE_ORDER = { existing: 0, churned: 1, prospect: 2 } as const;

type Coverage = {
  teammate: Teammate;
  owned: number;
  current: number;
  quiet: number;
  never: number;
};

export default async function TeamPage() {
  const supabase = await createClient();
  const [user, accounts, assignments, teammates, policies] = await Promise.all([
    getCurrentUser(),
    listMyAccounts(),
    listAssignments(),
    listTeammates(),
    loadPolicies(supabase),
  ]);

  // A convenience gate, not the boundary: RLS already scopes every read, and
  // Postgres refuses every write on this page from anyone but the lead.
  if (!user?.is_admin) notFound();

  const ownersByAccount = new Map<string, Assignment[]>();
  for (const assignment of assignments) {
    const list = ownersByAccount.get(assignment.account_id) ?? [];
    list.push(assignment);
    ownersByAccount.set(assignment.account_id, list);
  }

  const accountById = new Map(accounts.map((a) => [a.account_id, a]));

  const coverage: Coverage[] = teammates
    .map((teammate) => {
      const owned = new Set(
        assignments.filter((a) => a.user_id === teammate.id).map((a) => a.account_id),
      );
      let current = 0;
      let quiet = 0;
      let never = 0;
      for (const accountId of owned) {
        const account = accountById.get(accountId);
        if (!account) continue;
        const staleness = stalenessOf(account.days_since_last_send, policies.staleness);
        if (staleness === "current") current += 1;
        else if (staleness === "never") never += 1;
        else quiet += 1;
      }
      return { teammate, owned: owned.size, current, quiet, never };
    })
    // The lead sees every account by policy; list them only if they also own some.
    .filter((row) => row.owned > 0 || !row.teammate.is_admin)
    .sort((a, b) => b.owned - a.owned || a.teammate.full_name.localeCompare(b.teammate.full_name));

  const unassigned = accounts.filter((a) => a.owner_count === 0).length;
  const assignable = teammates.filter((t) => !t.is_admin);

  const sortedAccounts = [...accounts].sort(
    (a, b) =>
      Number(a.owner_count > 0) - Number(b.owner_count > 0) ||
      LIFECYCLE_ORDER[a.lifecycle_status] - LIFECYCLE_ORDER[b.lifecycle_status] ||
      a.name.localeCompare(b.name),
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Team coverage</h1>
          <p className="mt-1 text-sm text-muted">
            Who owns each account, and whether their accounts are hearing from us. Owner and
            lifecycle changes apply as soon as you save them.
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          <Badge>{accounts.length} accounts</Badge>
          {unassigned > 0 ? <Badge tone="warn">{unassigned} without an owner</Badge> : null}
        </div>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Coverage by person</h2>
        <p className="mt-0.5 text-xs text-muted">
          Emailed recently means within {policies.staleness.warn_days} days. Quiet is{" "}
          {policies.staleness.warn_days} days or more.
        </p>
        <Card className="mt-2 overflow-x-auto">
          {coverage.length === 0 ? (
            <div className="p-6">
              <EmptyState>No teammates yet.</EmptyState>
            </div>
          ) : (
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-4 py-2.5 font-medium">Person</th>
                  <th className="px-4 py-2.5 font-medium">Accounts owned</th>
                  <th className="px-4 py-2.5 font-medium">Emailed recently</th>
                  <th className="px-4 py-2.5 font-medium">Quiet</th>
                  <th className="px-4 py-2.5 font-medium">Never emailed</th>
                  <th className="px-4 py-2.5 font-medium">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {coverage.map(({ teammate, owned, current, quiet, never }) => {
                  const pct = owned ? Math.round((current / owned) * 100) : null;
                  return (
                    <tr key={teammate.id} className="border-b border-line align-top last:border-b-0">
                      <td className="px-4 py-3">
                        <div className="font-medium">{teammate.full_name}</div>
                        <div className="mt-0.5 text-xs text-muted">{teammate.title ?? teammate.email}</div>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{owned}</td>
                      <td className="px-4 py-3 tabular-nums">{current}</td>
                      <td className={`px-4 py-3 tabular-nums ${quiet ? "text-warn" : ""}`}>{quiet}</td>
                      <td className={`px-4 py-3 tabular-nums ${never ? "text-bad" : ""}`}>{never}</td>
                      <td className="px-4 py-3">
                        {pct === null ? (
                          <span className="text-xs text-muted">owns no accounts</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className="w-9 text-xs tabular-nums">{pct}%</span>
                            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-line-strong" aria-hidden>
                              <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
                            </span>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </Card>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold">Accounts and owners</h2>
        <p className="mt-0.5 text-xs text-muted">
          Accounts without an owner are listed first. An owner sees the account, its contacts and
          its emails; removing them hides it straight away.
        </p>
        <Card className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[1040px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-line bg-surface-muted text-left text-[11px] uppercase tracking-wide text-muted">
                <th className="px-4 py-2.5 font-medium">Account</th>
                <th className="px-4 py-2.5 font-medium">Owners</th>
                <th className="px-4 py-2.5 font-medium">Add an owner</th>
                <th className="px-4 py-2.5 font-medium">Lifecycle</th>
              </tr>
            </thead>
            <tbody>
              {sortedAccounts.map((a) => {
                const owners = ownersByAccount.get(a.account_id) ?? [];
                return (
                  <tr key={a.account_id} className="border-b border-line align-top last:border-b-0">
                    <td className="px-4 py-3">
                      <Link href={`/accounts/${a.account_id}`} className="font-medium hover:text-accent">
                        {a.name}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <Badge tone={LIFECYCLE_TONE[a.lifecycle_status]}>
                          {LIFECYCLE_LABEL[a.lifecycle_status]}
                        </Badge>
                        {a.is_friend_account ? <Badge tone="cold">friend</Badge> : null}
                        <span className="text-xs text-muted">
                          last email {relativeDays(a.days_since_last_send)}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {owners.length === 0 ? (
                        <Badge tone="warn">No owner</Badge>
                      ) : (
                        <ul className="flex flex-col gap-1.5">
                          {owners.map((o) => (
                            <li key={o.id} className="flex flex-wrap items-center gap-1.5 text-xs">
                              <span className="font-medium">{o.full_name}</span>
                              <Badge>{ROLE_SHORT[o.role]}</Badge>
                              {o.is_primary ? <Badge tone="accent">primary</Badge> : null}
                              <RemoveOwnerButton
                                assignmentId={o.id}
                                label={`${o.full_name} (${ROLE_SHORT[o.role]}) from ${a.name}`}
                              />
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <AddOwnerForm accountId={a.account_id} teammates={assignable} />
                    </td>
                    <td className="px-4 py-3">
                      {/* Keyed on the saved value so the select resets after a change. */}
                      <LifecycleForm
                        key={`${a.account_id}:${a.lifecycle_status}`}
                        accountId={a.account_id}
                        current={a.lifecycle_status}
                      />
                      <p className="mt-1 text-[11px] text-muted">
                        since {formatDate(a.lifecycle_changed_at)}
                      </p>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      </section>
    </div>
  );
}
