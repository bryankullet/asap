import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  boolean,
  check,
  date,
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
import { createdAt, timestamptz, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { clients, insurers } from "./compliance.js";
import { documents } from "./documents.js";
import { emailMessages } from "./email.js";
import { organizations } from "./organizations.js";
import {
  insurerResponseRevisions,
  insurerResponses,
  opportunities,
  quoteComparisons,
  quoteTermRevisions,
} from "./quotations.js";
import { users } from "./users.js";
import { workItems } from "./work.js";

/**
 * Placement (0054).
 *
 * No step here may be inferred from the step before it: a recommendation is not a client
 * decision, a decision is not an approved request, an approved request is not a submitted one,
 * and a submitted request is not confirmed cover. None of these tables stores a status; where a
 * placement has got to is read from which of them have rows (D-027).
 */

/** What the client actually said, how it arrived, and exactly which revision they accepted. */
export const clientInstructions = pgTable(
  "client_instructions",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    comparisonId: uuid("comparison_id").references(() => quoteComparisons.id),
    insurerResponseId: uuid("insurer_response_id").notNull().references(() => insurerResponses.id, { onDelete: "cascade" }),
    responseRevisionId: uuid("response_revision_id").notNull().references(() => insurerResponseRevisions.id),
    source: text("source").notNull(),
    evidenceEmailMessageId: uuid("evidence_email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id, { onDelete: "set null" }),
    evidenceNote: text("evidence_note"),
    clientConditions: text("client_conditions"),
    instructedAt: timestamptz("instructed_at").notNull(),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
    supersededAt: timestamptz("superseded_at"),
    supersededReason: text("superseded_reason"),
    outsideComparison: boolean("outside_comparison").notNull().default(false),
    exceptionReason: text("exception_reason"),
    exceptionBy: uuid("exception_by").references(() => users.id),
    /* The instruction this one revises, when a client accepted an insurer's changes (0055). */
    revisesInstructionId: uuid("revises_instruction_id").references((): AnyPgColumn => clientInstructions.id),
    /* An explicit accepted cover period (0056). The end is derived from it, never assumed. */
    requestedPeriodMonths: integer("requested_period_months"),
    requestedPeriodDays: integer("requested_period_days"),
  },
  (t) => [
    check(
      "client_instructions_source_check",
      sql`${t.source} in ('email','document','telephone','meeting','signed_acceptance','in_person')`,
    ),
    check(
      "client_instructions_evidence_is_required",
      sql`${t.evidenceEmailMessageId} is not null or ${t.evidenceDocumentId} is not null
          or (${t.evidenceNote} is not null and length(btrim(${t.evidenceNote})) >= 10)`,
    ),
    check(
      "client_instructions_superseded_is_whole",
      sql`(${t.supersededAt} is null and ${t.supersededReason} is null)
          or (${t.supersededAt} is not null
              and ${t.supersededReason} is not null and length(btrim(${t.supersededReason})) > 0)`,
    ),
    check(
      "client_instructions_exception_is_whole",
      sql`(not ${t.outsideComparison} and ${t.exceptionReason} is null and ${t.exceptionBy} is null)
          or (${t.outsideComparison}
              and ${t.exceptionReason} is not null and length(btrim(${t.exceptionReason})) >= 10
              and ${t.exceptionBy} is not null)`,
    ),
    check(
      "client_instructions_names_the_comparison",
      sql`${t.outsideComparison} or ${t.comparisonId} is not null`,
    ),
    index("client_instructions_organization_id_idx").on(t.organizationId),
    index("client_instructions_opportunity_id_idx").on(t.opportunityId),
    index("client_instructions_client_id_idx").on(t.clientId),
    index("client_instructions_comparison_id_idx").on(t.comparisonId),
    index("client_instructions_insurer_response_id_idx").on(t.insurerResponseId),
    index("client_instructions_response_revision_id_idx").on(t.responseRevisionId),
    index("client_instructions_evidence_document_id_idx").on(t.evidenceDocumentId),
    index("client_instructions_evidence_email_message_id_idx").on(t.evidenceEmailMessageId),
    index("client_instructions_recorded_by_idx").on(t.recordedBy),
    index("client_instructions_exception_by_idx").on(t.exceptionBy),
    index("client_instructions_revises_instruction_id_idx").on(t.revisesInstructionId),
    uniqueIndex("client_instructions_one_live_per_opportunity")
      .on(t.opportunityId)
      .where(sql`${t.supersededAt} is null`),
  ],
);

/** One client instruction, one insurer, one attempt to put cover on risk. No status column. */
export const placements = pgTable(
  "placements",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    clientInstructionId: uuid("client_instruction_id").notNull().references(() => clientInstructions.id),
    insurerId: uuid("insurer_id").notNull().references(() => insurers.id),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    requestedEffectiveAt: timestamptz("requested_effective_at").notNull(),
    requestedExpiryAt: timestamptz("requested_expiry_at"),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    abandonedAt: timestamptz("abandoned_at"),
    abandonedReason: text("abandoned_reason"),
    basisPremiumAmount: numeric("basis_premium_amount", { precision: 14, scale: 2 }),
    basisPremiumCurrency: text("basis_premium_currency"),
    basisValidUntil: date("basis_valid_until"),
    basisSha256: text("basis_sha256"),
  },
  (t) => [
    unique("placements_one_per_instruction").on(t.clientInstructionId),
    check(
      "placements_abandoned_is_whole",
      sql`(${t.abandonedAt} is null and ${t.abandonedReason} is null)
          or (${t.abandonedAt} is not null
              and ${t.abandonedReason} is not null and length(btrim(${t.abandonedReason})) > 0)`,
    ),
    check(
      "placements_period_is_ordered",
      sql`${t.requestedExpiryAt} is null or ${t.requestedExpiryAt} > ${t.requestedEffectiveAt}`,
    ),
    check("placements_basis_sha256_check", sql`${t.basisSha256} is null or length(${t.basisSha256}) = 64`),
    index("placements_organization_id_idx").on(t.organizationId),
    index("placements_opportunity_id_idx").on(t.opportunityId),
    index("placements_client_id_idx").on(t.clientId),
    index("placements_insurer_id_idx").on(t.insurerId),
    index("placements_work_item_id_idx").on(t.workItemId),
    index("placements_created_by_idx").on(t.createdBy),
  ],
);

