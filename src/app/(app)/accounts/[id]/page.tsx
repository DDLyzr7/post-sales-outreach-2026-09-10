import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountDetail, getCurrentUser } from "@/lib/db/queries";
import { listOpenDrafts } from "@/lib/db/drafts";
import { loadPolicies } from "@/lib/policy";
import { AccountContextPanel } from "@/components/account-context";
import { AccountStatusHeader } from "@/components/account-status-header";
import { ContactPane } from "@/components/contact-pane";
import type { DraftSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [detail, policies, user, drafts] = await Promise.all([
    getAccountDetail(id),
    loadPolicies(supabase),
    getCurrentUser(),
    listOpenDrafts(id),
  ]);

  // RLS returns nothing for an account this user does not own, so an
  // unauthorised id and a non-existent id are the same 404.
  if (!detail || !user) notFound();

  const draftsByContact = new Map<string, DraftSummary[]>();
  for (const draft of drafts) {
    const list = draftsByContact.get(draft.contact_id) ?? [];
    list.push(draft);
    draftsByContact.set(draft.contact_id, list);
  }

  const shared = {
    collateralByContact: detail.collateralByContact,
    introByContact: detail.introByContact,
    policies,
    isFriendAccount: detail.overview.is_friend_account,
    draftsByContact,
    viewerId: user.id,
    viewerIsAdmin: user.is_admin,
    accountId: detail.overview.account_id,
    enrichmentAvailable: policies.enrichment.who_can_enrich === "owners_and_lead" || user.is_admin,
  };

  return (
    <>
      <AccountStatusHeader
        account={detail.overview}
        team={detail.team}
        pendingOwners={detail.pendingOwners}
        products={detail.products}
        policies={policies}
      />

      <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
        <AccountContextPanel
          context={detail.context}
          engagements={detail.engagements}
          industry={detail.industry}
          region={detail.region}
        />

        <div className="grid gap-5 lg:grid-cols-2">
          <ContactPane variant="engaged" contacts={detail.engaged} {...shared} />
          <ContactPane variant="committee" contacts={detail.committee} {...shared} />
        </div>

        <p className="mt-4 text-xs text-muted">
          Every email sends from its author&apos;s own Microsoft 365 mailbox after the checks run again at
          Send, and is logged to <code>email_activity</code>. Drafts don&apos;t count toward the monthly cap,
          queued emails do, and broadcasts sit outside it.
        </p>
      </div>
    </>
  );
}
