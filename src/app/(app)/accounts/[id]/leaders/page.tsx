import Link from "next/link";
import { notFound } from "next/navigation";
import { AddLeadersForm, type CandidateView } from "@/components/leader-forms";
import { Card, EmptyState } from "@/components/ui";
import { UUID } from "@/lib/db/drafts";
import { getAccountDetail, getCurrentUser } from "@/lib/db/queries";
import { FUNCTION_LABEL } from "@/lib/format";
import { loadPolicies } from "@/lib/policy";
import { apolloConfigured, apolloProvider } from "@/lib/providers/apollo";
import { createClient } from "@/lib/supabase/server";
import type { BusinessFunction } from "@/lib/types";

export const dynamic = "force-dynamic";

const FUNCTIONS: BusinessFunction[] = ["hr", "marketing", "finance", "sales", "operations", "it", "legal", "product", "executive"];

export default async function LeadersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fn?: string | string[]; search?: string }>;
}) {
  const { id } = await params;
  const query = await searchParams;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const [detail, user, policies, { data: products }, { data: accountProducts }] = await Promise.all([
    getAccountDetail(id),
    getCurrentUser(),
    loadPolicies(supabase),
    supabase.from("product").select("id, target_functions").eq("is_active", true),
    supabase.from("account_product").select("product_id, status").eq("account_id", id),
  ]);
  // RLS: an account you can't see is a 404.
  if (!detail || !user) notFound();

  const { overview, committee, engaged } = detail;
  const allowed = policies.enrichment.who_can_enrich === "owners_and_lead" || user.is_admin;

  // Default: functions targeted by products the account doesn't use, minus leaders already on file.
  const inUse = new Set(((accountProducts ?? []) as { product_id: string; status: string }[]).filter((p) => p.status === "active").map((p) => p.product_id));
  const covered = new Set(committee.map((c) => c.business_function));
  const suggested = [
    ...new Set(
      ((products ?? []) as { id: string; target_functions: BusinessFunction[] }[])
        .filter((p) => !inUse.has(p.id))
        .flatMap((p) => p.target_functions),
    ),
  ].filter((fn) => !covered.has(fn) && fn !== "executive");

  const requested = (Array.isArray(query.fn) ? query.fn : query.fn ? [query.fn] : []).filter((fn): fn is BusinessFunction =>
    FUNCTIONS.includes(fn as BusinessFunction),
  );
  const functions = query.search ? requested : suggested;

  let candidates: CandidateView[] = [];
  let searchError: string | null = null;
  if (query.search && allowed && apolloConfigured() && overview.domain && functions.length) {
    try {
      const existing = new Set([...committee, ...engaged].map((c) => c.full_name.toLowerCase()));
      const { data: known } = await supabase
        .from("contact")
        .select("external_id")
        .eq("account_id", id)
        .eq("enrichment_provider", "apollo")
        .is("deleted_at", null);
      const knownIds = new Set(((known ?? []) as { external_id: string | null }[]).map((k) => k.external_id));
      const found = await apolloProvider.search({
        accountId: id,
        companyName: overview.name,
        companyDomain: overview.domain,
        functions,
        titlesByFunction: policies.enrichment.titles_by_function,
        seniorities: policies.enrichment.seniorities,
      });
      candidates = found.map((c) => ({
        ...c,
        alreadyAdded: knownIds.has(c.externalId) || existing.has(c.displayName.toLowerCase()),
      }));
    } catch (error) {
      searchError = error instanceof Error ? error.message : "Apollo search failed.";
    }
  }

  return (
    <div className="mx-auto w-full max-w-[900px] px-6 py-6">
      <Link href={`/accounts/${id}`} className="text-xs text-muted hover:text-accent">&larr; {overview.name}</Link>
      <h1 className="mt-2 font-display text-xl font-semibold tracking-tight">Find leaders at {overview.name}</h1>
      <p className="mt-1 text-sm text-muted">
        Searches Apollo for functional leaders at {overview.domain ?? "this account's domain"}. Searching is free; adding
        someone reveals their email and uses Apollo credits. They join the leadership committee as cold contacts.
      </p>

      {!allowed ? (
        <Card className="mt-5 p-4"><EmptyState>Only the post-sales lead can look up leaders.</EmptyState></Card>
      ) : !apolloConfigured() ? (
        <Card className="mt-5 p-4"><EmptyState>Apollo isn&apos;t connected on this server. Add APOLLO_API_KEY to the environment.</EmptyState></Card>
      ) : !overview.domain ? (
        <Card className="mt-5 p-4"><EmptyState>This account has no domain on file, so Apollo can&apos;t search it.</EmptyState></Card>
      ) : (
        <>
          <Card className="mt-5 p-4">
            <form method="get" className="space-y-3">
              <input type="hidden" name="search" value="1" />
              <fieldset>
                <legend className="text-[11px] font-medium uppercase tracking-wide text-muted">Look for leaders in</legend>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {FUNCTIONS.map((fn) => (
                    <label key={fn} className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" name="fn" value={fn} defaultChecked={functions.includes(fn)} />
                      {FUNCTION_LABEL[fn]}
                      {covered.has(fn) ? <span className="text-muted">(on file)</span> : null}
                    </label>
                  ))}
                </div>
              </fieldset>
              <button type="submit" className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium hover:border-accent">
                Search Apollo
              </button>
            </form>
          </Card>

          {query.search ? (
            <Card className="mt-5 p-4">
              {searchError ? (
                <p className="text-xs text-bad">{searchError}</p>
              ) : !functions.length ? (
                <EmptyState>Choose at least one function.</EmptyState>
              ) : candidates.length ? (
                <AddLeadersForm accountId={id} candidates={candidates} maxReveals={policies.enrichment.max_reveals_per_request} />
              ) : (
                <EmptyState>Apollo found nobody matching those titles at {overview.domain}.</EmptyState>
              )}
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
