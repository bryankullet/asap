/**
 * Ported from the prototype: "a stopped run creates work" (UI Build Spec v1, Part 0, Part 5.4
 * invariant 2, Part 8). A run is never the only place something lives: on `paused` or
 * `could_not_finish`, the run creates a work item in the same database transaction as the
 * status change — not in a callback, not best-effort.
 *
 * SKIPPED: the runs engine (`POST /runs`, `GET /runs/:id/stream`, the `runs` and `work_items`
 * tables) does not exist yet. It ships in UI Build Spec Phase 2. The assertions below are the
 * contract it must satisfy; un-skip them when `apps/api/src/runs` exists.
 */
import { RunStatus } from "@asap/schema";
import { describe, expect, it } from "vitest";

describe.skip("runs — a run is never the only place something lives (Phase 2: runs engine not built)", () => {
  it("paused creates a work item in the same transaction", async () => {
    // const run = await startRun({ kind: "renewal_preparation", ... });
    // await pauseRun(run.id, { reason: "insurer terms outstanding" });
    // const work = await workItemsForRun(run.id);
    // expect(work).toHaveLength(1);
    // expect(work[0].task.status).toBe("with_party");
    expect.fail("runs engine not built");
  });

  it("could_not_finish creates a work item in the same transaction", async () => {
    expect.fail("runs engine not built");
  });

  it("nothing becomes unreachable with the Activity panel disabled", async () => {
    // With the chip hidden, every paused / could_not_finish run must still be reachable through
    // Work (needs_you or with_party) because the work item exists — assert the set difference is empty.
    expect.fail("runs engine not built");
  });

  it("a completion message names the output, never a business outcome", () => {
    // Banned-phrase test over run titles (Part 8): "Policy renewed" must not appear; "Renewal pack prepared" may.
    expect(RunStatus.options).toContain("finished");
    expect.fail("run titles not produced yet");
  });
});
