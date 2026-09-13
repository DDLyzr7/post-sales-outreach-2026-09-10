"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** opt_out_by_token() records the opt-out for the one contact that email went to. */
export async function unsubscribe(formData: FormData) {
  const token = String(formData.get("token") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 300);
  if (!UUID.test(token)) redirect(`/unsubscribe/invalid?done=0`);

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("opt_out_by_token", {
    p_token: token,
    p_reason: reason ? `Unsubscribed by link: ${reason}` : null,
  });
  redirect(`/unsubscribe/${token}?done=${!error && data ? "1" : "0"}`);
}
