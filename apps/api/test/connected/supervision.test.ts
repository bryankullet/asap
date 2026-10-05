/**
 * Supervision (D-131), proved on Renewal Autopilot against the real API, PostgREST and Postgres.
 *
 * Seven renewals — one each: requiring approval, blocked, waiting on an insurer with a scheduled
 * follow-up, healthy (ASAP handling), escalated, paused, completed — and one supervision read that
 * must agree with every run's own view. Then the controls: reschedule, follow up now, pause and
 * resume, stop, escalate; duplicates, permissions, another brokerage, and the audit trail.
 */
import { randomUUID } from "node:crypto";
import pino from "pino";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { advanceRun, RENEWAL } from "../../src/workflows/renewal.js";
import { ACME, AMINA, BETA, buildApp, caller, JUBILEE, newApiKey, ORG_A, OWNER, READER, serviceClient, type Json } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const log = pino({ level: "silent" });
const DAY = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const TAG = randomUUID().slice(0, 6);

type Case = { period: string; policy: string; run: string };
const cases: Record<"approval" | "blocked" | "waiting" | "escalated" | "paused" | "completed" | "stopped", Case> = {} as never;

async function period(label: string, daysToEnd: number, policyNumber: string | null) {
  const [pol] = await sql<{ id: string }[]>`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
    values (${ORG_A}, ${ACME}, ${JUBILEE}, 'Commercial motor', ${policyNumber}) returning id`;
  const [per] = await sql<{ id: string }[]>`insert into policy_periods (organization_id, policy_id, period_start, period_end, premium_amount, premium_currency, premium_basis)
    values (${ORG_A}, ${pol!.id}, ${iso(new Date(Date.now() - 300 * DAY))}, ${iso(new Date(Date.now() + daysToEnd * DAY))}, 1200000, 'KES', 'gross') returning id`;
  void label;
  return { period: per!.id, policy: pol!.id, run: "" };
}
const start = async (c: Case) => {
  const res = await call(AMINA, "POST", "/workflows/renewals", { policyPeriodId: c.period });
  expect(res.status).toBe(200);
  c.run = res.body.run.id;
  return res.body.run;
};
const get = async (c: Case) => (await call(AMINA, "GET", `/workflows/runs/${c.run}`)).body;
const approve = async (c: Case) => {
  const r = await get(c);
  return call(AMINA, "POST", `/workflow-approvals/${r.approval.id}/decide`, { decision: "approve", bundleSha256: r.approval.bundleSha256 });
};
const deliver = async (c: Case) => {
  const out = (await get(c)).steps.find((s: Json) => s.key === "open_terms").output;
  await call(AMINA, "POST", `/opportunities/${out.opportunityId}/actions`, { action: "record_delivery", quoteRequestId: out.quoteRequestId, method: "own_email", reference: `Sent to Jubilee underwriting ${TAG}` });
  await advanceRun(serviceClient(), log, RENEWAL, c.run);
  return out;
};
const audits = async (runId: string, action: string) => (await sql`select actor_user_id, result from audit_log where object_id = ${runId} and action = ${action} and result = 'success'`) as unknown as { actor_user_id: string | null; result: string }[];

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-supervision')`;
  app = buildApp(API_KEY);
  await sql`insert into client_contacts (organization_id, client_id, full_name, email, is_primary)
    select ${ORG_A}, ${ACME}, 'Wanjiru Kamau', 'wanjiru@acme.test', true
    where not exists (select 1 from client_contacts where client_id = ${ACME} and email is not null and deleted_at is null)`;
  // Outside the 60-day window, so each is started by a person and only by a person.
  cases.approval = await period("approval", 95, `SUP-A-${TAG}`);
  cases.blocked = await period("blocked", 96, null);
  cases.waiting = await period("waiting", 97, `SUP-W-${TAG}`);
  cases.escalated = await period("escalated", 98, `SUP-E-${TAG}`);
  cases.paused = await period("paused", 99, `SUP-P-${TAG}`);
  cases.completed = await period("completed", 100, `SUP-C-${TAG}`);
  cases.stopped = await period("stopped", 101, `SUP-S-${TAG}`);
});
afterAll(async () => {
  await sql.end();
});

