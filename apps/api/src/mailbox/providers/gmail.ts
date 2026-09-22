import type {
  FetchedMessage,
  ListPage,
  MailboxCredentials,
  MailboxProvider,
  OutgoingMessage,
  SendOutcome,
  SyncLimits,
} from "../types.js";

/**
 * Gmail, behind the neutral interface.
 *
 * Details that matter and are easy to get wrong:
 *
 *  - **A timeout is not a failure.** Gmail's send is not transactional from our side: a request
 *    that timed out may well have been delivered. Anything that is not a clean 2xx or a clean 4xx
 *    becomes `outcome_unknown`, and a person resolves it. Mapping it to `failed` and retrying is
 *    how a client receives the same letter twice.
 *  - **`threadId` is what keeps a reply in the conversation.** Gmail threads on it, not on the
 *    subject line, so a reply that omits it starts a new conversation in the client's inbox.
 *  - **`historyId` expires.** Gmail keeps roughly a week of history and answers a 404 for an older
 *    one. That is reported as an expired checkpoint and answered with a bounded re-read of the
 *    recent window — never with an empty result, which is indistinguishable from a quiet mailbox.
 *  - **A pass is bounded.** The caller's limits decide how far back a first pass reaches and how
 *    many threads it takes, so connecting a ten-year-old mailbox is a series of small passes.
 */
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const TOKEN = "https://oauth2.googleapis.com/token";
const REVOKE = "https://oauth2.googleapis.com/revoke";

/**
 * The scopes asked for.
 *
 * Reading only. `gmail.send` is deliberately absent: sending from ASAP is not implemented, and
 * asking a brokerage to grant permission to send mail on its behalf before anything can send is
 * asking for standing authority nobody needs yet. It is a separate consent screen when the send
 * path lands, and the brokerage will see exactly what changed.
 */
export const GMAIL_READ_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

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

export type GmailConfig = {
  timeoutMs: number;
  clientId?: string | undefined;
  clientSecret?: string | undefined;
};

