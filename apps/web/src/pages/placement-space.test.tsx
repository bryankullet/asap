import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PlacementSpace } from "./PlacementSpace.js";
import { renderInRouter } from "../test-utils.js";
import { resetWorkspaceTabs } from "../shell/workspace-tabs.js";

vi.mock("../lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "test-token" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));

/**
 * One client's placement (4B-4).
 *
 * What these lock: the title is the work's own name; the three status layers stay on their own
 * lines; a draft never looks sent; a confirmation that begins later is not active cover; a person
 * who cannot approve is told who can; and every figure on screen came from the server.
 */

const ORG = "10000000-0000-4000-8000-00000000000a";
const PLACEMENT = "40000000-0000-4000-8000-00000000000a";
const PLACEMENT_2 = "40000000-0000-4000-8000-00000000000b";
const REQ = "42000000-0000-4000-8000-00000000000a";

const ME = {
  user: { id: "90000000-0000-4000-8000-000000000001", email: "a@b.test", display_name: "Amina", full_name: null },
  memberships: [],
  active_organization: { id: ORG, name: "Acme Brokers", country: "KE", currency: "KES", timezone: "UTC" },
  permissions: [],
};

type Stage = "instructed" | "draft" | "approved" | "submitted" | "confirmed-future" | "active" | "changed" | "declined" | "drifted";

function body(stage: Stage = "instructed", over: Record<string, unknown> = {}) {
  const hasRequest = stage !== "instructed" && stage !== "drifted";
  const approved = ["approved", "submitted", "confirmed-future", "active", "changed", "declined"].includes(stage);
  const sent = ["submitted", "confirmed-future", "active", "changed", "declined"].includes(stage);
  const answer =
    stage === "confirmed-future" ? { outcome: "confirmed_as_requested", effectiveAt: "2099-01-01T00:00:00.000Z" }
    : stage === "active" ? { outcome: "confirmed_as_requested", effectiveAt: "2026-09-01T00:00:00.000Z" }
    : stage === "changed" ? { outcome: "confirmed_with_changes", effectiveAt: "2026-09-01T00:00:00.000Z", changesNote: "Own damage excess raised to 7.5%." }
    : stage === "declined" ? { outcome: "declined", effectiveAt: null, declineReason: "Outside appetite." }
    : null;

  const cover =
    stage === "confirmed-future" ? { state: "confirmed", line: "Jubilee confirmed cover, beginning 1 Jan 2099. It has not started yet." }
    : stage === "active" ? { state: "active", line: "Cover began 1 Sept 2026, until 31 Aug 2027." }
    : stage === "changed" ? { state: "active", line: "Cover began 1 Sept 2026 on changed terms." }
    : stage === "declined" ? { state: null, line: "Jubilee declined. There is no cover." }
    : sent ? { state: "submitted", line: "Sent to Jubilee on 8 Sept 2026. Not confirmed — there is no cover yet." }
    : hasRequest ? { state: "requested", line: "A request is prepared. It has not been sent, and there is no cover." }
    : { state: null, line: "Nothing has been requested from the insurer yet." };

  return {
    placement: { id: PLACEMENT, title: "Acme motor fleet placement — 2027", requestedEffectiveAt: "2026-10-01T00:00:00.000Z", requestedExpiryAt: null, createdAt: "2026-09-07T10:40:00.000Z" },
    client: { id: "20000000-0000-4000-8000-00000000000a", name: "Acme Ltd" },
    opportunity: { id: "30000000-0000-4000-8000-00000000000a", title: "Acme motor fleet quotation — 2027", classOfBusiness: "Commercial motor" },
    insurer: { id: "21000000-0000-4000-8000-00000000000a", name: "Jubilee" },
    workItem: sent && answer === null
      ? { id: "26000000-0000-4000-8000-00000000000b", taskStatus: "with_party", taskParty: "Jubilee", taskSince: "2026-09-08T11:02:00.000Z" }
      : { id: "26000000-0000-4000-8000-00000000000b", taskStatus: "needs_you", taskParty: null, taskSince: null },
    instruction: {
      id: "41000000-0000-4000-8000-00000000000a", source: "telephone",
      evidence: { kind: "note", id: null, label: "Client rang at 10:40 and chose Jubilee on the terms shown.", path: null },
      clientConditions: null, instructedAt: "2026-09-07T10:40:00.000Z", recordedByName: "Amina",
      recordedAt: "2026-09-07T10:45:00.000Z", comparisonVersion: 1, outsideComparison: false,
      exceptionReason: null, supersededAt: null, supersededReason: null,
    },
    instructionHistory: [],
    basis: {
      version: 1, origin: "instruction", classOfBusiness: "Commercial motor", subject: null,
      effectiveAt: "2026-10-01T00:00:00.000Z", expiryAt: null, premiumBasis: null, clientConditions: null,
      premiumAmount: "5310000.00", premiumCurrency: "KES", validUntil: "2027-06-30",
      terms: [{ termType: "excess", label: "Own damage", value: "5% min KES 30,000", amount: null, currency: null, unclear: false }],
    },
    drift: stage === "drifted"
      ? { stale: true, changes: [{ label: "Premium", was: "KES 5,310,000", now: "KES 5,410,000" }] }
      : { stale: false, changes: [] },
    request: hasRequest
      ? {
          id: REQ, version: 1, subject: "Placement instruction — Acme Ltd", body: "Please place cover.",
          coverRequested: "Commercial motor for Acme Ltd", effectiveAt: "2026-10-01T00:00:00.000Z",
          outstandingConditions: null, sha256: "a".repeat(64), preparedByName: "Otieno", preparedAt: "2026-09-07T11:00:00.000Z",
          approval: approved ? { approvedByName: "Amina", approvedAt: "2026-09-07T12:00:00.000Z" } : null,
          submission: sent
            ? { method: "recorded_manual_email", recipient: "underwriting@jubilee.test", sentAt: "2026-09-08T11:02:00.000Z", evidence: { kind: "note", id: null, label: "Sent from my own mailbox at 11:02.", path: null }, recordedByName: "Otieno" }
            : null,
        }
      : null,
    requestHistory: [],
    insurerResponse: answer === null ? null : {
      id: "43000000-0000-4000-8000-00000000000a",
      confirmedPremiumAmount: answer.outcome.startsWith("confirmed") ? "5310000.00" : null,
      confirmedPremiumCurrency: answer.outcome.startsWith("confirmed") ? "KES" : null,
      confirmedPremiumBasis: null, confirmedSubject: null, confirmedClassOfBusiness: null,
      terms: stage === "changed" ? [{ termType: "excess", label: "Own damage", value: "7.5% min KES 45,000", amount: null, currency: null, unclear: false }] : [],
      outcome: answer.outcome, receivedAt: "2026-09-09T14:10:00.000Z",
      effectiveAt: answer.effectiveAt, expiryAt: null, insurerReference: answer.outcome.startsWith("confirmed") ? "CN-2027-0041" : null,
      changesNote: (answer as { changesNote?: string }).changesNote ?? null, informationRequired: null,
      declineReason: (answer as { declineReason?: string }).declineReason ?? null,
      evidence: { kind: "note", id: null, label: "Cover note received by email.", path: null }, recordedByName: "Amina",
    },
    cancellation: null,
    cover,
    blockers: stage === "drifted" ? ["The quotation changed after the client accepted it: Premium. Nothing can be sent until it is reviewed."]
      : stage === "draft" ? ["The request is waiting for someone permitted to approve it."]
      : stage === "changed" ? ["Jubilee confirmed on different terms: Own damage excess raised to 7.5%. The client must accept them before a policy is issued."]
      : [],
    nextAction: stage === "active" ? "Prepare policy issuance." : stage === "draft" ? "Have the request approved by someone permitted to approve placements." : "Prepare the placement request.",
    permissions: { canRecordInstruction: true, canPrepare: true, canApprove: true, canRecordSubmission: true, canRecordResponse: true, approverRoles: ["Brokerage administrator", "Manager"] },
    sending: { available: false, reason: "Sending from ASAP is not connected yet. Copy the approved request into the mailbox it should go from, then record that it was sent." },
    work: [workFor(stage, sent && answer === null)],
    coverMatch: stage === "changed" ? CHANGED_MATCH : stage === "active" || stage === "confirmed-future" ? CLEAN_MATCH : null,
    changeAcceptance: null,
    readiness: stage === "active"
      ? { state: "ready", reasons: [], deferredChecks: [DEFERRED], workItemId: null }
      : { state: "blocked", reasons: [{ code: stage === "changed" ? "unaccepted_differences" : "not_confirmed", message: stage === "changed" ? "The confirmed terms differ from what the client accepted in 1 place, and the client has not accepted them." : "The insurer has not confirmed cover." }], deferredChecks: [DEFERRED], workItemId: null },
    preparedActions: [],
    ...over,
  };
}

const DEFERRED = "Whether premium must be paid before issuance is a brokerage rule that arrives with Money (4D). It is not checked, and not assumed.";

const WORK_COPY: Record<string, { headline: string; why: string }> = {
  prepare_request: { headline: "prepare the placement request", why: "The client has instructed, and nothing has been prepared for the insurer yet." },
  approval_required: { headline: "approve placement request", why: "A placement request is prepared and nobody permitted has approved it." },
  submission_proof_missing: { headline: "send the approved request and record how", why: "The request is approved but there is no evidence it reached the insurer." },
  awaiting_insurer: { headline: "cover confirmation requested", why: "The request was sent and the insurer has not answered." },
  review_changed_terms: { headline: "review changed insurer terms", why: "The insurer confirmed cover on terms that differ from what the client accepted." },
  issue_policy: { headline: "issue policy from confirmed cover", why: "Cover is confirmed and matches what the client accepted." },
  insurer_declined: { headline: "take the client's instruction on another quote", why: "The insurer declined. There is no cover from this placement." },
  quote_moved: { headline: "review what changed in the quotation", why: "The insurer revised the quotation after the client accepted it." },
};

function workFor(stage: Stage, withInsurer: boolean) {
  const reason =
    stage === "instructed" ? "prepare_request"
    : stage === "drifted" ? "quote_moved"
    : stage === "draft" ? "approval_required"
    : stage === "approved" ? "submission_proof_missing"
    : withInsurer ? "awaiting_insurer"
    : stage === "changed" ? "review_changed_terms"
    : stage === "declined" ? "insurer_declined"
    : "issue_policy";
  return {
    id: "26000000-0000-4000-8000-00000000000c", reason, ...WORK_COPY[reason]!,
    action: "Do the next thing.", evidence: "What shows it.", after: "What happens after.",
    taskStatus: withInsurer ? "with_party" : "needs_you",
    taskParty: withInsurer ? "Jubilee" : null,
    taskSince: withInsurer ? "2026-09-08T11:02:00.000Z" : null,
    taskNextCheck: null, ownerName: null,
  };
}

const matchItem = (id: string, label: string, a: string | null, c: string | null, classification: string, material: boolean) => ({
  id: `44000000-0000-4000-8000-00000000000${id}`, field: label === "Own damage" ? "term" : label.toLowerCase(), termType: label === "Own damage" ? "excess" : null,
  label, acceptedValue: a, confirmedValue: c, classification, material,
});
const CLEAN_MATCH = {
  id: "45000000-0000-4000-8000-00000000000a", comparedAt: "2026-09-09T14:11:00.000Z", comparedByName: null, basisVersion: 1,
  current: true, staleReason: null, materialDifferences: 0, unclearCount: 0,
  items: [matchItem("1", "Premium", "KES 5,310,000", "KES 5,310,000", "match", false), matchItem("2", "Own damage", "5% min KES 30,000", "5% min KES 30,000", "match", false)],
};
const CHANGED_MATCH = {
  ...CLEAN_MATCH, materialDifferences: 1,
  items: [matchItem("1", "Premium", "KES 5,310,000", "KES 5,310,000", "match", false), matchItem("2", "Own damage", "5% min KES 30,000", "7.5% min KES 45,000", "changed", true)],
};

let sent: { url: string; body: unknown }[] = [];

function stubApi(byId: Record<string, unknown>, after?: unknown, decided?: unknown) {
  sent = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    const method = (init as RequestInit | undefined)?.method ?? "GET";
    const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
    if (method !== "GET") sent.push({ url: u, body: JSON.parse(String((init as RequestInit).body ?? "{}")) });
    if (u.endsWith("/me")) return json(ME);
    if (u.includes("/prepared-actions/")) return json(decided ?? { outcome: "done", reason: null, action: null });
    for (const [id, reading] of Object.entries(byId)) {
      if (u.includes(`/placements/${id}/actions`)) return json(after ?? { outcome: "done", reason: null, placement: reading });
      if (u.endsWith(`/placements/${id}`)) return json(reading);
    }
    return json({});
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  resetWorkspaceTabs();
});

