import { createClient } from "@/lib/supabase/server";
import type {
  BusinessFunction, CollateralHit, ContactType, ProductOption,
} from "@/lib/types";

/**
 * Collateral reads. Like queries.ts, nothing here filters by user: the collateral
 * library is shared reference data, and the contact lookup relies on RLS to
 * return nothing for a contact the caller can't see.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Active products, for Claude to map a request onto. */
export async function listActiveProducts(): Promise<ProductOption[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product")
    .select("key, name, description, target_functions")
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("sort_order");
  if (error) throw error;
  return (data ?? []) as ProductOption[];
}

export type CollateralFilters = {
  query?: string | null;
  productKeys?: string[];
  functions?: BusinessFunction[];
  contentTypes?: string[];
  limit?: number;
};

/** Ranked search through public.search_collateral. Empty filters list everything. */
export async function searchCollateral(filters: CollateralFilters): Promise<CollateralHit[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_collateral", {
    p_query: filters.query?.trim() || null,
    p_product_keys: filters.productKeys?.length ? filters.productKeys : null,
    p_functions: filters.functions?.length ? filters.functions : null,
    p_content_types: filters.contentTypes?.length ? filters.contentTypes : null,
    p_limit: filters.limit ?? 20,
  });
  if (error) throw error;
  return (data ?? []) as CollateralHit[];
}

export type CollateralContext = {
  accountId: string;
  accountName: string;
  contactId: string;
  contactName: string;
  contactTitle: string | null;
  contactType: ContactType;
  businessFunction: BusinessFunction;
  /** Products that fit this contact: in use for engaged, not yet used for leadership. */
  productKeys: string[];
};

/** Who a search is for. Null when the ids are malformed or RLS hides the contact. */
export async function getCollateralContext(
  accountId: string,
  contactId: string,
): Promise<CollateralContext | null> {
  if (!UUID.test(accountId) || !UUID.test(contactId)) return null;
  const supabase = await createClient();

  const [contactRes, accountRes, productRes, inUseRes] = await Promise.all([
    supabase
      .from("contact")
      .select("id, full_name, title, type, business_function")
      .eq("id", contactId)
      .eq("account_id", accountId)
      .is("deleted_at", null)
      .maybeSingle(),
    supabase.from("account").select("name").eq("id", accountId).maybeSingle(),
    supabase.from("product").select("key").eq("is_active", true).is("deleted_at", null),
    supabase
      .from("account_product")
      .select("status, product:product(key)")
      .eq("account_id", accountId),
  ]);

  const contact = contactRes.data as {
    id: string; full_name: string; title: string | null;
    type: ContactType; business_function: BusinessFunction;
  } | null;
  if (!contact || !accountRes.data) return null;

  type InUse = { status: string; product: { key: string } | null };
  const inUse = new Set(
    ((inUseRes.data ?? []) as unknown as InUse[])
      .filter((row) => row.status === "active" && row.product)
      .map((row) => row.product!.key),
  );
  const allKeys = ((productRes.data ?? []) as { key: string }[]).map((p) => p.key);

  return {
    accountId,
    accountName: (accountRes.data as { name: string }).name,
    contactId: contact.id,
    contactName: contact.full_name,
    contactTitle: contact.title,
    contactType: contact.type,
    businessFunction: contact.business_function,
    productKeys:
      contact.type === "engaged"
        ? allKeys.filter((key) => inUse.has(key))
        : allKeys.filter((key) => !inUse.has(key)),
  };
}
