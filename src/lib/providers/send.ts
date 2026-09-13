import type { SupabaseClient } from "@supabase/supabase-js";
import { mailboxAccess, type MailboxAccess } from "@/lib/jobs/mailbox";
import { GraphError, sendMessage } from "@/lib/microsoft/graph";
import type { OutboundMessage, SendProvider, SendResult } from "@/lib/providers";

/** Records the send and contacts nobody. Used while app_policy.sending.mode is dry_run. */
export const dryRunProvider: SendProvider = {
  name: "dry_run",
  async send(message: OutboundMessage): Promise<SendResult> {
    return {
      ok: true,
      provider: "dry_run",
      providerMessageId: `dry-run:${message.emailActivityId}`,
      providerThreadId: null,
      sentAt: new Date().toISOString(),
    };
  },
};

/**
 * Sends from the author's own Microsoft 365 mailbox. One access token per sender
 * per job run.
 */
export function microsoftGraphProvider(service: SupabaseClient): SendProvider {
  const access = new Map<string, Promise<MailboxAccess>>();

  return {
    name: "microsoft_graph",
    async send(message: OutboundMessage): Promise<SendResult> {
      if (!access.has(message.senderId)) access.set(message.senderId, mailboxAccess(service, message.senderId));
      const mailbox = await access.get(message.senderId)!;
      if (!mailbox.ok) {
        // A disconnected mailbox can be reconnected, so the email waits rather than failing now.
        return { ok: false, provider: "microsoft_graph", error: mailbox.error, retryable: true, needsReconnect: mailbox.needsReconnect };
      }
      try {
        const sent = await sendMessage(mailbox.accessToken, {
          to: message.toEmail,
          toName: message.toName,
          subject: message.subject,
          body: message.bodyText,
        });
        return {
          ok: true,
          provider: "microsoft_graph",
          providerMessageId: sent.internetMessageId ?? `graph:${sent.messageId}`,
          providerThreadId: sent.conversationId,
          sentAt: new Date().toISOString(),
        };
      } catch (error) {
        if (error instanceof GraphError) {
          return { ok: false, provider: "microsoft_graph", error: error.message, retryable: error.retryable };
        }
        return { ok: false, provider: "microsoft_graph", error: String(error), retryable: true };
      }
    },
  };
}
