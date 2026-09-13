import type { EnrichedContact, EnrichmentCandidate, EnrichmentProvider, EnrichmentQuery } from "@/lib/providers";
import type { BusinessFunction } from "@/lib/types";

/**
 * Apollo leadership enrichment (decided 2026-09-13). Server-only: APOLLO_API_KEY
 * never reaches the browser.
 *
 *   search  POST /api/v1/mixed_people/api_search   free, no emails, last names obfuscated
 *   reveal  POST /api/v1/people/match {id}          costs credits, returns email
 */

const APOLLO = "https://api.apollo.io/api/v1";

export function apolloConfigured(): boolean {
  return !!process.env.APOLLO_API_KEY;
}

/** Best guess at a business function from a job title. */
export function functionFromTitle(title: string | null, fallback: BusinessFunction = "other"): BusinessFunction {
  const t = ` ${(title ?? "").toLowerCase()} `;
  const rules: [RegExp, BusinessFunction][] = [
    [/\b(chro|people|human resources|hr|talent)\b/, "hr"],
    [/\b(cmo|marketing|brand|growth)\b/, "marketing"],
    [/\b(cfo|finance|financial|controller|treasur)/, "finance"],
    [/\b(cro|revenue|sales|commercial)\b/, "sales"],
    [/\b(coo|operations|operating|supply chain|logistics)\b/, "operations"],
    [/\b(cio|cto|ciso|information|technology|it|digital|security|engineering)\b/, "it"],
    [/\b(legal|counsel|compliance|risk)\b/, "legal"],
    [/\b(cpo|product)\b/, "product"],
    [/\b(ceo|president|founder|managing director|chief executive)\b/, "executive"],
  ];
  return rules.find(([pattern]) => pattern.test(t))?.[1] ?? fallback;
}

class ApolloError extends Error {}

async function apollo<T>(path: string, params: URLSearchParams): Promise<T> {
  const key = process.env.APOLLO_API_KEY;
  if (!key) throw new ApolloError("APOLLO_API_KEY is not set.");
  const response = await fetch(`${APOLLO}${path}?${params}`, {
    method: "POST",
    headers: { "x-api-key": key, "content-type": "application/json", "cache-control": "no-cache", accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as T & { error?: string; message?: string };
  if (!response.ok) {
    throw new ApolloError(`Apollo returned ${response.status}: ${json.error ?? json.message ?? "request refused"}`);
  }
  return json;
}

type SearchPerson = {
  id: string;
  first_name?: string | null;
  last_name_obfuscated?: string | null;
  title?: string | null;
  has_email?: boolean;
};

type MatchPerson = {
  id: string;
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  title?: string | null;
  email?: string | null;
  email_status?: string | null;
  linkedin_url?: string | null;
};

const CONFIDENCE: Record<string, number> = { verified: 0.95, likely_to_engage: 0.8, extrapolated: 0.6, unverified: 0.5 };

export const apolloProvider: EnrichmentProvider = {
  name: "apollo",

  async search(query: EnrichmentQuery): Promise<EnrichmentCandidate[]> {
    const params = new URLSearchParams();
    params.append("q_organization_domains_list[]", query.companyDomain);
    const titles = query.functions.flatMap((fn) => query.titlesByFunction[fn] ?? []);
    for (const title of titles) params.append("person_titles[]", title);
    for (const seniority of query.seniorities) params.append("person_seniorities[]", seniority);
    params.set("per_page", "25");
    params.set("page", "1");

    const result = await apollo<{ people?: SearchPerson[] }>("/mixed_people/api_search", params);
    const wanted = new Set(query.functions);
    return (result.people ?? [])
      .map((person) => {
        const businessFunction = functionFromTitle(person.title ?? null);
        return {
          externalId: person.id,
          displayName: [person.first_name, person.last_name_obfuscated].filter(Boolean).join(" ") || "Name hidden",
          title: person.title ?? null,
          businessFunction,
          hasEmail: !!person.has_email,
        };
      })
      // Titles match loosely, so keep the people whose title reads as a function we asked for first.
      .sort((a, b) => Number(wanted.has(b.businessFunction)) - Number(wanted.has(a.businessFunction)));
  },

  async reveal(externalId: string): Promise<EnrichedContact | null> {
    const params = new URLSearchParams({ id: externalId, reveal_personal_emails: "false", reveal_phone_number: "false" });
    const result = await apollo<{ person?: MatchPerson | null }>("/people/match", params);
    const person = result.person;
    if (!person) return null;
    const fullName = person.name || [person.first_name, person.last_name].filter(Boolean).join(" ");
    if (!fullName) return null;
    return {
      externalId: person.id,
      fullName,
      title: person.title ?? null,
      businessFunction: functionFromTitle(person.title ?? null),
      email: person.email && !person.email.includes("email_not_unlocked") ? person.email.toLowerCase() : null,
      linkedinUrl: person.linkedin_url ?? null,
      confidence: CONFIDENCE[person.email_status ?? ""] ?? 0.5,
    };
  },
};
