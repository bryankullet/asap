/**
 * Saved, versioned proposals and the continuing relationship on real Postgres (D-167). A proposal is
 * saved from the exploration through the workspace's own command, numbered per renewal, holds
 * insurers and revisions (never figures), says when an answer was revised after it was saved, and is
 * never the client's instruction. Roles, other brokerages and direct database calls are refused.
 */
import { livingSurfaceSchema, type LivingAction, type LivingSurface } from "@asap/schema";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, BETA, browser, buildApp, caller, CIC, JUBILEE, KAMAU, newApiKey, ORG_A, OWNER, READER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const TAG = randomUUID().slice(0, 6);
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
type Cmd = Extract<LivingAction, { kind: "command" }>;
const surfaceOf = async (who: typeof AMINA, id: string, q = "") => livingSurfaceSchema.parse((await call(who, "GET", `/living/${id}${q}`)).body);
const blockOf = (s: LivingSurface, id: string) => s.blocks.find((b) => b.id === id);
let work = "";
let oiJubilee = "";
let oiCic = "";
let respJubilee = "";

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-living-proposals')`;
  app = buildApp(API_KEY);
  const [pol] = await sql<{ id: string }[]>`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number) values (${ORG_A}, ${ACME}, ${JUBILEE}, ${`Proposal class ${TAG}`}, ${"LP-" + TAG}) returning id`;
  const [per] = await sql<{ id: string }[]>`insert into policy_periods (organization_id, policy_id, period_start, period_end, premium_amount, premium_currency, premium_basis) values (${ORG_A}, ${pol!.id}, ${day(-340)}, ${day(25)}, 170000, 'KES', 'gross') returning id`;
  expect((await call(AMINA, "POST", "/workflows/renewals", { policyPeriodId: per!.id })).status).toBe(200);
  work = (await sql<{ work_item_id: string }[]>`select work_item_id from workflow_runs where subject_id = ${per!.id}`)[0]!.work_item_id;
  // The renewal's quotation with two answers on file.
  let [opp] = await sql<{ id: string }[]>`select id from opportunities where work_item_id = ${work}`;
  if (!opp) [opp] = await sql<{ id: string }[]>`insert into opportunities (organization_id, client_id, work_item_id, title, class_of_business, created_by) values (${ORG_A}, ${ACME}, ${work}, ${`Renewal ${TAG}`}, ${`Proposal class ${TAG}`}, ${AMINA.id}) returning id`;
  const add = async (insurer: string, premium: number) => {
    const [oi] = await sql<{ id: string }[]>`insert into opportunity_insurers (organization_id, opportunity_id, insurer_id, added_by) values (${ORG_A}, ${opp!.id}, ${insurer}, ${AMINA.id}) returning id`;
    const [r] = await sql<{ id: string }[]>`insert into insurer_responses (organization_id, opportunity_id, opportunity_insurer_id, outcome, received_at, premium_amount, premium_currency, source_note, recorded_by)
      values (${ORG_A}, ${opp!.id}, ${oi!.id}, 'quoted', now() - interval '2 days', ${premium}, 'KES', 'Underwriter email', ${AMINA.id}) returning id`;
    return { oi: oi!.id, r: r!.id };
  };
  const j = await add(JUBILEE, 182000);
  const c = await add(CIC, 189000);
  oiJubilee = j.oi;
  respJubilee = j.r;
  oiCic = c.oi;
});
afterAll(async () => {
  await sql.end();
});

