/**
 * The Policy Space, connected (4C-1).
 *
 * A 4B issuance runs end to end through the real API; the policy it creates is then reopened
 * through `GET /policies/:id/space` under signed-in tokens, through PostgREST, against the
 * migrations. RLS, grants, triggers and the API-key gate are the real ones; no service-role key.
 *
 * Stand-ins, named:
 *  - The insurer's issued document enters as the extractor leaves it: the owner inserts the
 *    `documents`, `document_fields` and `document_term_proposals` rows with pages and regions.
 *    The real extractor is not run here (see the work order's extractor debt).
 *  - Two setups a person would reach through screens not built yet are inserted by the owner: a
 *    historical period, and a reviewed policy schedule applied to a period (`document_applications`,
 *    the 0043 receipt). Each is labelled where it happens. Every read and every action goes
 *    through the API.
 *
 * Dates are relative to today in Nairobi, so cover assertions stay true as the calendar moves.
 */
import { createHash, randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FakeScript } from "../../src/ai/providers/fake.js";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, BETA, browser, buildApp as build, caller, CIC, JUBILEE, KAMAU, newApiKey, ORG_A, ORG_B, OWNER, READER, type Json } from "./_harness.js";

const API_KEY = newApiKey();
const askScript: FakeScript = [];
const buildApp = () => build(API_KEY, askScript);
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const space = async (policyId: string, period?: string, who = AMINA) => call(who, "GET", `/policies/${policyId}/space${period ? `?period=${period}` : ""}`);
const ids: Record<string, unknown> = {};
const TAG = randomUUID().slice(0, 8);

/* Dates in the Nairobi calendar, relative to today. */
const nairobi = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const TODAY = nairobi(new Date());
const shift = (days: number) => { const d = new Date(`${TODAY}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const START = shift(-20);
const END = shift(344);

/*
 * Counts of this test's own records. The connected files run in parallel in one brokerage, so a
 * brokerage-wide count would see the other files' writes; these see only what this file touches.
 */
const mine: { policies: string[]; tag: string } = { policies: [], tag: TAG };
const counts = async () => {
  const pols = mine.policies.length > 0 ? mine.policies : ["00000000-0000-0000-0000-000000000000"];
  const [r] = await sql<{ work: number; periods: number; claims: number; endorsements: number; prepared: number; audits: number }[]>`
    select (select count(*)::int from work_items where organization_id = ${ORG_A}
              and (title like ${"%" + TAG + "%"} or source_id = any(${pols}::uuid[])
                   or id in (select work_item_id from claims where policy_id = any(${pols}::uuid[]))
                   or id in (select work_item_id from endorsements where policy_id = any(${pols}::uuid[])))) as work,
           (select count(*)::int from policy_periods where policy_id = any(${pols}::uuid[])) as periods,
           (select count(*)::int from claims where policy_id = any(${pols}::uuid[])) as claims,
           (select count(*)::int from endorsements where policy_id = any(${pols}::uuid[])) as endorsements,
           (select count(*)::int from prepared_actions where policy_id = any(${pols}::uuid[])) as prepared,
           (select count(*)::int from audit_log where organization_id = ${ORG_A} and object_id = any(${pols}::uuid[])) as audits`;
  return r!;
};

/** A reviewed policy schedule applied to a period, as the 0043 apply flow leaves it (owner setup). */
async function applyScheduleTo(periodId: string, label: string) {
  const [doc] = await sql<{ id: string }[]>`
    insert into documents (organization_id, client_id, kind, filename, mime_type, byte_size, storage_path, content_sha256, page_count, extraction_state, uploaded_by)
    values (${ORG_A}, ${ACME}, 'policy_schedule', ${`${label} ${TAG}.pdf`}, 'application/pdf', 20000, ${`${ORG_A}/policy-space/${label}-${TAG}.pdf`},
            ${createHash("sha256").update(`${label}${TAG}`).digest("hex")}, 2, 'extracted', ${AMINA.id}) returning id`;
  await sql`insert into document_applications (organization_id, document_id, target_type, target_id, changes, applied_by, idempotency_key)
            values (${ORG_A}, ${doc!.id}, 'policy_period', ${periodId}, '[]'::jsonb, ${AMINA.id}, ${`ps-${label}-${TAG}`})`;
  return doc!.id;
}

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-policy-space')`;
  app = buildApp();
});
afterAll(async () => {
  if (process.env["CONNECTED_POLICY_REPORT"]) writeFileSync(process.env["CONNECTED_POLICY_REPORT"], JSON.stringify(ids, null, 2));
  await sql.end();
});

