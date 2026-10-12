/**
 * The Living renewal surface (D-156): deterministic composition from facts, validated against the
 * registry before it is sent. These tests hold the rules that make it safe — the stage comes from
 * records, values come from records, a request is never cover, a revision shows earlier and revised
 * side by side, and a surface that breaks a rule is rejected whole.
 */
import { LIVING_BLOCK_PROPS, LIVING_REGISTRY, livingPropsJsonSchema, type LivingComponent } from "@asap/schema";
import { describe, expect, it } from "vitest";
import type { RenewalLivingFacts } from "../src/living/facts.js";
import { facts, NOW, placement, quotedOpp } from "./fixtures/living-facts.js";
import { changes, composeRenewalSurface, consequences, obligations, progressOpportunities, renewalStage } from "../src/living/renewal.js";
import { validateSurface } from "../src/living/validate.js";
import type { ComponentDefinition } from "../src/spaces/validate.js";

const definitions: ComponentDefinition[] = (Object.keys(LIVING_BLOCK_PROPS) as LivingComponent[]).map((c) => ({
  component_id: c, version: LIVING_REGISTRY[c].version, allowed_spaces: ["living"], required_permissions: [],
  can_contain_action: true, requires_evidence: LIVING_REGISTRY[c].requiresEvidence, props_schema: livingPropsJsonSchema(c), deprecated_at: null,
}));

describe("renewal stage", () => {
  it("reads the stage from records, not from a model", () => {
    expect(renewalStage(facts())).toBe("awaiting_terms");
    expect(renewalStage(facts({ step: "pack", runState: "running", opportunity: null }))).toBe("preparing");
    expect(renewalStage(facts({ step: "compare", opportunity: quotedOpp() }))).toBe("comparing");
    expect(renewalStage(facts({ step: "hand_over", opportunity: quotedOpp() }))).toBe("deciding");
    expect(renewalStage(facts({ opportunity: quotedOpp(), placement: placement("requested") }))).toBe("placing");
    expect(renewalStage(facts({ opportunity: quotedOpp(), placement: placement("confirmed"), issuance: { stage: "with_insurer" } as unknown as RenewalLivingFacts["issuance"] }))).toBe("issuing");
    expect(renewalStage(facts({ opportunity: quotedOpp(), placement: placement("active"), issuance: { stage: "applied" } as unknown as RenewalLivingFacts["issuance"] }))).toBe("verified");
    expect(renewalStage(facts({ runState: "exception", opportunity: null }))).toBe("stopped");
  });
});

describe("composition", () => {
  it("leads with insurer answers while terms are awaited, and names who holds the work", () => {
    const s = composeRenewalSurface(facts(), { now: NOW, aiAvailable: false });
    expect(s.stage!.key).toBe("awaiting_terms");
    expect(s.blocks.map((b) => b.component)).toEqual(expect.arrayContaining(["ContextHeader", "RenewalJourney", "QuoteComparison", "ObligationTracker", "CoverageEffectiveState"]));
    expect(s.blocks.some((b) => b.component === "PlacementProgress")).toBe(false);
    const ob = s.blocks.find((b) => b.component === "ObligationTracker")!.props as { items: { party: string; since: string | null }[] };
    expect(ob.items.find((i) => i.party === "CIC")?.since).toBe("2026-10-01");
    expect(validateSurface({ surface: s, definitions, permissions: new Set() }).ok).toBe(true);
  });

  it("swaps quotes for placement once a client has instructed", () => {
    const s = composeRenewalSurface(facts({ opportunity: quotedOpp(), placement: placement("requested") }), { now: NOW, aiAvailable: true });
    expect(s.blocks.some((b) => b.component === "PlacementProgress")).toBe(true);
    expect(s.blocks.some((b) => b.component === "QuoteComparison")).toBe(false);
    expect(validateSurface({ surface: s, definitions, permissions: new Set() }).ok).toBe(true);
  });

  it("never states a request as cover", () => {
    const f = facts({ opportunity: quotedOpp(), placement: placement("requested") });
    const texts = consequences(f, NOW).map((c) => c.text).join(" ");
    expect(texts).toMatch(/requested, not confirmed/);
    expect(texts).toMatch(/Nothing on file yet confirms cover/);
  });

  it("shows a revised premium earlier and revised side by side, and flags one after instruction", () => {
    const rev = (n: number, amount: string, at: string) => ({ insurerName: "Jubilee", revision: n, premiumAmount: amount, premiumCurrency: "KES", validUntil: "2026-11-01", outcome: "quoted", receivedAt: at, documentId: null });
    const f = facts({ opportunity: quotedOpp(), placement: placement("requested"), revisions: [rev(1, "175500", "2026-10-01T10:00:00Z"), rev(2, "189000", "2026-10-07T10:00:00Z")] });
    const c = changes(f);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ subject: "Jubilee", field: "Premium", earlier: "KES 175,500.00", revised: "KES 189,000.00", revision: 2 });
    expect(c[0]!.affects.join(" ")).toMatch(/after the client's instruction/);
    const s = composeRenewalSurface(f, { now: NOW, aiAvailable: false });
    expect(validateSurface({ surface: s, definitions, permissions: new Set() }).ok).toBe(true);
  });

  it("does not call an already-approved request an approval, and lets the placement hold the work", () => {
    const f = facts({ opportunity: quotedOpp(), placement: placement("requested") });
    const p = progressOpportunities(f).find((o) => o.id === "placement-next")!;
    expect(p.title).toBe("Send the approved request");
    expect(p.requiresApproval).toBe(false);
    expect(obligations(f).some((o) => o.party === "CIC")).toBe(false);
  });

  it("is deterministic: the same facts give the same fingerprint, a change gives a new one", () => {
    const a = composeRenewalSurface(facts(), { now: NOW, aiAvailable: false });
    const b = composeRenewalSurface(facts(), { now: NOW, aiAvailable: false });
    const c = composeRenewalSurface(facts({ opportunity: quotedOpp(), step: "compare" }), { now: NOW, aiAvailable: false });
    expect(a.fingerprint).toBe(b.fingerprint);
    expect(c.fingerprint).not.toBe(a.fingerprint);
    expect(a.blocks.find((x) => x.id === "header")!.hash).toBe(b.blocks.find((x) => x.id === "header")!.hash);
  });
});