describe("Supervision on Renewal Autopilot", () => {
  it("a renewal started by a person says so, prepares everything and asks for ONE approval", async () => {
    const run = await start(cases.approval);
    expect(run.state).toBe("waiting_approval");
    const o = run.operational;
    expect(o.origin).toBe("manual");
    expect(o.originLabel).toMatch(/^Started by .+ on /);
    expect(o.status).toMatch(/^Waiting for approval from /);
    expect(o.currentWork.title).toBe("Renewal pack ready");
    expect(o.completed).toMatch(/^ASAP checked the policy, (reviewed|looked for) the schedule, prepared the renewal pack and drafted two messages\.$/);
    expect(o.primaryAction).toEqual({ kind: "approve", label: "Approve bundle" });
    expect(o.afterYouAct).toMatch(/Nothing is sent automatically/);
    expect(o.attention).toBe(true);
    expect(o.blockers.length).toBeLessThanOrEqual(3);
    expect(o.blockers.every((b: Json) => b.blocking === false)).toBe(true);
    expect(o.interventions.find((i: Json) => i.key === "approve").available).toBe(true);
    expect(o.interventions.find((i: Json) => i.key === "follow_up_now")).toMatchObject({ available: false, why: expect.stringMatching(/not been delivered/) });
    expect(run.communications).toHaveLength(2);
    expect((await sql`select count(*)::int as n from workflow_approvals where run_id = ${cases.approval.run}`)[0]!["n"]).toBe(1);
    // Starting it again is the same renewal: one run, one Work item.
    const again = await call(AMINA, "POST", "/workflows/renewals", { policyPeriodId: cases.approval.period });
    expect(again.body.outcome).toBe("already");
    expect(again.body.run.id).toBe(cases.approval.run);
    expect((await sql`select count(*)::int as n from workflow_runs where subject_id = ${cases.approval.period}`)[0]!["n"]).toBe(1);
    expect((await sql`select count(*)::int as n from work_items where policy_period_id = ${cases.approval.period} and deleted_at is null`)[0]!["n"]).toBe(1);
  });

  it("missing blocking information stops safely before approval; correcting it resumes the SAME run", async () => {
    const run = await start(cases.blocked);
    expect(run.state).toBe("exception");
    expect(run.approval).toBeNull();
    const o = run.operational;
    expect(o.status).toBe("Waiting for information: policy number");
    expect(o.blockers[0]).toMatchObject({ label: "Policy number", blocking: true, fix: "Add the policy number to the policy record" });
    expect(o.primaryAction.kind).toBe("resume");
    expect((await call(READER, "POST", `/workflows/runs/${cases.blocked.run}/resume`)).status).toBe(403);
    await sql`update policies set policy_number = ${"SUP-B-" + TAG} where id = ${cases.blocked.policy}`;
    const resumed = await call(AMINA, "POST", `/workflows/runs/${cases.blocked.run}/resume`);
    expect(resumed.body.run.id).toBe(cases.blocked.run);
    expect(resumed.body.run.state).toBe("waiting_approval");
    expect((await sql`select count(*)::int as n from workflow_runs where subject_id = ${cases.blocked.period}`)[0]!["n"]).toBe(1);
    expect((await sql`select count(*)::int as n from work_items where policy_period_id = ${cases.blocked.period} and deleted_at is null`)[0]!["n"]).toBe(1);
    const resumedAudit = await audits(cases.blocked.run, "workflow.resumed");
    expect(resumedAudit).toHaveLength(1);
    expect(resumedAudit[0]!.actor_user_id).toBe(AMINA.id);
  });

  it("approval sends nothing; after delivery the run waits on the insurer with a scheduled follow-up", async () => {
    await start(cases.waiting);
    const [a, b] = await Promise.all([approve(cases.waiting), approve(cases.waiting)]);
    expect([a.body.outcome, b.body.outcome].sort()).toEqual(["already", "done"]);
    const approved = await get(cases.waiting);
    expect(approved.operational.status).toBe("Approved — not delivered");
    expect(approved.operational.primaryAction.kind).toBe("record_delivery");
    expect((await sql`select count(*)::int as n from email_send_attempts where organization_id = '10000000-0000-4000-8000-00000000000a'`)[0]!["n"]).toBe(0);
    await deliver(cases.waiting);
    const run = await get(cases.waiting);
    const o = run.operational;
    expect(o.status).toBe("Waiting for terms from Jubilee");
    expect(o.waitingFor.party).toMatch(/Jubilee/);
    expect(o.chasing).toBe("active");
    expect(o.nextFollowUpAt).toBeTruthy();
    expect(new Date(o.nextFollowUpAt).getTime() - Date.now()).toBeGreaterThan(4 * DAY);
    expect(o.attention).toBe(false);
    expect(o.upcoming.map((u: Json) => u.kind)).toEqual(["follow_up", "escalate"]);
  });

  it("reschedule moves the follow-up (audited, idempotent); follow up now raises it once", async () => {
    const friday = iso(new Date(Date.now() + 3 * DAY));
    const moved = await call(AMINA, "POST", `/workflows/runs/${cases.waiting.run}/follow-up`, { on: friday });
    expect(moved.body.outcome).toBe("done");
    expect(moved.body.run.operational.nextFollowUpAt.slice(0, 10)).toBe(friday);
    expect((await call(AMINA, "POST", `/workflows/runs/${cases.waiting.run}/follow-up`, { on: friday })).body.outcome).toBe("already");
    expect((await call(AMINA, "POST", `/workflows/runs/${cases.waiting.run}/follow-up`, { on: "2020-01-01" })).status).toBe(422);
    expect((await call(READER, "POST", `/workflows/runs/${cases.waiting.run}/follow-up`, { on: friday })).status).toBe(403);
    expect(await audits(cases.waiting.run, "workflow.follow_up.moved")).toHaveLength(1);
    const now = await call(AMINA, "POST", `/workflows/runs/${cases.waiting.run}/follow-up-now`);
    expect(now.body.outcome).toBe("done");
    expect(now.body.run.operational.status).toMatch(/^Follow-up due: chase Jubilee/);
    // Repeated sweeps do not chase twice.
    await advanceRun(serviceClient(), log, RENEWAL, cases.waiting.run);
    await advanceRun(serviceClient(), log, RENEWAL, cases.waiting.run);
    expect(await audits(cases.waiting.run, "workflow.renewal.follow_up")).toHaveLength(1);
  });

  it("stop chasing keeps escalation; start again resumes the schedule", async () => {
    const stop = await call(AMINA, "POST", `/workflows/runs/${cases.waiting.run}/chasing`, { stop: true, reason: "Client is negotiating directly" });
    expect(stop.body.run.operational.chasing).toBe("stopped");
    expect(stop.body.run.operational.upcoming.map((u: Json) => u.kind)).toEqual(["escalate"]);
    expect((await call(AMINA, "POST", `/workflows/runs/${cases.waiting.run}/chasing`, { stop: true })).body.outcome).toBe("already");
    const again = await call(AMINA, "POST", `/workflows/runs/${cases.waiting.run}/chasing`, { stop: false });
    expect(again.body.run.operational.chasing).toBe("active");
  });

  it("escalate: Work asks the owner to act; it is on Today; a second escalation records nothing", async () => {
    await start(cases.escalated);
    const res = await call(AMINA, "POST", `/workflows/runs/${cases.escalated.run}/escalate`, { reason: "Client asked for terms this week" });
    expect(res.body.run.operational.escalated).toBe(true);
    expect(res.body.run.operational.status).toMatch(/^Escalated to /);
    expect((await call(AMINA, "POST", `/workflows/runs/${cases.escalated.run}/escalate`, { reason: "Again" })).body.outcome).toBe("already");
    const [w] = await sql<{ task_status: string; required_action: string }[]>`select w.task_status, w.required_action from work_items w join workflow_runs r on r.work_item_id = w.id where r.id = ${cases.escalated.run}`;
    expect(w!.task_status).toBe("needs_you");
    expect(w!.required_action).toMatch(/^Escalated by .+: Client asked for terms this week/);
  });

  it("pause holds the run in place — a sweep does nothing — and resume continues the same run", async () => {
    await start(cases.paused);
    await approve(cases.paused);
    const p = await call(AMINA, "POST", `/workflows/runs/${cases.paused.run}/pause`, { reason: "Waiting for the client's broker letter" });
    expect(p.body.run.operational.paused).toBeTruthy();
    expect(p.body.run.operational.status).toMatch(/^Paused by .+ ASAP will not act until it is resumed$/);
    expect(p.body.run.operational.upcoming).toEqual([]);
    expect((await call(AMINA, "POST", `/workflows/runs/${cases.paused.run}/pause`, {})).body.outcome).toBe("already");
    const out = await advanceRun(serviceClient(), log, RENEWAL, cases.paused.run);
    expect(out.skipped).toBe("paused");
    // Two resumes at once resume once.
    const [r, r2] = await Promise.all([call(AMINA, "POST", `/workflows/runs/${cases.paused.run}/resume`), call(AMINA, "POST", `/workflows/runs/${cases.paused.run}/resume`)]);
    expect([r.body.outcome, r2.body.outcome].sort()).toEqual(["already", "done"]);
    expect(await audits(cases.paused.run, "workflow.resumed")).toHaveLength(1);
    expect(r.body.run.id).toBe(cases.paused.run);
    expect(r.body.run.operational.paused).toBeNull();
    expect(await audits(cases.paused.run, "workflow.paused")).toHaveLength(1);
  });

  it("stop automation cancels the run and leaves its Work open for a person", async () => {
    await start(cases.stopped);
    const res = await call(AMINA, "POST", `/workflows/runs/${cases.stopped.run}/stop`, { reason: "Client moving to another broker" });
    expect(res.body.run.state).toBe("cancelled");
    const [w] = await sql<{ task_status: string; required_action: string }[]>`select w.task_status, w.required_action from work_items w join workflow_runs r on r.work_item_id = w.id where r.id = ${cases.stopped.run}`;
    expect(w!.task_status).toBe("needs_you");
    expect(w!.required_action).toMatch(/^ASAP stopped working on this/);
  });

  it("a completed renewal writes one searchable receipt", async () => {
    await start(cases.completed);
    await approve(cases.completed);
    const out = await deliver(cases.completed);
    await call(AMINA, "POST", `/opportunities/${out.opportunityId}/actions`, { action: "record_response", opportunityInsurerId: out.opportunityInsurerId, outcome: "quoted", receivedAt: new Date().toISOString(), premiumAmount: "1260000.00", premiumCurrency: "KES", validUntil: iso(new Date(Date.now() + 120 * DAY)), sourceNote: "Renewal terms letter." });
    await advanceRun(serviceClient(), log, RENEWAL, cases.completed.run, new Date(Date.now() + 6 * DAY));
    await advanceRun(serviceClient(), log, RENEWAL, cases.completed.run, new Date(Date.now() + 6 * DAY));
    const run = await get(cases.completed);
    expect(run.state).toBe("done");
    expect(run.operational.status).toBe("Ready to present to the client");
    const receipt = (await call(AMINA, "GET", `/workflows/runs/${cases.completed.run}/receipt`)).body;
    expect(receipt.outcome).toBe("Renewal terms ready to present — Jubilee quoted KES 1,260,000 (+5% on expiring)");
    expect(receipt.receipt.approvals).toHaveLength(1);
    expect(receipt.receipt.delivery[0].reference).toMatch(new RegExp(TAG));
    expect(receipt.receipt.links.map((l: Json) => l.label)).toEqual(expect.arrayContaining(["Client", "Policy period", "Work", "Quotation"]));
    expect((await sql`select count(*)::int as n from workflow_receipts where run_id = ${cases.completed.run}`)[0]!["n"]).toBe(1);
    const found = await sql`select run_id from workflow_receipts where search @@ plainto_tsquery('simple', 'Jubilee renewal')`;
    expect(found.map((x) => x["run_id"])).toContain(cases.completed.run);
    // Receipts are not writable from a browser session.
    expect((await call(BETA, "GET", `/workflows/runs/${cases.completed.run}/receipt`)).status).toBe(404);
  });

  it("one supervision read agrees with every run's own view, ranks exceptions first, and lists Upcoming", async () => {
    const s = (await call(AMINA, "GET", "/supervision")).body;
    const mine = s.items.filter((i: Json) => Object.values(cases).some((c) => c.run === i.id));
    expect(mine).toHaveLength(7);
    for (const item of mine) {
      const own = (await call(AMINA, "GET", `/workflows/runs/${item.id}`)).body;
      expect(item.operational.status).toBe(own.operational.status);
      expect(item.operational.nextFollowUpAt).toBe(own.operational.nextFollowUpAt);
      expect(item.stateLabel).toBe(own.stateLabel);
    }
    const byRun = (c: Case) => mine.find((i: Json) => i.id === c.run);
    expect(byRun(cases.completed).views).toEqual(["done"]);
    expect(byRun(cases.stopped).views).toEqual(["done"]);
    expect(byRun(cases.approval).views).toContain("needs_me");
    expect(byRun(cases.waiting).views).toContain("waiting_on_others");
    expect(byRun(cases.escalated).priorityReason).toMatch(/escalated/);
    // Exception-first: every live item ranks above every finished one.
    const firstDone = s.items.findIndex((i: Json) => i.views.includes("done"));
    expect(s.items.slice(firstDone).every((i: Json) => i.views.includes("done"))).toBe(true);
    expect(s.upcoming.some((u: Json) => u.runId === cases.waiting.run && u.kind === "escalate")).toBe(true);
    expect(s.upcoming.every((u: Json, i: number, a: Json[]) => i === 0 || a[i - 1].at <= u.at)).toBe(true);
    expect(s.rules.map((r: Json) => r.key).sort()).toEqual(["renewal.window", "workflow.autonomy"]);
  });

  it("another brokerage sees none of it; a reader can look but not intervene", async () => {
    const other = (await call(BETA, "GET", "/supervision")).body;
    expect(other.items.some((i: Json) => Object.values(cases).some((c) => c.run === i.id))).toBe(false);
    for (const path of ["pause", "escalate", "stop", "follow-up-now"]) {
      expect((await call(BETA, "POST", `/workflows/runs/${cases.waiting.run}/${path}`, { reason: "nope nope" })).status).toBe(404);
      expect((await call(READER, "POST", `/workflows/runs/${cases.waiting.run}/${path}`, { reason: "nope nope" })).status).toBe(403);
    }
    const reader = (await call(READER, "GET", `/workflows/runs/${cases.waiting.run}`)).body;
    expect(reader.operational.interventions.find((i: Json) => i.key === "pause")).toMatchObject({ available: false, why: "Your role cannot change renewal work." });
  });

  it("autonomy rules are validated, versioned and enforced: follow-ups kept with people stop ASAP chasing", async () => {
    const base = { source: "Partners' meeting, 1 Oct", verifiedAt: iso(new Date()) };
    const tooFar = await call(AMINA, "PUT", "/rules", { ...base, key: "workflow.autonomy", value: { actions: { detect_renewals: "act_within_rules", prepare_renewal: "act_within_rules", external_messages: "act_within_rules", follow_up: "act_within_rules", escalate: "act_within_rules", recommend_quote: "prepare" }, approver: "any_approver", assignment: "client_file_owner" } });
    expect(tooFar.status).toBe(422);
    expect(tooFar.body.reason).toMatch(/always wait for a person's approval/);
    const value = { actions: { detect_renewals: "act_within_rules", prepare_renewal: "act_within_rules", external_messages: "act_after_approval", follow_up: "prepare", escalate: "act_within_rules", recommend_quote: "prepare" }, approver: "any_approver", assignment: "client_file_owner", alsoNever: [] };
    expect((await call(AMINA, "PUT", "/rules", { ...base, key: "workflow.autonomy", value })).body.outcome).toBe("done");
    const rules = (await call(AMINA, "GET", "/rules")).body;
    expect(rules.rules.find((r: Json) => r.key === "workflow.autonomy").version).toBe(1);
    expect((await call(AMINA, "PUT", "/rules", { ...base, key: "workflow.autonomy", value: { ...value, assignment: "leave_unassigned" } })).body.outcome).toBe("done");
    expect((await call(AMINA, "GET", "/rules")).body.rules.find((r: Json) => r.key === "workflow.autonomy").version).toBe(2);
    expect((await call(READER, "PUT", "/rules", { ...base, key: "workflow.autonomy", value })).status).toBe(403);
    // Follow-ups now stay with people: the waiting renewal no longer chases on its own.
    await advanceRun(serviceClient(), log, RENEWAL, cases.waiting.run, new Date(Date.now() + 20 * DAY));
    const [w] = await sql<{ required_action: string; reason: string }[]>`select w.required_action, w.reason from work_items w join workflow_runs r on r.work_item_id = w.id where r.id = ${cases.waiting.run}`;
    expect(w!.reason).toMatch(/autonomy rule keeps insurer follow-ups with people/);
    // Put the default back for the other suites.
    await sql`delete from company_rules where organization_id = ${ORG_A} and key = 'workflow.autonomy'`;
  });
});
