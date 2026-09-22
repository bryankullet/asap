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

/**
 * `POST /documents/:id/filed` — the browser says the bytes arrived.
 *
 * The upload is direct to storage, so the API never sees the transfer and cannot know it finished.
 * Without this the file sits in the bucket with nothing waiting on it, and "ASAP reads it next" —
 * which the screen says — is untrue. This is the signal that makes it true.
 *
 * It carries nothing. Everything it needs is on the document row, and a body would only be a way
 * for a browser to claim something about a file the server can check for itself.
 */
export const documentFiledResponseSchema = z.object({
  document: documentSummarySchema,
  /** False when the object is not in the bucket: the upload did not finish, whatever was claimed. */
  filed: z.boolean(),
});
export type DocumentFiledResponse = z.infer<typeof documentFiledResponseSchema>;

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

/**
 * What a mailbox's reading is doing, as the **server** sees it.
 *
 * Not a decoration and not a guess: each of these corresponds to something the backend can point
 * at. `syncing` means a sync run is genuinely active right now; `failed` means the last one ended
 * with an error a person can read and retry; `never` means the mailbox is connected and no sync
 * has ever run — which is the honest state for a deployment where the reader is not built yet, and
 * is the difference between a gap and a lie.
 */
export const MailboxSyncState = z.enum(["never", "syncing", "idle", "failed"]);
export type MailboxSyncState = z.infer<typeof MailboxSyncState>;

/** The reading half of a mailbox: only ever what the server can confirm. */
export const mailboxSyncSchema = z.object({
  state: MailboxSyncState,
  /** The run doing the reading, when one is active. Null in every other state. */
  runId: uuidSchema.nullable().default(null),
  /** When the last sync finished cleanly. Null until one has. */
  lastSyncedAt: z.string().nullable().default(null),
  /** The last failure, in the provider's or the worker's own words. Null when there was none. */
  error: z.string().max(500).nullable().default(null),
  /** True when a person may start one. False when no reader exists, or one is already running. */
  canStart: z.boolean().default(false),
  /** Why they may not, when they may not. Shown beside the control, never instead of it (§34). */
  cannotStartReason: z.string().max(300).nullable().default(null),
});
export type MailboxSync = z.infer<typeof mailboxSyncSchema>;

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
  /**
   * The reading state, from the server. A client may never infer "Syncing" from anything else —
   * the whole point is that the word appears when, and only when, a run is really going.
   */
  sync: mailboxSyncSchema.default({
    state: "never",
    runId: null,
    lastSyncedAt: null,
    error: null,
    canStart: false,
    cannotStartReason: null,
  }),
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

/* ---- What a person is told about a document (D-076) ------------------------------------------ */

/**
 * The state a person reads, derived from `extraction_state` and the fields' own conditions.
 *
 * `extraction_state` is where the *machine* has got to. It is not what a person needs to know:
 * `extracted` covers a document that is ready to check, one where two pages disagree, and one
 * where nothing could be read at all. Those are three different jobs, so they are three states.
 *
 * **Uploading a document is never described as reading it.** A file in the bucket that nothing has
 * looked at is `uploaded`, and says so.
 */
export const ReadingState = z.enum([
  /** In the bucket. Nothing has read it. */
  "uploaded",
  /** Waiting for the worker to claim it. */
  "queued",
  /** Our own extractor has it now. */
  "reading",
  /** Read, and every value is waiting for a person. */
  "ready_for_review",
  /** Read, but the document never gave something it was expected to. */
  "missing_information",
  /** Read, and two readings disagree. Both are kept; a person decides. */
  "conflict_found",
  /** Reading failed. The reason is in plain language and it can be tried again. */
  "failed",
  /** Nothing to read — not a document we extract from. */
  "not_applicable",
  /** Every value has been accepted, corrected or rejected by a person. */
  "reviewed",
]);
export type ReadingState = z.infer<typeof ReadingState>;

export const READING_STATE_LABELS: Readonly<Record<ReadingState, string>> = {
  uploaded: "Uploaded",
  queued: "Queued",
  reading: "Reading",
  ready_for_review: "Ready for review",
  missing_information: "Missing information",
  conflict_found: "Conflict found",
  failed: "Failed",
  not_applicable: "Not read",
  reviewed: "Reviewed",
};

