/**
 * The few Microsoft Graph calls the app makes, all on the signed-in mailbox (/me).
 */

const GRAPH = "https://graph.microsoft.com/v1.0";

export class GraphError extends Error {
  readonly status: number;
  /** Throttling and server errors are worth another attempt; 4xx refusals are not. */
  readonly retryable: boolean;

  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.status = status;
    this.retryable = retryable;
  }
}

async function graph<T>(accessToken: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path.startsWith("https://") ? path : `${GRAPH}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (response.status === 202 || response.status === 204) return undefined as T;
  const json = (await response.json().catch(() => ({}))) as { error?: { code?: string; message?: string } } & T;
  if (!response.ok) {
    const message = `${json.error?.code ?? response.status}: ${json.error?.message ?? "Microsoft Graph refused the request."}`;
    throw new GraphError(message, response.status, response.status === 429 || response.status >= 500);
  }
  return json;
}

export type GraphMe = { mail: string | null; userPrincipalName: string; displayName: string | null };

export function getMe(accessToken: string) {
  return graph<GraphMe>(accessToken, "/me?$select=mail,userPrincipalName,displayName");
}

export type SentMessage = { internetMessageId: string | null; conversationId: string | null; messageId: string };

/**
 * Creates the message in Drafts, then sends it. Creating first is what gives us
 * the internetMessageId and conversationId that replies and bounces are matched on;
 * sendMail on its own returns neither.
 */
export async function sendMessage(
  accessToken: string,
  message: { to: string; toName: string | null; subject: string; body: string },
): Promise<SentMessage> {
  const draft = await graph<{ id: string; internetMessageId?: string; conversationId?: string }>(
    accessToken,
    "/me/messages",
    {
      method: "POST",
      body: JSON.stringify({
        subject: message.subject,
        body: { contentType: "Text", content: message.body },
        toRecipients: [{ emailAddress: { address: message.to, ...(message.toName ? { name: message.toName } : {}) } }],
      }),
    },
  );
  await graph<void>(accessToken, `/me/messages/${encodeURIComponent(draft.id)}/send`, { method: "POST" });
  return {
    messageId: draft.id,
    internetMessageId: draft.internetMessageId ?? null,
    conversationId: draft.conversationId ?? null,
  };
}

export type InboxMessage = {
  id: string;
  subject: string | null;
  conversationId: string | null;
  receivedDateTime: string;
  from: { emailAddress?: { address?: string; name?: string } } | null;
};

/** Inbox messages received at or after `since`, oldest first, up to `maxPages` pages. */
export async function listInboxSince(accessToken: string, since: Date, maxPages = 5): Promise<InboxMessage[]> {
  const params = new URLSearchParams({
    $filter: `receivedDateTime ge ${since.toISOString()}`,
    $orderby: "receivedDateTime asc",
    $select: "id,subject,conversationId,receivedDateTime,from",
    $top: "50",
  });
  const messages: InboxMessage[] = [];
  let next: string | null = `/me/mailFolders/inbox/messages?${params}`;
  for (let page = 0; next && page < maxPages; page += 1) {
    const result: { value: InboxMessage[]; "@odata.nextLink"?: string } = await graph(accessToken, next);
    messages.push(...result.value);
    next = result["@odata.nextLink"] ?? null;
  }
  return messages;
}

/** Non-delivery reports from Exchange and most other mail servers. */
export function looksLikeBounce(message: InboxMessage): boolean {
  const subject = (message.subject ?? "").toLowerCase();
  const from = (message.from?.emailAddress?.address ?? "").toLowerCase();
  return (
    /^(undeliverable|delivery has failed|delivery status notification \(failure\)|mail delivery failed|returned mail)/.test(subject) ||
    from.startsWith("postmaster@") ||
    from.startsWith("mailer-daemon@") ||
    from.startsWith("microsoftexchange")
  );
}
