/**
 * Insurance-native intelligence in Living workspaces on real Postgres (D-166): structured handovers
 * through the API and the workspace's own commands, email the router filed shown with its proposed
 * step, and related work across a client's claim and policy change. RLS, roles and other brokerages.
 */
import { livingSurfaceSchema, type LivingAction, type LivingSurface } from "@asap/schema";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, BETA, browser, buildApp, caller, JUBILEE, KAMAU, newApiKey, ORG_A, OWNER, READER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const TAG = randomUUID().slice(0, 6);
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type Cmd = Extract<LivingAction, { kind: "command" }>;
const surfaceOf = async (who: typeof AMINA, id: string) => livingSurfaceSchema.parse((await call(who, "GET", `/living/${id}`)).body);
const blockOf = (s: LivingSurface, id: string) => s.blocks.find((b) => b.id === id);
const cmds = (s: LivingSurface, id: string) => (blockOf(s, id)?.actions ?? []).filter((a): a is Cmd => a.kind === "command");
let claimWork = "";
let changeWork = "";

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-living-collaboration')`;
  app = buildApp(API_KEY);
  const [p] = await sql`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number) values (${ORG_A}, ${ACME}, ${JUBILEE}, 'Commercial motor', ${"LC-" + TAG}) returning id`;
  const policyId = p!["id"] as string;
  await sql`insert into policy_periods (organization_id, policy_id, period_start, period_end) values (${ORG_A}, ${policyId}, ${day(-200)}, ${day(165)})`;
  await sql`insert into policy_versions (organization_id, policy_id, version, effective_from, source) values (${ORG_A}, ${policyId}, 1, ${day(-200)}, 'seed')`;
  const c = await call(KAMAU, "POST", "/work-items", { kind: "claim", clientId: ACME, incidentOn: day(-2), incidentSummary: `Windscreen ${TAG}.`, policyId, source: "ask" });
  expect(c.status).toBe(201);
  claimWork = c.body.item.id;
  const e = await call(KAMAU, "POST", "/work-items", { kind: "endorsement", clientId: ACME, policyId, requestText: `Please add vehicle KDZ ${TAG.slice(0, 3)}B.`, requestedBy: "policyholder" });
  expect(e.status).toBe(201);
  changeWork = e.body.item.id;
});
afterAll(async () => {
  await sql.end();
});

describe("handing work over", () => {
  let handoverId = "";
  it("offers a manager of work the handover, with brokerage colleagues as the choices", async () => {
    const s = await surfaceOf(KAMAU, claimWork);
    const hand = cmds(s, "handover").find((c) => c.command === "work.hand_over")!;
    const to = hand.inputs.find((i) => i.name === "toUserId")!;
    expect(to.options.map((o) => o.value)).toContain(AMINA.id);
    expect(to.options.map((o) => o.value)).not.toContain(KAMAU.id);
    expect(to.options.map((o) => o.value)).not.toContain(READER.id);
    expect(to.options.map((o) => o.value)).not.toContain(BETA.id);
  });

  it("hands the claim to a colleague through the workspace's command: the owner changes and it is audited", async () => {
    const s = await surfaceOf(KAMAU, claimWork);
    const hand = cmds(s, "handover").find((c) => c.command === "work.hand_over")!;
    const r = await call(KAMAU, "POST", `/work-items/${hand.target}/hand-over`, { ...hand.payload, toUserId: AMINA.id, done: `Notified Jubilee ${TAG}`, open: "Police abstract outstanding", watch: "Client asked for a call on Friday" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ outcome: "applied", item: { owner_id: AMINA.id } });
    handoverId = r.body.handoverId;
    expect((await sql`select count(*)::int as n from audit_log where object_id = ${claimWork} and action = 'work_item.handed_over'`)[0]!["n"]).toBe(1);
  });

  it("shows the receiver it first, asking them to acknowledge; others see it beside the work", async () => {
    const mine = await surfaceOf(AMINA, claimWork);
    const leads = mine.blocks.filter((b) => b.role === "lead").length;
    expect(mine.blocks[leads]!.id).toBe("handover");
    expect(mine.blocks[leads]!.props).toMatchObject({ done: `Notified Jubilee ${TAG}`, forViewer: true, acknowledgedAt: null, watch: "Client asked for a call on Friday" });
    expect(cmds(mine, "handover").map((c) => c.command)).toContain("work.acknowledge_handover");
    const theirs = await surfaceOf(READER, claimWork);
    expect(blockOf(theirs, "handover")).toMatchObject({ role: "side", props: { forViewer: false } });
    expect(cmds(theirs, "handover")).toEqual([]);
  });

  it("refuses a stale version, a read-only member and another brokerage; only the receiver acknowledges", async () => {
    expect((await call(KAMAU, "POST", `/work-items/${claimWork}/hand-over`, { version: "1", toUserId: AMINA.id, done: "x", open: "y" })).body).toMatchObject({ outcome: "blocked" });
    const ro = await call(READER, "POST", `/work-items/${claimWork}/hand-over`, { version: "99", toUserId: AMINA.id, done: "x", open: "y" });
    expect(ro.status, JSON.stringify(ro.body)).toBe(403);
    expect((await call(BETA, "POST", `/work-items/${claimWork}/hand-over`, { version: "99", toUserId: BETA.id, done: "x", open: "y" })).status).toBe(404);
    // Signed out, nothing is reached (the route sits behind the session guard).
    expect((await app.request(`/work-handovers/${handoverId}/acknowledge`, { method: "POST" })).status).toBe(401);
    expect((await app.request(`/work-items/${claimWork}/hand-over`, { method: "POST" })).status).toBe(401);
    const notMine = await call(KAMAU, "POST", `/work-handovers/${handoverId}/acknowledge`);
    expect(notMine.status, JSON.stringify(notMine.body)).toBe(403);
    expect((await call(BETA, "POST", `/work-handovers/${handoverId}/acknowledge`)).status).toBe(404);
    // Calling the database function from a browser is refused, whoever calls it.
    const direct = await browser(KAMAU, "POST", "rpc/work_handover_acknowledge", { p_handover_id: handoverId });
    expect(direct.status).toBeGreaterThanOrEqual(400);
    expect((await call(AMINA, "POST", `/work-handovers/${handoverId}/acknowledge`)).body).toEqual({ outcome: "applied" });
    expect((await call(AMINA, "POST", `/work-handovers/${handoverId}/acknowledge`)).body).toEqual({ outcome: "already_done" });
    const after = await surfaceOf(AMINA, claimWork);
    expect(blockOf(after, "handover")).toMatchObject({ role: "side", props: { acknowledgedAt: expect.any(String) } });
  });

  it("never shows another brokerage the handover", async () => {
    expect((await call(BETA, "GET", `/living/${claimWork}`)).status).toBe(404);
    const rows = await browser(BETA, "GET", `work_handovers?work_item_id=eq.${claimWork}&select=id`);
    expect(rows.body).toEqual([]);
  });
});

