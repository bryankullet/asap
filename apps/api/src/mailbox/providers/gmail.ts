import type { FetchedMessage, MailboxCredentials, MailboxProvider, OutgoingMessage, SendOutcome } from "../types.js";

/**
 * Gmail, behind the neutral interface.
 *
 * Two details that matter and are easy to get wrong:
 *
 *  - **A timeout is not a failure.** Gmail's send is not transactional from our side: a request
 *    that timed out may well have been delivered. Anything that is not a clean 2xx or a clean 4xx
 *    becomes `outcome_unknown`, and a person resolves it. Mapping it to `failed` and retrying is
 *    how a client receives the same letter twice.
 *  - **`threadId` is what keeps a reply in the conversation.** Gmail threads on it, not on the
 *    subject line, so a reply that omits it starts a new conversation in the client's inbox.
 */
const API = "https://gmail.googleapis.com/gmail/v1/users/me";

/** RFC 5322, base64url, as Gmail wants it. Headers are built here, never taken from a caller. */
function encodeMessage(m: OutgoingMessage): string {
  const headers = [
    `To: ${m.to.join(", ")}`,
    m.cc.length > 0 ? `Cc: ${m.cc.join(", ")}` : null,
    `Subject: ${m.subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
  ].filter((h): h is string => h !== null);
  const raw = `${headers.join("\r\n")}\r\n\r\n${m.bodyText}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

export function gmailProvider(config: { timeoutMs: number }): MailboxProvider {
  const call = (path: string, credentials: MailboxCredentials, init?: RequestInit) =>
    fetch(`${API}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${credentials.accessToken}`,
        "content-type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: AbortSignal.timeout(config.timeoutMs),
    });

  return {
    id: "gmail",

    async list({ credentials, cursor }) {
      // `historyId` is Gmail's incremental cursor. Without one this is a first sync, and the
      // caller decides how far back to go rather than this adapter guessing.
      const path = cursor
        ? `/history?startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded`
        : `/messages?maxResults=50`;
      const res = await call(path, credentials);
      if (!res.ok) throw new Error(`gmail list failed: ${res.status}`);
      const body = (await res.json()) as { historyId?: string; messages?: { id: string }[] };
      const ids = (body.messages ?? []).map((m) => m.id);

      const messages: FetchedMessage[] = [];
      for (const id of ids) {
        const one = await call(`/messages/${id}?format=full`, credentials);
        if (!one.ok) continue;
        messages.push(toFetched((await one.json()) as GmailMessage, credentials));
      }
      return { messages, cursor: body.historyId ?? cursor };
    },

    async send({ credentials, message }): Promise<SendOutcome> {
      const payload = {
        raw: encodeMessage(message),
        ...(message.replyToProviderThreadId ? { threadId: message.replyToProviderThreadId } : {}),
      };
      let res: Response;
      try {
        res = await call("/messages/send", credentials, { method: "POST", body: JSON.stringify(payload) });
      } catch (err) {
        // Timed out or the connection dropped. It may have been delivered; we do not know.
        return {
          outcome: "outcome_unknown",
          reason: err instanceof Error && err.name === "TimeoutError"
            ? "Gmail did not answer in time. The message may or may not have gone."
            : "The connection to Gmail was lost while sending.",
        };
      }
      if (res.ok) {
        const body = (await res.json()) as { id?: string; threadId?: string };
        if (!body.id) {
          // Accepted but unidentifiable. Without an id there is no evidence, so it is not sent.
          return { outcome: "outcome_unknown", reason: "Gmail accepted the message but returned no id." };
        }
        return {
          outcome: "sent",
          providerMessageId: body.id,
          providerThreadId: body.threadId ?? null,
          acceptedAt: new Date().toISOString(),
        };
      }
      // 4xx is a refusal we can be sure of. 5xx is not: the message may already be in flight.
      if (res.status >= 400 && res.status < 500) {
        return { outcome: "failed", reason: `Gmail refused the message (${res.status}).` };
      }
      return { outcome: "outcome_unknown", reason: `Gmail returned ${res.status} while sending.` };
    },

    async refresh(credentials) {
      if (!credentials.refreshToken) return "needs_reauthorisation";
      // The token exchange is the OAuth hook; the caller supplies client credentials from the
      // server environment. Without them configured, the honest answer is that a person must
      // reconnect rather than a silent failure that looks like an empty mailbox.
      return "needs_reauthorisation";
    },
  };
}

type GmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: {
    headers?: { name: string; value: string }[];
    parts?: { filename?: string; mimeType?: string; body?: { size?: number; attachmentId?: string } }[];
    body?: { data?: string };
  };
};

function header(m: GmailMessage, name: string): string {
  return m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function toFetched(m: GmailMessage, credentials: MailboxCredentials): FetchedMessage {
  void credentials;
  const parts = m.payload?.parts ?? [];
  return {
    providerMessageId: m.id,
    providerThreadId: m.threadId,
    // Gmail marks our own sent mail with the SENT label; everything else arrived.
    direction: m.labelIds?.includes("SENT") ? "outbound" : "inbound",
    from: header(m, "from"),
    to: header(m, "to").split(",").map((s) => s.trim()).filter(Boolean),
    cc: header(m, "cc").split(",").map((s) => s.trim()).filter(Boolean),
    subject: header(m, "subject"),
    bodyText: m.payload?.body?.data ? Buffer.from(m.payload.body.data, "base64url").toString("utf8") : null,
    snippet: m.snippet ?? null,
    sentAt: m.internalDate ? new Date(Number(m.internalDate)).toISOString() : new Date().toISOString(),
    attachments: parts
      .filter((p) => p.filename)
      .map((p) => ({
        providerAttachmentId: p.body?.attachmentId ?? null,
        filename: p.filename ?? "attachment",
        mimeType: p.mimeType ?? "application/octet-stream",
        byteSize: p.body?.size ?? 0,
      })),
  };
}
