import type { SupabaseClient } from "@supabase/supabase-js";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { MicrosoftAuthError, refreshAccessToken } from "@/lib/microsoft/oauth";

/**
 * Access tokens for connected mailboxes, for the jobs only. Microsoft rotates the
 * refresh token on use, so the new one is stored straight back. A dead grant marks
 * the connection "needs_reconnect" so the owner sees it in Settings.
 */

export type MailboxAccess =
  | { ok: true; accessToken: string; emailAddress: string }
  | { ok: false; error: string; needsReconnect: boolean };

export async function mailboxAccess(service: SupabaseClient, userId: string): Promise<MailboxAccess> {
  const [{ data: connection }, { data: token }] = await Promise.all([
    service.from("mailbox_connection").select("email_address, status").eq("user_id", userId).maybeSingle(),
    service.from("mailbox_token").select("ciphertext").eq("user_id", userId).maybeSingle(),
  ]);

  if (!connection || connection.status !== "connected" || !token) {
    return { ok: false, error: "The sender's Microsoft mailbox isn't connected.", needsReconnect: true };
  }

  try {
    const tokens = await refreshAccessToken(decryptSecret(token.ciphertext));
    if (tokens.refreshToken) {
      await service
        .from("mailbox_token")
        .update({ ciphertext: encryptSecret(tokens.refreshToken), updated_at: new Date().toISOString() })
        .eq("user_id", userId);
    }
    return { ok: true, accessToken: tokens.accessToken, emailAddress: connection.email_address };
  } catch (error) {
    const needsReconnect = error instanceof MicrosoftAuthError ? error.needsReconnect : false;
    const message = error instanceof Error ? error.message : String(error);
    if (needsReconnect) {
      await service
        .from("mailbox_connection")
        .update({ status: "needs_reconnect", last_error: message.slice(0, 500) })
        .eq("user_id", userId);
    }
    return { ok: false, error: message, needsReconnect };
  }
}