export type ReadingStatus = {
  state: ReadingState;
  label: string;
  /** True only from `failed`: nothing else is a retry, and a retry of a success would re-propose
   * over a person's accepted values. */
  retryable: boolean;
  /** How many fields still have nobody's decision on them. */
  awaiting: number;
};

/**
 * Derived, never stored. A stored copy of this would be one more thing that can disagree with the
 * rows it was computed from.
 *
 * Precedence among read documents: a conflict outranks a gap, and a gap outranks "ready" — because
 * a person who is told "ready for review" and then finds two contradictory policy numbers has been
 * misled by the label that was meant to help them.
 */
export function readingStatus(input: {
  extractionState: ExtractionState;
  fields: readonly Pick<DocumentField, "state" | "condition">[];
}): ReadingStatus {
  const { extractionState, fields } = input;
  const awaiting = fields.filter((f) => f.state === "proposed").length;
  const done = (state: ReadingState): ReadingStatus => ({
    state,
    label: READING_STATE_LABELS[state],
    retryable: state === "failed",
    awaiting,
  });

  if (extractionState === "failed") return done("failed");
  if (extractionState === "not_applicable") return done("not_applicable");
  if (extractionState === "not_started") return done("uploaded");
  if (extractionState === "queued") return done("queued");
  if (extractionState === "working") return done("reading");

  // extracted. What a person does next depends on what was read, not on the fact that it was.
  const undecided = fields.filter((f) => f.state === "proposed");
  if (undecided.some((f) => f.condition === "conflicting")) return done("conflict_found");
  if (fields.length === 0 || undecided.some((f) => f.condition === "missing")) {
    return done("missing_information");
  }
  if (awaiting > 0) return done("ready_for_review");
  return done("reviewed");
}

/**
 * `POST /documents/:id/extraction/retry` — read it again.
 *
 * Only from `failed`. A retry from any other state would re-propose over values a person has
 * already accepted, which is the one thing extraction must never do.
 *
 * It carries nothing, and `retried: false` with the document's current state is the answer when
 * the document was not in a state a retry applies to — a second click on a queued document is the
 * ordinary case, not an error.
 */
export const retryExtractionResponseSchema = z.object({
  document: documentSummarySchema,
  retried: z.boolean(),
});
export type RetryExtractionResponse = z.infer<typeof retryExtractionResponseSchema>;

/* ---- Applying a document to the record it is about (D-077) ----------------------------------- */

/**
 * The kinds of record a document's values can be applied to.
 *
 * Narrow on purpose. A kind that is not here cannot be applied to, which is better than a kind
 * that can be applied to wrongly, and adding one is a migration that names exactly which fields
 * it accepts.
 */
export const ApplyTargetType = z.enum(["policy_period", "policy", "client"]);
export type ApplyTargetType = z.infer<typeof ApplyTargetType>;

/** Which extracted field can go where. The server is the authority; the UI reads this. */
export const APPLICABLE_FIELDS: Readonly<Record<ApplyTargetType, readonly string[]>> = {
  policy_period: ["period_start", "period_end", "premium"],
  policy: ["policy_number"],
  client: ["insured_name"],
};

/**
 * A record ASAP believes this document is about, and **why it believes it**.
 *
 * The reason is not decoration. A person is being asked to confirm a target, and a suggestion
 * they cannot check is a suggestion they have to take on trust. `condition` says how well it is
 * known in the same six words used everywhere else: `known` when the document is already filed
 * against the record, `inferred` when it was matched on what the document says.
 */
export const applyTargetSchema = z.object({
  targetType: ApplyTargetType,
  targetId: uuidSchema,
  /** What to call it on screen — "Acme Manufacturing · Commercial Motor · 2026". */
  label: z.string(),
  /** Why this record: in plain words, naming what the link rests on. */
  reason: z.string(),
  condition: EvidenceCondition,
});
export type ApplyTarget = z.infer<typeof applyTargetSchema>;

