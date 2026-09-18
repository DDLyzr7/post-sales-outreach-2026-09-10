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
  /** Can go in a client email (collateral_rules). */
  client_shareable: boolean;
  /** "skott", or null for the sample and lead-added collateral. */
  source_system: string | null;
};

/** Collateral as a draft brief describes it. */
export type CollateralFact = Pick<
  CollateralHit, "collateral_id" | "title" | "summary" | "content_type" | "asset_url" | "product_names"
>;

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
  /** From Compass: exec_sponsor, champion, technical_buyer, end_user. */
  stakeholder_role: string | null;
  influence_level: string | null;
  sentiment: string | null;
  last_interaction_at: string | null;
};

/** A dated item on a Compass account plan. */
export type PlanItem = {
  title: string;
  description: string | null;
  status: string | null;
  owner: string | null;
  due_date: string | null;
};

/** Compass's customer-success picture of an account (public.account_context). */
export type AccountContext = {
  health_score: number | null;
  health_label: string | null;
  health_narrative: string | null;
  renewal_posture: string | null;
  motion: string | null;
  is_plg: boolean | null;
  lifecycle_stages: string[];
  project_stage: string | null;
  agents_deployed: number | null;
  live_use_cases: number | null;
  client_brief: string | null;
  current_state: string | null;
  expansion_opportunity: string | null;
  recommended_strategy: string | null;
  delivery_concern: string | null;
  commercial_concern: string | null;
  cs_notes: string | null;
  upsell_notes: string | null;
  top_risks: PlanItem[];
  open_decisions: PlanItem[];
  next_actions: PlanItem[];
  recent_updates: { summary: string; sentiment: string | null; event_at: string | null }[];
  source_updated_at: string | null;
  synced_at: string;
};

/** An owner named in Helix or Compass who hasn't signed in yet (public.account_pending_owner). */
export type PendingOwner = {
  account_id: string;
  email: string;
  full_name: string | null;
  role: AssignmentRole;
  is_primary: boolean;
};

/** A Helix project or a Compass use case (public.account_engagement). */
export type AccountEngagement = {
  id: string;
  source_system: DataSourceSystem;
  kind: "project" | "use_case";
  name: string;
  description: string | null;
  status: string | null;
  stage: string | null;
  health: string | null;
  owner_name: string | null;
  blocker: string | null;
  start_date: string | null;
  end_date: string | null;
  source_updated_at: string | null;
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

/** What a draft was built from. Stored as email_activity.draft_context. */
export type DraftContext = {
  source: "claude" | "template";
  model: string | null;
  instruction: string | null;
  collateral_ids: string[];
  notes_for_owner: string[];
  recent_email_count: number;
  generated_at: string;
};

export type ReviewFlag = {
  severity: "warn" | "info";
  kind: "unsupported_claim" | "wrong_product" | "tone" | "sensitive_content"
    | "repeats_recent_email" | "recipient_fit" | "other";
  note: string;
};

/** Claude's advisory pre-send review. Stored as email_activity.presend_review. */
export type DraftReview = {
  /** Hash of the subject and body that were reviewed. */
  digest: string;
  reviewed_at: string;
  summary: string;
  flags: ReviewFlag[];
};

/** An open draft (drafted or marked ready), as lists show it. */
export type DraftSummary = {
  id: string;
  account_id: string;
  account_name: string;
  contact_id: string;
  contact_name: string;
  contact_title: string | null;
  sender_id: string;
  sender_name: string;
  email_type: EmailType;
  send_path: SendPath;
  status: "drafted" | "approved";
  subject: string;
  updated_at: string;
};

/** A sent email from the account's history, trimmed for Claude and the page. */
export type PastEmail = {
  subject: string;
  body_text: string | null;
  sent_at: string;
  email_type: EmailType;
  contact_id: string | null;
  contact_name: string | null;
  sender_name: string | null;
};

export type TemplateChoice = {
  template_id: string;
  template_version_id: string;
  name: string;
  version: number;
  subject_template: string;
  body_template: string;
};