describe("sources that could not be read (D-157)", () => {
  it("never presents an unreadable period as a missing one", () => {
    const f = facts({ period: null, unavailable: [{ part: "period", reason: "failed" }] });
    const texts = consequences(f, NOW).map((c) => c.text).join(" ");
    expect(texts).not.toMatch(/No policy period is linked/);
    expect(texts).toMatch(/could not be read/);
    const s = composeRenewalSurface(f, { now: NOW, aiAvailable: false });
    expect(s.unavailable).toEqual([{ part: "The policy period", reason: "failed" }]);
    expect(validateSurface({ surface: s, definitions, permissions: new Set() }).ok).toBe(true);
  });
  it("does not say 'no renewed cover' when the placement could not be read", () => {
    const f = facts({ opportunity: quotedOpp(), unavailable: [{ part: "placement", reason: "restricted" }] });
    const s = composeRenewalSurface(f, { now: NOW, aiAvailable: false });
    const cover = s.blocks.find((b) => b.component === "CoverageEffectiveState")!.props as { statement: string; renewed: unknown };
    expect(cover.statement).toMatch(/not the same as no cover/);
    expect(consequences(f, NOW).map((c) => c.text).join(" ")).not.toMatch(/Nothing on file yet confirms cover/);
  });
  it("changes the fingerprint when a source becomes readable again", () => {
    const a = composeRenewalSurface(facts({ unavailable: [{ part: "run", reason: "failed" }] }), { now: NOW, aiAvailable: false });
    const b = composeRenewalSurface(facts(), { now: NOW, aiAvailable: false });
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });
});

