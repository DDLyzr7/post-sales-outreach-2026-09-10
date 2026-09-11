import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { DiscardDraftButton, DraftEditor, RedraftForm } from "@/components/draft-forms";
import { getDraft } from "@/lib/db/drafts";
import { getCurrentUser } from "@/lib/db/queries";
import {
  COLLATERAL_TYPE_LABEL, CONTACT_TYPE_LABEL, EMAIL_TYPE_LABEL, SEND_PATH_LABEL, formatDate,
} from "@/lib/format";
import { loadPolicies } from "@/lib/policy";
import { draftDigest, runPresendChecks, type CheckStatus } from "@/lib/presend";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CHECK_ICON: Record<CheckStatus, { mark: string; className: string; label: string }> = {
  pass: { mark: "✓", className: "text-ok", label: "Passed" },
  warn: { mark: "!", className: "text-warn", label: "Warning" },
  block: { mark: "✕", className: "text-bad", label: "Blocks marking ready" },
};

const FLAG_KIND_LABEL: Record<string, string> = {
  unsupported_claim: "Unsupported claim",
  wrong_product: "Wrong product",
  tone: "Tone",
  sensitive_content: "Sensitive content",
  repeats_recent_email: "Repeats a recent email",
  recipient_fit: "Recipient fit",
  other: "Other",
};

