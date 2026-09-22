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

/**
 * How much of a mailbox one pass may read.
 *
 * Every one of these is a real limit, not a hint. A brokerage's mailbox can hold a decade of
 * correspondence, and a first connection that tried to read all of it would spend hours, fill a
 * bucket with attachments nobody asked for, and be rate-limited half way through with no way to
 * say where it got to. A pass is small, bounded and repeatable instead.
 */
export type SyncLimits = {
  /** How far back a first pass reaches. Later passes use the checkpoint instead. */
  windowDays: number;
  maxThreads: number;
  maxAttachments: number;
  maxAttachmentBytes: number;
  /** Types worth filing. Anything else is recorded as an attachment and never downloaded. */
  attachmentMimeTypes: string[];
};

/** What one bounded pass returned, and why it stopped. */
export type ListPage = {
  messages: FetchedMessage[];
  /** The checkpoint to store, or null when the provider gave none and the old one still stands. */
  cursor: string | null;
  /**
   * True when the provider said its own checkpoint was too old to use.
   *
   * Gmail expires a `historyId` after about a week. The honest response is a bounded re-read of
   * the recent window, said out loud, rather than silently returning nothing — which would look
   * exactly like a quiet mailbox.
   */
  checkpointExpired: boolean;
  /** True when the pass stopped at a limit rather than at the end of what there was. */
  reachedLimit: boolean;
};

export type MailboxProvider = {
  readonly id: MailboxProviderId;
  /**
   * One bounded pass. Messages since the cursor, and the cursor to store for next time.
   *
   * Incremental by design: a full re-read of a mailbox on every sync is both slow and a way to
   * re-file the same message. `limits` is what stops a first pass — which has no cursor — from
   * becoming that full re-read.
   */
  list(input: {
    credentials: MailboxCredentials;
    cursor: string | null;
    limits: SyncLimits;
  }): Promise<ListPage>;
  /** The bytes of one attachment. Called only for a type and size worth filing. */
  fetchAttachment(input: {
    credentials: MailboxCredentials;
    providerMessageId: string;
    providerAttachmentId: string;
  }): Promise<Uint8Array | null>;
  send(input: { credentials: MailboxCredentials; message: OutgoingMessage }): Promise<SendOutcome>;
  /** Exchanges a refresh token for a fresh access token, or says the connection needs a person. */
  refresh(credentials: MailboxCredentials): Promise<MailboxCredentials | "needs_reauthorisation">;
  /** Exchanges the authorisation code for tokens. Server-side only; the code never returns here. */
  exchangeCode(input: { code: string; redirectUri: string }): Promise<
    | { outcome: "connected"; credentials: MailboxCredentials; emailAddress: string; displayName: string | null }
    | { outcome: "failed"; reason: string }
  >;
  /** Best-effort revocation on disconnect. A provider that cannot be told is still disconnected here. */
  revoke(credentials: MailboxCredentials): Promise<void>;
};

/** Raised when a mailbox is asked for and none is connected. A state, not an error to swallow. */
export class MailboxNotConnected extends Error {
  constructor(message = "No mailbox is connected for this brokerage.") {
    super(message);
    this.name = "MailboxNotConnected";
  }
}
