import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountDetail, getCurrentUser } from "@/lib/db/queries";
import { listOpenDrafts } from "@/lib/db/drafts";
import { loadPolicies } from "@/lib/policy";
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
  };

  return (
    <>
      <AccountStatusHeader
        account={detail.overview}
        team={detail.team}
        products={detail.products}
        policies={policies}
      />

      <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
        <div className="grid gap-5 lg:grid-cols-2">
          <ContactPane variant="engaged" contacts={detail.engaged} {...shared} />
          <ContactPane variant="committee" contacts={detail.committee} {...shared} />
        </div>

        <p className="mt-4 text-xs text-muted">
          Drafts stay in the app until sending arrives in phase 5. Every send will pass through the
          frequency governor and be logged to <code>email_activity</code> at send time; drafts
          don&apos;t count toward the monthly cap.
        </p>
      </div>
    </>
  );
}