export default async function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const [detail, user, policies] = await Promise.all([
    getDraft(id),
    getCurrentUser(),
    loadPolicies(supabase),
  ]);

  // RLS hides drafts on accounts the caller can't see; discarded drafts are gone too.
  if (!detail || !user) notFound();

  const { draft, contact, account, author } = detail;
  const mine = draft.sender_id === user.id;
  const ready = draft.status === "approved";
  const body = draft.body_text ?? "";
  const context = draft.draft_context;

  const checks = runPresendChecks({
    contact,
    sendsThisMonth: account.sends_this_month,
    sendPath: draft.send_path,
    senderAddress: author.warm_sender_address,
    subject: draft.subject,
    body,
    daysSinceContactEmailed: detail.daysSinceContactEmailed,
    teammateDraftAuthors: mine ? detail.teammateDraftAuthors : [],
    policies,
  });
  const review = draft.presend_review;
  const reviewCurrent = review ? review.digest === draftDigest(draft.subject, body) : false;

  const from =
    draft.send_path === "warm"
      ? (author.warm_sender_address ?? "no sending address set")
      : "a cold outreach domain (not connected yet)";

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
      <Link href={`/accounts/${account.account_id}`} className="text-xs text-muted hover:text-accent">
        &larr; {account.name}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-xl font-semibold tracking-tight">
          Draft to {contact.full_name}
        </h1>
        <Badge tone={ready ? "ok" : "neutral"}>{ready ? "Ready to send" : "Draft"}</Badge>
        <Badge>{EMAIL_TYPE_LABEL[draft.email_type]}</Badge>
        <Badge tone={draft.send_path === "warm" ? "ok" : "cold"}>
          {SEND_PATH_LABEL[draft.send_path]} path
        </Badge>
      </div>
      <p className="mt-1 text-xs text-muted">
        {contact.title ?? "Title unknown"} &middot; {CONTACT_TYPE_LABEL[contact.type]} at {account.name}
        {mine ? "" : ` · written by ${author.full_name}`}
        {ready && draft.approved_at ? ` · marked ready ${formatDate(draft.approved_at)}` : ""}
      </p>

      {context?.source === "template" ? (
        <p className="mt-3 rounded-md border border-line bg-warn-soft px-3 py-2 text-xs text-warn">
          Claude wasn&apos;t available, so this is the template with the known details filled in.
          Anything in [[double brackets]] still needs writing.
        </p>
      ) : null}

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-5">
          <Card className="p-4">
            {mine ? (
              <DraftEditor
                draftId={draft.id}
                subject={draft.subject}
                body={body}
                from={from}
                to={contact.email ?? "no email on file"}
                ready={ready}
                version={draft.updated_at}
              />
            ) : (
              <div className="space-y-3 text-sm">
                <p className="text-xs text-muted">
                  Only {author.full_name} can edit this draft. It sends from their mailbox.
                </p>
                <p className="font-medium">{draft.subject}</p>
                <pre className="whitespace-pre-wrap font-sans leading-relaxed">{body}</pre>
              </div>
            )}
          </Card>

          {mine && !ready ? (
            <Card className="p-4">
              <RedraftForm draftId={draft.id} instruction={context?.instruction ?? null} />
            </Card>
          ) : null}

          {mine ? <DiscardDraftButton draftId={draft.id} /> : null}
        </div>

        <aside className="space-y-5">
          <Card>
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">Pre-send check</h2>
              <p className="mt-0.5 text-xs text-muted">
                On the saved draft. Anything marked ✕ has to be fixed before it can be marked ready.
              </p>
            </div>
            <ul>
              {checks.map((check) => {
                const icon = CHECK_ICON[check.status];
                return (
                  <li key={check.key} className="flex gap-2.5 border-b border-line px-4 py-2.5 last:border-b-0">
                    <span aria-label={icon.label} className={`w-3 shrink-0 text-center text-sm font-semibold ${icon.className}`}>
                      {icon.mark}
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-medium">{check.label}</p>
                      <p className="mt-0.5 text-[11px] text-muted">{check.detail}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">Claude&apos;s review</h2>
              <p className="mt-0.5 text-xs text-muted">Advice only. It never stops you marking a draft ready.</p>
            </div>
            <div className="px-4 py-3">
              {review ? (
                <>
                  {!reviewCurrent ? (
                    <p className="mb-2">
                      <Badge tone="warn">The draft changed after this check</Badge>
                    </p>
                  ) : null}
                  <p className="text-xs">{review.summary}</p>
                  {review.flags.length ? (
                    <ul className="mt-2 space-y-2">
                      {review.flags.map((flag, index) => (
                        <li key={index} className="text-xs">
                          <Badge tone={flag.severity === "warn" ? "warn" : "neutral"}>
                            {FLAG_KIND_LABEL[flag.kind] ?? flag.kind}
                          </Badge>
                          <p className="mt-1 text-muted">{flag.note}</p>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <p className="mt-2 text-[11px] text-muted">Checked {formatDate(review.reviewed_at)}</p>
                </>
              ) : (
                <p className="text-xs text-muted">
                  Not checked yet.{mine ? " Use Save and check with Claude." : ""}
                </p>
              )}
            </div>
          </Card>

          <Card>
            <div className="border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold">What this draft used</h2>
            </div>
            <dl className="space-y-2.5 px-4 py-3 text-xs">
              <div>
                <dt className="text-muted">Written by</dt>
                <dd>
                  {context?.source === "claude" ? "Claude" : "The template, without Claude"}
                  {context?.generated_at ? `, ${formatDate(context.generated_at)}` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Template</dt>
                <dd>
                  {detail.template ? `${detail.template.name}, version ${detail.template.version}` : "No template"}
                </dd>
              </div>
              <div>
                <dt className="text-muted">Recent emails read</dt>
                <dd>{context ? context.recent_email_count : 0} from this account&apos;s history</dd>
              </div>
              {context?.instruction ? (
                <div>
                  <dt className="text-muted">Note for Claude</dt>
                  <dd>{context.instruction}</dd>
                </div>
              ) : null}
              <div>
                <dt className="text-muted">Collateral mentioned</dt>
                <dd>
                  {detail.collateral.length ? (
                    <ul className="mt-0.5 space-y-1">
                      {detail.collateral.map((item) => (
                        <li key={item.collateral_id} className="flex flex-wrap items-center gap-1.5">
                          <a href={item.asset_url} target="_blank" rel="noreferrer" className="font-medium hover:text-accent">
                            {item.title}
                          </a>
                          <Badge>{COLLATERAL_TYPE_LABEL[item.content_type] ?? item.content_type}</Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    "None"
                  )}
                </dd>
              </div>
              {context?.notes_for_owner.length ? (
                <div>
                  <dt className="text-muted">Claude&apos;s notes for you</dt>
                  <dd>
                    <ul className="mt-0.5 list-disc space-y-0.5 pl-4">
                      {context.notes_for_owner.map((note) => <li key={note}>{note}</li>)}
                    </ul>
                  </dd>
                </div>
              ) : null}
            </dl>
            <p className="border-t border-line px-4 py-2.5 text-[11px] text-muted">
              Collateral is named, not linked. How it goes into emails waits on Skott.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
