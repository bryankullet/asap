/**
 * Ported from the prototype's checks.mjs (UI Build Spec v1 Part 0, Part 5.4 invariant 2, Part 8):
 * "a stopped run creates work". The original pushed a run `{status:'stopped', title:'Failed
 * extraction', record:'missing-record'}` for a record with no work item, ran
 * reconcileRunOutcomes, and asserted the record was now with the human (`human === 'you'`).
 * In v3 vocabulary: a run that ends `paused` or `could_not_finish` creates a work item with
 * task status `needs_you`, in the same database transaction as the status change.
 *
 * SKIPPED: the runs engine (`POST /runs`, `GET /runs/:id/stream`, in-transaction work item
 * creation) is UI Build Spec Phase 2. Un-skip when `apps/api/src/runs` has an engine.
 */
import { RunStatus } from "@asap/schema";
import { describe, expect, it } from "vitest";

describe.skip("runs — a run is never the only place something lives (Phase 2: runs engine not built)", () => {
  it("could_not_finish on a record with no work item creates one in needs_you, in the same transaction", async () => {
    // const run = await startRun({ title: "Extraction", recordId: "missing-record" });
    // await endRun(run.id, "could_not_finish", { next: "Check this file" });
    // const work = await workItemsForRecord("missing-record");
    // expect(work).toHaveLength(1);
    // expect(work[0].task.status).toBe("needs_you");
    expect.fail("runs engine not built");
  });

  it("paused creates or updates a work item in the same transaction", async () => {
    expect.fail("runs engine not built");
  });

  it("finishing a run sets finished and never changes cover (checks.mjs line 24, cover part NOT adopted)", async () => {
    // The prototype also asserted the record's cover became "Active cover" when the terms run
    // finished. That contradicts the contract ("never infer cover from a run result"), so only the
    // status assertion is kept: finishRun("run-terms") → status "finished".
    expect(RunStatus.options).toContain("finished");
    expect.fail("runs engine not built");
  });

  it("nothing becomes unreachable with the Activity panel hidden", async () => {
    // Every paused / could_not_finish run must be reachable through Work because its work item exists.
    expect.fail("runs engine not built");
  });

  it("a completion message names the output, never a business outcome", () => {
    // Banned-phrase test over run titles (Part 8): "Policy renewed" must not appear; "Renewal pack prepared" may.
    expect.fail("run titles not produced yet");
  });
});
