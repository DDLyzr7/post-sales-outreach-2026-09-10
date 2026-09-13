import { NextResponse } from "next/server";
import { randomToken, sha256Base64Url } from "@/lib/crypto";
import { getCurrentUser } from "@/lib/db/queries";
import { requestOrigin } from "@/lib/auth";
import { authorizeUrl, missingMailboxSettings } from "@/lib/microsoft/oauth";

/**
 * Starts connecting the signed-in user's Microsoft 365 mailbox. The state and the
 * PKCE verifier live in a short-lived httpOnly cookie scoped to /mailbox, bound to
 * this user, so a callback started in another browser or by another user fails.
 */

const MAILBOX_COOKIE = "ps_mailbox_oauth";

export async function GET() {
  const origin = await requestOrigin();
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${origin}/login?next=/settings`);

  const missing = missingMailboxSettings();
  if (missing.length) {
    return NextResponse.redirect(
      `${origin}/settings?error=${encodeURIComponent(`Mailbox connection isn't set up yet. Missing: ${missing.join(", ")}`)}`,
    );
  }

  const state = randomToken();
  const verifier = randomToken(48);
  const response = NextResponse.redirect(
    authorizeUrl({
      redirectUri: `${origin}/mailbox/callback`,
      state,
      codeChallenge: sha256Base64Url(verifier),
      loginHint: user.email,
    }),
  );
  response.cookies.set(MAILBOX_COOKIE, JSON.stringify({ state, verifier, userId: user.id }), {
    httpOnly: true,
    sameSite: "lax",
    secure: origin.startsWith("https://"),
    path: "/mailbox",
    maxAge: 600,
  });
  return response;
}
