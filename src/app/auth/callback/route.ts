import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { safeNextPath } from "@/lib/auth";

/**
 * Where Supabase sends the browser after Microsoft sign-in, with a one-time code
 * (PKCE). Exchanging it sets the session cookies. Failures, including a sign-up
 * refused by the Lyzr-only hook, arrive as ?error_description=... and are shown
 * on the login page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const base = publicBase(request, origin);
  const next = safeNextPath(searchParams.get("next"));
  const backToLogin = (message: string) =>
    NextResponse.redirect(`${base}/login?error=${encodeURIComponent(message)}`);

  const failure = searchParams.get("error_description") ?? searchParams.get("error");
  if (failure) return backToLogin(failure);

  const code = searchParams.get("code");
  if (!code) return backToLogin("Microsoft sign-in didn't finish. Try again.");

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) return backToLogin(error.message);

  return NextResponse.redirect(`${base}${next}`);
}

// Behind a proxy or load balancer, the request URL carries an internal origin.
function publicBase(request: NextRequest, origin: string): string {
  const forwardedHost = request.headers.get("x-forwarded-host");
  if (process.env.NODE_ENV === "development" || !forwardedHost) return origin;
  return `https://${forwardedHost}`;
}
