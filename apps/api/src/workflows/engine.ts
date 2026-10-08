import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "pino";
import { emitEvent } from "../events/emit.js";

/**
 * The execution foundation (D-129): one durable, resumable run of multi-step work.
 *
 * A run's steps are rows. `advanceRun` takes a lease on the run, walks its steps in order, runs
 * each one that is not done, and stops at the first that must wait — for a person's approval, an
 * outside party, or a retry. Every state change is written before the next step starts, so a
 * process that stops mid-run resumes where it was: the lease expires, the next sweep or event takes
 * it, and the steps already done are not done again.
 *
 * It is deliberately small. It is proved by one workflow (renewal) and grows only when a second
 * workflow needs something it does not do.
 */

export type Evidence = { label: string; kind: "record" | "document" | "rule" | "approval" | "communication" | "response"; ref?: string | null };

export type StepResult =
  | { kind: "done"; output?: Record<string, unknown>; evidence?: Evidence[] }
  /** Waits for a person or a party; looked at again at `until`. */
  | { kind: "wait"; on: "approval" | "party"; until: Date; output?: Record<string, unknown>; evidence?: Evidence[] }
  /** A transient failure: tried again with back-off, up to the step's limit. */
  | { kind: "retry"; error: string }
  /** Cannot continue without a person: what stopped it, what is needed, and who can supply it. */
  | { kind: "exception"; code: string; message: string; needs: string; output?: Record<string, unknown> };

export type RunRow = {
  id: string;
  organization_id: string;
  workflow: string;
  subject_type: string;
  subject_id: string;
  work_item_id: string | null;
  state: string;
  current_step: string | null;
  exception: Record<string, unknown> | null;
  facts: Record<string, unknown>;
  next_run_at: string;
};
export type StepRow = {
  id: string;
  step_key: string;
  position: number;
  label: string;
  state: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string | null;
  output: Record<string, unknown>;
  evidence: Evidence[];
};

export type StepContext = {
  db: SupabaseClient;
  logger: Logger;
  run: RunRow;
  /** Outputs of the steps already done, by key. */
  done: Record<string, Record<string, unknown>>;
  step: StepRow;
  now: Date;
};

export type StepDefinition = { key: string; label: string; maxAttempts?: number; run: (ctx: StepContext) => Promise<StepResult> };
export type WorkflowDefinition = { workflow: string; steps: StepDefinition[] };

const LEASE_MS = 120_000;
const STEP_COLUMNS = "id, step_key, position, label, state, attempts, max_attempts, next_attempt_at, output, evidence";

export const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/** An audit row for what ASAP did on its own. Never document contents or credentials (CLAUDE.md). */
export async function auditAutomation(
  db: SupabaseClient,
  run: Pick<RunRow, "organization_id" | "id">,
  action: string,
  newState: Record<string, unknown>,
  evidence: Evidence[] = [],
  result: "success" | "failure" = "success",
  failure: string | null = null,
) {
  await db.from("audit_log").insert({
    organization_id: run.organization_id,
    actor_type: "automation",
    action,
    object_type: "workflow_run",
    object_id: run.id,
    new_state: newState,
    evidence,
    result,
    failure_reason: failure,
  });
}

/**
 * Creates a run and its steps, once. A second call for the same live subject returns the first.
 * With `once`, a subject that already finished its run is not started again: a replayed start
 * event must not walk a placement through a second time (D-142). A cancelled run may restart.
 */
