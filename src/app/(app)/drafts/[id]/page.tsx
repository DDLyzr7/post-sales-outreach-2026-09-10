import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import {
  DiscardDraftButton, DraftEditor, RedraftForm, SendEmailForm, StopSendingButton,
} from "@/components/draft-forms";
import { getDraft } from "@/lib/db/drafts";
import { getCurrentUser } from "@/lib/db/queries";
import {
  COLLATERAL_TYPE_LABEL, CONTACT_TYPE_LABEL, EMAIL_TYPE_LABEL, SEND_PATH_LABEL, formatDate,
} from "@/lib/format";
import { loadPolicies } from "@/lib/policy";
import { blockers, draftDigest, runPresendChecks, type CheckStatus } from "@/lib/presend";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const CHECK_ICON: Record<CheckStatus, { mark: string; className: string; label: string }> = {
  pass: { mark: "✓", className: "text-ok", label: "Passed" },
  warn: { mark: "!", className: "text-warn", label: "Warning" },
  block: { mark: "✕", className: "text-bad", label: "Blocks marking ready" },
};

const DELIVERY_LABEL: Record<string, { label: string; tone: "ok" | "warn" | "bad" | "neutral" | "accent" }> = {
  queued: { label: "Queued", tone: "accent" },
  sent: { label: "Sent", tone: "ok" },
  opened: { label: "Sent", tone: "ok" },
  replied: { label: "Replied", tone: "ok" },
  bounced: { label: "Bounced", tone: "bad" },
  failed: { label: "Failed", tone: "bad" },
};

