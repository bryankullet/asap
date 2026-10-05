/**
 * The exception helper (D-146), connected. A run stops; ASAP reads only its own brokerage, writes
 * one suggested fix with its evidence, and a person accepts it — which records the insurer address
 * as that person, through the ordinary path. An address the evidence does not show is never
 * offered as an action, and with no usable model answer nothing is written.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FakeScript } from "../../src/ai/providers/fake.js";
import type { createApp } from "../../src/app.js";
import { engineToken } from "../../src/supabase.js";
import { AMINA, buildApp, caller, newApiKey, ORG_A, ORG_B, OWNER } from "./_harness.js";

const API_KEY = newApiKey();
const TAG = randomUUID().slice(0, 6);
const INSURER = `Pioneer General ${TAG}`;
const GOOD = `claims-${TAG}@pioneer.test`;
const script: FakeScript = [
  {
    match: new RegExp(`"code":"tools_${TAG}"`),
    reply: { text: "", toolCalls: [{ id: "t1", name: "find_clients", arguments: { name: "Acme" } }], stop: "tool_use" },
    then: { text: JSON.stringify({ suggestion: "The client file was read; ask the account executive to confirm the insurer's address.", evidence: ["run", "tool:t1"], action: null, confidence: 0.6 }), toolCalls: [], stop: "end" },
  },
  { match: new RegExp(`"code":"no_address_${TAG}"`), reply: { text: JSON.stringify({ suggestion: `${INSURER} has no address on file; ${GOOD} wrote to this brokerage about it.`, evidence: ["run", "verified_addresses"], action: { type: "record_insurer_contact", email: GOOD }, confidence: 0.8 }), toolCalls: [], stop: "end" } },
  { match: new RegExp(`"code":"invented_${TAG}"`), reply: { text: JSON.stringify({ suggestion: "Record the address underwriting@made-up.test for the insurer.", evidence: ["run"], action: { type: "record_insurer_contact", email: "underwriting@made-up.test" }, confidence: 0.9 }), toolCalls: [], stop: "end" } },
];
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);

async function stoppedRun(code: string) {
  const [w] = await sql`insert into work_items (organization_id, title, kind, task_status, steps) values (${ORG_A}, ${"Stopped " + TAG}, 'placement', 'needs_you', '[]') returning id`;
  const [r] = await sql`insert into workflow_runs (organization_id, workflow, subject_type, subject_id, work_item_id, state, current_step, exception, facts)
    values (${ORG_A}, 'placement', 'placement', gen_random_uuid(), ${w!["id"]}, 'exception', 'confirmation', ${sql.json({ code, message: `${INSURER} cannot be chased: no address is on file.`, needs: "Record the insurer's address." })}, ${sql.json({ withParty: INSURER })}) returning id`;
  const [e] = await sql`insert into events (organization_id, event_type, entity_type, entity_id, actor, payload) values (${ORG_A}, 'run.could_not_finish', 'workflow_run', ${r!["id"]}, 'automation', ${sql.json({ runId: r!["id"], code })}) returning id`;
  const res = await app.request(`/internal/events/${e!["id"]}/dispatch`, { method: "POST", headers: { "x-asap-internal-key": API_KEY } });
  expect(res.status).toBe(200);
  // A duplicated delivery of the same event writes nothing more.
  await app.request(`/internal/events/${e!["id"]}/dispatch`, { method: "POST", headers: { "x-asap-internal-key": API_KEY } });
  return r!["id"] as string;
}

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-exception-helper')`;
  app = buildApp(API_KEY, script);
  await sql`insert into insurers (organization_id, name) values (${ORG_A}, ${INSURER})`;
  const r = await call(AMINA, "POST", "/inbound/messages", { from: GOOD, subject: `Claim query ${TAG}`, body: `Dear broker, ${INSURER} claims desk here — please send the claim form to this address.` });
  expect(r.status).toBe(201);
});
afterAll(async () => {
  await sql.end();
});

describe("the exception helper", () => {
  it("writes one suggestion with its evidence; accepting records the address as the person", async () => {
    const runId = await stoppedRun(`no_address_${TAG}`);
    const s = (await call(AMINA, "GET", `/workflows/runs/${runId}/suggestion`)).body.suggestion;
    expect(s).toMatchObject({ state: "proposed", action: { type: "record_insurer_contact", email: GOOD } });
    expect((s.evidence as { ref: string }[]).map((e) => e.ref)).toEqual(["run", "verified_addresses"]);
    expect((await sql`select count(*)::int as n from exception_suggestions where run_id = ${runId}`)[0]!["n"]).toBe(1);
    expect((await sql`select count(*)::int as n from insurer_contacts where email = ${GOOD}`)[0]!["n"]).toBe(0);

    const d = await call(AMINA, "POST", `/exception-suggestions/${s.id}/decide`, { decision: "accept" });
    expect(d.body).toMatchObject({ outcome: "done", state: "accepted" });
    const [c] = await sql`select verified_by, source from insurer_contacts where email = ${GOOD}`;
    expect(c!["verified_by"]).toBe(AMINA.id);
    expect(String(c!["source"])).toMatch(/confirmed by the person accepting/);
    expect((await call(AMINA, "POST", `/exception-suggestions/${s.id}/decide`, { decision: "reject", note: "Too late" })).body.outcome).toBe("already");
  });

  it("an address the evidence does not show is never offered as an action", async () => {
    const runId = await stoppedRun(`invented_${TAG}`);
    const s = (await call(AMINA, "GET", `/workflows/runs/${runId}/suggestion`)).body.suggestion;
    expect(s.action).toBeNull();
  });

  it("with no usable answer from the model, nothing is written and the exception stands as it is", async () => {
    const runId = await stoppedRun(`unscripted_${TAG}`);
    expect((await call(AMINA, "GET", `/workflows/runs/${runId}/suggestion`)).body.suggestion).toBeNull();
    expect((await sql`select state from workflow_runs where id = ${runId}`)[0]!["state"]).toBe("exception");
  });

  it("looks further with the declared read-only tools, on a connection that reads one brokerage", async () => {
    const runId = await stoppedRun(`tools_${TAG}`);
    const s = (await call(AMINA, "GET", `/workflows/runs/${runId}/suggestion`)).body.suggestion;
    expect((s.evidence as { ref: string; label: string }[]).map((e) => e.ref)).toEqual(["run", "tool:t1"]);
    expect((s.evidence as { label: string }[])[1]!.label).toBe("Read with find_clients");
    const [a] = await sql`select new_state from audit_log where action = 'workflow.suggestion_proposed' and object_id = ${runId}`;
    expect((a!["new_state"] as { toolsRead: number }).toolsRead).toBe(1);
  });

  it("the engine's token reads its brokerage and nothing else — RLS decides, not the query", async () => {
    const rest = process.env["CONNECTED_POSTGREST_URL"]!;
    const get = async (org: string, path: string) => {
      const res = await fetch(`${rest}/${path}`, { headers: { Authorization: `Bearer ${engineToken(process.env["CONNECTED_JWT_SECRET"]!, org)}` } });
      expect(res.status).toBe(200);
      return (await res.json()) as { organization_id: string }[];
    };
    const asA = await get(ORG_A, "clients?select=organization_id");
    expect(asA.length).toBeGreaterThan(0);
    expect(new Set(asA.map((r) => r.organization_id))).toEqual(new Set([ORG_A]));
    const asB = await get(ORG_B, "clients?select=organization_id");
    expect(asB.every((r) => r.organization_id === ORG_B)).toBe(true);
    // It reads; it cannot write.
    const write = await fetch(`${rest}/clients`, { method: "POST", headers: { Authorization: `Bearer ${engineToken(process.env["CONNECTED_JWT_SECRET"]!, ORG_A)}`, "Content-Type": "application/json" }, body: JSON.stringify({ organization_id: ORG_A, name: "Engine wrote this", kind: "corporate", source: "manual" }) });
    expect(write.status).toBeGreaterThanOrEqual(400);
  });
});
