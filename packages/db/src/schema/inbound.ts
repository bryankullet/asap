import { sql } from "drizzle-orm";
import { date, index, integer, jsonb, numeric, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { timestamptz, uuidPrimaryKey } from "./_shared.js";
import { insurers } from "./compliance.js";
import { emailMessages } from "./email.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";
import { workItems } from "./work.js";
import { workflowRuns } from "./workflows.js";

/** What ASAP proposes an inbound email is and where it belongs (0070, D-144). Written by the API. */
export const inboundClassifications = pgTable(
  "inbound_classifications",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    emailMessageId: uuid("email_message_id").notNull().unique().references(() => emailMessages.id, { onDelete: "cascade" }),
    kind: text("kind"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    source: text("source").notNull(),
    model: text("model"),
    reason: text("reason"),
    candidates: jsonb("candidates").notNull().default(sql`'[]'::jsonb`),
    tieBreakRunId: uuid("tie_break_run_id").references(() => workflowRuns.id, { onDelete: "set null" }),
    state: text("state").notNull().default("proposed"),
    routedRunId: uuid("routed_run_id").references(() => workflowRuns.id, { onDelete: "set null" }),
    routedBy: text("routed_by"),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamptz("decided_at"),
    createdAt: timestamptz("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    index("inbound_classifications_organization_id_idx").on(t.organizationId),
    index("inbound_classifications_routed_run_id_idx").on(t.routedRunId),
    index("inbound_classifications_tie_break_run_id_idx").on(t.tieBreakRunId),
    index("inbound_classifications_work_item_id_idx").on(t.workItemId),
    index("inbound_classifications_decided_by_idx").on(t.decidedBy),
  ],
);

/** An insurer's verified address, recorded by a person with its source (0071, D-145). */
export const insurerContacts = pgTable(
  "insurer_contacts",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    insurerId: uuid("insurer_id").notNull().references(() => insurers.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    label: text("label"),
    source: text("source").notNull(),
    verifiedBy: uuid("verified_by").notNull().references(() => users.id),
    verifiedAt: timestamptz("verified_at").notNull().default(sql`now()`),
    retiredAt: timestamptz("retired_at"),
    createdAt: timestamptz("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    index("insurer_contacts_organization_id_idx").on(t.organizationId),
    index("insurer_contacts_insurer_id_idx").on(t.insurerId),
    index("insurer_contacts_verified_by_idx").on(t.verifiedBy),
  ],
);

/** One suggested fix for a stopped run, with its evidence (0072, D-146). A proposal. */
export const exceptionSuggestions = pgTable(
  "exception_suggestions",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
    eventId: uuid("event_id").notNull().unique(),
    exceptionCode: text("exception_code").notNull(),
    suggestion: text("suggestion").notNull(),
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    action: jsonb("action"),
    confidence: numeric("confidence", { precision: 4, scale: 3 }),
    model: text("model").notNull(),
    state: text("state").notNull().default("proposed"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamptz("decided_at"),
    decisionNote: text("decision_note"),
    createdAt: timestamptz("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    index("exception_suggestions_organization_id_idx").on(t.organizationId),
    index("exception_suggestions_run_id_idx").on(t.runId),
    index("exception_suggestions_decided_by_idx").on(t.decidedBy),
  ],
);

/** A person's standing approval of a routine insurer chaser's wording (0073, D-147). */
export const chaserTemplates = pgTable(
  "chaser_templates",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    purpose: text("purpose").notNull(),
    version: integer("version").notNull(),
    audience: text("audience").notNull().default("insurer"),
    subjectTemplate: text("subject_template").notNull(),
    bodyTemplate: text("body_template").notNull(),
    minDaysBetween: integer("min_days_between").notNull(),
    sha256: text("sha256").notNull(),
    approvedBy: uuid("approved_by").notNull().references(() => users.id),
    approvedAt: timestamptz("approved_at").notNull().default(sql`now()`),
    retiredAt: timestamptz("retired_at"),
  },
  (t) => [unique("chaser_templates_organization_id_purpose_version_key").on(t.organizationId, t.purpose, t.version), index("chaser_templates_approved_by_idx").on(t.approvedBy)],
);

/** Every chaser sent under a standing approval (0073, D-147). */
export const chaserSends = pgTable(
  "chaser_sends",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    templateId: uuid("template_id").notNull().references(() => chaserTemplates.id),
    runId: uuid("run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
    party: text("party").notNull(),
    followUp: integer("follow_up").notNull(),
    toAddress: text("to_address").notNull(),
    bodySha256: text("body_sha256").notNull(),
    sendAttemptId: uuid("send_attempt_id").notNull(),
    sentAt: timestamptz("sent_at").notNull().default(sql`now()`),
  },
  (t) => [
    unique("chaser_sends_run_id_party_follow_up_key").on(t.runId, t.party, t.followUp),
    index("chaser_sends_organization_id_idx").on(t.organizationId),
    index("chaser_sends_template_id_idx").on(t.templateId),
    index("chaser_sends_send_attempt_id_idx").on(t.sendAttemptId),
  ],
);

/** An insurer's reply as ASAP read it from the email (0076, D-152). A proposal. */
export const insurerResponseProposals = pgTable(
  "insurer_response_proposals",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    opportunityId: uuid("opportunity_id").notNull(),
    opportunityInsurerId: uuid("opportunity_insurer_id").notNull(),
    emailMessageId: uuid("email_message_id").notNull().references(() => emailMessages.id, { onDelete: "cascade" }),
    outcome: text("outcome").notNull(),
    premiumAmount: numeric("premium_amount", { precision: 14, scale: 2 }),
    premiumCurrency: text("premium_currency"),
    validUntil: date("valid_until"),
    declineReason: text("decline_reason"),
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    method: text("method").notNull(),
    state: text("state").notNull().default("proposed"),
    insurerResponseId: uuid("insurer_response_id"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamptz("decided_at"),
    createdAt: timestamptz("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    unique("insurer_response_proposals_one_per_email").on(t.opportunityInsurerId, t.emailMessageId),
    index("insurer_response_proposals_organization_id_idx").on(t.organizationId),
    index("insurer_response_proposals_opportunity_id_idx").on(t.opportunityId),
    index("insurer_response_proposals_email_message_id_idx").on(t.emailMessageId),
    index("insurer_response_proposals_insurer_response_id_idx").on(t.insurerResponseId),
    index("insurer_response_proposals_decided_by_idx").on(t.decidedBy),
  ],
);
