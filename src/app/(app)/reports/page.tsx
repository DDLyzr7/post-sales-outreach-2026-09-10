import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui";
import { SKIP_REASON_LABEL } from "@/lib/db/broadcasts";
import { getCurrentUser } from "@/lib/db/queries";
import { getReports, type MaterialItem, type PersonReport } from "@/lib/db/reports";
import { formatDate } from "@/lib/format";
import { loadPolicies } from "@/lib/policy";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PERIODS = [4, 12, 26] as const;

function pct(part: number, whole: number): string {
  return whole ? `${Math.round((part / whole) * 100)}%` : "-";
}

/**
 * One cell per week, oldest first. A single hue, darker for more emails; the
 * exact count is in each cell's title and in the "Emails" column beside it.
 */
function WeekStrip({ counts, weeks }: { counts: number[]; weeks: number }) {
  const max = Math.max(1, ...counts);
  return (
    <span className="flex gap-0.5" role="img" aria-label={`Emails per week, oldest first: ${counts.join(", ")}`}>
      {counts.map((count, index) => {
        const weeksAgo = weeks - 1 - index;
        const label = `${weeksAgo === 0 ? "This week" : weeksAgo === 1 ? "Last week" : `${weeksAgo} weeks ago`}: ${count} email${count === 1 ? "" : "s"}`;
        return (
          <span
            key={index}
            title={label}
            className={`h-4 w-2.5 rounded-sm ${count === 0 ? "bg-line-strong" : "bg-accent"}`}
            style={count === 0 ? undefined : { opacity: 0.35 + 0.65 * (count / max) }}
          />
        );
      })}
    </span>
  );
}

