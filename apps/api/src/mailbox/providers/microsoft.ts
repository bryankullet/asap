import type { FetchedMessage, MailboxCredentials, MailboxProvider, SendOutcome } from "../types.js";

/**
 * Microsoft 365, behind the same neutral interface as Gmail.
 *
 * Graph's send is the sharpest case for the three-way outcome. `POST /sendMail` answers **202
 * Accepted with an empty body** — no message id at all. Accepted is not evidence: we have nothing
 * to record, nothing to show a person, and no way to prove later what went out. So this adapter
 * creates the message as a draft first, sends *that*, and reads the id back. Where even that
 * cannot be confirmed, the answer is `outcome_unknown` and a person resolves it.
 */
const API = "https://graph.microsoft.com/v1.0/me";

export function microsoftProvider(config: { timeoutMs: number }): MailboxProvider {
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
    id: "microsoft",

    async list({ credentials, cursor }) {
      // Graph's deltaLink is an absolute url, so a stored cursor is followed as given.
      const res = cursor
        ? await fetch(cursor, {
            headers: { authorization: `Bearer ${credentials.accessToken}` },
            signal: AbortSignal.timeout(config.timeoutMs),
          })
        : await call("/messages/delta?$top=50", credentials);
      if (!res.ok) throw new Error(`microsoft list failed: ${res.status}`);
      const body = (await res.json()) as { value?: GraphMessage[]; "@odata.deltaLink"?: string };
      return {
        messages: (body.value ?? []).map(toFetched),
        cursor: body["@odata.deltaLink"] ?? cursor,
      };
    },

    async send({ credentials, message }): Promise<SendOutcome> {
      const draft = {
        subject: message.subject,
        body: { contentType: "Text", content: message.bodyText },
        toRecipients: message.to.map((address) => ({ emailAddress: { address } })),
        ccRecipients: message.cc.map((address) => ({ emailAddress: { address } })),
        ...(message.replyToProviderThreadId ? { conversationId: message.replyToProviderThreadId } : {}),
      };

      let created: Response;
      try {
        created = await call("/messages", credentials, { method: "POST", body: JSON.stringify(draft) });
      } catch {
        // Nothing was created, so nothing can have gone out. This one is safe to call failed.
        return { outcome: "failed", reason: "Microsoft 365 could not be reached. Nothing was sent." };
      }
      if (!created.ok) {
        if (created.status >= 400 && created.status < 500) {
          return { outcome: "failed", reason: `Microsoft 365 refused the message (${created.status}).` };
        }
        return { outcome: "outcome_unknown", reason: `Microsoft 365 returned ${created.status}.` };
      }
      const draftBody = (await created.json()) as { id?: string; conversationId?: string };
      if (!draftBody.id) {
        return { outcome: "outcome_unknown", reason: "Microsoft 365 created a draft with no id." };
      }

      let sent: Response;
      try {
        sent = await call(`/messages/${draftBody.id}/send`, credentials, { method: "POST" });
      } catch {
        // The draft exists and the send was in flight. It may have gone.
        return {
          outcome: "outcome_unknown",
          reason: "Microsoft 365 did not answer the send. The message may or may not have gone.",
        };
      }
      if (sent.ok || sent.status === 202) {
        // The draft's own id is the evidence — which is exactly why the draft was created first
        // rather than using /sendMail, whose 202 carries no id at all.
        return {
          outcome: "sent",
          providerMessageId: draftBody.id,
          providerThreadId: draftBody.conversationId ?? null,
          acceptedAt: new Date().toISOString(),
        };
      }
      if (sent.status >= 400 && sent.status < 500) {
        return { outcome: "failed", reason: `Microsoft 365 refused to send it (${sent.status}).` };
      }
      return { outcome: "outcome_unknown", reason: `Microsoft 365 returned ${sent.status} while sending.` };
    },

    async refresh(credentials) {
      if (!credentials.refreshToken) return "needs_reauthorisation";
      // As with Gmail: the token exchange is the OAuth hook, and without client credentials
      // configured the honest answer is that a person must reconnect.
      return "needs_reauthorisation";
    },
  };
}

type GraphMessage = {
  id: string;
  conversationId?: string;
  subject?: string;
  bodyPreview?: string;
  body?: { content?: string };
  from?: { emailAddress?: { address?: string } };
  toRecipients?: { emailAddress?: { address?: string } }[];
  ccRecipients?: { emailAddress?: { address?: string } }[];
  sentDateTime?: string;
  hasAttachments?: boolean;
  isDraft?: boolean;
  // Graph's own flag for mail the account sent.
  inferenceClassification?: string;
  parentFolderId?: string;
};

function toFetched(m: GraphMessage): FetchedMessage {
  const addresses = (list: { emailAddress?: { address?: string } }[] | undefined) =>
    (list ?? []).map((r) => r.emailAddress?.address ?? "").filter(Boolean);
  return {
    providerMessageId: m.id,
    providerThreadId: m.conversationId ?? m.id,
    // Graph has no SENT label on the message; the sender address is what settles it, and the
    // caller knows the mailbox's own address. Until then everything delta returns is inbound.
    direction: "inbound",
    from: m.from?.emailAddress?.address ?? "",
    to: addresses(m.toRecipients),
    cc: addresses(m.ccRecipients),
    subject: m.subject ?? "",
    bodyText: m.body?.content ?? null,
    snippet: m.bodyPreview ?? null,
    sentAt: m.sentDateTime ?? new Date().toISOString(),
    // Graph reports whether there are attachments but not what they are without a second call.
    attachments: [],
  };
}
