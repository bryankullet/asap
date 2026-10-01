/**
 * Policy issuance, connected (4B-5).
 *
 * From a placement ready for issuance to one verified policy and period, through the real API,
 * supabase-js and PostgREST against a disposable database built from the migrations. Every write
 * goes through a route as a signed-in person; RLS, grants, triggers and the API-key gate are the
 * real ones. No service-role key is used.
 *
 * One stand-in beyond the harness's: the insurer's policy document is inserted by the database
 * owner as the extractor would leave it — a `documents` row and its `document_fields` and
 * `document_term_proposals`, with pages and regions. The Python extractor is proven by its own
 * suite; this test starts at its output. Everything after it goes through the API.
 */
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FakeScript } from "../../src/ai/providers/fake.js";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, BETA, browser, buildApp as build, caller, CIC, JUBILEE, KAMAU, newApiKey, ORG_A, ORG_B, OWNER, READER } from "./_harness.js";

const API_KEY = newApiKey();
const askScript: FakeScript = [];
const buildApp = () => build(API_KEY, askScript);

let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const act = (who: { id: string; email: string }, id: string, body: unknown) => call(who, "POST", `/placements/${id}/issuance/actions`, body);
const read = async (id: string, who = AMINA) => (await call(who, "GET", `/placements/${id}/issuance`)).body;
const openWork = async (id: string) =>
  (await sql<{ reason_code: string; task_status: string; task_party: string | null; task_since: Date | null }[]>`
    select reason_code, task_status, task_party, task_since from work_items where source_id = ${id} and task_status <> 'done'`);

const ids: Record<string, unknown> = {};
const TAG = randomUUID().slice(0, 8);
const POLICY_NUMBER = `JUB/MTR/${TAG}`;

const counts = async (id: string) => {
  const [r] = await sql<{ requests: number; approvals: number; submissions: number; checks: number; resolutions: number; applications: number; policies: number; work: number; applied_audits: number }[]>`
    select
      (select count(*)::int from issuance_requests where placement_id = ${id}) as requests,
      (select count(*)::int from issuance_request_approvals a join issuance_requests r on r.id = a.issuance_request_id where r.placement_id = ${id}) as approvals,
      (select count(*)::int from issuance_submissions s join issuance_requests r on r.id = s.issuance_request_id where r.placement_id = ${id}) as submissions,
      (select count(*)::int from issued_policy_checks where placement_id = ${id}) as checks,
      (select count(*)::int from issued_policy_resolutions where placement_id = ${id}) as resolutions,
      (select count(*)::int from policy_issuance_applications where placement_id = ${id}) as applications,
      (select count(*)::int from policies where organization_id = ${ORG_A} and policy_number = ${POLICY_NUMBER} and deleted_at is null) as policies,
      (select count(*)::int from work_items where source_id = ${id}) as work,
      (select count(*)::int from audit_log where organization_id = ${ORG_A} and action = 'policy.issued_from_placement' and new_state ->> 'placement_id' = ${id}) as applied_audits`;
  return r!;
};

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-issuance')`;
  app = buildApp();
});
afterAll(async () => {
  if (process.env["CONNECTED_ISSUANCE_REPORT"]) writeFileSync(process.env["CONNECTED_ISSUANCE_REPORT"], JSON.stringify(ids, null, 2));
  await sql.end();
});

