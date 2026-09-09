import { sql } from "drizzle-orm";
import { date, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, timestamptz, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { clients, insurers } from "./compliance.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";
import { workItems } from "./work.js";

/** Migration 0028. */
export const policies = pgTable(
  "policies",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    insurerId: uuid("insurer_id").notNull().references(() => insurers.id),
    classOfBusiness: text("class_of_business").notNull(),
    policyNumber: text("policy_number"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [index("policies_organization_id_idx").on(t.organizationId), index("policies_client_id_idx").on(t.clientId), index("policies_insurer_id_idx").on(t.insurerId)],
);

/** D-029 option B: the thin client-policy-year. */
export const policyPeriods = pgTable(
  "policy_periods",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    policyId: uuid("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("policy_periods_organization_id_idx").on(t.organizationId), index("policy_periods_policy_id_idx").on(t.policyId)],
);

export const policyVersions = pgTable(
  "policy_versions",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    policyId: uuid("policy_id").notNull().references(() => policies.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    effectiveFrom: date("effective_from").notNull(),
    effectiveTo: date("effective_to"),
    source: text("source").notNull(),
    endorsementId: uuid("endorsement_id"),
    items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("policy_versions_policy_id_version_key").on(t.policyId, t.version),
    index("policy_versions_organization_id_idx").on(t.organizationId),
    index("policy_versions_created_by_idx").on(t.createdBy),
    index("policy_versions_endorsement_id_idx").on(t.endorsementId),
  ],
);

export const claims = pgTable(
  "claims",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id),
    policyId: uuid("policy_id").references(() => policies.id),
    policyPeriodId: uuid("policy_period_id").references(() => policyPeriods.id),
    status: text("status").notNull().default("draft"),
    source: text("source").notNull(),
    incidentOn: date("incident_on").notNull(),
    incidentSummary: text("incident_summary").notNull(),
    reportedOn: date("reported_on"),
    insurerReference: text("insurer_reference"),
    coverReview: text("cover_review"),
    coverReviewVersionId: uuid("cover_review_version_id").references(() => policyVersions.id),
    clockClauseReference: text("clock_clause_reference"),
    clockClausePage: integer("clock_clause_page"),
    clockClauseDays: integer("clock_clause_days"),
    clockStartEvent: text("clock_start_event"),
    clockStartOn: date("clock_start_on"),
    clockStartEvidence: text("clock_start_evidence"),
    offerReference: text("offer_reference"),
    offerRecordedAt: timestamptz("offer_recorded_at"),
    acceptanceReference: text("acceptance_reference"),
    acceptanceRecordedAt: timestamptz("acceptance_recorded_at"),
    paymentReference: text("payment_reference"),
    paymentRecordedAt: timestamptz("payment_recorded_at"),
    registeredBy: uuid("registered_by").references(() => users.id),
    registeredAt: timestamptz("registered_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("claims_work_item_id_key").on(t.workItemId),
    index("claims_organization_id_idx").on(t.organizationId),
    index("claims_client_id_idx").on(t.clientId),
    index("claims_policy_id_idx").on(t.policyId),
    index("claims_policy_period_id_idx").on(t.policyPeriodId),
    index("claims_cover_review_version_id_idx").on(t.coverReviewVersionId),
    index("claims_registered_by_idx").on(t.registeredBy),
  ],
);

export const claimDocuments = pgTable(
  "claim_documents",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    holder: text("holder").notNull(),
    reference: text("reference"),
    requestedAt: timestamptz("requested_at"),
    receivedAt: timestamptz("received_at"),
    createdAt: createdAt(),
  },
  (t) => [index("claim_documents_organization_id_idx").on(t.organizationId), index("claim_documents_claim_id_idx").on(t.claimId)],
);

export const claimNotes = pgTable(
  "claim_notes",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    claimId: uuid("claim_id").notNull().references(() => claims.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    spokeWith: text("spoke_with"),
    body: text("body").notNull(),
    notedBy: uuid("noted_by").references(() => users.id),
    notedAt: timestamptz("noted_at").notNull().defaultNow(),
  },
  (t) => [index("claim_notes_organization_id_idx").on(t.organizationId), index("claim_notes_claim_id_idx").on(t.claimId), index("claim_notes_noted_by_idx").on(t.notedBy)],
);

export const endorsements = pgTable(
  "endorsements",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    policyId: uuid("policy_id").notNull().references(() => policies.id),
    kind: text("kind"),
    requestedBy: text("requested_by").notNull(),
    requestedByName: text("requested_by_name"),
    requestText: text("request_text").notNull(),
    effectiveOn: date("effective_on"),
    instructionReference: text("instruction_reference"),
    instructionFrom: text("instruction_from"),
    responseReference: text("response_reference"),
    items: jsonb("items").notNull().default(sql`'[]'::jsonb`),
    appliedVersionId: uuid("applied_version_id").references(() => policyVersions.id),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("endorsements_work_item_id_key").on(t.workItemId),
    index("endorsements_organization_id_idx").on(t.organizationId),
    index("endorsements_policy_id_idx").on(t.policyId),
    index("endorsements_applied_version_id_idx").on(t.appliedVersionId),
    index("endorsements_created_by_idx").on(t.createdBy),
  ],
);
