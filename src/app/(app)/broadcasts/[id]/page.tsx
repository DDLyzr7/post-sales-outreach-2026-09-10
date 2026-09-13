import Link from "next/link";
import { notFound } from "next/navigation";
import {
  BroadcastEditor, CancelBroadcastButton, DeleteBroadcastButton, LaunchBroadcastButton,
} from "@/components/broadcast-forms";
import { Badge, Card, EmptyState } from "@/components/ui";
import {
  CAMPAIGN_STATUS, SKIP_REASON_LABEL, getCampaign, listCampaignRecipients, listProductOptions, mergeBroadcast,
  previewAudience,
} from "@/lib/db/broadcasts";
import { UUID } from "@/lib/db/drafts";
import { getCurrentUser } from "@/lib/db/queries";
import { CONTACT_TYPE_LABEL, SEND_PATH_LABEL, formatDate } from "@/lib/format";
import { loadPolicies } from "@/lib/policy";
import { createClient } from "@/lib/supabase/server";
import { findPlaceholders } from "@/lib/template";

export const dynamic = "force-dynamic";

const DELIVERY_TONE: Record<string, "ok" | "bad" | "accent" | "neutral"> = {
  queued: "accent", sent: "ok", opened: "ok", replied: "ok", bounced: "bad", failed: "bad", cancelled: "neutral",
};

function countBy<T>(items: T[], key: (item: T) => string | null): [string, number][] {
  const counts = new Map<string, number>();
  for (const item of items) {
    const k = key(item);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

export default async function BroadcastPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const supabase = await createClient();
  const [user, campaign, policies] = await Promise.all([getCurrentUser(), getCampaign(id), loadPolicies(supabase)]);
  if (!user?.is_admin || !campaign) notFound();

  const status = CAMPAIGN_STATUS[campaign.status];
  const mode = policies.sending.mode;
  const isDraft = campaign.status === "draft";

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
      <Link href="/broadcasts" className="text-xs text-muted hover:text-accent">&larr; Broadcasts</Link>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-xl font-semibold tracking-tight">{campaign.name}</h1>
        <Badge tone={status.tone}>{status.label}</Badge>
        {mode !== "live" ? <Badge tone="warn">{mode === "paused" ? "Sending paused" : "Test mode"}</Badge> : null}
      </div>
      <p className="mt-1 text-xs text-muted">
        {campaign.started_at ? `Launched ${formatDate(campaign.started_at)}` : `Created ${formatDate(campaign.created_at)}`}
        {campaign.scheduled_at ? ` · sends from ${new Date(campaign.scheduled_at).toLocaleString("en-GB")}` : ""}
        {campaign.completed_at ? ` · finished ${formatDate(campaign.completed_at)}` : ""}
      </p>

      {isDraft ? <DraftView campaign={campaign} mode={mode} /> : <ProgressView campaignId={campaign.id} status={campaign.status} subject={campaign.subject} body={campaign.body_text} />}
    </div>
  );
}

