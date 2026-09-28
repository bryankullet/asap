import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz, uuidPrimaryKey } from "./_shared.js";
import { documentFields, documents } from "./documents.js";
import { emailMessages } from "./email.js";
import { organizations } from "./organizations.js";
import { clientInstructions, placementBasisVersions, placementInsurerResponses, placements } from "./placement.js";
import { documentTermProposals, insurerResponses } from "./quotations.js";
import { policies, policyPeriods } from "./servicing.js";
import { users } from "./users.js";

/*
 * Policy issuance (migration 0058, 4B-5): the frozen request, its approval and submission, the
 * insurer's policy document, the check of what it says, its resolutions, and the application that
 * writes the existing policy and period exactly once.
 */

const org = () => uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" });

export const issuanceRequests = pgTable(
  "issuance_requests",
  {
    id: uuidPrimaryKey(),
    organizationId: org(),
    placementId: uuid("placement_id").notNull().references(() => placements.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    payload: jsonb("payload").notNull(),
    sha256: text("sha256").notNull(),
    preparedBy: uuid("prepared_by").notNull().references(() => users.id),
    preparedAt: timestamptz("prepared_at").notNull().defaultNow(),
    supersededAt: timestamptz("superseded_at"),
    supersededReason: text("superseded_reason"),
  },
  (t) => [
    unique("issuance_requests_one_per_version").on(t.placementId, t.version),
    uniqueIndex("issuance_requests_one_live").on(t.placementId).where(sql`superseded_at is null`),
    check("issuance_requests_version_check", sql`${t.version} >= 1`),
    index("issuance_requests_organization_id_idx").on(t.organizationId),
    index("issuance_requests_placement_id_idx").on(t.placementId),
    index("issuance_requests_prepared_by_idx").on(t.preparedBy),
  ],
);

export const issuanceRequestApprovals = pgTable(
  "issuance_request_approvals",
  {
    id: uuidPrimaryKey(),
    organizationId: org(),
    issuanceRequestId: uuid("issuance_request_id").notNull().references(() => issuanceRequests.id, { onDelete: "cascade" }),
    sha256: text("sha256").notNull(),
    approvedBy: uuid("approved_by").notNull().references(() => users.id),
    approvedAt: timestamptz("approved_at").notNull().defaultNow(),
    supersededAt: timestamptz("superseded_at"),
    supersededReason: text("superseded_reason"),
  },
  (t) => [
    uniqueIndex("issuance_request_approvals_one_live").on(t.issuanceRequestId).where(sql`superseded_at is null`),
    index("issuance_request_approvals_organization_id_idx").on(t.organizationId),
    index("issuance_request_approvals_request_idx").on(t.issuanceRequestId),
    index("issuance_request_approvals_approved_by_idx").on(t.approvedBy),
  ],
);

export const issuanceSubmissions = pgTable(
  "issuance_submissions",
  {
    id: uuidPrimaryKey(),
    organizationId: org(),
    issuanceRequestId: uuid("issuance_request_id").notNull().references(() => issuanceRequests.id, { onDelete: "cascade" }),
    sha256: text("sha256").notNull(),
    method: text("method").notNull(),
    providerMessageId: text("provider_message_id"),
    recipient: text("recipient").notNull(),
    sentAt: timestamptz("sent_at").notNull(),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id, { onDelete: "set null" }),
    evidenceNote: text("evidence_note"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [
    unique("issuance_submissions_one_per_request").on(t.issuanceRequestId),
    unique("issuance_submissions_one_per_key").on(t.organizationId, t.idempotencyKey),
    index("issuance_submissions_organization_id_idx").on(t.organizationId),
    index("issuance_submissions_request_idx").on(t.issuanceRequestId),
    index("issuance_submissions_evidence_document_idx").on(t.evidenceDocumentId),
    index("issuance_submissions_recorded_by_idx").on(t.recordedBy),
  ],
);

export const issuedPolicyDocuments = pgTable(
  "issued_policy_documents",
  {
    id: uuidPrimaryKey(),
    organizationId: org(),
    placementId: uuid("placement_id").notNull().references(() => placements.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull().references(() => documents.id),
    issuanceRequestId: uuid("issuance_request_id").references(() => issuanceRequests.id),
    receivedAt: timestamptz("received_at").notNull(),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
    note: text("note"),
  },
  (t) => [
    unique("issued_policy_documents_once").on(t.placementId, t.documentId),
    index("issued_policy_documents_organization_id_idx").on(t.organizationId),
    index("issued_policy_documents_placement_id_idx").on(t.placementId),
    index("issued_policy_documents_document_id_idx").on(t.documentId),
    index("issued_policy_documents_request_idx").on(t.issuanceRequestId),
    index("issued_policy_documents_recorded_by_idx").on(t.recordedBy),
  ],
);

export const issuedPolicyChecks = pgTable(
  "issued_policy_checks",
  {
    id: uuidPrimaryKey(),
    organizationId: org(),
    placementId: uuid("placement_id").notNull().references(() => placements.id, { onDelete: "cascade" }),
    issuedPolicyDocumentId: uuid("issued_policy_document_id").notNull().references(() => issuedPolicyDocuments.id, { onDelete: "cascade" }),
    clientInstructionId: uuid("client_instruction_id").notNull().references(() => clientInstructions.id),
    basisVersionId: uuid("basis_version_id").notNull().references(() => placementBasisVersions.id),
    placementInsurerResponseId: uuid("placement_insurer_response_id").notNull().references(() => placementInsurerResponses.id),
    reviewSha256: text("review_sha256").notNull(),
    comparedBy: uuid("compared_by").references(() => users.id),
    comparedAt: timestamptz("compared_at").notNull().defaultNow(),
    materialDifferences: integer("material_differences").notNull(),
    unclearCount: integer("unclear_count").notNull(),
  },
  (t) => [
    index("issued_policy_checks_organization_id_idx").on(t.organizationId),
    index("issued_policy_checks_placement_id_idx").on(t.placementId),
    index("issued_policy_checks_document_idx").on(t.issuedPolicyDocumentId),
    index("issued_policy_checks_instruction_idx").on(t.clientInstructionId),
    index("issued_policy_checks_basis_idx").on(t.basisVersionId),
    index("issued_policy_checks_response_idx").on(t.placementInsurerResponseId),
    index("issued_policy_checks_compared_by_idx").on(t.comparedBy),
  ],
);

export const issuedPolicyCheckItems = pgTable(
  "issued_policy_check_items",
  {
    id: uuidPrimaryKey(),
    organizationId: org(),
    issuedPolicyCheckId: uuid("issued_policy_check_id").notNull().references(() => issuedPolicyChecks.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    field: text("field").notNull(),
    termType: text("term_type"),
    label: text("label").notNull(),
    instructionValue: text("instruction_value"),
    basisValue: text("basis_value"),
    confirmationValue: text("confirmation_value"),
    issuedValue: text("issued_value"),
    documentFieldId: uuid("document_field_id").references(() => documentFields.id, { onDelete: "set null" }),
    documentTermProposalId: uuid("document_term_proposal_id").references(() => documentTermProposals.id, { onDelete: "set null" }),
    pageNumber: integer("page_number"),
    classification: text("classification").notNull(),
    material: boolean("material").notNull(),
    calculation: text("calculation"),
  },
  (t) => [
    unique("issued_policy_check_items_one_per_position").on(t.issuedPolicyCheckId, t.position),
    index("issued_policy_check_items_organization_id_idx").on(t.organizationId),
    index("issued_policy_check_items_check_idx").on(t.issuedPolicyCheckId),
    index("issued_policy_check_items_field_idx").on(t.documentFieldId),
    index("issued_policy_check_items_term_idx").on(t.documentTermProposalId),
  ],
);

export const issuedPolicyResolutions = pgTable(
  "issued_policy_resolutions",
  {
    id: uuidPrimaryKey(),
    organizationId: org(),
    placementId: uuid("placement_id").notNull().references(() => placements.id, { onDelete: "cascade" }),
    issuedPolicyCheckItemId: uuid("issued_policy_check_item_id").notNull().references(() => issuedPolicyCheckItems.id, { onDelete: "cascade" }),
    resolution: text("resolution").notNull(),
    reason: text("reason").notNull(),
    evidenceEmailMessageId: uuid("evidence_email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id, { onDelete: "set null" }),
    evidenceNote: text("evidence_note"),
    resolvedAt: timestamptz("resolved_at").notNull(),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    unique("issued_policy_resolutions_once").on(t.issuedPolicyCheckItemId),
    index("issued_policy_resolutions_organization_id_idx").on(t.organizationId),
    index("issued_policy_resolutions_placement_id_idx").on(t.placementId),
    index("issued_policy_resolutions_item_idx").on(t.issuedPolicyCheckItemId),
    index("issued_policy_resolutions_evidence_email_idx").on(t.evidenceEmailMessageId),
    index("issued_policy_resolutions_evidence_document_idx").on(t.evidenceDocumentId),
    index("issued_policy_resolutions_recorded_by_idx").on(t.recordedBy),
  ],
);

export const policyIssuanceApplications = pgTable(
  "policy_issuance_applications",
  {
    id: uuidPrimaryKey(),
    organizationId: org(),
    placementId: uuid("placement_id").notNull().references(() => placements.id),
    targetMode: text("target_mode").notNull(),
    policyId: uuid("policy_id").notNull().references(() => policies.id),
    policyPeriodId: uuid("policy_period_id").notNull().references(() => policyPeriods.id),
    clientInstructionId: uuid("client_instruction_id").notNull().references(() => clientInstructions.id),
    basisVersionId: uuid("basis_version_id").notNull().references(() => placementBasisVersions.id),
    insurerResponseId: uuid("insurer_response_id").notNull().references(() => insurerResponses.id),
    placementInsurerResponseId: uuid("placement_insurer_response_id").notNull().references(() => placementInsurerResponses.id),
    issuedPolicyDocumentId: uuid("issued_policy_document_id").notNull().references(() => issuedPolicyDocuments.id),
    documentId: uuid("document_id").notNull().references(() => documents.id),
    issuedPolicyCheckId: uuid("issued_policy_check_id").notNull().references(() => issuedPolicyChecks.id),
    issuanceRequestId: uuid("issuance_request_id").notNull().references(() => issuanceRequests.id),
    changes: jsonb("changes").notNull(),
    appliedBy: uuid("applied_by").notNull().references(() => users.id),
    appliedAt: timestamptz("applied_at").notNull().defaultNow(),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [
    unique("policy_issuance_applications_one_per_placement").on(t.placementId),
    unique("policy_issuance_applications_one_per_key").on(t.organizationId, t.idempotencyKey),
    index("policy_issuance_applications_organization_id_idx").on(t.organizationId),
    index("policy_issuance_applications_policy_idx").on(t.policyId),
    index("policy_issuance_applications_period_idx").on(t.policyPeriodId),
  ],
);
