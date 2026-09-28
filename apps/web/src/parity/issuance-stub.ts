/**
 * Policy issuance, stubbed for the measuring harness (4B-5). Development only.
 *
 * One response per state the issuance Space passes through, so the capture can prove each reads
 * as what it is. Every name is an obvious placeholder: no fictional client, insurer or policy
 * belongs in this codebase. Every body is the endpoint's own shape, because `lib/api.ts` validates
 * it — a stub the API could not have produced would leave the screen loading.
 */
if (import.meta.env.PROD) throw new Error("the parity harness is a development tool");

const PLACEMENT = "40000000-0000-4000-8000-00000000000a";
const CLIENT = "20000000-0000-4000-8000-000000000001";
const INSURER = "21000000-0000-4000-8000-00000000000a";
const DOC = "3a000000-0000-4000-8000-0000000000b1";
const REQ1 = "48000000-0000-4000-8000-000000000001";
const REQ2 = "48000000-0000-4000-8000-000000000002";
const CHECK = "49000000-0000-4000-8000-00000000000a";

const ORDER = ["not_ready", "ready", "approval_required", "submission_required", "with_insurer", "review_required", "differences_to_resolve", "ready_to_apply", "applied"] as const;
type Stage = (typeof ORDER)[number];
const at = (s: Stage, min: Stage) => ORDER.indexOf(s) >= ORDER.indexOf(min);

const COPY: Record<string, [string, string, string, string, string]> = {
  issue_policy: ["prepare the issuance request", "Cover is confirmed and matches what the client accepted, so the insurer can be asked to issue the policy.", "Prepare the issuance request from the accepted basis and the cover confirmation.", "The client's instruction, the accepted basis and the insurer's cover confirmation — frozen into the request.", "The request needs approval by someone permitted before it is sent."],
  approve_issuance_request: ["approve the issuance request", "The issuance request is prepared, and nothing goes to the insurer without approval of this exact version.", "Read the request and approve it.", "The frozen request and its digest.", "Once approved, send it yourself and record how it was sent. A later change needs approving again."],
  submit_issuance_request: ["send the issuance request", "The request is approved but there is no evidence it reached the insurer. Sending from ASAP is not connected yet.", "Send the approved request yourself, then record how, to whom and when, with evidence.", "The sent message, or a note of when, from where and to whom.", "The work moves to the insurer until their policy document arrives."],
  obtain_issued_policy: ["obtain the issued policy", "The insurer has the issuance request and has not yet sent the policy document.", "Chase the insurer if it is late; record the policy document when it arrives.", "The insurer's policy schedule or policy document.", "What is read from it is reviewed by a person and checked against what was agreed."],
  review_issued_policy: ["review the issued policy", "The insurer's policy document has arrived. What was read from it has to be confirmed by a person and checked against what was agreed.", "Accept, correct or reject each value read from the document, then run the check.", "The policy document, at the page and place each value was read.", "Matching policies are ready to apply; differences are listed for a decision."],
  resolve_issued_policy_differences: ["resolve differences in the issued policy", "The issued policy differs from what the client accepted. The policy record is not written until each difference is decided.", "For each difference, record the client's acceptance of the issued value, or confirm it is immaterial, with evidence.", "The client's acceptance and how it arrived, or the reason the difference does not matter.", "Once every difference is resolved, the issued policy can be applied to the policy record."],
  apply_issued_policy: ["apply the issued policy", "The issued policy has been checked and every difference resolved. The policy record has not been written yet.", "Choose whether to create a policy or update a named one, preview the change, and apply it.", "The reviewed policy document and the check.", "The policy and its period are written once, with the evidence linked, and this work closes."],
};
const REASON: Record<Stage, string | null> = {
  not_ready: null, ready: "issue_policy", approval_required: "approve_issuance_request", submission_required: "submit_issuance_request",
  with_insurer: "obtain_issued_policy", review_required: "review_issued_policy", differences_to_resolve: "resolve_issued_policy_differences",
  ready_to_apply: "apply_issued_policy", applied: null,
};
const NEXT: Record<Stage, string> = {
  not_ready: "Resolve what blocks issuance on the placement first.",
  ready: "Prepare the issuance request.",
  approval_required: "Approve the current version of the issuance request.",
  submission_required: "Send the approved request yourself, then record how it was sent.",
  with_insurer: "Record the insurer's policy document when it arrives.",
  review_required: "Review what was read from the policy document, then check it against what was agreed.",
  differences_to_resolve: "Resolve each difference with a reason and evidence.",
  ready_to_apply: "Preview, then apply the issued policy to the policy record.",
  applied: "Nothing further: the policy record was written from the issued policy.",
};