describe("the Policy Space, connected to a real database", () => {
  let placementId = "";
  let policyId = "";
  let periodId = "";
  let documentId = "";

  it("1. completes a 4B issuance application through the API", async () => {
    const created = await call(AMINA, "POST", "/opportunities", { clientId: ACME, title: `Policy Space fleet — ${TAG}`, classOfBusiness: "Commercial motor", requestKey: randomUUID() });
    const opportunityId = created.body.opportunityId as string;
    for (const insurerId of [JUBILEE, CIC]) await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "add_insurer", insurerId });
    let opp = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const by = (id: string) => opp.insurers.find((i: { insurerId: string }) => i.insurerId === id);
    for (const [insurerId, premium] of [[JUBILEE, "5310000.00"], [CIC, "5620000.00"]] as const) {
      expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, {
        action: "record_response", withoutRequest: true, opportunityInsurerId: by(insurerId).id, outcome: "quoted", receivedAt: `${shift(-30)}T09:00:00.000Z`,
        premiumAmount: premium, premiumCurrency: "KES", validUntil: shift(300), sourceNote: "Quotation letter received by email.",
      })).body.outcome).toBe("done");
    }
    opp = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const responseId = by(JUBILEE).response.id;
    await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "record_term", insurerResponseId: responseId, termType: "excess", label: "Own damage", extractedValue: "5% min KES 30,000" });
    const generated = await call(AMINA, "POST", `/opportunities/${opportunityId}/comparison/actions`, { action: "generate_comparison" });
    await call(AMINA, "POST", `/opportunities/${opportunityId}/comparison/actions`, { action: "present_comparison", comparisonId: generated.body.comparison.comparison.id });
    const instructed = await call(AMINA, "POST", `/opportunities/${opportunityId}/instruction`, {
      insurerResponseId: responseId, source: "email", evidenceNote: "Client emailed choosing Jubilee on the terms shown.",
      instructedAt: `${shift(-28)}T10:40:00.000Z`, requestedEffectiveAt: `${START}T00:00:00.000Z`, requestedExpiryAt: `${END}T00:00:00.000Z`,
    });
    placementId = instructed.body.placementId;
    ids["placementId"] = placementId;
    const pAct = (body: unknown) => call(AMINA, "POST", `/placements/${placementId}/actions`, body);
    await pAct({ action: "prepare_request", subject: "Placement request", body: "Please place cover on the quoted terms.", coverRequested: "Commercial motor" });
    let p = (await call(AMINA, "GET", `/placements/${placementId}`)).body;
    await pAct({ action: "approve_request", placementRequestId: p.request.id });
    await pAct({ action: "record_submission", placementRequestId: p.request.id, method: "recorded_manual_email", recipient: "uw@jubilee.test", sentAt: `${shift(-27)}T11:02:00.000Z`, evidenceNote: "Sent from my mailbox to the Jubilee desk.", idempotencyKey: `ps-${placementId}` });
    expect((await pAct({ action: "record_insurer_response", outcome: "confirmed_as_requested", receivedAt: `${shift(-25)}T14:10:00.000Z`, effectiveAt: `${START}T00:00:00.000Z`, expiryAt: `${END}T00:00:00.000Z`, insurerReference: `CN-${TAG}`, evidenceNote: "Cover note received by email." })).body.outcome).toBe("done");
    p = (await call(AMINA, "GET", `/placements/${placementId}`)).body;
    expect(p.readiness.state).toBe("ready");

    const iss = (body: unknown) => call(AMINA, "POST", `/placements/${placementId}/issuance/actions`, body);
    const v1 = (await iss({ action: "prepare_issuance_request", requiredDocuments: ["Policy schedule"] })).body.issuance;
    await iss({ action: "approve_issuance_request", issuanceRequestId: v1.request.id });
    await iss({ action: "record_issuance_submission", issuanceRequestId: v1.request.id, method: "recorded_manual_email", recipient: "policy@jubilee.test", sentAt: `${shift(-22)}T08:30:00.000Z`, evidenceNote: "Sent from my mailbox to the Jubilee policy desk.", idempotencyKey: `ps-sub-${TAG}` });

    /* Extractor-style output, inserted by the owner (the named stand-in). */
    const [doc] = await sql<{ id: string }[]>`
      insert into documents (organization_id, client_id, kind, filename, mime_type, byte_size, storage_path, content_sha256, page_count, extraction_state, uploaded_by)
      values (${ORG_A}, ${ACME}, 'policy_schedule', ${`Jubilee schedule ${TAG}.pdf`}, 'application/pdf', 48211, ${`${ORG_A}/policy-space/${TAG}.pdf`}, ${createHash("sha256").update(`ps${TAG}`).digest("hex")}, 3, 'extracted', ${AMINA.id}) returning id`;
    documentId = doc!.id;
    ids["documentId"] = documentId;
    const client = p.client.name as string;
    const fields: [string, string, number][] = [["insured_name", client, 1], ["insurer_name", p.insurer.name, 1], ["policy_number", `JUB/PS/${TAG}`, 1], ["class_of_business", "Commercial motor", 1], ["period_start", START, 1], ["period_end", END, 1], ["currency", "KES", 2], ["premium", "5,310,000.00", 2]];
    for (const [i, [k, v, page]] of fields.entries()) {
      await sql`insert into document_fields (organization_id, document_id, field_key, proposed_value, page_number, region_x, region_y, region_width, region_height, condition)
                values (${ORG_A}, ${documentId}, ${k}, ${v}, ${page}, 72, ${120 + i * 24}, 260, 18, 'inferred')`;
    }
    await sql`insert into document_term_proposals (organization_id, document_id, ordinal, term_type, label, proposed_value, page_number, region_x, region_y, region_width, region_height, method)
              values (${ORG_A}, ${documentId}, 0, 'excess', 'Own damage', '7.5% min KES 45,000', 3, 72, 300, 300, 18, 'schedule-table')`;
    await iss({ action: "record_issued_policy_document", documentId, receivedAt: `${shift(-21)}T09:00:00.000Z` });
    let v = (await call(AMINA, "GET", `/placements/${placementId}/issuance`)).body;
    for (const f of v.documents[0].fields) {
      /* The policy number was misread: a person corrects it. */
      if (f.key === "policy_number") await iss({ action: "review_issued_field", documentFieldId: f.id, decision: "correct", correctedValue: `JUB/PS/${TAG}-A` });
      else await iss({ action: "review_issued_field", documentFieldId: f.id, decision: "accept" });
    }
    await iss({ action: "review_issued_term", proposalId: v.documents[0].terms[0].id, decision: "accept" });
    v = (await iss({ action: "run_issued_policy_check" })).body.issuance;
    const diff = v.check.items.find((i: Json) => i.label === "Own damage");
    await iss({ action: "resolve_issued_policy_difference", itemId: diff.id, resolution: "client_accepted_issued_value", reason: "The client accepted the higher own-damage excess.", resolvedAt: `${shift(-19)}T10:00:00.000Z`, evidenceNote: "Client's email accepting the issued excess, filed." });
    const applied = await iss({ action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: `ps-apply-${TAG}` });
    expect(applied.body.outcome).toBe("done");
    policyId = applied.body.issuance.application.policyId;
    periodId = applied.body.issuance.application.policyPeriodId;
    ids["policyId"] = policyId;
    ids["periodId"] = periodId;
    ids["applicationId"] = applied.body.issuance.application.id;
    mine.policies.push(policyId);
  });

  it("2–3. the created policy reopens through the Policy Space with the right period", async () => {
    const res = await space(policyId);
    expect(res.status).toBe(200);
    const v = res.body;
    expect(v.policy.id).toBe(policyId);
    expect(v.periods).toEqual([expect.objectContaining({ id: periodId, start: START, end: END, origin: "issuance", when: "current" })]);
    expect(v).toMatchObject({ selectedPeriodId: periodId, selection: "current", conflicts: [] });
    expect(v.title).toContain(`JUB/PS/${TAG}-A`);
  });

  it("4. links back to the placement, the confirmation, the issued document and the application receipt", async () => {
    const v = (await space(policyId)).body;
    expect(v.issuance).toMatchObject({ placementId, applicationId: ids["applicationId"], targetMode: "create", links: { documentId } });
    expect(v.issuance.links.coverConfirmationId).toMatch(/^[0-9a-f-]{36}$/);
    const kinds = v.related.map((r: Json) => r.kind);
    for (const k of ["client", "placement", "issuance", "quotation", "comparison", "document"]) expect(kinds).toContain(k);
    expect(v.actions.find((a: Json) => a.key === "open_issuance")).toMatchObject({ available: true, path: `/placements/${placementId}/issuance` });
  });

  it("5. cover state is the server's, with the evidence behind it", async () => {
    const v = (await space(policyId)).body;
    expect(v.cover).toMatchObject({ state: "active", label: "Active cover", verified: true, asOf: TODAY });
    const kinds = v.cover.evidence.map((e: Json) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["cover_confirmation", "issued_document", "issuance_application"]));
    expect(v.money.statement).toMatch(/not known/);
    expect(JSON.stringify(v)).not.toMatch(/\b(Unpaid|Part paid|Paid|Reconciled)\b/);
  });

  it("6. evidence opens the right page and region, and a corrected value says so", async () => {
    const v = (await space(policyId)).body;
    const num = v.facts.find((f: Json) => f.key === "policy_number");
    expect(num).toMatchObject({ value: `JUB/PS/${TAG}-A`, source: "corrected" });
    expect(num.evidence).toMatchObject({ documentId, page: 1, region: { x: 72, y: 168, width: 260, height: 18 } });
    const fieldId = new URL(`https://x${num.evidence.path}`).searchParams.get("field");
    const doc = (await call(AMINA, "GET", `/documents/${documentId}`)).body;
    const field = doc.fields.find((f: Json) => f.id === fieldId);
    expect(field).toMatchObject({ fieldKey: "policy_number", page: 1, region: { x: 72, y: 168, width: 260, height: 18 } });
    const term = v.terms.find((t: Json) => t.label === "Own damage");
    expect(term).toMatchObject({ agreed: "5% min KES 30,000", confirmed: "5% min KES 30,000", issued: "7.5% min KES 45,000", final: "7.5% min KES 45,000", difference: { words: "Changed", resolved: true } });
    expect(term.evidence).toMatchObject({ page: 3, region: { x: 72, y: 300 } });
    expect(v.differences.find((d: Json) => d.label === "Own damage")).toMatchObject({ resolved: true });
  });

  it("7. a historical period joins, and both stay readable", async () => {
    /* Owner setup: an earlier year recorded before ASAP, with no evidence. */
    const [prior] = await sql<{ id: string }[]>`insert into policy_periods (organization_id, policy_id, period_start, period_end) values (${ORG_A}, ${policyId}, ${shift(-385)}, ${shift(-21)}) returning id`;
    ids["priorPeriodId"] = prior!.id;
    const v = (await space(policyId)).body;
    expect(v.periods.map((p: Json) => p.id)).toEqual([prior!.id, periodId]);
    expect(v).toMatchObject({ selectedPeriodId: periodId, cover: { state: "active" } });
    const old = (await space(policyId, prior!.id)).body;
    expect(old).toMatchObject({ selectedPeriodId: prior!.id, selection: "requested" });
    expect(old.periods.find((p: Json) => p.id === prior!.id).cover).toMatchObject({ state: null, label: "Cover not verified" });
    expect(old.facts.find((f: Json) => f.key === "inception")).toMatchObject({ value: shift(-385), source: "unverified" });
  });

  it("8. a future period, even confirmed on evidence, is not active cover", async () => {
    const [next] = await sql<{ id: string }[]>`insert into policy_periods (organization_id, policy_id, period_start, period_end) values (${ORG_A}, ${policyId}, ${shift(345)}, ${shift(709)}) returning id`;
    ids["futurePeriodId"] = next!.id;
    ids["futureScheduleId"] = await applyScheduleTo(next!.id, "future-schedule");
    const v = (await space(policyId, next!.id)).body;
    const p = v.periods.find((x: Json) => x.id === next!.id);
    expect(p).toMatchObject({ when: "future", cover: { state: "confirmed", label: "Confirmed", verified: true } });
    expect(v.cover.state).toBe("active"); /* the policy today is still the current period */
  });

  let legacyId = "";
  let legacyPeriod = "";
  it("11. a legacy policy recorded by hand is never called active", async () => {
    const res = await call(AMINA, "POST", "/policies", { clientId: ACME, insurerName: "Legacy Insurer Ltd", classOfBusiness: `Fire ${TAG}`, periodStart: shift(-10), periodEnd: shift(300) });
    expect(res.body.outcome).toBe("recorded");
    legacyId = res.body.policy.policy.id;
    legacyPeriod = res.body.policy.periods[0].id;
    ids["legacyPolicyId"] = legacyId;
    mine.policies.push(legacyId);
    const v = (await space(legacyId)).body;
    expect(v.cover).toMatchObject({ state: null, label: "Cover not verified", verified: false });
    expect(v.facts.find((f: Json) => f.key === "policy_number")).toMatchObject({ value: null, source: "missing" });
    expect(v.gaps.join(" ")).toMatch(/No coverage terms/);
    expect(v.actions.find((a: Json) => a.key === "open_placement")).toMatchObject({ available: false });
  });

  it("9–10. overlapping current periods are a conflict, the server chooses neither, and one Work item asks a person", async () => {
    const [second] = await sql<{ id: string }[]>`insert into policy_periods (organization_id, policy_id, period_start, period_end) values (${ORG_A}, ${legacyId}, ${shift(-5)}, ${shift(360)}) returning id`;
    ids["overlapPeriodId"] = second!.id;
    const v = (await space(legacyId)).body;
    expect(v.selectedPeriodId).toBeNull();
    expect(v.selection).toBe("none");
    expect(v.cover).toMatchObject({ state: null, label: "Two periods both cover today" });
    expect(v.conflicts).toEqual([expect.objectContaining({ kind: "overlapping_periods", periodIds: [legacyPeriod, second!.id].sort() })]);
    await space(legacyId);
    const work = await sql<{ id: string; task_status: string }[]>`select id, task_status from work_items where source_type = 'policy' and source_id = ${legacyId} and reason_code = 'resolve_overlapping_periods'`;
    expect(work).toHaveLength(1);
    expect(work[0]!.task_status).toBe("needs_you");
    ids["overlapWorkItemId"] = work[0]!.id;
    expect((await space(legacyId)).body.work.map((w: Json) => w.id)).toContain(work[0]!.id);
    /* A person may read one of them by naming it; it is still not called covered. */
    expect((await space(legacyId, second!.id)).body).toMatchObject({ selectedPeriodId: second!.id, cover: { state: null } });
  });

  it("12. an expired verified period is called expired", async () => {
    const res = await call(AMINA, "POST", "/policies", { clientId: ACME, insurerName: "Legacy Insurer Ltd", classOfBusiness: `Marine ${TAG}`, policyNumber: `MAR/${TAG}`, periodStart: shift(-400), periodEnd: shift(-36) });
    const expiredId = res.body.policy.policy.id as string;
    ids["expiredPolicyId"] = expiredId;
    mine.policies.push(expiredId);
    await applyScheduleTo(res.body.policy.periods[0].id, "expired-schedule");
    const v = (await space(expiredId)).body;
    expect(v.cover).toMatchObject({ state: "expired", label: "Expired", verified: true });
    expect(v.timeline.some((e: Json) => /ended/.test(e.text))).toBe(true);
  });

  it("14. starting the same renewal twice creates one workflow", async () => {
    const before = await counts();
    const first = await call(AMINA, "POST", `/policies/${policyId}/renewal`, {});
    const second = await call(AMINA, "POST", `/policies/${policyId}/renewal`, {});
    expect(first.body.outcome).toBe("done");
    expect(second.body).toMatchObject({ outcome: "already", workItemId: first.body.workItemId });
    expect((await counts()).work).toBe(before.work + 1);
    ids["renewalWorkItemId"] = first.body.workItemId;
    const v = (await space(policyId)).body;
    expect(v.actions.find((a: Json) => a.key === "start_renewal")).toMatchObject({ label: "Open the renewal", path: `/r/${first.body.workItemId}` });
    expect(v.related.some((r: Json) => r.kind === "renewal")).toBe(true);
    /* A read-only member may not start one. */
    expect((await call(READER, "POST", `/policies/${policyId}/renewal`, {})).body.outcome).toBe("blocked");
  });

  it("15. claim and endorsement forms preselect from the server, and write nothing until the facts are given", async () => {
    const before = await counts();
    const v = (await space(policyId)).body;
    const claim = v.actions.find((a: Json) => a.key === "report_claim");
    const endo = v.actions.find((a: Json) => a.key === "request_endorsement");
    expect(claim.path).toBe(`/new/claim?policy=${policyId}&period=${periodId}`);
    expect(endo.path).toBe(`/new/endorsement?policy=${policyId}&period=${periodId}`);
    const ctx = await call(AMINA, "GET", `/creation-context?policy=${policyId}&period=${periodId}`);
    expect(ctx.status).toBe(200);
    expect(ctx.body).toMatchObject({ client: { id: ACME }, policy: { id: policyId, policyNumber: `JUB/PS/${TAG}-A` }, period: { id: periodId, start: START, end: END } });
    /* Opening the form wrote nothing; submitting without the incident is refused. */
    const incomplete = await call(AMINA, "POST", "/work-items", { kind: "claim", clientId: ACME, policyId });
    expect(incomplete.status).toBe(422);
    expect(await counts()).toEqual(before);
    /* Another brokerage cannot preselect this policy, nor this client. */
    expect((await call(BETA, "GET", `/creation-context?policy=${policyId}`)).status).toBe(404);
    expect((await call(BETA, "GET", `/creation-context?client=${ACME}`)).status).toBe(404);
    /* A claim given its facts is filed against the preselected policy. */
    const filed = await call(AMINA, "POST", "/work-items", { kind: "claim", clientId: ACME, policyId, incidentOn: TODAY, incidentSummary: "Vehicle damaged in a collision at the depot.", source: "manual" });
    expect(filed.body.outcome).toBe("opened");
    expect(filed.body.item.title).toContain(`JUB/PS/${TAG}-A`);
    /* The same click again is the same claim. */
    const again = await call(AMINA, "POST", "/work-items", { kind: "claim", clientId: ACME, policyId, incidentOn: TODAY, incidentSummary: "Vehicle damaged in a collision at the depot.", source: "manual" });
    expect(again.body).toMatchObject({ outcome: "opened", reopened: true, item: { id: filed.body.item.id } });
    const [c] = await sql<{ policy_id: string }[]>`select policy_id from claims where work_item_id = ${filed.body.item.id}`;
    expect(c!.policy_id).toBe(policyId);
    ids["claimWorkItemId"] = filed.body.item.id;
    expect((await space(policyId)).body.timeline.some((e: Json) => /Claim reported/.test(e.text))).toBe(true);
  });

  let preparedId = "";
  it("18. Ask's read tools write nothing", async () => {
    askScript.push({
      match: /is this policy active/i,
      reply: { text: "", toolCalls: [{ id: "g1", name: "get_policy_space", arguments: { policyId: legacyId } }], stop: "tool_use" },
      then: { text: JSON.stringify({ type: "answer", target: null, panel: null, view: "summary", answer: "Cover is not stated: two periods on this policy both cover today, and neither is verified. Which period is right?", suggestions: [] }), toolCalls: [], stop: "end" },
    });
    const before = await counts();
    const asked = await call(AMINA, "POST", "/ask", { question: "Is this policy active?", scope: { kind: "policy", id: legacyId } });
    expect(asked.status).toBe(200);
    expect(asked.body.message.tools_used.map((t: Json) => t.name)).toEqual(["get_policy_space"]);
    expect(await counts()).toEqual(before);
  });

  it("19. a prepared renewal start waits for confirmation", async () => {
    askScript.push({
      match: /start the renewal/i,
      reply: { text: "", toolCalls: [{ id: "p1", name: "prepare_policy_action", arguments: { actionType: "start_renewal", policyId: legacyId } }], stop: "tool_use" },
      then: { text: JSON.stringify({ type: "answer", target: null, panel: null, view: "summary", answer: "I have prepared the renewal. It waits on the policy for you to confirm; nothing is started until you do.", suggestions: [] }), toolCalls: [], stop: "end" },
    });
    const before = await counts();
    const asked = await call(AMINA, "POST", "/ask", { question: "Start the renewal", scope: { kind: "policy", id: legacyId } });
    expect(asked.body.message.tools_used.map((t: Json) => t.name)).toEqual(["prepare_policy_action"]);
    const [row] = await sql<{ id: string; state: string; policy_id: string; action_type: string }[]>`select id, state, policy_id, action_type from prepared_actions where policy_id = ${legacyId}`;
    expect(row).toMatchObject({ state: "prepared", policy_id: legacyId, action_type: "start_renewal" });
    preparedId = row!.id;
    ids["preparedActionId"] = preparedId;
    const after = await counts();
    expect(after.work).toBe(before.work);
    expect(after.prepared).toBe(before.prepared + 1);
    expect((await call(KAMAU, "POST", `/prepared-actions/${preparedId}/confirm`)).body.outcome).toBe("refused");
    const done = await call(AMINA, "POST", `/prepared-actions/${preparedId}/confirm`);
    expect(done.body.outcome).toBe("done");
    expect(done.body.action.receipt.message).toMatch(/Start the renewal .* — done/);
    expect((await counts()).work).toBe(before.work + 1);
  });

  it("20. replaying the confirmation returns the existing receipt", async () => {
    const before = await counts();
    const first = (await sql<{ receipt: unknown }[]>`select receipt from prepared_actions where id = ${preparedId}`)[0]!.receipt;
    const again = await call(AMINA, "POST", `/prepared-actions/${preparedId}/confirm`);
    expect(again.body.outcome).toBe("already");
    expect(again.body.action.receipt.message).toBe((first as { message: string }).message);
    expect((await counts()).work).toBe(before.work);
  });

  it("13. cancellation is shown only from an explicit, evidenced record", async () => {
    expect((await space(policyId)).body.cover.state).toBe("active");
    const cancelled = await call(AMINA, "POST", `/placements/${placementId}/actions`, {
      action: "record_cancellation", cancelledAt: new Date(Date.now() - 60_000).toISOString(),
      reason: "The client sold the fleet and asked for cancellation.", evidenceNote: "Client's written request received by email today.",
    });
    expect(cancelled.body.outcome).toBe("done");
    const v = (await space(policyId)).body;
    expect(v.cover).toMatchObject({ state: "cancelled", label: "Cancelled" });
    expect(v.cover.evidence[0]).toMatchObject({ kind: "cancellation" });
    /* The legacy policy, with no cancellation record, is not cancelled. */
    expect((await space(legacyId)).body.cover.state).not.toBe("cancelled");
  });

  it("16. re-reading after a refresh, and on a fresh API instance, gives the same state", async () => {
    const first = (await space(policyId)).body;
    app = buildApp();
    const fresh = (await space(policyId)).body;
    for (const k of ["cover", "periods", "facts", "terms", "selectedPeriodId", "issuance", "conflicts", "actions"]) expect(fresh[k], k).toEqual(first[k]);
  });

  it("17. another brokerage gets 404 and no related evidence", async () => {
    expect((await space(policyId, undefined, BETA)).status).toBe(404);
    expect((await space(legacyId, undefined, BETA)).status).toBe(404);
    expect((await call(BETA, "POST", `/policies/${policyId}/renewal`, {})).status).toBe(404);
    expect((await call(BETA, "POST", `/policies/${policyId}/prepare`, { actionType: "start_renewal" })).status).toBe(404);
    for (const t of ["policies", "policy_periods", "policy_issuance_applications", "document_applications", "documents", "document_fields", "prepared_actions", "placement_cancellations"]) {
      expect((await browser(BETA, "GET", `${t}?select=id&organization_id=eq.${ORG_A}`)).body, t).toEqual([]);
    }
    const [inB] = await sql<{ n: number }[]>`select count(*)::int as n from audit_log where organization_id = ${ORG_B} and object_id = ${policyId}`;
    expect(inB!.n).toBe(0);
    /* A browser session cannot write a policy-scoped prepared action directly. */
    const forged = await browser(AMINA, "POST", "prepared_actions", { organization_id: ORG_A, policy_id: policyId });
    expect(forged.status).toBeGreaterThanOrEqual(400);
  });
});