describe("governed commands (D-157)", () => {
  const approving = () => facts({ step: "approval", runState: "waiting_approval", opportunity: null });
  it("shows what waits for approval in full, with approve and return commands carrying the frozen hash", () => {
    const s = composeRenewalSurface(approving(), { now: NOW, aiAvailable: false });
    const b = s.blocks.find((x) => x.component === "ApprovalBundle")!;
    expect((b.props as { items: unknown[] }).items).toHaveLength(2);
    const cmds = b.actions.filter((a) => a.kind === "command");
    expect(cmds.map((c) => c.kind === "command" && c.payload["decision"])).toEqual(["approve", "reject"]);
    expect(cmds.every((c) => c.kind === "command" && c.payload["bundleSha256"] === "a".repeat(64))).toBe(true);
    expect(validateSurface({ surface: s, definitions, permissions: new Set() }).ok).toBe(true);
  });
  it("offers no approval command to a role that cannot approve, and says who can", () => {
    const f = approving();
    (f.run as unknown as { permissions: { canApprove: boolean } }).permissions.canApprove = false;
    const b = composeRenewalSurface(f, { now: NOW, aiAvailable: false }).blocks.find((x) => x.component === "ApprovalBundle")!;
    expect(b.actions).toEqual([]);
    expect((b.props as { approverNote: string }).approverNote).toMatch(/cannot approve/);
  });
  it("offers run controls only where the run says they are available, and only to a role that may use them", () => {
    const s = composeRenewalSurface(facts(), { now: NOW, aiAvailable: false });
    const ob = s.blocks.find((x) => x.id === "obligations")!;
    expect(ob.actions.map((a) => a.kind === "command" && a.command)).toEqual(["run.follow_up_now", "run.move_follow_up", "run.escalate", "run.pause"]);
    const none = composeRenewalSurface(facts({ viewer: { canControlRun: false } }), { now: NOW, aiAvailable: false });
    expect(none.blocks.find((x) => x.id === "obligations")!.actions).toEqual([]);
  });
  it("lets a person record how an approved placement request was sent, with evidence inputs", () => {
    const s = composeRenewalSurface(facts({ opportunity: quotedOpp(), placement: placement("requested") }), { now: NOW, aiAvailable: false });
    const pl = s.blocks.find((x) => x.id === "placement")!;
    const rec = pl.actions.find((a) => a.kind === "command" && a.command === "placement.record_submission");
    expect(rec && rec.kind === "command" && rec.inputs.map((i) => i.name)).toEqual(["method", "recipient", "sentAt", "evidenceNote"]);
  });
  it("lets a person record each insurer's answer on the comparison, once the request is delivered", () => {
    const s = composeRenewalSurface(facts(), { now: NOW, aiAvailable: false });
    const q = s.blocks.find((x) => x.component === "QuoteComparison")!;
    const rec = q.actions.filter((a) => a.kind === "command");
    expect(rec.map((a) => a.kind === "command" && a.label)).toEqual(["Record CIC's answer", "Record Jubilee's answer"]);
    expect(rec.every((a) => a.kind === "command" && a.inputs.some((i) => i.name === "sourceNote" && i.required))).toBe(true);
    expect(validateSurface({ surface: s, definitions, permissions: new Set() }).ok).toBe(true);
  });
  it("trusts the quotation over a run that has not caught up: no waiting on, or chasing, an insurer who answered", () => {
    const f = facts({ step: "await_terms", opportunity: quotedOpp() });
    expect(obligations(f).some((o) => o.party === "CIC" && o.kind === "outside")).toBe(false);
    const ob = composeRenewalSurface(f, { now: NOW, aiAvailable: false }).blocks.find((x) => x.id === "obligations")!;
    expect(ob.actions.some((a) => a.kind === "command" && a.command === "run.follow_up_now")).toBe(false);
    const journey = composeRenewalSurface(f, { now: NOW, aiAvailable: false }).blocks.find((x) => x.id === "journey")!.props as { summary: string };
    expect(journey.summary).not.toMatch(/^Awaiting insurer terms/);
  });
  it("rejects a surface whose command carries a field the command does not take, or a different action", () => {
    const s = composeRenewalSurface(approving(), { now: NOW, aiAvailable: false });
    const b = s.blocks.find((x) => x.component === "ApprovalBundle")!;
    const c = b.actions[0]!;
    if (c.kind === "command") c.payload["premiumAmount"] = "1";
    expect(validateSurface({ surface: s, definitions, permissions: new Set() }).ok).toBe(false);
    const t = composeRenewalSurface(facts({ opportunity: quotedOpp(), placement: placement("requested") }), { now: NOW, aiAvailable: false });
    const rec = t.blocks.find((x) => x.id === "placement")!.actions.find((a) => a.kind === "command")!;
    if (rec.kind === "command") rec.payload["action"] = "record_insurer_response";
    expect(validateSurface({ surface: t, definitions, permissions: new Set() }).ok).toBe(false);
  });
});

describe("validation", () => {
  const good = () => composeRenewalSurface(facts(), { now: NOW, aiAvailable: false });
  it("rejects an unregistered component", () => {
    const s = good();
    const r = validateSurface({ surface: s, definitions: definitions.filter((d) => d.component_id !== "ContextHeader"), permissions: new Set() });
    expect(r.ok).toBe(false);
  });
  it("rejects a component not allowed in a Living surface", () => {
    const r = validateSurface({ surface: good(), definitions: definitions.map((d) => ({ ...d, allowed_spaces: ["renewal"] })), permissions: new Set() });
    expect(r.ok).toBe(false);
  });
  it("rejects an action that opens anything but a governed place", () => {
    const s = good();
    s.blocks[0]!.actions = [{ kind: "open", label: "Write it", ref: { ws: "sql" }, primary: true }];
    expect(validateSurface({ surface: s, definitions, permissions: new Set() }).ok).toBe(false);
  });
  it("rejects a confidence or percentage anywhere in props", () => {
    const s = good();
    (s.blocks[1]!.props as Record<string, unknown>)["confidence"] = 0.9;
    expect(validateSurface({ surface: s, definitions, permissions: new Set() }).ok).toBe(false);
  });
  it("rejects a quote comparison without a source", () => {
    const s = good();
    s.blocks.find((b) => b.component === "QuoteComparison")!.evidence = [];
    const r = validateSurface({ surface: s, definitions, permissions: new Set() });
    expect(r.ok).toBe(false);
  });
  it("removes, before sending, a block the viewer may not see", () => {
    const defs = definitions.map((d) => (d.component_id === "Timeline" || d.component_id === "EvidenceInspector" ? { ...d, required_permissions: ["audit:view"] } : d));
    const r = validateSurface({ surface: good(), definitions: defs, permissions: new Set() });
    expect(r.ok && r.surface.blocks.some((b) => b.component === "EvidenceInspector")).toBe(false);
  });
});
