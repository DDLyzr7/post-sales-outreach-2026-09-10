import Link from "next/link";
import { notFound } from "next/navigation";
import { AddLeadersForm, type CandidateView } from "@/components/leader-forms";
import { Badge, Card, EmptyState } from "@/components/ui";
import { peopleSearchFallback, planPeopleSearch, SENIORITY_LABEL, type PeopleSearchPlan } from "@/lib/ai/people-search";
import { UUID } from "@/lib/db/drafts";
import { getAccountDetail, getCurrentUser } from "@/lib/db/queries";
import { FUNCTION_LABEL } from "@/lib/format";
import { loadPolicies } from "@/lib/policy";
import { apolloConfigured, apolloProvider, bareDomain, PAGE_SIZE } from "@/lib/providers/apollo";
import { createClient } from "@/lib/supabase/server";
import type { BusinessFunction } from "@/lib/types";

export const dynamic = "force-dynamic";

const FUNCTIONS: BusinessFunction[] = ["hr", "marketing", "finance", "sales", "operations", "it", "legal", "product", "executive"];

export default async function LeadersPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fn?: string | string[]; search?: string; q?: string; page?: string }>;
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
  // A plain-language request wins; the function checkboxes are the other way in.
  const request = (query.q ?? "").trim().slice(0, 300);
  const page = Math.max(1, Math.min(Number(query.page) || 1, 20));
  const searching = !!request || !!query.search;
  const ready = allowed && apolloConfigured() && !!overview.domain;

  let plan: PeopleSearchPlan | null = null;
  let planByClaude = false;
  if (request && ready) {
    const read = await planPeopleSearch(request, overview.name);
    planByClaude = !!read;
    plan = read ?? peopleSearchFallback(request, policies.enrichment.titles_by_function, policies.enrichment.seniorities);
  }
  const functions = plan ? plan.functions : query.search ? requested : suggested;

  let candidates: CandidateView[] = [];
  let searchError: string | null = null;
  if (searching && ready && overview.domain && (plan ? plan.titles.length > 0 : functions.length > 0)) {
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
        seniorities: plan ? plan.seniorities : policies.enrichment.seniorities,
        titles: plan?.titles,
        keywords: plan?.keywords,
        page,
      });
      candidates = found.map((c) => ({
        ...c,
        alreadyAdded: knownIds.has(c.externalId) || existing.has(c.displayName.toLowerCase()),
      }));
    } catch (error) {
      searchError = error instanceof Error ? error.message : "Apollo search failed.";
    }
  }

  const pageHref = (to: number) => {
    const next = new URLSearchParams();
    if (request) next.set("q", request);
    else {
      next.set("search", "1");
      for (const fn of functions) next.append("fn", fn);
    }
    next.set("page", String(to));
    return `/accounts/${id}/leaders?${next}`;
  };

  return (
    <div className="mx-auto w-full max-w-[900px] px-6 py-6">
      <Link href={`/accounts/${id}`} className="text-xs text-muted hover:text-accent">&larr; {overview.name}</Link>
      <h1 className="mt-2 font-display text-xl font-semibold tracking-tight">Find people at {overview.name}</h1>
      <p className="mt-1 text-sm text-muted">
        Describe the teams and titles you want, and Apollo searches{" "}
        {overview.domain ? bareDomain(overview.domain) : "this account's domain"}.
        Searching is free; adding someone reveals their email and uses Apollo credits. They join the leadership
        committee as cold contacts.
      </p>

      {!allowed ? (
        <Card className="mt-5 p-4"><EmptyState>Only the post-sales lead can look people up.</EmptyState></Card>
      ) : !apolloConfigured() ? (
        <Card className="mt-5 p-4"><EmptyState>Apollo isn&apos;t connected on this server. Add APOLLO_API_KEY to the environment.</EmptyState></Card>
      ) : !overview.domain ? (
        <Card className="mt-5 p-4"><EmptyState>This account has no domain on file, so Apollo can&apos;t search it.</EmptyState></Card>
      ) : (
        <>
          <Card className="mt-5 p-4">
            <form method="get" className="space-y-2">
              <label htmlFor="people-q" className="text-[11px] font-medium uppercase tracking-wide text-muted">
                Who are you looking for?
              </label>
              <div className="flex flex-wrap gap-2">
                <input
                  id="people-q"
                  name="q"
                  defaultValue={request}
                  maxLength={300}
                  placeholder="e.g. HR and talent leaders, director and up"
                  className="min-w-[260px] flex-1 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
                />
                <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                  Search Apollo
                </button>
              </div>
              <p className="text-[11px] text-muted">
                Name teams, titles or levels: &ldquo;the procurement team&rdquo;, &ldquo;CFO or finance
                directors&rdquo;, &ldquo;managers in customer support&rdquo;.
              </p>
            </form>

            {plan ? (
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                <span>{planByClaude ? "Read as:" : "Claude wasn't available; searching:"}</span>
                {plan.titles.map((t) => <Badge key={`t-${t}`}>{t}</Badge>)}
                {plan.seniorities.map((s) => <Badge key={`s-${s}`} tone="accent">{SENIORITY_LABEL[s]}</Badge>)}
                {plan.functions.map((f) => <Badge key={`f-${f}`} tone="cold">{FUNCTION_LABEL[f]}</Badge>)}
                {plan.keywords ? <Badge tone="ok">{plan.keywords}</Badge> : null}
              </div>
            ) : null}

            <details className="mt-4" open={!!query.search && !request}>
              <summary className="cursor-pointer text-[11px] text-muted hover:text-accent">Or pick functions</summary>
              <form method="get" className="mt-2 space-y-3">
                <input type="hidden" name="search" value="1" />
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {FUNCTIONS.map((fn) => (
                    <label key={fn} className="flex items-center gap-1.5 text-xs">
                      <input type="checkbox" name="fn" value={fn} defaultChecked={!request && functions.includes(fn)} />
                      {FUNCTION_LABEL[fn]}
                      {covered.has(fn) ? <span className="text-muted">(on file)</span> : null}
                    </label>
                  ))}
                </div>
                <button type="submit" className="rounded-md border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium hover:border-accent">
                  Search these functions
                </button>
              </form>
            </details>
          </Card>

          {searching ? (
            <Card className="mt-5 p-4">
              {searchError ? (
                <p className="text-xs text-bad">{searchError}</p>
              ) : !plan && !functions.length ? (
                <EmptyState>Choose at least one function, or describe who you&apos;re looking for.</EmptyState>
              ) : candidates.length ? (
                <>
                  <AddLeadersForm accountId={id} candidates={candidates} maxReveals={policies.enrichment.max_reveals_per_request} />
                  <nav className="mt-3 flex items-center gap-3 text-xs" aria-label="Result pages">
                    {page > 1 ? <Link href={pageHref(page - 1)} className="text-accent hover:underline">&larr; Previous</Link> : null}
                    <span className="text-muted">Page {page}</span>
                    {candidates.length >= PAGE_SIZE ? <Link href={pageHref(page + 1)} className="text-accent hover:underline">More people &rarr;</Link> : null}
                  </nav>
                </>
              ) : (
                <EmptyState>
                  {page > 1 ? "No more people for this search." : `Apollo found nobody matching that at ${bareDomain(overview.domain)}. Try broader titles or fewer levels.`}
                </EmptyState>
              )}
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
