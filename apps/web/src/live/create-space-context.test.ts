import { describe, expect, it } from "vitest";
import { createSpace } from "./create-space.js";

/**
 * Preselection in the creation forms (4C-1): the client, policy and period come only from what the
 * server said this person can see; the person still gives every fact; a refused context falls back
 * to asking which client.
 */
const CONTEXT = {
  client: { id: "20000000-0000-4000-8000-000000000001", name: "Placeholder Company" },
  policy: { id: "4a000000-0000-4000-8000-0000000000c1", label: "Commercial motor with Placeholder Insurer (PH/MTR/0001)", insurerName: "Placeholder Insurer", policyNumber: "PH/MTR/0001" },
  period: { id: "4b000000-0000-4000-8000-0000000000c1", start: "2025-10-01", end: "2026-09-30" },
};
const idle = { busy: false, error: null, outcome: null };
type Block = ReturnType<typeof createSpace>["blocks"][number];
const form = (blocks: Block[]) => blocks.find((b) => b.id === "form") as Extract<Block, { type: "form" }>;

describe("creation forms opened from a policy", () => {
  it("a claim shows the client, policy and period, and still asks what happened and when", () => {
    const f = createSpace("claim", { ...idle, context: CONTEXT });
    expect(f.blocks[0]).toMatchObject({ id: "context", type: "facts" });
    const facts = (f.blocks[0] as Extract<Block, { type: "facts" }>).facts.map((x) => [x.key, x.value]);
    expect(facts).toEqual([["Client", "Placeholder Company"], ["Policy", CONTEXT.policy.label], ["Period", "2025-10-01 to 2026-09-30"]]);
    const fields = form(f.blocks).fields.map((x) => [x.name, x.required]);
    expect(fields).toEqual([["incidentOn", true], ["incidentSummary", true]]);
  });

  it("an endorsement keeps its required request", () => {
    expect(form(createSpace("endorsement", { ...idle, context: CONTEXT }).blocks).fields.find((x) => x.name === "requestText")!.required).toBe(true);
  });

  it("a refused context preselects nothing and asks which client", () => {
    const f = createSpace("claim", { ...idle, context: null, contextRefused: true });
    expect(f.blocks[0]).toMatchObject({ id: "context-refused", title: "Nothing was preselected" });
    expect(form(f.blocks).fields[0]!.name).toBe("clientName");
  });

  it("a client form ignores a context — it creates the client itself", () => {
    expect(createSpace("client", { ...idle, context: CONTEXT }).blocks.some((b) => b.id === "context")).toBe(false);
  });
});
