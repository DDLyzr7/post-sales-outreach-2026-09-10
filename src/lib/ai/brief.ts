import type { DraftingSubject } from "@/lib/db/drafts";
import { CONTACT_TYPE_LABEL, EMAIL_TYPE_LABEL, FUNCTION_LABEL, LIFECYCLE_LABEL, formatDate } from "@/lib/format";
import type { CollateralFact, SendPath } from "@/lib/types";

/**
 * The facts Claude writes and reviews a draft from, as one block of text. Both
 * calls read the same brief, so the review checks the draft against exactly
 * what the writer was given. Revenue, health, renewal and enrichment details are
 * left out on purpose: they must never end up in an email. So are Compass's CS
 * notes, risks and sentiment; from Helix and Compass the brief takes only the
 * names and stages of current work and the recipient's stakeholder role.
 */

const PAST_BODY_LIMIT = 800;

function section(tag: string, body: string): string {
  return `<${tag}>\n${body.trim()}\n</${tag}>`;
}

export function buildBrief(
  subject: DraftingSubject,
  sender: { full_name: string; title: string | null },
  sendPath: SendPath,
  options: {
    includeTemplate: boolean;
    /** The library to choose from when writing, or what the draft mentions when reviewing. */
    collateral: CollateralFact[];
    collateralTag: "collateral" | "collateral_mentioned";
  },
): string {
  const { contact, account, products } = subject;
  const parts: string[] = [];

  parts.push(
    section(
      "email",
      [
        `Type: ${EMAIL_TYPE_LABEL[subject.emailType]}`,
        sendPath === "warm"
          ? "Send path: warm, from the sender's own mailbox"
          : "Send path: cold, from a dedicated outreach domain",
      ].join("\n"),
    ),
  );

  parts.push(section("sender", `${sender.full_name}${sender.title ? `, ${sender.title}` : ""}`));

  parts.push(
    section(
      "recipient",
      [
        `Name: ${contact.full_name}`,
        `Title: ${contact.title ?? "unknown"}`,
        `Function: ${FUNCTION_LABEL[contact.business_function]}`,
        `Contact type: ${CONTACT_TYPE_LABEL[contact.type]}`,
        `Relationship: ${contact.relationship_status}`,
        ...(contact.stakeholder_role ? [`Stakeholder role: ${contact.stakeholder_role.replace(/_/g, " ")}`] : []),
      ].join("\n"),
    ),
  );

  const inUse = products.filter((p) => p.in_use);
  const notInUse = products.filter((p) => !p.in_use);
  const describe = (p: (typeof products)[number]) =>
    `- ${p.name}${p.description ? `: ${p.description}` : ""}${p.value_prop ? ` Value: ${p.value_prop}` : ""}` +
    ` (usually for: ${p.target_functions.map((fn) => FUNCTION_LABEL[fn]).join(", ") || "anyone"})`;

  parts.push(
    section(
      "account",
      [
        `Name: ${account.name}`,
        `Lifecycle: ${LIFECYCLE_LABEL[account.lifecycle_status]}${account.is_friend_account ? " (friend account, not a customer yet)" : ""}`,
        `Products in use:\n${inUse.map(describe).join("\n") || "- none"}`,
        `Products not in use:\n${notInUse.map(describe).join("\n") || "- none"}`,
      ].join("\n"),
    ),
  );

  if (subject.engagements.length) {
    parts.push(
      section(
        "current_work_with_us",
        subject.engagements
          .map((e) => `- ${e.name} (${e.kind === "use_case" ? "use case" : "project"}${e.stage ? `, ${e.stage.replace(/_/g, " ")}` : ""})`)
          .join("\n"),
      ),
    );
  }

  if (contact.type === "committee" && subject.engagedContacts.length) {
    const teams = [...new Set(subject.engagedContacts.map((c) => FUNCTION_LABEL[c.business_function]))];
    parts.push(section("teams_we_already_work_with", teams.join(", ")));
  }

  if (subject.crossSell) {
    parts.push(
      section(
        "suggested_cross_sell",
        `${subject.crossSell.product_name}${subject.crossSell.value_prop ? `: ${subject.crossSell.value_prop}` : ""}`,
      ),
    );
  }

  if (options.includeTemplate && subject.template) {
    parts.push(
      section(
        "template",
        `${subject.template.name}, version ${subject.template.version}\nSubject: ${subject.template.subject_template}\n\n${subject.template.body_template}`,
      ),
    );
  }

  parts.push(
    section(
      "recent_emails_to_this_account",
      subject.pastEmails.length
        ? subject.pastEmails
            .map((email) => {
              const body = (email.body_text ?? "").slice(0, PAST_BODY_LIMIT);
              return `<email sent="${formatDate(email.sent_at)}" to="${email.contact_name ?? "unknown"}" from="${email.sender_name ?? "unknown"}" type="${EMAIL_TYPE_LABEL[email.email_type]}">\nSubject: ${email.subject}\n${body}\n</email>`;
            })
            .join("\n")
        : "None yet.",
    ),
  );

  parts.push(
    section(
      options.collateralTag,
      options.collateral.length
        ? options.collateral
            .map(
              (item) =>
                `- id ${item.collateral_id}: "${item.title}" (${item.content_type.replace(/_/g, " ")}; ${item.product_names.join(", ") || "no product"})${item.summary ? ` ${item.summary}` : ""}`,
            )
            .join("\n")
        : "None.",
    ),
  );

  return parts.join("\n\n");
}
