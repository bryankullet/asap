/**
 * Phase 5a rules (UI Build Spec Part 6.6 and 6.3), at the engine and run-plan level:
 *  - a claim from email is captured as a draft and stays one until a person matches a period;
 *  - two candidate periods → the person chooses; cover is "looks right", never "is covered";
 *  - the clock runs only with a clause (page, days) and a verified start event, else "not started";
 *  - outstanding documents are named with who holds them; a call note cannot be the insurer's response;
 *  - settlement offered, client accepted and payment received are three separate facts;
 *  - endorsement: ambiguous request asks; per-item decisions gate the response; transfer of
 *    ownership from anyone but the policyholder is recorded but blocked.
 */
import {
  CLAIM_BANNED_PHRASES,
  claimSteps,
  clockState,
  endorsementSteps,
  type ActRequest,
  type ClaimDetail,
  type EndorsementDetail,
  type WorkItemRow,
} from "@asap/schema";
import { describe, expect, it } from "vitest";
import { planRun } from "../runs/executor.js";
import { applyAction, type GuardFacts } from "./apply.js";

const NOW = new Date("2026-09-10T10:00:00Z");
const CTX = {
  userId: "a0000000-0000-4000-8000-000000000002",
  now: NOW,
  roleKey: "account_executive",
};
const ORG = "10000000-0000-4000-8000-00000000000a";
const CLIENT = "70000000-0000-4000-8000-00000000000b";
const POLICY = "90000000-0000-4000-8000-00000000000b";
const PERIOD = "91000000-0000-4000-8000-00000000000b";
const PERIOD2 = "91000000-0000-4000-8000-00000000000c";

function item(
  kind: "claim" | "endorsement",
  steps: WorkItemRow["steps"],
  over: Partial<WorkItemRow> = {},
): WorkItemRow {
  return {
    id: "30000000-0000-4000-8000-000000000050",
    organization_id: ORG,
    title:
      kind === "claim"
        ? "Jane Wanjiku — claim, incident 2026-09-01"
        : "Acme Motors — policy change",
    kind,
    client_id: CLIENT,
    policy_period_id: null,
    insurer_id: null,
    class_of_business: null,
    owner_id: CTX.userId,
    task_status: "needs_you",
    task_party: null,
    task_since: null,
    task_next_check: null,
    cover_status: null,
    cover_inception_at: null,
    money_status: null,
    reason: null,
    steps,
    exception: null,
    version: 2,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    completed_at: null,
    deleted_at: null,
    ...over,
  };
}
/** Puts the item at `stepId`, earlier steps done. */
function at(kind: "claim" | "endorsement", stepId: string): WorkItemRow {
  const base =
    kind === "claim"
      ? claimSteps({ clientName: "Jane Wanjiku", insurerName: "Jubilee" })
      : endorsementSteps({ insurerName: "Jubilee" });
  const idx = base.findIndex((s) => s.id === stepId);
  return item(
    kind,
    base.map((s, i) => ({ ...s, state: i < idx ? "done" : i === idx ? "now" : "todo" })),
  );
}

const claim = (over: Partial<ClaimDetail["claim"]> = {}): ClaimDetail["claim"] => ({
  id: "a0000000-0000-4000-8000-00000000c1a1",
  organization_id: ORG,
  work_item_id: "30000000-0000-4000-8000-000000000050",
  client_id: CLIENT,
  policy_id: null,
  policy_period_id: null,
  status: "draft",
  source: "email",
  incident_on: "2026-09-01",
  incident_summary: "Rear-ended at Uhuru Highway",
  reported_on: null,
  insurer_reference: null,
  cover_review: null,
  cover_review_version_id: null,
  clock_clause_reference: null,
  clock_clause_page: null,
  clock_clause_days: null,
  clock_start_event: null,
  clock_start_on: null,
  clock_start_evidence: null,
  offer_reference: null,
  offer_recorded_at: null,
  acceptance_reference: null,
  acceptance_recorded_at: null,
  payment_reference: null,
  payment_recorded_at: null,
  registered_by: null,
  registered_at: null,
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  ...over,
});
const policy = (id = POLICY) => ({
  id,
  organization_id: ORG,
  client_id: CLIENT,
  insurer_id: "60000000-0000-4000-8000-00000000000a",
  class_of_business: "Motor private",
  policy_number: null,
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  deleted_at: null,
});
const period = (id: string, policyId: string) => ({
  id,
  organization_id: ORG,
  policy_id: policyId,
  period_start: "2026-03-01",
  period_end: "2027-02-28",
  created_at: NOW.toISOString(),
});
const claimFacts = (detail: Partial<ClaimDetail> = {}): GuardFacts => ({
  clientFileState: "incomplete",
  agreedRate: undefined,
  clientId: CLIENT,
  claim: {
    claim: claim(),
    documents: [],
    notes: [],
    clock: clockState(claim(), "2026-09-10"),
    candidatePeriods: [
      { period: period(PERIOD, POLICY), policy: policy(), insurerName: "Jubilee" },
    ],
    ...detail,
  },
});
const req = (o: Partial<ActRequest> & Pick<ActRequest, "stepId" | "verb">): ActRequest => ({
  version: 2,
  ...o,
});