/** The terms the client accepted, copied by revision at the moment of placement. Never updated. */
export const placementBasisTerms = pgTable(
  "placement_basis_terms",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    placementId: uuid("placement_id").notNull().references(() => placements.id, { onDelete: "cascade" }),
    quoteTermRevisionId: uuid("quote_term_revision_id").references(() => quoteTermRevisions.id),
    termType: text("term_type").notNull(),
    label: text("label").notNull(),
    value: text("value"),
    amount: numeric("amount", { precision: 14, scale: 2 }),
    currency: text("currency"),
    unclear: boolean("unclear").notNull().default(false),
    createdAt: createdAt(),
    basisVersionId: uuid("basis_version_id").references((): AnyPgColumn => placementBasisVersions.id),
  },
  (t) => [
    index("placement_basis_terms_basis_version_id_idx").on(t.basisVersionId),
    uniqueIndex("placement_basis_terms_one_per_version_term")
      .on(t.basisVersionId, t.termType, t.label)
      .where(sql`${t.basisVersionId} is not null`),
    index("placement_basis_terms_organization_id_idx").on(t.organizationId),
    index("placement_basis_terms_placement_id_idx").on(t.placementId),
    index("placement_basis_terms_quote_term_revision_id_idx").on(t.quoteTermRevisionId),
  ],
);

