import { describe, expect, it } from "vitest";
import * as S from "./engine/store.js";
import { automationsBoard, homeSurface, runRef, workInbox } from "./surfaces.js";

/*
 * The full-width surfaces (D-155) over a small in-memory brokerage: which view each Work item is
 * genuinely in, what Home calls out, and where a run opens.
 */
const ME = "u-me";
const OTHER = "u-other";
function brokerage() {
  const db = {
    meta: {}, brokerages: [{ id: "b" }], users: [{ id: ME, name: "Amina" }, { id: OTHER, name: "Brian Kamau" }], clients: [{ id: "c1", name: "Acme Motors" }],
    workItems: [
      { id: "w1", clientId: "c1", title: "Mine to do", taskStatus: "needs_you", assigneeId: ME, priority: "high", createdAt: "2026-10-01" },
      { id: "w2", clientId: "c1", title: "Brian's to do", taskStatus: "needs_you", assigneeId: OTHER, priority: "medium", createdAt: "2026-10-01" },
      { id: "w3", clientId: "c1", title: "With Jubilee", taskStatus: "with_party", parties: [{ name: "Jubilee", since: "2026-10-01" }], assigneeId: ME, nextCheckAt: "2099-01-01", createdAt: "2026-10-01" },
      { id: "w4", clientId: "c1", title: "ASAP renewing", taskStatus: "in_progress", assigneeId: ME, createdAt: "2026-10-01" },
      { id: "w5", clientId: "c1", title: "Finished", taskStatus: "done", assigneeId: ME, createdAt: "2026-10-01" },
      { id: "w6", clientId: "c1", title: "Later", taskStatus: "in_progress", assigneeId: ME, nextCheckAt: "2099-01-01", createdAt: "2026-10-01" },
    ],
    automations: [], auditEvents: [],
  };
  S.useBackend({ db, dispatch: () => ({ ok: true }) });
}
const run = (over: Record<string, unknown>) => ({ id: "r1", workflow: "renewal", workItemId: "w4", state: "running", title: "Acme renewal", client: { id: "c1", name: "Acme Motors" }, views: ["asap_handling"], operational: { currentWork: { title: "Waiting for terms" }, upcoming: [{ at: "2099-01-01T00:00:00Z", label: "Follow up" }], attention: false }, ...over });

describe("the surfaces read the brokerage, never invent it", () => {
  it("each Work item is in the view it is genuinely in", () => {
    brokerage();
    const { views } = workInbox({ supervision: { items: [run({})] }, meId: ME });
    const where = Object.fromEntries(views.flatMap((v) => v.rows.map((r) => [r.title, v.key])));
    expect(where).toEqual({ "Mine to do": "needs_me", "Brian's to do": "waiting", "With Jubilee": "waiting", "ASAP renewing": "handling", Finished: "done", Later: "upcoming" });
    const brian = views.find((v) => v.key === "waiting")!.rows.find((r) => r.title === "Brian's to do")!;
    expect(brian.statusText).toBe("With Brian Kamau");
  });
  it("a run asking for approval is what matters today, with why and one action", () => {
    brokerage();
    const h = homeSurface({ supervision: { items: [run({ state: "waiting_approval", views: ["needs_me"] })] }, meId: ME });
    expect(h.attention[0]).toMatchObject({ kind: "approval", title: "Acme renewal", action: { label: "Review", ref: { ws: "renewal", runId: "r1" } } });
    expect(h.firstUse).toBe(false);
  });
  it("a run opens its own Space: a renewal its board, any other its Work item", () => {
    expect(runRef({ id: "r1", workflow: "renewal" })).toEqual({ ws: "renewal", runId: "r1" });
    expect(runRef({ id: "r2", workflow: "claim", workItemId: "w9" })).toEqual({ ws: "workitem", workItemId: "w9" });
  });
  it("Automations groups ASAP's workflows and says what is next", () => {
    brokerage();
    const b = automationsBoard({ supervision: { items: [run({}), run({ id: "r2", state: "exception" })] } });
    expect(b.workflows[0]).toMatchObject({ name: "Renewal Autopilot", state: "Needs attention", tone: "red" });
    expect(b.workflows[0]!.lines.join(" ")).toMatch(/2 renewals in progress.*1 exception/);
  });
});
