import { z } from "zod";
import { ActionVerb } from "./actions.js";
import { uuidSchema } from "./api/common.js";

/**
 * Automations: a standing instruction from the brokerage.
 *
 * *When this happens, and these things are true, prepare that.* Three words in that sentence are
 * load-bearing:
 *
 *  - **happens** — a semantic event (`quote.received`), never a table change. A table event says
 *    what the database did; a semantic event says what happened in the business.
 *  - **true** — conditions are evaluated against facts read from records, by our own code. No
 *    model decides whether a condition holds.
 *  - **prepare** — the action is a named verb from the engine's own vocabulary, and the engine's
 *    guards still apply to it. An automation cannot invent a verb, write a status or approve
 *    anything (§45 rules 10, 13).
 */

/** The events an automation may watch. Each is emitted by our own code when the thing happens. */
export const AutomationTrigger = z.enum([
  "quote.received",
  "renewal.approaching",
  "document.received",
  "payment.received",
  "cover.confirmed",
  "claim.registered",
  "check.overdue",
  "run.could_not_finish",
]);
export type AutomationTrigger = z.infer<typeof AutomationTrigger>;

/**
 * One condition. Deliberately small: a fact read from the record, an operator, a value. Anything
 * a broker cannot read aloud and check by hand does not belong in a standing instruction.
 */
export const AutomationConditionOperator = z.enum([
  "equals",
  "not_equals",
  "is_one_of",
  "is_empty",
  "is_not_empty",
  "days_until_less_than",
  "days_since_more_than",
]);

export const automationConditionSchema = z.object({
  /** A named fact on the record — not a column, and not an expression. */
  fact: z.enum([
    "task_status",
    "cover_status",
    "money_status",
    "kind",
    "class_of_business",
    "insurer_name",
    "client_file_status",
    "period_end",
    "last_touched",
    "exception",
  ]),
  operator: AutomationConditionOperator,
  value: z
    .union([z.string(), z.number(), z.array(z.string())])
    .nullable()
    .default(null),
});
export type AutomationCondition = z.infer<typeof automationConditionSchema>;

export const automationSchema = z.object({
  id: uuidSchema,
  organization_id: uuidSchema,
  name: z.string(),
  description: z.string(),
  trigger_event: AutomationTrigger,
  conditions: z.array(automationConditionSchema),
  skill: z.string(),
  prepared_verb: ActionVerb,
  approval: z.enum(["always", "never"]),
  sends_externally: z.boolean(),
  enabled: z.boolean(),
  created_by: uuidSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type Automation = z.infer<typeof automationSchema>;

export const AutomationOutcome = z.enum([
  "working",
  "prepared",
  "conditions_not_met",
  "needs_approval",
  "exception",
  "could_not_finish",
]);
export type AutomationOutcome = z.infer<typeof AutomationOutcome>;

/** Which conditions held and which did not — so "why did nothing happen?" has an answer. */
export const conditionResultSchema = z.object({
  fact: z.string(),
  operator: z.string(),
  expected: z.union([z.string(), z.number(), z.array(z.string())]).nullable(),
  actual: z.string().nullable(),
  held: z.boolean(),
});
export type ConditionResult = z.infer<typeof conditionResultSchema>;

export const automationRunSchema = z.object({
  id: uuidSchema,
  automation_id: uuidSchema,
  event_id: uuidSchema,
  event_name: z.string(),
  work_item_id: uuidSchema.nullable(),
  outcome: AutomationOutcome,
  condition_results: z.array(conditionResultSchema),
  /** The verb and the step it would act on. Never a status, a value or a piece of prose. */
  prepared_action: z.object({ verb: ActionVerb, stepId: z.string() }).nullable(),
  reason: z.string().nullable(),
  decided_by: uuidSchema.nullable(),
  decided_at: z.string().nullable(),
  decision: z.enum(["approved", "declined"]).nullable(),
  started_at: z.string(),
  finished_at: z.string().nullable(),
});
export type AutomationRun = z.infer<typeof automationRunSchema>;

export const AUTOMATION_COLUMNS =
  "id, organization_id, name, description, trigger_event, conditions, skill, prepared_verb, approval, sends_externally, enabled, created_by, created_at, updated_at";
export const AUTOMATION_RUN_COLUMNS =
  "id, organization_id, automation_id, event_id, event_name, work_item_id, outcome, condition_results, prepared_action, reason, decided_by, decided_at, decision, started_at, finished_at";

/**
 * Verbs whose prepared action ends up in front of an outside party.
 *
 * Worth being precise: **no verb in the engine vocabulary sends anything.** `draft` opens a draft
 * for a person to send; `record_send` records that a person did. That is the design, and it is why
 * an automation cannot email a client by itself whatever it is configured to do.
 *
 * These two are nonetheless marked `sends_externally`, so the 0036 constraint refuses
 * `approval: never` on them. An automation that silently drafts letters to insurers, or that
 * records sends nobody made, is not something a brokerage should be able to switch on unattended —
 * even though neither verb puts anything in an inbox.
 */
export const EXTERNALLY_SENDING_VERBS: readonly string[] = ["draft", "record_send"];

/**
 * `POST /automations` — a new standing instruction.
 *
 * Defined here rather than in the route because it crosses a boundary: the builder in the browser
 * and the handler on the server must agree, and a hand-written duplicate is how they stop agreeing.
 *
 * What it deliberately does **not** carry: `sends_externally`. The server reads that from the verb
 * (`EXTERNALLY_SENDING_VERBS`), because a browser that could set it false would be a way around
 * §45 rule 13. `enabled` defaults to false: nothing starts watching a brokerage's mail because a
 * form was submitted.
 */
export const createAutomationRequestSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).default(""),
  triggerEvent: AutomationTrigger,
  conditions: z.array(automationConditionSchema).max(8).default([]),
  /** The named capability that does the work, from docs/skill-map.md. */
  skill: z.string().trim().min(1).max(80),
  preparedVerb: ActionVerb,
  approval: z.enum(["always", "never"]).default("always"),
  enabled: z.boolean().default(false),
});
export type CreateAutomationRequest = z.input<typeof createAutomationRequestSchema>;

export const automationsResponseSchema = z.object({ automations: z.array(automationSchema) });
export type AutomationsResponse = z.infer<typeof automationsResponseSchema>;

export const automationRunsResponseSchema = z.object({ runs: z.array(automationRunSchema) });
export type AutomationRunsResponse = z.infer<typeof automationRunsResponseSchema>;

export const automationResponseSchema = z.object({ automation: automationSchema });
export type AutomationResponse = z.infer<typeof automationResponseSchema>;