async function DraftView({
  campaign,
  mode,
}: {
  campaign: NonNullable<Awaited<ReturnType<typeof getCampaign>>>;
  mode: string;
}) {
  const [products, preview] = await Promise.all([listProductOptions(), previewAudience(campaign.audience)]);
  const reach = preview.rows.filter((r) => !r.skip_reason);
  const skipped = preview.rows.filter((r) => r.skip_reason);
  const accounts = new Set(reach.map((r) => r.account_id)).size;
  const sample = reach[0] ?? null;
  const unfilled = findPlaceholders(`${campaign.subject}\n${campaign.body_text}`).filter((p) => p.startsWith("[["));
  const unknownFields = [...`${campaign.subject}\n${campaign.body_text}`.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)]
    .map((m) => m[1])
    .filter((f) => !["contact_first_name", "account_name", "sender_first_name", "sender_full_name"].includes(f));

  const disabledReason =
    mode === "paused" ? "Sending is paused in Settings."
    : !campaign.subject.trim() ? "Add a subject and save."
    : unfilled.length ? `Fill in ${unfilled.join(", ")} and save.`
    : unknownFields.length ? `Unknown merge field: ${unknownFields.join(", ")}.`
    : reach.length === 0 ? "Nobody in this audience can be emailed."
    : null;

  return (
    <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="space-y-5">
        <Card className="p-4">
          <BroadcastEditor campaign={campaign} products={products} />
        </Card>
        <DeleteBroadcastButton campaignId={campaign.id} />
      </div>

      <aside className="space-y-5">
        <Card className="p-4">
          <h2 className="text-sm font-semibold">Audience</h2>
          {preview.error ? (
            <p className="mt-2 text-xs text-bad">{preview.error}</p>
          ) : (
            <>
              <p className="mt-1 text-sm">
                <span className="font-medium">{reach.length}</span> contacts at <span className="font-medium">{accounts}</span>{" "}
                accounts. {skipped.length ? `${skipped.length} skipped.` : "Nobody skipped."}
              </p>
              {skipped.length ? (
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {countBy(skipped, (r) => r.skip_reason).map(([reason, n]) => (
                    <li key={reason}><Badge tone="warn">{SKIP_REASON_LABEL[reason] ?? reason}: {n}</Badge></li>
                  ))}
                </ul>
              ) : null}
              <p className="mt-2 text-[11px] text-muted">
                Saved audience. The monthly cap doesn&apos;t apply to broadcasts.
                {mode === "live" ? " Owners without a connected mailbox are skipped." : ""}
              </p>
              <div className="mt-3">
                <LaunchBroadcastButton campaignId={campaign.id} reach={reach.length} testMode={mode === "dry_run"} disabledReason={disabledReason} />
              </div>
            </>
          )}
        </Card>

        {sample ? (
          <Card className="p-4">
            <h2 className="text-sm font-semibold">As {sample.contact_name} would read it</h2>
            <p className="mt-0.5 text-[11px] text-muted">
              From {sample.from_email} · {SEND_PATH_LABEL[sample.send_path].toLowerCase()} path · an unsubscribe
              line is added when it sends
            </p>
            <p className="mt-3 text-sm font-medium">{mergeBroadcast(campaign.subject, sample) || "(no subject)"}</p>
            <pre className="mt-2 whitespace-pre-wrap font-sans text-sm leading-relaxed">{mergeBroadcast(campaign.body_text, sample)}</pre>
          </Card>
        ) : null}

        {preview.rows.length ? (
          <Card className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Contact</th>
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.slice(0, 100).map((row) => (
                  <tr key={row.contact_id} className="border-b border-line last:border-b-0">
                    <td className="px-3 py-2">{row.account_name}</td>
                    <td className="px-3 py-2">
                      {row.contact_name}
                      <span className="block text-[11px] text-muted">{CONTACT_TYPE_LABEL[row.contact_type]}</span>
                    </td>
                    <td className="px-3 py-2">{row.sender_name ?? "-"}</td>
                    <td className="px-3 py-2">
                      {row.skip_reason ? <Badge tone="warn">{SKIP_REASON_LABEL[row.skip_reason] ?? row.skip_reason}</Badge> : <Badge tone="ok">will send</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {preview.rows.length > 100 ? <p className="px-3 py-2 text-[11px] text-muted">Showing 100 of {preview.rows.length}.</p> : null}
          </Card>
        ) : null}
      </aside>
    </div>
  );
}

async function ProgressView({
  campaignId,
  status,
  subject,
  body,
}: {
  campaignId: string;
  status: string;
  subject: string;
  body: string;
}) {
  const recipients = await listCampaignRecipients(campaignId);
  const sent = recipients.filter((r) => r.sent_at).length;
  const queued = recipients.filter((r) => r.status === "queued").length;
  const failed = recipients.filter((r) => r.status === "failed").length;
  const skipped = recipients.filter((r) => r.status === "cancelled");
  const replied = recipients.filter((r) => r.replied_at).length;
  const bounced = recipients.filter((r) => r.bounced_at).length;
  const dryRun = recipients.some((r) => r.provider === "dry_run");

  const tiles: [string, number, string][] = [
    ["Recipients", recipients.length, ""],
    ["Queued", queued, "text-accent"],
    ["Sent", sent, "text-ok"],
    ["Replied", replied, "text-ok"],
    ["Bounced", bounced, bounced ? "text-bad" : ""],
    ["Failed", failed, failed ? "text-bad" : ""],
    ["Skipped", skipped.length, skipped.length ? "text-warn" : ""],
  ];

  return (
    <div className="mt-5 space-y-5">
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          {tiles.map(([label, value, tone]) => (
            <div key={label}>
              <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
              <p className={`font-display text-2xl font-semibold tabular-nums ${tone}`}>{value}</p>
            </div>
          ))}
        </div>
        {skipped.length ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {countBy(skipped, (r) => r.skip_reason).map(([reason, n]) => (
              <li key={reason}><Badge tone="warn">{SKIP_REASON_LABEL[reason] ?? reason}: {n}</Badge></li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 text-[11px] text-muted">
          {dryRun ? "Test mode: sends were recorded, nothing was delivered. " : ""}
          Opens aren&apos;t tracked. Replies and bounces come from each owner&apos;s inbox.
        </p>
        {status === "running" || status === "scheduled" ? (
          <div className="mt-3">
            <CancelBroadcastButton campaignId={campaignId} />
          </div>
        ) : null}
      </Card>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card className="overflow-x-auto">
          {recipients.length ? (
            <table className="w-full min-w-[720px] border-collapse text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-left text-[11px] uppercase tracking-wide text-muted">
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Contact</th>
                  <th className="px-3 py-2 font-medium">From</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Sent</th>
                </tr>
              </thead>
              <tbody>
                {recipients.map((r) => (
                  <tr key={r.id} className="border-b border-line align-top last:border-b-0">
                    <td className="px-3 py-2">{r.account_name}</td>
                    <td className="px-3 py-2">{r.contact_name}</td>
                    <td className="px-3 py-2">{r.sender_name ?? "-"}</td>
                    <td className="px-3 py-2">
                      <Badge tone={DELIVERY_TONE[r.status] ?? "neutral"}>
                        {r.status === "cancelled" ? (SKIP_REASON_LABEL[r.skip_reason ?? ""] ?? "skipped") : r.replied_at ? "replied" : r.status}
                      </Badge>
                      {r.error_message ? <span className="mt-1 block text-[11px] text-bad">{r.error_message}</span> : null}
                    </td>
                    <td className="px-3 py-2 text-muted">{r.sent_at ? formatDate(r.sent_at) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="p-4"><EmptyState>No recipients.</EmptyState></div>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="text-sm font-semibold">What went out</h2>
          <p className="mt-2 text-sm font-medium">{subject}</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans text-xs leading-relaxed">{body}</pre>
          <p className="mt-2 text-[11px] text-muted">Merge fields were filled per recipient; each row keeps its own copy.</p>
        </Card>
      </div>
    </div>
  );
}