describe("arrived email and related work", () => {
  it("shows email filed to the claim's run with the step it proposes, and records nothing by itself", async () => {
    // The claim's run, as the claim.reported consumer starts it, waiting on documents with an email
    // the router filed to it (D-144). Its next wake is far off so no sweep elsewhere advances it.
    const claimId = (await sql`select id from claims where work_item_id = ${claimWork}`)[0]!["id"] as string;
    const inbound = [{ messageId: randomUUID(), from: "wanjiru@acme.test", subject: `Abstract attached ${TAG}`, at: new Date().toISOString(), kind: "claim_update", party: null, step: "documents", by: "auto", acknowledged: false },
      { messageId: randomUUID(), from: "old@acme.test", subject: "Dealt with already", at: new Date().toISOString(), kind: "claim_update", party: null, step: "intake", by: "auto", acknowledged: false }];
    await sql`insert into workflow_runs (organization_id, workflow, subject_type, subject_id, work_item_id, state, current_step, next_run_at, facts)
      values (${ORG_A}, 'claim', 'claim', ${claimId}, ${claimWork}, 'waiting_party', 'documents', now() + interval '30 days', ${sql.json({ clientId: ACME, origin: "event", inbound } as never)})`;
    const s = await surfaceOf(AMINA, claimWork);
    const b = blockOf(s, "arrived")!;
    expect(b).toBeTruthy();
    const items = (b.props as { items: { subject: string; reading: string; proposed: string }[] }).items;
    // Only what was filed on the step the run is on: the earlier one was dealt with when it moved on.
    expect(items.map((i) => i.subject)).toEqual([`Abstract attached ${TAG}`]);
    const item = items[0]!;
    expect(item).toMatchObject({ subject: `Abstract attached ${TAG}`, reading: expect.stringMatching(/^ASAP's reading: anything about a claim/) });
    expect(item.proposed).toMatch(/record it received below/);
    expect(b.actions).toEqual([]);
    expect(JSON.stringify(s)).not.toMatch(/\b(covered|not covered|repudiat|liab)\w*/i);
    // Read-only members see it too; another brokerage never does.
    expect(blockOf(await surfaceOf(READER, claimWork), "arrived")).toBeTruthy();
  });

  it("names the open policy change on the claim's policy, and why it bears on the claim", async () => {
    const s = await surfaceOf(AMINA, claimWork);
    const items = (blockOf(s, "related")!.props as { items: { title: string; kind: string; why: string; certainty: string; ref: Record<string, string> }[] }).items;
    const change = items.find((i) => i.ref["workItemId"] === changeWork)!;
    expect(change).toMatchObject({ kind: "Policy change", certainty: "potential", ref: { ws: "living" } });
    expect(change.why).toMatch(/assessed on the cover in force on the incident date/);
    const back = await surfaceOf(AMINA, changeWork);
    expect((blockOf(back, "related")!.props as { items: { ref: Record<string, string> }[] }).items.some((i) => i.ref["workItemId"] === claimWork)).toBe(true);
  });
});

describe("what usually happens, and what was decided last time, from this brokerage's records", () => {
  const envFor = async (who: typeof AMINA) => {
    const { userDb } = await import("./_harness.js");
    return { db: userDb(who), organizationId: ORG_A, userId: who.id } as never;
  };
  let insurerName = "";
  let oppOld = "";
  beforeAll(async () => {
    insurerName = `Pattern Mutual ${TAG}`;
    const [ins] = await sql`insert into insurers (organization_id, name) values (${ORG_A}, ${insurerName}) returning id`;
    // Six delivered requests to one insurer over the year; five answered after 2, 3, 3, 4 and 9 days.
    for (let n = 0; n < 6; n++) {
      const [w] = await sql`insert into work_items (organization_id, title, kind, task_status) values (${ORG_A}, ${`Pattern work ${TAG} ${n}`}, 'new_business', 'needs_you') returning id`;
      const [o] = await sql`insert into opportunities (organization_id, client_id, work_item_id, title, class_of_business, created_by, created_at)
        values (${ORG_A}, ${ACME}, ${w!["id"]}, ${`Trail motor ${TAG} ${n}`}, ${`Trail class ${TAG}`}, ${AMINA.id}, now() - make_interval(days => ${300 - n * 10})) returning id`;
      if (n === 5) oppOld = o!["id"] as string;
      const [oi] = await sql`insert into opportunity_insurers (organization_id, opportunity_id, insurer_id, added_by) values (${ORG_A}, ${o!["id"]}, ${ins!["id"]}, ${AMINA.id}) returning id`;
      const [qr] = await sql`insert into quote_requests (organization_id, opportunity_id, opportunity_insurer_id, subject, body_text, prepared_by, approved_body_sha256, approved_by, approved_at)
        values (${ORG_A}, ${o!["id"]}, ${oi!["id"]}, 'Terms please', 'Please quote.', ${AMINA.id}, app.quote_request_digest('Terms please', 'Please quote.'), ${AMINA.id}, now() - interval '210 days') returning id`;
      await sql`insert into quote_request_deliveries (organization_id, quote_request_id, method, reference, delivered_body_sha256, delivered_at, recorded_by)
        values (${ORG_A}, ${qr!["id"]}, 'own_email', 'Sent', app.quote_request_digest('Terms please', 'Please quote.'), now() - make_interval(days => ${200 - n}), ${AMINA.id})`;
      const after = [2, 3, 3, 4, 9][n];
      if (after !== undefined)
        await sql`insert into insurer_responses (organization_id, opportunity_id, opportunity_insurer_id, outcome, received_at, premium_amount, premium_currency, decline_reason, source_note, recorded_by)
          values (${ORG_A}, ${o!["id"]}, ${oi!["id"]}, ${n === 4 ? "declined" : "quoted"}, now() - make_interval(days => ${200 - n - after}), ${n === 4 ? null : 100000}, ${n === 4 ? null : "KES"}, ${n === 4 ? "Outside appetite for this fleet" : null}, 'Underwriter email', ${AMINA.id})`;
    }
  });

  it("measures an insurer's answers from delivered requests, and says when there is too little to say", async () => {
    const { loadPatterns } = await import("../../src/living/intelligence.js");
    const gaps: { part: string; reason: string }[] = [];
    const [p, none] = await loadPatterns(await envFor(AMINA), gaps as never, [insurerName, `Nobody ${TAG}`]);
    expect(gaps).toEqual([]);
    expect(p).toEqual({ party: insurerName, requests: 6, answered: 5, medianDays: 3 });
    expect(none).toMatchObject({ requests: 0, medianDays: null });
    // Another brokerage reads none of it.
    const [beta] = await loadPatterns({ ...(await envFor(BETA) as object), organizationId: ORG_A } as never, [] as never, [insurerName]);
    expect(beta!.requests).toBe(0);
  });

  it("carries the client's last round for the same cover forward, with the decline and its reason", async () => {
    const { loadTrail } = await import("../../src/living/intelligence.js");
    const gaps: { part: string; reason: string }[] = [];
    const t = await loadTrail(await envFor(AMINA), gaps as never, { clientId: ACME, classOfBusiness: `Trail class ${TAG}`, excludeOpportunityId: oppOld });
    expect(gaps).toEqual([]);
    expect(t!.title).toBe(`Trail motor ${TAG} 4`);
    expect(t!.items.map((i) => i.text)).toEqual([`${insurerName} declined — Outside appetite for this fleet`]);
    expect(await loadTrail(await envFor(BETA), [] as never, { clientId: ACME, classOfBusiness: `Trail class ${TAG}`, excludeOpportunityId: null })).toBeNull();
  });
});
