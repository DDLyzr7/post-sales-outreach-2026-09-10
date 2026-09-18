import { loadPolicies } from "@/lib/policy";
import { searchSkott, type SkottHit } from "@/lib/skott";
import { createClient } from "@/lib/supabase/server";
import type {
  BusinessFunction, CollateralHit, ContactType, ProductOption,
} from "@/lib/types";

/**
 * Collateral reads. Like queries.ts, nothing here filters by user: the collateral
 * library is shared reference data, and the contact lookup relies on RLS to
 * return nothing for a contact the caller can't see.
 *
 * searchLibrary() asks Skott first (semantic search), then the library in
 * Postgres (word match plus product, role and type boosts), and merges the two.
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
  /** Only collateral a client can be sent. */
  shareableOnly?: boolean;
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
    p_shareable_only: filters.shareableOnly ?? false,
  });
  if (error) throw error;
  return (data ?? []) as CollateralHit[];
}

export type LibrarySearch = CollateralFilters & {
  /** A plain-language request for Skott's semantic search. Skott is skipped without one. */
  skottQuery?: string | null;
  /** Drop Skott results scored below this (0-10). */
  skottMinScore?: number;
  skottTimeoutMs?: number;
  /** A Skott search already started, so it can run beside other work. Used instead of skottQuery. */
  skottHits?: Promise<SkottHit[] | null>;
};

export type LibraryResult = {
  hits: CollateralHit[];
  /** "used": Skott answered. "unavailable": it was asked and failed. "skipped": not asked. */
  skott: "used" | "unavailable" | "skipped";
};

/** An id for a Skott result that isn't in the library. It can be shown, never added to an email. */
export const SKOTT_ONLY_PREFIX = "skott:";

/**
 * Skott's results first, in Skott's order, then the library's own matches.
 * Client-shareable Skott results the library doesn't have yet are added to it
 * (record_skott_items only takes public lyzr.ai items of an allowed type), so
 * they can go in an email. Others are shown with a "skott:" id.
 */
export async function searchLibrary(search: LibrarySearch): Promise<LibraryResult> {
  const limit = search.limit ?? 20;
  const supabase = await createClient();

  const [skottHits, libraryHits] = await Promise.all([
    search.skottHits ??
      (search.skottQuery ? searchSkott(search.skottQuery, { limit: 15, timeoutMs: search.skottTimeoutMs }) : Promise.resolve(null)),
    searchCollateral({ ...search, limit }),
  ]);
  if (!skottHits) {
    return { hits: libraryHits.slice(0, limit), skott: search.skottQuery || search.skottHits ? "unavailable" : "skipped" };
  }

  const wanted = skottHits.filter((hit) => (hit.score ?? 10) >= (search.skottMinScore ?? 0));
  if (wanted.length) {
    const { error } = await supabase.rpc("record_skott_items", {
      p_items: wanted.map(({ id, title, type, url, source, published_on }) => ({ id, title, type, url, source, published_on })),
    });
    if (error) console.error("record_skott_items failed:", error.message);
  }

  type Row = {
    id: string; external_id: string; title: string; summary: string | null; content_type: string;
    asset_url: string; client_shareable: boolean;
  };
  const { data: rows } = wanted.length
    ? await supabase
        .from("collateral")
        .select("id, external_id, title, summary, content_type, asset_url, client_shareable")
        .eq("source_system", "skott")
        .in("external_id", wanted.map((hit) => hit.id))
        .eq("is_active", true)
        .is("deleted_at", null)
    : { data: [] };
  const byExternal = new Map(((rows ?? []) as Row[]).map((row) => [row.external_id, row]));

  const typeMap = wanted.some((hit) => !byExternal.has(hit.id))
    ? (await loadPolicies(supabase)).collateral.skott.type_map
    : {};

  const fromSkott: CollateralHit[] = wanted.map((hit) => {
    const row = byExternal.get(hit.id);
    return {
      collateral_id: row?.id ?? `${SKOTT_ONLY_PREFIX}${hit.id}`,
      title: row?.title ?? hit.title,
      summary: row?.summary ?? null,
      content_type: row?.content_type ?? typeMap[hit.type] ?? "other",
      asset_url: row?.asset_url ?? hit.url,
      product_names: [],
      product_keys: [],
      personas: [],
      score: hit.score ?? 0,
      client_shareable: row?.client_shareable ?? false,
      source_system: "skott",
    };
  });

  const seen = new Set<string>();
  const hits = [...fromSkott.filter((hit) => !search.shareableOnly || hit.client_shareable), ...libraryHits].filter((hit) => {
    if (seen.has(hit.collateral_id)) return false;
    seen.add(hit.collateral_id);
    return true;
  });
  return { hits: hits.slice(0, limit), skott: "used" };
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