describe("claims — capture and match", () => {
  it("a claim from email is captured as a draft and the run says it is not registered", () => {
    const plan = planRun(at("claim", "capture"), "capture", {
      clientFileState: null,
      agreedRate: undefined,
      claim: claimFacts().claim,
    });
    expect(plan.pause).toBeNull();
    expect(plan.events.join(" ")).toMatch(/draft claim/);
    expect(plan.events.join(" ")).toMatch(/not registered until a person/);
    expect(plan.rpcs ?? []).toEqual([]); // nothing registers it
  });

  it("matching needs the person's choice; one candidate still needs confirming, two need choosing", () => {
    const one = applyAction(
      at("claim", "match"),
      req({ stepId: "match", verb: "record_evidence", evidence: "Schedule" }),
      CTX,
      claimFacts(),
    );
    expect(one).toMatchObject({ kind: "blocked", guard: "evidence_present" });
    if (one.kind === "blocked") expect(one.reason).toMatch(/Confirm the policy period/);
    const two = applyAction(
      at("claim", "match"),
      req({ stepId: "match", verb: "record_evidence", evidence: "Schedule" }),
      CTX,
      claimFacts({
        candidatePeriods: [
          { period: period(PERIOD, POLICY), policy: policy(), insurerName: "Jubilee" },
          {
            period: period(PERIOD2, "90000000-0000-4000-8000-00000000000c"),
            policy: policy("90000000-0000-4000-8000-00000000000c"),
            insurerName: "CIC",
          },
        ],
      }),
    );
    if (two.kind === "blocked")
      expect(two.reason).toMatch(/2 policy periods contain the incident date. Choose which/);
    const chosen = applyAction(
      at("claim", "match"),
      req({
        stepId: "match",
        verb: "record_evidence",
        evidence: "Schedule",
        policyPeriodId: PERIOD,
      }),
      CTX,
      claimFacts(),
    );
    expect(chosen).toMatchObject({
      kind: "applied",
      effects: { registerClaim: { policyPeriodId: PERIOD } },
    });
  });

  it("a period that does not contain the incident date is refused", () => {
    const r = applyAction(
      at("claim", "match"),
      req({ stepId: "match", verb: "record_evidence", evidence: "x", policyPeriodId: PERIOD2 }),
      CTX,
      claimFacts(),
    );
    expect(r).toMatchObject({ kind: "blocked" });
  });
});

describe("claims — cover review and the clock", () => {
  it("cover on the incident date is phrased as a review, never as a decision", () => {
    const facts = {
      clientFileState: null,
      agreedRate: undefined,
      claim: claimFacts().claim,
      coverOnIncident: {
        versionId: "92000000-0000-4000-8000-00000000000b",
        version: 1,
        className: "Motor private",
        insurerName: "Jubilee",
      },
    };
    const plan = planRun(at("claim", "cover_check"), "cover_check", facts);
    const text = plan.events.join(" ") + " " + (plan.note ?? "");
    expect(text).toMatch(/looks right/);
    for (const banned of CLAIM_BANNED_PHRASES) expect(text).not.toMatch(banned);
    expect(plan.rpcs?.[0]?.name).toBe("claim_set_cover_review");
    const none = planRun(at("claim", "cover_check"), "cover_check", {
      ...facts,
      coverOnIncident: null,
    });
    expect(none.events.join(" ")).toMatch(/does not look right/);
    for (const banned of CLAIM_BANNED_PHRASES) expect(none.events.join(" ")).not.toMatch(banned);
  });

  it("the clock does not start without a clause with a page and a verified start event, and says why", () => {
    const plan = planRun(at("claim", "clock"), "clock", {
      clientFileState: null,
      agreedRate: undefined,
      claim: claimFacts().claim,
      today: "2026-09-10",
    });
    expect(plan.events.join(" ")).toMatch(
      /Clock not started: needs a wording clause with its page and the number of days and a verified start event/,
    );
    expect(plan.events.join(" ")).not.toMatch(/breach/i);
    const half = clockState(
      claim({ clock_clause_reference: "Condition 3", clock_clause_page: 4, clock_clause_days: 7 }),
      "2026-09-10",
    );
    expect(half).toEqual({
      started: false,
      reason: "Clock not started: needs a verified start event with its date and evidence.",
    });
  });

  it("with both, the clock counts from the verified start and names the due date, never a breach", () => {
    const c = claim({
      clock_clause_reference: "Condition 3",
      clock_clause_page: 4,
      clock_clause_days: 7,
      clock_start_event: "incident",
      clock_start_on: "2026-09-01",
      clock_start_evidence: "Client email 1 Sep",
    });
    const state = clockState(c, "2026-09-10");
    expect(state).toMatchObject({ started: true, dueOn: "2026-09-08", dayOf: 10 });
    const plan = planRun(at("claim", "clock"), "clock", {
      clientFileState: null,
      agreedRate: undefined,
      claim: { ...claimFacts().claim!, claim: c },
      today: "2026-09-10",
    });
    expect(plan.events.join(" ")).toMatch(/due 2026-09-08; today is day 10/);
    expect(plan.events.join(" ")).not.toMatch(/breach/i);
  });
});

