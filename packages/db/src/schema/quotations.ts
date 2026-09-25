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
  uuid,
} from "drizzle-orm/pg-core";
import { createdAt, timestamptz, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { clients, insurers } from "./compliance.js";
import { documents } from "./documents.js";
import { emailMessages } from "./email.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";
import { workItems } from "./work.js";

/**
 * Migration 0048. A client needs cover, and the market answers.
 *
 * No table here stores a status. An opportunity's position is derived from its own facts —
 * whether requirements are supplied, whether a request is approved, whether an insurer answered —
 * exactly as the economic model requires (D-027). The words on screen come from those facts and
 * so cannot drift from them.
 */

export const CLOSED_OUTCOMES = ["placed", "lost", "withdrawn"] as const;
export const RESPONSE_OUTCOMES = ["quoted", "declined", "no_response"] as const;
export const TERM_TYPES = [
  "excess",
  "limit",
  "condition",
  "exclusion",
  "levy",
  "tax",
  "subjectivity",
  "other",
] as const;

/** What a class of business needs before insurers are approached. Configurable, never a constant. */
export const requirementTemplates = pgTable(
  "requirement_templates",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    classOfBusiness: text("class_of_business").notNull(),
    label: text("label").notNull(),
    required: boolean("required").notNull().default(true),
    source: text("source"),
    verifiedAt: timestamptz("verified_at"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("requirement_templates_unique").on(t.organizationId, t.classOfBusiness, t.label),
    check("requirement_templates_class_of_business_check", sql`length(btrim(${t.classOfBusiness})) > 0`),
    check("requirement_templates_label_check", sql`length(btrim(${t.label})) > 0`),
    index("requirement_templates_organization_id_idx").on(t.organizationId),
  ],
);

export const opportunities = pgTable(
  "opportunities",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    clientId: uuid("client_id").notNull().references(() => clients.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").notNull().references(() => workItems.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    classOfBusiness: text("class_of_business").notNull(),
    riskSummary: text("risk_summary"),
    coverStart: date("cover_start"),
    coverEnd: date("cover_end"),
    sourceEmailMessageId: uuid("source_email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, { onDelete: "set null" }),
    ownerId: uuid("owner_id").references(() => users.id),
    createdBy: uuid("created_by").notNull().references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    closedAt: timestamptz("closed_at"),
    closedOutcome: text("closed_outcome"),
    closedReason: text("closed_reason"),
  },
  (t) => [
    unique("opportunities_work_item_id_key").on(t.workItemId),
    check("opportunities_title_check", sql`length(btrim(${t.title})) > 0`),
    check("opportunities_class_of_business_check", sql`length(btrim(${t.classOfBusiness})) > 0`),
    check("opportunities_closed_outcome_check", sql`${t.closedOutcome} in ('placed','lost','withdrawn')`),
    check(
      "opportunities_period_is_whole",
      sql`(${t.coverStart} is null and ${t.coverEnd} is null)
          or (${t.coverStart} is not null and ${t.coverEnd} is not null and ${t.coverEnd} >= ${t.coverStart})`,
    ),
    check(
      "opportunities_closed_is_whole",
      sql`(${t.closedAt} is null and ${t.closedOutcome} is null and ${t.closedReason} is null)
          or (${t.closedAt} is not null and ${t.closedOutcome} is not null
              and ${t.closedReason} is not null and length(btrim(${t.closedReason})) > 0)`,
    ),
    index("opportunities_organization_id_created_at_idx").on(t.organizationId, t.createdAt.desc()),
    index("opportunities_client_id_idx").on(t.clientId),
    index("opportunities_work_item_id_idx").on(t.workItemId),
    index("opportunities_owner_id_idx").on(t.ownerId),
    index("opportunities_created_by_idx").on(t.createdBy),
    index("opportunities_source_email_message_id_idx").on(t.sourceEmailMessageId),
    index("opportunities_source_document_id_idx").on(t.sourceDocumentId),
  ],
);

export const opportunityRequirements = pgTable(
  "opportunity_requirements",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    required: boolean("required").notNull().default(true),
    position: integer("position").notNull().default(0),
    suppliedAt: timestamptz("supplied_at"),
    suppliedBy: uuid("supplied_by").references(() => users.id),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id, { onDelete: "set null" }),
    evidenceEmailMessageId: uuid("evidence_email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
    evidenceNote: text("evidence_note"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("opportunity_requirements_unique").on(t.opportunityId, t.label),
    check("opportunity_requirements_label_check", sql`length(btrim(${t.label})) > 0`),
    check(
      "opportunity_requirements_supplied_is_whole",
      sql`(${t.suppliedAt} is null and ${t.suppliedBy} is null)
          or (${t.suppliedAt} is not null and ${t.suppliedBy} is not null)`,
    ),
    check(
      "opportunity_requirements_supplied_has_evidence",
      sql`${t.suppliedAt} is null
          or ${t.evidenceDocumentId} is not null
          or ${t.evidenceEmailMessageId} is not null
          or (${t.evidenceNote} is not null and length(btrim(${t.evidenceNote})) > 0)`,
    ),
    index("opportunity_requirements_organization_id_idx").on(t.organizationId),
    index("opportunity_requirements_opportunity_id_idx").on(t.opportunityId),
    index("opportunity_requirements_supplied_by_idx").on(t.suppliedBy),
    index("opportunity_requirements_evidence_document_id_idx").on(t.evidenceDocumentId),
    index("opportunity_requirements_evidence_email_message_id_idx").on(t.evidenceEmailMessageId),
  ],
);

export const opportunityInsurers = pgTable(
  "opportunity_insurers",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    insurerId: uuid("insurer_id").notNull().references(() => insurers.id),
    addedBy: uuid("added_by").notNull().references(() => users.id),
    addedAt: timestamptz("added_at").notNull().default(sql`now()`),
    removedAt: timestamptz("removed_at"),
    removedBy: uuid("removed_by").references(() => users.id),
    removedReason: text("removed_reason"),
  },
  (t) => [
    check(
      "opportunity_insurers_removed_is_whole",
      sql`(${t.removedAt} is null and ${t.removedBy} is null and ${t.removedReason} is null)
          or (${t.removedAt} is not null and ${t.removedBy} is not null
              and ${t.removedReason} is not null and length(btrim(${t.removedReason})) > 0)`,
    ),
    index("opportunity_insurers_organization_id_idx").on(t.organizationId),
    index("opportunity_insurers_opportunity_id_idx").on(t.opportunityId),
    index("opportunity_insurers_insurer_id_idx").on(t.insurerId),
    index("opportunity_insurers_added_by_idx").on(t.addedBy),
    index("opportunity_insurers_removed_by_idx").on(t.removedBy),
  ],
);

export const quoteRequests = pgTable(
  "quote_requests",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    opportunityInsurerId: uuid("opportunity_insurer_id").notNull().references(() => opportunityInsurers.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    preparedBy: uuid("prepared_by").notNull().references(() => users.id),
    preparedAt: timestamptz("prepared_at").notNull().default(sql`now()`),
    approvedBodySha256: text("approved_body_sha256"),
    approvedBy: uuid("approved_by").references(() => users.id),
    approvedAt: timestamptz("approved_at"),
    sentEmailMessageId: uuid("sent_email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
    sentAt: timestamptz("sent_at"),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("quote_requests_one_per_insurer").on(t.opportunityInsurerId),
    check("quote_requests_subject_check", sql`length(btrim(${t.subject})) > 0`),
    check("quote_requests_body_text_check", sql`length(btrim(${t.bodyText})) > 0`),
    check(
      "quote_requests_approval_is_whole",
      sql`(${t.approvedBy} is null and ${t.approvedAt} is null and ${t.approvedBodySha256} is null)
          or (${t.approvedBy} is not null and ${t.approvedAt} is not null and ${t.approvedBodySha256} is not null)`,
    ),
    check(
      "quote_requests_sent_needs_provider_evidence",
      sql`(${t.sentAt} is null and ${t.sentEmailMessageId} is null)
          or (${t.sentAt} is not null and ${t.sentEmailMessageId} is not null)`,
    ),
    check("quote_requests_sent_needs_approval", sql`${t.sentAt} is null or ${t.approvedAt} is not null`),
    index("quote_requests_organization_id_idx").on(t.organizationId),
    index("quote_requests_opportunity_id_idx").on(t.opportunityId),
    index("quote_requests_prepared_by_idx").on(t.preparedBy),
    index("quote_requests_approved_by_idx").on(t.approvedBy),
    index("quote_requests_sent_email_message_id_idx").on(t.sentEmailMessageId),
  ],
);

export const insurerResponses = pgTable(
  "insurer_responses",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").notNull().references(() => opportunities.id, { onDelete: "cascade" }),
    opportunityInsurerId: uuid("opportunity_insurer_id").notNull().references(() => opportunityInsurers.id, { onDelete: "cascade" }),
    outcome: text("outcome").notNull(),
    receivedAt: timestamptz("received_at"),
    sourceEmailMessageId: uuid("source_email_message_id").references(() => emailMessages.id, { onDelete: "set null" }),
    sourceDocumentId: uuid("source_document_id").references(() => documents.id, { onDelete: "set null" }),
    sourceNote: text("source_note"),
    premiumAmount: numeric("premium_amount", { precision: 14, scale: 2 }),
    premiumCurrency: text("premium_currency"),
    validUntil: date("valid_until"),
    declineReason: text("decline_reason"),
    recordedBy: uuid("recorded_by").notNull().references(() => users.id),
    recordedAt: timestamptz("recorded_at").notNull().default(sql`now()`),
    updatedAt: updatedAt(),
  },
  (t) => [
    unique("insurer_responses_one_per_insurer").on(t.opportunityInsurerId),
    check("insurer_responses_outcome_check", sql`${t.outcome} in ('quoted','declined','no_response')`),
    check("insurer_responses_premium_amount_check", sql`${t.premiumAmount} is null or ${t.premiumAmount} >= 0`),
    check("insurer_responses_premium_currency_check", sql`${t.premiumCurrency} is null or ${t.premiumCurrency} ~ '^[A-Z]{3}$'`),
    check(
      "insurer_responses_amount_needs_currency",
      sql`(${t.premiumAmount} is null and ${t.premiumCurrency} is null)
          or (${t.premiumAmount} is not null and ${t.premiumCurrency} is not null)`,
    ),
    check("insurer_responses_quoted_needs_a_time", sql`${t.outcome} <> 'quoted' or ${t.receivedAt} is not null`),
    check(
      "insurer_responses_quoted_needs_a_source",
      sql`${t.outcome} <> 'quoted'
          or ${t.sourceEmailMessageId} is not null
          or ${t.sourceDocumentId} is not null
          or (${t.sourceNote} is not null and length(btrim(${t.sourceNote})) > 0)`,
    ),
    check(
      "insurer_responses_decline_has_a_reason",
      sql`${t.outcome} <> 'declined'
          or (${t.declineReason} is not null and length(btrim(${t.declineReason})) > 0)`,
    ),
    check(
      "insurer_responses_no_response_is_empty",
      sql`${t.outcome} <> 'no_response' or (${t.premiumAmount} is null and ${t.receivedAt} is null)`,
    ),
    index("insurer_responses_organization_id_idx").on(t.organizationId),
    index("insurer_responses_opportunity_id_idx").on(t.opportunityId),
    index("insurer_responses_recorded_by_idx").on(t.recordedBy),
    index("insurer_responses_source_email_message_id_idx").on(t.sourceEmailMessageId),
    index("insurer_responses_source_document_id_idx").on(t.sourceDocumentId),
  ],
);

export const quoteTerms = pgTable(
  "quote_terms",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    insurerResponseId: uuid("insurer_response_id").notNull().references(() => insurerResponses.id, { onDelete: "cascade" }),
    termType: text("term_type").notNull(),
    label: text("label").notNull(),
    extractedValue: text("extracted_value"),
    correctedValue: text("corrected_value"),
    correctedBy: uuid("corrected_by").references(() => users.id),
    correctedAt: timestamptz("corrected_at"),
    amount: numeric("amount", { precision: 14, scale: 2 }),
    currency: text("currency"),
    unclear: boolean("unclear").notNull().default(false),
    evidenceDocumentId: uuid("evidence_document_id").references(() => documents.id, { onDelete: "set null" }),
    evidencePage: integer("evidence_page"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("quote_terms_unique").on(t.insurerResponseId, t.termType, t.label),
    check(
      "quote_terms_term_type_check",
      sql`${t.termType} in ('excess','limit','condition','exclusion','levy','tax','subjectivity','other')`,
    ),
    check("quote_terms_label_check", sql`length(btrim(${t.label})) > 0`),
    check("quote_terms_currency_check", sql`${t.currency} is null or ${t.currency} ~ '^[A-Z]{3}$'`),
    check("quote_terms_evidence_page_check", sql`${t.evidencePage} is null or ${t.evidencePage} >= 1`),
    check(
      "quote_terms_correction_is_whole",
      sql`(${t.correctedValue} is null and ${t.correctedBy} is null and ${t.correctedAt} is null)
          or (${t.correctedValue} is not null and ${t.correctedBy} is not null and ${t.correctedAt} is not null)`,
    ),
    check("quote_terms_amount_needs_currency", sql`${t.amount} is null or ${t.currency} is not null`),
    check(
      "quote_terms_says_something",
      sql`${t.extractedValue} is not null or ${t.correctedValue} is not null or ${t.amount} is not null or ${t.unclear}`,
    ),
    index("quote_terms_organization_id_idx").on(t.organizationId),
    index("quote_terms_insurer_response_id_idx").on(t.insurerResponseId),
    index("quote_terms_corrected_by_idx").on(t.correctedBy),
    index("quote_terms_evidence_document_id_idx").on(t.evidenceDocumentId),
  ],
);

export type RequirementTemplate = typeof requirementTemplates.$inferSelect;
export type Opportunity = typeof opportunities.$inferSelect;
export type OpportunityRequirement = typeof opportunityRequirements.$inferSelect;
export type OpportunityInsurer = typeof opportunityInsurers.$inferSelect;
export type QuoteRequest = typeof quoteRequests.$inferSelect;
export type InsurerResponse = typeof insurerResponses.$inferSelect;
export type QuoteTerm = typeof quoteTerms.$inferSelect;
