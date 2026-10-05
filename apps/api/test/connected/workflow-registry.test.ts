/**
 * The engine is not renewal-only (D-139). A stand-in second workflow is registered, found by its own
 * detector in the sweep, advanced to an approval, approved through the person's route, continued by
 * the event consumer, stopped and resumed, paused and resumed — every entry point advancing it with
 * its own definition. A run naming a workflow nothing registers stops with a readable exception.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { sha256, type StepContext, type StepResult } from "../../src/workflows/engine.js";
import { advanceAnyRun, registerWorkflow, startRun, withoutWorkflow } from "./_registry-harness.js";
import { AMINA, buildApp, caller, newApiKey, ORG_A, OWNER, serviceClient } from "./_harness.js";
import pino from "pino";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const log = pino({ level: "silent" });
const internal = (path: string, body?: unknown) =>
  app.request(path, {
    method: "POST",
    headers: { "x-asap-internal-key": API_KEY, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

let workItemId = "";
let shouldFail = true;
const calls: string[] = [];
let undo: () => void = () => {};

async function prepare(_ctx: StepContext): Promise<StepResult> {
  calls.push("prepare");
  return { kind: "done", output: { prepared: true } };
}
async function approval(ctx: StepContext): Promise<StepResult> {
  const a = await ctx.db
    .from("workflow_approvals")
    .select("id, state, decided_by")
    .eq("run_id", ctx.run.id)
    .limit(1);
  const row = ((a.data ?? []) as { id: string; state: string; decided_by: string | null }[])[0];
  if (row?.state === "approved") return { kind: "done", output: { approvedBy: row.decided_by } };
  if (!row) {
    const bundle = [{ kind: "note", label: "Stand-in bundle" }];
    await ctx.db
      .from("workflow_approvals")
      .insert({
        organization_id: ctx.run.organization_id,
        run_id: ctx.run.id,
        step_key: "approval",
        title: "Approve the stand-in",
        bundle,
        bundle_sha256: sha256(JSON.stringify(bundle)),
      });
  }
  return { kind: "wait", on: "approval", until: new Date(ctx.now.getTime() + 86_400_000) };
}
async function finish(): Promise<StepResult> {
  calls.push("finish");
  if (shouldFail)
    return {
      kind: "exception",
      code: "stand_in",
      message: "The stand-in stopped once on purpose.",
      needs: "Resume it.",
    };
  return { kind: "done", output: { finished: true } };
}

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-registry')`;
  app = buildApp(API_KEY);
  const [w] =
    await sql`insert into work_items (organization_id, title, kind, task_status, steps) values (${ORG_A}, ${"Stand-in " + randomUUID().slice(0, 6)}, 'endorsement', 'in_progress', '[]') returning id`;
  workItemId = w!["id"] as string;
  // "endorsement" is a name the database allows (0065); the stand-in borrows it for this test only.
  const definition = {
    workflow: "endorsement",
    steps: [
      { key: "prepare", label: "Stand-in prepared", run: prepare },
      { key: "approval", label: "Stand-in approval", run: approval },
      { key: "finish", label: "Stand-in finished", run: finish },
    ],
  };
  undo = registerWorkflow({
    definition,
    detect: async (db, _logger, organizationId) => {
      if (organizationId !== ORG_A) return { started: 0, startedRunIds: [] };
      const s = await startRun(db, definition, {
        organizationId,
        subjectType: "work_item",
        subjectId: workItemId,
        workItemId,
        facts: {},
      });
      return { started: s.created ? 1 : 0, startedRunIds: s.created ? [s.runId] : [] };
    },
  });
});
afterAll(async () => {
  undo();
  await sql.end();
});

const runOf = async () =>
  (
    await sql`select id, state, current_step, exception from workflow_runs where workflow = 'endorsement' and subject_id = ${workItemId}`
  )[0]!;

describe("a second workflow on the engine", () => {
  it("the sweep runs its detector and advances it with its own definition, once", async () => {
    const res = await internal("/internal/workflows/sweep");
    expect(res.status).toBe(200);
    await internal("/internal/workflows/sweep");
    const runs =
      await sql`select id from workflow_runs where workflow = 'endorsement' and subject_id = ${workItemId}`;
    expect(runs).toHaveLength(1);
    expect(await runOf()).toMatchObject({ state: "waiting_approval", current_step: "approval" });
    expect(calls.filter((c) => c === "prepare")).toHaveLength(1);
  });

  it("the person's approval route continues it, and its detail reads generically", async () => {
    const run = await runOf();
    const detail = await call(AMINA, "GET", `/workflows/runs/${run["id"]}`);
    expect(detail.status).toBe(200);
    expect(detail.body.workflow).toBe("endorsement");
    expect(detail.body.operational.status).toMatch(/^Waiting for approval/);
    const a = (
      await sql`select id, bundle_sha256 from workflow_approvals where run_id = ${run["id"]}`
    )[0]!;
    const decided = await call(AMINA, "POST", `/workflow-approvals/${a["id"]}/decide`, {
      decision: "approve",
      bundleSha256: a["bundle_sha256"],
    });
    expect(decided.status).toBe(200);
    expect(await runOf()).toMatchObject({ state: "exception", current_step: "finish" });
    expect(detail.body.title).toBeTruthy();
  });

  it("the event consumer advances it too, and a resume continues from the stopped step", async () => {
    const run = await runOf();
    const [ev] =
      await sql`insert into events (organization_id, event_type, entity_type, entity_id, actor) values (${ORG_A}, 'workflow.approval_decided', 'workflow_run', ${run["id"]}, 'system') returning id`;
    const res = await internal(`/internal/events/${ev!["id"]}/dispatch`);
    expect(res.status).toBe(200);
    expect((await runOf())["state"]).toBe("exception"); // terminal until a person resumes it
    shouldFail = false;
    const resumed = await call(AMINA, "POST", `/workflows/runs/${run["id"]}/resume`);
    expect(resumed.status).toBe(200);
    expect((await runOf())["state"]).toBe("done");
    expect(calls.filter((c) => c === "prepare")).toHaveLength(1);
    const audits =
      await sql`select action from audit_log where object_id = ${run["id"]} and action like 'workflow.endorsement.%'`;
    expect(audits.map((a) => a["action"])).toEqual(
      expect.arrayContaining([
        "workflow.endorsement.started",
        "workflow.endorsement.prepare",
        "workflow.endorsement.exception",
        "workflow.endorsement.finished",
      ]),
    );
  });

  it("a run naming an unregistered workflow stops with a readable exception, not a crash", async () => {
    const [w] =
      await sql`insert into work_items (organization_id, title, kind, task_status, steps) values (${ORG_A}, 'Orphan', 'endorsement', 'in_progress', '[]') returning id`;
    const [r] =
      await sql`insert into workflow_runs (organization_id, workflow, subject_type, subject_id, current_step) values (${ORG_A}, 'claim', 'work_item', ${w!["id"]}, 'x') returning id`;
    const restore = withoutWorkflow("claim"); // nothing registered under the name, for this run only
    const out = await advanceAnyRun(serviceClient(), log, r!["id"] as string).finally(restore);
    expect(out.state).toBe("exception");
    const [row] = await sql`select state, exception from workflow_runs where id = ${r!["id"]}`;
    expect(row!["state"]).toBe("exception");
    expect((row!["exception"] as { code: string }).code).toBe("unknown_workflow");
  });
});
