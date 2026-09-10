import type {
  AccountLifecycle, AccountTier, AssignmentRole, BusinessFunction, ContactType, EmailStatus,
  EmailType, SendPath,
} from "@/lib/types";

export function relativeDays(days: number | null): string {
  if (days === null) return "never";
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric",
  });
}

export function formatArr(cents: number | null): string {
  if (cents === null) return "-";
  return `$${Math.round(cents / 100_000).toLocaleString("en-US")}k`;
}

export const TIER_LABEL: Record<AccountTier, string> = {
  strategic: "Strategic", enterprise: "Enterprise", mid_market: "Mid-market", smb: "SMB",
};

export const LIFECYCLE_LABEL: Record<AccountLifecycle, string> = {
  existing: "Existing customer",
  churned: "Churned",
  prospect: "Prospect",
};

export const ROLE_LABEL: Record<AssignmentRole, string> = {
  pm: "Project Manager",
  cal: "Client Account Lead",
  csm: "Customer Success Manager",
};

export const ROLE_SHORT: Record<AssignmentRole, string> = { pm: "PM", cal: "CAL", csm: "CSM" };

export const EMAIL_TYPE_LABEL: Record<EmailType, string> = {
  product_update: "Product update",
  cross_sell_intro: "Cross-sell intro",
  friend_account: "Friend-account outreach",
  launch_broadcast: "Launch broadcast",
};

export const SEND_PATH_LABEL: Record<SendPath, string> = { warm: "Warm", cold: "Cold" };

export const EMAIL_STATUS_LABEL: Record<EmailStatus, string> = {
  drafted: "drafted", pending_approval: "awaiting approval", approved: "approved",
  queued: "queued", sent: "sent", opened: "opened", replied: "replied",
  bounced: "bounced", failed: "failed", cancelled: "cancelled",
};

export const FUNCTION_LABEL: Record<BusinessFunction, string> = {
  hr: "HR", marketing: "Marketing", finance: "Finance", sales: "Sales",
  operations: "Operations", it: "IT", legal: "Legal", product: "Product",
  executive: "Executive", other: "Other",
};

export const CONTACT_TYPE_LABEL: Record<ContactType, string> = {
  engaged: "Engaged stakeholder",
  committee: "Leadership committee",
};

export function firstName(fullName: string): string {
  return fullName.split(" ")[0];
}

/** Matches the content_type check constraint on public.collateral. */
export const COLLATERAL_TYPE_LABEL: Record<string, string> = {
  one_pager: "One-pager",
  case_study: "Case study",
  webinar: "Webinar",
  roi_calculator: "ROI calculator",
  guide: "Guide",
  release_note: "Release note",
};

/** "finance:committee" -> "Finance (leadership)". */
export function personaLabel(persona: string): string {
  const [fn, type] = persona.split(":");
  const role = FUNCTION_LABEL[fn as BusinessFunction] ?? fn;
  return type === "committee" ? `${role} (leadership)` : `${role} (engaged)`;
}