/** One immutable version of what would be sent to the insurer. */
export const placementRequests = pgTable(
  "placement_requests",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    placementId: uuid("placement_id").notNull().references(() => placements.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    coverRequested: text("cover_requested").notNull(),
    effectiveAt: timestamptz("effective_at").notNull(),
    outstandingConditions: text("outstanding_conditions"),
    sha256: text("sha256").notNull(),
    preparedBy: uuid("prepared_by").notNull().references(() => users.id),
    preparedAt: timestamptz("prepared_at").notNull().defaultNow(),
    supersededAt: timestamptz("superseded_at"),
    supersededReason: text("superseded_reason"),
  },
  (t) => [
    unique("placement_requests_one_per_version").on(t.placementId, t.version),
    check("placement_requests_version_check", sql`${t.version} >= 1`),
    check("placement_requests_subject_check", sql`length(btrim(${t.subject})) > 0`),
    check("placement_requests_body_text_check", sql`length(btrim(${t.bodyText})) > 0`),
    check("placement_requests_cover_requested_check", sql`length(btrim(${t.coverRequested})) > 0`),
    check("placement_requests_sha256_check", sql`length(${t.sha256}) = 64`),
    check(
      "placement_requests_superseded_is_whole",
      sql`(${t.supersededAt} is null and ${t.supersededReason} is null)
          or (${t.supersededAt} is not null
              and ${t.supersededReason} is not null and length(btrim(${t.supersededReason})) > 0)`,
    ),
    index("placement_requests_organization_id_idx").on(t.organizationId),
    index("placement_requests_placement_id_idx").on(t.placementId),
    index("placement_requests_prepared_by_idx").on(t.preparedBy),
    uniqueIndex("placement_requests_one_live_per_placement")
      .on(t.placementId)
      .where(sql`${t.supersededAt} is null`),
  ],
);

/** An approval of one exact request version, by digest. */
export const placementRequestApprovals = pgTable(
  "placement_request_approvals",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    placementRequestId: uuid("placement_request_id").notNull().references(() => placementRequests.id, { onDelete: "cascade" }),
    sha256: text("sha256").notNull(),
    approvedBy: uuid("approved_by").notNull().references(() => users.id),
    approvedAt: timestamptz("approved_at").notNull().defaultNow(),
    supersededAt: timestamptz("superseded_at"),
    supersededReason: text("superseded_reason"),
  },
  (t) => [
    check("placement_request_approvals_sha256_check", sql`length(${t.sha256}) = 64`),
    check(
      "placement_request_approvals_superseded_is_whole",
      sql`(${t.supersededAt} is null and ${t.supersededReason} is null)
          or (${t.supersededAt} is not null
              and ${t.supersededReason} is not null and length(btrim(${t.supersededReason})) > 0)`,
    ),
    index("placement_request_approvals_organization_id_idx").on(t.organizationId),
    index("placement_request_approvals_placement_request_id_idx").on(t.placementRequestId),
    index("placement_request_approvals_approved_by_idx").on(t.approvedBy),
    uniqueIndex("placement_request_approvals_one_live_per_request")
      .on(t.placementRequestId)
      .where(sql`${t.supersededAt} is null`),
  ],
);

/** Proof a request left the brokerage. Never written without a provider id or human evidence. */
export const placementSubmissions = pgTable(
  "placement_submissions",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    placementRequestId: uuid("placement_request_id").notNull().references(() => placementRequests.id, { onDelete: "cascade" }),
    sha256: text("sha256").notNull(),
    method: text("method").notNull(),
    providerMessageId: uuid("provider_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
    recipient: text("recipient").notNull(),
    sentAt: timestamptz("sent_at").notNull(),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id, { onDelete: "set null" }),
    evidenceNote: text("evidence_note"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
    idempotencyKey: text("idempotency_key").notNull(),
  },
  (t) => [
    unique("placement_submissions_one_per_key").on(t.organizationId, t.idempotencyKey),
    check("placement_submissions_sha256_check", sql`length(${t.sha256}) = 64`),
    check(
      "placement_submissions_method_check",
      sql`${t.method} in ('provider_email','recorded_manual_email','recorded_portal','recorded_post','recorded_in_person')`,
    ),
    check("placement_submissions_recipient_check", sql`length(btrim(${t.recipient})) > 0`),
    check(
      "placement_submissions_idempotency_key_check",
      sql`length(btrim(${t.idempotencyKey})) between 8 and 200`,
    ),
    check(
      "placement_submissions_needs_proof",
      sql`(${t.method} = 'provider_email' and ${t.providerMessageId} is not null)
          or (${t.method} <> 'provider_email'
              and (${t.evidenceDocumentId} is not null
                   or (${t.evidenceNote} is not null and length(btrim(${t.evidenceNote})) >= 10)))`,
    ),
    index("placement_submissions_organization_id_idx").on(t.organizationId),
    index("placement_submissions_placement_request_id_idx").on(t.placementRequestId),
    index("placement_submissions_provider_message_id_idx").on(t.providerMessageId),
    index("placement_submissions_evidence_document_id_idx").on(t.evidenceDocumentId),
    index("placement_submissions_recorded_by_idx").on(t.recordedBy),
    uniqueIndex("placement_submissions_one_per_request").on(t.placementRequestId),
  ],
);

