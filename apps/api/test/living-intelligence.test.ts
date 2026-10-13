/**
 * Insurance-native intelligence in a Living workspace (D-166): arrived email proposes governed steps
 * and labels ASAP's reading as a reading; a handover waiting for the viewer comes first and only the
 * viewer can acknowledge it; related work says why it bears on this work; response patterns are
 * stated only with enough on file. Every surface stays valid against the registry.
 */
import { LIVING_BLOCK_PROPS, LIVING_REGISTRY, livingPropsJsonSchema, type LivingComponent } from "@asap/schema";
import { describe, expect, it } from "vitest";
import { PATTERN_MIN_SAMPLE, type Collaboration } from "../src/living/intelligence.js";
import { composeRenewalSurface } from "../src/living/renewal.js";
import { validateSurface } from "../src/living/validate.js";
import { facts, NOW, quotedOpp } from "./fixtures/living-facts.js";

const definitions = (Object.keys(LIVING_BLOCK_PROPS) as LivingComponent[]).map((c) => ({
  component_id: c, version: LIVING_REGISTRY[c].version, allowed_spaces: ["living"], required_permissions: [],
  can_contain_action: true, requires_evidence: LIVING_REGISTRY[c].requiresEvidence, props_schema: livingPropsJsonSchema(c), deprecated_at: null,
}));
const VIEWER = "a0000000-0000-4000-8000-000000000001";
const OTHER = "a0000000-0000-4000-8000-000000000002";
const MSG = "55555555-5555-4555-8555-555555555555";
const collab = (over: Partial<Collaboration> = {}): Collaboration => ({
  arrivals: [], handover: null, members: [{ id: OTHER, name: "Kamau" }], related: [], patterns: [], viewerId: VIEWER, canManage: true, canRecordResponse: true, trail: null, unavailable: [], ...over,
});
const compose = (c: Collaboration) => {
  const f = { ...facts({ step: "compare", runState: "running", opportunity: quotedOpp() }), collab: c };
  const s = composeRenewalSurface(f, { now: NOW, aiAvailable: false });
  const v = validateSurface({ surface: s, definitions, permissions: new Set() });
  expect(v.ok ? [] : v.failures).toEqual([]);
  return s;
};
const blockOf = (s: ReturnType<typeof compose>, id: string) => s.blocks.find((b) => b.id === id);

describe("arrived email", () => {
  const proposal = { id: "66666666-6666-4666-8666-666666666666", opportunityId: "77777777-7777-4777-8777-777777777777", opportunityInsurerId: "00000003-0000-4000-8000-000000000003", outcome: "quoted", premiumAmount: "189000.00", premiumCurrency: "KES", validUntil: "2026-11-01", declineReason: null, words: "Premium KES 189,000 valid to 1 Nov" };
  it("proposes confirming a reading read from the email's words, with the values and words in the confirmation", () => {
    const s = compose(collab({ arrivals: [{ messageId: MSG, from: "underwriting@jubilee.test", subject: "Re: renewal terms", at: "2026-10-11T08:00:00Z", party: "Jubilee", kind: "insurer_quote", workflow: "quotation", proposal }] }));
    const b = blockOf(s, "arrived")!;
    const item = (b.props as { items: { reading: string; proposal: { summary: string } }[] }).items[0]!;
    expect(item.reading).toMatch(/^ASAP's reading: an insurer's quotation/);
    expect(item.proposal.summary).toBe("KES 189,000.00, valid until 1 Nov 2026");
    const cmd = b.actions[0]!;
    expect(cmd).toMatchObject({ kind: "command", command: "quotation.confirm_reading", target: proposal.opportunityId, payload: { action: "record_response", opportunityInsurerId: proposal.opportunityInsurerId, fromProposalId: proposal.id, outcome: "quoted" } });
    expect((cmd as { confirm: { body: string } }).confirm.body).toContain("Premium KES 189,000 valid to 1 Nov");
    // Straight after what moves the work forward.
    const ids = s.blocks.map((x) => x.id);
    const anchor = ids.includes("next") ? ids.indexOf("next") + 1 : s.blocks.filter((x) => x.role === "lead").length;
    expect(ids.indexOf("arrived")).toBe(anchor);
  });
  it("offers no command to someone who cannot record answers, and nothing at all without a reading", () => {
    const s = compose(collab({ canRecordResponse: false, arrivals: [{ messageId: MSG, from: "client@acme.test", subject: "Photos", at: "2026-10-11T08:00:00Z", party: null, kind: null, workflow: "claim", proposal: null }] }));
    const b = blockOf(s, "arrived")!;
    expect(b.actions).toEqual([]);
    expect((b.props as { items: { reading: unknown; proposed: string }[] }).items[0]).toMatchObject({ reading: null, proposed: expect.stringMatching(/record it received below/) });
  });
  it("is absent when nothing is waiting", () => {
    expect(blockOf(compose(collab()), "arrived")).toBeUndefined();
  });
});