function materialByPerson(items: MaterialItem[]) {
  const rows = new Map<string, { name: string; total: number; relevant: number; off: number; untagged: number }>();
  for (const item of items) {
    const key = item.sender_id ?? "unknown";
    const row = rows.get(key) ?? { name: item.sender_name ?? "Unknown", total: 0, relevant: 0, off: 0, untagged: 0 };
    row.total += 1;
    if (item.verdict === "relevant") row.relevant += 1;
    else if (item.verdict === "off_target") row.off += 1;
    else row.untagged += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.total - a.total);
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ weeks?: string }> }) {
  const { weeks: weeksParam } = await searchParams;
  const weeks = PERIODS.find((p) => String(p) === weeksParam) ?? 12;
  const supabase = await createClient();
  const [user, policies, reports] = await Promise.all([getCurrentUser(), loadPolicies(supabase), getReports(weeks, weeks * 7)]);
  if (!user) return null;

  const { people, material, campaigns } = reports;
  const perPerson = materialByPerson(material);
  const scope = user.is_admin ? "Every teammate's numbers." : "Your own numbers. The post-sales lead sees the whole team.";

  const TH = "px-4 py-2.5 font-medium";
  const HEAD = "border-b border-line bg-surface-muted text-left text-[11px] uppercase tracking-wide text-muted";

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Reports</h1>
          <p className="mt-1 text-sm text-muted">
            {scope} Read straight from what was sent. Opens aren&apos;t tracked.
          </p>
        </div>
        <nav aria-label="Period" className="flex gap-1 text-xs">
          {PERIODS.map((p) => (
            <Link
              key={p}
              href={`/reports?weeks=${p}`}
              aria-current={p === weeks ? "page" : undefined}
              className={`rounded-md px-2.5 py-1.5 font-medium ${p === weeks ? "bg-accent-soft text-accent" : "text-muted hover:text-foreground"}`}
            >
              {p} weeks
            </Link>
          ))}
        </nav>
      </div>

      <section className="mt-8">
        <h2 className="text-sm font-semibold">Outreach consistency</h2>
        <p className="mt-0.5 text-xs text-muted">
          Routine emails each person sent themselves, per week. Broadcasts are reported separately below.
        </p>
        <Card className="mt-2 overflow-x-auto">
          {people.length ? (
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead>
                <tr className={HEAD}>
                  <th className={TH}>Person</th>
                  <th className={TH}>Emails</th>
                  <th className={TH}>Active weeks</th>
                  <th className={TH}>Week by week</th>
                  <th className={TH}>Replies</th>
                  <th className={TH}>Bounces</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p: PersonReport) => (
                  <tr key={p.user_id} className="border-b border-line align-middle last:border-b-0">
                    <td className="px-4 py-3">
                      <div className="font-medium">{p.full_name}</div>
                      <div className="text-xs text-muted">{p.title ?? ""}</div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{p.emails_in_window}</td>
                    <td className={`px-4 py-3 tabular-nums ${p.active_weeks < weeks / 2 ? "text-warn" : ""}`}>
                      {p.active_weeks} of {weeks}
                    </td>
                    <td className="px-4 py-3"><WeekStrip counts={p.weekly_counts} weeks={weeks} /></td>
                    <td className="px-4 py-3 tabular-nums">{p.replies}</td>
                    <td className={`px-4 py-3 tabular-nums ${p.bounces ? "text-bad" : ""}`}>{p.bounces}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4"><EmptyState>No one to report on yet.</EmptyState></div>
          )}
        </Card>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold">Account coverage</h2>
        <p className="mt-0.5 text-xs text-muted">
          Of the accounts each person owns: how many they emailed themselves in the last 30 and 60 days, and how many
          have heard from nobody in {policies.staleness.warn_days}+ days.
        </p>
        <Card className="mt-2 overflow-x-auto">
          {people.length ? (
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className={HEAD}>
                  <th className={TH}>Person</th>
                  <th className={TH}>Accounts owned</th>
                  <th className={TH}>Emailed in 30 days</th>
                  <th className={TH}>Emailed in 60 days</th>
                  <th className={TH}>Quiet</th>
                  <th className={TH}>Never emailed</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.user_id} className="border-b border-line last:border-b-0">
                    <td className="px-4 py-3 font-medium">{p.full_name}</td>
                    <td className="px-4 py-3 tabular-nums">{p.accounts_owned}</td>
                    <td className="px-4 py-3 tabular-nums">{p.emailed_30d} <span className="text-xs text-muted">({pct(p.emailed_30d, p.accounts_owned)})</span></td>
                    <td className="px-4 py-3 tabular-nums">{p.emailed_60d} <span className="text-xs text-muted">({pct(p.emailed_60d, p.accounts_owned)})</span></td>
                    <td className={`px-4 py-3 tabular-nums ${p.quiet_accounts ? "text-warn" : ""}`}>{p.quiet_accounts}</td>
                    <td className={`px-4 py-3 tabular-nums ${p.never_emailed ? "text-bad" : ""}`}>{p.never_emailed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4"><EmptyState>No accounts owned yet.</EmptyState></div>
          )}
        </Card>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold">Relevant material</h2>
        <p className="mt-0.5 text-xs text-muted">
          Collateral named in emails sent in the last {weeks * 7} days. Relevant means a product the account uses, for an
          engaged contact, or a product it doesn&apos;t use yet that&apos;s pitched to the leader&apos;s function.
        </p>
        <div className="mt-2 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <Card className="overflow-x-auto">
            {perPerson.length ? (
              <table className="w-full min-w-[380px] border-collapse text-sm">
                <thead>
                  <tr className={HEAD}>
                    <th className={TH}>Person</th>
                    <th className={TH}>Items</th>
                    <th className={TH}>Relevant</th>
                    <th className={TH}>Off target</th>
                  </tr>
                </thead>
                <tbody>
                  {perPerson.map((row) => (
                    <tr key={row.name} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-3 font-medium">{row.name}</td>
                      <td className="px-4 py-3 tabular-nums">{row.total}</td>
                      <td className="px-4 py-3 tabular-nums">{row.relevant} <span className="text-xs text-muted">({pct(row.relevant, row.total)})</span></td>
                      <td className={`px-4 py-3 tabular-nums ${row.off ? "text-warn" : ""}`}>{row.off}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-4"><EmptyState>No collateral in sent emails in this period.</EmptyState></div>
            )}
          </Card>
          <Card className="overflow-x-auto">
            {material.length ? (
              <table className="w-full min-w-[640px] border-collapse text-xs">
                <thead>
                  <tr className={HEAD}>
                    <th className="px-3 py-2 font-medium">Sent</th>
                    <th className="px-3 py-2 font-medium">Account and contact</th>
                    <th className="px-3 py-2 font-medium">Collateral</th>
                    <th className="px-3 py-2 font-medium">Verdict</th>
                  </tr>
                </thead>
                <tbody>
                  {material.slice(0, 30).map((item) => (
                    <tr key={`${item.email_id}:${item.collateral_id}`} className="border-b border-line align-top last:border-b-0">
                      <td className="px-3 py-2 text-muted">{formatDate(item.sent_at)}<span className="block">{item.sender_name}</span></td>
                      <td className="px-3 py-2">
                        <Link href={`/drafts/${item.email_id}`} className="font-medium hover:text-accent">{item.account_name}</Link>
                        <span className="block text-muted">{item.contact_name}</span>
                      </td>
                      <td className="px-3 py-2">{item.collateral_title}<span className="block text-muted">{item.product_names.join(", ") || "no product"}</span></td>
                      <td className="px-3 py-2">
                        <Badge tone={item.verdict === "relevant" ? "ok" : item.verdict === "off_target" ? "warn" : "neutral"}>
                          {item.verdict === "relevant" ? "relevant" : item.verdict === "off_target" ? "off target" : "untagged"}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-4"><EmptyState>Nothing to list.</EmptyState></div>
            )}
          </Card>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold">Broadcast results</h2>
        <p className="mt-0.5 text-xs text-muted">
          {user.is_admin ? "Every recipient." : "Recipients on your accounts."} Skipped emails are listed with why.
        </p>
        <Card className="mt-2 overflow-x-auto">
          {campaigns.length ? (
            <table className="w-full min-w-[900px] border-collapse text-sm">
              <thead>
                <tr className={HEAD}>
                  <th className={TH}>Broadcast</th>
                  <th className={TH}>Recipients</th>
                  <th className={TH}>Sent</th>
                  <th className={TH}>Replied</th>
                  <th className={TH}>Bounced</th>
                  <th className={TH}>Failed</th>
                  <th className={TH}>Skipped</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.map((c) => (
                  <tr key={c.campaign_id} className="border-b border-line align-top last:border-b-0">
                    <td className="px-4 py-3">
                      {user.is_admin ? (
                        <Link href={`/broadcasts/${c.campaign_id}`} className="font-medium hover:text-accent">{c.name}</Link>
                      ) : (
                        <span className="font-medium">{c.name}</span>
                      )}
                      <span className="block text-xs text-muted">{c.status} · {formatDate(c.started_at)}</span>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{c.recipients}</td>
                    <td className="px-4 py-3 tabular-nums">{c.sent}</td>
                    <td className="px-4 py-3 tabular-nums">{c.replied} <span className="text-xs text-muted">({pct(c.replied, c.sent)})</span></td>
                    <td className={`px-4 py-3 tabular-nums ${c.bounced ? "text-bad" : ""}`}>{c.bounced}</td>
                    <td className={`px-4 py-3 tabular-nums ${c.failed ? "text-bad" : ""}`}>{c.failed}</td>
                    <td className="px-4 py-3">
                      <span className="tabular-nums">{c.skipped}</span>
                      {Object.entries(c.skip_reasons).map(([reason, n]) => (
                        <span key={reason} className="block text-xs text-muted">{SKIP_REASON_LABEL[reason] ?? reason}: {n}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4"><EmptyState>No broadcasts launched yet.</EmptyState></div>
          )}
        </Card>
      </section>
    </div>
  );
}
