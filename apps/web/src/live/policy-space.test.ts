import { policySpaceResponseSchema, spaceFrameSchema } from "@asap/schema";
import { describe, expect, it } from "vitest";
import { policyStub } from "../parity/policy-stub.js";
import { policySpace } from "./policy-space.js";

/**
 * The Policy Space view model (4C-1): every state is a valid frame, reads as what it is, keeps cover
 * and work in separate slots, and never says a premium was paid.
 */
const ID = "4a000000-0000-4000-8000-0000000000c1";
const idle = { loading: false, error: null, missing: false, refused: null, busy: false };
const frame = (stage: string) => policySpace(policySpaceResponseSchema.parse(policyStub(stage).body), idle, ID);
const text = (f: unknown) => JSON.stringify(f);
type Frame = ReturnType<typeof frame>;
const block = <T extends Frame["blocks"][number]["type"]>(f: Frame, id: string) => f.blocks.find((b) => b.id === id) as Extract<Frame["blocks"][number], { type: T }> | undefined;

const STATES = ["active", "future", "expired", "cancelled", "legacy", "missing-number", "missing-term", "history", "conflict", "corrected", "difference", "work", "prepared", "no-permission-actions"];

describe("the Policy Space", () => {
  it.each(STATES)("%s is a valid frame, with no retired or payment words", (stage) => {
    const f = frame(stage);
    expect(() => spaceFrameSchema.parse(f)).not.toThrow();
    expect(f.self).toMatchObject({ spaceKind: "policy", recordType: "policy", recordId: ID });
    expect(text(f)).not.toMatch(/Needs you|"Waiting"|Policy Space|\b(Unpaid|Part paid|Reconciled)\b/);
  });

  it("follows the prototype's facts grid: insured, insurer, period, premium, cover proof", () => {
    const facts = block<"facts">(frame("active"), "standing")!.facts.map((x) => x.key);
    expect(facts).toEqual(["Insured", "Insurer", "Policy number", "Period", "Premium", "Cover proof"]);
  });

  it("says Active cover only when the server does, with its evidence as cover proof", () => {
    const f = frame("active");
    expect(block<"note">(f, "cover")).toMatchObject({ title: "Active cover", tone: "active" });
    expect(block<"facts">(f, "standing")!.facts.find((x) => x.key === "Cover proof")!.value).toMatch(/confirmed cover/);
  });

  it("a legacy policy says cover is not verified — and the proof slot says so too", () => {
    const f = frame("legacy");
    expect(block<"note">(f, "cover")).toMatchObject({ title: "Cover not verified" });
    expect(block<"facts">(f, "standing")!.facts.find((x) => x.key === "Cover proof")).toMatchObject({ value: "No confirmation — not Active cover", missing: true });
    expect(text(f)).not.toMatch(/"Active cover"/);
  });

  it("a future period is Confirmed, an ended one Expired, an explicit cancellation Cancelled", () => {
    expect(block<"note">(frame("future"), "cover")!.title).toBe("Confirmed");
    expect(block<"note">(frame("expired"), "cover")!.title).toBe("Expired");
    expect(block<"note">(frame("cancelled"), "cover")!.title).toBe("Cancelled");
  });

  it("keeps every historical period, and says which is being read", () => {
    const rows = block<"rows">(frame("history"), "periods")!.rows;
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.title.includes("reading this period"))).toHaveLength(1);
    expect(rows.filter((r) => r.actions.some((a) => a.label === "Read this period"))).toHaveLength(2);
  });

  it("overlapping periods: the conflict first, no period chosen, and the Work that asks a person", () => {
    const f = frame("conflict");
    expect(f.blocks[0]).toMatchObject({ type: "note", title: "These periods overlap" });
    expect(block<"facts">(f, "standing")!.label).toBe("NO PERIOD CHOSEN");
    expect(block<"note">(f, "cover")!.title).toBe("Two periods both cover today");
    expect(block<"rows">(f, "work")!.rows[0]!.title).toMatch(/^Your work — .* settle overlapping periods$/);
  });

  it("each value carries its source, and evidence opens at its page with the region drawn", () => {
    const rows = block<"rows">(frame("corrected"), "values")!.rows;
    const num = rows.find((r) => r.id === "fact-policy_number")!;
    expect(num).toMatchObject({ badge: "Corrected by a person", region: { pageNumber: 1, rect: { x: 72, width: 260 } } });
    expect(num.actions[0]!.to!.path).toMatch(/^\/documents\/.*\?page=1&field=/);
    expect(rows.find((r) => r.id === "fact-sum_insured")!.badge).toBe("Missing");
  });

  it("a missing policy number and missing terms are named, never shown as blanks", () => {
    expect(block<"facts">(frame("missing-number"), "standing")!.facts.find((x) => x.key === "Policy number")).toMatchObject({ value: "Not recorded", missing: true });
    expect(block<"note">(frame("missing-term"), "terms-missing")!.title).toBe("No coverage terms on file");
  });

  it("agreed, confirmed, issued and final stay four columns; an unresolved difference is conflicting", () => {
    const t = block<"table">(frame("difference"), "terms")!;
    expect(t.columns.map((c) => c.label)).toEqual(["Term", "Agreed", "Insurer confirmed", "Issued policy", "On the policy record"]);
    expect(t.rows[0]!.cells[4]).toMatchObject({ tone: "attention" });
    expect(block<"rows">(frame("difference"), "differences")!.rows.every((r) => r.badge === "Unresolved")).toBe(true);
  });

  it("names the outside party and the date while it holds the work", () => {
    const f = frame("work");
    expect(f.status.label).toBe("With Placeholder Insurer since 20 Sept");
    expect(block<"rows">(f, "work")!.rows[0]!.title).toMatch(/^With Placeholder Insurer since 20 Sept — /);
  });

  it("actions are the server's: disabled with the reason, claim and change open their forms", () => {
    const acts = block<"rows">(frame("active"), "next")!.rows.flatMap((r) => r.actions);
    expect(acts.find((a) => a.label === "Report claim")!.to!.path).toMatch(/^\/new\/claim\?policy=/);
    expect(acts.find((a) => a.label === "Open servicing work")!.disabledReason).toMatch(/not built yet/);
    const refused = block<"rows">(frame("no-permission-actions"), "next")!.rows.flatMap((r) => r.actions);
    expect(refused.find((a) => a.label === "Start renewal")!.notPermittedReason).toMatch(/may not/);
  });

  it("premium is a recorded fact; money says payment is not known", () => {
    const f = frame("active");
    expect(block<"note">(f, "money")!.text).toMatch(/not known/);
    expect(block<"facts">(f, "standing")!.facts.find((x) => x.key === "Premium")!.value).toMatch(/— recorded$/);
  });

  it("has designed loading, not found, refused and error states", () => {
    expect(policySpace(undefined, { ...idle, loading: true }, ID).state).toBe("loading");
    expect(policySpace(undefined, { ...idle, missing: true }, ID).emptyState!.heading).toBe("No policy with that address");
    expect(policySpace(undefined, { ...idle, refused: "You may not view policies." }, ID).emptyState!.heading).toBe("You may not view this policy");
    expect(policySpace(undefined, { ...idle, error: "The server did not answer." }, ID).state).toBe("error");
  });
});
