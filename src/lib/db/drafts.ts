import { createClient } from "@/lib/supabase/server";
import { searchLibrary } from "@/lib/db/collateral";
import { FUNCTION_LABEL } from "@/lib/format";
import { emailTypeFor } from "@/lib/policy";
import type {
  AccountOverview, BusinessFunction, CollateralFact, CollateralHit, Contact, DraftContext, DraftReview, DraftSummary, EmailStatus, EmailType,
  PastEmail, SendPath, TemplateChoice,
} from "@/lib/types";

/**
 * Reads for drafting. Like queries.ts, nothing here filters by user: RLS limits
 * every row to accounts the caller can see, so a contact or draft on someone
 * else's account comes back as null.
 */

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const CONTACT_FIELDS =
  "id, account_id, type, full_name, title, business_function, email, phone, relationship_status, is_opted_out, opt_out_reason, source, enrichment_confidence, stakeholder_role, influence_level, sentiment, last_interaction_at";

const DAY_MS = 24 * 60 * 60 * 1000;

export function daysSince(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY_MS));
}

export type ProductFact = {
  key: string;
  name: string;
  description: string | null;
  value_prop: string | null;
  target_functions: BusinessFunction[];
  in_use: boolean;
};

/** Everything Claude (or the template fallback) needs to write one email. */
export type DraftingSubject = {
  contact: Contact;
  account: AccountOverview;
  emailType: EmailType;
  products: ProductFact[];
  /** Engaged stakeholders on the account, for "we already work with your X team". */
  engagedContacts: Pick<Contact, "full_name" | "title" | "business_function">[];
  crossSell: { product_name: string; value_prop: string | null } | null;
  template: TemplateChoice | null;
  pastEmails: PastEmail[];
  collateral: CollateralHit[];
  /** Current Helix projects and Compass use cases: names and stages only. */
  engagements: { kind: "project" | "use_case"; name: string; stage: string | null }[];
};