function formatDateTime(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

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
  const drafting = draft.status === "drafted" || ready;
  const delivery = drafting ? null : DELIVERY_LABEL[draft.status];
  const body = draft.body_text ?? "";
  const context = draft.draft_context;
  const mode = policies.sending.mode;

  const checks = runPresendChecks({
    contact,
    sendsThisMonth: detail.slotsUsed,
    sendPath: draft.send_path,
    sendingMode: mode,
    mailbox: mine ? detail.mailbox : null,
    subject: draft.subject,
    body,
    daysSinceContactEmailed: detail.daysSinceContactEmailed,
    teammateDraftAuthors: mine ? detail.teammateDraftAuthors : [],
    policies,
  });
  const review = draft.presend_review;
  const reviewCurrent = review ? review.digest === draftDigest(draft.subject, body) : false;

  // Both paths send from the author's own Microsoft 365 mailbox.
  const from = drafting
    ? mine && detail.mailbox?.status === "connected"
      ? detail.mailbox.email_address
      : `${author.full_name}'s Microsoft mailbox`
    : (draft.from_email ?? `${author.full_name}'s mailbox`);

  const sendBlocked =
    blockers(checks)[0]?.label ??
    (mode === "paused"
      ? "Sending is paused by the post-sales lead."
      : mode === "live" && detail.mailbox?.status !== "connected"
        ? "Connect your mailbox in Settings first."
        : null);
  const dryRun = draft.provider === "dry_run" || draft.governor_decision?.mode === "dry_run";

  return (
    <div className="mx-auto w-full max-w-[1400px] px-6 py-6">
      <Link href={`/accounts/${account.account_id}`} className="text-xs text-muted hover:text-accent">
        &larr; {account.name}
      </Link>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h1 className="font-display text-xl font-semibold tracking-tight">
          {drafting ? "Draft" : "Email"} to {contact.full_name}
        </h1>
        {delivery ? (
          <Badge tone={delivery.tone}>{delivery.label}</Badge>
        ) : (
          <Badge tone={ready ? "ok" : "neutral"}>{ready ? "Ready to send" : "Draft"}</Badge>
        )}
        {dryRun && !drafting ? <Badge tone="warn">Test mode</Badge> : null}
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
          {!drafting ? (
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Delivery</h2>
              <dl className="mt-2 grid gap-x-4 gap-y-1.5 text-xs sm:grid-cols-[8rem_1fr]">
                {draft.status === "queued" ? (
                  <>
                    <dt className="text-muted">Queued</dt>
                    <dd>
                      {formatDateTime(draft.scheduled_for)}. The send job picks it up within a minute.
                      {draft.send_attempts > 0 ? ` Attempt ${draft.send_attempts}.` : ""}
                    </dd>
                  </>
                ) : null}
                {draft.sent_at ? (
                  <>
                    <dt className="text-muted">Sent</dt>
                    <dd>
                      {formatDateTime(draft.sent_at)} from {draft.from_email ?? "the author's mailbox"}
                      {dryRun ? " (test mode: nothing was delivered)" : ""}
                    </dd>
                  </>
                ) : null}
                {draft.replied_at ? (
                  <>
                    <dt className="text-muted">Replied</dt>
                    <dd>{formatDateTime(draft.replied_at)}</dd>
                  </>
                ) : null}
                {draft.bounced_at ? (
                  <>
                    <dt className="text-muted">Bounced</dt>
                    <dd>{formatDateTime(draft.bounced_at)}. Check the address before emailing {contact.full_name} again.</dd>
                  </>
                ) : null}
                {draft.error_message ? (
                  <>
                    <dt className="text-muted">{draft.status === "failed" ? "Failed" : "Last problem"}</dt>
                    <dd className="text-bad">{draft.error_message}</dd>
                  </>
                ) : null}
              </dl>
              {draft.status === "sent" && !dryRun ? (
                <p className="mt-2 text-[11px] text-muted">
                  Replies and bounces are picked up from your inbox every few minutes. Opens aren&apos;t tracked.
                </p>
              ) : null}
              {draft.status === "failed" ? (
                <p className="mt-2 text-[11px] text-muted">
                  Nothing was delivered. Fix the problem, then start a new draft for {contact.full_name}.
                </p>
              ) : null}
              {mine && draft.status === "queued" ? (
                <div className="mt-3">
                  <StopSendingButton draftId={draft.id} />
                </div>
              ) : null}
            </Card>
          ) : null}

          {mine && ready ? (
            <Card className="p-4">
              <h2 className="text-sm font-semibold">Send</h2>
              <p className="mt-0.5 mb-3 text-xs text-muted">
                {mode === "dry_run"
                  ? "Sending is in test mode: the email is recorded as sent and counts toward the cap, but nothing is delivered."
                  : `Sends from your Microsoft 365 mailbox to ${contact.email ?? "the contact"}. Every check runs again when you press Send.`}
              </p>
              <SendEmailForm
                draftId={draft.id}
                recipient={contact.email ?? contact.full_name}
                disabledReason={sendBlocked}
                testMode={mode === "dry_run"}
              />
            </Card>
          ) : null}

          <Card className="p-4">
            {mine && drafting ? (
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
                <dl className="grid gap-1 text-xs sm:grid-cols-[4rem_1fr]">
                  <dt className="text-muted">From</dt>
                  <dd className="font-mono">{from}</dd>
                  <dt className="text-muted">To</dt>
                  <dd className="font-mono">{draft.to_email ?? contact.email ?? "no email on file"}</dd>
                </dl>
                {drafting ? (
                  <p className="text-xs text-muted">
                    Only {author.full_name} can edit this draft. It sends from their mailbox.
                  </p>
                ) : null}
                <p className="font-medium">{draft.subject}</p>
                <pre className="whitespace-pre-wrap font-sans leading-relaxed">{body}</pre>
              </div>
            )}
          </Card>

          {mine && draft.status === "drafted" ? (
            <Card className="p-4">
              <RedraftForm draftId={draft.id} instruction={context?.instruction ?? null} />
            </Card>
          ) : null}

          {mine && drafting ? <DiscardDraftButton draftId={draft.id} /> : null}
        </div>

        <aside className="space-y-5">
          {drafting ? (
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
          ) : null}

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
                  Not checked yet.{mine && drafting ? " Use Save and check with Claude." : ""}
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
                <dt className="text-muted">Collateral linked</dt>
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
              Collateral goes in as a plain link in the body; nothing is tracked. Delete the link to take it out.
            </p>
          </Card>
        </aside>
      </div>
    </div>
  );
}
