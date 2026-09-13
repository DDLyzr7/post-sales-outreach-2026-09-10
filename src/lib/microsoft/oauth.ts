import { tokenKeyConfigured } from "@/lib/crypto";

/**
 * Microsoft 365 mailbox connection (OAuth 2.0 authorization code + PKCE).
 *
 * Separate from signing in: sign-in only proves who someone is, while connecting
 * a mailbox grants the app Mail.Send and Mail.ReadBasic on that one mailbox, so it
 * is its own consent step. Mail.ReadBasic reads senders, subjects and thread ids
 * (never bodies), which is enough to spot replies and bounces.
 */

export const MAILBOX_SCOPES = [
  "offline_access", "openid", "profile", "email", "User.Read", "Mail.Send", "Mail.ReadBasic",
];

type Config = { clientId: string; clientSecret: string; tenantId: string };

const REQUIRED = ["MICROSOFT_CLIENT_ID", "MICROSOFT_CLIENT_SECRET", "MICROSOFT_TENANT_ID", "MAILBOX_TOKEN_KEY"] as const;

/** The environment variables still missing before a mailbox can be connected. */
export function missingMailboxSettings(): string[] {
  const missing: string[] = REQUIRED.filter((name) => !process.env[name]);
  if (process.env.MAILBOX_TOKEN_KEY && !tokenKeyConfigured()) missing.push("MAILBOX_TOKEN_KEY (must be 32 bytes, base64)");
  return missing;
}

function config(): Config {
  const missing = missingMailboxSettings();
  if (missing.length) throw new Error(`Microsoft mailbox settings missing: ${missing.join(", ")}`);
  return {
    clientId: process.env.MICROSOFT_CLIENT_ID!,
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
    tenantId: process.env.MICROSOFT_TENANT_ID!,
  };
}

const authority = (tenantId: string) => `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0`;

export function authorizeUrl(input: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
  loginHint: string;
}): string {
  const { clientId, tenantId } = config();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    response_mode: "query",
    scope: MAILBOX_SCOPES.join(" "),
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
    login_hint: input.loginHint,
    prompt: "select_account",
  });
  return `${authority(tenantId)}/authorize?${params}`;
}

export type TokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number;
  scopes: string[];
};

export class MicrosoftAuthError extends Error {
  /** True when the grant is dead (revoked, expired, password changed): reconnect needed. */
  readonly needsReconnect: boolean;

  constructor(message: string, needsReconnect: boolean) {
    super(message);
    this.needsReconnect = needsReconnect;
  }
}

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const { clientId, clientSecret, tenantId } = config();
  const response = await fetch(`${authority(tenantId)}/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...body }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof json.access_token !== "string") {
    const code = String(json.error ?? response.status);
    const description = String(json.error_description ?? "Microsoft refused the request.").split("\r\n")[0];
    throw new MicrosoftAuthError(`${code}: ${description}`, code === "invalid_grant" || code === "interaction_required");
  }
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresIn: Number(json.expires_in ?? 3600),
    scopes: String(json.scope ?? "").split(" ").filter(Boolean),
  };
}

export function exchangeCode(input: { code: string; redirectUri: string; codeVerifier: string }) {
  return tokenRequest({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
    scope: MAILBOX_SCOPES.join(" "),
  });
}

export function refreshAccessToken(refreshToken: string) {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    scope: MAILBOX_SCOPES.join(" "),
  });
}