export function gmailProvider(config: GmailConfig): MailboxProvider {
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

  /** One message, fully. Returns null for anything the account can no longer show us. */
  const getMessage = async (
    credentials: MailboxCredentials,
    id: string,
  ): Promise<FetchedMessage | null> => {
    const res = await call(`/messages/${encodeURIComponent(id)}?format=full`, credentials);
    if (!res.ok) return null;
    return toFetched((await res.json()) as GmailMessage);
  };

  return {
    id: "gmail",

    async list({ credentials, cursor, limits }): Promise<ListPage> {
      /*
       * With a checkpoint this asks for what changed since it. Without one — a first connection —
       * it asks for the recent window only, because "everything" is not an answer a brokerage's
       * ten-year mailbox can give in one pass.
       */
      let ids: string[] = [];
      let nextCursor = cursor;
      let checkpointExpired = false;

      if (cursor !== null) {
        const res = await call(
          `/history?startHistoryId=${encodeURIComponent(cursor)}&historyTypes=messageAdded&maxResults=${limits.maxThreads}`,
          credentials,
        );
        if (res.status === 404 || res.status === 410) {
          // Gmail no longer holds history that far back. Say so, and fall through to a window.
          checkpointExpired = true;
        } else if (!res.ok) {
          throw new GmailError(res.status, `Gmail returned ${res.status} while listing changes.`);
        } else {
          const body = (await res.json()) as {
            historyId?: string;
            history?: { messagesAdded?: { message?: { id?: string } }[] }[];
          };
          ids = (body.history ?? [])
            .flatMap((h) => h.messagesAdded ?? [])
            .map((m) => m.message?.id)
            .filter((id): id is string => typeof id === "string");
          nextCursor = body.historyId ?? cursor;
        }
      }

      if (cursor === null || checkpointExpired) {
        const after = Math.floor((Date.now() - limits.windowDays * 86_400_000) / 1000);
        const res = await call(
          `/messages?maxResults=${limits.maxThreads}&q=${encodeURIComponent(`after:${after}`)}`,
          credentials,
        );
        if (!res.ok) {
          throw new GmailError(res.status, `Gmail returned ${res.status} while listing messages.`);
        }
        const body = (await res.json()) as { messages?: { id: string }[] };
        ids = (body.messages ?? []).map((m) => m.id);
        /*
         * A window read gives no history id, so the checkpoint comes from the profile: the point
         * this pass is caught up to. Without it the next pass would re-read the same window.
         */
        const profile = await call("/profile", credentials);
        nextCursor = profile.ok
          ? (((await profile.json()) as { historyId?: string }).historyId ?? null)
          : null;
      }

      const capped = ids.slice(0, limits.maxThreads);
      const messages: FetchedMessage[] = [];
      for (const id of capped) {
        const m = await getMessage(credentials, id);
        if (m !== null) messages.push(m);
      }

      return {
        messages,
        cursor: nextCursor,
        checkpointExpired,
        reachedLimit: ids.length > capped.length,
      };
    },

    async fetchAttachment({ credentials, providerMessageId, providerAttachmentId }) {
      const res = await call(
        `/messages/${encodeURIComponent(providerMessageId)}/attachments/${encodeURIComponent(providerAttachmentId)}`,
        credentials,
      );
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: string };
      if (typeof body.data !== "string") return null;
      return new Uint8Array(Buffer.from(body.data, "base64url"));
    },

    async send({ credentials, message }): Promise<SendOutcome> {
      const res = await call("/messages/send", credentials, {
        method: "POST",
        body: JSON.stringify({
          raw: encodeMessage(message),
          ...(message.replyToProviderThreadId ? { threadId: message.replyToProviderThreadId } : {}),
        }),
      });
      if (res.ok) {
        const body = (await res.json()) as { id?: string; threadId?: string };
        return body.id
          ? {
              outcome: "sent",
              providerMessageId: body.id,
              providerThreadId: body.threadId ?? null,
              acceptedAt: new Date().toISOString(),
            }
          : { outcome: "outcome_unknown", reason: "Gmail accepted the message but named no id." };
      }
      // 4xx is a refusal we can be sure of. 5xx is not: the message may already be in flight.
      if (res.status >= 400 && res.status < 500) {
        return { outcome: "failed", reason: `Gmail refused the message (${res.status}).` };
      }
      return { outcome: "outcome_unknown", reason: `Gmail returned ${res.status} while sending.` };
    },

    async exchangeCode({ code, redirectUri }) {
      if (!config.clientId || !config.clientSecret) {
        return { outcome: "failed", reason: "This deployment has no Google credentials." };
      }
      const res = await fetch(TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      if (!res.ok) {
        /*
         * The provider's body is not repeated. It can carry the code itself and the client id,
         * and this reason is shown on a screen and written to an audit row.
         */
        return { outcome: "failed", reason: `Google refused the authorisation (${res.status}).` };
      }
      const body = (await res.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
        id_token?: string;
      };
      if (!body.access_token) {
        return { outcome: "failed", reason: "Google returned no access token." };
      }
      const email = emailFromIdToken(body.id_token ?? null) ?? (await profileEmail(body.access_token, config.timeoutMs));
      if (email === null) {
        return { outcome: "failed", reason: "Google did not say which mailbox was authorised." };
      }
      return {
        outcome: "connected",
        emailAddress: email,
        displayName: null,
        credentials: {
          accessToken: body.access_token,
          refreshToken: body.refresh_token ?? null,
          expiresAt:
            typeof body.expires_in === "number"
              ? new Date(Date.now() + body.expires_in * 1000).toISOString()
              : null,
        },
      };
    },

    async refresh(credentials) {
      if (!credentials.refreshToken) return "needs_reauthorisation";
      if (!config.clientId || !config.clientSecret) return "needs_reauthorisation";
      const res = await fetch(TOKEN, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          refresh_token: credentials.refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
        }),
        signal: AbortSignal.timeout(config.timeoutMs),
      });
      /*
       * A refused refresh means the brokerage revoked access, or Google expired the grant. Either
       * way a person has to reconnect: retrying cannot fix it and pretending otherwise leaves a
       * mailbox that looks connected and reads nothing.
       */
      if (!res.ok) return "needs_reauthorisation";
      const body = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!body.access_token) return "needs_reauthorisation";
      return {
        accessToken: body.access_token,
        // Google does not reissue the refresh token on a refresh: the one we hold stays current.
        refreshToken: credentials.refreshToken,
        expiresAt:
          typeof body.expires_in === "number"
            ? new Date(Date.now() + body.expires_in * 1000).toISOString()
            : null,
      };
    },

    async revoke(credentials) {
      const token = credentials.refreshToken ?? credentials.accessToken;
      if (!token) return;
      try {
        await fetch(REVOKE, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch {
        /*
         * Best effort. Our own copy of the token is cleared either way, so the mailbox is
         * disconnected here whether or not Google could be told — and a person can revoke it in
         * their Google account, which is the authority that matters.
         */
      }
    },
  };
}

/** A provider failure a caller can act on: the status says whether waiting would help. */
export class GmailError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GmailError";
  }
  /** Rate limiting and server faults are worth another pass later; a 4xx is not. */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}

/** The mailbox that was authorised, from the id token Google returns beside the access token. */
function emailFromIdToken(idToken: string | null): string | null {
  if (idToken === null) return null;
  const payload = idToken.split(".")[1];
  if (payload === undefined) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
    };
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

async function profileEmail(accessToken: string, timeoutMs: number): Promise<string | null> {
  const res = await fetch(`${API}/profile`, {
    headers: { authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { emailAddress?: string };
  return typeof body.emailAddress === "string" ? body.emailAddress : null;
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

function toFetched(m: GmailMessage): FetchedMessage {
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

export type { SyncLimits };
