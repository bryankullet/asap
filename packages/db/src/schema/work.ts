import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
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
    steps: jsonb("steps")
      .notNull()
      .default(sql`'[]'::jsonb`),
    exception: jsonb("exception"),
    version: integer("version").notNull().default(1),
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
    /** The API process that started it (0024). Recovery on boot ends runs from other tokens. */
    bootToken: text("boot_token"),
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

/** Migration 0023. Persisted SSE events; a reconnecting stream replays from here. */
export const runEvents = pgTable(
  "run_events",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    kind: text("kind").notNull(),
    message: text("message").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("run_events_run_id_seq_key").on(t.runId, t.seq),
    index("run_events_organization_id_idx").on(t.organizationId),
  ],
);

/** Migration 0023. sent_at and sent_evidence exist together or not at all (spec Part 7). */
export const drafts = pgTable(
  "drafts",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    workItemId: uuid("work_item_id")
      .notNull()
      .references(() => workItems.id, { onDelete: "cascade" }),
    stepId: text("step_id").notNull(),
    toAddress: text("to_address").notNull().default(""),
    subject: text("subject").notNull().default(""),
    body: text("body").notNull().default(""),
    copiedAt: timestamptz("copied_at"),
    sentAt: timestamptz("sent_at"),
    sentEvidence: text("sent_evidence"),
    outcomeUnknown: boolean("outcome_unknown").notNull().default(false),
    createdBy: uuid("created_by").references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("drafts_organization_id_idx").on(t.organizationId),
    index("drafts_work_item_id_idx").on(t.workItemId),
    index("drafts_created_by_idx").on(t.createdBy),
  ],
);

export type WorkItemRow = typeof workItems.$inferSelect;
export type RunEventRow = typeof runEvents.$inferSelect;
export type DraftRow = typeof drafts.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