describe("handover", () => {
  const h = { id: "88888888-8888-4888-8888-888888888881", fromName: "Kamau", toName: "Amina", toUserId: VIEWER, at: "2026-10-11T08:00:00Z", done: "Notified CIC", open: "Police abstract outstanding", watch: null, acknowledgedAt: null, earlier: 0 };
  it("puts a handover waiting for the viewer first, with only them able to acknowledge it", () => {
    const s = compose(collab({ handover: h }));
    const leads = s.blocks.filter((b) => b.role === "lead").length;
    expect(s.blocks[leads]!.id).toBe("handover");
    expect(s.blocks[leads]!.title).toBe("Handed to you");
    expect(s.blocks[leads]!.actions.map((a) => a.kind === "command" && a.command)).toEqual(["work.acknowledge_handover", "work.hand_over"]);
  });
  it("shows someone else's handover beside the work, without an acknowledge button", () => {
    const s = compose(collab({ handover: { ...h, toUserId: OTHER, toName: "Kamau" } }));
    const b = blockOf(s, "handover")!;
    expect(b.role).toBe("side");
    expect(b.actions.map((a) => a.kind === "command" && a.command)).toEqual(["work.hand_over"]);
  });
  it("offers handing over with colleagues as the only choices, and the version the viewer saw", () => {
    const b = blockOf(compose(collab()), "handover")!;
    const cmd = b.actions[0] as { payload: Record<string, unknown>; inputs: { name: string; options: { value: string }[] }[] };
    expect(cmd.inputs.find((i) => i.name === "toUserId")!.options.map((o) => o.value)).toEqual([OTHER]);
    expect(typeof cmd.payload["version"]).toBe("string");
    expect(b.props).toMatchObject({ from: null, done: null });
  });
  it("offers nothing to a role that cannot manage work", () => {
    expect(blockOf(compose(collab({ canManage: false, members: [] })), "handover")).toBeUndefined();
  });
});

describe("related work and what usually happens", () => {
  it("says why an open claim on the same policy bears on the renewal, and marks it potential", () => {
    const s = compose(collab({ related: [{ workItemId: "99999999-9999-4999-8999-999999999999", title: "Claim — rear-ended", kind: "claim", status: "With CIC since 1 Oct 2026", samePolicy: true }] }));
    const item = (blockOf(s, "related")!.props as { items: { why: string; certainty: string; ref: Record<string, string> }[] }).items[0]!;
    expect(item).toMatchObject({ certainty: "potential", ref: { ws: "living", workItemId: "99999999-9999-4999-8999-999999999999" } });
    expect(item.why).toMatch(/open claim on the policy being renewed/);
    expect(JSON.stringify(item)).not.toMatch(/\b(covered|not covered|liab|payable)/i);
  });
  it(`states a typical time only with ${PATTERN_MIN_SAMPLE} or more requests, and says so otherwise`, () => {
    const s = compose(collab({ patterns: [{ party: "CIC", requests: 7, answered: 6, medianDays: 4.2 }, { party: "Jubilee", requests: 2, answered: 2, medianDays: 1 }] }));
    const p = blockOf(s, "patterns")!.props as { items: { party: string; measure: string; enough: boolean }[]; basis: string };
    expect(p.items[0]).toMatchObject({ enough: true, measure: "Answered 6 of 7 requests; the typical first answer came about 4 days after delivery." });
    expect(p.items[1]).toMatchObject({ enough: false, measure: expect.stringMatching(/^Too little on file to say/) });
    expect(p.basis).toMatch(/estimate, not a promise/);
  });
  it("carries last round's decisions forward with their evidence, as a starting point", () => {
    const s = compose(collab({ trail: { title: "Acme motor fleet 2025", closedAt: "2025-11-03", items: [
      { at: "2025-10-10", text: "CIC declined — fleet loss ratio above appetite", by: null, tone: "red", documentId: "22222222-2222-4222-8222-222222222222" },
      { at: "2025-10-20", text: "The client instructed Jubilee — conditions: 12-month cover", by: "Wanjiru", tone: "green", documentId: null },
    ] } }));
    const b = blockOf(s, "trail")!;
    const p = b.props as { round: string; items: { ref: Record<string, string> | null }[]; note: string };
    expect(p.round).toBe("Acme motor fleet 2025, closed 3 Nov 2025");
    expect(p.items[0]!.ref).toEqual({ ws: "document", documentId: "22222222-2222-4222-8222-222222222222" });
    expect(p.note).toMatch(/not this year's decision/);
  });
  it("names a part it could not read instead of leaving it out silently", () => {
    const s = compose(collab({ unavailable: [{ part: "Handovers", reason: "failed" }] }));
    expect(s.unavailable).toContainEqual({ part: "Handovers", reason: "failed" });
  });
});
