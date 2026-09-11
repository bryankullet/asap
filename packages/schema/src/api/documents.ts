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

export const DOCUMENT_COLUMNS =
  "id, organization_id, client_id, work_item_id, kind, filename, mime_type, byte_size, storage_path, content_sha256, page_count, extraction_state, extraction_error, uploaded_by, created_at, updated_at, deleted_at";
export const DOCUMENT_PAGE_COLUMNS = "id, document_id, page_number, text, width, height";
export const DOCUMENT_FIELD_COLUMNS =
  "id, document_id, field_key, proposed_value, corrected_value, page_number, region_x, region_y, region_width, region_height, state, condition, reviewed_by, reviewed_at, created_at";
