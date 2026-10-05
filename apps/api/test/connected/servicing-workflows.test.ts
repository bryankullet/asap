/**
 * Claims and endorsements on the engine (D-143), connected: real API, real database, the worker's
 * event dispatch driven by hand. ASAP completes only its own steps on the Work item; matching,
 * notifying, approving, delivering, recording the insurer's answer and applying stay with people.
 * Nothing is sent by ASAP, and no copy decides or suggests a coverage or claims decision.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, buildApp, caller, JUBILEE, newApiKey, ORG_A, OWNER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const TAG = randomUUID().slice(0, 6);
const started = new Date().toISOString();
let policyId = "";
let periodId = "";
let secondPolicyId = "";
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** The worker, for these subjects only: their events and their runs' events, dispatched once each. */
async function pump(...subjects: string[]) {
  for (let round = 0; round < 6; round++) {
    const runIds = (await sql`select id from workflow_runs where subject_id in ${sql(subjects)}`).map((r) => r["id"] as string);
    const evs = await sql`select id from events where organization_id = ${ORG_A} and processed_at is null and occurred_at >= ${started}
      and entity_id in ${sql([...subjects, ...runIds])} order by occurred_at`;
    if (!evs.length) return;
    for (const e of evs) {
      const res = await app.request(`/internal/events/${e["id"]}/dispatch`, { method: "POST", headers: { "x-asap-internal-key": API_KEY } });
      expect(res.status).toBe(200);
      await sql`update events set processed_at = now() where id = ${e["id"]}`;
    }
  }
}
const runOf = async (subject: string) => (await sql`select id, state, current_step, exception from workflow_runs where subject_id = ${subject}`)[0]!;
const work = async (id: string) => (await sql`select task_status, task_party, task_since, required_action, reason, version, steps from work_items where id = ${id}`)[0]!;
const stepState = async (id: string, step: string) => ((await work(id))["steps"] as { id: string; state: string }[]).find((s) => s.id === step)?.state;
const act = async (id: string, body: Record<string, unknown>) => call(AMINA, "POST", `/work-items/${id}/actions`, { ...body, version: (await work(id))["version"] });
const banned = /\b(covered|not covered|declin|repudiat|liab|payable)\w*/i;

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-servicing-workflows')`;
  app = buildApp(API_KEY);
  const [p] = await sql`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number) values (${ORG_A}, ${ACME}, ${JUBILEE}, 'Commercial motor', ${"SW-" + TAG}) returning id`;
  policyId = p!["id"] as string;
  const [pp] = await sql`insert into policy_periods (organization_id, policy_id, period_start, period_end) values (${ORG_A}, ${policyId}, ${day(-200)}, ${day(165)}) returning id`;
  periodId = pp!["id"] as string;
  await sql`insert into policy_versions (organization_id, policy_id, version, effective_from, source) values (${ORG_A}, ${policyId}, 1, ${day(-200)}, 'seed')`;
  const [p2] = await sql`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number) values (${ORG_A}, ${ACME}, ${JUBILEE}, 'Commercial motor', ${"SW2-" + TAG}) returning id`;
  secondPolicyId = p2!["id"] as string;
});
afterAll(async () => {
  await sql.end();
});

