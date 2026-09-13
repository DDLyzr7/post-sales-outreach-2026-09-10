import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState } from "@/components/ui";
import { createBroadcast } from "./actions";
import { CAMPAIGN_STATUS, listCampaigns } from "@/lib/db/broadcasts";
import { getCurrentUser } from "@/lib/db/queries";
import { formatDate } from "@/lib/format";
import { loadPolicies } from "@/lib/policy";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function BroadcastsPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const [user, campaigns, policies] = await Promise.all([getCurrentUser(), listCampaigns(), loadPolicies(supabase)]);
  // A convenience gate; campaign writes and launch are refused in Postgres for anyone but the lead.
  if (!user?.is_admin) notFound();

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-semibold tracking-tight">Broadcasts</h1>
          <p className="mt-1 max-w-[70ch] text-sm text-muted">
            One announcement to many accounts. Each email goes from the account&apos;s primary owner&apos;s mailbox.
            Broadcasts sit outside the monthly cap; opt-outs are always respected.
          </p>
        </div>
        {policies.sending.mode !== "live" ? (
          <Badge tone="warn">{policies.sending.mode === "paused" ? "Sending paused" : "Test mode"}</Badge>
        ) : null}
      </div>

      {error ? <p role="alert" className="mt-4 rounded-md bg-bad-soft px-3 py-2 text-xs text-bad">{error}</p> : null}

      <Card className="mt-6 p-4">
        <form action={createBroadcast} className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <label htmlFor="new-name" className="text-[11px] font-medium uppercase tracking-wide text-muted">
              New broadcast
            </label>
            <input
              id="new-name"
              name="name"
              maxLength={120}
              placeholder="e.g. Risk Shield launch, October"
              className="mt-1 w-full rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
            />
          </div>
          <button type="submit" className="rounded-md bg-accent px-3 py-2 text-xs font-medium text-white hover:opacity-90">
            Create draft
          </button>
        </form>
      </Card>

      <Card className="mt-6 overflow-hidden">
        {campaigns.length ? (
          <ul>
            {campaigns.map((campaign) => {
              const status = CAMPAIGN_STATUS[campaign.status];
              return (
                <li key={campaign.id} className="border-b border-line last:border-b-0">
                  <Link href={`/broadcasts/${campaign.id}`} className="block px-4 py-3 hover:bg-surface-muted">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium">{campaign.name}</span>
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-muted">
                      {campaign.subject || "(no subject yet)"}
                      {" · "}
                      {campaign.started_at ? `launched ${formatDate(campaign.started_at)}` : `created ${formatDate(campaign.created_at)}`}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-4">
            <EmptyState>No broadcasts yet.</EmptyState>
          </div>
        )}
      </Card>
    </div>
  );
}
