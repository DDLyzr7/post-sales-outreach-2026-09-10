"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Broadcast actions. The lead-only rule lives in Postgres: campaign writes need
 * app.is_admin() (Phase 1 RLS), a trigger freezes a launched campaign, and
 * launch_campaign() / cancel_campaign() refuse anyone else. These actions
 * validate input and turn errors into sentences.
 */

export type BroadcastState = { error: string | null; notice: string | null };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIFECYCLES = ["existing", "churned", "prospect"];
const TIERS = ["strategic", "enterprise", "mid_market", "smb"];
const HEALTH = ["green", "yellow", "red", "unknown"];
const CONTACT_TYPES = ["engaged", "committee"];

const STARTER_BODY =
  "Hi {{contact_first_name}},\n\n[[What we launched, and why it matters to {{account_name}}]]\n\n[[One line on what to do next]]\n\n{{sender_first_name}}";

function fail(error: string): BroadcastState {
  return { error, notice: null };
}

function explain(err: { code?: string; message: string }): string {
  if (err.code === "42501" && err.message.startsWith("new row violates")) return "Only the post-sales lead can do that.";
  return err.message;
}

function pick(formData: FormData, name: string, allowed: string[]): string[] {
  return formData.getAll(name).map(String).filter((value) => allowed.includes(value));
}

export async function createBroadcast(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim().slice(0, 120) || "Untitled broadcast";
  const supabase = await createClient();

  const { data: template } = await supabase
    .from("template")
    .select("current_version, versions:template_version(id, version)")
    .eq("email_type", "launch_broadcast")
    .eq("is_active", true)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();
  type TemplateRow = { current_version: number; versions: { id: string; version: number }[] };
  const version = (template as TemplateRow | null)?.versions.find((v) => v.version === (template as TemplateRow).current_version);

  const { data, error } = await supabase
    .from("campaign")
    .insert({
      name,
      email_type: "launch_broadcast",
      status: "draft",
      subject: "",
      body_text: STARTER_BODY,
      audience: { lifecycle: ["existing"], contact_types: ["engaged", "committee"] },
      template_version_id: version?.id ?? null,
    })
    .select("id")
    .single();
  if (error) redirect(`/broadcasts?error=${encodeURIComponent(explain(error))}`);

  revalidatePath("/broadcasts");
  redirect(`/broadcasts/${data.id}`);
}

export async function saveBroadcast(_prev: BroadcastState, formData: FormData): Promise<BroadcastState> {
  const id = String(formData.get("campaign_id") ?? "");
  if (!UUID.test(id)) return fail("That broadcast could not be found.");

  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const subject = String(formData.get("subject") ?? "").trim().slice(0, 300);
  const body = String(formData.get("body") ?? "").trim().slice(0, 20_000);
  const scheduled = String(formData.get("scheduled_at") ?? "").trim();
  if (!name) return fail("Give the broadcast a name.");

  let scheduledAt: string | null = null;
  if (scheduled) {
    const when = new Date(scheduled);
    if (Number.isNaN(when.getTime())) return fail("That send time isn't a valid date.");
    scheduledAt = when.toISOString();
  }

  const supabase = await createClient();
  const { data: products } = await supabase.from("product").select("key").eq("is_active", true);
  const productKeys = ((products ?? []) as { key: string }[]).map((p) => p.key);

  const audience = {
    lifecycle: pick(formData, "lifecycle", LIFECYCLES),
    tiers: pick(formData, "tiers", TIERS),
    health: pick(formData, "health", HEALTH),
    product_keys: pick(formData, "product_keys", productKeys),
    contact_types: pick(formData, "contact_types", CONTACT_TYPES),
  };
  if (!audience.contact_types.length) return fail("Choose at least one kind of contact.");

  const { data, error } = await supabase
    .from("campaign")
    .update({ name, subject, body_text: body, audience, scheduled_at: scheduledAt })
    .eq("id", id)
    .select("id");
  if (error) return fail(explain(error));
  if (!data?.length) return fail("Only the post-sales lead can edit broadcasts.");

  revalidatePath(`/broadcasts/${id}`);
  revalidatePath("/broadcasts");
  return { error: null, notice: "Saved. The audience below is updated." };
}

export async function launchBroadcast(_prev: BroadcastState, formData: FormData): Promise<BroadcastState> {
  const id = String(formData.get("campaign_id") ?? "");
  if (!UUID.test(id)) return fail("That broadcast could not be found.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("launch_campaign", { p_campaign_id: id });
  if (error) return fail(explain(error));

  revalidatePath(`/broadcasts/${id}`);
  revalidatePath("/broadcasts");
  const result = data as { queued: number; skipped: number; mode: string };
  return {
    error: null,
    notice: `Launched: ${result.queued} queued, ${result.skipped} skipped${result.mode === "dry_run" ? " (test mode, nothing is delivered)" : ""}.`,
  };
}

export async function cancelBroadcast(_prev: BroadcastState, formData: FormData): Promise<BroadcastState> {
  const id = String(formData.get("campaign_id") ?? "");
  if (!UUID.test(id)) return fail("That broadcast could not be found.");

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("cancel_campaign", { p_campaign_id: id });
  if (error) return fail(explain(error));

  revalidatePath(`/broadcasts/${id}`);
  revalidatePath("/broadcasts");
  return { error: null, notice: `Cancelled. ${(data as { cancelled: number }).cancelled} queued emails won't send.` };
}

export async function deleteBroadcast(_prev: BroadcastState, formData: FormData): Promise<BroadcastState> {
  const id = String(formData.get("campaign_id") ?? "");
  if (!UUID.test(id)) return fail("That broadcast could not be found.");

  const supabase = await createClient();
  const { data, error } = await supabase.from("campaign").delete().eq("id", id).eq("status", "draft").select("id");
  if (error) return fail(explain(error));
  if (!data?.length) return fail("Only a draft broadcast can be deleted.");

  revalidatePath("/broadcasts");
  redirect("/broadcasts");
}
