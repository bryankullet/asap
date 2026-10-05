import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { emitEvent } from "../events/emit.js";
import { advanceRun, type AdvanceOutcome, type WorkflowDefinition } from "./engine.js";

/**
 * Every workflow the engine carries (D-139). The engine itself is generic; this is the one place
 * that knows which definitions exist, so the sweep, the event consumer and a person's controls all
 * advance a run with its own definition — looked up by `workflow_runs.workflow`, never assumed.
 *
 * `detect` is an optional scheduled detector, with the contract `detectRenewals` has: it starts the
 * runs a brokerage's records call for now, once each, and says which it started.
 */
export type Detector = (
  db: SupabaseClient,
  logger: Logger,
  organizationId: string,
  now: Date,
) => Promise<{ started: number; startedRunIds: string[] }>;
/** A semantic event, as the dispatcher reads it (D-140). Ids only. */
export type WorkflowEvent = { id: string; organization_id: string; event_type: string; entity_type: string | null; entity_id: string | null; payload: Record<string, unknown> | null };
/**
 * What a workflow does with an event: start the run the event starts (idempotently — one live run
 * per subject), or name the runs waiting on its subject. Returns the runs to advance now.
 */
export type EventHandler = (db: SupabaseClient, logger: Logger, event: WorkflowEvent) => Promise<string[]>;
export type RegisteredWorkflow = { definition: WorkflowDefinition; detect?: Detector; on?: Partial<Record<string, EventHandler>> };

const registry = new Map<string, RegisteredWorkflow>();

/** Adds or replaces a workflow. Definitions register themselves at import (workflows/index.ts). */
export function registerWorkflow(entry: RegisteredWorkflow): () => void {
  const before = registry.get(entry.definition.workflow);
  registry.set(entry.definition.workflow, entry);
  // The undo, for tests that register a stand-in for a moment.
  return () => {
    if (before) registry.set(entry.definition.workflow, before);
    else registry.delete(entry.definition.workflow);
  };
}

export const workflowNamed = (name: string): RegisteredWorkflow | undefined => registry.get(name);
export const registeredWorkflows = (): RegisteredWorkflow[] => [...registry.values()];

/**
 * Advances a run with its own definition. A run naming a workflow nothing registers is not a crash:
 * the run is stopped with an exception a person can read, and the outcome says so.
 */
export async function advanceAnyRun(
  db: SupabaseClient,
  logger: Logger,
  runId: string,
  now = new Date(),
): Promise<AdvanceOutcome> {
  const r = await db
    .from("workflow_runs")
    .select("id, organization_id, workflow, state, current_step")
    .eq("id", runId)
    .maybeSingle();
  const run = r.data as {
    id: string;
    organization_id: string;
    workflow: string;
    state: string;
    current_step: string | null;
  } | null;
  if (!run) return { runId, state: "missing", stepsDone: [], stoppedAt: null, skipped: "terminal" };
  const entry = registry.get(run.workflow);
  if (entry) return advanceRun(db, logger, entry.definition, runId, now);
  if (["done", "cancelled", "exception"].includes(run.state))
    return {
      runId,
      state: run.state,
      stepsDone: [],
      stoppedAt: run.current_step,
      skipped: "terminal",
    };
  const at = new Date().toISOString();
  const exception = {
    code: "unknown_workflow",
    message: `This run is a "${run.workflow}" workflow, which this version of ASAP does not carry.`,
    needs:
      "Tell your administrator: the run is kept as it was and can be resumed once its workflow is available.",
    step: run.current_step,
    at,
  };
  await db
    .from("workflow_runs")
    .update({ state: "exception", exception, lease_until: null, updated_at: at })
    .eq("id", run.id)
    .not("state", "in", "(done,cancelled,exception)");
  await db
    .from("audit_log")
    .insert({
      organization_id: run.organization_id,
      actor_type: "automation",
      action: "workflow.unknown_workflow",
      object_type: "workflow_run",
      object_id: run.id,
      new_state: { workflow: run.workflow },
      result: "failure",
      failure_reason: "unknown_workflow",
    });
  logger.error({ runId, workflow: run.workflow }, "a run names a workflow that is not registered");
  return { runId, state: "exception", stepsDone: [], stoppedAt: run.current_step };
}

/**
 * The scheduled pass (D-129, D-139): every registered detector in every brokerage, then every due
 * run with its own definition. A run found in this pass is advanced in this pass (D-137).
 */