/** What the insurer said back to a submitted placement. */
export const placementInsurerResponses = pgTable(
  "placement_insurer_responses",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    placementId: uuid("placement_id").notNull().references(() => placements.id, { onDelete: "cascade" }),
    placementSubmissionId: uuid("placement_submission_id").references(() => placementSubmissions.id, { onDelete: "set null" }),
    outcome: text("outcome").notNull(),
    receivedAt: timestamptz("received_at").notNull(),
    effectiveAt: timestamptz("effective_at"),
    expiryAt: timestamptz("expiry_at"),
    insurerReference: text("insurer_reference"),
    changesNote: text("changes_note"),
    informationRequired: text("information_required"),
    declineReason: text("decline_reason"),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id, { onDelete: "set null" }),
    evidenceEmailMessageId: uuid("evidence_email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
    evidenceNote: text("evidence_note"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
    supersededAt: timestamptz("superseded_at"),
    supersededReason: text("superseded_reason"),
    confirmedInsurerName: text("confirmed_insurer_name"),
    confirmedClassOfBusiness: text("confirmed_class_of_business"),
    confirmedSubject: text("confirmed_subject"),
    confirmedPremiumAmount: numeric("confirmed_premium_amount", { precision: 14, scale: 2 }),
    confirmedPremiumCurrency: text("confirmed_premium_currency"),
    confirmedPremiumBasis: text("confirmed_premium_basis"),
  },
  (t) => [
    check(
      "placement_insurer_responses_outcome_check",
      sql`${t.outcome} in ('confirmed_as_requested','confirmed_with_changes','more_information_required','declined')`,
    ),
    check(
      "placement_insurer_responses_superseded_is_whole",
      sql`(${t.supersededAt} is null and ${t.supersededReason} is null)
          or (${t.supersededAt} is not null
              and ${t.supersededReason} is not null and length(btrim(${t.supersededReason})) > 0)`,
    ),
    check(
      "placement_insurer_responses_confirmed_needs_a_start",
      sql`${t.outcome} not in ('confirmed_as_requested','confirmed_with_changes') or ${t.effectiveAt} is not null`,
    ),
    check(
      "placement_insurer_responses_confirmed_needs_evidence",
      sql`${t.outcome} not in ('confirmed_as_requested','confirmed_with_changes')
          or ${t.evidenceDocumentId} is not null
          or ${t.evidenceEmailMessageId} is not null
          or (${t.evidenceNote} is not null and length(btrim(${t.evidenceNote})) >= 10)`,
    ),
    check(
      "placement_insurer_responses_changes_are_named",
      sql`${t.outcome} <> 'confirmed_with_changes'
          or (${t.changesNote} is not null and length(btrim(${t.changesNote})) >= 10)`,
    ),
    check(
      "placement_insurer_responses_query_is_named",
      sql`${t.outcome} <> 'more_information_required'
          or (${t.informationRequired} is not null and length(btrim(${t.informationRequired})) >= 5)`,
    ),
    check(
      "placement_insurer_responses_decline_has_a_reason",
      sql`${t.outcome} <> 'declined' or (${t.declineReason} is not null and length(btrim(${t.declineReason})) >= 5)`,
    ),
    check(
      "placement_insurer_responses_period_is_ordered",
      sql`${t.expiryAt} is null or ${t.effectiveAt} is null or ${t.expiryAt} > ${t.effectiveAt}`,
    ),
    index("placement_insurer_responses_organization_id_idx").on(t.organizationId),
    index("placement_insurer_responses_placement_id_idx").on(t.placementId),
    index("placement_insurer_responses_placement_submission_id_idx").on(t.placementSubmissionId),
    index("placement_insurer_responses_evidence_document_id_idx").on(t.evidenceDocumentId),
    index("placement_insurer_responses_evidence_email_message_id_idx").on(t.evidenceEmailMessageId),
    index("placement_insurer_responses_recorded_by_idx").on(t.recordedBy),
    uniqueIndex("placement_insurer_responses_one_live_per_placement")
      .on(t.placementId)
      .where(sql`${t.supersededAt} is null`),
  ],
);

