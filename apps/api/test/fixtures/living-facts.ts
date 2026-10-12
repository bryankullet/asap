/**
 * Renewal facts for the Living composer's tests and the UI Lab (D-156). Shapes are the loaders' own
 * responses, trimmed to what the composer reads; every value is fictional and lives only in tests.
 */
import type { RenewalLivingFacts } from "../../src/living/facts.js";

export const NOW = new Date("2026-10-12T09:00:00Z");
export const ID = "11111111-1111-4111-8111-111111111111";
export const insurer = (name: string, stage: string, premium: string | null) => ({
  insurerName: name, stage, stageLabel: stage, addedAt: "2026-09-20T08:00:00Z", request: null,
  response: premium === null && stage !== "quoted" ? null : {
    premiumAmount: premium, premiumCurrency: "KES", validUntil: "2026-11-01", receivedAt: "2026-10-01T10:00:00Z", declineReason: null,
    source: { kind: "document", id: "22222222-2222-4222-8222-222222222222", label: `${name} quote.pdf` },
    terms: [{ label: "Excess", extractedValue: "10%", correctedValue: null, unclear: false, amount: null, currency: null, evidence: { kind: "document", id: "22222222-2222-4222-8222-222222222222", label: "page 2" } }],
  },
});

export function facts(over: Partial<RenewalLivingFacts> & { step?: string; runState?: string } = {}): RenewalLivingFacts {
  const { step = "await_terms", runState = "waiting", ...rest } = over;
  return {
    item: { id: ID, title: "Renew Acme motor fleet", kind: "renewal", task_status: "with_party", task_party: "CIC", task_since: "2026-10-01", due_on: null, required_action: null, steps: [] } as unknown as RenewalLivingFacts["item"],
    client: { id: "33333333-3333-4333-8333-333333333333", name: "Acme Logistics" },
    period: { periodStart: "2025-11-01", periodEnd: "2026-10-31", insurerName: "CIC", policyNumber: "P-4471", classOfBusiness: "Motor fleet" },
    ownerName: "Wanjiru",
    run: {
      id: "44444444-4444-4444-8444-444444444444", state: runState, currentStep: step, approval: null, exception: null,
      permissions: { canApprove: true, canAct: true },
      operational: { status: "Waiting on insurers", currentWork: { title: "Awaiting insurer terms", detail: "Two insurers asked" }, completed: "Pack sent", needsFromYou: null, waitingFor: { party: "CIC", since: "2026-10-01" }, nextFollowUpAt: "2026-10-14", attentionReason: null, owner: { name: "Wanjiru" }, blockers: [] },
    } as unknown as RenewalLivingFacts["run"],
    opportunity: {
      opportunity: { id: "55555555-5555-4555-8555-555555555555", title: "Acme motor renewal" },
      insurers: [insurer("CIC", "with_insurer", null), insurer("Jubilee", "with_insurer", null)],
      next: null,
    } as unknown as RenewalLivingFacts["opportunity"],
    revisions: [], placement: null, issuance: null, recent: [], unavailable: [],
    ...rest,
  };
}

export const quotedOpp = () => ({ ...facts().opportunity!, insurers: [insurer("CIC", "quoted", "182000"), insurer("Jubilee", "quoted", "189000")] }) as unknown as RenewalLivingFacts["opportunity"];
export const placement = (coverState: string) => ({
  placement: { id: "66666666-6666-4666-8666-666666666666", requestedEffectiveAt: "2026-11-01" },
  insurer: { name: "Jubilee" },
  instruction: { instructedAt: "2026-10-05T09:00:00Z", evidence: { kind: "document", id: "77777777-7777-4777-8777-777777777777", label: "Client email" } },
  request: { approval: { approvedAt: "2026-10-06T09:00:00Z" }, submission: null },
  insurerResponse: null, cover: { state: coverState, line: "Requested from Jubilee — not confirmed." }, blockers: [], nextAction: "Send the approved request",
  workItem: { taskStatus: "needs_you", taskParty: null, taskSince: null }, drift: null,
}) as unknown as RenewalLivingFacts["placement"];


