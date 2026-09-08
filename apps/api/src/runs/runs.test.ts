/**
 * Ported from the prototype's checks.mjs (UI Build Spec v1 Part 0, Part 5.4 invariant 2, Part 8):
 * "a stopped run creates work". The original pushed a run for a record with no work item and,
 * after reconciliation, asserted the record was with the human. Here the executor ends every run
 * through `run_end`, which writes the run outcome and the work item in one transaction; this
 * suite drives the executor against an in-memory stand-in that mirrors 0023's rules, and
 * `supabase/tests/0301_work_item_engine.sql` proves the same rules on a real database.
 */
import { renewalSteps, type RunRow, type WorkItemRow } from "@asap/schema";
import type { SupabaseClient } from "@supabase/supabase-js";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { createExecutor, planRun, stepsAfterRun } from "./executor.js";

const NOW = "2026-09-08T10:00:00.000Z";
const ORG = "10000000-0000-4000-8000-00000000000a";

function item(insurers: string[], over: Partial<WorkItemRow> = {}): WorkItemRow {
  const steps = renewalSteps({ clientName: "Acme Motors", insurers }).map((s, i) => ({
    ...s,
    state: i === 0 ? ("done" as const) : i === 1 ? ("now" as const) : ("todo" as const),
  }));
  return {
    id: "30000000-0000-4000-8000-000000000010",
    organization_id: ORG,
    title: "Acme Motors — renewal",
    kind: "renewal",
    client_id: null,
    policy_period_id: null,
    insurer_id: null,
    class_of_business: null,
    owner_id: null,
    task_status: "in_progress",
    task_party: null,
    task_since: null,
    task_next_check: null,
    cover_status: "active",
    cover_inception_at: null,
    money_status: null,
    reason: null,
    steps,
    exception: null,
    version: 2,
    created_at: NOW,
    updated_at: NOW,
    completed_at: null,
    deleted_at: null,
    ...over,
  };
}

const run = (workItemId: string | null): RunRow => ({
  id: "40000000-0000-4000-8000-000000000010",
  organization_id: ORG,
  work_item_id: workItemId,
  title: "Renewal pack prepared",
  status: "working",
  next_step: null,
  started_by: null,
  boot_token: "test-boot",
  started_at: NOW,
  ended_at: null,
  created_at: NOW,
  updated_at: NOW,
});

/** In-memory stand-in for 0023's functions with the same invariants. */
function fakeDb(items: WorkItemRow[]) {
  const runs = new Map<string, RunRow>();
  const events: { run_id: string; kind: string; message: string }[] = [];
  const drafts: { work_item_id: string; to: string }[] = [];
  const db = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      switch (name) {
        case "run_event_append":
          events.push({
            run_id: args["p_run_id"] as string,
            kind: args["p_kind"] as string,
            message: args["p_message"] as string,
          });
          return { data: events.length, error: null };
        case "draft_create":
          drafts.push({
            work_item_id: args["p_work_item_id"] as string,
            to: args["p_to"] as string,
          });
          return { data: "d", error: null };
        case "run_end": {
          const r = runs.get(args["p_run_id"] as string)!;
          const status = args["p_status"] as RunRow["status"];
          const stopped = status !== "finished";
          if (stopped && args["p_task_status"] !== "needs_you")
            return { data: null, error: { code: "22023", message: "stopped_run_must_need_you" } };
          // Everything below happens in one transaction in 0023.
          r.status = status;
          r.next_step = (args["p_next_step"] as string | null) ?? null;
          r.ended_at = NOW;
          events.push({
            run_id: r.id,
            kind: status === "finished" ? "finished" : status === "paused" ? "paused" : "error",
            message: r.next_step ?? r.title,
          });
          let target = items.find((i) => i.id === r.work_item_id);
          if (!target && stopped) {
            target = item([], {
              id: "created-by-run_end",
              title: r.title,
              kind: "exception",
              steps: [],
              cover_status: null,
            });
            items.push(target);
            r.work_item_id = target.id;
          }
          if (target) {
            target.steps = args["p_steps"] as WorkItemRow["steps"];
            target.task_status = args["p_task_status"] as WorkItemRow["task_status"];
            target.task_party = (args["p_task_party"] as string | null) ?? null;
          }
          return { data: target?.id ?? null, error: null };
        }
        default:
          return { data: null, error: { code: "42883", message: `no rpc ${name}` } };
      }
    },
  };
  return { db: db as unknown as SupabaseClient, runs, events, drafts, items };
}

