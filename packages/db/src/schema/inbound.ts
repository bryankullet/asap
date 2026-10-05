import { sql } from "drizzle-orm";
import { index, jsonb, numeric, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz, uuidPrimaryKey } from "./_shared.js";
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
