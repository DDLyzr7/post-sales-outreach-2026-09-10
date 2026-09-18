import type { SupabaseClient } from "@supabase/supabase-js";
import { listSkott } from "@/lib/skott";

/**
 * The Skott feed. Reads list_kb in full, then mirrors it into collateral: new items
 * are added, known ones refreshed, and listed items that have gone are retired
 * (is_active = false, never deleted, because past emails point at them).
 *
 * - Types map through app_policy.collateral_rules.skott.type_map; anything
 *   unknown is "other".
 * - client_shareable is set by a trigger from the same policy row, so the rule
 *   for what can go in an email lives in one place.
 * - Items only a search found (listed_at is null) are never retired here: list_kb
 *   stops at 100 in some sections, so their absence proves nothing.
 * - If the listing is much shorter than last time, nothing is retired.
 */

type CollateralRules = {
  skott: { type_map: Record<string, string>; retire_min_ratio: number };
};

export type SkottJobSummary = {
  listed: number;
  created: number;
  updated: number;
  retired: number;
  /** Active Skott items a client can be sent, after this run. */
  shareable: number;
  byType: Record<string, number>;
  warnings: string[];
};

async function must<T = unknown>(label: string, query: PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T> {
  const { data, error } = await query;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data as T;
}

type Existing = { id: string; external_id: string; is_active: boolean; listed_at: string | null };

export async function runSkottJob(service: SupabaseClient): Promise<SkottJobSummary> {
  const policyRow = await must<{ value: CollateralRules } | null>(
    "app_policy",
    service.from("app_policy").select("value").eq("key", "collateral_rules").maybeSingle(),
  );
  if (!policyRow) throw new Error("app_policy.collateral_rules is missing; push migration 20260918000100.");
  const { type_map: typeMap, retire_min_ratio: retireMinRatio } = policyRow.value.skott;

  // 1. Read Skott before writing anything.
  const items = await listSkott();
  if (items.length === 0) throw new Error("Skott list_kb returned no items; nothing changed.");

  // 2. What's already here, paged past PostgREST's 1,000-row limit.
  const existing: Existing[] = [];
  for (let from = 0; ; from += 1000) {
    const page = await must<Existing[]>(
      "collateral",
      service
        .from("collateral")
        .select("id, external_id, is_active, listed_at")
        .eq("source_system", "skott")
        .order("id")
        .range(from, from + 999),
    );
    existing.push(...page);
    if (page.length < 1000) break;
  }
  const known = new Set(existing.map((row) => row.external_id));

  const summary: SkottJobSummary = { listed: items.length, created: 0, updated: 0, retired: 0, shareable: 0, byType: {}, warnings: [] };
  const now = new Date().toISOString();

  // 3. Upsert everything listed.
  const rows = items.map((item) => {
    const contentType = typeMap[item.type] ?? "other";
    summary.byType[contentType] = (summary.byType[contentType] ?? 0) + 1;
    if (known.has(item.id)) summary.updated += 1;
    else summary.created += 1;
    return {
      slug: `skott-${item.id}`,
      title: item.title.slice(0, 300),
      asset_url: item.url,
      content_type: contentType,
      source_system: "skott",
      external_id: item.id,
      source_origin: item.source,
      published_on: item.published_on,
      listed_at: now,
      is_active: true,
      deleted_at: null,
    };
  });
  for (let i = 0; i < rows.length; i += 200) {
    await must("collateral upsert", service.from("collateral").upsert(rows.slice(i, i + 200), { onConflict: "source_system,external_id" }));
  }

  // 4. Retire listed items that are gone, unless the listing looks short.
  const listedIds = new Set(items.map((item) => item.id));
  const previouslyListed = existing.filter((row) => row.is_active && row.listed_at);
  const gone = previouslyListed.filter((row) => !listedIds.has(row.external_id));
  if (gone.length && items.length < previouslyListed.length * retireMinRatio) {
    summary.warnings.push(
      `Skott listed ${items.length} items, against ${previouslyListed.length} last time, so ${gone.length} missing item(s) were left active.`,
    );
  } else {
    for (let i = 0; i < gone.length; i += 200) {
      await must(
        "collateral retire",
        service.from("collateral").update({ is_active: false }).in("id", gone.slice(i, i + 200).map((row) => row.id)),
      );
    }
    summary.retired = gone.length;
  }

  const { count } = await service
    .from("collateral")
    .select("id", { count: "exact", head: true })
    .eq("source_system", "skott")
    .eq("is_active", true)
    .eq("client_shareable", true);
  summary.shareable = count ?? 0;

  return summary;
}
