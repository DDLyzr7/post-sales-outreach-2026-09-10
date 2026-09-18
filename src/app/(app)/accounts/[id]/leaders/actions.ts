"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/db/queries";
import { loadPolicies } from "@/lib/policy";
import { apolloConfigured, apolloProvider } from "@/lib/providers/apollo";
import { createClient } from "@/lib/supabase/server";

/**
 * "Find email" on one person from an Apollo search. Revealing costs Apollo credits,
 * so it's one person per click, and who may run it follows
 * app_policy.enrichment_rules.who_can_enrich. A person with an email joins the
 * leadership committee as a cold contact, so they can be emailed straight away.
 * The contact insert goes through RLS (only people who can see the account).
 */

export type RevealResult =
  | { ok: true; contactId: string; fullName: string; title: string | null; email: string }
  | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const APOLLO_ID = /^[0-9a-f]{24}$/i;

export async function revealPerson(accountId: string, personId: string): Promise<RevealResult> {
  if (!UUID.test(accountId) || !APOLLO_ID.test(personId)) return { ok: false, error: "That person could not be found." };
  if (!apolloConfigured()) return { ok: false, error: "APOLLO_API_KEY isn't set on this server." };

  const supabase = await createClient();
  const [user, policies, { data: account }] = await Promise.all([
    getCurrentUser(),
    loadPolicies(supabase),
    supabase.from("account").select("id").eq("id", accountId).maybeSingle(),
  ]);
  if (!user || !account) return { ok: false, error: "That account could not be found." };
  if (policies.enrichment.who_can_enrich === "lead_only" && !user.is_admin) {
    return { ok: false, error: "Only the post-sales lead can look people up." };
  }

  // Already revealed on this account: no second charge.
  const { data: existing } = await supabase
    .from("contact")
    .select("id, full_name, title, email")
    .eq("account_id", accountId)
    .eq("enrichment_provider", "apollo")
    .eq("external_id", personId)
    .is("deleted_at", null)
    .maybeSingle();
  if (existing?.email) {
    return { ok: true, contactId: existing.id, fullName: existing.full_name, title: existing.title, email: existing.email };
  }

  let person;
  try {
    person = await apolloProvider.reveal(personId);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Apollo failed." };
  }
  if (!person) return { ok: false, error: "Apollo couldn't match this person." };
  if (!person.email) return { ok: false, error: `Apollo has no work email for ${person.fullName}.` };

  const { data: inserted, error } = await supabase
    .from("contact")
    .insert({
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
    })
    .select("id")
    .single();

  if (error?.code === "23505") {
    // Someone with that email is already on the account.
    const { data: same } = await supabase
      .from("contact")
      .select("id")
      .eq("account_id", accountId)
      .ilike("email", person.email)
      .is("deleted_at", null)
      .maybeSingle();
    if (same) return { ok: true, contactId: same.id, fullName: person.fullName, title: person.title, email: person.email };
    return { ok: false, error: `${person.fullName} is already on this account.` };
  }
  if (error || !inserted) return { ok: false, error: error?.message ?? "Couldn't save the contact." };

  revalidatePath(`/accounts/${accountId}`);
  return { ok: true, contactId: inserted.id, fullName: person.fullName, title: person.title, email: person.email };
}
