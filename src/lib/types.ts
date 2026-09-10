export type AssignmentRole = "pm" | "cal" | "csm";
export type AccountTier = "strategic" | "enterprise" | "mid_market" | "smb";
export type HealthStatus = "green" | "yellow" | "red" | "unknown";
export type DataSourceSystem = "helix" | "compass" | "enrichment" | "manual";
export type ContactType = "engaged" | "committee";
export type ContactSource = "internal_sync" | "enrichment" | "manual";
export type RelationshipStatus =
  | "champion" | "active" | "dormant" | "cold" | "detractor" | "unknown";
export type BusinessFunction =
  | "hr" | "marketing" | "finance" | "sales" | "operations"
  | "it" | "legal" | "product" | "executive" | "other";
export type EmailType =
  | "product_update" | "cross_sell_intro" | "friend_account" | "launch_broadcast";
export type SendPath = "warm" | "cold";
export type EmailStatus =
  | "drafted" | "pending_approval" | "approved" | "queued"
  | "sent" | "opened" | "replied" | "bounced" | "failed" | "cancelled";

export type AppUser = {
  id: string;
  email: string;
  full_name: string;
  title: string | null;
  is_admin: boolean;
  default_role: AssignmentRole | null;
  warm_sender_address: string | null;
};

/** One row of public.account_overview. */
export type AccountOverview = {
  account_id: string;
  name: string;
  tier: AccountTier;
  health_status: HealthStatus;
  owning_team: string | null;
  domain: string | null;
  renewal_date: string | null;
  arr_cents: number | null;
  is_friend_account: boolean;
  source_system: DataSourceSystem;
  synced_at: string | null;
  sends_this_month: number;
  warm_sends_this_month: number;
  cold_sends_this_month: number;
  last_email_activity_id: string | null;
  last_sent_at: string | null;
  last_subject: string | null;
  last_email_type: EmailType | null;
  last_send_path: SendPath | null;
  last_status: EmailStatus | null;
  last_contact_name: string | null;
  last_sender_name: string | null;
  days_since_last_send: number | null;
  viewer_role: AssignmentRole | null;
  engaged_contact_count: number;
  committee_contact_count: number;
  lifecycle_status: AccountLifecycle;
  lifecycle_changed_at: string | null;
  owner_count: number;
  primary_owner_name: string | null;
};

export type AccountLifecycle = "existing" | "churned" | "prospect";

/** One live row of public.account_assignment, with the owner's name. */
export type Assignment = {
  id: string;
  account_id: string;
  user_id: string;
  role: AssignmentRole;
  is_primary: boolean;
  full_name: string;
  email: string;
};

/** A colleague from the app_user directory who can be given accounts. */
export type Teammate = {
  id: string;
  full_name: string;
  email: string;
  title: string | null;
  is_admin: boolean;
  default_role: AssignmentRole | null;
};

/** One ranked row from public.search_collateral. */
export type CollateralHit = {
  collateral_id: string;
  title: string;
  summary: string | null;
  content_type: string;
  asset_url: string;
  product_names: string[];
  product_keys: string[];
  /** "function:contact_type", e.g. "finance:committee". */
  personas: string[];
  score: number;
};

/** A product, with what Claude needs to map a request onto it. */
export type ProductOption = {
  key: string;
  name: string;
  description: string | null;
  target_functions: BusinessFunction[];
};

/** Claude's reading of a collateral request. Every list may be empty. */
export type CollateralSearchPlan = {
  keywords: string[];
  product_keys: string[];
  functions: BusinessFunction[];
  content_types: string[];
};

export type Contact = {
  id: string;
  account_id: string;
  type: ContactType;
  full_name: string;
  title: string | null;
  business_function: BusinessFunction;
  email: string | null;
  phone: string | null;
  relationship_status: RelationshipStatus;
  is_opted_out: boolean;
  opt_out_reason: string | null;
  source: ContactSource;
  enrichment_confidence: number | null;
};

export type SuggestedCollateral = {
  contact_id: string;
  collateral_id: string;
  slug: string;
  title: string;
  summary: string | null;
  content_type: string;
  asset_url: string;
  product_name: string;
  reason: "product_in_use" | "cross_sell";
};

export type CrossSellIntro = {
  contact_id: string;
  product_id: string;
  product_name: string;
  value_prop: string | null;
  template_id: string | null;
  template_version_id: string | null;
  subject_template: string | null;
  default_send_path: SendPath | null;
};

export type TeamMember = {
  account_id: string;
  user_id: string;
  role: AssignmentRole;
  is_primary: boolean;
  full_name: string;
  email: string;
  title: string | null;
};

export type AccountProductRow = { product: { name: string } | null; status: string };
