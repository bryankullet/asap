/**
 * The claim notice's own approval flow (D-150), connected, in the second brokerage. With the insurer's
 * address verified, the claim run prepares the notice — plain facts, no view on cover — for one
 * approval; a person delivers it (no mailbox here); its delivery completes the claim's "submitted"
 * step and the run waits on the insurer for its reference. Without a verified address, a person
 * notifies the insurer, as before.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { BETA, buildApp, caller, newApiKey, ORG_B, OWNER } from "./_harness.js";

const API_KEY = newApiKey();
const TAG = randomUUID().slice(0, 6);
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const started = new Date().toISOString();
const day = (o: number) => new Date(Date.now() + o * 86_400_000).toISOString().slice(0, 10);
let clientId = "";
let insurerId = "";
let insurerName = "";
let policyId = "";
let periodId = "";
let policy2 = "";
let period2 = "";

async function pump(...ids: string[]) {
  for (let round = 0; round < 6; round++) {
    const runIds = (await sql`select id from workflow_runs where subject_id = any(${ids}::uuid[])`).map((r) => r["id"] as string);
    const evs = await sql`select id from events where organization_id = ${ORG_B} and processed_at is null and occurred_at >= ${started} and entity_id = any(${[...ids, ...runIds]}::uuid[]) order by occurred_at`;
    if (!evs.length) return;
    for (const e of evs) {
      expect((await app.request(`/internal/events/${e["id"]}/dispatch`, { method: "POST", headers: { "x-asap-internal-key": API_KEY } })).status).toBe(200);
      await sql`update events set processed_at = now() where id = ${e["id"]}`;
    }
  }
}
const work = async (id: string) => (await sql`select task_status, required_action, reason, version, steps from work_items where id = ${id}`)[0]!;
const act = async (id: string, body: Record<string, unknown>) => call(BETA, "POST", `/work-items/${id}/actions`, { ...body, version: (await work(id))["version"] });

async function claimAtNotify(summary: string, second = false) {
  const pol = second ? policy2 : policyId;
  const per = second ? period2 : periodId;
  const r = await call(BETA, "POST", "/work-items", { kind: "claim", clientId, incidentOn: day(-1), incidentSummary: summary, policyId: pol, source: "ask" });
  expect(r.status).toBe(201);
  const workId = r.body.item.id as string;
  const claimId = (await sql`select id from claims where work_item_id = ${workId}`)[0]!["id"] as string;
  await pump(claimId);
  expect((await act(workId, { stepId: "match", verb: "record_evidence", evidence: "Schedule page 1", policyPeriodId: per })).body.outcome).toBe("applied");
  await pump(claimId);
  expect((await act(workId, { stepId: "documents", verb: "record_evidence", evidence: "Photos and abstract received" })).body.outcome).toBe("applied");
  await pump(claimId);
  const run = (await sql`select id, state, current_step from workflow_runs where workflow = 'claim' and subject_id = ${claimId}`)[0]!;
  return { workId, claimId, run };
}

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-claim-notice')`;
  app = buildApp(API_KEY);
  [{ id: clientId }] = (await sql`insert into clients (organization_id, name, kind, source) values (${ORG_B}, ${`Notice Movers ${TAG} Ltd`}, 'corporate', 'manual') returning id`) as unknown as [{ id: string }];
  insurerName = `Old Mutual General ${TAG}`;
  [{ id: insurerId }] = (await sql`insert into insurers (organization_id, name) values (${ORG_B}, ${insurerName}) returning id`) as unknown as [{ id: string }];
  [{ id: policyId }] = (await sql`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number) values (${ORG_B}, ${clientId}, ${insurerId}, 'Commercial motor', ${`OMG/MTR/${TAG}`}) returning id`) as unknown as [{ id: string }];
  [{ id: periodId }] = (await sql`insert into policy_periods (organization_id, policy_id, period_start, period_end) values (${ORG_B}, ${policyId}, ${day(-100)}, ${day(265)}) returning id`) as unknown as [{ id: string }];
  await sql`insert into policy_versions (organization_id, policy_id, version, effective_from, source) values (${ORG_B}, ${policyId}, 1, ${day(-100)}, 'seed')`;
  [{ id: policy2 }] = (await sql`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number) values (${ORG_B}, ${clientId}, ${insurerId}, 'Commercial motor', ${`OMG/MTR2/${TAG}`}) returning id`) as unknown as [{ id: string }];
  [{ id: period2 }] = (await sql`insert into policy_periods (organization_id, policy_id, period_start, period_end) values (${ORG_B}, ${policy2}, ${day(-100)}, ${day(265)}) returning id`) as unknown as [{ id: string }];
  await sql`insert into policy_versions (organization_id, policy_id, version, effective_from, source) values (${ORG_B}, ${policy2}, 1, ${day(-100)}, 'seed')`;
});
afterAll(async () => {
  await sql.end();
});

describe("the claim notice's approval flow", () => {
  it("without a verified insurer address, a person notifies the insurer; nothing is prepared", async () => {
    const c = await claimAtNotify(`Bumper damaged at Kitengela ${TAG}.`);
    expect(c.run).toMatchObject({ current_step: "notify", state: "waiting_party" });
    expect(String((await work(c.workId))["reason"])).toMatch(/ASAP prepares the notice for approval once .* has a verified address on file/);
    expect((await sql`select count(*)::int as n from workflow_approvals where run_id = ${c.run["id"]}`)[0]!["n"]).toBe(0);
  });

  it("with the address verified, ASAP prepares the notice for one approval; delivered, it completes the submitted step", async () => {
    expect((await call(BETA, "POST", `/insurers/${insurerId}/contacts`, { email: `claims-${TAG}@oldmutual.test`, source: "Old Mutual claims circular, Oct 2026" })).status).toBe(201);
    const c = await claimAtNotify(`Windscreen cracked on Waiyaki Way ${TAG}.`, true);
    expect(c.run).toMatchObject({ current_step: "notify", state: "waiting_approval" });
    expect(String((await work(c.workId))["required_action"])).toMatch(new RegExp(`^Review and approve the claim notice to ${insurerName} — due `));
    const [a] = await sql`select id, bundle, bundle_sha256 from workflow_approvals where run_id = ${c.run["id"]} and step_key = 'notify'`;
    const item = (a!["bundle"] as { to: string; body: string }[])[0]!;
    expect(item.to).toBe(`claims-${TAG}@oldmutual.test`);
    expect(item.body).toMatch(new RegExp(`Windscreen cracked on Waiyaki Way ${TAG}`));
    expect(item.body).not.toMatch(/\b(covered|not covered|repudiat|liab|payable)\w*/i);

    expect((await call(BETA, "POST", `/workflow-approvals/${a!["id"]}/decide`, { decision: "approve", bundleSha256: a!["bundle_sha256"] })).status).toBe(200);
    await pump(c.claimId);
    expect(String((await work(c.workId))["required_action"])).toMatch(/^Deliver the approved claim notice to /);
    const [m] = await sql`select id from prepared_communications where approval_id = ${a!["id"]}`;
    expect((await call(BETA, "POST", `/prepared-communications/${m!["id"]}/delivery`, { method: "own_email", reference: "Sent from my mailbox at 09:20" })).status).toBe(200);
    await pump(c.claimId);
    const run = (await sql`select state, current_step from workflow_runs where id = ${c.run["id"]}`)[0]!;
    expect(run).toMatchObject({ state: "waiting_party", current_step: "registration" });
    const submit = ((await work(c.workId))["steps"] as { id: string; state: string; recorded: { kind: string; reference: string }[] }[]).find((s) => s.id === "submit")!;
    expect(submit.state).toBe("done");
    expect(submit.recorded.at(-1)).toMatchObject({ kind: "record_send", reference: "Sent from my mailbox at 09:20" });
    expect((await sql`select count(*)::int as n from email_send_attempts where organization_id = ${ORG_B} and approved_by = ${BETA.id} and work_item_id = ${c.workId}`)[0]!["n"]).toBe(0);
  });
});
