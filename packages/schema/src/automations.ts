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

/**
 * What an automation can actually do today (D-125) — the one list the builder, Ask and the server
 * validator read. A trigger is `executable` only when our own code emits that event against a
 * piece of work; the rest exist in the vocabulary but nothing fires them yet, so saving one would
 * be a standing instruction that never runs. The browser never decides this.
 */
export const AUTOMATION_REGISTRY = {
  triggers: [
    { event: "document.received", label: "A document arrives on a piece of work", executable: true, why: "Emitted when a document is uploaded or synced and filed against work." },
    { event: "quote.received", label: "An insurer's quote is recorded", executable: true, why: "Emitted when an insurer's answer is recorded on quotation work (D-140)." },
    { event: "renewal.approaching", label: "A renewal is approaching", executable: false, why: "Nothing emits this event yet." },
    { event: "payment.received", label: "A payment is received", executable: false, why: "Nothing emits this event yet." },
    { event: "cover.confirmed", label: "Cover is confirmed", executable: true, why: "Emitted when the insurer's confirmation passes the cover check (D-140)." },
    { event: "claim.registered", label: "A claim is registered", executable: true, why: "Emitted when the insurer's claim reference is recorded (D-140)." },
    { event: "check.overdue", label: "A check is overdue", executable: true, why: "Emitted by the scheduled pass, once per item and due date (D-140)." },
    { event: "run.could_not_finish", label: "An ASAP run could not finish", executable: true, why: "Emitted when a workflow run stops with an exception (D-140)." },
  ],
  facts: [
    { fact: "kind", label: "Kind of work", operators: ["equals", "not_equals", "is_one_of"], value: "text" },
    { fact: "task_status", label: "Work status", operators: ["equals", "not_equals", "is_one_of"], value: "text" },
    { fact: "class_of_business", label: "Class of business", operators: ["equals", "not_equals", "is_one_of", "is_empty", "is_not_empty"], value: "text" },
    { fact: "insurer_name", label: "Insurer", operators: ["equals", "not_equals", "is_one_of", "is_empty", "is_not_empty"], value: "text" },
    { fact: "client_file_status", label: "Client file status", operators: ["equals", "not_equals", "is_one_of"], value: "text" },
    { fact: "cover_status", label: "Cover status", operators: ["equals", "not_equals", "is_one_of", "is_empty", "is_not_empty"], value: "text" },
    { fact: "money_status", label: "Money status", operators: ["equals", "not_equals", "is_one_of", "is_empty", "is_not_empty"], value: "text" },
    { fact: "period_end", label: "Cover ends", operators: ["days_until_less_than"], value: "days" },
    { fact: "last_touched", label: "Last touched", operators: ["days_since_more_than"], value: "days" },
    { fact: "exception", label: "Exception recorded", operators: ["is_empty", "is_not_empty"], value: "none" },
  ],
  actions: [
    { verb: "prepare", skill: "work.prepare", label: "Prepare the current step for review", sendsExternally: false, approvalRequired: false, why: "Starts ASAP's preparation of the step; a person reviews what it prepared." },
    { verb: "draft", skill: "message.draft", label: "Draft a message for a person to send", sendsExternally: true, approvalRequired: true, why: "Opens a draft only; a person sends it. Always needs approval." },
  ],
} as const satisfies {
  triggers: readonly { event: z.infer<typeof AutomationTrigger>; label: string; executable: boolean; why: string }[];
  facts: readonly { fact: AutomationCondition["fact"]; label: string; operators: readonly z.infer<typeof AutomationConditionOperator>[]; value: "text" | "days" | "none" }[];
  actions: readonly { verb: z.infer<typeof ActionVerb>; skill: string; label: string; sendsExternally: boolean; approvalRequired: boolean; why: string }[];
};

/**
 * Why a proposed automation cannot be saved as executable, in plain words. Empty means every part
 * is in the registry. The server refuses a create that fails this; Ask uses it before offering Save.
 */
export function automationProblems(p: { triggerEvent: string; conditions: { fact: string; operator: string; value?: unknown }[]; preparedVerb: string; approval: string }): string[] {
  const out: string[] = [];
  const trig = AUTOMATION_REGISTRY.triggers.find((t) => t.event === p.triggerEvent);
  if (!trig) out.push("its trigger is not one ASAP knows");
  else if (!trig.executable) out.push(`“${trig.label}” does not fire yet — ${trig.why.toLowerCase()}`);
  for (const c of p.conditions) {
    const f = AUTOMATION_REGISTRY.facts.find((x) => x.fact === c.fact);
    if (!f) out.push(`the condition on “${c.fact}” is not one ASAP can check`);
    else if (!(f.operators as readonly string[]).includes(c.operator)) out.push(`“${f.label}” cannot be checked with “${c.operator.replace(/_/g, " ")}”`);
    else if (f.value === "days" && !(typeof c.value === "number" && c.value > 0)) out.push(`“${f.label}” needs a number of days`);
    else if (f.value === "text" && !["is_empty", "is_not_empty"].includes(c.operator) && (c.value === null || c.value === undefined || c.value === "" || (Array.isArray(c.value) && c.value.length === 0)))
      out.push(`“${f.label}” needs a value`);
  }
  const act = AUTOMATION_REGISTRY.actions.find((a) => a.verb === p.preparedVerb);
  if (!act) out.push("its action is not one an automation may take");
  else if (act.approvalRequired && p.approval !== "always") out.push(`“${act.label}” always needs a person's approval`);
  return out;
}

/** `POST /automations/:id/test` — conditions checked against open work, nothing written or prepared. */
export const automationTestResponseSchema = z.object({
  testedAt: z.string(),
  checked: z.number().int().min(0),
  wouldFire: z.array(z.object({ workItemId: uuidSchema, title: z.string() })),
  wouldNotFire: z.array(z.object({ workItemId: uuidSchema, title: z.string(), failed: z.array(conditionResultSchema) })),
  problems: z.array(z.string()),
});
export type AutomationTestResponse = z.infer<typeof automationTestResponseSchema>;
