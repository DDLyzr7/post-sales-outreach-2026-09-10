import { headers } from "next/headers";

/**
 * Password sign-in is on for local development, and otherwise only when
 * ALLOW_PASSWORD_SIGN_IN is exactly "true" (2026-09-22, so the Vercel deployment
 * has a working door before Microsoft sign-in is configured — open question 8).
 *
 * It fails closed: any other value, or no value, leaves a deployed build
 * Microsoft-only. The sign-in action checks this too, so hiding the form is not
 * the only thing stopping it. Turn the flag off once Microsoft sign-in works.
 */
export function passwordSignInEnabled(): boolean {
  if (process.env.NODE_ENV === "development") return true;
  return process.env.ALLOW_PASSWORD_SIGN_IN === "true";
}

/** Same-site paths only: "/team" is fine, "//evil.example" or "https://..." is not. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return "/";
  return next;
}

/** The public origin of this request, honouring a proxy's forwarded host. */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
