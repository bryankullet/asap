/**
 * Semantic events (D-140), connected. Each fact is one event however many times it is reported —
 * a double click, a retried action, a sweep that sees an overdue check twice — and the workflow
 * consumer that reacts to an event is idempotent: the same event dispatched twice starts one run.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { emitEvent } from "../../src/events/emit.js";
import { emitOverdueChecks } from "../../src/workflows/registry.js";
import { liveRunsOn, registerWorkflow, startRun } from "./_registry-harness.js";
import { ACME, AMINA, buildApp, caller, JUBILEE, newApiKey, ORG_A, OWNER, serviceClient } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const internal = (path: string) => app.request(path, { method: "POST", headers: { "x-asap-internal-key": API_KEY } });
const TAG = randomUUID().slice(0, 6);
let policyId = "";

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-events')`;
  app = buildApp(API_KEY);
  const [p] = await sql`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number) values (${ORG_A}, ${ACME}, ${JUBILEE}, 'Commercial motor', ${"EV-" + TAG}) returning id`;
  policyId = p!["id"] as string;
  await sql`insert into policy_periods (organization_id, policy_id, period_start, period_end) values (${ORG_A}, ${policyId}, '2026-01-01', '2026-12-31')`;
});
afterAll(async () => {
  await sql.end();
});

const count = async (type: string, entity: string) => (await sql`select count(*)::int as n from events where event_type = ${type} and entity_id = ${entity}`)[0]!["n"] as number;

describe("each fact is one event", () => {
  it("a claim reported twice at once is one claim.reported; its insurer reference recorded twice is one claim.registered", async () => {
    const body = { kind: "claim", clientId: ACME, incidentOn: "2026-09-28", incidentSummary: `Collision at the depot ${TAG}, front bumper damaged.`, policyId, source: "ask" };
    const [a, b] = await Promise.all([call(AMINA, "POST", "/work-items", body), call(AMINA, "POST", "/work-items", body)]);
    expect(a.body.item.id).toBe(b.body.item.id);
    const [claim] = await sql`select id from claims where work_item_id = ${a.body.item.id}`;
    const claimId = claim!["id"] as string;
    expect(await count("claim.reported", claimId)).toBe(1);
    const [ev] = await sql`select payload from events where event_type = 'claim.reported' and entity_id = ${claimId}`;
    expect(ev!["payload"]).toMatchObject({ claimId, workItemId: a.body.item.id, clientId: ACME });
    for (let i = 0; i < 2; i++) expect((await call(AMINA, "POST", `/claims/${claimId}/actions`, { action: "set_insurer_reference", reference: `JUB/CLM/${TAG}` })).status).toBe(200);
    expect(await count("claim.registered", claimId)).toBe(1);
  });

  it("an endorsement asked for is one endorsement.requested", async () => {
    const body = { kind: "endorsement", clientId: ACME, policyId, requestText: `Add vehicle KDX ${TAG.slice(0, 3)}A to the policy from 1 November.`, requestedBy: "policyholder" };
    const r = await call(AMINA, "POST", "/work-items", body);
    expect(r.status).toBeLessThan(300);
    const [e] = await sql`select id from endorsements where work_item_id = ${r.body.item.id}`;
    expect(await count("endorsement.requested", e!["id"] as string)).toBe(1);
  });

  it("the sweep emits check.overdue once per item and due date, however often it runs", async () => {
    const due = new Date(Date.now() - 3_600_000).toISOString();
    const [w] = await sql`insert into work_items (organization_id, title, kind, task_status, task_next_check, steps) values (${ORG_A}, ${"Overdue " + TAG}, 'endorsement', 'in_progress', ${due}, '[]') returning id`;
    // The sweep's own emitter, called as the sweep calls it — without advancing other tests' runs.
    await emitOverdueChecks(serviceClient());
    await emitOverdueChecks(serviceClient());
    expect(await count("check.overdue", w!["id"] as string)).toBe(1);
    // A new due date is a new fact.
    await sql`update work_items set task_next_check = ${new Date(Date.now() - 60_000).toISOString()} where id = ${w!["id"]}`;
    await emitOverdueChecks(serviceClient());
    expect(await count("check.overdue", w!["id"] as string)).toBe(2);
  });

  it("an event with the same key is refused by the database, not just by the code", async () => {
    const entity = randomUUID();
    const db = serviceClient();
    const first = await emitEvent(db, null, { organizationId: ORG_A, eventType: "quote.received", entityType: "opportunity", entityId: entity, actor: "system", actorUserId: null, dedupeKey: `${entity}:quoted` });
    const again = await emitEvent(db, null, { organizationId: ORG_A, eventType: "quote.received", entityType: "opportunity", entityId: entity, actor: "system", actorUserId: null, dedupeKey: `${entity}:quoted` });
    expect([first, again]).toEqual(["emitted", "already"]);
    expect(await count("quote.received", entity)).toBe(1);
  });
});

describe("the workflow consumer", () => {
  it("starts one run for an event however many times it is dispatched, and records each delivery", async () => {
    const definition = { workflow: "claim", steps: [{ key: "noted", label: "Noted", run: async () => ({ kind: "done" as const }) }, { key: "hold", label: "Held", run: async () => ({ kind: "wait" as const, on: "party" as const, until: new Date(Date.now() + 86_400_000) }) }] };
    const undo = registerWorkflow({
      definition,
      on: {
        "claim.reported": async (db, _l, ev) => {
          const s = await startRun(db, definition, { organizationId: ev.organization_id, subjectType: "claim", subjectId: ev.entity_id!, workItemId: (ev.payload?.["workItemId"] as string) ?? null, facts: {} });
          return [s.runId];
        },
      },
    });
    try {
      const claimEntity = randomUUID();
      const [ev] = await sql`insert into events (organization_id, event_type, entity_type, entity_id, actor) values (${ORG_A}, 'claim.reported', 'claim', ${claimEntity}, 'system') returning id`;
      const first = await internal(`/internal/events/${ev!["id"]}/dispatch`);
      const second = await internal(`/internal/events/${ev!["id"]}/dispatch`);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      const body = (await first.json()) as { results: { consumer: string; result: string }[] };
      expect(body.results.find((r) => r.consumer === "workflow.claim")?.result).toBe("success");
      const runs = await liveRunsOn(serviceClient(), ORG_A, "claim", claimEntity);
      expect(runs).toHaveLength(1);
      expect((await sql`select state, current_step from workflow_runs where id = ${runs[0]!}`)[0]).toMatchObject({ state: "waiting_party", current_step: "hold" });
    } finally {
      undo();
    }
  });
});
