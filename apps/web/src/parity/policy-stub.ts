/**
 * The Policy Space, stubbed for the measuring harness (4C-1). Development only.
 *
 * One `GET /policies/:id/space` response per state the capture photographs. Every name is an obvious
 * placeholder, and every body is the endpoint's own shape — `lib/api.ts` validates it, so a stub
 * the API could not produce would leave the screen loading and the capture would fail.
 */
if (import.meta.env.PROD) throw new Error("the parity harness is a development tool");

const POLICY = "4a000000-0000-4000-8000-0000000000c1";
const CLIENT = "20000000-0000-4000-8000-000000000001";
const INSURER = "21000000-0000-4000-8000-00000000000a";
const PLACEMENT = "40000000-0000-4000-8000-00000000000a";
const DOC = "3a000000-0000-4000-8000-0000000000c1";
const P = (n: number) => `4b000000-0000-4000-8000-0000000000c${n}`;

// Harness-only: plain objects shaped to the contract, adjusted per photographed state.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const ev = (kind: string, label: string, extra: Partial<Any> = {}) => ({ kind, label, documentId: null, page: null, region: null, path: null, recordedByName: "Parity Harness", recordedAt: "2026-09-16T11:00:00.000Z", ...extra });
const docEv = (page: number, i: number, fieldNo: number, label = "Placeholder policy schedule.pdf") =>
  ev("issued_document", `${label}, page ${page}`, { documentId: DOC, page, region: { x: 72, y: 120 + i * 24, width: 260, height: 18 }, path: `/documents/${DOC}?page=${page}&field=4d000000-0000-4000-8000-00000000000${fieldNo}`, recordedByName: null, recordedAt: null });
const COVER_EVIDENCE = [
  ev("cover_confirmation", "Placeholder Insurer confirmed cover (CN-2027-0041), received 9 Sept 2026", { path: `/placements/${PLACEMENT}` }),
  ev("issued_document", "The insurer's issued policy: Placeholder policy schedule.pdf, reviewed and applied", { documentId: DOC, path: `/documents/${DOC}` }),
  ev("issuance_application", "The issuance receipt: the policy record written from the checked policy", { path: `/placements/${PLACEMENT}/issuance` }),
];
const cover = (state: string | null, label: string, reason: string, verified: boolean, evidence: Any[] = verified ? COVER_EVIDENCE : []) => ({ state, label, reason, verified, evidence, asOf: "2026-09-28" });
const ACTIVE = cover("active", "Active cover", "On cover 1 Oct 2025 to 30 Sept 2026, on the evidence linked.", true);

function period(n: number, start: string, end: string, c: Any, extra: Partial<Any> = {}) {
  return { id: P(n), start, end, cover: c, origin: "issuance", when: "current", overlapsWith: [], premium: { amount: "5310000.00", currency: "KES", basis: "gross", source: "extracted_accepted" }, createdAt: "2026-09-16T11:00:00.000Z", ...extra };
}

/** A second policy id, so two Policy Spaces can be open at once and their identities compared. */
export const SECOND_POLICY = "4a000000-0000-4000-8000-0000000000c2";

export function policyStub(asked: string, id: string = POLICY): { status: number; body: Any } {
  const r = policyStubFor(asked);
  if (id === SECOND_POLICY && r.status === 200) {
    return { status: 200, body: { ...r.body, policy: { ...r.body.policy, id: SECOND_POLICY }, title: "Fire — Second Placeholder Company · FIRE/0002", client: { ...r.body.client, name: "Second Placeholder Company" } } };
  }
  return r;
}

