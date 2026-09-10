import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

/**
 * Request-scoped Supabase client carrying the signed-in user's JWT.
 *
 * Every query made through this client is evaluated by Postgres under that
 * user's identity, so RLS - not the UI - decides which accounts come back.
 * There is no service-role client anywhere in the request path.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component; the middleware refreshes the session.
        }
      },
    },
  });
}
