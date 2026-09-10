import Link from "next/link";
import { Badge, Card, EmptyState } from "@/components/ui";
import { planCollateralSearch } from "@/lib/ai/collateral-search";
import { getCollateralContext, listActiveProducts, searchCollateral } from "@/lib/db/collateral";
import { COLLATERAL_TYPE_LABEL, FUNCTION_LABEL, personaLabel } from "@/lib/format";
import type { BusinessFunction } from "@/lib/types";

export const dynamic = "force-dynamic";

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export default async function CollateralPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; account?: string; contact?: string }>;
}) {
  const { q, account, contact } = await searchParams;
  const query = (q ?? "").trim().slice(0, 300);

  const [context, products] = await Promise.all([
    account && contact ? getCollateralContext(account, contact) : Promise.resolve(null),
    listActiveProducts(),
  ]);

  const plan = query ? await planCollateralSearch(query, products) : null;

  // Claude's reading of the request, plus the contact's role and fitting products
  // when the search is for someone. All of these rank; none of them exclude.
  const productKeys = unique([...(plan?.product_keys ?? []), ...(context?.productKeys ?? [])]);
  const functions = unique<BusinessFunction>([
    ...(plan?.functions ?? []),
    ...(context ? [context.businessFunction] : []),
  ]);
  const hits = await searchCollateral({
    query: query ? (plan?.keywords.length ? plan.keywords.join(" ") : query) : null,
    productKeys,
    functions,
    contentTypes: plan?.content_types ?? [],
  });

  const productName = new Map(products.map((p) => [p.key, p.name]));
  const clearContextHref = query ? `/collateral?q=${encodeURIComponent(query)}` : "/collateral";

  return (
    <div className="mx-auto w-full max-w-[1100px] px-6 py-8">
      <h1 className="font-display text-xl font-semibold tracking-tight">Collateral</h1>
      <p className="mt-1 max-w-[70ch] text-sm text-muted">
        Describe what you need in plain words. Claude reads the request, and the library is
        ranked by product, role and content type.
      </p>

      {context ? (
        <div className="mt-5 flex flex-wrap items-center gap-2 rounded-md border border-line bg-surface-muted px-3 py-2 text-xs">
          <span>
            Finding material for <span className="font-medium">{context.contactName}</span>
            {context.contactTitle ? `, ${context.contactTitle}` : ""} at{" "}
            <Link href={`/accounts/${context.accountId}`} className="font-medium hover:text-accent">
              {context.accountName}
            </Link>
          </span>
          <Badge tone={context.contactType === "committee" ? "cold" : "accent"}>
            {context.contactType === "committee" ? "leadership" : "engaged"}
          </Badge>
          <Link href={clearContextHref} className="ml-auto text-muted hover:text-accent">
            Search for anyone
          </Link>
        </div>
      ) : null}

      <form action="/collateral" method="get" className="mt-5 flex flex-wrap gap-2">
        {context ? (
          <>
            <input type="hidden" name="account" value={context.accountId} />
            <input type="hidden" name="contact" value={context.contactId} />
          </>
        ) : null}
        <label className="sr-only" htmlFor="collateral-q">What do you need?</label>
        <input
          id="collateral-q"
          name="q"
          defaultValue={query}
          maxLength={300}
          placeholder="e.g. something for a CFO worried about duplicate vendor spend"
          className="min-w-[260px] flex-1 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm outline-none focus:border-accent"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          Search
        </button>
      </form>

      {query ? (
        plan ? (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted">
            <span>Read as:</span>
            {plan.keywords.map((k) => <Badge key={`k-${k}`}>{k}</Badge>)}
            {plan.product_keys.map((k) => (
              <Badge key={`p-${k}`} tone="accent">{productName.get(k) ?? k}</Badge>
            ))}
            {plan.functions.map((f) => <Badge key={`f-${f}`} tone="cold">{FUNCTION_LABEL[f]}</Badge>)}
            {plan.content_types.map((t) => (
              <Badge key={`t-${t}`} tone="ok">{COLLATERAL_TYPE_LABEL[t] ?? t}</Badge>
            ))}
            {plan.keywords.length + plan.product_keys.length + plan.functions.length + plan.content_types.length === 0
              ? <span>nothing specific, so this is a plain word search</span>
              : null}
          </div>
        ) : (
          <p className="mt-3 text-xs text-warn">
            Claude wasn&apos;t available for this search, so the results come from a plain word match.
          </p>
        )
      ) : null}

      <Card className="mt-6 overflow-hidden">
        {hits.length === 0 ? (
          <div className="p-6">
            <EmptyState>
              Nothing in the library matches that yet. Try different words; the library fills from
              Skott once it&apos;s connected.
            </EmptyState>
          </div>
        ) : (
          <ul>
            {hits.map((hit) => (
              <li key={hit.collateral_id} className="border-b border-line px-4 py-3.5 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={hit.asset_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium hover:text-accent"
                  >
                    {hit.title}
                  </a>
                  <Badge tone="ok">{COLLATERAL_TYPE_LABEL[hit.content_type] ?? hit.content_type}</Badge>
                  {hit.product_names.map((name) => <Badge key={name} tone="accent">{name}</Badge>)}
                </div>
                {hit.summary ? <p className="mt-1 max-w-[80ch] text-xs text-muted">{hit.summary}</p> : null}
                {hit.personas.length ? (
                  <p className="mt-1.5 text-[11px] text-muted">
                    For: {hit.personas.map(personaLabel).join(", ")}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted">
        The library holds sample collateral until the Skott feed is connected. Links open the
        collateral itself; nothing is tracked.
      </p>
    </div>
  );
}
