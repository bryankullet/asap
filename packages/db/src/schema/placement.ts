import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
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
    quoteTermRevisionId: uuid("quote_term_revision_id").notNull().references(() => quoteTermRevisions.id),
    termType: text("term_type").notNull(),
    label: text("label").notNull(),
    value: text("value"),
    amount: numeric("amount", { precision: 14, scale: 2 }),
    currency: text("currency"),
    unclear: boolean("unclear").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique("placement_basis_terms_one_per_revision").on(t.placementId, t.quoteTermRevisionId),
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

export type ClientInstruction = typeof clientInstructions.$inferSelect;
export type Placement = typeof placements.$inferSelect;
export type PlacementBasisTerm = typeof placementBasisTerms.$inferSelect;
export type PlacementRequest = typeof placementRequests.$inferSelect;
export type PlacementRequestApproval = typeof placementRequestApprovals.$inferSelect;
export type PlacementSubmission = typeof placementSubmissions.$inferSelect;
export type PlacementInsurerResponse = typeof placementInsurerResponses.$inferSelect;
export type PlacementCancellation = typeof placementCancellations.$inferSelect;
