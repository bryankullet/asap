import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, deletedAt, timestamptz, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { clients } from "./compliance.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";
import { workItems } from "./work.js";

export const DOCUMENT_KINDS = [
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
] as const;

/** The honest states a filed document can be in (D-076). `failed` is the only retryable one. */
export const EXTRACTION_STATES = [
  "not_started",
  "queued",
  "working",
  "extracted",
  "failed",
  "not_applicable",
] as const;

export const DOCUMENT_FIELD_STATES = ["proposed", "accepted", "corrected", "rejected"] as const;
/** The six evidence conditions used on every surface (architecture §23). */
export const EVIDENCE_CONDITIONS = [
  "known",
  "inferred",
  "conflicting",
  "missing",
  "stale",
  "waiting",
] as const;

/**
 * Migration 0034. A document that was filed, and how far ASAP has got with reading it.
 *
 * `content_sha256` is what makes filing the same bytes twice one document rather than three: the
 * partial unique index over live rows is the whole idempotency story for upload retries.
 */
export const documents = pgTable(
  "documents",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    kind: text("kind").notNull(),
    filename: text("filename").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: bigint("byte_size", { mode: "number" }).notNull(),
    /** Private bucket object. Unique across the deployment: two documents never share bytes. */
    storagePath: text("storage_path").notNull(),
    contentSha256: text("content_sha256").notNull(),
    pageCount: integer("page_count"),
    extractionState: text("extraction_state").notNull().default("not_started"),
    /** Only a failure carries a reason, and a failure must carry one. */
    extractionError: text("extraction_error"),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("documents_storage_path_key").on(t.storagePath),
    check("documents_kind_check", sql`${t.kind} in ('policy_schedule','quote_slip','endorsement','claim_form','invoice','receipt','statement','certificate','correspondence','identity','other')`),
    check("documents_filename_check", sql`length(btrim(${t.filename})) > 0`),
    check("documents_byte_size_check", sql`${t.byteSize} > 0`),
    check("documents_content_sha256_check", sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check("documents_page_count_check", sql`${t.pageCount} is null or ${t.pageCount} > 0`),
    check(
      "documents_extraction_state_check",
      sql`${t.extractionState} in ('not_started','queued','working','extracted','failed','not_applicable')`,
    ),
    check(
      "documents_error_only_when_failed",
      sql`${t.extractionState} = 'failed' or ${t.extractionError} is null`,
    ),
    uniqueIndex("documents_organization_id_content_sha256_key")
      .on(t.organizationId, t.contentSha256)
      .where(sql`${t.deletedAt} is null`),
    index("documents_organization_id_created_at_idx").on(t.organizationId, t.createdAt.desc()),
    index("documents_client_id_idx").on(t.clientId),
    index("documents_work_item_id_idx").on(t.workItemId),
    index("documents_uploaded_by_idx").on(t.uploadedBy),
  ],
);

/**
 * One page, its text and its size in the page's own coordinate space.
 *
 * `width` and `height` are plain `numeric` rather than a fixed scale: they are PDF points, and a
 * highlight region is only meaningful against the exact page box the extractor measured.
 */
export const documentPages = pgTable(
  "document_pages",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    pageNumber: integer("page_number").notNull(),
    text: text("text").notNull().default(""),
    width: numeric("width", { mode: "string" }).notNull(),
    height: numeric("height", { mode: "string" }).notNull(),
  },
  (t) => [
    unique("document_pages_document_id_page_number_key").on(t.documentId, t.pageNumber),
    check("document_pages_page_number_check", sql`${t.pageNumber} >= 1`),
    check("document_pages_width_check", sql`${t.width} > 0`),
    check("document_pages_height_check", sql`${t.height} > 0`),
    index("document_pages_document_id_idx").on(t.documentId),
    index("document_pages_organization_id_idx").on(t.organizationId),
    // Full-text over page text: the search path for "which document said this?" (§45 rule 7
    // keeps exact lookups out of vector search; this is the text search, not embeddings).
    index("document_pages_text_search_idx").using("gin", sql`to_tsvector('english', ${t.text})`),
  ],
);

/**
 * What the extractor proposed, and what a person decided about it.
 *
 * The region is the citation: every cited figure is tappable to its document, page and highlight
 * (§36), so a region either has all four numbers and a page or none of them. And any state other
 * than `proposed` is a decision, which means it has a person and a time on it.
 */
