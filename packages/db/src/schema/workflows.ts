import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { timestamptz, uuidPrimaryKey } from "./_shared.js";
import { organizations } from "./organizations.js";
import { quoteRequests } from "./quotations.js";
import { users } from "./users.js";
import { workItems } from "./work.js";

/** Durable workflow runs (0062, D-129). Written by the API engine; read under RLS. */
export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    workflow: text("workflow").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    state: text("state").notNull().default("running"),
    currentStep: text("current_step"),
    exception: jsonb("exception"),
    nextRunAt: timestamptz("next_run_at").notNull().default(sql`now()`),
    leaseUntil: timestamptz("lease_until"),
    facts: jsonb("facts").notNull().default(sql`'{}'::jsonb`),
    startedAt: timestamptz("started_at").notNull().default(sql`now()`),
    updatedAt: timestamptz("updated_at").notNull().default(sql`now()`),
    finishedAt: timestamptz("finished_at"),
  },
  (t) => [
    uniqueIndex("workflow_runs_one_live_per_subject").on(t.organizationId, t.workflow, t.subjectId).where(sql`state not in ('done', 'cancelled')`),
    index("workflow_runs_organization_id_idx").on(t.organizationId),
    index("workflow_runs_due_idx").on(t.nextRunAt).where(sql`state not in ('done', 'cancelled', 'exception')`),
    index("workflow_runs_work_item_id_idx").on(t.workItemId),
  ],
);

export const workflowSteps = pgTable(
  "workflow_steps",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    position: integer("position").notNull(),
    label: text("label").notNull(),
    state: text("state").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    nextAttemptAt: timestamptz("next_attempt_at"),
    dueAt: timestamptz("due_at"),
    startedAt: timestamptz("started_at"),
    finishedAt: timestamptz("finished_at"),
    output: jsonb("output").notNull().default(sql`'{}'::jsonb`),
    evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
    error: text("error"),
    updatedAt: timestamptz("updated_at").notNull().default(sql`now()`),
  },
  (t) => [unique("workflow_steps_one_per_key").on(t.runId, t.stepKey), index("workflow_steps_organization_id_idx").on(t.organizationId)],
);

export const workflowApprovals = pgTable(
  "workflow_approvals",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
    stepKey: text("step_key").notNull(),
    title: text("title").notNull(),
    bundle: jsonb("bundle").notNull(),
    bundleSha256: text("bundle_sha256").notNull(),
    state: text("state").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamptz("decided_at"),
    note: text("note"),
    createdAt: timestamptz("created_at").notNull().default(sql`now()`),
  },
  (t) => [
    uniqueIndex("workflow_approvals_one_pending").on(t.runId, t.stepKey).where(sql`state = 'pending'`),
    index("workflow_approvals_organization_id_idx").on(t.organizationId),
    index("workflow_approvals_run_id_idx").on(t.runId),
    index("workflow_approvals_decided_by_idx").on(t.decidedBy),
  ],
);

export const preparedCommunications = pgTable(
  "prepared_communications",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
    runId: uuid("run_id").notNull().references(() => workflowRuns.id, { onDelete: "cascade" }),
    approvalId: uuid("approval_id").references(() => workflowApprovals.id, { onDelete: "set null" }),
    audience: text("audience").notNull(),
    partyName: text("party_name").notNull(),
    toAddress: text("to_address"),
    subject: text("subject").notNull(),
    bodyText: text("body_text").notNull(),
    bodySha256: text("body_sha256").notNull(),
    state: text("state").notNull().default("prepared"),
    quoteRequestId: uuid("quote_request_id").references(() => quoteRequests.id, { onDelete: "set null" }),
    deliveryMethod: text("delivery_method"),
    deliveryReference: text("delivery_reference"),
    deliveredAt: timestamptz("delivered_at"),
    deliveredBy: uuid("delivered_by").references(() => users.id),
    providerMessageId: text("provider_message_id"),
    sendAttemptId: uuid("send_attempt_id"),
    createdAt: timestamptz("created_at").notNull().default(sql`now()`),
    updatedAt: timestamptz("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    index("prepared_communications_organization_id_idx").on(t.organizationId),
    index("prepared_communications_run_id_idx").on(t.runId),
    index("prepared_communications_approval_id_idx").on(t.approvalId),
    index("prepared_communications_quote_request_id_idx").on(t.quoteRequestId),
    index("prepared_communications_delivered_by_idx").on(t.deliveredBy),
    index("prepared_communications_send_attempt_id_idx").on(t.sendAttemptId),
  ],
);