/** Cancellation, with evidence. The one cover fact that is not an insurer response. */
export const placementCancellations = pgTable(
  "placement_cancellations",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    placementId: uuid("placement_id").notNull().references(() => placements.id, { onDelete: "cascade" }),
    cancelledAt: timestamptz("cancelled_at").notNull(),
    reason: text("reason").notNull(),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id, { onDelete: "set null" }),
    evidenceEmailMessageId: uuid("evidence_email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
    evidenceNote: text("evidence_note"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    unique("placement_cancellations_one_per_placement").on(t.placementId),
    check("placement_cancellations_reason_check", sql`length(btrim(${t.reason})) >= 5`),
    check(
      "placement_cancellations_needs_evidence",
      sql`${t.evidenceDocumentId} is not null or ${t.evidenceEmailMessageId} is not null
          or (${t.evidenceNote} is not null and length(btrim(${t.evidenceNote})) >= 10)`,
    ),
    index("placement_cancellations_organization_id_idx").on(t.organizationId),
    index("placement_cancellations_placement_id_idx").on(t.placementId),
    index("placement_cancellations_evidence_document_id_idx").on(t.evidenceDocumentId),
    index("placement_cancellations_evidence_email_message_id_idx").on(t.evidenceEmailMessageId),
    index("placement_cancellations_recorded_by_idx").on(t.recordedBy),
  ],
);

/** What the client accepted, as versions. Version 1 is the instruction; later ones are acceptances. */
export const placementBasisVersions = pgTable(
  "placement_basis_versions",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    placementId: uuid("placement_id").notNull().references(() => placements.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    clientInstructionId: uuid("client_instruction_id").notNull().references(() => clientInstructions.id),
    insurerId: uuid("insurer_id").notNull().references(() => insurers.id),
    classOfBusiness: text("class_of_business"),
    subject: text("subject"),
    effectiveAt: timestamptz("effective_at"),
    expiryAt: timestamptz("expiry_at"),
    premiumAmount: numeric("premium_amount", { precision: 14, scale: 2 }),
    premiumCurrency: text("premium_currency"),
    premiumBasis: text("premium_basis"),
    clientConditions: text("client_conditions"),
    outstandingRequirements: text("outstanding_requirements"),
    periodMonths: integer("period_months"),
    periodDays: integer("period_days"),
    origin: text("origin").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("placement_basis_versions_one_per_version").on(t.placementId, t.version),
    check("placement_basis_versions_version_check", sql`${t.version} >= 1`),
    check("placement_basis_versions_origin_check", sql`${t.origin} in ('instruction','client_accepted_changes')`),
    index("placement_basis_versions_organization_id_idx").on(t.organizationId),
    index("placement_basis_versions_placement_id_idx").on(t.placementId),
    index("placement_basis_versions_client_instruction_id_idx").on(t.clientInstructionId),
    index("placement_basis_versions_insurer_id_idx").on(t.insurerId),
    index("placement_basis_versions_created_by_idx").on(t.createdBy),
  ],
);

/** The terms an insurer confirmed, one row each. Immutable. */
export const placementConfirmationTerms = pgTable(
  "placement_confirmation_terms",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    placementInsurerResponseId: uuid("placement_insurer_response_id").notNull().references(() => placementInsurerResponses.id, { onDelete: "cascade" }),
    termType: text("term_type").notNull(),
    label: text("label").notNull(),
    value: text("value"),
    amount: numeric("amount", { precision: 14, scale: 2 }),
    currency: text("currency"),
    unclear: boolean("unclear").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("placement_confirmation_terms_one_per_term").on(t.placementInsurerResponseId, t.termType, t.label),
    check(
      "placement_confirmation_terms_term_type_check",
      sql`${t.termType} in ('excess','limit','condition','exclusion','benefit','levy','tax','subjectivity','other')`,
    ),
    check("placement_confirmation_terms_label_check", sql`length(btrim(${t.label})) > 0`),
    index("placement_confirmation_terms_organization_id_idx").on(t.organizationId),
    index("placement_confirmation_terms_response_idx").on(t.placementInsurerResponseId),
  ],
);

