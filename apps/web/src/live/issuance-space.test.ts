import { issuanceResponseSchema, spaceFrameSchema } from "@asap/schema";
import { describe, expect, it } from "vitest";
import { issuancePreviewStub, issuanceStub } from "../parity/issuance-stub.js";
import { issuanceSpace } from "./issuance-space.js";

/**
 * The issuance Space's view model (4B-5): every state is a valid frame, reads as what it is, and
 * never lets one step pass for the next.
 */
const ID = "40000000-0000-4000-8000-00000000000a";
const idle = { loading: false, error: null, missing: false, busy: false };
const frame = (stage: string, perms: string | null = null, drafting: Parameters<typeof issuanceSpace>[3] = null, preview: Parameters<typeof issuanceSpace>[4] = null) =>
  issuanceSpace(issuanceResponseSchema.parse(issuanceStub(stage, perms)), idle, ID, drafting, preview);
const text = (f: ReturnType<typeof frame>) => JSON.stringify(f);

describe("the issuance Space", () => {
  const STAGES = ["not-ready", "ready", "draft", "superseded", "approved", "with-insurer", "received", "reviewed", "stale", "conflict", "resolved", "ready-to-apply", "missing-info", "prepared-apply", "applied"];

  it.each(STAGES)("%s is a valid frame with no retired words", (stage) => {
    const f = frame(stage);
    expect(() => spaceFrameSchema.parse(f)).not.toThrow();
    expect(f.title).toBe("Policy issuance — Placeholder Company motor fleet placement — 2027");
    expect(text(f)).not.toMatch(/Needs you|"Waiting"|Issuance Space/);
  });

  it("never says issued or recorded before the policy record is written", () => {
    for (const stage of STAGES.filter((s) => s !== "applied")) {
      expect(text(frame(stage))).not.toMatch(/policy (was|has been) (issued|recorded)|Written to the policy record/i);
    }
    const applied = frame("applied");
    expect(applied.blocks.find((b) => b.id === "receipt")).toMatchObject({ title: "Policy PH/MTR/0001 created from the issued policy" });
  });

  it("a prepared and an approved request both say they have not been sent", () => {
    expect(frame("draft").blocks.find((b) => b.id === "request")!.label).toMatch(/DRAFT, NOT SENT/);
    expect(frame("approved").blocks.find((b) => b.id === "request")!.label).toMatch(/APPROVED, NOT SENT/);
    expect(frame("approved").blocks.find((b) => b.id === "sending")).toBeDefined();
  });

  it("names the insurer and the date while it holds the work", () => {
    expect(frame("with-insurer").status.label).toBe("With Placeholder Insurer since 12 Sept");
    expect(text(frame("with-insurer"))).toMatch(/With Placeholder Insurer since 12 Sept — obtain the issued policy/);
  });

  it("offers approval disabled, with the reason, to someone who may not approve", () => {
    const next = frame("draft", "officer").blocks.find((b) => b.id === "next") as Extract<ReturnType<typeof frame>["blocks"][number], { type: "rows" }>;
    const approve = next.rows[0]!.actions.find((a) => a.label.startsWith("Approve"))!;
    expect(approve.notPermittedReason).toMatch(/may not approve/);
  });

  it("shows each value read from the document with its page and highlight", () => {
    const rows = (frame("received").blocks.find((b) => b.id === "document") as Extract<ReturnType<typeof frame>["blocks"][number], { type: "rows" }>).rows;
    expect(rows[0]).toMatchObject({ region: { pageNumber: 1, rect: { x: 72, width: 260 } } });
    expect(rows[0]!.actions.map((a) => a.label)).toEqual(["Accept", "Correct", "Reject"]);
  });

  it("puts each difference in the six words, and blocks apply until resolved", () => {
    const f = frame("conflict");
    const table = f.blocks.find((b) => b.id === "check") as Extract<ReturnType<typeof frame>["blocks"][number], { type: "table" }>;
    const words = table.rows.map((r) => r.cells[4]!.value);
    expect(words).toEqual(expect.arrayContaining(["Matches", "Changed", "Added by insurer", "Not stated in either source"]));
    expect(f.blocks.find((b) => b.id === "blockers")).toBeDefined();
    expect(text(f)).not.toMatch(/Preview writing it to the policy record/);
  });

  it("asks for a target and a basis, and shows the server's preview with an approval gate", () => {
    const form = frame("ready-to-apply", null, "apply").blocks.find((b) => b.id === "apply-form") as Extract<ReturnType<typeof frame>["blocks"][number], { type: "form" }>;
    expect(form.fields.map((x) => x.name)).toEqual(["target", "premiumBasis"]);
    expect(form.fields[0]!.value).toBe("");
    const p = issuancePreviewStub("ready-to-apply", { mode: "create", premiumBasis: "gross" });
    const f = frame("ready-to-apply", null, null, p);
    expect(f.blocks.find((b) => b.id === "preview")).toBeDefined();
    expect(f.blocks.find((b) => b.id === "apply-gate")).toBeDefined();
    const missing = frame("missing-info", null, null, issuancePreviewStub("missing-info", { mode: "create", premiumBasis: "gross" }));
    expect(missing.blocks.find((b) => b.id === "apply-gate")).toBeUndefined();
    expect(text(missing)).toMatch(/period was not read/);
  });

  it("has designed loading, missing and error states", () => {
    expect(issuanceSpace(undefined, { ...idle, loading: true }, ID).state).toBe("loading");
    expect(issuanceSpace(undefined, { ...idle, missing: true }, ID).state).toBe("empty");
    expect(issuanceSpace(undefined, { ...idle, error: "The server did not answer." }, ID).emptyState?.body).toBe("The server did not answer.");
  });
});