export async function sweepWorkflows(db: SupabaseClient, logger: Logger, now = new Date()) {
  const orgs = await db.from("organizations").select("id");
  let started = 0;
  const fresh: string[] = [];
  for (const o of (orgs.data ?? []) as { id: string }[]) {
    for (const entry of registry.values()) {
      if (!entry.detect) continue;
      try {
        const d = await entry.detect(db, logger, o.id, now);
        started += d.started;
        fresh.push(...d.startedRunIds);
      } catch (e) {
        logger.error(
          { organizationId: o.id, workflow: entry.definition.workflow, err: (e as Error).message },
          "a workflow detector failed; the next sweep tries again",
        );
      }
    }
  }
  const overdue = await emitOverdueChecks(db, now);
  const due = await db
    .from("workflow_runs")
    .select("id")
    .in("state", ["running", "waiting_approval", "waiting_party"])
    .lte("next_run_at", now.toISOString())
    .order("next_run_at")
    .limit(200);
  const outcomes: AdvanceOutcome[] = [];
  const ids = [...new Set([...fresh, ...((due.data ?? []) as { id: string }[]).map((r) => r.id)])];
  for (const id of ids) {
    try {
      outcomes.push(await advanceAnyRun(db, logger, id, now));
    } catch (e) {
      logger.error(
        { runId: id, err: (e as Error).message },
        "a workflow run could not be advanced; the next sweep tries again",
      );
    }
  }
  return { started, advanced: outcomes.length, outcomes, overdue };
}

/**
 * Work whose next check has passed (D-140): one `check.overdue` per item and due date, however many
 * sweeps see it. Done work is never overdue.
 */
export async function emitOverdueChecks(db: SupabaseClient, now = new Date()): Promise<number> {
  const q = await db.from("work_items").select("id, organization_id, task_next_check, kind").lt("task_next_check", now.toISOString()).neq("task_status", "done").is("deleted_at", null).limit(500);
  let emitted = 0;
  for (const w of (q.data ?? []) as { id: string; organization_id: string; task_next_check: string; kind: string }[]) {
    const r = await emitEvent(db, null, {
      organizationId: w.organization_id,
      eventType: "check.overdue",
      entityType: "work_item",
      entityId: w.id,
      actor: "system",
      actorUserId: null,
      payload: { workItemId: w.id, dueAt: w.task_next_check, kind: w.kind },
      dedupeKey: `${w.id}:${w.task_next_check}`,
    });
    if (r === "emitted") emitted += 1;
  }
  return emitted;
}


/** Live runs of a workflow on one subject — what an event about that subject wakes. */
export async function liveRunsOn(db: SupabaseClient, organizationId: string, workflow: string, subjectId: string): Promise<string[]> {
  const q = await db.from("workflow_runs").select("id").eq("organization_id", organizationId).eq("workflow", workflow).eq("subject_id", subjectId).not("state", "in", "(done,cancelled)");
  return ((q.data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * The dispatcher's workflow consumer (D-140): every registered workflow that listens for this event
 * starts or wakes its runs, and each run is advanced with its own definition. Idempotent: starting
 * finds the live run, advancing a run already advanced does nothing more.
 */
export async function routeEventToWorkflows(db: SupabaseClient, logger: Logger, event: WorkflowEvent): Promise<{ consumer: string; result: "success" | "failure" | "skipped"; detail: string }[]> {
  const out: { consumer: string; result: "success" | "failure" | "skipped"; detail: string }[] = [];
  for (const entry of registry.values()) {
    const handler = entry.on?.[event.event_type];
    if (!handler) continue;
    const consumer = `workflow.${entry.definition.workflow}`;
    try {
      const runIds = [...new Set(await handler(db, logger, event))];
      const states: string[] = [];
      for (const id of runIds) {
        const o = await advanceAnyRun(db, logger, id);
        states.push(o.skipped ? `run ${o.skipped}` : `run ${o.state}${o.stoppedAt ? ` at ${o.stoppedAt}` : ""}`);
      }
      out.push({ consumer, result: runIds.length ? "success" : "skipped", detail: runIds.length ? states.join("; ") : "No run starts or waits on this." });
    } catch (e) {
      out.push({ consumer, result: "failure", detail: (e as Error).message ?? "the workflow could not react" });
    }
  }
  return out;
}