/** A confirmation against an accepted basis version, field by field. */
export const coverMatchResults = pgTable(
  "cover_match_results",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    placementId: uuid("placement_id").notNull().references(() => placements.id, { onDelete: "cascade" }),
    basisVersionId: uuid("basis_version_id").notNull().references(() => placementBasisVersions.id),
    placementInsurerResponseId: uuid("placement_insurer_response_id").notNull().references(() => placementInsurerResponses.id),
    comparedBy: uuid("compared_by").references(() => users.id),
    comparedAt: timestamptz("compared_at").notNull().defaultNow(),
    materialDifferences: integer("material_differences").notNull().default(0),
    unclearCount: integer("unclear_count").notNull().default(0),
  },
  (t) => [
    check("cover_match_results_material_differences_check", sql`${t.materialDifferences} >= 0`),
    check("cover_match_results_unclear_count_check", sql`${t.unclearCount} >= 0`),
    index("cover_match_results_organization_id_idx").on(t.organizationId),
    index("cover_match_results_placement_id_idx").on(t.placementId),
    index("cover_match_results_basis_version_id_idx").on(t.basisVersionId),
    index("cover_match_results_response_idx").on(t.placementInsurerResponseId),
    index("cover_match_results_compared_by_idx").on(t.comparedBy),
  ],
);

export const coverMatchItems = pgTable(
  "cover_match_items",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    coverMatchResultId: uuid("cover_match_result_id").notNull().references(() => coverMatchResults.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    termType: text("term_type"),
    label: text("label").notNull(),
    acceptedValue: text("accepted_value"),
    confirmedValue: text("confirmed_value"),
    classification: text("classification").notNull(),
    material: boolean("material").notNull().default(false),
    position: integer("position").notNull().default(0),
    /* How a derived value was reached, when one was (0056): "1 Oct 2026 + 12 months". */
    calculation: text("calculation"),
  },
  (t) => [
    unique("cover_match_items_one_per_position").on(t.coverMatchResultId, t.position),
    check("cover_match_items_field_check", sql`length(btrim(${t.field})) > 0`),
    check(
      "cover_match_items_classification_check",
      sql`${t.classification} in ('match','changed','missing_from_confirmation','added_by_insurer','unclear','not_applicable')`,
    ),
    index("cover_match_items_organization_id_idx").on(t.organizationId),
    index("cover_match_items_result_idx").on(t.coverMatchResultId),
  ],
);