/** `stage` values the capture photographs, mapped to the derived stage and a variation. */
const STAGES: Record<string, { stage: Stage; variant?: string }> = {
  "not-ready": { stage: "not_ready" },
  ready: { stage: "ready" },
  draft: { stage: "approval_required" },
  superseded: { stage: "approval_required", variant: "superseded" },
  approved: { stage: "submission_required" },
  "with-insurer": { stage: "with_insurer" },
  received: { stage: "review_required" },
  reviewed: { stage: "review_required", variant: "reviewed" },
  stale: { stage: "review_required", variant: "stale" },
  conflict: { stage: "differences_to_resolve" },
  resolved: { stage: "ready_to_apply", variant: "resolved" },
  "ready-to-apply": { stage: "ready_to_apply" },
  "missing-info": { stage: "ready_to_apply", variant: "missing" },
  "prepared-apply": { stage: "ready_to_apply", variant: "prepared" },
  applied: { stage: "applied" },
};

// Harness-only: plain objects shaped to the contract, adjusted per photographed state.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function issuanceStub(asked: string, perms: string | null): any {
  const { stage, variant } = STAGES[asked] ?? { stage: "ready" as Stage };
  const officer = perms === "officer";
  const changed = stage === "differences_to_resolve" || variant === "resolved";
  const reason = REASON[stage];
  const withInsurer = stage === "with_insurer";
  const copy = reason ? COPY[reason]! : null;
  const region = (i: number) => ({ x: 72, y: 140 + i * 26, width: 260, height: 18 });
  const ev = (page: number, i: number, kind = "field", id = `4d000000-0000-4000-8000-00000000000${i}`) =>
    ({ documentId: DOC, page, region: region(i), path: `/documents/${DOC}?page=${page}&${kind}=${id}` });
  const reviewed = at(stage, "differences_to_resolve") || variant === "reviewed" || variant === "stale";
  const fieldRows: [string, string, number][] = [
    ["insured_name", "Placeholder Company", 1], ["insurer_name", "Placeholder Insurer", 1], ["policy_number", "PH/MTR/0001", 1],
    ["class_of_business", "Commercial motor", 1], ["period_start", "2026-10-01", 1], ["period_end", variant === "missing" ? "" : "2027-09-30", 1],
    ["currency", "KES", 2], ["premium", "5,310,000.00", 2],
  ];
  const fields = fieldRows.map(([key, value, page], i) => ({
    id: `4d000000-0000-4000-8000-00000000000${i}`, key, proposedValue: value === "" ? null : value, correctedValue: null,
    state: reviewed ? (value === "" ? "rejected" : "accepted") : "proposed", condition: reviewed ? "known" : "inferred", evidence: ev(page, i),
  }));
  const terms = [{
    id: "4e000000-0000-4000-8000-000000000001", termType: "excess", label: "Own damage",
    proposedValue: changed ? "7.5% of claim, minimum KES 45,000" : "5% of claim, minimum KES 30,000", correctedValue: null,
    state: reviewed ? "accepted" : "proposed", reviewedFor: "issued_policy", evidence: ev(3, 9, "term", "4e000000-0000-4000-8000-000000000001"),
  }];
  const item = (id: number, field: string, label: string, basis: string | null, conf: string | null, issued: string | null, classification: string, words: string, material: boolean, e: unknown, calculation: string | null = null) => ({
    id: `4f000000-0000-4000-8000-00000000000${id}`, field, termType: field === "term" ? "excess" : null, label, instructionValue: null,
    basisValue: basis, confirmationValue: conf, issuedValue: issued, classification, classificationWords: words, material, calculation, evidence: e,
    resolution: variant === "resolved" && material ? {
      resolution: "client_accepted_issued_value", reason: "The client accepted the higher own-damage excess on the issued policy.",
      evidence: { kind: "note", id: null, label: "Client's finance director replied by email at 10:00 on 16 September.", path: null },
      resolvedByName: "Parity Harness", resolvedAt: "2026-09-16T10:00:00.000Z",
    } : null,
  });
  const items = [
    item(1, "insured", "Insured", "Placeholder Company", null, "Placeholder Company", "match", "Matches", false, ev(1, 0)),
    item(2, "insurer", "Insurer", "Placeholder Insurer", "Placeholder Insurer", "Placeholder Insurer", "match", "Matches", false, ev(1, 1)),
    item(3, "policy_number", "Policy number", null, null, "PH/MTR/0001", "added_by_insurer", "Added by insurer", false, ev(1, 2)),
    item(4, "inception", "Cover begins", "2026-10-01", "2026-10-01", "2026-10-01", "match", "Matches", false, ev(1, 4)),
    item(5, "expiry", "Cover ends", "2027-09-30", "2027-09-30", "2027-09-30", "match", "Matches", false, ev(1, 5), "Cover begins 1 Oct 2026 + 12 months = 30 Sept 2027, from the cover period in the client's accepted instruction."),
    item(6, "premium", "Premium", "5310000.00", "5310000.00", "5,310,000.00", "match", "Matches", false, ev(2, 7)),
    item(7, "sum_insured", "Sum insured", null, null, null, "not_applicable", "Not stated in either source", false, null),
    item(8, "term", "Own damage", "5% of claim, minimum KES 30,000", "5% of claim, minimum KES 30,000", changed ? "7.5% of claim, minimum KES 45,000" : "5% of claim, minimum KES 30,000", changed ? "changed" : "match", changed ? "Changed" : "Matches", changed, ev(3, 9, "term", "4e000000-0000-4000-8000-000000000001")),
  ];
  const hasCheck = at(stage, "differences_to_resolve") || variant === "stale";
  const payload = (docs: string[]) => ({
    clientName: "Placeholder Company", insurerName: "Placeholder Insurer", classOfBusiness: "Commercial motor", placementId: PLACEMENT,
    clientInstructionId: "41000000-0000-4000-8000-00000000000a", basisVersion: 1, quoteResponseId: "34000000-0000-4000-8000-00000000000a",
    quoteRevisionId: null, comparisonVersion: 1, coverConfirmationId: "43000000-0000-4000-8000-00000000000a", coverConfirmationReference: "CN-2027-0041",
    requestedPolicyNumber: null, inception: "2026-10-01T00:00:00+00:00", end: "2027-09-30T00:00:00+00:00", endBasis: "The end date the client accepted.",
    premiumAmount: "5310000.00", premiumCurrency: "KES", premiumBasis: null,
    terms: [{ termType: "excess", label: "Own damage", value: "5% of claim, minimum KES 30,000" }], conditions: [], requiredDocuments: docs,
    subject: "Policy issuance — Placeholder Company — Commercial motor",
    body: `Dear Underwriter,\n\nFurther to your cover confirmation CN-2027-0041, please issue the policy for Placeholder Company.\nCover from 1 Oct 2026 to 30 Sept 2027. Premium: KES 5,310,000.\nPlease send: ${docs.join(", ")}.\n\nKind regards`,
    evidence: ["Client instruction", "Accepted basis version 1", "Cover confirmation CN-2027-0041"], sourceVersions: {},
  });
  const approved = at(stage, "submission_required");
  const sent = at(stage, "with_insurer");
  const applied = stage === "applied";
  const unresolved = stage === "differences_to_resolve" ? 1 : 0;
  const blockers = stage === "not_ready" ? ["The insurer has not confirmed cover."]
    : stage === "review_required" && !reviewed ? ["Some values read from the policy document have not been reviewed."]
    : variant === "stale" ? ["The check is out of date: The reading of the policy document was reviewed again since this check."]
    : variant === "reviewed" ? ["The policy document has been reviewed but not yet checked against what was agreed."]
    : stage === "differences_to_resolve" ? ["The issued policy differs from what was agreed: Own damage. Each needs a decision with evidence before the policy record can be written. Cover remains in force meanwhile."]
    : [];

  return {
    placement: { id: PLACEMENT, title: "Placeholder Company motor fleet placement — 2027" },
    client: { id: CLIENT, name: "Placeholder Company" },
    insurer: { id: INSURER, name: "Placeholder Insurer" },
    stage,
    cover: stage === "not_ready" ? { state: "submitted", line: "Sent to Placeholder Insurer on 8 Sept 2026. Not confirmed — there is no cover yet." } : { state: "active", line: "Cover began 1 Oct 2026, until 30 Sept 2027." },
    readiness: stage === "not_ready" ? { state: "blocked", reasons: [{ code: "not_confirmed", message: "The insurer has not confirmed cover." }] } : { state: "ready", reasons: [] },
    request: at(stage, "approval_required") ? {
      id: variant === "superseded" ? REQ2 : REQ1, version: variant === "superseded" ? 2 : 1, sha256: "c4f1".padEnd(64, "0"),
      payload: payload(variant === "superseded" ? ["Policy schedule", "Motor certificates"] : ["Policy schedule"]),
      preparedAt: "2026-09-11T09:00:00.000Z", preparedByName: "Parity Harness",
      approval: approved ? { approvedByName: "Parity Harness", approvedAt: "2026-09-11T10:00:00.000Z" } : null,
      submission: sent ? {
        method: "recorded_manual_email", recipient: "policy@placeholder-insurer.test", sentAt: "2026-09-12T08:30:00.000Z", providerMessageId: null,
        evidence: { kind: "note", id: null, label: "Sent from my mailbox at 08:30 on 12 September to the policy desk.", path: null }, recordedByName: "Parity Harness",
      } : null,
    } : null,
    requestHistory: variant === "superseded" ? [{ version: 1, preparedAt: "2026-09-11T09:00:00.000Z", approvedAt: "2026-09-11T10:00:00.000Z", supersededAt: "2026-09-11T11:00:00.000Z", supersededReason: "A newer version of this request was prepared." }] : [],
    documents: at(stage, "review_required") ? [{ id: "4c100000-0000-4000-8000-00000000000a", documentId: DOC, filename: "Placeholder policy schedule.pdf", receivedAt: "2026-09-15T09:00:00.000Z", extractionState: "extracted", fields, terms, reviewComplete: reviewed }] : [],
    check: hasCheck ? {
      id: CHECK, current: variant !== "stale", staleReason: variant === "stale" ? "The reading of the policy document was reviewed again since this check." : null,
      comparedAt: "2026-09-15T10:00:00.000Z", comparedByName: "Parity Harness", materialDifferences: changed ? 1 : 0, unresolved, items,
    } : null,
    application: applied ? {
      id: "4c200000-0000-4000-8000-00000000000a", targetMode: "create", policyId: "4a000000-0000-4000-8000-00000000000a", policyPeriodId: "4b000000-0000-4000-8000-00000000000a",
      policyNumber: "PH/MTR/0001", periodStart: "2026-10-01", periodEnd: "2027-09-30", appliedAt: "2026-09-16T11:00:00.000Z", appliedByName: "Parity Harness",
      changes: [], links: {
        placementId: PLACEMENT, clientInstructionId: "41000000-0000-4000-8000-00000000000a", basisVersionId: "41100000-0000-4000-8000-00000000000a",
        insurerResponseId: "34000000-0000-4000-8000-00000000000a", coverConfirmationId: "43000000-0000-4000-8000-00000000000a", documentId: DOC,
        issuedPolicyCheckId: CHECK, issuanceRequestId: REQ1,
      },
    } : null,
    candidates: [{ policyId: "4a000000-0000-4000-8000-0000000000b0", periodId: "4b000000-0000-4000-8000-0000000000b0", policyNumber: "PH/MTR/OLD", periodStart: "2025-10-01", periodEnd: "2026-09-30", insurerName: "Placeholder Insurer" }],
    documentOptions: withInsurer ? [{ id: DOC, filename: "Placeholder policy schedule.pdf", kind: "policy_schedule", createdAt: "2026-09-15T08:55:00.000Z" }] : [],
    work: reason && copy ? [{
      id: "26000000-0000-4000-8000-0000000000e1", reason, headline: copy[0], why: copy[1], action: copy[2], evidence: copy[3], after: copy[4],
      taskStatus: withInsurer ? "with_party" : "needs_you", taskParty: withInsurer ? "Placeholder Insurer" : null,
      taskSince: withInsurer ? "2026-09-12T08:30:00.000Z" : null, taskNextCheck: null, ownerName: null,
    }] : [],
    blockers,
    nextAction: NEXT[stage],
    permissions: { canPrepare: true, canApprove: !officer, canSubmit: true, canApply: !officer },
    sending: { available: false, reason: "Sending from ASAP is not connected yet. Send the approved request yourself, then record how, to whom and when." },
    preparedActions: variant === "prepared" ? [{
      id: "46000000-0000-4000-8000-0000000000b1", actionType: "apply_issued_policy", placementId: PLACEMENT, opportunityId: null,
      summary: "Create the policy from the issued policy",
      changes: ["Create the policy from the issued policy", "Policy number: — → PH/MTR/0001", "Cover begins: — → 2026-10-01", "Cover ends: — → 2027-09-30", "Written once, with the policy document and the check linked. The Work closes."],
      blockers: [], permitted: !officer, requiresConfirmation: true, state: "prepared",
      preparedAt: "2026-09-16T10:30:00.000Z", expiresAt: "2026-09-17T10:30:00.000Z", preparedByName: "Parity Harness", receipt: null,
    }] : [],
  };
}

