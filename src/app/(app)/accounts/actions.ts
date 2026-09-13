"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Opt-outs from the account page. Anyone who can see a contact can record an
 * opt-out (RLS contact_update); only the post-sales lead can clear one
 * (app.guard_contact_opt_out). The send job and send_email() both refuse an
 * opted-out contact, on both paths.
 */

export type ContactActionState = { error: string | null; notice: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function setOptOut(_prev: ContactActionState, formData: FormData): Promise<ContactActionState> {
  const contactId = String(formData.get("contact_id") ?? "");
  const accountId = String(formData.get("account_id") ?? "");
  const optOut = formData.get("opt_out") === "true";
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (!UUID.test(contactId) || !UUID.test(accountId)) return { error: "That contact could not be found.", notice: null };
  if (optOut && !reason) return { error: "Say why, e.g. \"asked to stop in a reply\".", notice: null };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("contact")
    .update(optOut ? { is_opted_out: true, opt_out_reason: reason } : { is_opted_out: false })
    .eq("id", contactId)
    .eq("account_id", accountId)
    .select("id");
  if (error) return { error: error.code === "42501" ? error.message : `Not saved: ${error.message}`, notice: null };
  if (!data?.length) return { error: "You can't change that contact.", notice: null };

  revalidatePath(`/accounts/${accountId}`);
  return { error: null, notice: optOut ? "Opt-out recorded. Nobody can email them now." : "Opt-out cleared." };
}
