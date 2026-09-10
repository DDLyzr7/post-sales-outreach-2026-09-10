"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Owner and lifecycle changes from the Team coverage page.
 *
 * Nothing here checks is_admin. Postgres does: assign_account_owner and
 * remove_account_owner refuse anyone but the post-sales lead, account_assignment's
 * RLS only lets the lead write, and a trigger guards account.lifecycle_status.
 * These actions validate input and turn database errors into sentences.
 */

export type ActionState = { error: string | null; notice: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ["pm", "cal", "csm"];
const LIFECYCLES = ["existing", "churned", "prospect"];

function fail(error: string): ActionState {
  return { error, notice: null };
}

function explain(err: { code?: string; message: string }): string {
  switch (err.code) {
    case "42501":
      return err.message.startsWith("Only the post-sales lead")
        ? err.message
        : "Only the post-sales lead can make this change.";
    case "P0002":
      return err.message;
    case "23503":
      return "That account or person no longer exists. Refresh the page and try again.";
    default:
      return `Not saved: ${err.message}`;
  }
}

function refreshViews() {
  revalidatePath("/team");
  revalidatePath("/targets");
  revalidatePath("/");
}

export async function assignOwner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const accountId = String(formData.get("account_id") ?? "");
  const userId = String(formData.get("user_id") ?? "");
  const role = String(formData.get("role") ?? "");
  const isPrimary = formData.get("is_primary") === "on";

  if (!UUID.test(accountId)) return fail("That account could not be found. Refresh the page.");
  if (!UUID.test(userId)) return fail("Choose a person to add.");
  if (!ROLES.includes(role)) return fail("Choose a role: PM, CAL or CSM.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("assign_account_owner", {
    p_account_id: accountId,
    p_user_id: userId,
    p_role: role,
    p_is_primary: isPrimary,
  });
  if (error) return fail(explain(error));

  refreshViews();
  return { error: null, notice: isPrimary ? "Added as primary owner." : "Owner added." };
}

export async function removeOwner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const assignmentId = String(formData.get("assignment_id") ?? "");
  if (!UUID.test(assignmentId)) return fail("That owner could not be found. Refresh the page.");

  const supabase = await createClient();
  const { error } = await supabase.rpc("remove_account_owner", { p_assignment_id: assignmentId });
  if (error) return fail(explain(error));

  refreshViews();
  return { error: null, notice: "Owner removed." };
}

export async function setLifecycle(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const accountId = String(formData.get("account_id") ?? "");
  const status = String(formData.get("lifecycle_status") ?? "");

  if (!UUID.test(accountId)) return fail("That account could not be found. Refresh the page.");
  if (!LIFECYCLES.includes(status)) return fail("Choose existing customer, churned or prospect.");

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("account")
    .update({ lifecycle_status: status })
    .eq("id", accountId)
    .select("id");
  if (error) return fail(explain(error));
  // RLS hides accounts the caller cannot see, which surfaces as zero rows.
  if (!data?.length) return fail("You can't change that account.");

  refreshViews();
  return { error: null, notice: "Lifecycle saved." };
}