describe("saved, versioned proposals", () => {
  it("offers saving what is being explored as v1, through the workspace's own command", async () => {
    const s = await surfaceOf(KAMAU, work, `?explore=${oiJubilee},${oiCic}`);
    const save = (blockOf(s, "explore")?.actions ?? []).find((a): a is Cmd => a.kind === "command" && a.command === "proposal.save");
    expect(save, JSON.stringify(s.blocks.map((b) => b.id))).toBeTruthy();
    expect(save!.label).toBe("Save as proposal v1");
    expect(save!.payload).toEqual({ explore: `${oiJubilee},${oiCic}` });
    const r = await call(KAMAU, "POST", `/living/${save!.target}/proposals`, { ...save!.payload, note: "Client asked to see both" });
    expect(r.body).toEqual({ outcome: "applied", version: 1 });
    expect((await call(KAMAU, "POST", `/living/${work}/proposals`, { explore: oiJubilee })).body).toEqual({ outcome: "applied", version: 2 });
    const row = (await sql`select revisions, opportunity_insurer_ids from renewal_proposals where work_item_id = ${work} and version = 1`)[0]!;
    expect(row["opportunity_insurer_ids"]).toEqual([oiJubilee, oiCic]);
    expect(JSON.stringify(row)).not.toMatch(/182000|189000/);
  });

  it("lists them newest first, hypothetical, and says when an answer was revised after saving", async () => {
    await sql`update insurer_responses set premium_amount = 186500 where id = ${respJubilee}`;
    const s = await surfaceOf(AMINA, work);
    const p = blockOf(s, "proposals")!.props as { items: { version: number; insurers: string[]; revisedSince: string[]; latest: boolean; note: string | null; ref: Record<string, string> }[]; committed: string | null; note: string };
    expect(p.items.map((i) => i.version)).toEqual([2, 1]);
    expect(p.items[1]).toMatchObject({ note: "Client asked to see both", latest: false, ref: { ws: "living", workItemId: work, explore: `${oiJubilee},${oiCic}` } });
    expect(p.items[1]!.insurers).toHaveLength(2);
    // Jubilee revised after both were saved; CIC did not.
    expect(p.items[1]!.revisedSince).toEqual([p.items[1]!.insurers[0]]);
    expect(p.items[0]!.revisedSince).toEqual(p.items[0]!.insurers);
    expect(p.committed).toBeNull();
    expect(p.note).toMatch(/not the client's instruction and is not sent/);
  });

  it("refuses a read-only member, another brokerage, another quotation's insurer and a direct database call", async () => {
    const ro = await call(READER, "POST", `/living/${work}/proposals`, { explore: oiJubilee });
    expect(ro.status).toBe(403);
    expect(ro.body).toMatchObject({ outcome: "blocked" });
    expect((await call(BETA, "POST", `/living/${work}/proposals`, { explore: oiJubilee })).status).toBe(404);
    const [foreign] = await sql<{ id: string }[]>`select id from opportunity_insurers where opportunity_id <> (select opportunity_id from opportunity_insurers where id = ${oiJubilee}) and organization_id = ${ORG_A} limit 1`;
    if (foreign) expect((await call(KAMAU, "POST", `/living/${work}/proposals`, { explore: foreign.id })).status).toBe(422);
    const direct = await browser(KAMAU, "POST", "rpc/renewal_proposal_save", { p_work_item_id: work, p_opportunity_insurer_ids: [oiJubilee], p_note: null });
    expect(direct.status).toBeGreaterThanOrEqual(400);
    expect((await sql`select count(*)::int as n from renewal_proposals where work_item_id = ${work}`)[0]!["n"]).toBe(2);
    expect((await browser(BETA, "GET", `renewal_proposals?work_item_id=eq.${work}&select=id`)).body).toEqual([]);
    expect((await sql`select count(*)::int as n from audit_log where object_id = ${work} and action = 'renewal.proposal_saved'`)[0]!["n"]).toBe(2);
  });

  it("offers a read-only member no save, and shows them the proposals", async () => {
    const s = await surfaceOf(READER, work, `?explore=${oiJubilee}`);
    expect((blockOf(s, "explore")?.actions ?? []).some((a) => a.kind === "command")).toBe(false);
    expect(blockOf(s, "proposals")).toBeTruthy();
  });
});

describe("stage nine needs verified renewed cover", () => {
  it("does not call a renewal continuing because a later period is on file, without verified issuance", async () => {
    const [pp] = await sql<{ policy_id: string }[]>`select pp.policy_id from policy_periods pp join work_items w on w.policy_period_id = pp.id where w.id = ${work}`;
    await sql`insert into policy_periods (organization_id, policy_id, period_start, period_end) values (${ORG_A}, ${pp!.policy_id}, ${day(26)}, ${day(390)})`;
    const s = await surfaceOf(AMINA, work);
    expect(s.stage!.key).not.toBe("continuing");
    expect(s.unavailable).toEqual([]);
    expect(blockOf(s, "continuing")).toBeUndefined();
  });
});
