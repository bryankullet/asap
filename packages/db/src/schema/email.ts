import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { clients } from "./compliance.js";
import { documents } from "./documents.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";
import { workItems } from "./work.js";

export const MAILBOX_PROVIDERS = ["gmail", "microsoft"] as const;
export const MAILBOX_STATUSES = ["connected", "needs_reauthorisation", "disconnected"] as const;
export const EMAIL_DIRECTIONS = ["inbound", "outbound"] as const;
/** `outcome_unknown` is its own outcome: a send we cannot prove is not a send (D-046). */
export const SEND_OUTCOMES = ["preparing", "sent", "failed", "outcome_unknown"] as const;

/**
 * Migration 0035. A connected mailbox.
 *
 * The two token columns hold ciphertext, encrypted with `ENCRYPTION_KEY` on the server and never
 * anywhere else. Nothing in a user request path reads them; no plaintext token is ever stored,
 * logged or returned by the API.
 */
export const mailboxes = pgTable(
  "mailboxes",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    emailAddress: text("email_address").notNull(),
    displayName: text("display_name"),
    connectedBy: uuid("connected_by")
      .notNull()
      .references(() => users.id),
    accessTokenEncrypted: text("access_token_encrypted"),
    refreshTokenEncrypted: text("refresh_token_encrypted"),
    tokenExpiresAt: timestamptz("token_expires_at"),
    syncCursor: text("sync_cursor"),
    lastSyncedAt: timestamptz("last_synced_at"),
    status: text("status").notNull().default("connected"),
    statusReason: text("status_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("mailboxes_organization_id_email_address_key").on(t.organizationId, t.emailAddress),
    check("mailboxes_provider_check", sql`${t.provider} in ('gmail','microsoft')`),
    check("mailboxes_email_address_check", sql`position('@' in ${t.emailAddress}) > 1`),
    check(
      "mailboxes_status_check",
      sql`${t.status} in ('connected','needs_reauthorisation','disconnected')`,
    ),
    index("mailboxes_organization_id_idx").on(t.organizationId),
    index("mailboxes_connected_by_idx").on(t.connectedBy),
  ],
);

export const emailThreads = pgTable(
  "email_threads",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    providerThreadId: text("provider_thread_id").notNull(),
    subject: text("subject").notNull().default(""),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    lastMessageAt: timestamptz("last_message_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("email_threads_mailbox_id_provider_thread_id_key").on(t.mailboxId, t.providerThreadId),
    index("email_threads_organization_id_last_message_at_idx").on(
      t.organizationId,
      t.lastMessageAt.desc(),
    ),
    index("email_threads_client_id_idx").on(t.clientId),
    index("email_threads_work_item_id_idx").on(t.workItemId),
  ],
);

/** The provider's id is the idempotency key: a replayed sync must not duplicate a message. */
export const emailMessages = pgTable(
  "email_messages",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => emailThreads.id, { onDelete: "cascade" }),
    providerMessageId: text("provider_message_id").notNull(),
    direction: text("direction").notNull(),
    fromAddress: text("from_address").notNull(),
    toAddresses: text("to_addresses")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ccAddresses: text("cc_addresses")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    subject: text("subject").notNull().default(""),
    bodyText: text("body_text"),
    snippet: text("snippet"),
    sentAt: timestamptz("sent_at").notNull(),
    hasAttachments: boolean("has_attachments").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("email_messages_thread_id_provider_message_id_key").on(t.threadId, t.providerMessageId),
    check("email_messages_direction_check", sql`${t.direction} in ('inbound','outbound')`),
    index("email_messages_thread_id_sent_at_idx").on(t.threadId, t.sentAt),
    index("email_messages_organization_id_idx").on(t.organizationId),
  ],
);

/** An attachment becomes a document only when a person files it; until then `document_id` is null. */
export const emailAttachments = pgTable(
  "email_attachments",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => emailMessages.id, { onDelete: "cascade" }),
    providerAttachmentId: text("provider_attachment_id"),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    documentId: uuid("document_id").references(() => documents.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [
    check("email_attachments_byte_size_check", sql`${t.byteSize} >= 0`),
    index("email_attachments_message_id_idx").on(t.messageId),
    index("email_attachments_document_id_idx").on(t.documentId),
    index("email_attachments_organization_id_idx").on(t.organizationId),
  ],
);

/**
 * Every attempt to send, with the approval that authorised it.
 *
 * The constraints are the whole point: `sent` requires the provider's own id and acceptance time,
 * a provider id can exist on nothing but a `sent` row, and a failure or an unknown outcome must
 * say why. A draft is never called sent, and a send we cannot prove is `outcome_unknown`.
 */
export const emailSendAttempts = pgTable(
  "email_send_attempts",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    mailboxId: uuid("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    /** The draft this came from. No foreign key: a send outlives the draft it was prepared from. */
    draftId: uuid("draft_id"),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull(),
    approvedBy: uuid("approved_by")
      .notNull()
      .references(() => users.id),
    approvedAt: timestamptz("approved_at").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    outcome: text("outcome").notNull().default("preparing"),
    providerMessageId: text("provider_message_id"),
    providerThreadId: text("provider_thread_id"),
    providerAcceptedAt: timestamptz("provider_accepted_at"),
    failureReason: text("failure_reason"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("email_send_attempts_mailbox_id_idempotency_key_key").on(t.mailboxId, t.idempotencyKey),
    check("email_send_attempts_attempt_count_check", sql`${t.attemptCount} >= 0`),
    check(
      "email_send_attempts_outcome_check",
      sql`${t.outcome} in ('preparing','sent','failed','outcome_unknown')`,
    ),
    check(
      "email_send_attempts_sent_needs_provider_evidence",
      sql`${t.outcome} <> 'sent'
          or (${t.providerMessageId} is not null and ${t.providerAcceptedAt} is not null)`,
    ),
    check(
      "email_send_attempts_evidence_means_sent",
      sql`${t.providerMessageId} is null or ${t.outcome} = 'sent'`,
    ),
    check(
      "email_send_attempts_failure_has_a_reason",
      sql`${t.outcome} not in ('failed','outcome_unknown') or ${t.failureReason} is not null`,
    ),
    index("email_send_attempts_organization_id_created_at_idx").on(
      t.organizationId,
      t.createdAt.desc(),
    ),
    index("email_send_attempts_mailbox_id_idx").on(t.mailboxId),
    index("email_send_attempts_work_item_id_idx").on(t.workItemId),
    index("email_send_attempts_approved_by_idx").on(t.approvedBy),
  ],
);

export type Mailbox = typeof mailboxes.$inferSelect;
export type EmailThread = typeof emailThreads.$inferSelect;
export type EmailMessage = typeof emailMessages.$inferSelect;
export type EmailAttachment = typeof emailAttachments.$inferSelect;
export type EmailSendAttempt = typeof emailSendAttempts.$inferSelect;
