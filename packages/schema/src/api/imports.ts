import { z } from "zod";
import { uuidSchema } from "./common.js";

/**
 * Bringing an existing book in (D-070).
 *
 * A brokerage joining ASAP has years of clients, contacts and policies in a spreadsheet. This is
 * the contract for getting them in without losing what the spreadsheet says and without creating
 * a second, quieter path around the rules the manual one holds.
 *
 * Three properties the shape here exists to guarantee:
 *
 *  - **The preview is binding.** A preview stores its decision per row, and the commit writes
 *    exactly that. It does not re-read the file, so nothing can change between what a person
 *    approved and what happened.
 *  - **A duplicate is a question, not a policy.** Rows whose client is ambiguous come back as
 *    `needs_review` and are not written. The importer uses the same matcher as `POST /work-items`
 *    and `POST /policies`, so it cannot create twins the manual path would have caught.
 *  - **Nothing is inferred.** A premium's basis is asked once per file rather than guessed, and a
 *    commission the file did not give stays missing rather than being computed.
 */

/**
 * What a column of a brokerage's spreadsheet can mean.
 *
 * Deliberately flat and deliberately small: this is the set of things ASAP can do something with
 * today. A column that means nothing here is *kept in the raw row* and ignored, never dropped
 * silently and never guessed at.
 */
export const ImportColumn = z.enum([
  "client_name",
  "client_kind",
  "contact_name",
  "contact_email",
  "contact_phone",
  "contact_role",
  "policy_number",
  "insurer_name",
  "class_of_business",
  "period_start",
  "period_end",
  "premium_amount",
  "premium_currency",
  "commission_rate",
  "commission_amount",
]);
export type ImportColumn = z.infer<typeof ImportColumn>;

/** The only column an import cannot proceed without: everything hangs off the client. */
export const REQUIRED_IMPORT_COLUMNS: readonly ImportColumn[] = ["client_name"];

/**
 * Header spellings a real export actually uses, per meaning.
 *
 * Matched case- and punctuation-insensitively. This is a convenience that produces a *suggestion*:
 * the preview always returns the mapping it used, and a person can correct it before committing.
 * A header that matches nothing is not a failure — it is simply not mapped, and it says so.
 */
export const IMPORT_COLUMN_SYNONYMS: Readonly<Record<ImportColumn, readonly string[]>> = {
  client_name: ["client", "client name", "insured", "insured name", "customer", "name", "account"],
  client_kind: ["kind", "client type", "type", "category"],
  contact_name: ["contact", "contact name", "contact person", "attention", "attn"],
  contact_email: ["email", "e-mail", "contact email", "email address"],
  contact_phone: ["phone", "telephone", "mobile", "contact phone", "tel"],
  contact_role: ["contact role", "designation", "position", "title"],
  policy_number: ["policy number", "policy no", "policy", "policy ref", "certificate number"],
  insurer_name: ["insurer", "underwriter", "company", "insurance company"],
  class_of_business: ["class", "class of business", "product", "cover", "policy class", "lob"],
  period_start: ["start", "start date", "inception", "inception date", "from", "effective date"],
  period_end: ["end", "end date", "expiry", "expiry date", "to", "renewal date"],
  premium_amount: ["premium", "gross premium", "premium amount", "total premium", "amount"],
  premium_currency: ["currency", "ccy"],
  commission_rate: ["commission rate", "comm rate", "commission %", "rate"],
  commission_amount: ["commission", "commission amount", "comm", "brokerage"],
};

/**
 * What the file's premium column means. There is no default and no inference.
 *
 * `gross` is before the statutory levies (training levy, policyholder compensation fund);
 * `total_payable` is what the client actually pays. They differ, and recording one as the other is
 * silent until commission stops reconciling — so it is asked, once, per file.
 */
export const PremiumBasis = z.enum(["gross", "total_payable"]);
export type PremiumBasis = z.infer<typeof PremiumBasis>;

/** What the importer decided about one line, before anything was written. */
export const ImportRowOutcome = z.enum([
  "create", //        a new client, and whatever else the row carries
  "match", //         an existing client this row adds to
  "needs_review", //  the client is ambiguous: a person decides, nothing is written
  "invalid", //       the row cannot be written, and the reason says why in words
  "skipped", //       a person chose to leave it out
  "committed", //     written
  "failed", //        the write was attempted and did not succeed
]);
export type ImportRowOutcome = z.infer<typeof ImportRowOutcome>;

export const importCandidateSchema = z.object({ id: uuidSchema, name: z.string() });

export const importRowPreviewSchema = z.object({
  id: uuidSchema,
  lineNumber: z.number().int().min(1),
  outcome: ImportRowOutcome,
  /** Plain language. Never a column name, a constraint name or a stack trace. */
  problem: z.string().nullable(),
  /** What this row would create, in the words a person would read on the screen. */
  clientName: z.string().nullable(),
  contactName: z.string().nullable(),
  contactEmail: z.string().nullable(),
  policyNumber: z.string().nullable(),
  insurerName: z.string().nullable(),
  classOfBusiness: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  premiumAmount: z.string().nullable(),
  /** The existing client this row resolved to, when it resolved to one. */
  matchedClientId: uuidSchema.nullable(),
  /** When the client is ambiguous: who it might be, so a person can choose rather than guess. */
  candidates: z.array(importCandidateSchema).max(5).default([]),
});
export type ImportRowPreview = z.infer<typeof importRowPreviewSchema>;

