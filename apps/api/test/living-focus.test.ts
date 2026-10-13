/**
 * Ask ASAP inside a workspace (D-165): the request becomes a typed focus; the answer is built from
 * records; the blocks it concerns come forward; abstention when the records hold nothing; the model
 * is used only where the rules find nothing, and only within the schema and the record's names.
 */
import { LIVING_BLOCK_PROPS, LIVING_REGISTRY, livingPropsJsonSchema, type AiProvider, type LivingComponent } from "@asap/schema";
import pino from "pino";
import { describe, expect, it } from "vitest";
import { interpretWorkspace, interpretWorkspaceModel } from "../src/living/ask-workspace.js";
import { applyFocus, renewalAnswer, renewalVocabulary } from "../src/living/focus.js";
import { composeRenewalSurface } from "../src/living/renewal.js";
import { validateSurface } from "../src/living/validate.js";
import { facts, NOW, quotedOpp } from "./fixtures/living-facts.js";

const definitions = (Object.keys(LIVING_BLOCK_PROPS) as LivingComponent[]).map((c) => ({
  component_id: c, version: LIVING_REGISTRY[c].version, allowed_spaces: ["living"], required_permissions: [],
  can_contain_action: true, requires_evidence: LIVING_REGISTRY[c].requiresEvidence, props_schema: livingPropsJsonSchema(c), deprecated_at: null,
}));
const log = pino({ level: "silent" });
const revised = () => facts({ step: "compare", runState: "running", opportunity: quotedOpp(), revisions: [
  { insurerName: "Jubilee", revision: 1, premiumAmount: "175500", premiumCurrency: "KES", validUntil: "2026-11-01", outcome: "quoted", receivedAt: "2026-10-01T10:00:00Z", documentId: null },
  { insurerName: "Jubilee", revision: 2, premiumAmount: "189000", premiumCurrency: "KES", validUntil: "2026-11-01", outcome: "quoted", receivedAt: "2026-10-07T10:00:00Z", documentId: "22222222-2222-4222-8222-222222222222" },
] });
const provider = (text: string): AiProvider => ({ id: "fake", model: "stand-in", complete: async () => ({ text, servedBy: { provider: "fake", model: "stand-in" } }) as never });

describe("recomposing around a request", () => {
  it("'Compare the revised terms' answers from the revisions and brings the comparison forward", async () => {
    const f = revised();
    const i = await interpretWorkspace("Compare the revised terms", "renewal", renewalVocabulary(f), null, log);
    expect(i.focus).toEqual({ intent: "compare_revisions", target: null });
    const s = applyFocus(composeRenewalSurface(f, { now: NOW, aiAvailable: false }), "Compare the revised terms", renewalAnswer(f, i.focus!, NOW), "rules");
    const main = s.blocks.filter((b) => b.role !== "lead").map((b) => b.id);
    expect(main.slice(0, 3)).toEqual(["focus", "changes", "quotes"]);
    const p = s.blocks.find((b) => b.id === "focus")!.props as { items: { label: string; detail: string; ref: unknown }[] };
    expect(p.items[0]).toMatchObject({ label: "Jubilee · Premium", detail: "KES 175,500.00 → KES 189,000.00 (revision 2)", ref: { ws: "document", documentId: "22222222-2222-4222-8222-222222222222" } });
    expect(validateSurface({ surface: s, definitions, permissions: new Set() }).ok).toBe(true);
  });
  it("'Bring up the document behind this exclusion' abstains when no document is linked, and shows nothing in its place", () => {
    const f = revised();
    const a = renewalAnswer(f, { intent: "evidence", target: "Exclusions" }, NOW);
    expect(a.items).toEqual([]);
    expect(a.empty).toMatch(/No document on file is linked to “Exclusions”/);
  });
  it("the evidence behind a named term links to its document", () => {
    const f = revised();
    const a = renewalAnswer(f, { intent: "evidence", target: "Excess" }, NOW);
    expect(a.items.some((i) => i.label === "Jubilee — Excess" && i.ref?.["ws"] === "document")).toBe(true);
  });
  it("says 'nothing on file' only when there is nothing to list", () => {
    const f = revised();
    const base = composeRenewalSurface(f, { now: NOW, aiAvailable: false });
    const listed = applyFocus(base, "x", { understood: "x", items: [{ label: "A blocker", detail: null, tone: "red", ref: null }], empty: "Nothing on file is blocking this.", emphasis: [] }, "rules");
    expect((listed.blocks.find((b) => b.id === "focus")!.props as { empty: unknown }).empty).toBeNull();
    const none = applyFocus(base, "x", { understood: "x", items: [], empty: "Nothing on file is blocking this.", emphasis: [] }, "rules");
    expect((none.blocks.find((b) => b.id === "focus")!.props as { empty: unknown }).empty).toBe("Nothing on file is blocking this.");
  });
  it("rejects an answer that would open somewhere a surface may not", () => {
    const f = revised();
    const s = applyFocus(composeRenewalSurface(f, { now: NOW, aiAvailable: false }), "x", { understood: "x", items: [{ label: "bad", detail: null, tone: "red", ref: { ws: "sql" } }], empty: null, emphasis: [] }, "rules");
    expect(validateSurface({ surface: s, definitions, permissions: new Set() }).ok).toBe(false);
  });
});

describe("the model is used only where the rules find nothing, and only within bounds", () => {
  const vocab = { insurers: [{ id: "00000000-0000-4000-8000-000000000001", name: "CIC General" }], terms: ["Excess"], documents: [] };
  it("a valid reply with a name from the record is accepted, marked as the model's", async () => {
    const r = await interpretWorkspace("give me the lowdown on the deductible paperwork", "renewal", vocab, provider('{"intent":"evidence","target":"Excess"}'), log);
    expect(r).toMatchObject({ focus: { intent: "evidence", target: "Excess" }, source: "model" });
  });
  it("a target that is not one of the record's names is dropped", async () => {
    const r = await interpretWorkspaceModel(provider('{"intent":"evidence","target":"Flood cover"}'), log, "x", "renewal", vocab);
    expect(r?.focus).toEqual({ intent: "evidence", target: null });
  });
  it("'none', malformed replies and unknown intents are no answer", async () => {
    expect(await interpretWorkspaceModel(provider('{"intent":"none","target":null}'), log, "x", "renewal", vocab)).toBeNull();
    expect(await interpretWorkspaceModel(provider("I think you want evidence"), log, "x", "renewal", vocab)).toBeNull();
    expect(await interpretWorkspaceModel(provider('{"intent":"approve","target":null}'), log, "x", "renewal", vocab)).toBeNull();
  });
  it("never consults the model over a refusal", async () => {
    let called = false;
    const p: AiProvider = { id: "fake", model: "x", complete: async () => { called = true; return { text: '{"intent":"next_steps","target":null}', servedBy: { provider: "fake", model: "x" } } as never; } };
    const r = await interpretWorkspace("approve it", "renewal", vocab, p, log);
    expect(r.focus).toBeNull();
    expect(called).toBe(false);
  });
});