export async function getDraftingSubject(
  accountId: string,
  contactId: string,
  instruction: string | null,
): Promise<DraftingSubject | null> {
  if (!UUID.test(accountId) || !UUID.test(contactId)) return null;
  const supabase = await createClient();

  const [contactRes, accountRes, productRes, accountProductRes, engagedRes, introRes, pastRes, engagementRes, industryRes] =
    await Promise.all([
      supabase
        .from("contact")
        .select(CONTACT_FIELDS)
        .eq("id", contactId)
        .eq("account_id", accountId)
        .is("deleted_at", null)
        .maybeSingle(),
      supabase.from("account_overview").select("*").eq("account_id", accountId).maybeSingle(),
      supabase
        .from("product")
        .select("id, key, name, description, value_prop, target_functions")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("sort_order"),
      supabase.from("account_product").select("product_id, status").eq("account_id", accountId),
      supabase
        .from("contact")
        .select("full_name, title, business_function")
        .eq("account_id", accountId)
        .eq("type", "engaged")
        .is("deleted_at", null),
      supabase
        .from("contact_cross_sell_intro")
        .select("product_name, value_prop")
        .eq("contact_id", contactId)
        .maybeSingle(),
      supabase
        .from("email_activity")
        .select(
          "subject, body_text, sent_at, email_type, contact_id, contact:contact(full_name), sender:app_user!email_activity_sender_id_fkey(full_name)",
        )
        .eq("account_id", accountId)
        .eq("direction", "outbound")
        .not("sent_at", "is", null)
        .is("deleted_at", null)
        .order("sent_at", { ascending: false })
        .limit(6),
      supabase
        .from("account_engagement")
        .select("kind, name, stage, status")
        .eq("account_id", accountId)
        .in("status", ["active", "in_progress"])
        .order("source_updated_at", { ascending: false, nullsFirst: false })
        .limit(8),
      // Only to find fitting collateral; the brief doesn't carry it.
      supabase.from("account").select("industry").eq("id", accountId).maybeSingle(),
    ]);

  const contact = contactRes.data as Contact | null;
  const account = accountRes.data as AccountOverview | null;
  if (!contact || !account) return null;

  const active = new Set(
    ((accountProductRes.data ?? []) as { product_id: string; status: string }[])
      .filter((row) => row.status === "active")
      .map((row) => row.product_id),
  );
  type ProductRow = Omit<ProductFact, "in_use"> & { id: string };
  const products: ProductFact[] = ((productRes.data ?? []) as ProductRow[]).map((p) => ({
    key: p.key,
    name: p.name,
    description: p.description,
    value_prop: p.value_prop,
    target_functions: p.target_functions ?? [],
    in_use: active.has(p.id),
  }));

  const emailType = emailTypeFor(contact.type, account.is_friend_account);

  // Engaged contacts hear about products they use; leadership about ones they don't.
  const fittingKeys = products
    .filter((p) => (contact.type === "engaged" ? p.in_use : !p.in_use))
    .map((p) => p.key);

  const engagements = ((engagementRes.data ?? []) as { kind: "project" | "use_case"; name: string; stage: string | null; status: string | null }[])
    .map(({ kind, name, stage, status }) => ({ kind, name, stage: stage ?? status }));
  const industry = (industryRes.data as { industry: string | null } | null)?.industry ?? null;

  // What Skott is asked for: material a client can read, for this person, near
  // the work they already do with us. Only client-shareable collateral comes back.
  const skottQuery = [
    instruction,
    `Case study, blueprint or playbook for a ${contact.title ?? `${FUNCTION_LABEL[contact.business_function]} leader`}` +
      (industry ? ` in ${industry}` : ""),
    engagements.length ? `Related to: ${engagements.slice(0, 4).map((e) => e.name).join(", ")}` : null,
    products.filter((p) => fittingKeys.includes(p.key)).map((p) => p.name).join(", ") || null,
  ]
    .filter(Boolean)
    .join(". ");

  const [template, library] = await Promise.all([
    getTemplateFor(emailType, account.is_friend_account ? "friend_account" : contact.type),
    searchLibrary({
      query: instruction,
      productKeys: fittingKeys,
      functions: [contact.business_function],
      limit: 6,
      shareableOnly: true,
      skottQuery,
      skottMinScore: 5,
      skottTimeoutMs: 12_000,
    }),
  ]);
  const collateral = library.hits;

  type PastRow = {
    subject: string; body_text: string | null; sent_at: string; email_type: EmailType;
    contact_id: string | null;
    contact: { full_name: string } | null; sender: { full_name: string } | null;
  };

  return {
    contact,
    account,
    emailType,
    products,
    engagedContacts: (engagedRes.data ?? []) as DraftingSubject["engagedContacts"],
    crossSell: (introRes.data as DraftingSubject["crossSell"]) ?? null,
    template,
    pastEmails: ((pastRes.data ?? []) as unknown as PastRow[]).map((row) => ({
      subject: row.subject,
      body_text: row.body_text,
      sent_at: row.sent_at,
      email_type: row.email_type,
      contact_id: row.contact_id,
      contact_name: row.contact?.full_name ?? null,
      sender_name: row.sender?.full_name ?? null,
    })),
    collateral,
    engagements,
  };
}

/** The current version of the active template for this email type and audience. */
async function getTemplateFor(
  emailType: EmailType,
  audience: "engaged" | "committee" | "friend_account",
): Promise<TemplateChoice | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("template")
    .select("id, name, audience, current_version, versions:template_version(id, version, subject_template, body_template)")
    .eq("email_type", emailType)
    .in("audience", [audience, "all"])
    .eq("is_active", true)
    .is("deleted_at", null);

  type Row = {
    id: string; name: string; audience: string; current_version: number;
    versions: { id: string; version: number; subject_template: string; body_template: string }[];
  };
  const rows = ((data ?? []) as Row[]).sort(
    (a, b) => Number(b.audience === audience) - Number(a.audience === audience),
  );
  for (const row of rows) {
    const current = row.versions.find((v) => v.version === row.current_version);
    if (current) {
      return {
        template_id: row.id,
        template_version_id: current.id,
        name: row.name,
        version: current.version,
        subject_template: current.subject_template,
        body_template: current.body_template,
      };
    }
  }
  return null;
}

