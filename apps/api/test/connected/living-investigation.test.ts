/**
 * Client investigations and the continuing relationship on real Postgres (D-167): everything on file
 * for one client, composed under the viewer's session and validated against the registry; a request
 * in words is matched to the brokerage's own client names and never guessed; another brokerage's
 * client does not exist. Stage nine shows the year ahead once the renewed period is on file.
 */
import { investigateResponseSchema, livingSurfaceSchema, type LivingSurface } from "@asap/schema";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { createApp } from "../../src/app.js";
import { AMINA, BETA, buildApp, caller, JUBILEE, KAMAU, newApiKey, ORG_A, OWNER, READER } from "./_harness.js";

const API_KEY = newApiKey();
let app: ReturnType<typeof createApp>;
let sql: postgres.Sql;
const call = caller(() => app);
const TAG = randomUUID().slice(0, 6);
const day = (d: number) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);
const blockOf = (s: LivingSurface, id: string) => s.blocks.find((b) => b.id === id);
let clientId = "";
let claimWork = "";

beforeAll(async () => {
  sql = postgres(OWNER, { max: 2, onnotice: () => {} });
  await sql`insert into app.api_keys (key_hash, label) values (encode(extensions.digest(${API_KEY}, 'sha256'), 'hex'), 'connected-living-investigation')`;
  app = buildApp(API_KEY);
  const [c] = await sql<{ id: string }[]>`insert into clients (organization_id, name, kind, source) values (${ORG_A}, ${`Zawadi Haulage ${TAG}`}, 'corporate', 'seed') returning id`;
  clientId = c!.id;
  const [p] = await sql<{ id: string }[]>`insert into policies (organization_id, client_id, insurer_id, class_of_business, policy_number) values (${ORG_A}, ${clientId}, ${JUBILEE}, 'Commercial motor', ${"INV-" + TAG}) returning id`;
  await sql`insert into policy_periods (organization_id, policy_id, period_start, period_end) values (${ORG_A}, ${p!.id}, ${day(-300)}, ${day(30)})`;
  await sql`insert into policy_versions (organization_id, policy_id, version, effective_from, source) values (${ORG_A}, ${p!.id}, 1, ${day(-300)}, 'seed')`;
  const r = await call(KAMAU, "POST", "/work-items", { kind: "claim", clientId, incidentOn: day(-3), incidentSummary: `Trailer tipped ${TAG}`, policyId: p!.id, source: "ask" });
  expect(r.status).toBe(201);
  claimWork = r.body.item.id;
});
afterAll(async () => {
  await sql.end();
});

describe("GET /living/client/:clientId", () => {
  it("looks across the client's open work, cover on file and claims, offering no command", async () => {
    const res = await call(AMINA, "GET", `/living/client/${clientId}`);
    expect(res.status).toBe(200);
    const s = livingSurfaceSchema.parse(res.body);
    expect(s.purpose).toBe("investigation");
    expect(s.subject).toEqual({ kind: "client", id: clientId, title: `Zawadi Haulage ${TAG}` });
    const work = (blockOf(s, "work")!.props as { items: { title: string; ref: Record<string, string> }[] }).items;
    expect(work.find((w) => w.ref["workItemId"] === claimWork)).toMatchObject({ ref: { ws: "living", workItemId: claimWork } });
    const cover = (blockOf(s, "cover")!.props as { items: { label: string; state: string; detail: string }[] }).items;
    expect(cover[0]).toMatchObject({ state: "outstanding", detail: expect.stringMatching(/ends within 60 days/) });
    const facts = (s.blocks[0]!.props as { facts: { label: string; value: string }[] }).facts;
    expect(facts).toEqual(expect.arrayContaining([{ label: "Open work", value: "1" }, { label: "Policies in force", value: "1 of 1 on file" }]));
    expect((blockOf(s, "claims")!.props as { events: { text: string }[] }).events[0]!.text).toMatch(new RegExp(`Trailer tipped ${TAG}`));
    expect(s.blocks.flatMap((b) => b.actions).filter((a) => a.kind === "command")).toEqual([]);
    expect(JSON.stringify(s)).not.toMatch(/\b(covered|not covered|liab|payable)\w*/i);
  });

  it("is reachable from the claim's own workspace", async () => {
    const s = livingSurfaceSchema.parse((await call(AMINA, "GET", `/living/${claimWork}`)).body);
    expect(s.blocks[0]!.actions).toContainEqual({ kind: "open", label: "Everything for this client", ref: { ws: "investigation", clientId }, primary: false });
  });

  it("shows a read-only member the same, without the audit history they may not view; never another brokerage", async () => {
    const s = livingSurfaceSchema.parse((await call(READER, "GET", `/living/client/${clientId}`)).body);
    expect(blockOf(s, "work")).toBeTruthy();
    expect(blockOf(s, "recent")).toBeUndefined();
    const other = await call(BETA, "GET", `/living/client/${clientId}`);
    expect(other.status).toBe(404);
    expect(JSON.stringify(other.body)).not.toContain("Zawadi");
  });
});

describe("POST /living/investigate", () => {
  it("matches a request to the brokerage's own client name", async () => {
    const r = investigateResponseSchema.parse((await call(AMINA, "POST", "/living/investigate", { text: `everything about Zawadi Haulage ${TAG}` })).body);
    expect(r).toEqual({ clientId, unclear: null, candidates: [] });
  });
  it("asks when more than one client matches, and never guesses", async () => {
    await sql`insert into clients (organization_id, name, kind, source) values (${ORG_A}, ${`Zawadi Logistics ${TAG}`}, 'corporate', 'seed')`;
    const r = investigateResponseSchema.parse((await call(AMINA, "POST", "/living/investigate", { text: `what's going on with zawadi ${TAG}` })).body);
    expect(r.clientId).toBeNull();
    expect(r.unclear).toMatch(/More than one client/);
    expect(r.candidates.map((c) => c.name).sort()).toEqual([`Zawadi Haulage ${TAG}`, `Zawadi Logistics ${TAG}`]);
  });
  it("finds nothing in another brokerage", async () => {
    const r = investigateResponseSchema.parse((await call(BETA, "POST", "/living/investigate", { text: `everything about Zawadi Haulage ${TAG}` })).body);
    expect(r.clientId).toBeNull();
    // Their own clients may share a word; ours never appear, and none is picked.
    expect(JSON.stringify(r)).not.toContain("Zawadi");
  });
});
