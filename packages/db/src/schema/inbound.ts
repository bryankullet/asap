import { sql } from "drizzle-orm";
import { index, jsonb, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
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