export const documentFields = pgTable(
  "document_fields",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    fieldKey: text("field_key").notNull(),
    proposedValue: text("proposed_value"),
    /** A person's correction is kept beside the proposal, never over it. */
    correctedValue: text("corrected_value"),
    pageNumber: integer("page_number"),
    regionX: numeric("region_x", { mode: "string" }),
    regionY: numeric("region_y", { mode: "string" }),
    regionWidth: numeric("region_width", { mode: "string" }),
    regionHeight: numeric("region_height", { mode: "string" }),
    state: text("state").notNull().default("proposed"),
    condition: text("condition").notNull().default("inferred"),
    reviewedBy: uuid("reviewed_by").references(() => users.id),
    reviewedAt: timestamptz("reviewed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("document_fields_document_id_field_key_key").on(t.documentId, t.fieldKey),
    check("document_fields_field_key_check", sql`length(btrim(${t.fieldKey})) > 0`),
    check(
      "document_fields_state_check",
      sql`${t.state} in ('proposed','accepted','corrected','rejected')`,
    ),
    check(
      "document_fields_condition_check",
      sql`${t.condition} in ('known','inferred','conflicting','missing','stale','waiting')`,
    ),
    check(
      "document_fields_corrected_has_a_value",
      sql`${t.state} <> 'corrected' or ${t.correctedValue} is not null`,
    ),
    check(
      "document_fields_decision_has_a_person",
      sql`${t.state} = 'proposed' or (${t.reviewedBy} is not null and ${t.reviewedAt} is not null)`,
    ),
    check("document_fields_page_number_check", sql`${t.pageNumber} is null or ${t.pageNumber} >= 1`),
    check(
      "document_fields_region_needs_a_page",
      sql`${t.regionX} is null or ${t.pageNumber} is not null`,
    ),
    check(
      "document_fields_region_is_whole",
      sql`(${t.regionX} is null and ${t.regionY} is null and ${t.regionWidth} is null and ${t.regionHeight} is null)
          or (${t.regionX} is not null and ${t.regionY} is not null and ${t.regionWidth} is not null and ${t.regionHeight} is not null)`,
    ),
    index("document_fields_document_id_idx").on(t.documentId),
    index("document_fields_organization_id_idx").on(t.organizationId),
    index("document_fields_reviewed_by_idx").on(t.reviewedBy),
  ],
);

/**
 * Migration 0043. The receipt for applying what a document says to a business record (D-077).
 *
 * `target_id` deliberately carries no foreign key: the target may be a policy period, a policy or
 * a client, and `public.document_apply_to_record` resolves and permission-checks it before writing
 * anything. The unique key on `(organization_id, idempotency_key)` is what makes one press of
 * Apply write once, however many times the request arrives.
 *
 * Nothing writes this table through the data API — there is no write policy at all, only the
 * function, which is also where the staleness check and the audit row live.
 */
export const documentApplications = pgTable(
  "document_applications",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    /** One entry per field: its key, the page it was read from, and both sides of the change. */
    changes: jsonb("changes").notNull(),
    appliedBy: uuid("applied_by")
      .notNull()
      .references(() => users.id),
    appliedAt: timestamptz("applied_at").notNull().defaultNow(),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [
    unique("document_applications_org_idempotency_key").on(t.organizationId, t.idempotencyKey),
    check(
      "document_applications_target_type_check",
      sql`${t.targetType} in ('policy_period','policy','client')`,
    ),
    check("document_applications_changes_check", sql`jsonb_typeof(${t.changes}) = 'array'`),
    check(
      "document_applications_idempotency_key_check",
      sql`length(btrim(${t.idempotencyKey})) between 8 and 200`,
    ),
    index("document_applications_document_id_idx").on(t.documentId),
    index("document_applications_target_idx").on(t.organizationId, t.targetType, t.targetId),
    index("document_applications_applied_at_idx").on(t.organizationId, t.appliedAt.desc()),
    index("document_applications_applied_by_idx").on(t.appliedBy),
  ],
);

export type Document = typeof documents.$inferSelect;
export type DocumentPage = typeof documentPages.$inferSelect;
export type DocumentField = typeof documentFields.$inferSelect;
export type DocumentApplication = typeof documentApplications.$inferSelect;