export const importSummarySchema = z.object({
  rows: z.number().int().min(0),
  clientsToCreate: z.number().int().min(0),
  contactsToCreate: z.number().int().min(0),
  policiesToCreate: z.number().int().min(0),
  needsReview: z.number().int().min(0),
  invalid: z.number().int().min(0),
});
export type ImportSummary = z.infer<typeof importSummarySchema>;

export const importBatchSchema = z.object({
  id: uuidSchema,
  filename: z.string(),
  rowCount: z.number().int().min(0),
  premiumBasis: PremiumBasis.nullable(),
  status: z.enum(["previewed", "committed", "abandoned", "failed"]),
  clientsCreated: z.number().int().min(0),
  contactsCreated: z.number().int().min(0),
  policiesCreated: z.number().int().min(0),
  periodsCreated: z.number().int().min(0),
  rowsSkipped: z.number().int().min(0),
  failureReason: z.string().nullable(),
  createdAt: z.string(),
  committedAt: z.string().nullable(),
});
export type ImportBatch = z.infer<typeof importBatchSchema>;

/**
 * The most rows one file may carry.
 *
 * A cap rather than a queue, because the worker tier does not exist yet (D-070 Phase 3) and a
 * request that writes ten thousand rows synchronously would time out halfway, leaving a brokerage
 * unable to tell what had been written. The screen states the cap; a larger book is split.
 */
export const IMPORT_ROW_LIMIT = 2000;

export const importPreviewRequestSchema = z.object({
  filename: z.string().trim().min(1).max(255),
  /**
   * The file itself, base64-encoded, whatever kind it is. Read on the server so that a CSV, a
   * spreadsheet and a PDF all reach the same validation — and so the browser is never the thing
   * that decided what a cell meant.
   *
   * Base64 costs a third in size, which is why the cap is stated in the file's own terms on the
   * screen rather than in encoded bytes here.
   */
  content: z.string().min(1).max(12_000_000),
  /** What the browser thinks it is. The extension is trusted first; this is the fallback. */
  mimeType: z.string().trim().max(200).default("application/octet-stream"),
  /** Asked once per file. Required as soon as a premium column is mapped. */
  premiumBasis: PremiumBasis.nullable().default(null),
  /**
   * An explicit header → meaning mapping, overriding what the synonyms suggested. This is the
   * seam that lets a differently-shaped book — separate client and policy sheets — be added later
   * without rewriting the parser.
   */
  columns: z.record(z.string(), ImportColumn).default({}),
});
export type ImportPreviewRequest = z.input<typeof importPreviewRequestSchema>;

/** How a file was read, so the screen can say so rather than implying every file is a CSV. */
export const ImportSource = z.enum(["csv", "spreadsheet", "pdf"]);
export type ImportSource = z.infer<typeof ImportSource>;

export const importPreviewResponseSchema = z.object({
  batch: importBatchSchema,
  /** Which reader understood the file. */
  source: ImportSource,
  /** For a workbook, the sheet that was read — named, never assumed. */
  sheetName: z.string().nullable().default(null),
  rows: z.array(importRowPreviewSchema),
  summary: importSummarySchema,
  /** The headers as found in the file, and what each was taken to mean (null = not mapped). */
  columns: z.array(z.object({ header: z.string(), meaning: ImportColumn.nullable() })),
  /** What the file needs before it can be committed, in words. Empty means it is ready. */
  blocking: z.array(z.string()),
  /** Set when a heading was mapped by the model rather than by the synonym table. */
  mappedByModel: z.array(z.string()).default([]),
});
export type ImportPreviewResponse = z.infer<typeof importPreviewResponseSchema>;

export const importCommitRequestSchema = z.object({
  /** Rows a person chose to leave out of an otherwise good file. */
  skipLineNumbers: z.array(z.number().int().min(1)).max(IMPORT_ROW_LIMIT).default([]),
});
export type ImportCommitRequest = z.input<typeof importCommitRequestSchema>;

export const importCommitResponseSchema = z.object({
  batch: importBatchSchema,
  /** What could not be written, per row, in words. Empty when everything landed. */
  failures: z.array(z.object({ lineNumber: z.number().int(), problem: z.string() })),
});
export type ImportCommitResponse = z.infer<typeof importCommitResponseSchema>;

export const importsResponseSchema = z.object({ batches: z.array(importBatchSchema) });
export type ImportsResponse = z.infer<typeof importsResponseSchema>;

export const IMPORT_BATCH_COLUMNS =
  "id, organization_id, filename, content_sha256, row_count, premium_basis, status, clients_created, contacts_created, policies_created, periods_created, rows_skipped, failure_reason, created_by, created_at, committed_at";
export const IMPORT_ROW_COLUMNS =
  "id, organization_id, batch_id, line_number, raw, outcome, problem, matched_client_id, created_client_id, created_contact_id, created_policy_id, created_period_id, created_at";
