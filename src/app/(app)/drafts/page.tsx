import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui";
import { listOpenDrafts, listRecentEmails, type SentSummary } from "@/lib/db/drafts";
import { getCurrentUser } from "@/lib/db/queries";
import { EMAIL_TYPE_LABEL, SEND_PATH_LABEL, formatDate } from "@/lib/format";
import type { DraftSummary } from "@/lib/types";

export const dynamic = "force-dynamic";

function DraftList({ drafts, showAuthor }: { drafts: DraftSummary[]; showAuthor: boolean }) {
  return (
    <ul>
      {drafts.map((draft) => (
        <li key={draft.id} className="border-b border-line last:border-b-0">
          <Link href={`/drafts/${draft.id}`} className="block px-4 py-3 hover:bg-surface-muted">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{draft.subject || "(no subject)"}</span>
              <Badge tone={draft.status === "approved" ? "ok" : "neutral"}>
                {draft.status === "approved" ? "Ready to send" : "Draft"}
              </Badge>
              <Badge tone={draft.send_path === "warm" ? "ok" : "cold"}>
                {SEND_PATH_LABEL[draft.send_path]}
              </Badge>
            </div>
            <p className="mt-0.5 text-xs text-muted">
              To {draft.contact_name}
              {draft.contact_title ? `, ${draft.contact_title}` : ""} at {draft.account_name}
              {" · "}
              {EMAIL_TYPE_LABEL[draft.email_type]}
              {showAuthor ? ` · by ${draft.sender_name}` : ""}
              {" · updated "}
              {formatDate(draft.updated_at)}
            </p>
          </Link>
        </li>
      ))}
    </ul>
  );
}

const DELIVERY: Record<string, { label: string; tone: "ok" | "bad" | "accent" }> = {
  queued: { label: "Queued", tone: "accent" },
  sent: { label: "Sent", tone: "ok" },
  opened: { label: "Sent", tone: "ok" },
  replied: { label: "Replied", tone: "ok" },
  bounced: { label: "Bounced", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
};

function EmailList({ emails, showAuthor }: { emails: SentSummary[]; showAuthor: boolean }) {
  return (
    <ul>
      {emails.map((email) => {
        const delivery = DELIVERY[email.status];
        return (
          <li key={email.id} className="border-b border-line last:border-b-0">
            <Link href={`/drafts/${email.id}`} className="block px-4 py-3 hover:bg-surface-muted">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{email.subject || "(no subject)"}</span>
                {delivery ? <Badge tone={delivery.tone}>{delivery.label}</Badge> : null}
                {email.provider === "dry_run" ? <Badge tone="warn">Test mode</Badge> : null}
                <Badge tone={email.send_path === "warm" ? "ok" : "cold"}>{SEND_PATH_LABEL[email.send_path]}</Badge>
              </div>
              <p className="mt-0.5 text-xs text-muted">
                To {email.contact_name} at {email.account_name}
                {showAuthor ? ` · by ${email.sender_name}` : ""}
                {email.sent_at ? ` · sent ${formatDate(email.sent_at)}` : ` · updated ${formatDate(email.updated_at)}`}
                {email.status === "failed" && email.error_message ? ` · ${email.error_message}` : ""}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export default async function DraftsPage() {
  const [user, drafts, recent] = await Promise.all([getCurrentUser(), listOpenDrafts(), listRecentEmails(30)]);
  const mine = drafts.filter((d) => d.sender_id === user?.id);
  const others = drafts.filter((d) => d.sender_id !== user?.id);
  const myRecent = recent.filter((e) => e.sender_id === user?.id);
  const inFlight = myRecent.filter((e) => e.status === "queued" || e.status === "failed");
  const delivered = myRecent.filter((e) => e.status !== "queued" && e.status !== "failed");

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <h1 className="font-display text-xl font-semibold tracking-tight">Drafts</h1>
      <p className="mt-1 max-w-[70ch] text-sm text-muted">
        Emails being written, marked ready, queued and sent. Every send goes through the checks again
        when you press Send, and leaves from your own Microsoft 365 mailbox.
      </p>

      {inFlight.length ? (
        <>
          <h2 className="mt-6 text-sm font-semibold">Queued or needing attention</h2>
          <Card className="mt-2 overflow-hidden">
            <EmailList emails={inFlight} showAuthor={false} />
          </Card>
        </>
      ) : null}

      <h2 className="mt-6 text-sm font-semibold">Your drafts</h2>
      <Card className="mt-2 overflow-hidden">
        {mine.length ? (
          <DraftList drafts={mine} showAuthor={false} />
        ) : (
          <div className="p-4">
            <EmptyState>
              No drafts yet. Open an account and use Draft with Claude on a contact.
            </EmptyState>
          </div>
        )}
      </Card>

      {others.length ? (
        <>
          <h2 className="mt-6 text-sm font-semibold">Teammates&apos; drafts on your accounts</h2>
          <p className="mt-0.5 text-xs text-muted">
            {user?.is_admin
              ? "Every open draft, since you see all accounts."
              : "Co-owners' drafts count toward the same monthly cap once they send."}
          </p>
          <Card className="mt-2 overflow-hidden">
            <DraftList drafts={others} showAuthor />
          </Card>
        </>
      ) : null}

      <h2 className="mt-6 text-sm font-semibold">Sent by you in the last 30 days</h2>
      <Card className="mt-2 overflow-hidden">
        {delivered.length ? (
          <EmailList emails={delivered} showAuthor={false} />
        ) : (
          <div className="p-4">
            <EmptyState>Nothing sent from the app in the last 30 days.</EmptyState>
          </div>
        )}
      </Card>
    </div>
  );
}
