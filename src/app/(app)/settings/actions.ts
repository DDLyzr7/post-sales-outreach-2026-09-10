"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/**
 * Settings actions. disconnect_mailbox() only ever touches the caller's own
 * connection. The sending mode lives in app_policy, which RLS lets only the
 * post-sales lead write, so a non-lead's attempt updates zero rows.
 */

export type SettingsState = { error: string | null; notice: string | null };

const MODES = ["dry_run", "live", "paused"] as const;

export async function disconnectMailbox(): Promise<SettingsState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("disconnect_mailbox");
  if (error) return { error: error.message, notice: null };
  revalidatePath("/settings");
  return { error: null, notice: "Mailbox disconnected. Nothing can send from it until you connect it again." };
}

export async function setSendingMode(_prev: SettingsState, formData: FormData): Promise<SettingsState> {
  const mode = String(formData.get("mode") ?? "");
  if (!MODES.includes(mode as (typeof MODES)[number])) return { error: "Choose test mode, live or paused.", notice: null };

  const supabase = await createClient();
  const { data: current } = await supabase.from("app_policy").select("value").eq("key", "sending").maybeSingle();
  if (!current) return { error: "The sending policy is missing. Push the latest migrations.", notice: null };

  const { data, error } = await supabase
    .from("app_policy")
    .update({ value: { ...(current.value as Record<string, unknown>), mode } })
    .eq("key", "sending")
    .select("key");
  if (error) return { error: error.message, notice: null };
  if (!data?.length) return { error: "Only the post-sales lead can change the sending mode.", notice: null };

  revalidatePath("/settings");
  revalidatePath("/drafts");
  return {
    error: null,
    notice:
      mode === "live"
        ? "Sending is live. Emails now go to real recipients."
        : mode === "paused"
          ? "Sending is paused. Nothing new can be queued, and queued emails wait."
          : "Test mode. Emails are recorded as sent, and nothing is delivered.",
  };
}
