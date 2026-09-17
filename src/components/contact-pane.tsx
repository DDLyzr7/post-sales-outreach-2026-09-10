import Link from "next/link";
import { OptOutForm } from "@/components/contact-forms";
import { StartDraftForm } from "@/components/draft-forms";
import { Badge, EmptyState, RELATIONSHIP_TONE } from "@/components/ui";
import { FUNCTION_LABEL, SEND_PATH_LABEL, formatDate } from "@/lib/format";
import { emailTypeFor, resolveSendPath, type Policies } from "@/lib/policy";
import type { Contact, CrossSellIntro, DraftSummary, SuggestedCollateral } from "@/lib/types";

function DraftAction({
  contact,
  drafts,
  viewerId,
}: {
  contact: Contact;
  drafts: DraftSummary[];
  viewerId: string;
}) {
  const mine = drafts.find((d) => d.sender_id === viewerId);
  const others = drafts.filter((d) => d.sender_id !== viewerId);

  return (
    <>
      {mine ? (
        <Link
          href={`/drafts/${mine.id}`}
          className="rounded-md border border-line-strong px-2.5 py-1 text-xs font-medium hover:border-accent"
        >
          {mine.status === "approved" ? "Open ready email" : "Open your draft"}
        </Link>
      ) : contact.is_opted_out ? (
        <button
          type="button"
          disabled
          title="This contact opted out, so nobody can email them."
          className="cursor-not-allowed rounded-md border border-line px-2.5 py-1 text-xs font-medium text-muted"
        >
          Opted out
        </button>
      ) : (
        <StartDraftForm accountId={contact.account_id} contactId={contact.id} />
      )}
      {others.map((draft) => (
        <Link key={draft.id} href={`/drafts/${draft.id}`} className="text-[11px] text-muted hover:text-accent">
          {draft.sender_name} has a {draft.status === "approved" ? "ready email" : "draft"}
        </Link>
      ))}
    </>
  );
}

function ContactRow({
  contact,
  collateral,
  intro,
  policies,
  isFriendAccount,
  drafts,
  viewerId,
  viewerIsAdmin,
}: {
  contact: Contact;
  collateral: SuggestedCollateral[];
  intro: CrossSellIntro | undefined;
  policies: Policies;
  isFriendAccount: boolean;
  drafts: DraftSummary[];
  viewerId: string;
  viewerIsAdmin: boolean;
}) {
  const sendPath = resolveSendPath(policies.sendPathRouting, {
    email_type: emailTypeFor(contact.type, isFriendAccount),
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
            {contact.stakeholder_role ? (
              <Badge tone="accent" title={contact.influence_level ? `${contact.influence_level} influence` : undefined}>
                {contact.stakeholder_role.replace(/_/g, " ")}
              </Badge>
            ) : null}
            {contact.sentiment && contact.sentiment !== "neutral" ? (
              <Badge tone={contact.sentiment === "positive" ? "ok" : "warn"}>{contact.sentiment}</Badge>
            ) : null}
            {contact.is_opted_out ? (
              <Badge tone="bad" title={contact.opt_out_reason ?? undefined}>
                opted out
              </Badge>
            ) : null}
          </div>
          <p className="mt-0.5 text-xs text-muted">{contact.title ?? "Title unknown"}</p>
          <p className="mt-0.5 font-mono text-xs text-muted">{contact.email ?? "no email on file"}</p>
          {contact.last_interaction_at ? (
            <p className="mt-0.5 text-[11px] text-muted">Last interaction {formatDate(contact.last_interaction_at)} (Compass)</p>
          ) : null}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <DraftAction contact={contact} drafts={drafts} viewerId={viewerId} />
          <Link
            href={`/collateral?account=${contact.account_id}&contact=${contact.id}`}
            className="text-[11px] font-medium text-accent hover:underline"
          >
            Find collateral
          </Link>
          <span
            className="text-[11px] text-muted"
            title="Both paths send from the author's own Microsoft 365 mailbox. Cold emails carry an unsubscribe line."
          >
            would send{" "}
            <span className={sendPath === "warm" ? "text-ok" : "text-cold"}>
              {SEND_PATH_LABEL[sendPath].toLowerCase()}
            </span>
          </span>
          <OptOutForm
            accountId={contact.account_id}
            contactId={contact.id}
            optedOut={contact.is_opted_out}
            canClear={viewerIsAdmin}
          />
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
  draftsByContact,
  viewerId,
  viewerIsAdmin,
  accountId,
  enrichmentAvailable,
}: {
  variant: "engaged" | "committee";
  contacts: Contact[];
  collateralByContact: Map<string, SuggestedCollateral[]>;
  introByContact: Map<string, CrossSellIntro>;
  policies: Policies;
  isFriendAccount: boolean;
  draftsByContact: Map<string, DraftSummary[]>;
  viewerId: string;
  viewerIsAdmin: boolean;
  accountId: string;
  /** Whether this viewer may look for leaders with Apollo. */
  enrichmentAvailable: boolean;
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
        <div className="flex shrink-0 items-baseline gap-3">
          {!engaged && enrichmentAvailable ? (
            <Link href={`/accounts/${accountId}/leaders`} className="text-[11px] font-medium text-accent hover:underline">
              Find leaders
            </Link>
          ) : null}
          <span className="text-xs text-muted">{contacts.length}</span>
        </div>
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
              drafts={draftsByContact.get(contact.id) ?? []}
              viewerId={viewerId}
              viewerIsAdmin={viewerIsAdmin}
            />
          ))}
        </ul>
      ) : (
        <div className="p-4">
          <EmptyState>
            {engaged
              ? "No engaged contacts synced for this account yet."
              : "No leadership contacts yet. Use Find leaders to look them up with Apollo."}
          </EmptyState>
        </div>
      )}
    </section>
  );
}
