import { NextResponse, type NextRequest } from "next/server";
import { encryptSecret, safeEqual } from "@/lib/crypto";
import { getCurrentUser } from "@/lib/db/queries";
import { requestOrigin } from "@/lib/auth";
import { getMe } from "@/lib/microsoft/graph";
import { exchangeCode, MAILBOX_SCOPES } from "@/lib/microsoft/oauth";
import { createClient } from "@/lib/supabase/server";

const MAILBOX_COOKIE = "ps_mailbox_oauth";

/**
 * Microsoft's return from the mailbox consent screen. Checks the state against the
 * cookie, exchanges the code, confirms which mailbox was connected, encrypts the
 * refresh token and saves it through save_mailbox_connection(), which refuses a
 * mailbox that isn't the caller's own address.
 */
export async function GET(request: NextRequest) {
  const origin = await requestOrigin();
  const done = (params: string) => {
    const response = NextResponse.redirect(`${origin}/settings?${params}`);
    response.cookies.set(MAILBOX_COOKIE, "", { path: "/mailbox", maxAge: 0 });
    return response;
  };
  const fail = (message: string) => done(`error=${encodeURIComponent(message)}`);

  const url = new URL(request.url);
  const failure = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (failure) return fail(`Microsoft didn't connect the mailbox: ${failure.split("\r\n")[0]}`);

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${origin}/login?next=/settings`);

  let saved: { state?: string; verifier?: string; userId?: string } = {};
  try {
    saved = JSON.parse(request.cookies.get(MAILBOX_COOKIE)?.value ?? "{}");
  } catch {
    saved = {};
  }
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  if (!code || !saved.state || !saved.verifier || saved.userId !== user.id || !safeEqual(state, saved.state)) {
    return fail("That mailbox connection expired or didn't start here. Try Connect again.");
  }

  try {
    const tokens = await exchangeCode({ code, redirectUri: `${origin}/mailbox/callback`, codeVerifier: saved.verifier });
    if (!tokens.refreshToken) return fail("Microsoft didn't allow offline access, so the app can't send later. Try again.");
    const missingScopes = ["Mail.Send", "Mail.ReadBasic"].filter(
      (scope) => !tokens.scopes.some((granted) => granted.toLowerCase().endsWith(scope.toLowerCase())),
    );
    if (missingScopes.length) {
      return fail(`Microsoft didn't grant ${missingScopes.join(" and ")}. Your IT admin may need to approve the app.`);
    }

    const me = await getMe(tokens.accessToken);
    const address = (me.mail ?? me.userPrincipalName).toLowerCase();

    const supabase = await createClient();
    const { error } = await supabase.rpc("save_mailbox_connection", {
      p_email_address: address,
      p_ciphertext: encryptSecret(tokens.refreshToken),
      p_scopes: tokens.scopes.length ? tokens.scopes : MAILBOX_SCOPES,
    });
    if (error) return fail(error.message);

    return done("mailbox=connected");
  } catch (error) {
    console.error("mailbox callback:", error instanceof Error ? error.message : error);
    return fail(error instanceof Error ? error.message : "Connecting the mailbox failed. Try again.");
  }
}
