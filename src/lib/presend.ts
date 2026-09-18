import { createHash } from "node:crypto";
import { linkHosts } from "@/lib/collateral-links";
import { relativeDays } from "@/lib/format";
import type { Policies, SendingMode } from "@/lib/policy";
import { findPlaceholders } from "@/lib/template";
import type { SendPath } from "@/lib/types";

/**
 * The rule half of the pre-send check. Plain facts in, a list of checks out, so
 * the page shows the same answer the server action enforces. Thresholds come
 * from policy. Postgres independently refuses to mark an email ready for an
 * opted-out contact or one with no address, and send_email() runs the cap,
 * opt-out, sending mode and mailbox checks again when Send is pressed.
 *
 * "block" stops marking ready. Problems that only stop sending (no mailbox
 * connected, sending paused) are "warn" here, with the reason, and are enforced
 * by send_email().
 */

export type CheckStatus = "pass" | "warn" | "block";

export type PresendCheck = {
  key: string;
  status: CheckStatus;
  label: string;
  detail: string;
};

export type PresendInput = {
  contact: {
    full_name: string;
    email: string | null;
    is_opted_out: boolean;
    opt_out_reason: string | null;
  };
  /** Routine emails holding a slot on the account this month: sent plus queued. */
  sendsThisMonth: number;
  sendPath: SendPath;
  sendingMode: SendingMode;
  /** The author's mailbox connection, or null if they never connected one. */
  mailbox: { status: string; email_address: string } | null;
  subject: string;
  body: string;
  /** Days since this contact was last sent an email, or null if never. */
  daysSinceContactEmailed: number | null;
  /** Names of other people with an open draft on the same account. */
  teammateDraftAuthors: string[];
  policies: Pick<Policies, "frequencyCap" | "drafting" | "collateral">;
};

export function runPresendChecks(input: PresendInput): PresendCheck[] {
  const checks: PresendCheck[] = [];
  const { contact, policies } = input;

  if (contact.is_opted_out) {
    checks.push({
      key: "opt_out",
      status: "block",
      label: "Contact has opted out",
      detail: contact.opt_out_reason
        ? `${contact.full_name} opted out: ${contact.opt_out_reason}`
        : `${contact.full_name} opted out of email.`,
    });
  } else if (!contact.email) {
    checks.push({
      key: "recipient",
      status: "block",
      label: "No email address",
      detail: `There's no email address on file for ${contact.full_name}.`,
    });
  } else {
    checks.push({
      key: "recipient",
      status: "pass",
      label: "Recipient can be emailed",
      detail: `To ${contact.email}. Not opted out.`,
    });
  }

  const cap = policies.frequencyCap.max_sends_per_account_per_month;
  const sent = input.sendsThisMonth;
  if (sent >= cap) {
    checks.push({
      key: "frequency_cap",
      status: "block",
      label: "Monthly cap reached",
      detail: `${sent} of ${cap} emails already sent or queued for this account this month. It can't take another until next month. Broadcasts don't count.`,
    });
  } else if (sent >= policies.frequencyCap.warn_at_sends) {
    checks.push({
      key: "frequency_cap",
      status: "warn",
      label: "Close to the monthly cap",
      detail: `${sent} of ${cap} sent or queued for this account this month. This email would make ${sent + 1}.`,
    });
  } else {
    checks.push({
      key: "frequency_cap",
      status: "pass",
      label: "Within the monthly cap",
      detail: `${sent} of ${cap} sent or queued for this account this month. Broadcasts don't count.`,
    });
  }

  // Both paths send from the author's own Microsoft 365 mailbox (decided 2026-09-13).
  const path = input.sendPath === "warm" ? "Warm" : "Cold";
  const connected = input.mailbox?.status === "connected";
  if (input.sendingMode === "paused") {
    checks.push({
      key: "sending_identity",
      status: "warn",
      label: "Sending is paused",
      detail: "The post-sales lead has paused sending. You can mark this ready; it sends once sending is back on.",
    });
  } else if (input.sendingMode === "live" && !connected) {
    checks.push({
      key: "sending_identity",
      status: "warn",
      label: input.mailbox?.status === "needs_reconnect" ? "Reconnect your mailbox" : "Mailbox not connected",
      detail: "Emails send from your own Microsoft 365 mailbox. Connect it in Settings before pressing Send.",
    });
  } else if (input.sendingMode === "dry_run") {
    checks.push({
      key: "sending_identity",
      status: "warn",
      label: "Test mode",
      detail: `${path} path. Sending is in test mode: Send records the email as sent, but nothing reaches ${contact.full_name}.`,
    });
  } else {
    checks.push({
      key: "sending_identity",
      status: "pass",
      label: "Sends from your mailbox",
      detail: `${path} path, from ${input.mailbox!.email_address}.${input.sendPath === "cold" ? " Includes an unsubscribe line." : ""}`,
    });
  }

  if (!input.subject.trim() || !input.body.trim()) {
    checks.push({
      key: "content",
      status: "block",
      label: !input.subject.trim() ? "Subject is empty" : "Body is empty",
      detail: "Write a subject and a body before marking this ready.",
    });
  }

  const placeholders = findPlaceholders(`${input.subject}\n${input.body}`);
  if (placeholders.length) {
    checks.push({
      key: "placeholders",
      status: "block",
      label: "Unfilled placeholders",
      detail: `Fill in or remove: ${placeholders.join(", ")}`,
    });
  }

  // SharePoint and OneDrive links usually only open for Lyzr staff.
  const internalHosts = policies.collateral.email.internal_link_hosts.map((host) => host.toLowerCase());
  const internal = linkHosts(input.body).filter((host) =>
    internalHosts.some((suffix) => host === suffix || host.endsWith(`.${suffix}`)),
  );
  if (internal.length) {
    checks.push({
      key: "internal_links",
      status: "warn",
      label: "Link to an internal file",
      detail: `Links to ${internal.join(", ")} usually open only for Lyzr staff. Use a public link, or take it out.`,
    });
  }

  const days = input.daysSinceContactEmailed;
  if (days !== null && days < policies.drafting.recent_contact_warn_days) {
    checks.push({
      key: "recent_contact",
      status: "warn",
      label: "Emailed recently",
      detail: `${contact.full_name} was last emailed ${relativeDays(days)}.`,
    });
  } else {
    checks.push({
      key: "recent_contact",
      status: "pass",
      label: days === null ? "First email from the app" : "Not emailed recently",
      detail:
        days === null
          ? `Nobody has emailed ${contact.full_name} from the app yet.`
          : `${contact.full_name} was last emailed ${relativeDays(days)}.`,
    });
  }

  const others = input.teammateDraftAuthors;
  if (others.length) {
    checks.push({
      key: "teammate_drafts",
      status: "warn",
      label: "Teammates have drafts here",
      detail: `${others.join(", ")} ${others.length === 1 ? "has" : "have"} a draft open for this account. Every send counts toward the same monthly cap.`,
    });
  }

  return checks;
}

export function blockers(checks: PresendCheck[]): PresendCheck[] {
  return checks.filter((check) => check.status === "block");
}

/** Identifies the exact subject and body Claude reviewed. */
export function draftDigest(subject: string, body: string): string {
  return createHash("sha256").update(`${subject}\n\n${body}`).digest("hex");
}