/** What the server's preview would say for the photographed state. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function issuancePreviewStub(asked: string, body: { mode?: string; premiumBasis?: string }): any {
  const missing = asked === "missing-info";
  const e = (page: number, i: number) => ({ documentId: DOC, page, region: { x: 72, y: 140 + i * 26, width: 260, height: 18 }, path: `/documents/${DOC}?page=${page}` });
  const blocked = [
    ...(missing ? ["The policy document's period was not read. Correct the reading first."] : []),
    ...(body.premiumBasis ? [] : ["Say whether the issued premium is the gross premium or the total payable. The document does not decide it."]),
  ];
  const update = body.mode === "update";
  return {
    target: { mode: update ? "update" : "create", policyId: update ? "4a000000-0000-4000-8000-0000000000b0" : null, periodId: update ? "4b000000-0000-4000-8000-0000000000b0" : null, label: update ? "Policy PH/MTR/OLD with Placeholder Insurer, period 1 Oct 2025 to 30 Sept 2026" : "A new policy and its first period" },
    rows: [
      { field: "policy_number", label: "Policy number", current: update ? "PH/MTR/OLD" : null, issued: "PH/MTR/0001", accepted: null, evidence: e(1, 2), status: "will_change", note: null },
      { field: "period_start", label: "Cover begins", current: update ? "2025-10-01" : null, issued: "2026-10-01", accepted: "2026-10-01", evidence: e(1, 4), status: "will_change", note: null },
      { field: "period_end", label: "Cover ends", current: update ? "2026-09-30" : null, issued: missing ? null : "2027-09-30", accepted: "2027-09-30", evidence: missing ? null : e(1, 5), status: missing ? "blocked" : "will_change", note: missing ? "Not read from the policy document." : null },
      { field: "premium", label: "Premium", current: null, issued: "5,310,000.00", accepted: "5310000.00", evidence: e(2, 7), status: "will_change", note: null },
      { field: "currency", label: "Currency", current: null, issued: "KES", accepted: "KES", evidence: e(2, 6), status: "will_change", note: null },
    ],
    conflicts: [],
    blocked,
    expected: { policy_number: update ? "PH/MTR/OLD" : null, period_start: update ? "2025-10-01" : null, period_end: update ? "2026-09-30" : null, premium: null },
    canApply: blocked.length === 0,
  };
}
