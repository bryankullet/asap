/**
 * Living workspaces for claims and policy changes on real Postgres (D-161): created through the real
 * API, composed and validated against the registry, acted on through the existing claim and
 * endorsement endpoints exactly as the browser's commands do. No sentence may decide cover.
 */
import { livingSurfaceSchema, type LivingAction, type LivingSurface } from "@asap/schema";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { ACME, AMINA, BETA, buildApp, caller, JUBILEE, newApiKey, ORG_A, OWNER, READER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const TAG = randomUUID().slice(0, 6);
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const banned = /\b(covered|not covered|declin|repudiat|liab|payable)\w*/i;
let policyId = "";
type Cmd = Extract<LivingAction, { kind: "command" }>;
const commands = (s: LivingSurface, id: string) => (s.blocks.find((b) => b.id === id)?.actions ?? []).filter((a): a is Cmd => a.kind === "command");
const props = <T,>(s: LivingSurface, id: string) => s.blocks.find((b) => b.id === id)!.props as T;
const surfaceOf = async (who: typeof AMINA, id: string) => livingSurfaceSchema.parse((await call(who, "GET", `/living/${id}`)).body);

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-living-servicing')`;
  app = buildApp(API_KEY);
  const [p] = await sql`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number) values (${ORG_A}, ${ACME}, ${JUBILEE}, 'Commercial motor', ${"LS-" + TAG}) returning id`;
  policyId = p!["id"] as string;
  await sql`insert into policy_periods (organization_id, policy_id, period_start, period_end) values (${ORG_A}, ${policyId}, ${day(-200)}, ${day(165)})`;
  await sql`insert into policy_versions (organization_id, policy_id, version, effective_from, source) values (${ORG_A}, ${policyId}, 1, ${day(-200)}, 'seed')`;
});
afterAll(async () => {
  await sql.end();
});

describe("the claim workspace", () => {
  let workId = "";
  let claimId = "";
  it("composes a valid claim workspace: header, documents, offer/acceptance/payment as three facts, and no cover decision", async () => {
    const r = await call(AMINA, "POST", "/work-items", { kind: "claim", clientId: ACME, incidentOn: day(-2), incidentSummary: `Rear-ended at Mlolongo ${TAG}.`, policyId, source: "ask" });
    expect(r.status).toBe(201);
    workId = r.body.item.id;
    claimId = (await sql`select id from claims where work_item_id = ${workId}`)[0]!["id"] as string;
    expect((await call(AMINA, "POST", `/claims/${claimId}/actions`, { action: "add_document", label: `Police abstract ${TAG}`, holder: "client" })).status).toBe(200);
    const s = await surfaceOf(AMINA, workId);
    expect(s.purpose).toBe("claim");
    expect(props<{ eyebrow: string }>(s, "header").eyebrow).toBe("Claim");
    const docs = props<{ items: { label: string; state: string; party: string | null }[] }>(s, "documents");
    expect(docs.items.find((d) => d.label === `Police abstract ${TAG}`)).toMatchObject({ state: "outstanding", party: "With the client" });
    expect(props<{ items: { key: string; state: string }[] }>(s, "settlement").items.map((i) => [i.key, i.state])).toEqual([["offer", "outstanding"], ["acceptance", "outstanding"], ["payment", "outstanding"]]);
    expect(JSON.stringify(s)).not.toMatch(banned);
  });
  it("records a document received through the claim endpoint, as the workspace's command does", async () => {
    const s = await surfaceOf(AMINA, workId);
    const receive = commands(s, "documents").find((c) => c.label.includes(`Police abstract ${TAG}`))!;
    expect(receive.command).toBe("claim.receive_document");
    const res = await call(AMINA, "POST", `/claims/${receive.target}/actions`, { ...receive.payload, reference: `Emailed by the client ${TAG}` });
    expect(res.status).toBe(200);
    const after = await surfaceOf(AMINA, workId);
    expect(props<{ items: { label: string; state: string; detail: string | null }[] }>(after, "documents").items.find((d) => d.label === `Police abstract ${TAG}`)).toMatchObject({ state: "done", detail: `Emailed by the client ${TAG}` });
    expect(commands(after, "documents").some((c) => c.label.includes(`Police abstract ${TAG}`))).toBe(false);
  });
  it("offers a read-only member no command, and never exists for another brokerage", async () => {
    const reader = await surfaceOf(READER, workId);
    expect(reader.blocks.flatMap((b) => b.actions).filter((a) => a.kind === "command")).toEqual([]);
    expect((await call(BETA, "GET", `/living/${workId}`)).status).toBe(404);
  });
});

describe("the policy change workspace", () => {
  let workId = "";
  it("shows each requested item waiting for the insurer, and records their written decision through the endorsement endpoint", async () => {
    const r = await call(AMINA, "POST", "/work-items", { kind: "endorsement", clientId: ACME, policyId, requestText: `Please add vehicle KDX ${TAG.slice(0, 3)}A to the fleet.`, requestedBy: "policyholder" });
    expect(r.status).toBe(201);
    workId = r.body.item.id;
    const eid = (await sql`select id from endorsements where work_item_id = ${workId}`)[0]!["id"] as string;
    expect((await call(AMINA, "POST", `/endorsements/${eid}/actions`, { action: "set_details", effectiveOn: day(3), items: [{ id: "veh1", label: `KDX ${TAG.slice(0, 3)}A`, before: null, after: "Toyota Hilux, KES 3,200,000", sumInsuredMinor: 320000000 }] })).status).toBe(200);
    const s = await surfaceOf(AMINA, workId);
    expect(s.purpose).toBe("endorsement");
    expect(props<{ items: { key: string; state: string }[] }>(s, "items").items).toEqual([expect.objectContaining({ key: "veh1", state: "pending" })]);
    const cons = props<{ items: { text: string }[] }>(s, "consequences").items.map((i) => i.text).join(" ");
    expect(cons).toMatch(/has not changed yet/);
    const decide = commands(s, "items")[0]!;
    expect(decide.command).toBe("endorsement.decide_item");
    const res = await call(AMINA, "POST", `/endorsements/${decide.target}/actions`, { ...decide.payload, decision: "accepted", responseReference: `Jubilee email ${TAG}` });
    expect(res.status).toBe(200);
    const after = await surfaceOf(AMINA, workId);
    expect(props<{ items: { key: string; state: string }[] }>(after, "items").items[0]!.state).toBe("done");
    expect(commands(after, "items")).toEqual([]);
    expect(JSON.stringify(after)).not.toMatch(banned);
  });
});