describe("the claim workflow", () => {
  let workId = "";
  let claimId = "";

  it("a reported claim starts one run; ASAP captures it and waits for a person to match the period, with the deadline", async () => {
    const r = await call(AMINA, "POST", "/work-items", { kind: "claim", clientId: ACME, incidentOn: day(-1), incidentSummary: `Rear-ended at Mlolongo ${TAG}; tail lights and boot damaged.`, policyId, source: "ask" });
    expect(r.status).toBe(201);
    workId = r.body.item.id;
    claimId = (await sql`select id from claims where work_item_id = ${workId}`)[0]!["id"] as string;
    await pump(claimId);
    expect(await runOf(claimId)).toMatchObject({ state: "waiting_party", current_step: "match" });
    expect(await stepState(workId, "capture")).toBe("done");
    const w = await work(workId);
    expect(w["task_status"]).toBe("needs_you");
    expect(String(w["required_action"])).toMatch(/^Match .*'s claim to a policy period$/);
    expect(String(w["reason"])).toMatch(/should hear of it by .* ASAP's working deadline — 7 days after the incident/);
    expect((await sql`select count(*)::int as n from audit_log where action = 'work_item.step_by_run' and object_id = ${workId} and actor_type = 'automation'`)[0]!["n"]).toBe(1);
  });

  it("matched by a person: ASAP reviews cover on the incident date and the clock as itself, then asks for the documents", async () => {
    expect((await act(workId, { stepId: "match", verb: "record_evidence", evidence: "Schedule page 2", policyPeriodId: periodId })).body.outcome).toBe("applied");
    await pump(claimId);
    expect(await runOf(claimId)).toMatchObject({ current_step: "documents" });
    expect(await stepState(workId, "cover_check")).toBe("done");
    expect(await stepState(workId, "clock")).toBe("done");
    const [c] = await sql`select cover_review from claims where id = ${claimId}`;
    expect(String(c!["cover_review"]).length).toBeGreaterThan(10);
    expect(String((await work(workId))["required_action"])).toMatch(/^Confirm the claim documents are complete, then notify /);
  });

  it("an outstanding document is with its holder, named, since the day it was listed", async () => {
    expect((await call(AMINA, "POST", `/claims/${claimId}/actions`, { action: "add_document", label: "Police abstract", holder: "police" })).status).toBe(200);
    await pump(claimId);
    const w = await work(workId);
    expect(w).toMatchObject({ task_status: "with_party", task_party: "the police" });
    expect(w["task_since"]).not.toBeNull();
    const [doc] = await sql`select id from claim_documents where claim_id = ${claimId}`;
    expect((await call(AMINA, "POST", `/claims/${claimId}/actions`, { action: "receive_document", documentId: doc!["id"], reference: "OB 12/05/10/2026" })).status).toBe(200);
    expect((await act(workId, { stepId: "documents", verb: "record_evidence", evidence: "Police abstract received" })).body.outcome).toBe("applied");
    await pump(claimId);
    expect(await runOf(claimId)).toMatchObject({ current_step: "notify" });
    const n = await work(workId);
    expect(String(n["required_action"])).toMatch(/^Notify .* of the claim by /);
    expect(String(n["reason"])).toMatch(/ASAP cannot prepare the notice: no verified insurer address is on file/);
  });

  it("notified by a person: ASAP waits on the insurer for its reference, then finishes with a receipt and hands the claim back", async () => {
    expect((await act(workId, { stepId: "submit", verb: "record_send", evidence: "Emailed claims@jubilee.test at 10:12" })).body.outcome).toBe("applied");
    await pump(claimId);
    expect(await runOf(claimId)).toMatchObject({ state: "waiting_party", current_step: "registration" });
    expect(await work(workId)).toMatchObject({ task_status: "with_party" });
    expect((await call(AMINA, "POST", `/claims/${claimId}/actions`, { action: "set_insurer_reference", reference: `JUB/CLM/${TAG}` })).status).toBe(200);
    await pump(claimId);
    const r = await runOf(claimId);
    expect(r["state"]).toBe("done");
    const [receipt] = await sql`select outcome, receipt from workflow_receipts where run_id = ${r["id"]}`;
    expect(receipt!["outcome"]).toMatch(/^Claim registered by .* \(JUB\/CLM\//);
    expect(JSON.stringify(receipt!["receipt"])).toMatch(/ASAP made no coverage or claims decision/);
    const w = await work(workId);
    expect(w["task_status"]).toBe("with_party");
    expect(w["task_since"]).not.toBeNull();
    for (const text of [w["required_action"], w["reason"], receipt!["outcome"]]) expect(String(text ?? "")).not.toMatch(banned);
  });

  it("a claim whose notification deadline has passed is an exception for a person — never a view on cover", async () => {
    const r = await call(AMINA, "POST", "/work-items", { kind: "claim", clientId: ACME, incidentOn: day(-20), incidentSummary: `Windscreen shattered on Thika Road ${TAG}.`, policyId, source: "ask" });
    const late = (await sql`select id from claims where work_item_id = ${r.body.item.id}`)[0]!["id"] as string;
    await pump(late);
    const run = await runOf(late);
    expect(run["state"]).toBe("exception");
    const ex = run["exception"] as { code: string; message: string; needs: string };
    expect(ex.code).toBe("notification_deadline_passed");
    expect(ex.needs).toMatch(/the insurer's decision — ASAP makes none/);
    expect(`${ex.message} ${ex.needs}`).not.toMatch(/\b(covered|not covered|repudiat|liab|payable)\w*/i);
  });
});

describe("the endorsement workflow", () => {
  it("from the request to the applied change: ASAP's steps by ASAP, everything else by people", async () => {
    const r = await call(AMINA, "POST", "/work-items", { kind: "endorsement", clientId: ACME, policyId, requestText: `Please add vehicle KDX ${TAG.slice(0, 3)}A to the fleet.`, requestedBy: "policyholder" });
    expect(r.status).toBe(201);
    const workId = r.body.item.id as string;
    const id = (await sql`select id from endorsements where work_item_id = ${workId}`)[0]!["id"] as string;
    await pump(id);
    expect(await runOf(id)).toMatchObject({ state: "waiting_party", current_step: "requirements" });
    expect(await stepState(workId, "classify")).toBe("done");
    expect((await work(workId))["required_action"]).toBe("Add the effective date, the items being changed");

    await call(AMINA, "POST", `/endorsements/${id}/actions`, { action: "set_details", effectiveOn: day(10), items: [{ id: "v1", label: `KDX ${TAG.slice(0, 3)}A Toyota Probox`, before: null, after: "Comprehensive, KES 1,450,000", sumInsuredMinor: 145_000_000 }] });
    await pump(id);
    const run = await runOf(id);
    expect(run).toMatchObject({ state: "waiting_approval", current_step: "approval" });
    expect(await stepState(workId, "requirements")).toBe("done");
    const [a] = await sql`select id, bundle_sha256, bundle from workflow_approvals where run_id = ${run["id"]}`;
    expect(String((a!["bundle"] as { body: string }[])[0]!.body)).toMatch(/please endorse policy SW-/);
    expect((await call(AMINA, "POST", `/workflow-approvals/${a!["id"]}/decide`, { decision: "approve", bundleSha256: a!["bundle_sha256"] })).status).toBe(200);
    await pump(id);
    expect(await runOf(id)).toMatchObject({ current_step: "delivery" });
    expect(String((await work(workId))["required_action"])).toMatch(/^Deliver the approved endorsement request to /);
    expect((await sql`select count(*)::int as n from email_send_attempts where organization_id = '10000000-0000-4000-8000-00000000000a'`)[0]!["n"]).toBe(0);

    const [m] = await sql`select id from prepared_communications where run_id = ${run["id"]}`;
    expect((await call(AMINA, "POST", `/prepared-communications/${m!["id"]}/delivery`, { method: "own_email", reference: "Sent from my mailbox at 09:40" })).status).toBe(200);
    await pump(id);
    expect(await runOf(id)).toMatchObject({ state: "waiting_party", current_step: "response" });
    expect(await stepState(workId, "request")).toBe("done");
    const w = await work(workId);
    expect(w["task_status"]).toBe("with_party");
    expect(w["task_since"]).not.toBeNull();

    await call(AMINA, "POST", `/endorsements/${id}/actions`, { action: "decide_item", itemId: "v1", decision: "accepted", responseReference: `JUB/END/${TAG}` });
    await pump(id);
    expect(String((await work(workId))["required_action"])).toMatch(/written response on the Work item/);
    expect((await act(workId, { stepId: "response", verb: "record_evidence", evidence: `JUB/END/${TAG}` })).body.outcome).toBe("applied");
    await pump(id);
    expect(await runOf(id)).toMatchObject({ current_step: "apply" });
    expect((await work(workId))["required_action"]).toBe("Apply the confirmed changes to the policy");
    expect((await act(workId, { stepId: "update_policy", verb: "approve" })).body.outcome).toBe("applied");
    await pump(id);
    const done = await runOf(id);
    expect(done["state"]).toBe("done");
    const [receipt] = await sql`select outcome from workflow_receipts where run_id = ${done["id"]}`;
    expect(receipt!["outcome"]).toMatch(/^Endorsement applied — 1 of 1 item confirmed by /);
  });

  it("a transfer of ownership asked for by someone else waits for the policyholder's own instruction", async () => {
    const r = await call(AMINA, "POST", "/work-items", { kind: "endorsement", clientId: ACME, policyId: secondPolicyId, requestText: `Transfer KDY ${TAG.slice(0, 3)}B to the buyer, Juma Traders.`, requestedBy: "other", requestedByName: "Juma Traders" });
    const id = (await sql`select id from endorsements where work_item_id = ${r.body.item.id}`)[0]!["id"] as string;
    await pump(id);
    expect(await runOf(id)).toMatchObject({ state: "waiting_party", current_step: "requirements" });
    const w = await work(r.body.item.id);
    expect(w["required_action"]).toBe("Record the policyholder's own instruction");
    expect(String(w["reason"])).toMatch(/^Transfer of ownership needs the policyholder's own instruction\. This request came from Juma Traders/);
    expect((await sql`select count(*)::int as n from workflow_approvals a join workflow_runs r on r.id = a.run_id where r.subject_id = ${id}`)[0]!["n"]).toBe(0);
  });
});
