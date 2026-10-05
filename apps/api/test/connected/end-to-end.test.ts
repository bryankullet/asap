/**
 * End to end (Phase 10, D-148): one client from an enquiry email to an issued policy, and a claim
 * reported by email to its registration — against a real database, through the API, with the
 * worker's event dispatch driven by hand and the gateway's deterministic provider sorting the email.
 *
 * Asserted throughout: the run states, the Work copy, the audit rows, and that nothing left the
 * brokerage — no mailbox is connected in this brokerage, so every external message is approved and
 * then delivered by a person, and no send attempt exists.
 *
 * No stand-ins where the suite runs whole (D-153): the client's file is cleared through the API,
 * the policy schedule arrives as an email attachment that is kept as a document, and the real
 * extractor reads it. Only where no extractor is running does the test insert its output instead.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FakeScript } from "../../src/ai/providers/fake.js";
import type { createApp } from "../../src/app.js";
import { textPdf } from "./_pdf.js";
import { AMINA, buildApp, caller, CIC, JUBILEE, newApiKey, ORG_A, OWNER } from "./_harness.js";

const API_KEY = newApiKey();
const TAG = randomUUID().slice(0, 6).toUpperCase();
const as = (kind: string, confidence = 0.95) => ({ text: JSON.stringify({ kind, confidence, reason: "Read from the email." }), toolCalls: [], stop: "end" as const });
const script: FakeScript = [
  { match: new RegExp(`ENQ-${TAG}`), reply: as("new_enquiry") },
  { match: new RegExp(`JQ-${TAG}`), reply: as("insurer_quote", 0.96) },
  { match: new RegExp(`CQ-${TAG}`), reply: as("insurer_quote") },
  { match: new RegExp(`CONF-${TAG}`), reply: as("insurer_confirmation") },
  { match: new RegExp(`POL-${TAG}`), reply: as("policy_document") },
  { match: new RegExp(`CLAIM-${TAG}`), reply: as("claim_notice") },
  { match: new RegExp(`REG-${TAG}`), reply: as("claim_update") },
  { match: new RegExp(`ENDT-${TAG}`), reply: as("endorsement_request") },
];
const CLIENT = `Tausi Freight ${TAG} Ltd`;
const CLIENT_EMAIL = `ops-${TAG.toLowerCase()}@tausifreight.test`;
const POLICY_NUMBER = `JUB/MTR/E2E/${TAG}`;
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const started = new Date().toISOString();
const watched = new Set<string>();
let clientId = "";
let opportunityId = "";
let placementId = "";
let jubileeName = "";

async function pump() {
  for (let round = 0; round < 8; round++) {
    const ids = [...watched];
    const runIds = (await sql`select id from workflow_runs where subject_id = any(${ids}::uuid[])`).map((r) => r["id"] as string);
    const evs = await sql`select id from events where organization_id = ${ORG_A} and processed_at is null and occurred_at >= ${started}
      and (entity_id = any(${[...ids, ...runIds]}::uuid[]) or payload->>'opportunityId' = any(${ids}::text[]) or payload->>'placementId' = any(${ids}::text[])) order by occurred_at`;
    if (!evs.length) return;
    for (const e of evs) {
      expect((await app.request(`/internal/events/${e["id"]}/dispatch`, { method: "POST", headers: { "x-asap-internal-key": API_KEY } })).status).toBe(200);
      await sql`update events set processed_at = now() where id = ${e["id"]}`;
    }
  }
}
const paste = async (body: Record<string, unknown>) => {
  const r = await call(AMINA, "POST", "/inbound/messages", body);
  expect(r.status).toBe(201);
  watched.add(r.body.emailMessageId);
  await pump();
  return r.body.emailMessageId as string;
};
const run = async (workflow: string, subject: string) => (await sql`select id, state, current_step, exception from workflow_runs where workflow = ${workflow} and subject_id = ${subject}`)[0];
const sorted = async (messageId: string) => (await sql`select kind, state, routed_run_id, routed_by, work_item_id from inbound_classifications where email_message_id = ${messageId}`)[0]!;
const oppWork = async () => (await sql`select w.task_status, w.task_party, w.task_since, w.required_action from work_items w join opportunities o on o.work_item_id = w.id where o.id = ${opportunityId}`)[0]!;
const placementWork = async () => (await sql`select task_status, task_party, required_action, reason_code from work_items where source_id = ${placementId} and task_status <> 'done' order by created_at desc limit 1`)[0];
const pAct = (body: unknown) => call(AMINA, "POST", `/placements/${placementId}/actions`, body);
const iAct = (body: unknown) => call(AMINA, "POST", `/placements/${placementId}/issuance/actions`, body);
const noSends = async () => expect((await sql`select count(*)::int as n from email_send_attempts where organization_id = ${ORG_A}`)[0]!["n"]).toBe(0);

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-end-to-end')`;
  app = buildApp(API_KEY, script);
  // The client, opened and cleared by a person through the API (D-153): ASAP will not prepare
  // placement on an uncleared file.
  expect((await call(AMINA, "POST", "/clients", { name: CLIENT, kind: "corporate", confirmNew: true })).body.outcome).toBe("created");
  clientId = (await sql`select id from clients where organization_id = ${ORG_A} and name = ${CLIENT}`)[0]!["id"] as string;
  await sql`insert into client_contacts (organization_id, client_id, full_name, email, is_primary, source) values (${ORG_A}, ${clientId}, 'Achieng Odhiambo', ${CLIENT_EMAIL}, true, 'manual')`;
  const file = (body: Record<string, unknown>) => call(AMINA, "POST", `/clients/${clientId}/file`, body);
  expect((await file({ action: "record_document", kind: "identity", label: "Certificate of incorporation", reference: `CPR/2019/${TAG}` })).status).toBe(200);
  expect((await file({ action: "record_document", kind: "beneficial_ownership", label: "Beneficial ownership declaration", reference: `BO/${TAG}` })).status).toBe(200);
  expect((await file({ action: "start_review" })).status).toBe(200);
  expect((await file({ action: "clear", reason: "Identity and beneficial ownership verified.", refreshIntervalDays: 365 })).status).toBe(200);
  expect((await sql`select file_status from clients where id = ${clientId}`)[0]!["file_status"]).toBe("cleared");
  jubileeName = (await sql`select name from insurers where id = ${JUBILEE}`)[0]!["name"] as string;
  watched.add(clientId);
});
afterAll(async () => {
  await sql.end();
});

describe("one client, from an enquiry email to an issued policy", () => {
  it("1. the enquiry is pasted in; ASAP proposes a new quotation, a person opens it, and the email is filed to it", async () => {
    const id = await paste({ from: CLIENT_EMAIL, subject: "Cover for our trucks", body: `Hello, please quote comprehensive cover for our five Isuzu FRR trucks from 10 September. ENQ-${TAG}` });
    const s = await sorted(id);
    expect(s).toMatchObject({ kind: "new_enquiry", state: "unsorted" });
    const [w] = await sql`select kind, required_action, reason from work_items where id = ${s["work_item_id"]}`;
    expect(w).toMatchObject({ kind: "inbound", required_action: "Open the quotation if it is one" });
    expect(String(w!["reason"])).toMatch(/ASAP thinks this is: a client or prospect asking for new cover or a quotation \(95% sure\)/);

    const created = await call(AMINA, "POST", "/opportunities", { clientId, title: `Fleet cover ${TAG}`, classOfBusiness: "Commercial motor", riskSummary: "Five Isuzu FRR trucks", requestKey: randomUUID() });
    expect(created.status).toBe(201);
    opportunityId = created.body.opportunityId;
    watched.add(opportunityId);
    await pump();
    const q = await run("quotation", opportunityId);
    expect(q).toMatchObject({ state: "waiting_party", current_step: "insurers" });
    expect((await call(AMINA, "POST", `/inbound/messages/${id}/decision`, { decision: "route", runId: q!["id"] })).body).toMatchObject({ outcome: "done", state: "routed" });
    expect((await sql`select task_status from work_items where id = ${s["work_item_id"]}`)[0]!["task_status"]).toBe("done");
  });

  it("2. a person chooses the insurers; ASAP prepares both requests and asks for one approval; a person approves and delivers", async () => {
    for (const insurerId of [JUBILEE, CIC]) await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "add_insurer", insurerId });
    await pump();
    const q = await run("quotation", opportunityId);
    expect(q).toMatchObject({ state: "waiting_approval", current_step: "approval" });
    expect(String((await oppWork())["required_action"])).toMatch(/^Review and approve the quotation requests to /);
    const [a] = await sql`select id, bundle_sha256 from workflow_approvals where run_id = ${q!["id"]}`;
    expect((await call(AMINA, "POST", `/workflow-approvals/${a!["id"]}/decide`, { decision: "approve", bundleSha256: a!["bundle_sha256"] })).status).toBe(200);
    await pump();
    expect(String((await oppWork())["required_action"])).toMatch(/^Deliver the approved requests to /);
    const o = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    for (const i of o.insurers) {
      const address = i.insurerId === JUBILEE ? "underwriting@jubilee.test" : "quotes@cic.test";
      expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "record_delivery", quoteRequestId: i.request.id, method: "own_email", reference: `Emailed ${address} from my mailbox` })).body.outcome).toBe("done");
    }
    await pump();
    expect(await run("quotation", opportunityId)).toMatchObject({ state: "waiting_party", current_step: "await_terms" });
    const w = await oppWork();
    expect(w["task_status"]).toBe("with_party");
    expect(w["task_since"]).not.toBeNull();
    await noSends();
  });

  it("3. both insurers' replies are pasted in and filed to the quotation by ASAP; a person records each; ASAP compares", async () => {
    const o = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const subjectOf = (id: string) => o.insurers.find((i: { insurerId: string }) => i.insurerId === id).request.subject;
    const q = await run("quotation", opportunityId);
    const j = await paste({ from: "underwriting@jubilee.test", subject: `RE: ${subjectOf(JUBILEE)}`, body: `Our quotation JQ-${TAG}: premium KES 5,310,000 for the five trucks.` });
    const c = await paste({ from: "quotes@cic.test", subject: `RE: ${subjectOf(CIC)}`, body: `CIC terms CQ-${TAG}: premium KES 5,620,000.` });
    for (const m of [j, c]) expect(await sorted(m)).toMatchObject({ state: "routed", routed_by: "auto", routed_run_id: q!["id"] });
    // ASAP read each reply's own words into a proposal (D-152); a person confirms or corrects it.
    expect(String((await oppWork())["required_action"])).toMatch(/^Confirm .*'s reply as ASAP read it — KES 5,(310|620),000 — or correct it$/);
    const proposals = await sql`select id, opportunity_insurer_id, premium_amount::text as premium, state from insurer_response_proposals where opportunity_id = ${opportunityId}`;
    expect(proposals.map((p) => p["premium"]).sort()).toEqual(["5310000.00", "5620000.00"]);
    expect((await sql`select count(*)::int as n from insurer_responses where opportunity_id = ${opportunityId}`)[0]!["n"]).toBe(0);
    const jub = o.insurers.find((i: { insurerId: string }) => i.insurerId === JUBILEE);
    const cic = o.insurers.find((i: { insurerId: string }) => i.insurerId === CIC);
    const pOf = (oiId: string) => proposals.find((p) => p["opportunity_insurer_id"] === oiId)!["id"];
    expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "record_response", opportunityInsurerId: jub.id, outcome: "quoted", validUntil: "2027-06-30", fromProposalId: pOf(jub.id) })).body.outcome).toBe("done");
    await pump();
    expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "record_response", opportunityInsurerId: cic.id, outcome: "quoted", premiumAmount: "5600000.00", validUntil: "2027-06-30", fromProposalId: pOf(cic.id) })).body.outcome).toBe("done");
    await pump();
    const [jr] = await sql`select premium_amount::text as premium, source_email_message_id from insurer_responses where opportunity_insurer_id = ${jub.id}`;
    expect(jr).toMatchObject({ premium: "5310000.00", source_email_message_id: j });
    expect((await sql`select state from insurer_response_proposals where id = ${pOf(jub.id)}`)[0]!["state"]).toBe("corrected");
    expect((await sql`select state from insurer_response_proposals where id = ${pOf(cic.id)}`)[0]!["state"]).toBe("corrected");
    expect(await run("quotation", opportunityId)).toMatchObject({ state: "waiting_party", current_step: "hand_over" });
    const [cmp] = await sql`select generated_by, generated_by_run_id from quote_comparisons where opportunity_id = ${opportunityId} and superseded_at is null`;
    expect(cmp).toMatchObject({ generated_by: null, generated_by_run_id: q!["id"] });
    expect((await oppWork())["required_action"]).toBe(`Present the options to ${CLIENT} and record their instruction`);
  });

  it("4. a person presents the options and records the client's instruction; quotation finishes; placement starts and prepares its request", async () => {
    const cmp = (await call(AMINA, "GET", `/opportunities/${opportunityId}/comparison`)).body;
    await call(AMINA, "POST", `/opportunities/${opportunityId}/comparison/actions`, { action: "present_comparison", comparisonId: cmp.comparison.id });
    const o = (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;
    const jub = o.insurers.find((i: { insurerId: string }) => i.insurerId === JUBILEE);
    const instructed = await call(AMINA, "POST", `/opportunities/${opportunityId}/instruction`, {
      insurerResponseId: jub.response.id, source: "email", evidenceNote: "Client emailed choosing Jubilee.",
      instructedAt: "2026-09-07T10:40:00.000Z", requestedEffectiveAt: "2026-09-10T00:00:00.000Z", requestedExpiryAt: "2027-09-09T00:00:00.000Z",
    });
    expect(instructed.body.outcome).toBe("done");
    placementId = instructed.body.placementId;
    watched.add(placementId);
    await pump();
    expect((await run("quotation", opportunityId))!["state"]).toBe("done");
    expect((await sql`select outcome from workflow_receipts r join workflow_runs w on w.id = r.run_id where w.subject_id = ${opportunityId}`)[0]!["outcome"]).toBe("Client instruction recorded — placement starts");
    expect(await run("placement", placementId)).toMatchObject({ state: "waiting_approval", current_step: "approval" });
    const [req] = await sql`select prepared_by, prepared_by_run_id from placement_requests where placement_id = ${placementId}`;
    expect(req!["prepared_by"]).toBeNull();
    expect((await sql`select recorded_by from client_instructions where opportunity_id = ${opportunityId}`)[0]!["recorded_by"]).toBe(AMINA.id);
  });

  it("5. a person approves and sends the placement request; the insurer's confirmation is pasted in and filed to placement; cover is confirmed", async () => {
    const p = (await call(AMINA, "GET", `/placements/${placementId}`)).body;
    expect((await pAct({ action: "approve_request", placementRequestId: p.request.id })).body.outcome).toBe("done");
    expect((await pAct({ action: "record_submission", placementRequestId: p.request.id, method: "recorded_manual_email", recipient: "underwriting@jubilee.test", sentAt: "2026-09-08T11:02:00.000Z", evidenceNote: "Sent from my mailbox.", idempotencyKey: `e2e-${placementId}` })).body.outcome).toBe("done");
    await pump();
    expect(await run("placement", placementId)).toMatchObject({ state: "waiting_party", current_step: "confirmation" });
    const conf = await paste({ from: "underwriting@jubilee.test", subject: `RE: ${p.request.subject}`, body: `We confirm cover from 10 September, cover note CN-${TAG}. CONF-${TAG}` });
    const pr = await run("placement", placementId);
    expect(await sorted(conf)).toMatchObject({ kind: "insurer_confirmation", state: "routed", routed_by: "auto", routed_run_id: pr!["id"] });
    expect(String((await placementWork())!["required_action"])).toMatch(/^Record the cover confirmation or answer from /);
    expect((await pAct({ action: "record_insurer_response", outcome: "confirmed_as_requested", receivedAt: "2026-09-09T14:10:00.000Z", effectiveAt: "2026-09-10T00:00:00.000Z", expiryAt: "2027-09-09T00:00:00.000Z", insurerReference: `CN-${TAG}`, evidenceNote: "Cover note by email, filed by ASAP." })).body.outcome).toBe("done");
    await pump();
    expect((await run("placement", placementId))!["state"]).toBe("done");
    expect(await run("issuance", placementId)).toMatchObject({ state: "waiting_approval", current_step: "approval" });
  });

  it("6. a person approves and sends the issuance request; the policy email is pasted in and filed; ASAP files the policy document itself", async () => {
    const i = (await call(AMINA, "GET", `/placements/${placementId}/issuance`)).body;
    expect((await iAct({ action: "approve_issuance_request", issuanceRequestId: i.request.id })).body.outcome).toBe("done");
    expect((await iAct({ action: "record_issuance_submission", issuanceRequestId: i.request.id, method: "recorded_manual_email", recipient: "policy@jubilee.test", sentAt: "2026-09-12T08:30:00.000Z", evidenceNote: "Sent from my mailbox to the policy desk.", idempotencyKey: `e2e-iss-${TAG}` })).body.outcome).toBe("done");
    await pump();
    const iss = await run("issuance", placementId);
    expect(iss).toMatchObject({ state: "waiting_party", current_step: "policy_document" });
    // The insurer's email, with the schedule attached: kept as a document and read by the extractor (D-153).
    const pdf = textPdf(["POLICY SCHEDULE", `Policy number: ${POLICY_NUMBER}`, `Name of insured: ${CLIENT}`, `Insurer: ${jubileeName}`, "Class of business: Commercial motor", "Period from: 2026-09-10", "Period to: 2027-09-09", "Currency: KES", "Annual premium: 5,310,000.00"]);
    const eml = [
      "From: Jubilee Policy Desk <policy@jubilee.test>", `To: broker@acme-brokers.test`, `Subject: Policy schedule — ${CLIENT}`, "Date: Mon, 05 Oct 2026 09:12:00 +0300",
      `Message-ID: <pol-${TAG}@jubilee.test>`, "MIME-Version: 1.0", 'Content-Type: multipart/mixed; boundary="b1"', "",
      "--b1", "Content-Type: text/plain; charset=utf-8", "", `Attached the policy schedule ${POLICY_NUMBER} for ${CLIENT}. POL-${TAG}`,
      "--b1", 'Content-Type: application/pdf; name="Schedule.pdf"', 'Content-Disposition: attachment; filename="Schedule.pdf"', "Content-Transfer-Encoding: base64", "",
      pdf.toString("base64").replace(/(.{76})/g, "$1\r\n"), "--b1--", "",
    ].join("\r\n");
    const posted = await call(AMINA, "POST", "/inbound/messages", { eml });
    expect(posted.status).toBe(201);
    const attachment = (posted.body.attachments as { outcome: string; documentId: string }[])[0]!;
    expect(attachment.outcome).toBe("filed");
    watched.add(posted.body.emailMessageId);
    const doc = { id: attachment.documentId };
    watched.add(doc.id);
    await pump();
    expect(await sorted(posted.body.emailMessageId)).toMatchObject({ kind: "policy_document", state: "routed", routed_run_id: iss!["id"] });
    if (!process.env["CONNECTED_EXTRACTOR_URL"]) {
      // Stand-in, only where no extractor is running: its output, as it leaves it, and its event.
      const fields: [string, string][] = [["insured_name", CLIENT], ["insurer_name", jubileeName], ["policy_number", POLICY_NUMBER], ["class_of_business", "Commercial motor"], ["period_start", "2026-09-10"], ["period_end", "2027-09-09"], ["currency", "KES"], ["premium", "5,310,000.00"]];
      for (const [n, [key, value]] of fields.entries())
        await sql`insert into document_fields (organization_id, document_id, field_key, proposed_value, page_number, region_x, region_y, region_width, region_height, condition) values (${ORG_A}, ${doc.id}, ${key}, ${value}, 1, 72, ${120 + n * 24}, 260, 18, 'inferred')`;
      await sql`update documents set extraction_state = 'extracted', page_count = 1 where id = ${doc.id}`;
      await sql`insert into events (organization_id, event_type, entity_type, entity_id, actor, payload) values (${ORG_A}, 'document.read', 'document', ${doc.id}, 'automation', ${sql.json({ documentId: doc.id, kind: "policy_schedule", clientId: null })})`;
      await pump();
    } else {
      expect((await sql`select extraction_state from documents where id = ${doc.id}`)[0]!["extraction_state"]).toBe("extracted");
      const read = await sql`select field_key, proposed_value from document_fields where document_id = ${doc.id} and proposed_value is not null`;
      expect(Object.fromEntries(read.map((f) => [f["field_key"], f["proposed_value"]]))).toMatchObject({ insured_name: CLIENT, policy_number: POLICY_NUMBER, premium: "5,310,000.00" });
    }
    const [ipd] = await sql`select recorded_by, recorded_by_run_id from issued_policy_documents where document_id = ${doc!["id"]}`;
    expect(ipd).toMatchObject({ recorded_by: null, recorded_by_run_id: iss!["id"] });
  });

  it("7. a person confirms the readings; ASAP runs the issued-policy check; a person applies; the policy is issued", async () => {
    const v = (await call(AMINA, "GET", `/placements/${placementId}/issuance`)).body;
    for (const f of v.documents[0].fields) expect((await iAct({ action: "review_issued_field", documentFieldId: f.id, decision: "accept" })).body.outcome).toBe("done");
    await pump();
    const after = (await call(AMINA, "GET", `/placements/${placementId}/issuance`)).body;
    expect(after.check?.id).toBeTruthy();
    expect(["ready_to_apply", "differences_to_resolve"]).toContain(after.stage);
    for (const item of (after.check.items as { id: string; classification: string; material: boolean }[]).filter((x) => x.classification !== "match" && x.material))
      await iAct({ action: "resolve_issued_policy_difference", itemId: item.id, resolution: "client_accepted_issued_value", reason: "The client accepted the issued value.", resolvedAt: new Date().toISOString(), evidenceNote: "Client's email accepting it." });
    const applied = await iAct({ action: "apply_issued_policy", mode: "create", premiumBasis: "gross", idempotencyKey: `e2e-apply-${TAG}` });
    expect(applied.body.outcome).toBe("done");
    await pump();
    expect((await run("issuance", placementId))!["state"]).toBe("done");
    expect((await sql`select count(*)::int as n from policies where organization_id = ${ORG_A} and policy_number = ${POLICY_NUMBER} and deleted_at is null`)[0]!["n"]).toBe(1);
    expect((await sql`select count(*)::int as n from events where event_type = 'policy.issued' and payload->>'placementId' = ${placementId}`)[0]!["n"]).toBe(1);
    expect((await sql`select count(*)::int as n from workflow_receipts r join workflow_runs w on w.id = r.run_id where w.subject_id = ${placementId}`)[0]!["n"]).toBe(2);
    // The audit history names every automated step and every person's decision.
    const actions = (await sql`select distinct action from audit_log where organization_id = ${ORG_A} and occurred_at >= ${started}`).map((r) => r["action"] as string);
    for (const a of ["email.routed", "email.unsorted", "workflow.bundle_approved", "opportunity.request_delivered", "policy.issued_from_placement"]) expect(actions).toContain(a);
    await noSends();
  });
});

describe("a claim reported by email, to its registration", () => {
  let policyId = "";
  let claimId = "";
  let workId = "";
  const act = async (body: Record<string, unknown>) => call(AMINA, "POST", `/work-items/${workId}/actions`, { ...body, version: (await sql`select version from work_items where id = ${workId}`)[0]!["version"] });

  it("the claim email, from the client's own contact and saying when, opens a draft claim by itself (D-151)", async () => {
    policyId = (await sql`select id from policies where organization_id = ${ORG_A} and policy_number = ${POLICY_NUMBER}`)[0]!["id"] as string;
    const id = await paste({ from: CLIENT_EMAIL, subject: "Accident — truck KDA 451T", body: `Our truck KDA 451T overturned at Salgaa yesterday under policy ${POLICY_NUMBER}. CLAIM-${TAG}` });
    const s = await sorted(id);
    expect(s).toMatchObject({ kind: "claim_notice", state: "opened" });
    workId = s["work_item_id"] as string;
    const [claim] = await sql`select id, status, source, policy_id, incident_on::text as incident_on from claims where work_item_id = ${workId}`;
    claimId = claim!["id"] as string;
    // A draft for a person to confirm: not registered until they match the period.
    expect(claim).toMatchObject({ status: "draft", source: "email", policy_id: policyId });
    const sent = (await sql`select sent_at from email_messages where id = ${id}`)[0]!["sent_at"] as Date;
    expect(claim!["incident_on"]).toBe(new Date(sent.getTime() + 3 * 3_600_000 - 86_400_000).toISOString().slice(0, 10));
    expect((await sql`select work_item_id from email_threads t join email_messages m on m.thread_id = t.id where m.id = ${id}`)[0]!["work_item_id"]).toBe(workId);
    expect((await sql`select count(*)::int as n from audit_log where action = 'claim.opened_from_email' and object_id = ${workId} and actor_type = 'automation'`)[0]!["n"]).toBe(1);
    watched.add(claimId);
    await pump();
    expect(await run("claim", claimId)).toMatchObject({ state: "waiting_party", current_step: "match" });
  });

  it("matched, checked and notified by people; the insurer's registration is pasted in and filed; the run finishes", async () => {
    const periodId = (await sql`select id from policy_periods where policy_id = ${policyId} order by period_start desc limit 1`)[0]!["id"] as string;
    expect((await act({ stepId: "match", verb: "record_evidence", evidence: "Schedule page 1", policyPeriodId: periodId })).body.outcome).toBe("applied");
    await pump();
    expect((await act({ stepId: "documents", verb: "record_evidence", evidence: "Police abstract and photos received" })).body.outcome).toBe("applied");
    await pump();
    expect((await run("claim", claimId))!["current_step"]).toBe("notify");
    expect((await act({ stepId: "submit", verb: "record_send", evidence: "Emailed the Jubilee claims desk at 09:15" })).body.outcome).toBe("applied");
    await pump();
    const cr = await run("claim", claimId);
    expect(cr).toMatchObject({ state: "waiting_party", current_step: "registration" });
    const reg = await paste({ from: "claims@jubilee.test", subject: `Claim registered — ${POLICY_NUMBER}`, body: `We have registered the claim on ${POLICY_NUMBER} as CLM-${TAG}. REG-${TAG}` });
    expect(await sorted(reg)).toMatchObject({ kind: "claim_update", state: "routed", routed_by: "auto", routed_run_id: cr!["id"] });
    expect(String((await sql`select required_action from work_items where id = ${workId}`)[0]!["required_action"])).toMatch(/^Record what arrived from /);
    expect((await call(AMINA, "POST", `/claims/${claimId}/actions`, { action: "set_insurer_reference", reference: `CLM-${TAG}` })).status).toBe(200);
    await pump();
    expect((await run("claim", claimId))!["current_step"]).toBe("settlement");
    // Settlement, to the money received (D-154): each paper recorded by a person, with its figure.
    expect((await act({ stepId: "response", verb: "record_evidence", evidence: "Jubilee's letter accepting the assessor's report" })).body.outcome).toBe("applied");
    expect((await act({ stepId: "offer", verb: "record_evidence", evidence: `Discharge voucher DV-${TAG}`, amount: "412000", currency: "KES" })).body.outcome).toBe("applied");
    await pump();
    expect((await act({ stepId: "acceptance", verb: "record_evidence", evidence: "Signed voucher returned by the client" })).body.outcome).toBe("applied");
    await pump();
    expect((await act({ stepId: "payment", verb: "record_evidence", evidence: `EFT ${TAG}`, amount: "412000", currency: "KES", paidOn: new Date().toISOString().slice(0, 10) })).body.outcome).toBe("applied");
    await pump();
    expect((await run("claim", claimId))!["state"]).toBe("done");
    const [receipt] = await sql`select receipt from workflow_receipts where run_id = ${cr!["id"]}`;
    expect(JSON.stringify(receipt!["receipt"])).toMatch(/ASAP made no coverage or claims decision/);
    await noSends();
  });
});

describe("a change asked for by email", () => {
  it("opens a draft endorsement on the policy the email names; its run starts and asks for what is missing", async () => {
    const id = await paste({ from: CLIENT_EMAIL, subject: `Add a truck to ${POLICY_NUMBER}`, body: `Please add truck KDB 222X to policy ${POLICY_NUMBER}. ENDT-${TAG}` });
    const s = await sorted(id);
    expect(s).toMatchObject({ kind: "endorsement_request", state: "opened" });
    const [e] = await sql`select id, kind, requested_by, policy_id from endorsements where work_item_id = ${s["work_item_id"]}`;
    expect(e).toMatchObject({ kind: "add_item", requested_by: "policyholder" });
    watched.add(e!["id"] as string);
    await pump();
    expect((await sql`select current_step from workflow_runs where workflow = 'endorsement' and subject_id = ${e!["id"]}`)[0]!["current_step"]).toBe("requirements");
    expect((await sql`select required_action from work_items where id = ${s["work_item_id"]}`)[0]!["required_action"]).toBe("Add the effective date, the items being changed");
  });
});
