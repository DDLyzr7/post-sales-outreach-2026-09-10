import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getAccountDetail } from "@/lib/db/queries";
import { loadPolicies } from "@/lib/policy";
import { AccountStatusHeader } from "@/components/account-status-header";
import { ContactPane } from "@/components/contact-pane";

export const dynamic = "force-dynamic";

export default async function AccountPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [detail, policies] = await Promise.all([getAccountDetail(id), loadPolicies(supabase)]);

  // RLS returns nothing for an account this user does not own, so an
  // unauthorised id and a non-existent id are the same 404.
  if (!detail) notFound();

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
          <ContactPane
            variant="engaged"
            contacts={detail.engaged}
            collateralByContact={detail.collateralByContact}
            introByContact={detail.introByContact}
            policies={policies}
            isFriendAccount={detail.overview.is_friend_account}
          />
          <ContactPane
            variant="committee"
            contacts={detail.committee}
            collateralByContact={detail.collateralByContact}
            introByContact={detail.introByContact}
            policies={policies}
            isFriendAccount={detail.overview.is_friend_account}
          />
        </div>

        <p className="mt-4 text-xs text-muted">
          This view is read-only. Claude drafting arrives in phase 4 and sending in phase 5, when
          every send passes through the frequency governor and is logged to{" "}
          <code>email_activity</code> at send time.
        </p>
      </div>
    </>
  );
}
