import type { SupabaseClient } from "@supabase/supabase-js";
import { mailboxAccess } from "@/lib/jobs/mailbox";
import { listInboxSince, looksLikeBounce } from "@/lib/microsoft/graph";

/**
 * The tracking job. For each connected mailbox, reads new inbox messages
 * (sender, subject and thread only; Mail.ReadBasic never exposes bodies) and
 * matches them to emails that mailbox sent, by conversation id:
 *   - a non-delivery report marks the email bounced
 *   - anything else from someone other than the mailbox marks it replied
 * Opens are not tracked (decided 2026-09-10).
 */

export type TrackJobSummary = {
  mailboxes: number;
  messagesRead: number;
  replies: number;
  bounces: number;
  needsReconnect: number;
  errors: string[];
};

type SentRow = { id: string; provider_thread_id: string; status: string; replied_at: string | null; bounced_at: string | null };

export async function runTrackJob(service: SupabaseClient): Promise<TrackJobSummary> {
  const summary: TrackJobSummary = { mailboxes: 0, messagesRead: 0, replies: 0, bounces: 0, needsReconnect: 0, errors: [] };

  const { data: connections, error } = await service
    .from("mailbox_connection")
    .select("user_id, email_address, connected_at, inbox_checked_at")
    .eq("status", "connected");
  if (error) throw new Error(`mailbox_connection: ${error.message}`);

  for (const connection of connections ?? []) {
    summary.mailboxes += 1;
    const access = await mailboxAccess(service, connection.user_id);
    if (!access.ok) {
      if (access.needsReconnect) summary.needsReconnect += 1;
      else summary.errors.push(`${connection.email_address}: ${access.error}`);
      continue;
    }

    const since = new Date(connection.inbox_checked_at ?? connection.connected_at);
    let messages;
    try {
      messages = await listInboxSince(access.accessToken, since);
    } catch (err) {
      summary.errors.push(`${connection.email_address}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    summary.messagesRead += messages.length;

    const threads = [...new Set(messages.map((m) => m.conversationId).filter((id): id is string => !!id))];
    if (threads.length) {
      const { data: sent } = await service
        .from("email_activity")
        .select("id, provider_thread_id, status, replied_at, bounced_at")
        .eq("sender_id", connection.user_id)
        .in("provider_thread_id", threads)
        .not("sent_at", "is", null);
      const byThread = new Map<string, SentRow[]>();
      for (const row of (sent ?? []) as SentRow[]) {
        byThread.set(row.provider_thread_id, [...(byThread.get(row.provider_thread_id) ?? []), row]);
      }

      const mailbox = connection.email_address.toLowerCase();
      for (const message of messages) {
        const rows = message.conversationId ? byThread.get(message.conversationId) : undefined;
        if (!rows) continue;
        const from = (message.from?.emailAddress?.address ?? "").toLowerCase();
        const bounce = looksLikeBounce(message);
        if (!bounce && (!from || from === mailbox)) continue;

        for (const row of rows) {
          if (bounce && !row.bounced_at) {
            row.bounced_at = message.receivedDateTime;
            row.status = "bounced";
            summary.bounces += 1;
            await service
              .from("email_activity")
              .update({ status: "bounced", bounced_at: message.receivedDateTime })
              .eq("id", row.id);
          } else if (!bounce && !row.replied_at) {
            row.replied_at = message.receivedDateTime;
            summary.replies += 1;
            await service
              .from("email_activity")
              .update({ replied_at: message.receivedDateTime, ...(row.status === "bounced" ? {} : { status: "replied" }) })
              .eq("id", row.id);
          }
        }
      }
    }

    const newest = messages.at(-1)?.receivedDateTime;
    await service
      .from("mailbox_connection")
      .update({ inbox_checked_at: newest ?? new Date().toISOString(), last_error: null })
      .eq("user_id", connection.user_id);
  }

  return summary;
}