/** The client's answer to an insurer's changes. Only a full acceptance changes what was agreed. */
export const clientChangeAcceptances = pgTable(
  "client_change_acceptances",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    placementId: uuid("placement_id").notNull().references(() => placements.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    placementInsurerResponseId: uuid("placement_insurer_response_id").notNull().references(() => placementInsurerResponses.id),
    coverMatchResultId: uuid("cover_match_result_id").notNull().references(() => coverMatchResults.id),
    decision: text("decision").notNull(),
    source: text("source").notNull(),
    evidenceEmailMessageId: uuid("evidence_email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id, { onDelete: "set null" }),
    evidenceNote: text("evidence_note"),
    decidedAt: timestamptz("decided_at").notNull(),
    newClientInstructionId: uuid("new_client_instruction_id").references(() => clientInstructions.id),
    newBasisVersionId: uuid("new_basis_version_id").references(() => placementBasisVersions.id),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    unique("client_change_acceptances_one_per_match").on(t.coverMatchResultId),
    check("client_change_acceptances_decision_check", sql`${t.decision} in ('accept_all','reject','partial')`),
    check(
      "client_change_acceptances_source_check",
      sql`${t.source} in ('email','document','telephone','meeting','signed_acceptance','in_person')`,
    ),
    check(
      "client_change_acceptances_evidence_is_required",
      sql`${t.evidenceEmailMessageId} is not null or ${t.evidenceDocumentId} is not null
          or (${t.evidenceNote} is not null and length(btrim(${t.evidenceNote})) >= 10)`,
    ),
    check(
      "client_change_acceptances_only_full_changes_the_basis",
      sql`${t.decision} = 'accept_all' or (${t.newClientInstructionId} is null and ${t.newBasisVersionId} is null)`,
    ),
    index("client_change_acceptances_organization_id_idx").on(t.organizationId),
    index("client_change_acceptances_placement_id_idx").on(t.placementId),
    index("client_change_acceptances_client_id_idx").on(t.clientId),
    index("client_change_acceptances_response_idx").on(t.placementInsurerResponseId),
    index("client_change_acceptances_match_idx").on(t.coverMatchResultId),
    index("client_change_acceptances_evidence_email_idx").on(t.evidenceEmailMessageId),
    index("client_change_acceptances_evidence_document_idx").on(t.evidenceDocumentId),
    index("client_change_acceptances_new_instruction_idx").on(t.newClientInstructionId),
    index("client_change_acceptances_new_basis_idx").on(t.newBasisVersionId),
    index("client_change_acceptances_recorded_by_idx").on(t.recordedBy),
  ],
);

export const clientChangeAcceptanceItems = pgTable(
  "client_change_acceptance_items",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientChangeAcceptanceId: uuid("client_change_acceptance_id").notNull().references(() => clientChangeAcceptances.id, { onDelete: "cascade" }),
    coverMatchItemId: uuid("cover_match_item_id").notNull().references(() => coverMatchItems.id),
    decision: text("decision").notNull(),
  },
  (t) => [
    unique("client_change_acceptance_items_one_per_item").on(t.clientChangeAcceptanceId, t.coverMatchItemId),
    check("client_change_acceptance_items_decision_check", sql`${t.decision} in ('accepted','rejected','clarify')`),
    index("client_change_acceptance_items_organization_id_idx").on(t.organizationId),
    index("client_change_acceptance_items_acceptance_idx").on(t.clientChangeAcceptanceId),
    index("client_change_acceptance_items_match_item_idx").on(t.coverMatchItemId),
  ],
);

/** What Ask prepared, held on the server until a person confirms it. */
export const preparedActions = pgTable(
  "prepared_actions",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    placementId: uuid("placement_id").references(() => placements.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "cascade" }),
    actionType: text("action_type").notNull(),
    payload: jsonb("payload").notNull(),
    sourceVersions: jsonb("source_versions").notNull(),
    fingerprint: text("fingerprint").notNull(),
    changes: jsonb("changes").notNull().default(sql`'[]'::jsonb`),
    blockers: jsonb("blockers").notNull().default(sql`'[]'::jsonb`),
    permitted: boolean("permitted").notNull(),
    requiresConfirmation: boolean("requires_confirmation").notNull().default(true),
    idempotencyKey: text("idempotency_key").notNull(),
    state: text("state").notNull().default("prepared"),
    preparedBy: uuid("prepared_by").notNull().references(() => users.id),
    preparedAt: timestamptz("prepared_at").notNull().defaultNow(),
    expiresAt: timestamptz("expires_at").notNull(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamptz("decided_at"),
    receipt: jsonb("receipt"),
  },
  (t) => [
    unique("prepared_actions_one_per_key").on(t.organizationId, t.idempotencyKey),
    check(
      "prepared_actions_action_type_check",
      sql`${t.actionType} in ('record_instruction','prepare_request','request_approval','approve_request','record_submission','record_insurer_response','record_client_acceptance','prepare_issuance')`,
    ),
    check("prepared_actions_payload_check", sql`jsonb_typeof(${t.payload}) = 'object'`),
    check("prepared_actions_source_versions_check", sql`jsonb_typeof(${t.sourceVersions}) = 'object'`),
    check("prepared_actions_fingerprint_check", sql`length(${t.fingerprint}) = 64`),
    check("prepared_actions_changes_check", sql`jsonb_typeof(${t.changes}) = 'array'`),
    check("prepared_actions_blockers_check", sql`jsonb_typeof(${t.blockers}) = 'array'`),
    check("prepared_actions_idempotency_key_check", sql`length(btrim(${t.idempotencyKey})) between 8 and 200`),
    check(
      "prepared_actions_state_check",
      sql`${t.state} in ('prepared','executed','stale','refused','discarded','expired')`,
    ),
    check("prepared_actions_has_a_subject", sql`${t.placementId} is not null or ${t.opportunityId} is not null`),
    check(
      "prepared_actions_decision_is_whole",
      sql`${t.state} in ('prepared','expired') or (${t.decidedBy} is not null and ${t.decidedAt} is not null)`,
    ),
    check("prepared_actions_executed_has_receipt", sql`${t.state} <> 'executed' or ${t.receipt} is not null`),
    index("prepared_actions_organization_id_idx").on(t.organizationId),
    index("prepared_actions_placement_id_idx").on(t.placementId),
    index("prepared_actions_opportunity_id_idx").on(t.opportunityId),
    index("prepared_actions_prepared_by_idx").on(t.preparedBy),
    index("prepared_actions_decided_by_idx").on(t.decidedBy),
  ],
);

