import { Badge, Card, EmptyState } from "@/components/ui";
import { DisconnectMailboxButton, SendingModeForm } from "@/components/settings-forms";
import { getCurrentUser, listTeammates } from "@/lib/db/queries";
import { formatDate } from "@/lib/format";
import { missingMailboxSettings } from "@/lib/microsoft/oauth";
import { loadPolicies } from "@/lib/policy";
import { createClient } from "@/lib/supabase/server";
import type { SyncJobSummary } from "@/lib/jobs/sync";

export const dynamic = "force-dynamic";

const MODE_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" }> = {
  dry_run: { label: "Test mode", tone: "warn" },
  live: { label: "Live", tone: "ok" },
  paused: { label: "Paused", tone: "bad" },
};

type Connection = {
  user_id: string;
  email_address: string;
  status: string;
  connected_at: string;
  inbox_checked_at: string | null;
  last_error: string | null;
};

type JobRun = { job: string; started_at: string; finished_at: string | null; ok: boolean | null; summary: Record<string, unknown> };

function timeAgo(iso: string | null): string {
  if (!iso) return "never";
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : formatDate(iso);
}

/** The last sync's counts, plus what the lead may need to act on. */
function SyncSummary({ summary }: { summary: SyncJobSummary }) {
  if (!summary.accounts) return null;
  const { accounts, contacts, owners, unpaired, warnings } = summary;
  return (
    <details className="w-full">
      <summary className="cursor-pointer text-muted">
        {accounts.created + accounts.updated} accounts ({accounts.inBoth} in both systems) · {contacts.created + contacts.updated} contacts ·{" "}
        {owners.added} owners added
        {unpaired.compass.length + unpaired.helix.length ? ` · ${unpaired.compass.length + unpaired.helix.length} unpaired` : ""}
        {warnings.length ? ` · ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}
      </summary>
      <div className="mt-2 space-y-2 text-muted">
        <p>
          Helix {summary.helixClients} clients, Compass {summary.compassAccounts} accounts. Created {accounts.created}, updated{" "}
          {accounts.updated}, lifecycle changed on {accounts.lifecycleChanged}, {summary.missingUpstream} no longer upstream.{" "}
          {summary.engagements} projects and use cases. Contacts: {contacts.created} new, {contacts.updated} updated. Owners:{" "}
          {owners.added} added, {owners.retired} retired.
        </p>
        {owners.notSignedUp?.length ? (
          <p>
            Owners who haven&apos;t signed in yet ({owners.pending ?? 0} account roles waiting; each gets access at first
            sign-in): {owners.notSignedUp.join(", ")}
          </p>
        ) : null}
        {owners.unresolvedNames?.length ? (
          <p>
            Compass owner names with no matching email: {owners.unresolvedNames.join("; ")}. Map a name to an email in{" "}
            <code>cortex_sync.people</code>.
          </p>
        ) : null}
        {summary.withoutOwner?.length ? (
          <p className="text-warn">No owner in Helix or Compass: {summary.withoutOwner.join(", ")}</p>
        ) : null}
        {unpaired.compass.length || unpaired.helix.length ? (
          <p>
            Only in Compass: {unpaired.compass.join(", ") || "none"}. Only in Helix: {unpaired.helix.join(", ") || "none"}. To pair
            two that are the same client, add <code>{"\"<compass id>\": \"<helix id>\""}</code> to{" "}
            <code>cortex_sync.account_matches</code> before they first sync, or merge them afterwards.
          </p>
        ) : null}
        {warnings.map((warning, index) => (
          <p key={index} className="text-warn">{warning}</p>
        ))}
      </div>
    </details>
  );
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; mailbox?: string }>;
}) {
  const { error, mailbox: mailboxResult } = await searchParams;
  const supabase = await createClient();
  const [user, policies] = await Promise.all([getCurrentUser(), loadPolicies(supabase)]);
  if (!user) return null;

  // RLS: your own connection, or every connection for the lead. job_run is lead-only.
  const [{ data: connections }, { data: runs }, teammates] = await Promise.all([
    supabase.from("mailbox_connection").select("user_id, email_address, status, connected_at, inbox_checked_at, last_error"),
    supabase.from("job_run").select("job, started_at, finished_at, ok, summary").order("started_at", { ascending: false }).limit(20),
    user.is_admin ? listTeammates() : Promise.resolve([]),
  ]);

  const all = (connections ?? []) as Connection[];
  const mine = all.find((c) => c.user_id === user.id) ?? null;
  const missing = missingMailboxSettings();
  const mode = MODE_LABEL[policies.sending.mode] ?? MODE_LABEL.paused;
  const lastRun = (job: string) => ((runs ?? []) as JobRun[]).find((r) => r.job === job) ?? null;

  return (
    <div className="mx-auto w-full max-w-[1000px] px-6 py-8">
      <h1 className="font-display text-xl font-semibold tracking-tight">Settings</h1>
      <p className="mt-1 text-sm text-muted">
        Your mailbox connection{user.is_admin ? ", plus sending controls for the post-sales lead" : ""}.
      </p>

      {error ? (
        <p role="alert" className="mt-4 rounded-md bg-bad-soft px-3 py-2 text-xs text-bad">{error}</p>
      ) : mailboxResult === "connected" ? (
        <p role="status" className="mt-4 rounded-md bg-ok-soft px-3 py-2 text-xs text-ok">Mailbox connected.</p>
      ) : null}

      <section className="mt-6">
        <h2 className="text-sm font-semibold">Your Microsoft 365 mailbox</h2>
        <p className="mt-0.5 text-xs text-muted">
          Every email you send from the app leaves from this mailbox, warm and cold alike, and shows in your Sent
          Items. The app reads senders and subjects in your inbox (never message bodies) to spot replies and bounces.
        </p>
        <Card className="mt-2 p-4">
          {mine && mine.status !== "disconnected" ? (
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-sm">{mine.email_address}</span>
                  {mine.status === "connected" ? (
                    <Badge tone="ok">Connected</Badge>
                  ) : (
                    <Badge tone="bad">Needs reconnecting</Badge>
                  )}
                </div>
                <p className="mt-1 text-xs text-muted">
                  Connected {formatDate(mine.connected_at)} · inbox last checked {timeAgo(mine.inbox_checked_at)}
                </p>
                {mine.last_error ? <p className="mt-1 text-xs text-bad">{mine.last_error}</p> : null}
              </div>
              <div className="flex items-start gap-2">
                {mine.status !== "connected" ? (
                  <a href="/mailbox/connect" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
                    Reconnect
                  </a>
                ) : null}
                <DisconnectMailboxButton />
              </div>
            </div>
          ) : missing.length ? (
            <EmptyState>
              Mailbox connection isn&apos;t set up on this server yet. Missing: {missing.join(", ")}.
            </EmptyState>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted">Not connected. You can draft and mark emails ready, but not send them live.</p>
              <a href="/mailbox/connect" className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
                Connect Microsoft mailbox
              </a>
            </div>
          )}
        </Card>
      </section>

      <section className="mt-8">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Sending</h2>
          <Badge tone={mode.tone}>{mode.label}</Badge>
        </div>
        {user.is_admin ? (
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <Card className="p-4">
              <SendingModeForm current={policies.sending.mode} />
            </Card>
            <Card className="p-4 text-xs">
              <h3 className="text-sm font-semibold">Jobs</h3>
              <p className="mt-0.5 text-muted">
                The send job delivers queued emails; the tracking job reads replies and bounces; the sync mirrors
                accounts, owners and contacts from Helix and Compass. All run through /api/jobs with CRON_SECRET
                (<code>npm run jobs</code> locally, <code>npm run sync</code> for one sync).
              </p>
              <dl className="mt-3 space-y-2">
                {["send", "track", "sync"].map((job) => {
                  const run = lastRun(job);
                  return (
                    <div key={job} className="flex flex-wrap items-center gap-2">
                      <dt className="w-12 font-medium capitalize">{job}</dt>
                      <dd className="flex flex-wrap items-center gap-2">
                        {run ? (
                          <>
                            <Badge tone={run.ok === false ? "bad" : run.ok ? "ok" : "neutral"}>
                              {run.ok === false ? "failed" : run.ok ? "ok" : "running"}
                            </Badge>
                            <span className="text-muted">{timeAgo(run.started_at)}</span>
                            {run.ok === false && typeof run.summary.error === "string" ? (
                              <span className="text-bad">{run.summary.error}</span>
                            ) : null}
                            {job === "sync" && run.ok ? <SyncSummary summary={run.summary as SyncJobSummary} /> : null}
                          </>
                        ) : (
                          <span className="text-muted">never run</span>
                        )}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </Card>
            <Card className="p-4 md:col-span-2">
              <h3 className="text-sm font-semibold">Team mailboxes</h3>
              <ul className="mt-2 divide-y divide-line text-xs">
                {teammates.map((teammate) => {
                  const connection = all.find((c) => c.user_id === teammate.id);
                  return (
                    <li key={teammate.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="font-medium">{teammate.full_name}</span>
                      <span className="flex items-center gap-2">
                        <span className="font-mono text-muted">{connection?.email_address ?? teammate.email}</span>
                        {connection?.status === "connected" ? (
                          <Badge tone="ok">connected</Badge>
                        ) : connection?.status === "needs_reconnect" ? (
                          <Badge tone="bad">needs reconnecting</Badge>
                        ) : (
                          <Badge>not connected</Badge>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted">
            {policies.sending.mode === "dry_run"
              ? "Sending is in test mode: Send records an email as sent, but nothing is delivered. The post-sales lead switches it to live."
              : policies.sending.mode === "paused"
                ? "The post-sales lead has paused sending."
                : "Sending is live."}
          </p>
        )}
      </section>
    </div>
  );
}