describe("policy issuance, connected to a real database", () => {
  let placementId = "";
  let documentId = "";

  it("1. a placement reaches ready for issuance through the API", async () => {
    const created = await call(AMINA, "POST", "/opportunities", {
      clientId: ACME, title: `Issuance fleet — ${TAG}`, classOfBusiness: "Commercial motor", requestKey: randomUUID(),
    });
    const opportunityId = created.body.opportunityId as string;
    for (const insurerId of [JUBILEE, CIC]) await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "add_insurer", insurerId });
    let opp = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const by = (id: string) => opp.insurers.find((i: { insurerId: string }) => i.insurerId === id);
    for (const [insurerId, premium] of [[JUBILEE, "5310000.00"], [CIC, "5620000.00"]] as const) {
      expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, {
        action: "record_response", withoutRequest: true, opportunityInsurerId: by(insurerId).id, outcome: "quoted", receivedAt: "2026-09-05T09:00:00.000Z",
        premiumAmount: premium, premiumCurrency: "KES", validUntil: "2027-06-30", sourceNote: "Quotation letter received by email.",
      })).body.outcome).toBe("done");
    }
    opp = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const responseId = by(JUBILEE).response.id;
    await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "record_term", insurerResponseId: responseId, termType: "excess", label: "Own damage", extractedValue: "5% min KES 30,000" });
    const generated = await call(AMINA, "POST", `/opportunities/${opportunityId}/comparison/actions`, { action: "generate_comparison" });
    await call(AMINA, "POST", `/opportunities/${opportunityId}/comparison/actions`, { action: "present_comparison", comparisonId: generated.body.comparison.comparison.id });

    const instructed = await call(AMINA, "POST", `/opportunities/${opportunityId}/instruction`, {
      insurerResponseId: responseId, source: "email", evidenceNote: "Client emailed at 10:40 on 7 September choosing Jubilee.",
      instructedAt: "2026-09-07T10:40:00.000Z", requestedEffectiveAt: "2026-09-10T00:00:00.000Z", requestedExpiryAt: "2027-09-09T00:00:00.000Z",
    });
    expect(instructed.body.outcome).toBe("done");
    placementId = instructed.body.placementId;
    ids["placementId"] = placementId;

    const pAct = (body: unknown) => call(AMINA, "POST", `/placements/${placementId}/actions`, body);
    await pAct({ action: "prepare_request", subject: "Placement request", body: "Please place cover on the quoted terms.", coverRequested: "Commercial motor, five vehicles" });
    let p = (await call(AMINA, "GET", `/placements/${placementId}`)).body;
    await pAct({ action: "approve_request", placementRequestId: p.request.id });
    await pAct({
      action: "record_submission", placementRequestId: p.request.id, method: "recorded_manual_email", recipient: "underwriting@jubilee.test",
      sentAt: "2026-09-08T11:02:00.000Z", evidenceNote: "Sent from my mailbox at 11:02 on 8 September.", idempotencyKey: `iss-${placementId}`,
    });
    expect((await pAct({
      action: "record_insurer_response", outcome: "confirmed_as_requested", receivedAt: "2026-09-09T14:10:00.000Z",
      effectiveAt: "2026-09-10T00:00:00.000Z", expiryAt: "2027-09-09T00:00:00.000Z", insurerReference: `CN-${TAG}`,
      evidenceNote: "Cover note received by email at 14:10 on 9 September.",
    })).body.outcome).toBe("done");
    p = (await call(AMINA, "GET", `/placements/${placementId}`)).body;
    ids["client"] = p.client.name;
    ids["insurer"] = p.insurer.name;
    expect(p.readiness).toMatchObject({ state: "ready" });
    expect(p.issuance).toMatchObject({ stage: "ready" });
    expect((await openWork(placementId)).map((w) => w.reason_code)).toEqual(["issue_policy"]);
    expect((await read(placementId)).stage).toBe("ready");
  });

  it("2. prepares a frozen, digested issuance request; nothing is sent", async () => {
    const res = await act(AMINA, placementId, { action: "prepare_issuance_request", requiredDocuments: ["Policy schedule"] });
    expect(res.body.outcome).toBe("done");
    expect(res.body.receipt.message).toMatch(/has not been sent/);
    const v = res.body.issuance;
    expect(v.stage).toBe("approval_required");
    expect(v.request).toMatchObject({ version: 1, approval: null, submission: null });
    expect(v.request.payload).toMatchObject({
      clientName: ids["client"], insurerName: ids["insurer"], classOfBusiness: "Commercial motor", inception: "2026-09-10T00:00:00+00:00",
      premiumAmount: "5310000.00", premiumCurrency: "KES", coverConfirmationReference: `CN-${TAG}`, requiredDocuments: ["Policy schedule"],
    });
    const [row] = await sql<{ sha256: string; payload: unknown }[]>`select sha256, payload from issuance_requests where placement_id = ${placementId}`;
    expect(row!.sha256).toBe(v.request.sha256);
    expect(row!.sha256).toMatch(/^[0-9a-f]{64}$/);
    ids["requestV1"] = v.request.id;
    expect((await openWork(placementId)).map((w) => w.reason_code)).toEqual(["approve_issuance_request"]);
  });

  it("3. an account executive may not approve; approval binds the exact digest", async () => {
    const refused = await act(KAMAU, placementId, { action: "approve_issuance_request", issuanceRequestId: ids["requestV1"] });
    expect(refused.body.outcome).toBe("blocked");
    expect((await counts(placementId)).approvals).toBe(0);
    const ok = await act(AMINA, placementId, { action: "approve_issuance_request", issuanceRequestId: ids["requestV1"] });
    expect(ok.body.outcome).toBe("done");
    expect(ok.body.issuance.stage).toBe("submission_required");
    const [a] = await sql<{ sha256: string; approved_by: string }[]>`
      select a.sha256, a.approved_by from issuance_request_approvals a where a.issuance_request_id = ${ids["requestV1"] as string}`;
    expect(a).toMatchObject({ approved_by: AMINA.id });
  });

  it("4. a material change supersedes the approval, keeps history, and needs approving again", async () => {
    const res = await act(AMINA, placementId, { action: "prepare_issuance_request", requiredDocuments: ["Policy schedule", "Motor certificates"] });
    expect(res.body.outcome).toBe("done");
    const v = res.body.issuance;
    expect(v.stage).toBe("approval_required");
    expect(v.request.version).toBe(2);
    expect(v.requestHistory).toEqual([expect.objectContaining({ version: 1, approvedAt: expect.any(String), supersededAt: expect.any(String) })]);
    const [old] = await sql<{ superseded_at: Date | null }[]>`select superseded_at from issuance_request_approvals where issuance_request_id = ${ids["requestV1"] as string}`;
    expect(old!.superseded_at).not.toBeNull();
    /* The old version cannot be approved now. */
    expect((await act(AMINA, placementId, { action: "approve_issuance_request", issuanceRequestId: ids["requestV1"] })).body.outcome).toBe("blocked");
    ids["requestV2"] = v.request.id;
    expect((await act(AMINA, placementId, { action: "approve_issuance_request", issuanceRequestId: v.request.id })).body.outcome).toBe("done");
  });

  it("5. submission needs evidence; once recorded, the work is with the insurer, named, since the date sent", async () => {
    const base = { action: "record_issuance_submission", issuanceRequestId: ids["requestV2"], method: "recorded_manual_email", recipient: "policy@jubilee.test", sentAt: "2026-09-12T08:30:00.000Z" };
    expect((await act(AMINA, placementId, { ...base, idempotencyKey: `iss-sub-a-${TAG}` })).body.outcome).toBe("blocked");
    const ok = await act(AMINA, placementId, { ...base, evidenceNote: "Sent from my mailbox at 08:30 on 12 September to the Jubilee policy desk.", idempotencyKey: `iss-sub-${TAG}` });
    expect(ok.body.outcome).toBe("done");
    expect(ok.body.issuance.stage).toBe("with_insurer");
    expect(ok.body.issuance.request.submission).toMatchObject({ method: "recorded_manual_email", providerMessageId: null });
    const replay = await act(AMINA, placementId, { ...base, evidenceNote: "Sent from my mailbox at 08:30 on 12 September to the Jubilee policy desk.", idempotencyKey: `iss-sub-${TAG}` });
    expect(replay.body.outcome).toBe("already");
    expect((await counts(placementId)).submissions).toBe(1);
    const [w] = await openWork(placementId);
    expect(w).toMatchObject({ reason_code: "obtain_issued_policy", task_status: "with_party", task_party: ids["insurer"] });
    expect(w!.task_since!.toISOString()).toBe("2026-09-12T08:30:00.000Z");
  });

  it("6. the insurer's policy document enters the document pipeline and is recorded against the placement", async () => {
    /* As the extractor leaves it: the document, its fields and its terms, with pages and regions. */
    const [doc] = await sql<{ id: string }[]>`
      insert into documents (organization_id, client_id, kind, filename, mime_type, byte_size, storage_path, content_sha256, page_count, extraction_state, uploaded_by)
      values (${ORG_A}, ${ACME}, 'policy_schedule', ${`Jubilee policy schedule ${TAG}.pdf`}, 'application/pdf', 48211, ${`${ORG_A}/issuance/${TAG}.pdf`},
              ${createHash("sha256").update(TAG).digest("hex")}, 3, 'extracted', ${AMINA.id})
      returning id`;
    documentId = doc!.id;
    ids["documentId"] = documentId;
    const fields: [string, string, number][] = [
      ["insured_name", ids["client"] as string, 1], ["insurer_name", ids["insurer"] as string, 1], ["policy_number", POLICY_NUMBER, 1],
      ["class_of_business", "Commercial motor", 1], ["period_start", "2026-09-10", 1], ["period_end", "2027-09-09", 1],
      ["currency", "KES", 2], ["premium", "5,310,000.00", 2],
    ];
    for (const [i, [key, value, page]] of fields.entries()) {
      await sql`insert into document_fields (organization_id, document_id, field_key, proposed_value, page_number, region_x, region_y, region_width, region_height, condition)
                values (${ORG_A}, ${documentId}, ${key}, ${value}, ${page}, 72, ${120 + i * 24}, 260, 18, 'inferred')`;
    }
    await sql`insert into document_term_proposals (organization_id, document_id, ordinal, term_type, label, proposed_value, page_number, region_x, region_y, region_width, region_height, method)
              values (${ORG_A}, ${documentId}, 0, 'excess', 'Own damage', '7.5% min KES 45,000', 3, 72, 300, 300, 18, 'schedule-table')`;

    const recorded = await act(AMINA, placementId, { action: "record_issued_policy_document", documentId, receivedAt: "2026-09-15T09:00:00.000Z" });
    expect(recorded.body.outcome).toBe("done");
    expect(recorded.body.issuance.stage).toBe("review_required");
    expect(recorded.body.issuance.documents[0]).toMatchObject({ documentId, reviewComplete: false, extractionState: "extracted" });
    expect((await openWork(placementId)).map((w) => w.reason_code)).toEqual(["review_issued_policy"]);
  });

  it("7. nothing is checked before a person reviews every reading; the review is audited", async () => {
    expect((await act(AMINA, placementId, { action: "run_issued_policy_check" })).body.outcome).toBe("blocked");
    const v = await read(placementId);
    for (const f of v.documents[0].fields) {
      expect(f.evidence).toMatchObject({ documentId, page: expect.any(Number), region: { x: 72, width: 260, height: 18 } });
      expect(f.evidence.path).toContain(`/documents/${documentId}?page=`);
      expect((await act(AMINA, placementId, { action: "review_issued_field", documentFieldId: f.id, decision: "accept" })).body.outcome).toBe("done");
    }
    const term = v.documents[0].terms[0];
    expect((await act(AMINA, placementId, { action: "review_issued_term", proposalId: term.id, decision: "accept" })).body.outcome).toBe("done");
    const [reviewed] = await sql<{ n: number }[]>`select count(*)::int as n from document_fields where document_id = ${documentId} and state = 'accepted' and reviewed_by = ${AMINA.id}`;
    expect(reviewed!.n).toBe(8);
  });

  it("8. the check compares the issued policy with the instruction, the basis and the confirmation", async () => {
    const res = await act(AMINA, placementId, { action: "run_issued_policy_check" });
    expect(res.body.outcome).toBe("done");
    const v = res.body.issuance;
    expect(v.stage).toBe("differences_to_resolve");
    const item = (label: string) => v.check.items.find((i: { label: string }) => i.label === label);
    expect(item("Own damage")).toMatchObject({ classification: "changed", classificationWords: "Changed", material: true, basisValue: "5% min KES 30,000", issuedValue: "7.5% min KES 45,000" });
    expect(item("Own damage").evidence).toMatchObject({ documentId, page: 3 });
    expect(item("Premium").classification).toBe("match");
    expect(v.check).toMatchObject({ current: true, unresolved: 1 });
    ids["checkId"] = v.check.id;
    ids["differenceId"] = item("Own damage").id;
    /* An unresolved difference changes nothing about cover, and is one reason-keyed Work item. */
    expect(v.cover.state).not.toBeNull();
    const [w] = await openWork(placementId);
    expect(w).toMatchObject({ reason_code: "resolve_issued_policy_differences", task_status: "needs_you" });
  });

  it("9. apply is blocked while a difference is unresolved, in the preview and at the write", async () => {
    const preview = await call(AMINA, "POST", `/placements/${placementId}/issuance/preview`, { mode: "create", premiumBasis: "gross" });
    expect(preview.body.canApply).toBe(false);
    const applied = await act(AMINA, placementId, { action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: `iss-apply-early-${TAG}` });
    expect(applied.body.outcome).toBe("blocked");
    expect((await counts(placementId)).applications).toBe(0);
  });

  it("10. a difference is resolved with a reason and evidence", async () => {
    const noEvidence = await act(AMINA, placementId, { action: "resolve_issued_policy_difference", itemId: ids["differenceId"], resolution: "client_accepted_issued_value", reason: "Client accepted.", resolvedAt: "2026-09-16T10:00:00.000Z" });
    expect(noEvidence.body.outcome).toBe("blocked");
    const ok = await act(AMINA, placementId, {
      action: "resolve_issued_policy_difference", itemId: ids["differenceId"], resolution: "client_accepted_issued_value",
      reason: "The client accepted the higher own-damage excess on the issued policy.", resolvedAt: "2026-09-16T10:00:00.000Z",
      evidenceNote: "Client's finance director replied by email at 10:00 on 16 September accepting it.",
    });
    expect(ok.body.outcome).toBe("done");
    expect(ok.body.issuance.stage).toBe("ready_to_apply");
    expect((await openWork(placementId)).map((w) => w.reason_code)).toEqual(["apply_issued_policy"]);
  });

  it("11. Ask reads issuance and prepares apply, asking the one missing fact; it writes nothing", async () => {
    askScript.push({
      match: /apply the issued policy/i,
      reply: {
        text: "",
        toolCalls: [
          { id: "g1", name: "get_issuance", arguments: { placementId } },
          { id: "p1", name: "prepare_placement_action", arguments: { actionType: "apply_issued_policy", placementId } },
        ],
        stop: "tool_use",
      },
      then: {
        text: JSON.stringify({ type: "answer", target: null, panel: null, view: "summary", answer: "Should I create a new policy, or update one this client already has? Nothing has been written.", suggestions: [] }),
        toolCalls: [], stop: "end",
      },
    });
    const before = await counts(placementId);
    const asked = await call(AMINA, "POST", "/ask", { question: "Apply the issued policy", scope: { kind: "placement", id: placementId } });
    expect(asked.status).toBe(200);
    expect(asked.body.message.tools_used.map((t: { name: string }) => t.name)).toEqual(["get_issuance", "prepare_placement_action"]);
    const [prepared] = await sql<{ n: number }[]>`select count(*)::int as n from prepared_actions where placement_id = ${placementId} and action_type = 'apply_issued_policy'`;
    expect(prepared!.n).toBe(0);
    expect(await counts(placementId)).toEqual(before);
  });

  it("12. a policy number already on another policy is a conflict, explained, never merged", async () => {
    const [clash] = await sql<{ id: string }[]>`
      insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
      values (${ORG_A}, ${ACME}, ${CIC}, 'Fire', ${POLICY_NUMBER}) returning id`;
    const preview = await call(AMINA, "POST", `/placements/${placementId}/issuance/preview`, { mode: "create", premiumBasis: "gross" });
    expect(preview.body.canApply).toBe(false);
    expect(preview.body.conflicts.join(" ")).toMatch(/already on another policy/);
    const res = await act(AMINA, placementId, { action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: `iss-apply-clash-${TAG}` });
    expect(res.body.outcome).toBe("blocked");
    expect((await counts(placementId)).applications).toBe(0);
    await sql`update policies set deleted_at = now() where id = ${clash!.id}`;
  });

  it("13. the target is never guessed: an update names its policy, and a moved target is stale", async () => {
    const [existing] = await sql<{ id: string }[]>`
      insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
      values (${ORG_A}, ${ACME}, ${JUBILEE}, 'Commercial motor', ${`OLD/${TAG}`}) returning id`;
    const [period] = await sql<{ id: string }[]>`
      insert into policy_periods (organization_id, policy_id, period_start, period_end) values (${ORG_A}, ${existing!.id}, '2025-09-10', '2026-09-09') returning id`;
    const noTarget = await call(AMINA, "POST", `/placements/${placementId}/issuance/preview`, { mode: "update", premiumBasis: "gross" });
    expect(noTarget.body.blocked.join(" ")).toMatch(/Name the policy/);
    const preview = await call(AMINA, "POST", `/placements/${placementId}/issuance/preview`, { mode: "update", policyId: existing!.id, periodId: period!.id, premiumBasis: "gross" });
    expect(preview.body).toMatchObject({ canApply: true, expected: { policy_number: `OLD/${TAG}`, period_start: "2025-09-10", period_end: "2026-09-09", premium: null } });
    /* Someone changes the target after the preview. */
    await sql`update policy_periods set period_end = '2026-09-30' where id = ${period!.id}`;
    const stale = await act(AMINA, placementId, {
      action: "apply_issued_policy", mode: "update", policyId: existing!.id, periodId: period!.id, premiumBasis: "gross",
      expected: preview.body.expected, idempotencyKey: `iss-apply-stale-${TAG}`,
    });
    expect(stale.body.outcome).toBe("blocked");
    expect(stale.body.reason).toMatch(/changed since the preview/);
    const [unchanged] = await sql<{ policy_number: string }[]>`select policy_number from policies where id = ${existing!.id}`;
    expect(unchanged!.policy_number).toBe(`OLD/${TAG}`);
    await sql`update policies set deleted_at = now() where id = ${existing!.id}`;
  });

  it("14. permission and the premium basis are checked; neither is assumed", async () => {
    expect((await act(KAMAU, placementId, { action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: `iss-apply-kamau-${TAG}` })).body.outcome).toBe("blocked");
    expect((await act(READER, placementId, { action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: `iss-apply-reader-${TAG}` })).body.outcome).toBe("blocked");
    const noBasis = await act(AMINA, placementId, { action: "apply_issued_policy", mode: "create", idempotencyKey: `iss-apply-nobasis-${TAG}` });
    expect(noBasis.body.outcome).toBe("blocked");
    expect(noBasis.body.reason).toMatch(/gross premium or the total payable/);
    expect((await counts(placementId)).applications).toBe(0);
  });

  it("15. the server preview shows target, current, issued, accepted, evidence and what is unchanged", async () => {
    const preview = await call(AMINA, "POST", `/placements/${placementId}/issuance/preview`, { mode: "create", premiumBasis: "gross" });
    expect(preview.body).toMatchObject({ canApply: true, conflicts: [], blocked: [], target: { mode: "create", label: "A new policy and its first period" } });
    const row = (f: string) => preview.body.rows.find((r: { field: string }) => r.field === f);
    expect(row("policy_number")).toMatchObject({ current: null, issued: POLICY_NUMBER, status: "will_change" });
    expect(row("period_start")).toMatchObject({ issued: "2026-09-10", accepted: "2026-09-10", evidence: { documentId, page: 1 } });
    expect(row("premium")).toMatchObject({ issued: "5,310,000.00", accepted: "5310000.00" });
    const [previewed] = await sql<{ n: number }[]>`select count(*)::int as n from audit_log where object_id = ${placementId} and action = 'issuance.apply_previewed'`;
    expect(previewed!.n).toBeGreaterThan(0);
  });

  it("16. applying creates one policy and one period, verified from the document, with every link", async () => {
    const res = await act(AMINA, placementId, { action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: `iss-apply-${TAG}` });
    expect(res.body.outcome).toBe("done");
    expect(res.body.receipt.message).toMatch(new RegExp(`Policy ${POLICY_NUMBER.replace(/\//g, "\\/")} created, period 10 Sept 2026 to 9 Sept 2027`));
    const v = res.body.issuance;
    expect(v.stage).toBe("applied");
    ids["applicationId"] = v.application.id;
    ids["policyId"] = v.application.policyId;
    expect(v.application.links).toMatchObject({ placementId, documentId, issuedPolicyCheckId: ids["checkId"], issuanceRequestId: ids["requestV2"] });

    const [period] = await sql<{ period_start: string; period_end: string; premium_amount: string; premium_currency: string; premium_basis: string; premium_source: string; premium_evidence_document_id: string; premium_verified_at: Date }[]>`
      select period_start::text, period_end::text, premium_amount::text, premium_currency, premium_basis, premium_source, premium_evidence_document_id, premium_verified_at
        from policy_periods where id = ${v.application.policyPeriodId}`;
    expect(period).toMatchObject({ period_start: "2026-09-10", period_end: "2027-09-09", premium_amount: "5310000.00", premium_currency: "KES", premium_basis: "gross", premium_source: "document", premium_evidence_document_id: documentId });
    const [version] = await sql<{ source: string }[]>`select source from policy_versions where policy_id = ${v.application.policyId}`;
    expect(version!.source).toBe("placement");
    const c = await counts(placementId);
    expect(c).toMatchObject({ applications: 1, policies: 1, applied_audits: 1 });
    /* Work closes: nothing further to do. */
    expect(await openWork(placementId)).toEqual([]);
  });

  it("17. replaying the apply, by key or a new key, creates nothing further", async () => {
    const before = await counts(placementId);
    const same = await act(AMINA, placementId, { action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: `iss-apply-${TAG}` });
    expect(same.body.outcome).toBe("already");
    const other = await act(AMINA, placementId, { action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: `iss-apply-again-${TAG}` });
    expect(other.body.outcome).toBe("already");
    expect(await counts(placementId)).toEqual(before);
    const [replays] = await sql<{ n: number }[]>`select count(*)::int as n from audit_log where object_id = ${placementId} and action = 'issuance.apply_replayed'`;
    expect(replays!.n).toBeGreaterThanOrEqual(2);
  });

  it("18. the audit trail names the real actor for every step", async () => {
    const actions = (await sql<{ action: string; actor_user_id: string | null }[]>`
      select action, actor_user_id from audit_log where organization_id = ${ORG_A} and (object_id = ${placementId} or object_id = ${ids["policyId"] as string}) order by occurred_at`);
    const names = actions.map((a) => a.action);
    for (const expected of ["issuance.request_prepared", "issuance.request_approved", "issuance.approval_superseded", "issuance.submission_recorded",
      "issuance.policy_document_received", "issuance.discrepancy_recorded", "issuance.discrepancy_resolved", "issuance.apply_previewed",
      "issuance.policy_applied", "policy.issued_from_placement", "issuance.apply_replayed"]) {
      expect(names).toContain(expected);
    }
    for (const a of actions.filter((x) => x.action.startsWith("issuance.") || x.action.startsWith("policy."))) expect(a.actor_user_id).toBe(AMINA.id);
    ids["auditActions"] = names;
  });

  it("19. the result survives refresh and a fresh API instance", async () => {
    const first = await read(placementId);
    app = buildApp();
    const fresh = await read(placementId);
    expect(fresh.stage).toBe("applied");
    expect(fresh.application).toEqual(first.application);
    expect(fresh.check).toEqual(first.check);
    const placement = (await call(AMINA, "GET", `/placements/${placementId}`)).body;
    expect(placement.issuance).toMatchObject({ stage: "applied", applicationId: ids["applicationId"], policyId: ids["policyId"] });
  });

  it("20. another brokerage cannot read or act, and no browser session can write an issuance record", async () => {
    expect((await call(BETA, "GET", `/placements/${placementId}/issuance`)).status).toBe(404);
    expect((await act(BETA, placementId, { action: "run_issued_policy_check" })).status).toBe(404);
    expect((await call(BETA, "POST", `/placements/${placementId}/issuance/preview`, { mode: "create" })).status).toBe(404);
    const tables = ["issuance_requests", "issuance_request_approvals", "issuance_submissions", "issued_policy_documents", "issued_policy_checks",
      "issued_policy_check_items", "issued_policy_resolutions", "policy_issuance_applications"];
    for (const t of tables) {
      expect((await browser(BETA, "GET", `${t}?select=id&organization_id=eq.${ORG_A}`)).body, t).toEqual([]);
      const forged = await browser(AMINA, "POST", t, { organization_id: ORG_A });
      expect(forged.status, t).toBe(403);
      /* Refused by the API-only gate, or — for the select-only application table — by having no grant at all. */
      expect(JSON.stringify(forged.body), t).toMatch(t === "policy_issuance_applications" ? /42501/ : /api_only/);
      expect((await browser(AMINA, "DELETE", `${t}?organization_id=eq.${ORG_A}`)).status, t).toBe(403);
      expect((await browser("anon", "GET", `${t}?select=id`)).status, t).toBeGreaterThanOrEqual(401);
    }
    /* The apply function itself refuses a browser session: it has no server-held key. */
    const rpc = await browser(AMINA, "POST", "rpc/policy_issuance_apply", {
      p_placement_id: placementId, p_check_id: ids["checkId"], p_request_id: ids["requestV2"], p_mode: "create", p_policy_id: null, p_period_id: null,
      p_expected: null, p_values: { period_start: "2026-09-10", period_end: "2027-09-09" }, p_idempotency_key: `forged-${TAG}`,
    });
    expect(rpc.status).toBeGreaterThanOrEqual(400);
    const [inB] = await sql<{ n: number }[]>`select count(*)::int as n from audit_log where organization_id = ${ORG_B} and object_id = ${placementId}`;
    expect(inB!.n).toBe(0);
  });
});
