import { z } from "zod";
import { EvidenceCondition } from "./attention.js";
import { uuidSchema } from "./common.js";

/**
 * Documents (0034).
 *
 * Two rules shape these contracts:
 *
 *  - **A citation you cannot open is not a citation.** Every extracted value carries the page it
 *    came from and the region on that page. A value without a position is honest about it and is
 *    shown as having no page reference, rather than as a link that opens nothing.
 *  - **Extraction proposes; a person decides.** A field arrives `proposed`. It becomes `accepted`
 *    when a person accepts it and `corrected` when they change it, and the person is recorded
 *    either way. Nothing reads an extracted value as a business value until that has happened
 *    (§45 rule 8).
 */

export const DocumentKind = z.enum([
  "policy_schedule",
  "quote_slip",
  "endorsement",
  "claim_form",
  "invoice",
  "receipt",
  "statement",
  "certificate",
  "correspondence",
  "identity",
  "other",
]);
export type DocumentKind = z.infer<typeof DocumentKind>;

/** Where extraction has got to. `failed` is a state a person sees, with its reason. */
export const ExtractionState = z.enum([
  "not_started",
  "queued",
  "working",
  "extracted",
  "failed",
  "not_applicable",
]);
export type ExtractionState = z.infer<typeof ExtractionState>;

export const FieldState = z.enum(["proposed", "accepted", "corrected", "rejected"]);
export type FieldState = z.infer<typeof FieldState>;

/** A rectangle in the page's own coordinates, so it places on any rendering of that page. */
export const pageRegionSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number().positive(),
  height: z.number().positive(),
});
export type PageRegion = z.infer<typeof pageRegionSchema>;

export const documentFieldSchema = z.object({
  id: uuidSchema,
  fieldKey: z.string(),
  /** What our extractor read. Never shown as a business value on its own. */
  proposedValue: z.string().nullable(),
  /** What a person decided it should be, when they changed it. */
  correctedValue: z.string().nullable(),
  state: FieldState,
  condition: EvidenceCondition,
  /** Null when the extractor could not place it. The UI says so rather than guessing a page. */
  page: z.number().int().nullable(),
  region: pageRegionSchema.nullable(),
  reviewedBy: uuidSchema.nullable(),
  reviewedAt: z.string().nullable(),
});
export type DocumentField = z.infer<typeof documentFieldSchema>;

export const documentSummarySchema = z.object({
  id: uuidSchema,
  kind: DocumentKind,
  filename: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  pageCount: z.number().int().nullable(),
  extractionState: ExtractionState,
  /** Plain language when extraction failed; null otherwise. Never a stack trace. */
  extractionError: z.string().nullable(),
  clientId: uuidSchema.nullable(),
  workItemId: uuidSchema.nullable(),
  createdAt: z.string(),
});
export type DocumentSummary = z.infer<typeof documentSummarySchema>;

export const documentPageSchema = z.object({
  pageNumber: z.number().int(),
  width: z.number(),
  height: z.number(),
  text: z.string(),
});

export const documentDetailSchema = z.object({
  document: documentSummarySchema,
  pages: z.array(documentPageSchema),
  fields: z.array(documentFieldSchema),
  /**
   * A short-lived signed URL for the bytes. The bucket is private and there is no public URL; a
   * link that has expired is re-requested rather than stored.
   */
  fileUrl: z.string().nullable(),
  fileUrlExpiresAt: z.string().nullable(),
});
export type DocumentDetail = z.infer<typeof documentDetailSchema>;

export const documentsResponseSchema = z.object({ documents: z.array(documentSummarySchema) });
export type DocumentsResponse = z.infer<typeof documentsResponseSchema>;

/**
 * Asking for somewhere to put a file. The server allocates the path inside the brokerage's own
 * prefix — the browser never chooses where a file lands, because a path it chose could name
 * another brokerage's folder.
 */
export const uploadRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  mimeType: z.string().trim().min(1).max(200),
  byteSize: z.number().int().positive(),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  kind: DocumentKind.default("other"),
  clientId: uuidSchema.nullable().default(null),
  workItemId: uuidSchema.nullable().default(null),
});
export type UploadRequest = z.infer<typeof uploadRequestSchema>;

export const uploadResponseSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("ready"),
    document: documentSummarySchema,
    /** Where to PUT the bytes, and for how long. */
    uploadUrl: z.string(),
    uploadToken: z.string(),
    storagePath: z.string(),
  }),
  /** The same bytes are already on file in this brokerage. Filing them twice is not an upload. */
  z.object({ outcome: z.literal("already_on_file"), document: documentSummarySchema }),
]);
export type UploadResponse = z.infer<typeof uploadResponseSchema>;

/** One person's decision about one extracted field. */
export const reviewFieldRequestSchema = z.object({
  decision: z.enum(["accept", "correct", "reject"]),
  /** Required for `correct`, refused otherwise: a correction is what a person typed. */
  value: z.string().trim().min(1).max(500).nullable().default(null),
});
export type ReviewFieldRequest = z.infer<typeof reviewFieldRequestSchema>;

/** What a decision returns: the field as it now stands, with the condition it now carries. */
export const reviewFieldResponseSchema = z.object({ field: documentFieldSchema });
export type ReviewFieldResponse = z.infer<typeof reviewFieldResponseSchema>;

