/**
 * The quotation workflow on the engine (D-141), connected: real API, real database, the worker's
 * event dispatch driven by hand. An opened opportunity starts the run; ASAP waits for a person to
 * choose insurers, prepares one request each through the shared path, asks for ONE approval, waits
 * for deliveries, waits on each insurer, generates the comparison as itself, hands the options to a
 * person, and finishes when a person records the client's instruction. Nothing is sent by ASAP.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, buildApp, caller, CIC, JUBILEE, newApiKey, ORG_A, OWNER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
let opportunityId = "";
let runId = "";
const started = new Date().toISOString();

/** The worker, for this quotation only: every pending event about it, dispatched once, in order. */
async function pump() {
  for (let round = 0; round < 5; round++) {
    const evs = await sql`select id from events where organization_id = ${ORG_A} and processed_at is null and occurred_at >= ${started}
      and (entity_id = ${opportunityId} or payload->>'opportunityId' = ${opportunityId} or entity_id = ${runId || randomUUID()}) order by occurred_at`;
    if (!evs.length) return;
    for (const e of evs) {
      const res = await app.request(`/internal/events/${e["id"]}/dispatch`, { method: "POST", headers: { "x-asap-internal-key": API_KEY } });
      expect(res.status).toBe(200);
      await sql`update events set processed_at = now() where id = ${e["id"]}`;
    }
  }
}
const run = async () => (await sql`select id, state, current_step, exception from workflow_runs where workflow = 'quotation' and subject_id = ${opportunityId}`)[0]!;
const work = async () => (await sql`select w.task_status, w.task_party, w.required_action from work_items w join opportunities o on o.work_item_id = w.id where o.id = ${opportunityId}`)[0]!;
const opp = async () => (await call(AMINA, "GET", `/opportunities/${opportunityId}`)).body;

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-quotation-workflow')`;
  app = buildApp(API_KEY);
});
afterAll(async () => {
  await sql.end();
});

