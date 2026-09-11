import {
  AUTOMATION_COLUMNS,
  EXTERNALLY_SENDING_VERBS,
  WORK_ITEM_COLUMNS,
  WorkItemRow,
  automationSchema,
  type Automation,
} from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { evaluateConditions } from "./engine.js";

/**
 * Firing automations for one semantic event.
 *
 * Three guarantees, in the order they are enforced:
 *
 *  1. **Idempotent.** The run row is claimed on `(automation_id, event_id)` before anything else.
 *     A consumer that sees the same event twice — a duplicated webhook, a retried job, a worker
 *     restart — finds the row taken and does nothing further. This is why the event carries an id.
 *  2. **Every firing is recorded, including the ones that did nothing.** An automation whose
 *     conditions did not hold writes `conditions_not_met` with each condition's result, so
 *     "why did nothing happen?" has an answer. A silent automation is worse than none.
 *  3. **It prepares; a person decides.** The run records the verb and the step it would act on,
 *     and stops at `needs_approval` unless the automation is configured otherwise and does not
 *     touch anything leaving the brokerage. Applying the action goes through the engine, with its
 *     guards, under a person's approval — never from here.
 */

export type SemanticEvent = {
  /** Stable per occurrence. Two deliveries of the same happening carry the same id. */
  id: string;
  name: string;
  organizationId: string;
  workItemId: string;
};

export type FiringSummary = {
  automationId: string;
  runId: string | null;
  outcome: string;
  /** Set when this event had already been handled for this automation. */
  duplicate?: boolean;
};

export async function fireAutomationsFor(
  db: SupabaseClient,
  logger: Logger,
  event: SemanticEvent,
  now = Date.now(),
): Promise<FiringSummary[]> {
  const { data: rows, error } = await db
    .from("automations")
    .select(AUTOMATION_COLUMNS)
    .eq("organization_id", event.organizationId)
    .eq("trigger_event", event.name)
    .eq("enabled", true)
    .is("deleted_at", null);
  if (error) {
    // A failure to read the automations is loud: it means none of them ran, which nobody would
    // otherwise notice.
    logger.error({ event: event.name }, "could not load automations for an event");
    throw error;
  }
  const automations = automationSchema.array().parse(rows ?? []);
  if (automations.length === 0) return [];

  const { data: itemRow, error: itemErr } = await db
    .from("work_items")
    .select(WORK_ITEM_COLUMNS)
    .eq("organization_id", event.organizationId)
    .eq("id", event.workItemId)
    .is("deleted_at", null)
    .maybeSingle();
  if (itemErr) throw itemErr;
  if (!itemRow) {
    logger.warn({ event: event.name }, "an event named a record that is not available");
    return [];
  }
  const item = WorkItemRow.parse(itemRow);

  const summaries: FiringSummary[] = [];
  for (const automation of automations) {
    summaries.push(await fireOne(db, logger, automation, event, item, now));
  }
  return summaries;
}

async function fireOne(
  db: SupabaseClient,
  logger: Logger,
  automation: Automation,
  event: SemanticEvent,
  item: WorkItemRow,
  now: number,
): Promise<FiringSummary> {
  // Claim first. Everything below is safe to do exactly once, and this is what makes it once.
  const { data: claimed, error: claimErr } = await db
    .from("automation_runs")
    .insert({
      organization_id: event.organizationId,
      automation_id: automation.id,
      event_id: event.id,
      event_name: event.name,
      work_item_id: event.workItemId,
      outcome: "working",
    })
    .select("id")
    .single();
  if (claimErr) {
    logger.info({ automationId: automation.id }, "automation already ran for this event");
    return { automationId: automation.id, runId: null, outcome: "duplicate", duplicate: true };
  }
  const runId = (claimed as { id: string }).id;

  const { held, results } = evaluateConditions(automation.conditions, item, {}, now);
  const finishedAt = new Date(now).toISOString();

  if (!held) {
    await db
      .from("automation_runs")
      .update({ outcome: "conditions_not_met", condition_results: results, finished_at: finishedAt })
      .eq("id", runId);
    return { automationId: automation.id, runId, outcome: "conditions_not_met" };
  }

  // The step the verb would act on: the one waiting now. An automation cannot reach a step that
  // is not the record's own next one, which is the same rule a person's action follows.
  const step = item.steps.find((s) => s.state === "now" || s.state === "blocked");
  if (!step) {
    await db
      .from("automation_runs")
      .update({
        outcome: "could_not_finish",
        condition_results: results,
        reason: "There is no step waiting on this record, so there was nothing to prepare.",
        finished_at: finishedAt,
      })
      .eq("id", runId);
    return { automationId: automation.id, runId, outcome: "could_not_finish" };
  }

  // Does the record's own step allow this verb, and is it available right now? Either answer of
  // no is an exception for a person, not something to force: the guards are the record's, and an
  // automation does not get to override what a person at the same step could not do.
  const action = step.actions.find((a) => a.verb === automation.prepared_verb);
  const blocked = action
    ? action.disabledReason
    : `This record's next step does not allow ${automation.prepared_verb}.`;
  if (blocked) {
    await db
      .from("automation_runs")
      .update({
        outcome: "exception",
        condition_results: results,
        // The record's own reason, passed through. Restating it in the automation's words would
        // let the two drift, and the record's is the one a person can act on.
        reason: `${blocked} Nothing was prepared.`,
        finished_at: finishedAt,
      })
      .eq("id", runId);
    return { automationId: automation.id, runId, outcome: "exception" };
  }

  // Prepared, and stopping. `needs_approval` whenever a person must decide — always, for anything
  // that reaches outside the brokerage, whatever the automation says.
  const mustBeApproved =
    automation.approval === "always" || EXTERNALLY_SENDING_VERBS.includes(automation.prepared_verb);
  const outcome = mustBeApproved ? "needs_approval" : "prepared";

  await db
    .from("automation_runs")
    .update({
      outcome,
      condition_results: results,
      prepared_action: { verb: automation.prepared_verb, stepId: step.id },
      finished_at: finishedAt,
    })
    .eq("id", runId);

  return { automationId: automation.id, runId, outcome };
}
