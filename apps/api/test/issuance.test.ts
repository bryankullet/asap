/**
 * Policy issuance (4B-5), against the in-memory fixture.
 *
 * The collapses refused here:
 *
 *   ready → prepared request      nothing is sent by preparing
 *   prepared → approved           only someone permitted, only this digest; a later change needs it again
 *   approved → submitted          only evidence of sending
 *   submitted → document          only the insurer's document, reviewed by a person
 *   document → policy record      only after a check, every difference resolved, a named target, a person
 *
 * The database proves the same rules for real (pgTAP 0331, connected issuance-lifecycle).
 */
import pino from "pino";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { Mailer } from "../src/mail/index.js";
import { checkIssuedPolicy } from "../src/placement/issued-check.js";
import { fakeFactory, type FakeDb } from "./_fake-supabase.js";
import { CLIENT, DOC, ORG, OPP, RESP_A, iso, makeDb } from "./_placement-fixture.js";

let db: FakeDb;
const silentMailer: Mailer = { sendInvitation: async () => {} };
const build = () =>
  createApp({
    logger: pino({ level: "silent" }), build: { version: "t", commit: "t" }, supabase: fakeFactory(db), mailer: silentMailer,
    webBaseUrl: "http://localhost:5173", invitationTtlHours: 168, exposeAcceptUrl: true, executor: () => async () => {}, bootToken: "t",
  });
