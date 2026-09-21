import { sql } from "drizzle-orm";
import { boolean, check, index, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";
import { createdAt, deletedAt, timestamptz, updatedAt, uuidPrimaryKey } from "./_shared.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";
import { workItems } from "./work.js";

export const AUTOMATION_APPROVALS = ["always", "never"] as const;
export const AUTOMATION_OUTCOMES = [
  "working",
  "prepared",
  "conditions_not_met",
  "needs_approval",
  "exception",
  "could_not_finish",
] as const;
export const AUTOMATION_DECISIONS = ["approved", "declined"] as const;

/**
 * Migration 0036. A standing instruction (D-063). Automation is built inside ASAP; there is no n8n.
 *
 * `sends_externally` is the one that matters: §45 rule 13 forbids uncontrolled external
 * communication, so an automation that sends outside the brokerage cannot be saved with anything
 * other than `approval = 'always'`. The constraint enforces it in the database, not the API.
 */
export const automations = pgTable(
  "automations",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** A semantic event name, `noun.verb` — never a table event (§29). */
    triggerEvent: text("trigger_event").notNull(),
    conditions: jsonb("conditions")
      .notNull()
      .default(sql`'[]'::jsonb`),
    skill: text("skill").notNull(),
    /** What it prepares, in brokerage words, for the history a person reads. */
    preparedVerb: text("prepared_verb").notNull(),
    approval: text("approval").notNull().default("always"),
    sendsExternally: boolean("sends_externally").notNull().default(false),
    /** Off until a person turns it on. A saved automation is not a running one. */
    enabled: boolean("enabled").notNull().default(false),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    deletedAt: deletedAt(),
  },
  (t) => [
    unique("automations_organization_id_name_key").on(t.organizationId, t.name),
    check("automations_name_check", sql`length(btrim(${t.name})) > 0`),
    check("automations_skill_check", sql`length(btrim(${t.skill})) > 0`),
    check("automations_trigger_event_check", sql`${t.triggerEvent} ~ '^[a-z_]+\\.[a-z_]+$'`),
    check("automations_approval_check", sql`${t.approval} in ('always','never')`),
    check(
      "automations_external_send_needs_approval",
      sql`not ${t.sendsExternally} or ${t.approval} = 'always'`,
    ),
    index("automations_organization_id_idx").on(t.organizationId),
    index("automations_trigger_event_idx")
      .on(t.organizationId, t.triggerEvent)
      .where(sql`${t.enabled}`),
    index("automations_created_by_idx").on(t.createdBy),
  ],
);

/**
 * Every firing, including the ones that did nothing and why (D-063).
 *
 * `(automation_id, event_id)` is unique, which is the idempotency: one event fires one automation
 * once, whatever the worker retries. Nothing here is hidden from the history (§45 rule 15), and a
 * decision on a prepared action carries the person who made it and when.
 */
export const automationRuns = pgTable(
  "automation_runs",
  {
    id: uuidPrimaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    automationId: uuid("automation_id")
      .notNull()
      .references(() => automations.id, { onDelete: "cascade" }),
    /** The triggering event. No foreign key: events are a dispatch log with a retention policy. */
    eventId: uuid("event_id").notNull(),
    eventName: text("event_name").notNull(),
    workItemId: uuid("work_item_id").references(() => workItems.id, { onDelete: "set null" }),
    outcome: text("outcome").notNull().default("working"),
    /** Which conditions held and which did not, so "it did nothing" is an answer, not a silence. */
    conditionResults: jsonb("condition_results")
      .notNull()
      .default(sql`'[]'::jsonb`),
    /** The frozen payload a person approves. Never executed before the decision exists. */
    preparedAction: jsonb("prepared_action"),
    reason: text("reason"),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamptz("decided_at"),
    decision: text("decision"),
    startedAt: timestamptz("started_at").notNull().defaultNow(),
    finishedAt: timestamptz("finished_at"),
  },
  (t) => [
    unique("automation_runs_automation_id_event_id_key").on(t.automationId, t.eventId),
    check(
      "automation_runs_outcome_check",
      sql`${t.outcome} in ('working','prepared','conditions_not_met','needs_approval','exception','could_not_finish')`,
    ),
    check("automation_runs_decision_check", sql`${t.decision} in ('approved','declined')`),
    check(
      "automation_runs_decision_has_a_person",
      sql`${t.decision} is null or (${t.decidedBy} is not null and ${t.decidedAt} is not null)`,
    ),
    check(
      "automation_runs_failure_has_a_reason",
      sql`${t.outcome} not in ('exception','could_not_finish') or ${t.reason} is not null`,
    ),
    index("automation_runs_organization_id_started_at_idx").on(
      t.organizationId,
      t.startedAt.desc(),
    ),
    index("automation_runs_awaiting_idx")
      .on(t.organizationId, t.startedAt.desc())
      .where(sql`${t.outcome} = 'needs_approval'`),
    index("automation_runs_automation_id_idx").on(t.automationId),
    index("automation_runs_work_item_id_idx").on(t.workItemId),
    index("automation_runs_decided_by_idx").on(t.decidedBy),
  ],
);

export type Automation = typeof automations.$inferSelect;
export type AutomationRun = typeof automationRuns.$inferSelect;
