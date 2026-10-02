import { sql } from "drizzle-orm";
import { customType, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { timestamptz, uuidPrimaryKey } from "./_shared.js";
import { clients } from "./compliance.js";
import { organizations } from "./organizations.js";
import { workItems } from "./work.js";
import { workflowRuns } from "./workflows.js";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** The completion receipt of a finished workflow (0063, D-131). Written once by the engine. */
export const workflowReceipts = pgTable(
  "workflow_receipts",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().unique().references(() => workflowRuns.id, { onDelete: "cascade" }),
    workflow: text("workflow").notNull(),
    clientId: uuid("client_id").references(() => clients.id, { onDelete: "set null" }),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    outcome: text("outcome").notNull(),
    receipt: jsonb("receipt").notNull(),
    completedAt: timestamptz("completed_at").notNull().default(sql`now()`),
    search: tsvector("search").generatedAlwaysAs(sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(outcome, ''))`),
  },
  (t) => [
    index("workflow_receipts_organization_id_idx").on(t.organizationId),
    index("workflow_receipts_client_id_idx").on(t.clientId),
    index("workflow_receipts_work_item_id_idx").on(t.workItemId),
    index("workflow_receipts_search_idx").using("gin", t.search),
  ],
);
