/**
 * Renewal Autopilot on real Postgres (D-129): the real API and engine, supabase-js, PostgREST, RLS
 * and every grant. The worker's sweep is called on the API's internal surface exactly as the worker
 * calls it; time-dependent steps are driven with the engine at a chosen moment.
 */
import { randomUUID } from "node:crypto";
import pino from "pino";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { advanceRun, RENEWAL } from "../../src/workflows/renewal.js";
import { ACME, AMINA, BETA, browser, buildApp, caller, JUBILEE, newApiKey, ORG_A, OWNER, READER, serviceClient, type Json } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const log = pino({ level: "silent" });
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const TAG = randomUUID().slice(0, 6);
const sweep = async () => {
  const res = await app.request("/internal/workflows/sweep", { method: "POST", headers: { "x-asap-internal-key": API_KEY } });
  const body = (await res.json()) as { started: number; advanced: number };
  if (process.env["DEBUG_SWEEP"]) console.error(res.status, JSON.stringify(body));
  return body;
};

let periodId = "";
let periodNoInsurer = "";
let policyNoInsurer = "";
let archivedInsurer = "";
let runId = "";
let workItemId = "";

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-renewal')`;
  app = buildApp(API_KEY);
  // The client letter needs somebody to go to: without a contact the renewal stops before approval (D-131).
  await sql`insert into client_contacts (organization_id, client_id, full_name, email, is_primary)
    select ${ORG_A}, ${ACME}, 'Wanjiru Kamau', 'wanjiru@acme.test', true
    where not exists (select 1 from client_contacts where client_id = ${ACME} and email is not null and deleted_at is null)`;
  const end = iso(new Date(Date.now() + 30 * DAY));
  const start = iso(new Date(Date.now() - 335 * DAY));
  const [pol] = await sql<{ id: string }[]>`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
    values (${ORG_A}, ${ACME}, ${JUBILEE}, 'Commercial motor', ${"REN-" + TAG}) returning id`;
  const [per] = await sql<{ id: string }[]>`insert into policy_periods (organization_id, policy_id, period_start, period_end, premium_amount, premium_currency, premium_basis)
    values (${ORG_A}, ${pol!.id}, ${start}, ${end}, 4800000, 'KES', 'gross') returning id`;
  periodId = per!.id;
  const [ins] = await sql<{ id: string }[]>`insert into insurers (organization_id, name, deleted_at) values (${ORG_A}, ${"Archived Insurer " + TAG}, now()) returning id`;
  archivedInsurer = ins!.id;
  const [pol2] = await sql<{ id: string }[]>`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
    values (${ORG_A}, ${ACME}, ${archivedInsurer}, 'Fire', ${"NOINS-" + TAG}) returning id`;
  policyNoInsurer = pol2!.id;
  const [per2] = await sql<{ id: string }[]>`insert into policy_periods (organization_id, policy_id, period_start, period_end)
    values (${ORG_A}, ${pol2!.id}, ${start}, ${iso(new Date(Date.now() + 20 * DAY))}) returning id`;
  periodNoInsurer = per2!.id;
});
afterAll(async () => {
  await sql.end();
});

const runFor = async (period: string) => (await sql<{ id: string; state: string; work_item_id: string; exception: Json }[]>`select id, state, work_item_id, exception from workflow_runs where subject_id = ${period}`);

