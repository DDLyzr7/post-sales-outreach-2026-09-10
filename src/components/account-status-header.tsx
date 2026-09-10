import Link from "next/link";
import { Badge, HEALTH_TONE, LIFECYCLE_TONE } from "@/components/ui";
import {
  EMAIL_STATUS_LABEL, EMAIL_TYPE_LABEL, LIFECYCLE_LABEL, ROLE_SHORT, SEND_PATH_LABEL, TIER_LABEL,
  formatArr, formatDate, relativeDays,
} from "@/lib/format";
import { stalenessOf, type Policies } from "@/lib/policy";
import type { AccountOverview, TeamMember } from "@/lib/types";

/**
 * The account status header. Both numbers on it - the last-activity line and
 * the "n of m this month" indicator - are derived from email_activity on read.
 * Neither is stored on the account row.
 */
export function AccountStatusHeader({
  account,
  team,
  products,
  policies,
}: {
  account: AccountOverview;
  team: TeamMember[];
  products: { name: string; status: string }[];
  policies: Policies;
}) {
  const cap = policies.frequencyCap.max_sends_per_account_per_month;
  const sent = account.sends_this_month;
  const atCap = sent >= cap;
  const staleness = stalenessOf(account.days_since_last_send, policies.staleness);

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto w-full max-w-[1400px] px-6 py-5">
        <Link href="/" className="text-xs text-muted hover:text-accent">
          &larr; All my accounts
        </Link>

        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="font-display text-xl font-semibold tracking-tight">{account.name}</h1>
          <Badge tone={LIFECYCLE_TONE[account.lifecycle_status]}>
            {LIFECYCLE_LABEL[account.lifecycle_status]}
          </Badge>
          <Badge tone={HEALTH_TONE[account.health_status]}>
            {account.health_status === "unknown" ? "health unknown" : account.health_status}
          </Badge>
          <Badge>{TIER_LABEL[account.tier]}</Badge>
          {account.is_friend_account ? <Badge tone="cold">Friend account</Badge> : null}
          {account.viewer_role ? (
            <Badge tone="accent">You: {ROLE_SHORT[account.viewer_role]}</Badge>
          ) : (
            <Badge tone="accent">Admin view</Badge>
          )}
        </div>

        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-muted">
          <div className="flex gap-1.5">
            <dt>Owning team</dt>
            <dd className="text-foreground">{account.owning_team ?? "-"}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>ARR</dt>
            <dd className="text-foreground">{formatArr(account.arr_cents)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Renewal</dt>
            <dd className="text-foreground">{formatDate(account.renewal_date)}</dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Products in use</dt>
            <dd className="text-foreground">
              {products.length ? products.map((p) => p.name).join(", ") : "none"}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Team</dt>
            <dd className="text-foreground">
              {team.length
                ? team.map((m) => `${m.full_name} (${ROLE_SHORT[m.role]})`).join(", ")
                : "unassigned"}
            </dd>
          </div>
          <div className="flex gap-1.5">
            <dt>Synced from</dt>
            <dd className="text-foreground">
              {account.source_system} &middot; {account.synced_at ? formatDate(account.synced_at) : "never"}
            </dd>
          </div>
        </dl>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {/* Last activity */}
          <div className="rounded-md border border-line bg-surface-muted px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Last activity
            </p>
            {account.last_sent_at ? (
              <p className="mt-1 text-sm">
                Last sent:{" "}
                <span className="font-medium">
                  {EMAIL_TYPE_LABEL[account.last_email_type!].toLowerCase()}
                </span>{" "}
                to {account.last_contact_name ?? "an unnamed contact"} &mdash;{" "}
                {relativeDays(account.days_since_last_send)}
                {account.last_status ? ` (${EMAIL_STATUS_LABEL[account.last_status]})` : ""}
                <span className="text-muted">
                  {" "}
                  &middot; {SEND_PATH_LABEL[account.last_send_path!]} path &middot; by{" "}
                  {account.last_sender_name ?? "unknown"}
                </span>
              </p>
            ) : (
              <p className="mt-1 text-sm text-warn">
                No one has emailed this account from the app yet.
              </p>
            )}
            {staleness === "alert" || staleness === "never" ? (
              <p className="mt-1.5">
                <Badge tone="bad">
                  {staleness === "never"
                    ? "never contacted"
                    : `no touch in ${policies.staleness.alert_days}+ days`}
                </Badge>
              </p>
            ) : staleness === "warn" ? (
              <p className="mt-1.5">
                <Badge tone="warn">no touch in {policies.staleness.warn_days}+ days</Badge>
              </p>
            ) : null}
          </div>

          {/* Frequency governor */}
          <div className="rounded-md border border-line bg-surface-muted px-4 py-3">
            <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
              Frequency this month
            </p>
            <p className="mt-1 text-sm">
              <span className={`font-medium ${atCap ? "text-bad" : ""}`}>
                {sent} of {cap}
              </span>{" "}
              emails sent to this account this month.
            </p>
            <div className="mt-2 flex gap-1" aria-hidden>
              {Array.from({ length: cap }).map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 flex-1 rounded-full ${
                    i < sent ? (atCap ? "bg-bad" : "bg-accent") : "bg-line-strong"
                  }`}
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">
              Counted across every sender, both send paths and all campaigns
              ({account.warm_sends_this_month} warm, {account.cold_sends_this_month} cold).
              {atCap ? " Cap reached - the governor will block further sends." : ""}
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}