const DOC = "22222222-2222-4222-8222-222222222222";
const rev = (insurerName: string, n: number, amount: string, at: string) => ({ insurerName, revision: n, premiumAmount: amount, premiumCurrency: "KES", validUntil: "2026-11-01", outcome: "quoted", receivedAt: at, documentId: DOC });
const issuance = (stage: string, unresolved: number | null, coverState: string, line: string) =>
  ({
    stage,
    cover: { state: coverState, line },
    readiness: { state: "ready", reasons: [] },
    documents: stage === "not_ready" || stage === "ready" ? [] : [{ documentId: DOC, filename: "Jubilee policy schedule 2026.pdf", receivedAt: "2026-10-10T08:00:00Z" }],
    check: unresolved === null ? null : { unresolved },
  }) as unknown as RenewalLivingFacts["issuance"];

/** One renewal at every stage, for the UI Lab and its screenshots. */
export function labScenarios(): { key: string; label: string; facts: RenewalLivingFacts }[] {
  const confirmed = (state: string) => {
    const p = placement(state)!;
    return { ...p, insurerResponse: { receivedAt: "2026-10-08T09:00:00Z", outcome: "confirmed_as_requested" }, request: { approval: { approvedAt: "2026-10-06T09:00:00Z" }, submission: { sentAt: "2026-10-06T10:00:00Z" } }, cover: { state, line: state === "active" ? "Active with Jubilee from 1 Nov 2026 — confirmed in writing and policy applied." : "Confirmed by Jubilee in writing from 1 Nov 2026." }, workItem: { taskStatus: "with_party", taskParty: "Jubilee", taskSince: "2026-10-08" }, nextAction: "Wait for Jubilee to issue the policy document" } as unknown as RenewalLivingFacts["placement"];
  };
  return [
    { key: "preparing", label: "Preparing", facts: facts({ step: "approval", runState: "waiting_approval", opportunity: null }) },
    { key: "awaiting_terms", label: "Insurer terms", facts: facts() },
    { key: "comparing", label: "Comparing, with a revision", facts: facts({ step: "compare", runState: "running", opportunity: quotedOpp(), revisions: [rev("Jubilee", 1, "175500", "2026-10-01T10:00:00Z"), rev("Jubilee", 2, "189000", "2026-10-07T10:00:00Z"), rev("CIC", 1, "182000", "2026-10-02T10:00:00Z")] }) },
    { key: "placing", label: "Placement, revised after instruction", facts: facts({ step: "hand_over", runState: "done", opportunity: quotedOpp(), placement: placement("requested"), revisions: [rev("Jubilee", 1, "175500", "2026-10-01T10:00:00Z"), rev("Jubilee", 2, "189000", "2026-10-07T10:00:00Z")] }) },
    { key: "issuing", label: "Issuance, differences to resolve", facts: facts({ step: "hand_over", runState: "done", opportunity: quotedOpp(), placement: confirmed("confirmed"), issuance: issuance("differences_to_resolve", 2, "confirmed", "Confirmed by Jubilee in writing from 1 Nov 2026.") }) },
    { key: "verified", label: "Verified", facts: facts({ step: "hand_over", runState: "done", opportunity: quotedOpp(), placement: confirmed("active"), issuance: issuance("applied", 0, "active", "Active with Jubilee from 1 Nov 2026 — confirmed in writing and policy applied.") }) },
    { key: "stopped", label: "Stopped", facts: facts({ runState: "exception", opportunity: null, run: { ...facts().run!, state: "exception", exception: { message: "The client has no email address on file", needs: "Add the client's email so the renewal letter can be prepared." } } as unknown as RenewalLivingFacts["run"] }) },
  ];
}