describe("Renewal Autopilot", () => {
  it("1–2 · the schedule detects the period once; a second sweep and a restart create nothing more", async () => {
    await sweep();
    // D-137: the pass that finds the renewal also advances it — no "0 of 11" until the next sweep.
    const afterOne = await runFor(periodId);
    expect(afterOne.map((r) => r.state)).toEqual(["waiting_approval"]);
    await sweep();
    const runs = await runFor(periodId);
    expect(runs).toHaveLength(1);
    runId = runs[0]!.id;
    workItemId = runs[0]!.work_item_id;
    expect((await sql`select count(*)::int as n from work_items where source_id = ${periodId} and reason_code = 'renewal_due'`)[0]!["n"]).toBe(1);
    expect((await sql`select count(*)::int as n from workflow_steps where run_id = ${runId}`)[0]!["n"]).toBe(11);
  });

  it("3–9 · checks, reads, assigns, prepares the pack and both messages, and asks for ONE approval", async () => {
    const run = (await call(AMINA, "GET", `/workflows/runs/${runId}`)).body;
    expect(run.state).toBe("waiting_approval");
    const done = run.steps.filter((s: Json) => s.state === "done").map((s: Json) => s.key);
    expect(done).toEqual(["detect", "completeness", "read_schedule", "assign_work", "pack", "communications"]);
    const completeness = run.steps.find((s: Json) => s.key === "completeness").output;
    expect(completeness.present).toEqual(expect.arrayContaining([expect.stringMatching(/Policy number REN-/), expect.stringMatching(/Expiring premium KES/)]));
    // The schedule is either on file (named) or listed as missing — never silently assumed.
    expect([...completeness.present, ...completeness.missing].some((x: string) => /schedule/i.test(x))).toBe(true);
    expect(run.communications.map((m: Json) => m.audience)).toEqual(["client", "insurer"]);
    expect(run.communications.every((m: Json) => m.state === "prepared")).toBe(true);
    const insurerMsg = run.communications.find((m: Json) => m.audience === "insurer");
    expect(insurerMsg.toAddress).toBeNull();
    expect(insurerMsg.bodyText).toMatch(/KES 4,800,000/);
    for (const m of run.communications) expect(m.subject + m.bodyText).not.toMatch(/undefined|\bnull\b|NaN|\.demo|@example/);
    expect(run.approval.state).toBe("pending");
    expect(run.approval.bundle.length).toBe(3);
    expect((await sql`select count(*)::int as n from workflow_approvals where run_id = ${runId}`)[0]!["n"]).toBe(1);
    const [w] = await sql<{ task_status: string; required_action: string; due_on: string }[]>`select task_status, required_action, due_on::text from work_items where id = ${workItemId}`;
    expect(w!.task_status).toBe("needs_you");
    expect(w!.required_action).toMatch(/Review and approve .* renewal bundle/);
    expect(w!.due_on).toBeTruthy();
    const audits = await sql`select action from audit_log where object_id = ${runId} and actor_type = 'automation'`;
    expect(audits.map((a) => a["action"])).toEqual(expect.arrayContaining(["workflow.renewal.started", "workflow.renewal.pack", "workflow.renewal.approval_requested"]));
  });

  it("read-only, another brokerage and a stale bundle are refused; a browser cannot write a run", async () => {
    const run = (await call(AMINA, "GET", `/workflows/runs/${runId}`)).body;
    const body = { decision: "approve", bundleSha256: run.approval.bundleSha256 };
    expect((await call(READER, "POST", `/workflow-approvals/${run.approval.id}/decide`, body)).status).toBe(403);
    expect((await call(BETA, "POST", `/workflow-approvals/${run.approval.id}/decide`, body)).status).toBe(404);
    expect((await call(BETA, "GET", `/workflows/runs/${runId}`)).status).toBe(404);
    expect((await call(AMINA, "POST", `/workflow-approvals/${run.approval.id}/decide`, { ...body, bundleSha256: "0".repeat(64) })).status).toBe(409);
    const patch = await browser(AMINA, "PATCH", `workflow_runs?id=eq.${runId}`, { state: "done" });
    expect(patch.status).toBeGreaterThanOrEqual(400);
    const ins = await browser(AMINA, "POST", "prepared_communications", { organization_id: ORG_A, run_id: runId });
    expect(ins.status).toBeGreaterThanOrEqual(400);
    expect((await runFor(periodId))[0]!.state).toBe("waiting_approval");
  });

  it("10 · approving once resumes the run: the insurer request is approved — not sent — and Work says deliver it", async () => {
    const run = (await call(AMINA, "GET", `/workflows/runs/${runId}`)).body;
    const body = { decision: "approve", bundleSha256: run.approval.bundleSha256 };
    const [a, b] = await Promise.all([
      call(AMINA, "POST", `/workflow-approvals/${run.approval.id}/decide`, body),
      call(AMINA, "POST", `/workflow-approvals/${run.approval.id}/decide`, body),
    ]);
    expect([a.body.outcome, b.body.outcome].sort()).toEqual(["already", "done"]);
    const after = (await call(AMINA, "GET", `/workflows/runs/${runId}`)).body;
    expect(after.state).toBe("waiting_party");
    expect(after.currentStep).toBe("await_terms");
    expect(after.approval.decidedByName).toBeTruthy();
    expect(after.communications.every((m: Json) => m.state === "approved")).toBe(true);
    const [qr] = await sql<{ approved_at: string | null; sent_at: string | null; sent_email_message_id: string | null }[]>`select q.approved_at, q.sent_at, q.sent_email_message_id from quote_requests q join prepared_communications p on p.quote_request_id = q.id where p.run_id = ${runId}`;
    expect(qr!.approved_at).toBeTruthy();
    expect(qr!.sent_at).toBeNull();
    expect(qr!.sent_email_message_id).toBeNull();
    expect((await sql`select count(*)::int as n from email_send_attempts`)[0]!["n"]).toBe(0);
    const [w] = await sql<{ required_action: string }[]>`select required_action from work_items where id = ${workItemId}`;
    expect(w!.required_action).toMatch(/^Deliver the approved renewal request to Jubilee/);
    expect((await sql`select count(*)::int as n from audit_log where object_id = ${runId} and action = 'workflow.bundle_approved'`)[0]!["n"]).toBe(1);
    expect((await sql`select count(*)::int as n from events where entity_id = ${runId} and event_type = 'workflow.approval_decided'`)[0]!["n"]).toBe(1);
  });

  it("15 · a crash mid-step (stale lease, step left running) resumes without duplicating anything", async () => {
    await sql`update workflow_runs set lease_until = now() - interval '1 minute' where id = ${runId}`;
    await sql`update workflow_steps set state = 'running' where run_id = ${runId} and step_key = 'open_terms'`;
    await sql`update workflow_runs set next_run_at = now() where id = ${runId}`;
    await sweep();
    expect((await sql`select count(*)::int as n from opportunities where work_item_id = ${workItemId}`)[0]!["n"]).toBe(1);
    expect((await sql`select count(*)::int as n from quote_requests q join opportunities o on o.id = q.opportunity_id where o.work_item_id = ${workItemId}`)[0]!["n"]).toBe(1);
    expect((await sql`select count(*)::int as n from prepared_communications where run_id = ${runId}`)[0]!["n"]).toBe(2);
    // A held lease keeps a second advancer out.
    await sql`update workflow_runs set lease_until = now() + interval '1 minute' where id = ${runId}`;
    const blocked = await advanceRun(serviceClient(), log, RENEWAL, runId);
    expect(blocked.skipped).toBe("leased");
    await sql`update workflow_runs set lease_until = null where id = ${runId}`;
  });

  it("11 · after delivery, ASAP waits on Jubilee and chases on schedule — once per interval, audited", async () => {
    const run = (await call(AMINA, "GET", `/workflows/runs/${runId}`)).body;
    const opportunityId = run.steps.find((s: Json) => s.key === "open_terms").output.opportunityId;
    const qr = run.steps.find((s: Json) => s.key === "open_terms").output.quoteRequestId;
    expect((await call(AMINA, "POST", `/opportunities/${opportunityId}/actions`, { action: "record_delivery", quoteRequestId: qr, method: "own_email", reference: "Sent from Outlook to Jubilee underwriting, 09:14" })).body.outcome).toBe("done");
    const db = serviceClient();
    await advanceRun(db, log, RENEWAL, runId);
    const [w] = await sql<{ task_status: string; task_party: string; task_next_check: string }[]>`select task_status, task_party, task_next_check from work_items where id = ${workItemId}`;
    expect(w!.task_status).toBe("with_party");
    expect(w!.task_party).toMatch(/Jubilee/);
    const later = new Date(Date.now() + 6 * DAY);
    await advanceRun(db, log, RENEWAL, runId, later);
    await advanceRun(db, log, RENEWAL, runId, later);
    const [w2] = await sql<{ required_action: string }[]>`select required_action from work_items where id = ${workItemId}`;
    expect(w2!.required_action).toMatch(/Chase Jubilee .* \(follow-up 1\)/);
    expect((await sql`select count(*)::int as n from audit_log where object_id = ${runId} and action = 'workflow.renewal.follow_up'`)[0]!["n"]).toBe(1);
  });

  it("12 · when terms arrive, ASAP compares them with the expiring premium, abstains from recommending, and hands over", async () => {
    const run = (await call(AMINA, "GET", `/workflows/runs/${runId}`)).body;
    const out = run.steps.find((s: Json) => s.key === "open_terms").output;
    expect((await call(AMINA, "POST", `/opportunities/${out.opportunityId}/actions`, { action: "record_response", opportunityInsurerId: out.opportunityInsurerId, outcome: "quoted", receivedAt: new Date().toISOString(), premiumAmount: "5040000.00", premiumCurrency: "KES", validUntil: iso(new Date(Date.now() + 60 * DAY)), sourceNote: "Renewal terms letter from Jubilee." })).body.outcome).toBe("done");
    await advanceRun(serviceClient(), log, RENEWAL, runId, new Date(Date.now() + 7 * DAY));
    const done = (await call(AMINA, "GET", `/workflows/runs/${runId}`)).body;
    expect(done.state).toBe("done");
    const compare = done.steps.find((s: Json) => s.key === "compare").output;
    expect(compare.terms[0].changePercent).toBe(5);
    expect(compare.recommendation).toMatch(/does not recommend/);
    const [w] = await sql<{ task_status: string; required_action: string }[]>`select task_status, required_action from work_items where id = ${workItemId}`;
    expect(w!.required_action).toMatch(/^Present the renewal terms to Acme/);
    expect(done.progress).toEqual({ done: 11, steps: 11 });
  });

  it("13 · a policy whose insurer is no longer on file stops with a precise exception; putting it right and resuming continues", async () => {
    const [r] = await runFor(periodNoInsurer);
    expect(r!.state).toBe("exception");
    expect(r!.exception.code).toBe("no_insurer");
    expect(r!.exception.needs).toMatch(/Restore the insurer/);
    const [w] = await sql<{ task_status: string; required_action: string }[]>`select task_status, required_action from work_items where id = ${r!.work_item_id}`;
    expect(w!.task_status).toBe("needs_you");
    expect(w!.required_action).toMatch(/Restore the insurer/);
    expect((await call(READER, "POST", `/workflows/runs/${r!.id}/resume`)).status).toBe(403);
    await sql`update policies set insurer_id = ${JUBILEE} where id = ${policyNoInsurer}`;
    void archivedInsurer;
    const resumed = await call(AMINA, "POST", `/workflows/runs/${r!.id}/resume`);
    expect(resumed.body.run.state).toBe("waiting_approval");
  });

  it("11 · no terms 14 days before expiry escalates as an exception naming the insurer and what to do", async () => {
    const [r] = await runFor(periodNoInsurer);
    const run = (await call(AMINA, "GET", `/workflows/runs/${r!.id}`)).body;
    await call(AMINA, "POST", `/workflow-approvals/${run.approval.id}/decide`, { decision: "approve", bundleSha256: run.approval.bundleSha256 });
    // The period ends in 20 days. With 16 days left it still waits; inside 14 days it escalates.
    await advanceRun(serviceClient(), log, RENEWAL, r!.id, new Date(Date.now() + 4 * DAY));
    expect((await runFor(periodNoInsurer))[0]!.state).toBe("waiting_party");
    const step = (await call(AMINA, "GET", `/workflows/runs/${r!.id}`)).body.steps.find((s: Json) => s.key === "detect");
    expect(step.output.windowBasis).toMatch(/60 days before expiry, chase after 5 days/);
    await advanceRun(serviceClient(), log, RENEWAL, r!.id, new Date(Date.now() + 8 * DAY));
    const [after] = await runFor(periodNoInsurer);
    expect(after!.state).toBe("exception");
    expect(after!.exception.code).toBe("no_terms_near_expiry");
    expect(after!.exception.needs).toMatch(/Call the underwriter at Jubilee/);
  });

  it("14 · Work, Activity and the renewal list read the run; the client message can be recorded as delivered", async () => {
    const list = (await call(AMINA, "GET", "/workflows/renewals")).body;
    expect(list.runs.find((x: Json) => x.id === runId).stateLabel).toBe("Ready to present to the client");
    const byWork = (await call(AMINA, "GET", `/work-items/${workItemId}/workflow`)).body;
    expect(byWork.run.id).toBe(runId);
    const audit = (await call(AMINA, "GET", "/audit")).body.entries as Json[];
    expect(audit.some((e) => e.action === "workflow.renewal.pack" && e.actorType === "automation")).toBe(true);
    const clientMsg = byWork.run.communications.find((m: Json) => m.audience === "client");
    const del = await call(AMINA, "POST", `/prepared-communications/${clientMsg.id}/delivery`, { method: "own_email", reference: "Emailed from Outlook 10:02" });
    expect(del.body.outcome).toBe("done");
    expect((await call(AMINA, "POST", `/prepared-communications/${clientMsg.id}/delivery`, { method: "own_email", reference: "again" })).body.outcome).toBe("already");
    expect((await call(READER, "POST", `/prepared-communications/${clientMsg.id}/delivery`, { method: "own_email", reference: "x123" })).status).toBe(403);
  });
});