describe("the quotation workflow", () => {
  it("an opened opportunity starts one run, which waits for a person to choose insurers", async () => {
    const created = await call(AMINA, "POST", "/opportunities", { clientId: ACME, title: `Autonomy fleet ${randomUUID().slice(0, 6)}`, classOfBusiness: "Commercial motor", riskSummary: "Five delivery vans", requestKey: randomUUID() });
    expect(created.status).toBe(201);
    opportunityId = created.body.opportunityId;
    await pump();
    await pump();
    const r = await run();
    runId = r["id"] as string;
    expect(r).toMatchObject({ state: "waiting_party", current_step: "insurers" });
    expect((await sql`select count(*)::int as n from workflow_runs where workflow = 'quotation' and subject_id = ${opportunityId}`)[0]!["n"]).toBe(1);
    expect((await work())["required_action"]).toBe("Choose the insurers to approach");
    expect((await sql`select count(*)::int as n from opportunity_insurers where opportunity_id = ${opportunityId}`)[0]!["n"]).toBe(0);
  });

  it("insurers chosen by a person: ASAP prepares one request each and asks for ONE approval", async () => {
    for (const insurerId of [JUBILEE, CIC]) expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "add_insurer", insurerId })).status).toBe(200);
    await pump();
    expect(await run()).toMatchObject({ state: "waiting_approval", current_step: "approval" });
    const reqs = await sql`select q.id, q.subject, q.body_text, q.approved_at from quote_requests q where q.opportunity_id = ${opportunityId}`;
    expect(reqs).toHaveLength(2);
    expect(reqs.every((q) => q["approved_at"] === null)).toBe(true);
    expect(String(reqs[0]!["body_text"])).toMatch(/Please quote for Acme Motors/);
    const approvals = await sql`select id, bundle, bundle_sha256 from workflow_approvals where run_id = ${runId}`;
    expect(approvals).toHaveLength(1);
    expect((approvals[0]!["bundle"] as unknown[]).length).toBe(2);
    expect((await work())["required_action"]).toMatch(/^Review and approve the quotation requests to /);
    expect((await sql`select count(*)::int as n from email_send_attempts`)[0]!["n"]).toBe(0);
  });

  it("one approval by a person approves each request's exact text; the run waits for deliveries", async () => {
    const [a] = await sql`select id, bundle_sha256 from workflow_approvals where run_id = ${runId}`;
    const decided = await call(AMINA, "POST", `/workflow-approvals/${a!["id"]}/decide`, { decision: "approve", bundleSha256: a!["bundle_sha256"] });
    expect(decided.status).toBe(200);
    expect(await run()).toMatchObject({ state: "waiting_party", current_step: "delivery" });
    const reqs = await sql`select approved_by, approved_body_sha256 from quote_requests where opportunity_id = ${opportunityId}`;
    expect(reqs.every((q) => q["approved_by"] === AMINA.id && q["approved_body_sha256"])).toBe(true);
    expect((await sql`select count(*)::int as n from quote_request_approvals a join quote_requests q on q.id = a.quote_request_id where q.opportunity_id = ${opportunityId}`)[0]!["n"]).toBe(2);
    expect((await work())["required_action"]).toMatch(/^Deliver the approved requests to /);
  });

  it("deliveries recorded by a person: ASAP waits with the insurers, named and dated", async () => {
    const o = await opp();
    for (const i of o.insurers) expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "record_delivery", quoteRequestId: i.request.id, method: "own_email", reference: `Sent to ${i.insurerName} underwriting` })).body.outcome).toBe("done");
    await pump();
    expect(await run()).toMatchObject({ state: "waiting_party", current_step: "await_terms" });
    const w = await work();
    expect(w["task_status"]).toBe("with_party");
    expect(String(w["task_party"])).toMatch(/Jubilee|CIC/);
  });

  it("each insurer's answer wakes the run; with both in, ASAP generates the comparison as itself and hands over", async () => {
    let o = await opp();
    const byInsurer = (id: string) => o.insurers.find((i: { insurerId: string }) => i.insurerId === id);
    await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "record_response", opportunityInsurerId: byInsurer(JUBILEE).id, outcome: "quoted", premiumAmount: "5310000.00", premiumCurrency: "KES", validUntil: "2027-06-30", sourceNote: "Jubilee's quotation letter, by email." });
    await pump();
    expect((await run())["current_step"]).toBe("await_terms"); // CIC still out
    o = await opp();
    await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "record_response", opportunityInsurerId: byInsurer(CIC).id, outcome: "quoted", premiumAmount: "5620000.00", premiumCurrency: "KES", validUntil: "2027-06-30", sourceNote: "CIC's quotation letter, by email." });
    await pump();
    expect(await run()).toMatchObject({ state: "waiting_party", current_step: "hand_over" });
    const [cmp] = await sql`select generated_by, generated_by_run_id from quote_comparisons where opportunity_id = ${opportunityId} and superseded_at is null`;
    expect(cmp).toMatchObject({ generated_by: null, generated_by_run_id: runId });
    expect((await work())["required_action"]).toBe("Present the options to Acme Motors and record their instruction");
    expect((await sql`select count(*)::int as n from client_instructions where opportunity_id = ${opportunityId}`)[0]!["n"]).toBe(0);
  });

  it("a person records the instruction: the run finishes with a receipt; ASAP recorded no instruction itself", async () => {
    o_: {
      const o = await opp();
      const jub = o.insurers.find((i: { insurerId: string }) => i.insurerId === JUBILEE);
      const cmp = (await call(AMINA, "GET", `/opportunities/${opportunityId}/comparison`)).body;
      await call(AMINA, "POST", `/opportunities/${opportunityId}/comparison/actions`, { action: "present_comparison", comparisonId: cmp.comparison.id });
      const res = await call(AMINA, "POST", `/opportunities/${opportunityId}/instruction`, { insurerResponseId: jub.response.id, source: "telephone", evidenceNote: "Client rang and chose Jubilee on the terms shown, 10:40.", instructedAt: new Date().toISOString(), requestedEffectiveAt: new Date(Date.now() + 7 * 86_400_000).toISOString() });
      expect(res.body.outcome).toBe("done");
      break o_;
    }
    await pump();
    expect((await run())["state"]).toBe("done");
    const [rcpt] = await sql`select workflow, outcome from workflow_receipts where run_id = ${runId}`;
    expect(rcpt).toMatchObject({ workflow: "quotation", outcome: "Client instruction recorded — placement starts" });
    const [instr] = await sql`select recorded_by from client_instructions where opportunity_id = ${opportunityId}`;
    expect(instr!["recorded_by"]).toBe(AMINA.id);
    const audits = await sql`select action from audit_log where object_id = ${runId} and actor_type = 'automation'`;
    expect(audits.map((a) => a["action"])).toEqual(expect.arrayContaining(["workflow.quotation.started", "workflow.quotation.requests_prepared", "workflow.quotation.approval_requested", "workflow.quotation.compared", "workflow.quotation.finished"]));
    expect((await sql`select count(*)::int as n from email_send_attempts`)[0]!["n"]).toBe(0);
  });
});