function policyStubFor(asked: string): { status: number; body: Any } {
  if (asked === "not-found") return { status: 404, body: { error: "not_found", message: "No policy with that id" } };
  if (asked === "refused") return { status: 403, body: { error: "forbidden", message: "You may not view policies." } };

  const facts: Any[] = [
    { key: "insured", label: "Insured", value: "Placeholder Company", source: "extracted_accepted", evidence: docEv(1, 0, 0), note: null },
    { key: "insurer", label: "Insurer", value: "Placeholder Insurer", source: "extracted_accepted", evidence: docEv(1, 1, 1), note: null },
    { key: "policy_number", label: "Policy number", value: "PH/MTR/0001", source: "extracted_accepted", evidence: docEv(1, 2, 2), note: null },
    { key: "class", label: "Class of business", value: "Commercial motor", source: "extracted_accepted", evidence: docEv(1, 3, 3), note: null },
    { key: "inception", label: "Cover begins", value: "2025-10-01", source: "extracted_accepted", evidence: docEv(1, 4, 4), note: null },
    { key: "expiry", label: "Cover ends", value: "2026-09-30", source: "extracted_accepted", evidence: docEv(1, 5, 5), note: null },
    { key: "premium", label: "Premium", value: "KES 5,310,000", source: "extracted_accepted", evidence: docEv(2, 7, 7), note: "Recorded premium. Whether it has been paid is not known here." },
    { key: "currency", label: "Currency", value: "KES", source: "extracted_accepted", evidence: docEv(2, 6, 6), note: null },
    { key: "premium_basis", label: "Premium basis", value: "Gross premium", source: "manually_recorded", evidence: null, note: "Stated by a person when the premium was recorded; a document does not decide it." },
    { key: "sum_insured", label: "Sum insured", value: null, source: "missing", evidence: null, note: "No sum insured is recorded for this period." },
  ];
  const terms: Any[] = [
    { termType: "excess", label: "Own damage", agreed: "5% of claim, minimum KES 30,000", confirmed: "5% of claim, minimum KES 30,000", issued: "7.5% of claim, minimum KES 45,000", final: "7.5% of claim, minimum KES 45,000", source: "extracted_accepted", evidence: docEv(3, 9, 9), difference: { words: "Changed", resolved: true, resolution: "The client accepted the higher own-damage excess (Parity Harness, 16 Sept 2026)" } },
    { termType: "limit", label: "Third party property damage", agreed: "KES 20,000,000", confirmed: "KES 20,000,000", issued: "KES 20,000,000", final: "KES 20,000,000", source: "extracted_accepted", evidence: docEv(3, 10, 8), difference: null },
    { termType: "exclusion", label: "Riot and strike", agreed: null, confirmed: null, issued: "Excluded", final: "Excluded", source: "extracted_accepted", evidence: docEv(3, 11, 8), difference: { words: "Added by insurer", resolved: true, resolution: "Not material." } },
  ];
  const differences: Any[] = [
    { label: "Own damage", words: "Changed", agreed: "5% of claim, minimum KES 30,000", confirmed: "5% of claim, minimum KES 30,000", issued: "7.5% of claim, minimum KES 45,000", resolved: true, resolution: "The client accepted the higher own-damage excess — Parity Harness, 16 Sept 2026" },
  ];
  const timeline: Any[] = [
    { id: "opp", at: "2026-08-20T09:00:00.000Z", text: "Quotation work opened: Placeholder Company motor fleet quotation — 2026", tone: "neutral", path: "/opportunities/30000000-0000-4000-8000-00000000000a" },
    { id: "instr", at: "2026-09-07T10:40:00.000Z", text: "The client chose Placeholder Insurer from comparison version 1.", tone: "active", path: `/placements/${PLACEMENT}` },
    { id: "p-conf", at: "2026-09-09T14:10:00.000Z", text: "Placeholder Insurer: cover confirmed as requested.", tone: "done", path: `/placements/${PLACEMENT}` },
    { id: "i-sent", at: "2026-09-12T08:30:00.000Z", text: "Issuance request sent to policy@placeholder-insurer.test, recorded by Parity Harness.", tone: "active", path: `/placements/${PLACEMENT}/issuance` },
    { id: "i-doc", at: "2026-09-15T09:00:00.000Z", text: "Placeholder Insurer's policy document received: Placeholder policy schedule.pdf.", tone: "active", path: `/documents/${DOC}` },
    { id: "apply", at: "2026-09-16T11:00:00.000Z", text: "Policy record created from the issued policy by Parity Harness.", tone: "done", path: `/placements/${PLACEMENT}/issuance` },
  ];
  const actions = (over: Partial<Record<string, Partial<Any>>> = {}): Any[] => [
    { key: "start_renewal", label: "Start renewal", available: true, reason: null, path: null },
    { key: "report_claim", label: "Report claim", available: true, reason: null, path: `/new/claim?policy=${POLICY}&period=${P(1)}` },
    { key: "request_endorsement", label: "Request endorsement", available: true, reason: null, path: `/new/endorsement?policy=${POLICY}&period=${P(1)}` },
    { key: "open_servicing", label: "Open servicing work", available: false, reason: "Servicing work is not built yet; it arrives in a later stage of 4C.", path: null },
    { key: "review_documents", label: "Review documents", available: true, reason: null, path: `/documents/${DOC}` },
    { key: "open_client", label: "Open client", available: true, reason: null, path: `/clients/${CLIENT}` },
    { key: "open_placement", label: "Open placement", available: true, reason: null, path: `/placements/${PLACEMENT}` },
    { key: "open_issuance", label: "Open issuance receipt", available: true, reason: null, path: `/placements/${PLACEMENT}/issuance` },
  ].map((a) => ({ ...a, ...(over[a.key] ?? {}) }));

  const base: Any = {
    policy: { id: POLICY, classOfBusiness: "Commercial motor", createdAt: "2026-09-16T11:00:00.000Z" },
    title: "Commercial motor — Placeholder Company · PH/MTR/0001",
    client: { id: CLIENT, name: "Placeholder Company" },
    insurer: { id: INSURER, name: "Placeholder Insurer" },
    periods: [period(1, "2025-10-01", "2026-09-30", ACTIVE)],
    selectedPeriodId: P(1), selection: "current", cover: ACTIVE, conflicts: [],
    facts, terms, clientConditions: [{ text: "Subject to a satisfactory motor inspection", state: "satisfied", evidence: "Assessor's report dated 11 September, filed." }],
    differences,
    issuance: {
      placementId: PLACEMENT, applicationId: "4c200000-0000-4000-8000-00000000000a", appliedAt: "2026-09-16T11:00:00.000Z", appliedByName: "Parity Harness", targetMode: "create",
      links: { clientInstructionId: "41000000-0000-4000-8000-00000000000a", opportunityId: "30000000-0000-4000-8000-00000000000a", comparisonVersion: 1, insurerResponseId: "34000000-0000-4000-8000-00000000000a", coverConfirmationId: "43000000-0000-4000-8000-00000000000a", documentId: DOC, issuedPolicyCheckId: "49000000-0000-4000-8000-00000000000a", issuanceRequestId: "48000000-0000-4000-8000-000000000001" },
    },
    documents: [{ id: DOC, filename: "Placeholder policy schedule.pdf", kind: "policy_schedule", extractionState: "extracted", role: "Issued policy", path: `/documents/${DOC}` }],
    timeline, work: [],
    related: [
      { kind: "client", id: CLIENT, title: "Placeholder Company", path: `/clients/${CLIENT}` },
      { kind: "placement", id: PLACEMENT, title: "Placeholder Company motor fleet placement — 2026", path: `/placements/${PLACEMENT}` },
      { kind: "issuance", id: PLACEMENT, title: "Issuance receipt", path: `/placements/${PLACEMENT}/issuance` },
      { kind: "quotation", id: "30000000-0000-4000-8000-00000000000a", title: "Placeholder Company motor fleet quotation — 2026", path: "/opportunities/30000000-0000-4000-8000-00000000000a" },
    ],
    actions: actions(),
    gaps: ["Sum insured: not recorded.", "Endorsements affecting a period: none are applied to a period yet — endorsements arrive in a later stage."],
    money: { statement: "Premium is shown as recorded. No invoice or payment is recorded here, so whether it has been paid is not known. Money arrives in a later stage." },
    permissions: { canStartWork: true, canEdit: true },
    preparedActions: [],
  };

  const legacyFacts = (number: string | null) => [
    { key: "insured", label: "Insured", value: "Placeholder Company", source: "manually_recorded", evidence: null, note: null },
    { key: "insurer", label: "Insurer", value: "Placeholder Insurer", source: "manually_recorded", evidence: null, note: null },
    { key: "policy_number", label: "Policy number", value: number, source: number ? "unverified" : "missing", evidence: null, note: number ? null : "No policy number is recorded. A policy number on its own would not prove cover." },
    { key: "class", label: "Class of business", value: "Fire", source: "unverified", evidence: null, note: null },
    { key: "inception", label: "Cover begins", value: "2026-01-01", source: "unverified", evidence: null, note: null },
    { key: "expiry", label: "Cover ends", value: "2026-12-31", source: "unverified", evidence: null, note: null },
    { key: "premium", label: "Premium", value: null, source: "missing", evidence: null, note: "No premium is recorded for this period." },
    { key: "currency", label: "Currency", value: null, source: "missing", evidence: null, note: null },
    { key: "premium_basis", label: "Premium basis", value: null, source: "missing", evidence: null, note: null },
    { key: "sum_insured", label: "Sum insured", value: null, source: "missing", evidence: null, note: "No sum insured is recorded for this period." },
  ];
  const legacy = (number: string | null): Any => ({
    ...base,
    title: `Fire — Placeholder Company${number ? ` · ${number}` : ""}`,
    policy: { ...base.policy, classOfBusiness: "Fire" },
    periods: [period(1, "2026-01-01", "2026-12-31", cover(null, "Cover not verified", "The period 1 Jan 2026 to 31 Dec 2026 is on file, but nothing on file confirms the insurer put it on cover: no insurer confirmation and no reviewed policy document. Dates alone are not cover.", false), { origin: "manual", premium: { amount: null, currency: null, basis: null, source: "missing" } })],
    cover: cover(null, "Cover not verified", "The period 1 Jan 2026 to 31 Dec 2026 is on file, but nothing on file confirms the insurer put it on cover: no insurer confirmation and no reviewed policy document. Dates alone are not cover.", false),
    facts: legacyFacts(number), terms: [], differences: [], clientConditions: [], issuance: null, documents: [],
    timeline: [{ id: "created", at: "2026-01-05T09:00:00.000Z", text: "Policy put on file.", tone: "neutral", path: null }],
    related: [{ kind: "client", id: CLIENT, title: "Placeholder Company", path: `/clients/${CLIENT}` }],
    actions: actions({ open_placement: { available: false, reason: "This policy was not placed through ASAP, so there is no placement to open.", path: null }, open_issuance: { available: false, reason: "No issuance receipt: this policy was recorded directly.", path: null }, review_documents: { available: false, reason: "No document is linked to this policy yet.", path: null } }),
    gaps: [...(number ? [] : ["Policy number: not recorded."]), "Premium: not recorded.", "Sum insured: not recorded.", "No coverage terms (limits, excesses, exclusions, conditions) are recorded for this policy.", "Cover has not been verified: no insurer confirmation or reviewed policy document is linked."],
  });

  switch (asked) {
    case "future": {
      const c = cover("confirmed", "Confirmed", "Confirmed on evidence, beginning 1 Oct 2026. It has not started yet.", true);
      return { status: 200, body: { ...base, periods: [period(1, "2026-10-01", "2027-09-30", c, { when: "future" })], selection: "upcoming", cover: c } };
    }
    case "expired": {
      const c = cover("expired", "Expired", "The verified period 1 Oct 2024 to 30 Sept 2025 has ended.", true);
      return { status: 200, body: { ...base, periods: [period(1, "2024-10-01", "2025-09-30", c, { when: "past" })], selection: "latest", cover: c, timeline: [...timeline, { id: "exp", at: "2025-09-30T21:00:00Z", text: "Period 1 Oct 2024 to 30 Sept 2025 ended.", tone: "neutral", path: null }] } };
    }
    case "cancelled": {
      const c = cover("cancelled", "Cancelled", "Cancelled with effect from 20 Sept 2026, on recorded evidence.", true, [ev("cancellation", "Cancellation recorded: The client sold the fleet and asked for cancellation.", { path: `/placements/${PLACEMENT}` }), ...COVER_EVIDENCE]);
      return { status: 200, body: { ...base, periods: [period(1, "2025-10-01", "2026-09-30", c)], cover: c, timeline: [...timeline, { id: "cancel", at: "2026-09-20T09:00:00.000Z", text: "Cancellation recorded: The client sold the fleet and asked for cancellation.", tone: "attention", path: `/placements/${PLACEMENT}` }] } };
    }
    case "legacy": return { status: 200, body: legacy("FIRE/OLD/7") };
    case "missing-number": return { status: 200, body: legacy(null) };
    case "missing-term": return { status: 200, body: { ...base, terms: [], differences: [], gaps: [...base.gaps, "No coverage terms (limits, excesses, exclusions, conditions) are recorded for this policy."] } };
    case "history": {
      const e1 = cover("expired", "Expired", "The verified period 1 Oct 2023 to 30 Sept 2024 has ended.", true);
      const e2 = cover(null, "Cover not verified", "The period 1 Oct 2024 to 30 Sept 2025 is on file, but nothing on file confirms the insurer put it on cover. Dates alone are not cover.", false);
      return { status: 200, body: { ...base, periods: [period(2, "2023-10-01", "2024-09-30", e1, { when: "past", origin: "document" }), period(3, "2024-10-01", "2025-09-30", e2, { when: "past", origin: "manual" }), period(1, "2025-10-01", "2026-09-30", ACTIVE)] } };
    }
    case "conflict": {
      const c = cover(null, "Two periods both cover today", "2 periods on this policy each cover 28 Sept 2026. Cover is not stated until a person settles which period is right.", false);
      const l = legacy("MAR/EV/1");
      return {
        status: 200, body: {
          ...l, title: "Marine — Placeholder Company · MAR/EV/1", selectedPeriodId: null, selection: "none", cover: c,
          periods: [period(1, "2026-01-01", "2026-12-31", l.periods[0].cover, { origin: "manual", overlapsWith: [P(2)], premium: l.periods[0].premium }), period(2, "2026-03-01", "2027-02-28", l.periods[0].cover, { origin: "manual", overlapsWith: [P(1)], premium: l.periods[0].premium })],
          conflicts: [{ kind: "overlapping_periods", periodIds: [P(1), P(2)], message: "These periods overlap: 1 Jan 2026 to 31 Dec 2026; 1 Mar 2026 to 28 Feb 2027. Only one period can be on cover for any day. Neither is chosen until a person settles which is right." }],
          facts: legacyFacts("MAR/EV/1").map((f) => (f.key === "inception" || f.key === "expiry" ? { ...f, value: null, source: "missing", note: "Choose a period to read." } : f)),
          work: [{ id: "26000000-0000-4000-8000-0000000000c9", title: "Placeholder Company — Marine MAR/EV/1 — settle overlapping periods", kind: "exception", taskStatus: "needs_you", taskParty: null, taskSince: null, reason: "Two periods on this policy overlap. Only one can be on cover for any day, and ASAP does not choose.", requiredAction: "Check the insurer's documents and correct the period that is wrong.", evidenceNeeded: "The insurer's schedule or confirmation for each period.", outcomeAfter: "The policy states its cover again once one period covers each day.", path: `/policies/${POLICY}` }],
          gaps: [...l.gaps.filter((g: string) => !g.startsWith("Cover has not")), "Choose a period to read: the periods overlap, and ASAP does not choose one."],
        },
      };
    }
    case "corrected": {
      const f = facts.map((x) => (x.key === "policy_number" ? { ...x, value: "PH/MTR/0001-A", source: "corrected", evidence: { ...x.evidence, label: "Placeholder policy schedule.pdf, page 1 — read as PH/MTR/0001, corrected by a person" } } : x));
      return { status: 200, body: { ...base, title: "Commercial motor — Placeholder Company · PH/MTR/0001-A", facts: f } };
    }
    case "difference": {
      const t = terms.map((x) => (x.label === "Own damage" ? { ...x, source: "conflicting", difference: { words: "Changed", resolved: false, resolution: null } } : x));
      const f = facts.map((x) => (x.key === "expiry" ? { ...x, source: "conflicting", note: "The issued policy's end date differs from what was agreed and is not yet resolved." } : x));
      return { status: 200, body: { ...base, terms: t, facts: f, differences: [{ ...differences[0], resolved: false, resolution: null }, { label: "Cover ends", words: "Needs a person to check", agreed: "2026-10-01", confirmed: "2026-10-01", issued: "2026-09-30", resolved: false, resolution: null }] } };
    }
    case "work": {
      return {
        status: 200, body: {
          ...base,
          work: [
            { id: "26000000-0000-4000-8000-0000000000ca", title: "Placeholder Company — renewal, Commercial motor PH/MTR/0001", kind: "renewal", taskStatus: "with_party", taskParty: "Placeholder Insurer", taskSince: "2026-09-20T09:00:00.000Z", reason: "Renewal terms were requested from Placeholder Insurer.", requiredAction: "Chase the insurer if terms are late.", evidenceNeeded: "The insurer's renewal terms.", outcomeAfter: "The terms are compared with the expiring year.", path: "/r/26000000-0000-4000-8000-0000000000ca" },
          ],
          actions: actions({ start_renewal: { label: "Open the renewal", path: "/r/26000000-0000-4000-8000-0000000000ca" } }),
          related: [...base.related, { kind: "renewal", id: "26000000-0000-4000-8000-0000000000ca", title: "Placeholder Company — renewal, Commercial motor PH/MTR/0001", path: "/r/26000000-0000-4000-8000-0000000000ca" }],
        },
      };
    }
    case "prepared": {
      return { status: 200, body: { ...base, preparedActions: [{ id: "46000000-0000-4000-8000-0000000000c1", actionType: "start_renewal", state: "prepared", changes: ["Start the renewal of Commercial motor — Placeholder Company · PH/MTR/0001", "A renewal work item, titled by this policy. Nothing is sent to any insurer."], blockers: [], permitted: true, expiresAt: "2026-09-29T10:00:00.000Z", receipt: null }] } };
    }
    case "no-permission-actions": {
      return { status: 200, body: { ...base, permissions: { canStartWork: false, canEdit: false }, actions: actions({ start_renewal: { available: false, reason: "You may not start work on a policy." }, report_claim: { available: false, reason: "You may not report a claim." }, request_endorsement: { available: false, reason: "You may not request a change to a policy." } }) } };
    }
    default:
      return { status: 200, body: base };
  }
}