beforeEach(() => {
  db = makeDb();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
async function post(path: string, body: unknown, token = "tok-amina"): Promise<Json> {
  const res = await build().request(path, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  return await res.json();
}
async function get(path: string, token = "tok-amina"): Promise<{ status: number; body: Json }> {
  const res = await build().request(path, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, body: res.status === 200 ? await res.json() : null };
}
const issue = (id: string, body: unknown, token = "tok-amina") => post(`/placements/${id}/issuance/actions`, body, token);
const openReasons = () => db.tables["work_items"]!.filter((w) => w["source_type"] === "placement" && w["task_status"] !== "done").map((w) => w["reason_code"]);

/** A placement whose confirmed cover matches what the client accepted: ready for issuance. */
async function ready(): Promise<string> {
  const placed = await post(`/opportunities/${OPP}/instruction`, {
    insurerResponseId: RESP_A, source: "telephone", evidenceNote: "Client rang at 10:40 on 7 September and chose Jubilee.",
    instructedAt: "2026-09-07T10:40:00.000Z", requestedEffectiveAt: "2026-10-01T00:00:00.000Z", requestedExpiryAt: "2027-09-30T00:00:00.000Z",
  });
  const id = placed.placementId as string;
  const act = (b: unknown) => post(`/placements/${id}/actions`, b);
  await act({ action: "prepare_request", subject: "Placement", body: "Please place cover on the quoted terms.", coverRequested: "Commercial motor" });
  let p = (await get(`/placements/${id}`)).body;
  await act({ action: "approve_request", placementRequestId: p.request.id });
  await act({ action: "record_submission", placementRequestId: p.request.id, method: "recorded_manual_email", recipient: "uw@jubilee.test", sentAt: "2026-09-08T11:02:00.000Z", evidenceNote: "Sent from my mailbox at 11:02 on 8 September.", idempotencyKey: "sub-000001" });
  await act({ action: "record_insurer_response", outcome: "confirmed_as_requested", receivedAt: "2026-09-09T14:10:00.000Z", effectiveAt: "2026-10-01T00:00:00.000Z", expiryAt: "2027-09-30T00:00:00.000Z", insurerReference: "CN-1", evidenceNote: "Cover note CN-1 received by email." });
  p = (await get(`/placements/${id}`)).body;
  expect(p.readiness.state).toBe("ready");
  return id;
}

async function submitted(id: string) {
  const prepared = await issue(id, { action: "prepare_issuance_request" });
  await issue(id, { action: "approve_issuance_request", issuanceRequestId: prepared.issuance.request.id });
  await issue(id, { action: "record_issuance_submission", issuanceRequestId: prepared.issuance.request.id, method: "recorded_manual_email", recipient: "policy@jubilee.test", sentAt: "2026-09-12T08:30:00.000Z", evidenceNote: "Sent from my mailbox at 08:30 on 12 September.", idempotencyKey: "iss-sub-001" });
  return prepared.issuance.request.id as string;
}

function extracted(values: Record<string, string>, terms: [string, string, string][] = [["excess", "Own damage", "5% min KES 30,000"]]) {
  db.tables["documents"]!.push({ id: DOC, organization_id: ORG, client_id: CLIENT, filename: "Schedule.pdf", extraction_state: "extracted", deleted_at: null });
  for (const [i, [k, v]] of Object.entries(values).entries()) {
    db.tables["document_fields"]!.push({ id: `3b000000-0000-4000-8000-00000000000${i}`, organization_id: ORG, document_id: DOC, field_key: k, proposed_value: v, corrected_value: null, state: "proposed", condition: "inferred", page_number: 1, region_x: 10, region_y: 20 + i, region_width: 100, region_height: 12 });
  }
  for (const [i, [t, l, v]] of terms.entries()) {
    db.tables["document_term_proposals"]!.push({ id: `3c000000-0000-4000-8000-00000000000${i}`, organization_id: ORG, document_id: DOC, ordinal: i, term_type: t, label: l, proposed_value: v, corrected_value: null, state: "proposed", reviewed_for: "quotation", page_number: 2, region_x: null });
  }
}
const ISSUED = {
  insured_name: "Acme Ltd", insurer_name: "Jubilee", policy_number: "JUB/1", class_of_business: "Commercial motor",
  period_start: "2026-10-01", period_end: "2027-09-30", currency: "KES", premium: "5,310,000.00",
};
async function reviewedAndChecked(id: string) {
  await issue(id, { action: "record_issued_policy_document", documentId: DOC, receivedAt: "2026-09-15T09:00:00.000Z" });
  for (const f of db.tables["document_fields"]!) await issue(id, { action: "review_issued_field", documentFieldId: f["id"], decision: "accept" });
  for (const t of db.tables["document_term_proposals"]!) await issue(id, { action: "review_issued_term", proposalId: t["id"], decision: "accept" });
  return await issue(id, { action: "run_issued_policy_check" });
}

describe("the issuance request", () => {
  it("is prepared, frozen and digested; nothing is sent; Work moves to approval", async () => {
    const id = await ready();
    expect(openReasons()).toEqual(["issue_policy"]);
    const res = await issue(id, { action: "prepare_issuance_request", requiredDocuments: ["Policy schedule"] });
    expect(res.outcome).toBe("done");
    expect(res.issuance.stage).toBe("approval_required");
    expect(res.issuance.request.payload).toMatchObject({ insurerName: "Jubilee", clientName: "Acme Ltd", premiumAmount: "5310000.00", requiredDocuments: ["Policy schedule"] });
    expect(res.issuance.request.submission).toBeNull();
    expect(openReasons()).toEqual(["approve_issuance_request"]);
    expect((await issue(id, { action: "prepare_issuance_request", requiredDocuments: ["Policy schedule"] })).outcome).toBe("already");
  });

  it("is refused before the placement is ready", async () => {
    const placed = await post(`/opportunities/${OPP}/instruction`, { insurerResponseId: RESP_A, source: "telephone", evidenceNote: "Client rang at 10:40 and chose Jubilee.", instructedAt: iso, requestedEffectiveAt: "2026-10-01T00:00:00.000Z" });
    const res = await issue(placed.placementId, { action: "prepare_issuance_request" });
    expect(res.outcome).toBe("blocked");
    expect(db.tables["issuance_requests"]).toHaveLength(0);
  });

  it("a placement officer may prepare but not approve; a read-only user may do neither", async () => {
    const id = await ready();
    expect((await issue(id, { action: "prepare_issuance_request" }, "tok-bahati")).outcome).toBe("blocked");
    const prepared = await issue(id, { action: "prepare_issuance_request" }, "tok-otieno");
    expect(prepared.outcome).toBe("done");
    expect((await issue(id, { action: "approve_issuance_request", issuanceRequestId: prepared.issuance.request.id }, "tok-otieno")).outcome).toBe("blocked");
    expect(db.tables["issuance_request_approvals"]).toHaveLength(0);
  });

  it("a new version supersedes the approval and keeps the history", async () => {
    const id = await ready();
    const v1 = await issue(id, { action: "prepare_issuance_request" });
    await issue(id, { action: "approve_issuance_request", issuanceRequestId: v1.issuance.request.id });
    const v2 = await issue(id, { action: "prepare_issuance_request", requiredDocuments: ["Motor certificates"] });
    expect(v2.issuance).toMatchObject({ stage: "approval_required", request: { version: 2, approval: null } });
    expect(v2.issuance.requestHistory[0]).toMatchObject({ version: 1, supersededAt: expect.any(String) });
    expect((await issue(id, { action: "approve_issuance_request", issuanceRequestId: v1.issuance.request.id })).outcome).toBe("blocked");
    expect(db.tables["audit_log"]!.some((a) => a["action"] === "issuance.approval_superseded")).toBe(true);
  });

  it("a draft cannot be recorded as sent, and sending needs evidence", async () => {
    const id = await ready();
    const v1 = await issue(id, { action: "prepare_issuance_request" });
    const base = { action: "record_issuance_submission", issuanceRequestId: v1.issuance.request.id, method: "recorded_manual_email", recipient: "policy@jubilee.test", sentAt: "2026-09-12T08:30:00.000Z", idempotencyKey: "iss-sub-001" };
    expect((await issue(id, { ...base, evidenceNote: "Sent from my mailbox at 08:30." })).reason).toMatch(/not been approved/);
    await issue(id, { action: "approve_issuance_request", issuanceRequestId: v1.issuance.request.id });
    expect((await issue(id, base)).reason).toMatch(/how you know it was sent/);
    const ok = await issue(id, { ...base, evidenceNote: "Sent from my mailbox at 08:30 on 12 September." });
    expect(ok.issuance.stage).toBe("with_insurer");
    const w = db.tables["work_items"]!.find((x) => x["reason_code"] === "obtain_issued_policy" && x["task_status"] !== "done")!;
    expect(w).toMatchObject({ task_status: "with_party", task_party: "Jubilee", task_since: "2026-09-12T08:30:00.000Z" });
  });
});

describe("the issued policy", () => {
  it("is checked only after every reading is reviewed; a match leaves nothing to resolve", async () => {
    const id = await ready();
    await submitted(id);
    extracted(ISSUED);
    await issue(id, { action: "record_issued_policy_document", documentId: DOC, receivedAt: "2026-09-15T09:00:00.000Z" });
    expect(openReasons()).toEqual(["review_issued_policy"]);
    expect((await issue(id, { action: "run_issued_policy_check" })).reason).toMatch(/Review every value/);
    const checked = await reviewedAndChecked(id);
    expect(checked.issuance.stage).toBe("ready_to_apply");
    expect(checked.issuance.check.items.find((i: Json) => i.label === "Premium").classificationWords).toBe("Matches");
    expect(openReasons()).toEqual(["apply_issued_policy"]);
  });

  it("a difference is recorded, blocks apply, is one Work item, and leaves cover as it was", async () => {
    const id = await ready();
    await submitted(id);
    extracted(ISSUED, [["excess", "Own damage", "7.5% min KES 45,000"]]);
    const before = (await get(`/placements/${id}`)).body.cover;
    const checked = await reviewedAndChecked(id);
    expect(checked.issuance.stage).toBe("differences_to_resolve");
    expect(checked.issuance.check.items.find((i: Json) => i.label === "Own damage")).toMatchObject({ classificationWords: "Changed", material: true });
    expect(openReasons()).toEqual(["resolve_issued_policy_differences"]);
    expect((await get(`/placements/${id}`)).body.cover).toEqual(before);
    const blocked = await issue(id, { action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: "apply-0001" });
    expect(blocked.outcome).toBe("blocked");
    expect(db.tables["policy_issuance_applications"]).toHaveLength(0);
  });

  it("a corrected reading makes the check stale until it is run again", async () => {
    const id = await ready();
    await submitted(id);
    extracted(ISSUED);
    await reviewedAndChecked(id);
    const premium = db.tables["document_fields"]!.find((f) => f["field_key"] === "premium")!;
    await issue(id, { action: "review_issued_field", documentFieldId: premium["id"], decision: "correct", correctedValue: "5,400,000.00" });
    const v = (await get(`/placements/${id}/issuance`)).body;
    expect(v.stage).toBe("review_required");
    expect(v.check.current).toBe(false);
    expect(v.check.staleReason).toMatch(/reviewed again/);
  });
});

describe("applying", () => {
  async function checkedReady() {
    const id = await ready();
    await submitted(id);
    extracted(ISSUED);
    await reviewedAndChecked(id);
    return id;
  }

  it("needs a named target and a premium basis — never guessed", async () => {
    const id = await checkedReady();
    const noTarget = await post(`/placements/${id}/issuance/preview`, { mode: "update" });
    expect(noTarget.blocked.join(" ")).toMatch(/Name the policy/);
    const noBasis = await post(`/placements/${id}/issuance/preview`, { mode: "create" });
    expect(noBasis.blocked.join(" ")).toMatch(/gross premium or the total payable/);
    expect(noBasis.canApply).toBe(false);
  });

  it("creates the policy once; a replay changes nothing and is audited as a replay", async () => {
    const id = await checkedReady();
    const preview = await post(`/placements/${id}/issuance/preview`, { mode: "create", premiumBasis: "gross" });
    expect(preview).toMatchObject({ canApply: true, target: { mode: "create" } });
    const res = await issue(id, { action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: "apply-0001" });
    expect(res.outcome).toBe("done");
    expect(res.receipt.message).toMatch(/Policy JUB\/1 created/);
    expect(res.issuance.stage).toBe("applied");
    expect(openReasons()).toEqual([]);
    const again = await issue(id, { action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: "apply-0002" });
    expect(again.outcome).toBe("already");
    expect(db.tables["policy_issuance_applications"]).toHaveLength(1);
    expect(db.tables["policies"]!.filter((p) => p["policy_number"] === "JUB/1")).toHaveLength(1);
    expect(db.tables["audit_log"]!.filter((a) => a["action"] === "issuance.apply_replayed")).toHaveLength(1);
  });

  it("is refused to someone who may not approve placements", async () => {
    const id = await checkedReady();
    const res = await issue(id, { action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: "apply-0001" }, "tok-otieno");
    expect(res.outcome).toBe("blocked");
    expect(db.tables["policy_issuance_applications"]).toHaveLength(0);
  });

  it("refuses a policy number another policy already carries", async () => {
    const id = await checkedReady();
    db.tables["policies"]!.push({ id: "4a000000-0000-4000-8000-0000000000ff", organization_id: ORG, client_id: CLIENT, policy_number: "JUB/1", deleted_at: null });
    const preview = await post(`/placements/${id}/issuance/preview`, { mode: "create", premiumBasis: "gross" });
    expect(preview.conflicts.join(" ")).toMatch(/already on another policy/);
    expect((await issue(id, { action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: "apply-0001" })).outcome).toBe("blocked");
  });
});

describe("the issued-policy comparison, by rule", () => {
  const base = {
    clientName: "Acme Ltd", insurerName: "Jubilee", requestedPolicyNumber: null,
    instruction: { conditions: [] },
    basis: { version: 1, acceptedChanges: false, classOfBusiness: "Commercial motor", effectiveAt: "2026-10-01T00:00:00Z", expiryAt: null, derivedExpiryAt: "2027-10-01T00:00:00Z", derivation: "Cover begins 1 Oct 2026 + 12 months = 1 Oct 2027", premiumAmount: "100.00", premiumCurrency: "KES", premiumBasis: "gross", sumInsured: null, terms: [] },
    confirmation: { insurerName: "Jubilee", classOfBusiness: null, effectiveAt: "2026-10-01T00:00:00Z", expiryAt: null, premiumAmount: null, premiumCurrency: null, premiumBasis: null, terms: [] },
    issuedTerms: [],
  };
  const ev = { documentFieldId: null, documentTermProposalId: null, page: 1 };
  const f = (value: string | null) => ({ value, evidence: ev });

  it("a derived midnight end against a schedule ending the day before needs a person to check", () => {
    const items = checkIssuedPolicy({ ...base, issued: { period_end: f("2027-09-30"), period_start: f("2026-10-01") } });
    expect(items.find((i) => i.field === "expiry")).toMatchObject({ classification: "unclear", material: true });
  });

  it("a policy number the insurer adds is not material; a sum insured only on the issued policy needs a person", () => {
    const items = checkIssuedPolicy({ ...base, issued: { policy_number: f("JUB/1"), sum_insured: f("1,000,000") } });
    expect(items.find((i) => i.field === "policy_number")).toMatchObject({ classification: "added_by_insurer", material: false });
    expect(items.find((i) => i.field === "sum_insured")).toMatchObject({ classification: "unclear", material: true });
  });
});