export async function startRun(
  db: SupabaseClient,
  def: WorkflowDefinition,
  input: { organizationId: string; subjectType: string; subjectId: string; workItemId: string | null; facts: Record<string, unknown>; once?: boolean },
): Promise<{ runId: string; created: boolean }> {
  const existing = await db
    .from("workflow_runs")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("workflow", def.workflow)
    .eq("subject_id", input.subjectId)
    .not("state", "in", input.once ? "(cancelled)" : "(done,cancelled)")
    .order("started_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing.data) return { runId: (existing.data as { id: string }).id, created: false };
  const ins = await db
    .from("workflow_runs")
    .insert({
      organization_id: input.organizationId,
      workflow: def.workflow,
      subject_type: input.subjectType,
      subject_id: input.subjectId,
      work_item_id: input.workItemId,
      facts: input.facts,
      current_step: def.steps[0]!.key,
    })
    .select("id")
    .maybeSingle();
  if (ins.error || !ins.data) {
    // Another sweep won the race: the unique index refused this one. Read what it made.
    const again = await db
      .from("workflow_runs")
      .select("id")
      .eq("organization_id", input.organizationId)
      .eq("workflow", def.workflow)
      .eq("subject_id", input.subjectId)
      .not("state", "in", "(done,cancelled)")
      .maybeSingle();
    if (again.data) return { runId: (again.data as { id: string }).id, created: false };
    throw new Error(`workflow run could not be started: ${ins.error?.message ?? "no row"}`);
  }
  const runId = (ins.data as { id: string }).id;
  const steps = def.steps.map((s, i) => ({
    organization_id: input.organizationId,
    run_id: runId,
    step_key: s.key,
    position: i + 1,
    label: s.label,
    max_attempts: s.maxAttempts ?? 3,
  }));
  const st = await db.from("workflow_steps").insert(steps);
  if (st.error) throw new Error(`workflow steps could not be written: ${st.error.message}`);
  await auditAutomation(db, { organization_id: input.organizationId, id: runId }, `workflow.${def.workflow}.started`, {
    subject: `${input.subjectType}:${input.subjectId}`,
    steps: def.steps.map((s) => s.key),
  });
  return { runId, created: true };
}

export type AdvanceOutcome = { runId: string; state: string; stepsDone: string[]; stoppedAt: string | null; skipped?: "leased" | "terminal" | "not_due" | "paused" };

/**
 * Advances one run as far as it can go now. Safe to call from a sweep, an event and a person's
 * action at once: only the holder of the lease acts, and a done step is never run again.
 */
export async function advanceRun(
  db: SupabaseClient,
  logger: Logger,
  def: WorkflowDefinition,
  runId: string,
  now = new Date(),
): Promise<AdvanceOutcome> {
  const leaseUntil = new Date(now.getTime() + LEASE_MS).toISOString();
  const claimed = await db.rpc("workflow_run_claim", { p_run_id: runId, p_now: now.toISOString(), p_until: leaseUntil }).maybeSingle();
  if (!claimed.data) {
    const cur = await db.from("workflow_runs").select("state").eq("id", runId).maybeSingle();
    const state = (cur.data as { state: string } | null)?.state ?? "missing";
    return { runId, state, stepsDone: [], stoppedAt: null, skipped: ["done", "cancelled", "exception"].includes(state) ? "terminal" : "leased" };
  }
  const run = claimed.data as RunRow;
  const stepsDone: string[] = [];
  // A person paused it: hold the lease only long enough to say so, and keep its place (D-131).
  if ((run.facts as { paused?: { at?: string } } | null)?.paused) {
    await db.from("workflow_runs").update({ lease_until: null }).eq("id", run.id);
    return { runId: run.id, state: run.state, stepsDone, stoppedAt: run.current_step, skipped: "paused" };
  }
  const release = async (patch: Record<string, unknown>) => {
    await db.from("workflow_runs").update({ ...patch, lease_until: null, updated_at: new Date().toISOString() }).eq("id", run.id);
  };

  try {
    const loaded = await db.from("workflow_steps").select(STEP_COLUMNS).eq("run_id", run.id).order("position");
    const rows = (loaded.data ?? []) as StepRow[];
    const done: Record<string, Record<string, unknown>> = {};
    for (const r of rows) if (r.state === "done" || r.state === "skipped") done[r.step_key] = r.output;

    for (const def0 of def.steps) {
      const row = rows.find((r) => r.step_key === def0.key);
      if (!row) throw new Error(`step ${def0.key} is missing from run ${run.id}`);
      if (row.state === "done" || row.state === "skipped") continue;
      if (row.next_attempt_at && new Date(row.next_attempt_at) > now && row.state !== "waiting") {
        await release({ current_step: row.step_key, next_run_at: row.next_attempt_at });
        return { runId: run.id, state: run.state, stepsDone, stoppedAt: row.step_key, skipped: "not_due" };
      }
      await db.from("workflow_steps").update({ state: "running", started_at: row.state === "pending" ? now.toISOString() : undefined, updated_at: now.toISOString() }).eq("id", row.id);

      let result: StepResult;
      try {
        result = await def0.run({ db, logger, run, done, step: row, now });
      } catch (e) {
        result = { kind: "retry", error: (e as Error).message ?? String(e) };
      }

      if (result.kind === "done") {
        await db
          .from("workflow_steps")
          .update({ state: "done", finished_at: now.toISOString(), output: result.output ?? {}, evidence: result.evidence ?? [], error: null, next_attempt_at: null, updated_at: now.toISOString() })
          .eq("id", row.id);
        done[row.step_key] = result.output ?? {};
        stepsDone.push(row.step_key);
        await auditAutomation(db, run, `workflow.${def.workflow}.${row.step_key}`, { step: row.label, ...summarise(result.output) }, result.evidence ?? []);
        continue;
      }
      if (result.kind === "wait") {
        await db
          .from("workflow_steps")
          .update({ state: "waiting", output: { ...row.output, ...(result.output ?? {}) }, evidence: result.evidence ?? row.evidence, next_attempt_at: result.until.toISOString(), updated_at: now.toISOString() })
          .eq("id", row.id);
        const state = result.on === "approval" ? "waiting_approval" : "waiting_party";
        await release({ state, current_step: row.step_key, next_run_at: result.until.toISOString() });
        return { runId: run.id, state, stepsDone, stoppedAt: row.step_key };
      }
      if (result.kind === "retry") {
        const attempts = row.attempts + 1;
        if (attempts >= row.max_attempts) {
          return await except(db, run, row, release, stepsDone, {
            code: "step_failed",
            message: `${row.label} could not be completed after ${attempts} attempts.`,
            needs: "Look at the reason below and fix the record, then resume the renewal.",
            detail: result.error.slice(0, 300),
          });
        }
        const backoff = new Date(now.getTime() + 60_000 * 2 ** attempts);
        await db.from("workflow_steps").update({ state: "pending", attempts, error: result.error.slice(0, 500), next_attempt_at: backoff.toISOString(), updated_at: now.toISOString() }).eq("id", row.id);
        await release({ state: "running", current_step: row.step_key, next_run_at: backoff.toISOString() });
        logger.warn({ runId: run.id, step: row.step_key, attempts }, "workflow step will be retried");
        return { runId: run.id, state: "running", stepsDone, stoppedAt: row.step_key };
      }
      return await except(db, run, row, release, stepsDone, { code: result.code, message: result.message, needs: result.needs }, result.output);
    }

    const finished = new Date().toISOString();
    await release({ state: "done", current_step: null, finished_at: finished, next_run_at: finished });
    await auditAutomation(db, run, `workflow.${def.workflow}.finished`, { steps: rows.length });
    return { runId: run.id, state: "done", stepsDone, stoppedAt: null };
  } catch (e) {
    // Never leave a lease held by a failure: the next sweep must be able to try again.
    await release({});
    throw e;
  }
}

async function except(
  db: SupabaseClient,
  run: RunRow,
  row: StepRow,
  release: (p: Record<string, unknown>) => Promise<void>,
  stepsDone: string[],
  exception: { code: string; message: string; needs: string; detail?: string },
  output?: Record<string, unknown>,
): Promise<AdvanceOutcome> {
  const at = new Date().toISOString();
  await db.from("workflow_steps").update({ state: "failed", error: exception.detail ?? exception.message, output: { ...row.output, ...(output ?? {}) }, updated_at: at }).eq("id", row.id);
  await release({ state: "exception", current_step: row.step_key, exception: { ...exception, step: row.step_key, stepLabel: row.label, at } });
  if (run.work_item_id) {
    const w = await db.from("work_items").select("version").eq("id", run.work_item_id).maybeSingle();
    const version = (w.data as { version: number } | null)?.version ?? 1;
    await db
      .from("work_items")
      .update({ task_status: "needs_you", task_party: null, task_since: at, required_action: exception.needs, reason: exception.message, version: version + 1, updated_at: at })
      .eq("id", run.work_item_id);
  }
  await auditAutomation(db, run, `workflow.${run.workflow}.exception`, { step: row.step_key, code: exception.code, message: exception.message, needs: exception.needs }, [], "failure", exception.code);
  // The run could not finish (D-140): the exception helper looks into why, an automation may react.
  await emitEvent(db, null, {
    organizationId: run.organization_id,
    eventType: "run.could_not_finish",
    entityType: "workflow_run",
    entityId: run.id,
    actor: "automation",
    actorUserId: null,
    payload: { runId: run.id, workflow: run.workflow, step: row.step_key, code: exception.code, workItemId: run.work_item_id },
    dedupeKey: `${run.id}:${at}`,
  });
  return { runId: run.id, state: "exception", stepsDone, stoppedAt: row.step_key };
}

/** Small, safe projection of a step output for the audit row: counts and labels, not contents. */
function summarise(output?: Record<string, unknown>): Record<string, unknown> {
  if (!output) return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(output)) {
    if (typeof v === "string" && v.length <= 120) out[k] = v;
    else if (typeof v === "number" || typeof v === "boolean" || v === null) out[k] = v;
    else if (Array.isArray(v)) out[k] = v.length;
  }
  return out;
}