const open = (id = PLACEMENT) => renderInRouter(<PlacementSpace />, `/placements/${id}`);

describe("the placement", () => {
  it("is titled by the work's own name, never 'Placement Space'", async () => {
    stubApi({ [PLACEMENT]: body() });
    await open();
    await waitFor(() => expect(screen.getAllByText("Acme motor fleet placement — 2027").length).toBeGreaterThan(0));
    expect(screen.queryByText(/Placement Space|Space: Acme/i)).toBeNull();
  });

  it("shows what the client instructed, how it arrived, and the comparison they were shown", async () => {
    stubApi({ [PLACEMENT]: body() });
    await open();
    await waitFor(() => expect(screen.getAllByText(/Jubilee, instructed by telephone/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Client rang at 10:40/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Comparison v1").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("link", { name: /See what the client was shown/ })[0]!.getAttribute("href")).toContain("version=1");
  });

  it("shows the frozen terms the client accepted", async () => {
    stubApi({ [PLACEMENT]: body() });
    await open();
    await waitFor(() => expect(screen.getAllByText(/FROZEN WHEN THEY INSTRUCTED/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText("KES 5,310,000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5% min KES 30,000").length).toBeGreaterThan(0);
  });
});

describe("a draft never looks sent", () => {
  it("labels a prepared request a draft, and the cover as requested with no cover", async () => {
    stubApi({ [PLACEMENT]: body("draft") });
    await open();
    await waitFor(() => expect(screen.getAllByText("Draft").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Requested — A request is prepared. It has not been sent, and there is no cover/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Sent$/)).toBeNull();
  });

  it("labels an approved request as approved and not sent, and says why sending is manual", async () => {
    stubApi({ [PLACEMENT]: body("approved") });
    await open();
    await waitFor(() => expect(screen.getAllByText("Approved, not sent").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Sending from ASAP is not connected yet/).length).toBeGreaterThan(0);
  });

  it("names the insurer and the date once it has been sent, never a bare 'Waiting'", async () => {
    stubApi({ [PLACEMENT]: body("submitted") });
    await open();
    await waitFor(() => expect(screen.getAllByText(/With Jubilee since 8 Sept/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Not confirmed — there is no cover yet/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^Waiting$/)).toBeNull();
  });
});

describe("the cover line", () => {
  it("does not call a confirmation that begins later active cover", async () => {
    stubApi({ [PLACEMENT]: body("confirmed-future") });
    await open();
    await waitFor(() => expect(screen.getAllByText(/Confirmed — Jubilee confirmed cover, beginning/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/It has not started yet/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Active cover/)).toBeNull();
  });

  it("says Active cover, never Active alone, once cover has begun", async () => {
    stubApi({ [PLACEMENT]: body("active") });
    await open();
    await waitFor(() => expect(screen.getAllByText(/Active cover — Cover began/).length).toBeGreaterThan(0));
  });

  it("names the changes when the insurer confirmed on different terms", async () => {
    stubApi({ [PLACEMENT]: body("changed") });
    await open();
    await waitFor(() => expect(screen.getAllByText(/Confirmed on changed terms/).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Own damage excess raised to 7.5%/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /Prepare policy issuance/ })).toBeNull();
  });

  it("says a decline is no cover", async () => {
    stubApi({ [PLACEMENT]: body("declined") });
    await open();
    await waitFor(() => expect(screen.getAllByText(/declined. There is no cover/).length).toBeGreaterThan(0));
  });
});

describe("approval", () => {
  it("tells somebody who cannot approve exactly who can", async () => {
    stubApi({ [PLACEMENT]: body("draft", { permissions: { ...body().permissions, canApprove: false } }) });
    await open();
    const button = (await screen.findAllByRole("button", { name: /Approve this version/ }))[0]!;
    expect(button).toBeDisabled();
    expect(screen.getAllByText(/ask someone who is a Brokerage administrator or Manager/).length).toBeGreaterThan(0);
  });

  it("sends the approval of that exact version", async () => {
    stubApi({ [PLACEMENT]: body("draft") }, { outcome: "done", reason: null, placement: body("approved") });
    await open();
    await userEvent.click((await screen.findAllByRole("button", { name: /Approve this version/ }))[0]!);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toEqual({ action: "approve_request", placementRequestId: REQ });
    await waitFor(() => expect(screen.getAllByText("Approved, not sent").length).toBeGreaterThan(0));
  });

  it("shows the server's refusal where it happened, and records nothing", async () => {
    stubApi({ [PLACEMENT]: body("draft") }, { outcome: "blocked", reason: "You may not approve placement requests — ask someone who is a Manager.", placement: null });
    await open();
    await userEvent.click((await screen.findAllByRole("button", { name: /Approve this version/ }))[0]!);
    await waitFor(() => expect(screen.getAllByText("That was not recorded").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/ask someone who is a Manager/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Draft").length).toBeGreaterThan(0);
  });
});

describe("recording that it was sent", () => {
  it("asks for how, to whom, when and what shows it — then sends a typed action with one key", async () => {
    stubApi({ [PLACEMENT]: body("approved") }, { outcome: "done", reason: null, placement: body("submitted") });
    await open();
    await userEvent.click((await screen.findAllByRole("button", { name: /Record that it was sent/ }))[0]!);

    await screen.findAllByText(/RECORD THAT IT WAS SENT/i);
    expect(screen.getAllByText(/is not evidence/).length).toBeGreaterThan(0);

    await userEvent.type(screen.getByLabelText(/To whom/), "underwriting@jubilee.test");
    await userEvent.type(screen.getByLabelText(/^When/), "2026-09-08");
    await userEvent.type(screen.getByLabelText(/What shows it was sent/), "Sent from my own mailbox at 11:02 to the Jubilee desk.");
    await userEvent.click(screen.getAllByRole("button", { name: /Record it as sent/ })[0]!);

    await waitFor(() => expect(sent).toHaveLength(1));
    const payload = sent[0]!.body as Record<string, string>;
    expect(payload["action"]).toBe("record_submission");
    expect(payload["placementRequestId"]).toBe(REQ);
    expect(payload["recipient"]).toBe("underwriting@jubilee.test");
    expect(payload["idempotencyKey"]!.length).toBeGreaterThanOrEqual(8);
  });
});

describe("a quotation that moved", () => {
  it("names what changed and blocks preparing a request", async () => {
    stubApi({ [PLACEMENT]: body("drifted") });
    await open();
    await waitFor(() => expect(screen.getAllByText(/THE QUOTATION CHANGED AFTER THE CLIENT ACCEPTED IT/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Accepted KES 5,310,000 → now KES 5,410,000/).length).toBeGreaterThan(0);
    expect((await screen.findAllByRole("button", { name: /Prepare the request/ }))[0]).toBeDisabled();
  });
});

describe("policy issuance", () => {
  it("is offered only once cover is confirmed as requested", async () => {
    stubApi({ [PLACEMENT]: body("active") }, { outcome: "done", reason: null, placement: body("active", { issuance: { ready: true, reason: null, workItemId: "26000000-0000-4000-8000-0000000000ff" } }) });
    await open();
    await userEvent.click((await screen.findAllByRole("button", { name: /Prepare policy issuance/ }))[0]!);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toEqual({ action: "prepare_issuance" });
  });
});

describe("two placements, and a refresh", () => {
  it("keeps two placements apart, each in its own tab", async () => {
    stubApi({
      [PLACEMENT]: body(),
      [PLACEMENT_2]: body("instructed", { placement: { ...body().placement, id: PLACEMENT_2, title: "Acme property placement — 2027" } }),
    });
    const first = await open();
    await waitFor(() => expect(screen.getAllByText("Acme motor fleet placement — 2027").length).toBeGreaterThan(0));
    first.unmount();
    await open(PLACEMENT_2);
    await waitFor(() => expect(screen.getAllByText("Acme property placement — 2027").length).toBeGreaterThan(0));
  });

  it("reads everything again from the server after a refresh, and keeps nothing in the browser", async () => {
    stubApi({ [PLACEMENT]: body("submitted") });
    const first = await open();
    await waitFor(() => expect(screen.getAllByText(/With Jubilee since/).length).toBeGreaterThan(0));
    first.unmount();
    await open();
    await waitFor(() => expect(screen.getAllByText(/With Jubilee since/).length).toBeGreaterThan(0));
    expect(JSON.stringify(localStorage)).not.toMatch(/5,310,000|Jubilee|underwriting@/);
  });
});

/* ---- 4B-4A ----------------------------------------------------------------------------------- */

const PREPARED = {
  id: "46000000-0000-4000-8000-00000000000a", actionType: "approve_request", placementId: PLACEMENT, opportunityId: null,
  summary: "Approve version 1 of the placement request",
  changes: ["Approval of this exact version (aaaaaaaaaaaa…). A later edit needs approving again.", "It is not sent by approving it."],
  blockers: [], permitted: true, requiresConfirmation: true, state: "prepared",
  preparedAt: "2026-09-07T11:05:00.000Z", expiresAt: "2026-09-08T11:05:00.000Z", preparedByName: "Amina", receipt: null,
};

describe("Work, as the placement explains it (4B-4A)", () => {
  it("heads the page with the task label and what the work is", async () => {
    stubApi({ [PLACEMENT]: body("draft") });
    await open();
    await waitFor(() => expect(screen.getAllByText("Your work — approve placement request").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/nobody permitted has approved it/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Needs you/)).toBeNull();
  });

  it("names the party and the date when the insurer holds it", async () => {
    stubApi({ [PLACEMENT]: body("submitted") });
    await open();
    await waitFor(() => expect(screen.getAllByText(/With Jubilee since 8 Sept — cover confirmation requested/).length).toBeGreaterThan(0));
  });

  it("never puts the cover status where the work status goes", async () => {
    stubApi({ [PLACEMENT]: body("active") });
    await open();
    await waitFor(() => expect(screen.getAllByText("Your work — issue policy from confirmed cover").length).toBeGreaterThan(0));
    expect(screen.queryByText(/^Active cover$/)).toBeNull();
  });
});

describe("the cover check and the client's decision (4B-4A)", () => {
  it("shows each difference against what the client accepted", async () => {
    stubApi({ [PLACEMENT]: body("changed") });
    await open();
    await waitFor(() => expect(screen.getAllByText(/1 DIFFERENCE FROM WHAT THE CLIENT ACCEPTED/i).length).toBeGreaterThan(0));
    expect(screen.getAllByText("7.5% min KES 45,000").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Changed by the insurer").length).toBeGreaterThan(0);
  });

  it("keeps active cover visible without claiming the client accepted the changes", async () => {
    stubApi({ [PLACEMENT]: body("changed") });
    await open();
    await waitFor(() => expect(screen.getAllByText("The client has not accepted these changes").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Active cover — Cover began/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/That is not the client's agreement/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/POLICY ISSUANCE IS BLOCKED/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/client accepted all/i)).toBeNull();
  });

  it("records a partial decision item by item", async () => {
    stubApi({ [PLACEMENT]: body("changed") });
    await open();
    await userEvent.click((await screen.findAllByRole("button", { name: /Record the client's decision on the changes/ }))[0]!);
    await screen.findAllByText(/RECORD WHAT THE CLIENT DECIDED/i);
    await userEvent.selectOptions(screen.getByLabelText(/The client's decision/), "partial");
    await userEvent.selectOptions(screen.getByLabelText(/Own damage: 5% min KES 30,000/), "rejected");
    await userEvent.type(screen.getByLabelText(/^When/), "2026-09-10");
    await userEvent.type(screen.getByLabelText(/What shows it/), "Client replied at 09:00 rejecting the higher excess.");
    await userEvent.click(screen.getAllByRole("button", { name: /Record the client's decision$/ })[0]!);
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]!.body).toMatchObject({
      action: "record_client_acceptance",
      coverMatchId: CHANGED_MATCH.id,
      decision: "partial",
      items: [{ coverMatchItemId: CHANGED_MATCH.items[1]!.id, decision: "rejected" }],
    });
  });

  it("shows a follow-up to the insurer as a draft that was not sent", async () => {
    stubApi({ [PLACEMENT]: body("changed", {
      changeAcceptance: {
        decision: "reject", decidedAt: "2026-09-10T09:00:00.000Z", source: "email",
        evidence: { kind: "note", id: null, label: "Client replied rejecting the excess.", path: null }, recordedByName: "Amina",
        items: [{ label: "Own damage", decision: "rejected" }],
        followUpDraft: "Draft to Jubilee — not sent:\n\nDear Underwriter,",
      },
    }) });
    await open();
    await waitFor(() => expect(screen.getAllByText("A draft to the insurer — not sent").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/The client rejected the insurer's changes/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Sending from ASAP is not connected. Copy it into the mailbox/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/follow-up (was )?sent/i)).toBeNull();
  });

  it("says ready for policy issuance only when the server says so, and names what is not checked", async () => {
    stubApi({ [PLACEMENT]: body("active") });
    await open();
    await waitFor(() => expect(screen.getAllByText("Ready for policy issuance").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/No policy has been created/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Money \(4D\)/).length).toBeGreaterThan(0);
  });
});

describe("what Ask prepared (4B-4A)", () => {
  it("shows what will change and runs only when a person confirms", async () => {
    const readings = { [PLACEMENT]: body("draft", { preparedActions: [PREPARED] }) };
    stubApi(readings, undefined, { outcome: "done", reason: null, action: { ...PREPARED, state: "executed", receipt: { message: "Approved — done.", at: "2026-09-07T11:06:00.000Z", by: "Amina" } } });
    await open();
    await waitFor(() => expect(screen.getAllByText("Approve version 1 of the placement request").length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Will change: Approval of this exact version/).length).toBeGreaterThan(0);
    expect(sent).toHaveLength(0);

    readings[PLACEMENT] = body("approved", { preparedActions: [{ ...PREPARED, state: "executed", receipt: { message: "Approve version 1 of the placement request — done.", at: "2026-09-07T11:06:00.000Z", by: "Amina" } }] });
    await userEvent.click(screen.getAllByRole("button", { name: /Confirm and record/ })[0]!);
    await waitFor(() => expect(sent.map((x) => x.url)).toEqual([expect.stringContaining(`/prepared-actions/${PREPARED.id}/confirm`)]));
    await waitFor(() => expect(screen.getAllByText(/Receipt: Approve version 1 of the placement request — done/).length).toBeGreaterThan(0));
  });

  it("shows the refusal when the placement moved before confirmation", async () => {
    stubApi({ [PLACEMENT]: body("draft", { preparedActions: [PREPARED] }) }, undefined, {
      outcome: "refused", reason: "The placement changed after this was prepared, so it was not run.", action: { ...PREPARED, state: "stale" },
    });
    await open();
    await userEvent.click((await screen.findAllByRole("button", { name: /Confirm and record/ }))[0]!);
    await waitFor(() => expect(screen.getAllByText(/changed after this was prepared/).length).toBeGreaterThan(0));
  });

  it("will not let someone confirm what they may not do", async () => {
    stubApi({ [PLACEMENT]: body("draft", { preparedActions: [{ ...PREPARED, permitted: false, blockers: ["You may not do this. Someone with the permission must confirm it."] }] }) });
    await open();
    const button = (await screen.findAllByRole("button", { name: /Confirm and record/ }))[0]!;
    expect(button).toBeDisabled();
  });
});