const execute = createExecutor({ logger: pino({ level: "silent" }), delayMs: 0 });

describe("runs — a run is never the only place something lives", () => {
  it("paused (no insurers named) leaves the work item in needs_you with the blocked step and reason, in the same call", async () => {
    const i = item([]);
    const f = fakeDb([i]);
    const r = run(i.id);
    f.runs.set(r.id, r);
    await execute(f.db)(r, i, "review");
    expect(r.status).toBe("paused");
    expect(r.next_step).toBe("Name the insurers to request terms from");
    expect(i.task_status).toBe("needs_you");
    expect(i.steps.find((s) => s.id === "review")).toMatchObject({
      state: "blocked",
      reason: "No insurers named yet.",
      runId: r.id,
    });
    expect(f.events.at(-1)).toMatchObject({ kind: "paused" });
  });

  it("could_not_finish on a run with no work item creates one in needs_you (the prototype's missing-record case)", async () => {
    const f = fakeDb([]);
    const r = run(null);
    f.runs.set(r.id, r);
    // A run whose step does not exist cannot be planned: the executor ends it as paused → the
    // stand-in creates the item, exactly as run_end does in 0023.
    await execute(f.db)(r, item([], { id: "missing-record", steps: [] }), "nope");
    const created = f.items.find((i) => i.id === "created-by-run_end");
    expect(created?.task_status).toBe("needs_you");
    expect(r.work_item_id).toBe("created-by-run_end");
  });

  it("run_end refuses to leave a stopped run's item anywhere but needs_you", async () => {
    const f = fakeDb([item([])]);
    const res = await f.db.rpc("run_end", {
      p_run_id: "x",
      p_status: "could_not_finish",
      p_task_status: "in_progress",
    });
    expect(res.error?.message).toBe("stopped_run_must_need_you");
  });

  it("finishing a run sets finished and leaves cover exactly as it was (checks.mjs line 24)", async () => {
    const i = item(["Jubilee"]);
    const f = fakeDb([i]);
    const r = run(i.id);
    f.runs.set(r.id, r);
    await execute(f.db)(r, i, "review");
    expect(r.status).toBe("finished");
    expect(i.cover_status).toBe("active");
    expect(i.steps.find((s) => s.id === "review")?.state).toBe("done");
    expect(i.steps.find((s) => s.id === "exposure")?.state).toBe("now");
    expect(i.task_status).toBe("needs_you");
    expect(f.drafts).toEqual([{ work_item_id: i.id, to: "Jubilee" }]);
    expect(f.events.map((e) => e.kind)).toEqual(["step", "step", "step", "finished"]);
  });

  it("an executor failure ends the run as could_not_finish with the item in needs_you", async () => {
    const i = item(["Jubilee"]);
    const f = fakeDb([i]);
    const r = run(i.id);
    f.runs.set(r.id, r);
    const failing = {
      rpc: async (name: string, args: Record<string, unknown>) =>
        name === "draft_create"
          ? { data: null, error: { code: "XX000", message: "boom" } }
          : f.db.rpc(name, args),
    } as unknown as SupabaseClient;
    await execute(failing)(r, i, "review");
    expect(r.status).toBe("could_not_finish");
    expect(i.task_status).toBe("needs_you");
    expect(i.steps.find((s) => s.id === "review")?.state).toBe("blocked");
  });

  it("nothing becomes unreachable with the Activity panel hidden", () => {
    // With Activity hidden, the only way to a run is through Work. Every run that is not
    // finished must therefore have a work item that needs a person.
    const i = item([]);
    const f = fakeDb([i]);
    const r = run(i.id);
    f.runs.set(r.id, r);
    const plan = planRun(i, "review");
    const after = stepsAfterRun(i, "review", plan, r.id);
    const workVisible = after.status === "needs_you" || after.status === "with_party";
    expect(plan.pause).not.toBeNull();
    expect(workVisible).toBe(true);
  });

  it("a completion message names the output, never a business outcome", () => {
    const plan = planRun(item(["Jubilee"]), "review");
    for (const m of plan.events) expect(m).not.toMatch(/\b(renewed|placed|bound|paid|approved)\b/i);
    expect(run(null).title).toBe("Renewal pack prepared");
  });
});
