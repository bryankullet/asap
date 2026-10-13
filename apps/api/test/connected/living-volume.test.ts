/**
 * Bursts and volume on real Postgres (D-168). Concurrent saves and handovers stay consistent (each
 * version once; one handover wins, the other is refused as stale); a burst of filed email stays within
 * what a block may show; a client with hundreds of records composes within limits and on time.
 */
import { livingSurfaceSchema } from "@asap/schema";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { AMINA, buildApp, caller, JUBILEE, KAMAU, newApiKey, ORG_A, OWNER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const TAG = randomUUID().slice(0, 6);
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
let clientId = "";
let renewalWork = "";
let oiIds: string[] = [];

beforeAll(async () => {
  sql = postgres(OWNER, { max: 4, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-living-volume')`;
  app = buildApp(API_KEY);
  const [c] = await sql<{ id: string }[]>`insert into clients (organization_id, name, kind, source) values (${ORG_A}, ${`Volume Holdings ${TAG}`}, 'corporate', 'seed') returning id`;
  clientId = c!.id;
  // 150 policies with a period each, 250 open work items and 40 claims for one client.
  await sql`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number)
    select ${ORG_A}, ${clientId}, ${JUBILEE}, 'Class ' || (g % 9), ${`VOL-${TAG}-`} || g from generate_series(1, 150) g`;
  await sql`insert into policy_periods (organization_id, policy_id, period_start, period_end)
    select ${ORG_A}, p.id, ${day(-200)}::date + (row_number() over () % 30)::int, ${day(160)}::date + (row_number() over () % 30)::int from policies p where p.client_id = ${clientId}`;
  await sql`insert into work_items (organization_id, title, kind, task_status, client_id, task_party, task_since)
    select ${ORG_A}, ${`Volume work ${TAG} `} || g, (array['certificate','tor','placement','new_business'])[1 + g % 4], (array['needs_you','with_party'])[1 + g % 2], ${clientId}, case when g % 2 = 1 then 'Jubilee' end, case when g % 2 = 1 then now() end from generate_series(1, 250) g`;
  // A renewal for this client with a quotation of three insurers, to save proposals against.
  const [pol] = await sql<{ id: string }[]>`select id from policies where client_id = ${clientId} limit 1`;
  const [per] = await sql<{ id: string }[]>`select id from policy_periods where policy_id = ${pol!.id}`;
  expect((await call(AMINA, "POST", "/workflows/renewals", { policyPeriodId: per!.id })).status).toBe(200);
  renewalWork = (await sql<{ work_item_id: string }[]>`select work_item_id from workflow_runs where subject_id = ${per!.id}`)[0]!.work_item_id;
  let [opp] = await sql<{ id: string }[]>`select id from opportunities where work_item_id = ${renewalWork}`;
  if (!opp) [opp] = await sql<{ id: string }[]>`insert into opportunities (organization_id, client_id, work_item_id, title, class_of_business, created_by) values (${ORG_A}, ${clientId}, ${renewalWork}, ${`Volume renewal ${TAG}`}, 'Class 0', ${AMINA.id}) returning id`;
  const [oi] = await sql<{ id: string }[]>`insert into opportunity_insurers (organization_id, opportunity_id, insurer_id, added_by) values (${ORG_A}, ${opp!.id}, ${JUBILEE}, ${AMINA.id}) returning id`;
  oiIds = [oi!.id];
});
afterAll(async () => {
  await sql.end();
});

describe("bursts", () => {
  it("numbers ten proposals saved at once 1 to 10, each exactly once", async () => {
    const rs = await Promise.all(Array.from({ length: 10 }, () => call(KAMAU, "POST", `/living/${renewalWork}/proposals`, { explore: oiIds.join(",") })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect(rs.map((r) => r.body.version).sort((a: number, b: number) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("lets one of two simultaneous handovers win and refuses the other as stale", async () => {
    const [w] = await sql<{ version: number }[]>`select version from work_items where id = ${renewalWork}`;
    const body = (to: string) => ({ version: String(w!.version), toUserId: to, done: "Terms requested", open: "Waiting on Jubilee" });
    const [a, b] = await Promise.all([call(KAMAU, "POST", `/work-items/${renewalWork}/hand-over`, body(AMINA.id)), call(AMINA, "POST", `/work-items/${renewalWork}/hand-over`, body(KAMAU.id))]);
    const outcomes = [a.body.outcome, b.body.outcome].sort();
    expect(outcomes).toEqual(["applied", "blocked"]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await sql`select count(*)::int as n from work_handovers where work_item_id = ${renewalWork}`)[0]!["n"]).toBe(1);
  });

  it("shows at most eight of a burst of forty emails filed to one run, and composes", async () => {
    const [run] = await sql<{ id: string; current_step: string; facts: Record<string, unknown> }[]>`select id, current_step, facts from workflow_runs where work_item_id = ${renewalWork}`;
    const inbound = Array.from({ length: 40 }, (_, i) => ({ messageId: randomUUID(), from: `sender${i}@example.test`, subject: `Burst ${i} ${TAG}`, at: new Date().toISOString(), kind: "other", party: null, step: run!.current_step, by: "auto", acknowledged: false }));
    await sql`update workflow_runs set facts = ${sql.json({ ...run!.facts, inbound } as never)} where id = ${run!.id}`;
    const s = livingSurfaceSchema.parse((await call(AMINA, "GET", `/living/${renewalWork}`)).body);
    expect((s.blocks.find((b) => b.id === "arrived")!.props as { items: unknown[] }).items).toHaveLength(8);
  });

  it("answers fifty concurrent reads of one workspace with the same composition", async () => {
    const rs = await Promise.all(Array.from({ length: 50 }, () => call(AMINA, "GET", `/living/${renewalWork}`)));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    const own = (b: { blocks: { id: string; hash: string }[] }) => JSON.stringify(b.blocks.filter((x) => x.id !== "related" && x.id !== "patterns").map((x) => [x.id, x.hash]));
    expect(new Set(rs.map((r) => own(r.body))).size).toBe(1);
  });
});

describe("volume", () => {
  it("composes a client with 150 policies and 250 open items within the surface's limits, quickly", async () => {
    const times: number[] = [];
    let last: unknown = null;
    for (let i = 0; i < 6; i++) {
      const t = performance.now();
      const r = await call(AMINA, "GET", `/living/client/${clientId}`);
      times.push(performance.now() - t);
      expect(r.status).toBe(200);
      last = r.body;
    }
    const s = livingSurfaceSchema.parse(last);
    const header = s.blocks[0]!.props as { facts: { label: string; value: string }[] };
    // Counted by the database, not by the rows a block shows.
    expect(header.facts.find((f) => f.label === "Open work")!.value).toBe("251");
    expect(header.facts.find((f) => f.label === "Policies in force")!.value).toBe("150 of 150 on file");
    expect(s.blocks.find((b) => b.id === "work")!.title).toBe("Open work — the 8 most pressing of the 60 most recently changed (251 open)");
    expect(s.blocks.find((b) => b.id === "cover")!.title).toBe("Cover on file — ending soonest (12 shown of 150 policies)");
    expect((s.blocks.find((b) => b.id === "cover")!.props as { items: unknown[] }).items).toHaveLength(12);
    const p95 = [...times].sort((a, b) => a - b)[Math.floor(times.length * 0.95)] ?? Math.max(...times);
    // eslint-disable-next-line no-console -- the measured number is the point of this test
    console.info(`client investigation p95 with 150 policies / 250 open items: ${p95.toFixed(0)} ms`);
    // The budget is held where timing means something: run alone (pnpm test:connected:perf, D-169).
    if (process.env["CONNECTED_PERF"]) expect(p95).toBeLessThan(1500);
  });
});
