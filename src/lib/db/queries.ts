import { createClient } from "@/lib/supabase/server";
import type {
  AccountOverview, AppUser, Assignment, AssignmentRole, Contact, CrossSellIntro,
  SuggestedCollateral, TeamMember, Teammate,
} from "@/lib/types";

/**
 * All reads below go through the request-scoped, JWT-bearing client. None of
 * them filter by user id in application code - Postgres RLS already restricts
 * the result set to accounts the caller is assigned to (or everything, if they
 * are the post-sales lead). The queries would return the same rows if a caller
 * hand-crafted them against the REST endpoint.
 */

export async function getCurrentUser(): Promise<AppUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("app_user")
    .select("id, email, full_name, title, is_admin, default_role, warm_sender_address")
    .eq("id", user.id)
    .maybeSingle();

  return (data as AppUser) ?? null;
}

/** Every account the caller is accountable for. No owner filter in this code. */
export async function listMyAccounts(): Promise<AccountOverview[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("account_overview")
    .select("*")
    .order("name");
  if (error) throw error;
  return (data ?? []) as AccountOverview[];
}

export type AccountDetail = {
  overview: AccountOverview;
  team: TeamMember[];
  products: { name: string; status: string }[];
  engaged: Contact[];
  committee: Contact[];
  collateralByContact: Map<string, SuggestedCollateral[]>;
  introByContact: Map<string, CrossSellIntro>;
};

/** Returns null when the account does not exist OR the caller cannot see it -
 *  RLS makes those two cases indistinguishable, which is the point. */
export async function getAccountDetail(accountId: string): Promise<AccountDetail | null> {
  const supabase = await createClient();

  const { data: overview } = await supabase
    .from("account_overview")
    .select("*")
    .eq("account_id", accountId)
    .maybeSingle();

  if (!overview) return null;

  const [teamRes, productRes, contactRes, collateralRes, introRes] = await Promise.all([
    supabase
      .from("account_team_member")
      .select("*")
      .eq("account_id", accountId)
      .order("is_primary", { ascending: false }),
    supabase
      .from("account_product")
      .select("status, product:product(name, sort_order)")
      .eq("account_id", accountId),
    supabase
      .from("contact")
      .select(
        "id, account_id, type, full_name, title, business_function, email, phone, relationship_status, is_opted_out, opt_out_reason, source, enrichment_confidence",
      )
      .eq("account_id", accountId)
      .is("deleted_at", null)
      .order("full_name"),
    supabase.from("contact_suggested_collateral").select("*").eq("account_id", accountId),
    supabase.from("contact_cross_sell_intro").select("*").eq("account_id", accountId),
  ]);

  const contacts = (contactRes.data ?? []) as Contact[];

  const collateralByContact = new Map<string, SuggestedCollateral[]>();
  for (const row of (collateralRes.data ?? []) as SuggestedCollateral[]) {
    const list = collateralByContact.get(row.contact_id) ?? [];
    list.push(row);
    collateralByContact.set(row.contact_id, list);
  }

  const introByContact = new Map<string, CrossSellIntro>();
  for (const row of (introRes.data ?? []) as CrossSellIntro[]) {
    introByContact.set(row.contact_id, row);
  }

  type ProductJoin = { status: string; product: { name: string; sort_order: number } | null };
  const products = ((productRes.data ?? []) as unknown as ProductJoin[])
    .filter((r) => r.product !== null)
    .sort((a, b) => (a.product!.sort_order ?? 0) - (b.product!.sort_order ?? 0))
    .map((r) => ({ name: r.product!.name, status: r.status }));

  return {
    overview: overview as AccountOverview,
    team: (teamRes.data ?? []) as TeamMember[],
    products,
    engaged: contacts.filter((c) => c.type === "engaged"),
    committee: contacts.filter((c) => c.type === "committee"),
    collateralByContact,
    introByContact,
  };
}

/** Live owner assignments on every account the caller can see. */
export async function listAssignments(): Promise<Assignment[]> {
  const supabase = await createClient();
  // account_assignment has three foreign keys to app_user (user, created_by,
  // updated_by), so the embed names the one it means.
  const { data, error } = await supabase
    .from("account_assignment")
    .select(
      "id, account_id, user_id, role, is_primary, owner:app_user!account_assignment_user_id_fkey(full_name, email)",
    )
    .is("deleted_at", null)
    .order("is_primary", { ascending: false });
  if (error) throw error;

  type Row = {
    id: string;
    account_id: string;
    user_id: string;
    role: AssignmentRole;
    is_primary: boolean;
    owner: { full_name: string; email: string } | null;
  };
  return ((data ?? []) as unknown as Row[]).map((row) => ({
    id: row.id,
    account_id: row.account_id,
    user_id: row.user_id,
    role: row.role,
    is_primary: row.is_primary,
    full_name: row.owner?.full_name ?? "Unknown teammate",
    email: row.owner?.email ?? "",
  }));
}

/** The colleague directory: everyone active who could own an account. */
export async function listTeammates(): Promise<Teammate[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("app_user")
    .select("id, full_name, email, title, is_admin, default_role")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("full_name");
  if (error) throw error;
  return (data ?? []) as Teammate[];
}