export const applyTargetsResponseSchema = z.object({
  suggestions: z.array(applyTargetSchema),
  /**
   * Why there is nothing to suggest, when there is nothing. Never null *and* empty: a person
   * needs to know whether ASAP found nothing or was never able to look.
   */
  whyNoTarget: z.string().nullable(),
  /** Which fields each kind of target accepts, so the UI never offers one that cannot apply. */
  applicableFields: z.record(ApplyTargetType, z.array(z.string())),
});
export type ApplyTargetsResponse = z.infer<typeof applyTargetsResponseSchema>;

/** One row of the before-and-after a person sees before anything is written. */
export const applyPreviewFieldSchema = z.object({
  documentFieldId: uuidSchema,
  fieldKey: z.string(),
  /** What the record holds now. Null means the record has nothing there yet. */
  currentValue: z.string().nullable(),
  /** What would be written: the person's correction if they made one, else what was read. */
  proposedValue: z.string().nullable(),
  page: z.number().int().nullable(),
  region: pageRegionSchema.nullable(),
  condition: EvidenceCondition,
  state: FieldState,
  /** True when the record already holds exactly this. Applying it would change nothing. */
  unchanged: z.boolean(),
  /** Why this field cannot be applied to this target, when it cannot. */
  blockedBecause: z.string().nullable(),
});
export type ApplyPreviewField = z.infer<typeof applyPreviewFieldSchema>;

export const applyPreviewResponseSchema = z.object({
  target: applyTargetSchema,
  fields: z.array(applyPreviewFieldSchema),
  /** Fields this target accepts but the document never gave. Stated, not omitted. */
  missing: z.array(z.string()),
});
export type ApplyPreviewResponse = z.infer<typeof applyPreviewResponseSchema>;

/**
 * `POST /documents/:id/apply` — write the chosen values to the named record.
 *
 * Three things are required rather than convenient:
 *
 *  - **`targetType` and `targetId`.** There is no "best guess" path. A document with no target a
 *    person has named is not applied.
 *  - **`from` on every field**: the value the browser showed. The server checks it against the
 *    record before writing anything, and refuses the whole apply if the record has moved.
 *  - **`idempotencyKey`**: one press of Apply. The same key returns the first receipt and writes
 *    nothing.
 */
export const applyRequestSchema = z.object({
  targetType: ApplyTargetType,
  targetId: uuidSchema,
  idempotencyKey: z.string().min(8).max(200),
  fields: z
    .array(
      z.object({
        documentFieldId: uuidSchema,
        fieldKey: z.string().min(1),
        /** What the record held when the person looked. Null when it held nothing. */
        from: z.string().nullable(),
        /** What to write. A person may correct it here before applying. */
        to: z.string().min(1),
        /**
         * A premium's basis — required for `premium`, meaningless for anything else.
         *
         * The database refuses an amount without a currency and a basis, and a schedule states a
         * figure without saying whether it is the gross premium or everything payable. Nobody can
         * derive one from the other once levies are involved, so the person chooses and the apply
         * is refused without it. Currency defaults to the brokerage's own, which is a fact about
         * the organization rather than a guess about the document.
         */
        premiumBasis: z.enum(["gross", "total_payable"]).optional(),
        premiumCurrency: z.string().length(3).optional(),
      }),
    )
    .min(1),
});
export type ApplyRequest = z.infer<typeof applyRequestSchema>;

export const applyResponseSchema = z.object({
  applicationId: uuidSchema,
  targetType: ApplyTargetType,
  targetId: uuidSchema,
  appliedAt: z.string(),
  /** What was written, both sides of each field. This is the receipt. */
  changes: z.array(
    z.object({
      fieldKey: z.string(),
      documentFieldId: uuidSchema.nullable(),
      from: z.string().nullable(),
      to: z.string(),
      page: z.number().int().nullable(),
    }),
  ),
  /** True when this key had already been applied: the receipt is the first one's. */
  repeat: z.boolean(),
});
export type ApplyResponse = z.infer<typeof applyResponseSchema>;

/** What the record held instead, when an apply was refused for being out of date. */
export const applyConflictSchema = z.object({
  fieldKey: z.string(),
  expected: z.string().nullable(),
  found: z.string().nullable(),
});
export type ApplyConflict = z.infer<typeof applyConflictSchema>;