describe("chasing each insurer on the brokerage's cadence", () => {
  it("follows up per insurer on its own delivery date, escalates before the deadline, and stops at the deadline with no quote", async () => {
    const { advanceAnyRun } = await import("./_registry-harness.js");
    const { serviceClient } = await import("./_harness.js");
    const pino = (await import("pino")).default;
    const log = pino({ level: "silent" });
    const db = serviceClient();
    // A quotation opened ten days ago in effect: the default rule expects answers within 10 days.
    const created = await call(AMINA, "POST", "/opportunities", { clientId: ACME, title: `Chase test ${randomUUID().slice(0, 6)}`, classOfBusiness: "Commercial motor", requestKey: randomUUID() });
    const id = created.body.opportunityId as string;
    opportunityId = id;
    runId = "";
    await pump();
    for (const insurerId of [JUBILEE, CIC]) await call(AMINA, "POST", `/opportunities/${id}/actions`, { action: "add_insurer", insurerId });
    await pump();
    const [a] = await sql`select w.id, w.bundle_sha256 from workflow_approvals w join workflow_runs r on r.id = w.run_id where r.subject_id = ${id}`;
    await call(AMINA, "POST", `/workflow-approvals/${a!["id"]}/decide`, { decision: "approve", bundleSha256: a!["bundle_sha256"] });
    const o = (await call(AMINA, "GET", `/opportunities/${id}`)).body;
    const t0 = Date.now();
    const jub = o.insurers.find((i: { insurerId: string }) => i.insurerId === JUBILEE);
    const cic = o.insurers.find((i: { insurerId: string }) => i.insurerId === CIC);
    for (const x of [jub, cic]) await call(AMINA, "POST", `/opportunities/${id}/actions`, { action: "record_delivery", quoteRequestId: x.request.id, method: "own_email", reference: `Sent to ${x.insurerName}` });
    await pump();
    const [r] = await sql`select id from workflow_runs where workflow = 'quotation' and subject_id = ${id}`;
    const rid = r!["id"] as string;
    const followUps = async () => (await sql`select new_state from audit_log where object_id = ${rid} and action = 'workflow.quotation.follow_up' order by occurred_at`).map((x) => (x["new_state"] as { insurers: string[] }).insurers);
    // Day 2: nobody is due yet (3-day cadence).
    await advanceAnyRun(db, log, rid, new Date(t0 + 2 * 86_400_000));
    expect(await followUps()).toEqual([]);
    // CIC declines; at day 3.5 only Jubilee — still out — is chased.
    await call(AMINA, "POST", `/opportunities/${id}/actions`, { action: "record_response", opportunityInsurerId: cic.id, outcome: "declined", declineReason: "Outside appetite for this fleet.", sourceNote: "CIC's email." });
    await advanceAnyRun(db, log, rid, new Date(t0 + 3.5 * 86_400_000));
    expect(await followUps()).toEqual([[expect.stringMatching(/Jubilee/)]]);
    // Again at day 3.6: not chased twice for the same interval.
    await advanceAnyRun(db, log, rid, new Date(t0 + 3.6 * 86_400_000));
    expect(await followUps()).toHaveLength(1);
    const w = await sql`select required_action from work_items w join opportunities o on o.work_item_id = w.id where o.id = ${id}`;
    expect(String(w[0]!["required_action"])).toMatch(/^Chase Jubilee.*\(follow-up 1\)/);
    // Two days before the 10-day deadline: escalated, once.
    await advanceAnyRun(db, log, rid, new Date(t0 + 8.2 * 86_400_000));
    await advanceAnyRun(db, log, rid, new Date(t0 + 8.3 * 86_400_000));
    expect((await sql`select count(*)::int as n from audit_log where object_id = ${rid} and action = 'workflow.quotation.escalated'`)[0]!["n"]).toBe(1);
    // The deadline passes with no quote: the run stops and says what to do.
    await advanceAnyRun(db, log, rid, new Date(t0 + 11 * 86_400_000));
    const [stopped] = await sql`select state, exception from workflow_runs where id = ${rid}`;
    expect(stopped!["state"]).toBe("exception");
    expect((stopped!["exception"] as { code: string }).code).toBe("no_quotes_by_deadline");
    expect((await sql`select count(*)::int as n from events where event_type = 'run.could_not_finish' and entity_id = ${rid}`)[0]!["n"]).toBe(1);
  });
});
