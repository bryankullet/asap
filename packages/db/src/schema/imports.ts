import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz, uuidPrimaryKey } from "./_shared.js";
import { clients } from "./compliance.js";
import { clientContacts } from "./contacts.js";
import { organizations } from "./organizations.js";
import { policies, policyPeriods } from "./servicing.js";
import { users } from "./users.js";

export const IMPORT_STATUSES = ["previewed", "committed", "abandoned", "failed"] as const;
export const IMPORT_ROW_OUTCOMES = [
  "pending",
  "create",
  "match",
  "needs_review",
  "invalid",
  "skipped",
  "committed",
  "failed",
] as const;

/**
 * Migration 0040. One upload of a spreadsheet, previewed before anything is created (D-070).
 *
 * A preview is not an import: the batch sits in `previewed` with its rows resolved and nothing
 * written to the business tables until a person commits it. The partial unique index over
 * committed batches is what stops the same file being imported twice — a preview of the same
 * bytes is fine, a second commit is not.
 *
 * `premium_basis` is asked of the person, because a spreadsheet column of figures does not say
 * whether they are gross premiums or everything payable, and no one can work one out from the
 * other once the levies are on top.
 */
export const importBatches = pgTable(
  "import_batches",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentSha256: text("content_sha256").notNull(),
    rowCount: integer("row_count").notNull(),
    premiumBasis: text("premium_basis"),
    status: text("status").notNull().default("previewed"),
    clientsCreated: integer("clients_created").notNull().default(0),
    contactsCreated: integer("contacts_created").notNull().default(0),
    policiesCreated: integer("policies_created").notNull().default(0),
    periodsCreated: integer("periods_created").notNull().default(0),
    rowsSkipped: integer("rows_skipped").notNull().default(0),
    failureReason: text("failure_reason"),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    committedAt: timestamptz("committed_at"),
  },
  (t) => [
    check("import_batches_filename_check", sql`length(btrim(${t.filename})) > 0`),
    check("import_batches_content_sha256_check", sql`${t.contentSha256} ~ '^[0-9a-f]{64}$'`),
    check("import_batches_row_count_check", sql`${t.rowCount} >= 0`),
    check("import_batches_premium_basis_check", sql`${t.premiumBasis} in ('gross','total_payable')`),
    check(
      "import_batches_status_check",
      sql`${t.status} in ('previewed','committed','abandoned','failed')`,
    ),
    check("import_batches_clients_created_check", sql`${t.clientsCreated} >= 0`),
    check("import_batches_contacts_created_check", sql`${t.contactsCreated} >= 0`),
    check("import_batches_policies_created_check", sql`${t.policiesCreated} >= 0`),
    check("import_batches_periods_created_check", sql`${t.periodsCreated} >= 0`),
    check("import_batches_rows_skipped_check", sql`${t.rowsSkipped} >= 0`),
    uniqueIndex("import_batches_committed_content_key")
      .on(t.organizationId, t.contentSha256)
      .where(sql`${t.status} = 'committed'`),
    index("import_batches_organization_id_created_at_idx").on(
      t.organizationId,
      t.createdAt.desc(),
    ),
    index("import_batches_created_by_idx").on(t.createdBy),
  ],
);

/**
 * One line of the file, its raw values kept verbatim, and what was decided about it.
 *
 * The raw row is kept because a duplicate-resolution decision that cannot be re-read against the
 * original line is not reviewable. The five `created_*` columns are the receipt: what this line
 * actually produced, or `matched_client_id` when it turned out to be a client already on file.
 */
export const importRows = pgTable(
  "import_rows",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    batchId: uuid("batch_id")
      .notNull()
      .references(() => importBatches.id, { onDelete: "cascade" }),
    lineNumber: integer("line_number").notNull(),
    raw: jsonb("raw").notNull(),
    outcome: text("outcome").notNull().default("pending"),
    /** Why a line cannot be imported, in words a person can act on. */
    problem: text("problem"),
    matchedClientId: uuid("matched_client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    createdClientId: uuid("created_client_id").references(() => clients.id, {
      onDelete: "set null",
    }),
    createdContactId: uuid("created_contact_id").references(() => clientContacts.id, {
      onDelete: "set null",
    }),
    createdPolicyId: uuid("created_policy_id").references(() => policies.id, {
      onDelete: "set null",
    }),
    createdPeriodId: uuid("created_period_id").references(() => policyPeriods.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("import_rows_batch_id_line_number_key").on(t.batchId, t.lineNumber),
    check("import_rows_line_number_check", sql`${t.lineNumber} >= 1`),
    check(
      "import_rows_outcome_check",
      sql`${t.outcome} in ('pending','create','match','needs_review','invalid','skipped','committed','failed')`,
    ),
    index("import_rows_batch_id_outcome_idx").on(t.batchId, t.outcome),
    index("import_rows_organization_id_idx").on(t.organizationId),
    index("import_rows_matched_client_id_idx").on(t.matchedClientId),
    index("import_rows_created_client_id_idx").on(t.createdClientId),
    index("import_rows_created_contact_id_idx").on(t.createdContactId),
    index("import_rows_created_policy_id_idx").on(t.createdPolicyId),
    index("import_rows_created_period_id_idx").on(t.createdPeriodId),
  ],
);

export type ImportBatch = typeof importBatches.$inferSelect;
export type ImportRow = typeof importRows.$inferSelect;