/** What a caller sends to ask for somewhere to put a file (the defaults are the server's). */
export type UploadInput = z.input<typeof uploadRequestSchema>;

export const DOCUMENT_COLUMNS =
  "id, organization_id, client_id, work_item_id, kind, filename, mime_type, byte_size, storage_path, content_sha256, page_count, extraction_state, extraction_error, uploaded_by, created_at, updated_at, deleted_at";
export const DOCUMENT_PAGE_COLUMNS = "id, document_id, page_number, text, width, height";
export const DOCUMENT_FIELD_COLUMNS =
  "id, document_id, field_key, proposed_value, corrected_value, page_number, region_x, region_y, region_width, region_height, state, condition, reviewed_by, reviewed_at, created_at";

/* ---- Mailboxes: the email the brokerage already works from --------------------------------- */

/**
 * `GET /mailboxes` — what is connected, and what this deployment could connect (D-068).
 *
 * A mailbox row never carries a token. The encrypted access and refresh tokens exist only
 * server-side (0035 says so at the column), and no response shape here has anywhere to put one.
 *
 * `available` says whether the deployment holds OAuth credentials for a provider. It is a boolean,
 * never the credentials or their names: a browser learning that Gmail is configured is fine; a
 * browser learning anything about the client secret is not (§45 rule 4).
 */
export const MailboxProviderId = z.enum(["gmail", "microsoft"]);
export type MailboxProviderIdValue = z.infer<typeof MailboxProviderId>;

export const MAILBOX_PROVIDER_LABELS: Readonly<Record<MailboxProviderIdValue, string>> = {
  gmail: "Gmail",
  microsoft: "Microsoft 365",
};

export const MailboxStatus = z.enum(["connected", "needs_reauthorisation", "disconnected"]);

export const mailboxSchema = z.object({
  id: uuidSchema,
  provider: MailboxProviderId,
  emailAddress: z.string(),
  displayName: z.string().nullable(),
  status: MailboxStatus,
  /** Why it needs attention, in plain language. Shown, not logged and forgotten. */
  statusReason: z.string().nullable(),
  lastSyncedAt: z.string().nullable(),
  connectedAt: z.string(),
});
export type Mailbox = z.infer<typeof mailboxSchema>;

export const mailboxesResponseSchema = z.object({
  mailboxes: z.array(mailboxSchema),
  providers: z.array(
    z.object({
      id: MailboxProviderId,
      label: z.string(),
      /** True when this deployment holds the credentials needed to connect one. */
      available: z.boolean(),
      /** When it is not available, what is missing — in words, never variable names. */
      unavailableReason: z.string().nullable(),
    }),
  ),
});
export type MailboxesResponse = z.infer<typeof mailboxesResponseSchema>;

export const connectMailboxRequestSchema = z.object({ provider: MailboxProviderId });
export type ConnectMailboxRequest = z.infer<typeof connectMailboxRequestSchema>;

export const connectMailboxResponseSchema = z.discriminatedUnion("outcome", [
  /** Where to send the person to authorise. The state parameter is the server's, and single-use. */
  z.object({ outcome: z.literal("authorise"), url: z.string() }),
  /** This deployment cannot connect that provider yet, and says so rather than failing silently. */
  z.object({ outcome: z.literal("not_configured"), reason: z.string() }),
]);
export type ConnectMailboxResponse = z.infer<typeof connectMailboxResponseSchema>;

export const MAILBOX_COLUMNS =
  "id, organization_id, provider, email_address, display_name, connected_by, token_expires_at, sync_cursor, last_synced_at, status, status_reason, created_at, updated_at";

/**
 * `GET /email/threads` and `GET /email/threads/:id` — the brokerage's own correspondence.
 *
 * Read-only. There is no send here: a message leaves ASAP only through an approved draft with the
 * provider's own message id recorded against it (`email_send_attempts`), never from a list screen.
 */
export const emailMessageSchema = z.object({
  id: uuidSchema,
  direction: z.enum(["inbound", "outbound"]),
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string(),
  body: z.string().nullable(),
  snippet: z.string().nullable(),
  sentAt: z.string(),
  hasAttachments: z.boolean(),
});
export type EmailMessage = z.infer<typeof emailMessageSchema>;

export const emailThreadSummarySchema = z.object({
  id: uuidSchema,
  subject: z.string(),
  clientId: uuidSchema.nullable(),
  clientName: z.string().nullable(),
  workItemId: uuidSchema.nullable(),
  lastMessageAt: z.string().nullable(),
  messageCount: z.number().int().min(0),
});
export type EmailThreadSummary = z.infer<typeof emailThreadSummarySchema>;

export const emailThreadsResponseSchema = z.object({
  threads: z.array(emailThreadSummarySchema),
  /** True when no mailbox is connected at all, so the screen says that rather than "no email". */
  mailboxConnected: z.boolean(),
});
export type EmailThreadsResponse = z.infer<typeof emailThreadsResponseSchema>;

export const emailThreadResponseSchema = z.object({
  thread: emailThreadSummarySchema,
  messages: z.array(emailMessageSchema),
});
export type EmailThreadResponse = z.infer<typeof emailThreadResponseSchema>;
