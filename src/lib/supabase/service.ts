import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * The service-role client for the send and tracking jobs. It bypasses RLS and has
 * no JWT subject, which is exactly what lets a job mark emails as sent
 * (app.guard_email_activity_write steps aside when auth.uid() is null).
 *
 * Import this ONLY from src/lib/jobs/ (and src/lib/providers/send.ts, which only the
 * send job uses). Those jobs are reached only through
 * /api/jobs/[job], which refuses any request without CRON_SECRET. Never import it
 * into a page, server action or component: that would put an RLS bypass in the
 * signed-in request path.
 */
export function createServiceClient(): SupabaseClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || key.startsWith("YOUR-")) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set.");
  return createClient(env.supabaseUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
