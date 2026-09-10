import Link from "next/link";
import { Badge, EmptyState, RELATIONSHIP_TONE } from "@/components/ui";
import { FUNCTION_LABEL, SEND_PATH_LABEL } from "@/lib/format";
import { resolveSendPath, type Policies } from "@/lib/policy";
import type { Contact, CrossSellIntro, SuggestedCollateral } from "@/lib/types";

function ContactRow({
  contact,
  collateral,
  intro,
  policies,
  isFriendAccount,
}: {
  contact: Contact;
  collateral: SuggestedCollateral[];
  intro: CrossSellIntro | undefined;
  policies: Policies;
  isFriendAccount: boolean;
}) {
  // A friend account is not a customer yet, so even its pane-1 contacts get the
  // friend-account type - which the routing policy sends down the cold path.
  // Without this, an engaged contact at a friend account would route warm and
  // put a non-customer conversation on our real sending domain.
  const emailType = isFriendAccount
    ? "friend_account"
    : contact.type === "engaged"
      ? "product_update"
      : "cross_sell_intro";
  const sendPath = resolveSendPath(policies.sendPathRouting, {
    email_type: emailType,
    contact_type: contact.type,
  });

  return (
    <li className="border-b border-line px-4 py-3.5 last:border-b-0">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{contact.full_name}</span>
            <Badge>{FUNCTION_LABEL[contact.business_function]}</Badge>
            <Badge tone={RELATIONSHIP_TONE[contact.relationship_status]}>
              {contact.relationship_status}
            </Badge>
            {contact.source === "enrichment" ? (
              <Badge
                tone="cold"
                title={
                  contact.enrichment_confidence !== null
                    ? `Enrichment confidence ${(contact.enrichment_confidence * 100).toFixed(0)}%`
                    : undefined
                }
              >
                enriched
              </Badge>
            ) : null}
            {contact.is_opted_out ? (
              <Badge tone="bad" title={contact.opt_out_reason ?? undefined}>
                opted out
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-muted">{contact.title ?? "Title unknown"}</p>
          <p className="mt-0.5 font-mono text-xs text-muted">{contact.email ?? "no email on file"}</p>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <button
            type="button"
            disabled
            title="Claude drafting arrives in phase 4, sending in phase 5."
            className="cursor-not-allowed rounded-md border border-line px-2.5 py-1 text-xs font-medium text-muted"
          >
            Compose
          </button>
          <Link
            href={`/collateral?account=${contact.account_id}&contact=${contact.id}`}
            className="text-[11px] font-medium text-accent hover:underline"
          >
            Find collateral
          </Link>
          <span className="text-[11px] text-muted">
            would send{" "}
            <span className={sendPath === "warm" ? "text-ok" : "text-cold"}>
              {SEND_PATH_LABEL[sendPath].toLowerCase()}
            </span>
          </span>
        </div>
      </div>

      {intro ? (
        <div className="mt-2.5 rounded-md border border-line bg-surface-muted px-3 py-2">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Suggested cross-sell intro
          </p>
          <p className="mt-1 text-xs">
            <span className="font-medium">{intro.product_name}</span>
            {intro.value_prop ? ` - ${intro.value_prop}` : ""}
          </p>
          {intro.subject_template ? (
            <p className="mt-1 font-mono text-[11px] text-muted">
              subject: {intro.subject_template}
            </p>
          ) : null}
        </div>
      ) : null}

      {collateral.length ? (
        <div className="mt-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
            Suggested collateral
          </p>
          <ul className="mt-1 space-y-1">
            {collateral.map((item) => (
              <li key={item.collateral_id} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium">{item.title}</span>
                <Badge>{item.content_type.replace(/_/g, " ")}</Badge>
                <span className="text-muted">{item.product_name}</span>
                <Badge tone={item.reason === "cross_sell" ? "cold" : "accent"}>
                  {item.reason === "cross_sell" ? "cross-sell" : "in use"}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </li>
  );
}

export function ContactPane({
  variant,
  contacts,
  collateralByContact,
  introByContact,
  policies,
  isFriendAccount,
}: {
  variant: "engaged" | "committee";
  contacts: Contact[];
  collateralByContact: Map<string, SuggestedCollateral[]>;
  introByContact: Map<string, CrossSellIntro>;
  policies: Policies;
  isFriendAccount: boolean;
}) {
  const engaged = variant === "engaged";

  return (
    <section className="flex min-w-0 flex-col rounded-lg border border-line bg-surface">
      <div className="flex items-baseline justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">
            {engaged ? "Engaged stakeholders" : "Leadership committee"}
          </h2>
          <p className="mt-0.5 text-xs text-muted">
            {engaged
              ? "People we already work with. Product and feature updates, warm path."
              : "Functional leaders we do not sell to yet. Cross-sell intros, cold path."}
          </p>
        </div>
        <span className="shrink-0 text-xs text-muted">{contacts.length}</span>
      </div>

      {contacts.length ? (
        <ul>
          {contacts.map((contact) => (
            <ContactRow
              key={contact.id}
              contact={contact}
              collateral={collateralByContact.get(contact.id) ?? []}
              intro={introByContact.get(contact.id)}
              policies={policies}
              isFriendAccount={isFriendAccount}
            />
          ))}
        </ul>
      ) : (
        <div className="p-4">
          <EmptyState>
            {engaged
              ? "No engaged contacts synced for this account yet."
              : "No committee contacts yet. Leadership enrichment fills this pane once a provider is chosen."}
          </EmptyState>
        </div>
      )}
    </section>
  );
}
