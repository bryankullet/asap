import { sql } from "drizzle-orm";
import { customType, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, timestamptz, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

/** Migration 0022. Spec Part 5.1 shape; status vocabularies from Part 2.1, checked in SQL. */
export const workItems = pgTable(
  "work_items",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind").notNull(),
    clientId: uuid("client_id"),
    policyPeriodId: uuid("policy_period_id"),
    ownerId: uuid("owner_id").references(() => users.id),
    taskStatus: text("task_status").notNull(),
    taskParty: text("task_party"),
    taskSince: timestamptz("task_since"),
    taskNextCheck: timestamptz("task_next_check"),
    coverStatus: text("cover_status"),
    moneyStatus: text("money_status"),
    reason: text("reason"),
    steps: jsonb("steps").notNull().default(sql`'[]'::jsonb`),
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(task_party, ''))`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    completedAt: timestamptz("completed_at"),
    deletedAt: deletedAt(),
  },
  (t) => [
    index("work_items_organization_id_task_status_idx").on(t.organizationId, t.taskStatus),
    index("work_items_organization_id_updated_at_idx").on(t.organizationId, t.updatedAt),
    index("work_items_owner_id_idx").on(t.ownerId),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    status: text("status").notNull(),
    nextStep: text("next_step"),
    startedBy: uuid("started_by").references(() => users.id),
    startedAt: timestamptz("started_at").notNull().defaultNow(),
    endedAt: timestamptz("ended_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("runs_organization_id_started_at_idx").on(t.organizationId, t.startedAt),
    index("runs_work_item_id_idx").on(t.workItemId),
    index("runs_started_by_idx").on(t.startedBy),
  ],
);

export type WorkItemRow = typeof workItems.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