type DraftRow = {
  id: string;
  account_id: string;
  contact_id: string;
  sender_id: string;
  email_type: EmailType;
  send_path: SendPath;
  status: "drafted" | "approved";
  subject: string;
  updated_at: string;
  account: { name: string } | null;
  contact: { full_name: string; title: string | null } | null;
  sender: { full_name: string } | null;
};

const SUMMARY_FIELDS =
  "id, account_id, contact_id, sender_id, email_type, send_path, status, subject, updated_at, account:account(name), contact:contact(full_name, title), sender:app_user!email_activity_sender_id_fkey(full_name)";

function toSummary(row: DraftRow): DraftSummary {
  return {
    id: row.id,
    account_id: row.account_id,
    account_name: row.account?.name ?? "Unknown account",
    contact_id: row.contact_id,
    contact_name: row.contact?.full_name ?? "Unknown contact",
    contact_title: row.contact?.title ?? null,
    sender_id: row.sender_id,
    sender_name: row.sender?.full_name ?? "Unknown teammate",
    email_type: row.email_type,
    send_path: row.send_path,
    status: row.status,
    subject: row.subject,
    updated_at: row.updated_at,
  };
}

/** Open drafts on every account the caller can see, or on one account. */
export async function listOpenDrafts(accountId?: string): Promise<DraftSummary[]> {
  if (accountId !== undefined && !UUID.test(accountId)) return [];
  const supabase = await createClient();
  let query = supabase
    .from("email_activity")
    .select(SUMMARY_FIELDS)
    .in("status", ["drafted", "approved"])
    .is("deleted_at", null)
    .is("campaign_id", null)
    .order("updated_at", { ascending: false });
  if (accountId) query = query.eq("account_id", accountId);

  const { data, error } = await query;
  if (error) throw error;
  return ((data ?? []) as unknown as DraftRow[]).map(toSummary);
}

export type DraftRecord = {
  id: string;
  account_id: string;
  contact_id: string;
  sender_id: string;
  email_type: EmailType;
  send_path: SendPath;
  status: EmailStatus;
  subject: string;
  body_text: string | null;
  to_email: string | null;
  from_email: string | null;
  template_version_id: string | null;
  draft_context: DraftContext | null;
  presend_review: DraftReview | null;
  approved_at: string | null;
  updated_at: string;
  scheduled_for: string | null;
  sent_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  provider: string | null;
  error_message: string | null;
  send_attempts: number;
  governor_decision: { mode?: string; skip_reason?: string } | null;
};

export type DraftDetail = {
  draft: DraftRecord;
  contact: Contact;
  account: AccountOverview;
  author: { full_name: string; warm_sender_address: string | null };
  template: { name: string; version: number } | null;
  /** The collateral the draft mentions. */
  collateral: CollateralFact[];
  daysSinceContactEmailed: number | null;
  teammateDraftAuthors: string[];
  /** Routine emails holding a slot on the account this month: sent plus queued. */
  slotsUsed: number;
  /** The viewer's own mailbox connection (RLS shows only your own, or all to the lead). */
  mailbox: { status: string; email_address: string } | null;
};

/** Statuses the email page shows: the drafting stage and everything after Send. */
const EMAIL_PAGE_STATUSES = ["drafted", "approved", "queued", "sent", "opened", "replied", "bounced", "failed"];