describe("claims — documents, response, and the three facts", () => {
  it("names every outstanding document with who holds it", () => {
    const r = applyAction(
      at("claim", "documents"),
      req({ stepId: "documents", verb: "record_evidence", evidence: "All in" }),
      CTX,
      claimFacts({
        documents: [
          {
            id: "d1",
            organization_id: ORG,
            claim_id: "a0000000-0000-4000-8000-00000000c1a1",
            label: "Police abstract",
            holder: "police",
            reference: null,
            requested_at: NOW.toISOString(),
            received_at: null,
            created_at: NOW.toISOString(),
          },
          {
            id: "d2",
            organization_id: ORG,
            claim_id: "a0000000-0000-4000-8000-00000000c1a1",
            label: "Repair estimate",
            holder: "garage",
            reference: "Est-44",
            requested_at: null,
            received_at: NOW.toISOString(),
            created_at: NOW.toISOString(),
          },
        ],
      }),
    );
    expect(r).toMatchObject({ kind: "blocked", guard: "evidence_present" });
    if (r.kind === "blocked") {
      expect(r.reason).toContain("Police abstract (with the police)");
      expect(r.reason).not.toContain("Repair estimate");
    }
  });

  it("a call note cannot stand in for the insurer's written response", () => {
    const r = applyAction(
      at("claim", "response"),
      req({
        stepId: "response",
        verb: "record_evidence",
        evidence: "Spoke to Mercy",
        evidenceKind: "call_note",
      }),
      CTX,
      claimFacts(),
    );
    expect(r).toMatchObject({ kind: "blocked", guard: "evidence_present" });
    if (r.kind === "blocked") expect(r.reason).toMatch(/not the insurer's words/);
    expect(
      applyAction(
        at("claim", "response"),
        req({
          stepId: "response",
          verb: "record_evidence",
          evidence: "Jubilee email 20 Sep",
          evidenceKind: "document",
        }),
        CTX,
        claimFacts(),
      ).kind,
    ).toBe("applied");
  });

  it("offer, acceptance and payment are three separate facts on three separate steps", () => {
    for (const [stepId, fact] of [
      ["offer", "offer"],
      ["acceptance", "acceptance"],
      ["payment", "payment"],
    ] as const) {
      const r = applyAction(
        at("claim", stepId),
        req({ stepId, verb: "record_evidence", evidence: `${fact} ref` }),
        CTX,
        claimFacts(),
      );
      expect(r).toMatchObject({
        kind: "applied",
        effects: { claimFact: { fact, reference: `${fact} ref` } },
      });
      // An offer or an acceptance never finishes the claim; only the receipt, the tenth step, does.
      if (r.kind === "applied") expect(r.derived.task.status === "done").toBe(stepId === "payment");
    }
    const steps = claimSteps({ clientName: "x", insurerName: null });
    expect(steps.map((s) => s.id).slice(-3)).toEqual(["offer", "acceptance", "payment"]);
    expect(steps).toHaveLength(10);
  });
});

const endorsement = (
  over: Partial<EndorsementDetail["endorsement"]> = {},
): EndorsementDetail["endorsement"] => ({
  id: "b0000000-0000-4000-8000-00000000e1e1",
  organization_id: ORG,
  work_item_id: "30000000-0000-4000-8000-000000000050",
  policy_id: POLICY,
  kind: "add_item",
  requested_by: "policyholder",
  requested_by_name: "Acme Motors",
  request_text: "Please add KDC 900T",
  effective_on: "2026-10-01",
  instruction_reference: null,
  instruction_from: null,
  response_reference: null,
  items: [
    {
      id: "kdc900t",
      label: "KDC 900T",
      before: null,
      after: "Add",
      sumInsuredMinor: 520000000,
      decision: "pending",
      note: null,
    },
    {
      id: "kdd111a",
      label: "KDD 111A",
      before: null,
      after: "Add",
      sumInsuredMinor: 180000000,
      decision: "pending",
      note: null,
    },
  ],
  applied_version_id: null,
  created_by: null,
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  ...over,
});
const endFacts = (e: EndorsementDetail["endorsement"]): GuardFacts => ({
  clientFileState: null,
  agreedRate: undefined,
  endorsement: { endorsement: e, policy: policy(), versions: [], missing: [] },
});

describe("endorsements", () => {
  it("an ambiguous request pauses the classify run and asks", () => {
    const plan = planRun(at("endorsement", "classify"), "classify", {
      clientFileState: null,
      agreedRate: undefined,
      endorsement: endFacts(
        endorsement({ kind: null, request_text: "Please add a vehicle and remove another" }),
      ).endorsement,
    });
    expect(plan.pause?.nextStep).toBe("Say what kind of change this is");
    const clear = planRun(at("endorsement", "classify"), "classify", {
      clientFileState: null,
      agreedRate: undefined,
      endorsement: endFacts(endorsement({ kind: null, request_text: "Please add KDC 900T" }))
        .endorsement,
    });
    expect(clear.pause).toBeNull();
    expect(clear.rpcs?.[0]).toMatchObject({
      name: "endorsement_update",
      args: { p_kind: "add_item" },
    });
  });

  it("the insurer's response is complete only when every item has a decision", () => {
    const r = applyAction(
      at("endorsement", "response"),
      req({ stepId: "response", verb: "record_evidence", evidence: "Jubilee email" }),
      CTX,
      endFacts(endorsement()),
    );
    expect(r).toMatchObject({ kind: "blocked", guard: "evidence_present" });
    if (r.kind === "blocked")
      expect(r.reason).toMatch(/KDC 900T; KDD 111A. Partial acceptance is itemised/);
    const decided = endorsement({
      items: endorsement().items.map((i, n) => ({
        ...i,
        decision: n === 0 ? "accepted" : "rejected",
        note: n === 0 ? null : "Too old",
      })),
      response_reference: "Jubilee email",
    });
    expect(
      applyAction(
        at("endorsement", "response"),
        req({ stepId: "response", verb: "record_evidence", evidence: "Jubilee email" }),
        CTX,
        endFacts(decided),
      ).kind,
    ).toBe("applied");
    const apply = applyAction(
      at("endorsement", "update_policy"),
      req({ stepId: "update_policy", verb: "approve" }),
      CTX,
      endFacts(decided),
    );
    expect(apply).toMatchObject({ kind: "applied", effects: { applyEndorsement: true } });
  });

  it("a transfer of ownership requested by anyone but the policyholder is recorded but blocked at requirements", () => {
    const e = endorsement({
      kind: "transfer_ownership",
      requested_by: "other",
      requested_by_name: "Peter Kamau (buyer)",
    });
    const plan = planRun(at("endorsement", "requirements"), "requirements", {
      clientFileState: null,
      agreedRate: undefined,
      endorsement: endFacts(e).endorsement,
    });
    expect(plan.pause?.blockedReason).toMatch(
      /needs the policyholder's own instruction. This request came from Peter Kamau \(buyer\); it is recorded, not acted on/,
    );
    const withBuyerLetter = planRun(at("endorsement", "requirements"), "requirements", {
      clientFileState: null,
      agreedRate: undefined,
      endorsement: endFacts(
        endorsement({ ...e, instruction_reference: "Buyer letter", instruction_from: "other" }),
      ).endorsement,
    });
    expect(withBuyerLetter.pause).not.toBeNull();
    const withOwn = planRun(at("endorsement", "requirements"), "requirements", {
      clientFileState: null,
      agreedRate: undefined,
      endorsement: endFacts(
        endorsement({
          ...e,
          instruction_reference: "Acme letter 3 Oct",
          instruction_from: "policyholder",
        }),
      ).endorsement,
    });
    expect(withOwn.pause).toBeNull();
  });

  it("the recipe has six steps and no authority_sufficient guard (recorded, not evaluable)", () => {
    const steps = endorsementSteps({ insurerName: "Jubilee" });
    expect(steps).toHaveLength(6);
    expect(
      steps
        .flatMap((s) => [...s.guards, ...s.actions.flatMap((a) => a.guards)])
        .map((g) => (typeof g === "string" ? g : g.id)),
    ).not.toContain("authority_sufficient");
  });
});
