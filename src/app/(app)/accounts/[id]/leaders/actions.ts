"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/db/queries";
import { loadPolicies } from "@/lib/policy";
import { apolloConfigured, apolloProvider } from "@/lib/providers/apollo";
import { createClient } from "@/lib/supabase/server";

/**
 * Adds the leaders the owner picked. Each reveal costs Apollo credits, so the
 * request is capped by app_policy.enrichment_rules.max_reveals_per_request and who
 * may run it follows who_can_enrich. The contact insert itself goes through RLS
 * (contact_insert: only people who can see the account).
 */

export type LeadersState = { error: string | null; notice: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APOLLO_ID = /^[0-9a-f]{24}$/i;

export async function addLeaders(_prev: LeadersState, formData: FormData): Promise<LeadersState> {
  const accountId = String(formData.get("account_id") ?? "");
  const ids = [...new Set(formData.getAll("person_id").map(String).filter((id) => APOLLO_ID.test(id)))];
  if (!UUID.test(accountId)) return { error: "That account could not be found.", notice: null };
  if (!ids.length) return { error: "Tick the people to add.", notice: null };
  if (!apolloConfigured()) return { error: "APOLLO_API_KEY isn't set on this server.", notice: null };

  const supabase = await createClient();
  const [user, policies, { data: account }] = await Promise.all([
    getCurrentUser(),
    loadPolicies(supabase),
    supabase.from("account").select("id").eq("id", accountId).maybeSingle(),
  ]);
  if (!user || !account) return { error: "That account could not be found.", notice: null };
  if (policies.enrichment.who_can_enrich === "lead_only" && !user.is_admin) {
    return { error: "Only the post-sales lead can look up leaders.", notice: null };
  }
  const max = policies.enrichment.max_reveals_per_request;
  if (ids.length > max) return { error: `Pick at most ${max} people at a time. Each one uses Apollo credits.`, notice: null };

  let added = 0;
  const skipped: string[] = [];
  for (const id of ids) {
    let person;
    try {
      person = await apolloProvider.reveal(id);
    } catch (error) {
      return {
        error: `${added ? `Added ${added}, then ` : ""}${error instanceof Error ? error.message : "Apollo failed."}`,
        notice: null,
      };
    }
    if (!person) { skipped.push("one person Apollo couldn't match"); continue; }
    if (!person.email) { skipped.push(`${person.fullName} (no email)`); continue; }

    const { error } = await supabase.from("contact").insert({
      account_id: accountId,
      type: "committee",
      full_name: person.fullName,
      title: person.title,
      business_function: person.businessFunction,
      email: person.email,
      linkedin_url: person.linkedinUrl,
      relationship_status: "cold",
      source: "enrichment",
      external_id: person.externalId,
      enrichment_provider: "apollo",
      enrichment_confidence: person.confidence,
      enriched_at: new Date().toISOString(),
    });
    if (error?.code === "23505") { skipped.push(`${person.fullName} (already on the account)`); continue; }
    if (error) return { error: `Added ${added}, then: ${error.message}`, notice: null };
    added += 1;
  }

  revalidatePath(`/accounts/${accountId}`);
  revalidatePath(`/accounts/${accountId}/leaders`);
  return {
    error: null,
    notice: `Added ${added} to the leadership committee.${skipped.length ? ` Skipped: ${skipped.join(", ")}.` : ""}`,
  };
}
