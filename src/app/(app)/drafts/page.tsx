import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui";
import { listOpenDrafts } from "@/lib/db/drafts";
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

export default async function DraftsPage() {
  const [user, drafts] = await Promise.all([getCurrentUser(), listOpenDrafts()]);
  const mine = drafts.filter((d) => d.sender_id === user?.id);
  const others = drafts.filter((d) => d.sender_id !== user?.id);

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <h1 className="font-display text-xl font-semibold tracking-tight">Drafts</h1>
      <p className="mt-1 max-w-[70ch] text-sm text-muted">
        Emails being written and emails marked ready. Nothing sends yet: sending arrives in the
        next phase, and every send will go through the pre-send check again.
      </p>

      <h2 className="mt-6 text-sm font-semibold">Yours</h2>
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
    </div>
  );
}