export type ClientInstruction = typeof clientInstructions.$inferSelect;
export type PlacementBasisVersion = typeof placementBasisVersions.$inferSelect;
export type CoverMatchResult = typeof coverMatchResults.$inferSelect;
export type CoverMatchItem = typeof coverMatchItems.$inferSelect;
export type ClientChangeAcceptance = typeof clientChangeAcceptances.$inferSelect;
export type PreparedAction = typeof preparedActions.$inferSelect;
export type Placement = typeof placements.$inferSelect;
export type PlacementBasisTerm = typeof placementBasisTerms.$inferSelect;
export type PlacementRequest = typeof placementRequests.$inferSelect;
export type PlacementRequestApproval = typeof placementRequestApprovals.$inferSelect;
export type PlacementSubmission = typeof placementSubmissions.$inferSelect;
export type PlacementInsurerResponse = typeof placementInsurerResponses.$inferSelect;
export type PlacementCancellation = typeof placementCancellations.$inferSelect;

/** A client's own condition, one per row, from the accepted instruction (0056). Immutable. */
export const placementClientConditions = pgTable(
  "placement_client_conditions",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    placementId: uuid("placement_id").notNull().references(() => placements.id, { onDelete: "cascade" }),
    clientInstructionId: uuid("client_instruction_id").notNull().references(() => clientInstructions.id),
    position: integer("position").notNull(),
    conditionText: text("condition_text").notNull(),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
  },
  (t) => [
    unique("placement_client_conditions_one_per_position").on(t.placementId, t.position),
    index("placement_client_conditions_organization_id_idx").on(t.organizationId),
    index("placement_client_conditions_placement_id_idx").on(t.placementId),
    index("placement_client_conditions_instruction_idx").on(t.clientInstructionId),
    index("placement_client_conditions_created_by_idx").on(t.createdBy),
  ],
);

/** How a client condition was resolved (0056). No row means unresolved. */
export const clientConditionResolutions = pgTable(
  "client_condition_resolutions",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    placementId: uuid("placement_id").notNull().references(() => placements.id, { onDelete: "cascade" }),
    conditionId: uuid("condition_id").notNull().references(() => placementClientConditions.id, { onDelete: "cascade" }),
    resolution: text("resolution").notNull(),
    placementInsurerResponseId: uuid("placement_insurer_response_id").references(() => placementInsurerResponses.id),
    reason: text("reason"),
    evidenceEmailMessageId: uuid("evidence_email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id, { onDelete: "set null" }),
    evidenceNote: text("evidence_note"),
    resolvedAt: timestamptz("resolved_at").notNull(),
    newClientInstructionId: uuid("new_client_instruction_id").references(() => clientInstructions.id),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamptz("recorded_at").notNull().defaultNow(),
  },
  (t) => [
    index("client_condition_resolutions_organization_id_idx").on(t.organizationId),
    index("client_condition_resolutions_placement_id_idx").on(t.placementId),
    index("client_condition_resolutions_condition_id_idx").on(t.conditionId),
    index("client_condition_resolutions_response_idx").on(t.placementInsurerResponseId),
    index("client_condition_resolutions_evidence_email_idx").on(t.evidenceEmailMessageId),
    index("client_condition_resolutions_evidence_document_idx").on(t.evidenceDocumentId),
    index("client_condition_resolutions_new_instruction_idx").on(t.newClientInstructionId),
    index("client_condition_resolutions_recorded_by_idx").on(t.recordedBy),
  ],
);
