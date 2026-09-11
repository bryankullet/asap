/**
 * The mailbox interface. Gmail and Microsoft 365 sit behind it, and nothing above it names either.
 *
 * The shape is chosen around one rule: **a message is not sent until a provider says it is.**
 * `send` therefore returns a three-way outcome, not a boolean and not a throw:
 *
 *   sent             the provider accepted it and gave us its ids. This is the evidence.
 *   failed           the provider refused, and we know it never went. Safe to correct and retry.
 *   outcome_unknown  we do not know. A timeout, a dropped connection, a 5xx after the request
 *                    was already in flight. **This is never treated as either of the other two.**
 *                    A person sees it and resolves it, and a retry reuses the idempotency key so
 *                    that resolving it cannot become a second email.
 *
 * The temptation this shape exists to remove is mapping a timeout onto `failed` and retrying. That
 * is how a client receives the same letter twice.
 */

export type MailboxProviderId = "gmail" | "microsoft";

export type MailboxCredentials = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
};

export type OutgoingMessage = {
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string;
  /** Reply into an existing conversation, so the client sees one thread rather than two. */
  replyToProviderThreadId: string | null;
  /**
   * Unique per mailbox for one intent. Passed to the provider where it supports one, and used by
   * our own attempt row either way, so a retry of the same intent cannot send twice.
   */
  idempotencyKey: string;
};

export type SendOutcome =
  | { outcome: "sent"; providerMessageId: string; providerThreadId: string | null; acceptedAt: string }
  | { outcome: "failed"; reason: string }
  | { outcome: "outcome_unknown"; reason: string };

export type FetchedMessage = {
  providerMessageId: string;
  providerThreadId: string;
  direction: "inbound" | "outbound";
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  bodyText: string | null;
  snippet: string | null;
  sentAt: string;
  attachments: { providerAttachmentId: string | null; filename: string; mimeType: string; byteSize: number }[];
};

export type MailboxProvider = {
  readonly id: MailboxProviderId;
  /**
   * Messages since the cursor, and the cursor to store for next time. Incremental by design: a
   * full re-read of a mailbox on every sync is both slow and a way to re-file the same message.
   */
  list(input: {
    credentials: MailboxCredentials;
    cursor: string | null;
  }): Promise<{ messages: FetchedMessage[]; cursor: string | null }>;
  send(input: { credentials: MailboxCredentials; message: OutgoingMessage }): Promise<SendOutcome>;
  /** Exchanges a refresh token for a fresh access token, or says the connection needs a person. */
  refresh(credentials: MailboxCredentials): Promise<MailboxCredentials | "needs_reauthorisation">;
};

/** Raised when a mailbox is asked for and none is connected. A state, not an error to swallow. */
export class MailboxNotConnected extends Error {
  constructor(message = "No mailbox is connected for this brokerage.") {
    super(message);
    this.name = "MailboxNotConnected";
  }
}
