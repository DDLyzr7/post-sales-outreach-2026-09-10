import { headers } from "next/headers";

/**
 * The fictional sample users sign in with a password on localhost only. Every
 * deployed build is Microsoft-only, and the sign-in action checks this too, so
 * hiding the form is not the only thing stopping it.
 */
export function passwordSignInEnabled(): boolean {
  return process.env.NODE_ENV === "development";
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