/** An email written in the app, from draft to delivery, with what the page shows around it. */
export async function getDraft(draftId: string): Promise<DraftDetail | null> {
  if (!UUID.test(draftId)) return null;
  const supabase = await createClient();

  const { data } = await supabase
    .from("email_activity")
    .select(
      "id, account_id, contact_id, sender_id, email_type, send_path, status, subject, body_text, to_email, from_email, template_version_id, draft_context, presend_review, approved_at, updated_at, scheduled_for, sent_at, replied_at, bounced_at, provider, error_message, send_attempts, governor_decision, author:app_user!email_activity_sender_id_fkey(full_name, warm_sender_address), template_version(version, template(name))",
    )
    .eq("id", draftId)
    .in("status", EMAIL_PAGE_STATUSES)
    .is("deleted_at", null)
    .is("campaign_id", null)
    .maybeSingle();

  type Row = DraftRecord & {
    author: { full_name: string; warm_sender_address: string | null } | null;
    template_version: { version: number; template: { name: string } | null } | null;
  };
  const row = data as unknown as Row | null;
  if (!row || !row.contact_id) return null;

  const collateralIds = (row.draft_context?.collateral_ids ?? []).filter((id) => UUID.test(id));

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [contactRes, accountRes, lastSentRes, openDrafts, collateralRes, queuedRes, mailboxRes] = await Promise.all([
    supabase.from("contact").select(CONTACT_FIELDS).eq("id", row.contact_id).maybeSingle(),
    supabase.from("account_overview").select("*").eq("account_id", row.account_id).maybeSingle(),
    supabase
      .from("email_activity")
      .select("sent_at")
      .eq("contact_id", row.contact_id)
      .not("sent_at", "is", null)
      .is("deleted_at", null)
      .order("sent_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    listOpenDrafts(row.account_id),
    collateralIds.length
      ? supabase
          .from("collateral")
          .select("id, title, summary, content_type, asset_url, products:product(name)")
          .in("id", collateralIds)
      : Promise.resolve({ data: [] }),
    supabase
      .from("email_activity")
      .select("id", { count: "exact", head: true })
      .eq("account_id", row.account_id)
      .eq("status", "queued")
      .neq("email_type", "launch_broadcast")
      .is("deleted_at", null),
    supabase.from("mailbox_connection").select("status, email_address").eq("user_id", user?.id ?? "").maybeSingle(),
  ]);

  type CollateralRow = {
    id: string; title: string; summary: string | null; content_type: string; asset_url: string;
    products: { name: string }[] | null;
  };

  const contact = contactRes.data as Contact | null;
  const account = accountRes.data as AccountOverview | null;
  if (!contact || !account) return null;

  const { author, template_version, ...draft } = row;

  return {
    draft,
    contact,
    account,
    author: author ?? { full_name: "Unknown teammate", warm_sender_address: null },
    template: template_version
      ? { name: template_version.template?.name ?? "Template", version: template_version.version }
      : null,
    collateral: ((collateralRes.data ?? []) as unknown as CollateralRow[]).map((item) => ({
      collateral_id: item.id,
      title: item.title,
      summary: item.summary,
      content_type: item.content_type,
      asset_url: item.asset_url,
      product_names: (item.products ?? []).map((p) => p.name),
    })),
    daysSinceContactEmailed: daysSince((lastSentRes.data as { sent_at: string } | null)?.sent_at ?? null),
    teammateDraftAuthors: [
      ...new Set(
        openDrafts.filter((d) => d.sender_id !== row.sender_id).map((d) => d.sender_name),
      ),
    ],
    slotsUsed: account.sends_this_month + (queuedRes.count ?? 0),
    mailbox: (mailboxRes.data as DraftDetail["mailbox"]) ?? null,
  };
}

/** An email past the drafting stage, as the Drafts page lists it. */
export type SentSummary = Omit<DraftSummary, "status"> & {
  status: EmailStatus;
  sent_at: string | null;
  replied_at: string | null;
  bounced_at: string | null;
  provider: string | null;
  error_message: string | null;
};

/**
 * Emails queued, sent or failed in the last `days` days on every account the
 * caller can see. Broadcast rows are listed on their broadcast instead.
 */
export async function listRecentEmails(days = 30): Promise<SentSummary[]> {
  const supabase = await createClient();
  const since = new Date(Date.now() - days * DAY_MS).toISOString();
  const { data, error } = await supabase
    .from("email_activity")
    .select(`${SUMMARY_FIELDS}, sent_at, replied_at, bounced_at, provider, error_message`)
    .in("status", ["queued", "sent", "opened", "replied", "bounced", "failed"])
    .is("deleted_at", null)
    .is("campaign_id", null)
    .gte("updated_at", since)
    .order("updated_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  type Row = Omit<DraftRow, "status"> & Pick<SentSummary, "status" | "sent_at" | "replied_at" | "bounced_at" | "provider" | "error_message">;
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    ...toSummary(row as unknown as DraftRow),
    status: row.status,
    sent_at: row.sent_at,
    replied_at: row.replied_at,
    bounced_at: row.bounced_at,
    provider: row.provider,
    error_message: row.error_message,
  }));
}
